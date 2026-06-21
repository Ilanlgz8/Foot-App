// Suivi live en deux couches :
//
// ── PRIMAIRE : ESPN (site.api.espn.com via /espn) ──
//   • Pas de quota, pas de clé API
//   • Poll toutes les 15s dès qu'un match approche ou est en cours
//   • liveTracker : source unique de vérité persistée en localStorage
//       markLive(match) → match visible dans le widget immédiatement
//       markEnded(id)   → fin confirmée (5min de STATUS_FINAL + horloge >= 85min)
//   • Scores + buteurs + stats extraits ici → ['espnScores'] React Query
//
// ── FALLBACK : api-football.com (/apifootball?live=all) ──
//   • Poll toutes les 60s, UNIQUEMENT dans les 4 fenêtres critiques

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import EspnTimerWorker from '../workers/espnTimerWorker.js?worker'
import {
  getMatchState, trackMatchState, clearMatchState, clearFtFlags,
  getTrackedMatches, setKickoffAt, setHalf2Start,
  clearAllMatchStates, setEspnData, setEspnWorking,
  getLiveState, setLiveState,
} from '../utils/matchStateTracker'
import { markLive, markEnded, isTrackedLive, getLiveMatches } from './liveTracker'
import { notifyKickoff, notifyHalfTime, notifyGoal, notifyFullTime } from '../utils/notify'

// ─────────────────────────────────────────────
// Push notifications — envoi serveur
// ─────────────────────────────────────────────

/**
 * Appelle /api/push (Vercel) pour notifier tous les abonnés d'un but.
 * Fire-and-forget : les erreurs sont silencieuses, la notification est optionnelle.
 *
 * Sécurité côté serveur : le serveur re-fetch ESPN pour vérifier le score avant
 * d'envoyer la moindre notification (voir api/push.js).
 */
function _sendPushGoal(match, home, away, scorers, slug) {
  // Si l'app est au premier plan → notifyGoal() gère déjà la notif locale,
  // inutile d'envoyer un push serveur en doublon
  if (document.visibilityState === 'visible') return

  const homeTeam = match.homeTeam?.shortName ?? match.homeTeam?.name ?? ''
  const awayTeam = match.awayTeam?.shortName ?? match.awayTeam?.name ?? ''

  // Détecter but contre son camp
  const lastScorer = scorers?.[scorers.length - 1]
  const isOwnGoal  = lastScorer?.ownGoal === true
  const scorer     = isOwnGoal ? null : scorers?.find(s => !s.ownGoal && s.minute)

  const title = isOwnGoal
    ? '⚽ But contre son camp !'
    : scorer
      ? `⚽ But ! — ${scorer.name}`
      : '⚽ But !'

  const message = `${homeTeam} ${home} – ${away} ${awayTeam}`

  fetch('/api/push', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchId:  match.id,
      espnSlug: slug,
      home,
      away,
      title,
      message,
    }),
  }).catch(() => { /* silencieux — push est un bonus, pas critique */ })
}

// ─────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────

let quotaRemaining = Infinity
let espnFailStreak = 0

// Cache module-level des scores ESPN (scores + buteurs + stats).
const espnScoresCache = {}

// "FT potentiel" — STATUS_FINAL vu une 1ère fois, en attente de confirmation
// { [matchId]: { since: number, score: string } }
const pendingFt = {}

// Dernière fois que chaque match a été vu dans un event ESPN (scoreboard ou STATUS_FINAL)
// { [matchId]: timestamp }
const lastSeenInEspn = {}

// Dernière fois qu'on a fetché les stats summary pour un match
// { [matchId]: timestamp }
const lastSummaryFetch = {}

// Restauration partielle au chargement
// On garde le cache jusqu'à 30 min pour couvrir les reloads pendant un match
try {
  const lastPoll = parseInt(localStorage.getItem('foot_espn_last_poll') ?? '0', 10)
  if (Date.now() - lastPoll < 30 * 60_000) {
    const raw = localStorage.getItem('espn_scores_cache')
    if (raw) Object.assign(espnScoresCache, JSON.parse(raw))
  }
} catch {}

// football-data.org competition ID → slug ESPN
export const COMP_ESPN = {
  2015: 'fra.1',
  2021: 'eng.1',
  2014: 'esp.1',
  2002: 'ger.1',
  2019: 'ita.1',
  2001: 'uefa.champions',
  2146: 'uefa.europa',
  2048: 'uefa.europa.conf',
  2000: 'fifa.world',
}

// ─────────────────────────────────────────────
// Helpers communs
// ─────────────────────────────────────────────

export function normalize(name = '') {
  return name.toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[éèêë]/g, 'e')
    .replace(/[ûùüú]/g, 'u').replace(/[îïí]/g, 'i')
    .replace(/[ôöó]/g, 'o').replace(/ç/g, 'c')
    .trim()
}

export function fuzzyTeam(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (!na || !nb) return false
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true
  const wordsA = na.split(/\s+/).filter(w => w.length >= 4)
  const wordsB = nb.split(/\s+/).filter(w => w.length >= 4)
  return wordsA.some(wa =>
    wordsB.some(wb => wa.startsWith(wb.slice(0, 4)) || wb.startsWith(wa.slice(0, 4)))
  )
}

/**
 * Convertit un displayClock ESPN ("42:00", "45:00+2:00") en minutes entières.
 */
function parseClockMins(clock) {
  if (!clock) return null
  const plusIdx = clock.indexOf('+')
  if (plusIdx === -1) {
    const m = parseInt(clock.split(':')[0], 10)
    return isNaN(m) ? null : m
  }
  const base  = parseInt(clock.slice(0, plusIdx).split(':')[0], 10)
  const extra = parseInt(clock.slice(plusIdx + 1).split(':')[0], 10)
  if (isNaN(base) || isNaN(extra)) return null
  return base + extra
}

/**
 * Convertit un score ESPN en entier.
 * ESPN peut renvoyer : string "1", nombre 1, ou objet { displayValue: "1" }.
 */
function parseScore(raw) {
  if (raw == null) return 0
  if (typeof raw === 'number') return Math.round(raw)
  if (typeof raw === 'string') return parseInt(raw, 10) || 0
  if (typeof raw === 'object') return parseInt(raw.displayValue ?? raw.value ?? '0', 10) || 0
  return 0
}

/**
 * Extrait scores, buteurs et stats d'une competition ESPN.
 * Retourne null si les competitors home/away sont absents.
 */
function extractMatchData(comp) {
  const homeC = (comp.competitors ?? []).find(c => c.homeAway === 'home')
  const awayC = (comp.competitors ?? []).find(c => c.homeAway === 'away')
  if (!homeC || !awayC) return null

  const getStat = (c, name) => {
    const found = (c.statistics ?? []).find(s => s.name === name)
    return found != null ? (parseFloat(found.displayValue) || 0) : null
  }
  const getStatAny = (c, ...names) => {
    for (const n of names) {
      const v = getStat(c, n)
      if (v !== null) return v
    }
    return null
  }

  const homePoss    = getStat(homeC, 'possessionPct')
  const awayPoss    = getStat(awayC, 'possessionPct')
  const homeShots   = getStatAny(homeC, 'totalShots', 'shotsTotal', 'shots')
  const awayShots   = getStatAny(awayC, 'totalShots', 'shotsTotal', 'shots')
  const homeCorners  = getStatAny(homeC, 'cornerKicks', 'corners')
  const awayCorners  = getStatAny(awayC, 'cornerKicks', 'corners')
  const homeSOT      = getStatAny(homeC, 'shotsOnTarget', 'onTargetShots', 'shotsOnGoal')
  const awaySOT      = getStatAny(awayC, 'shotsOnTarget', 'onTargetShots', 'shotsOnGoal')
  const hasStats     = homePoss !== null || awayPoss !== null || homeShots !== null || awayShots !== null

  const scorers = (comp.details ?? [])
    .filter(d => d.type?.text === 'Goal' || d.type?.id === '57')
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      return {
        name:        ath?.shortName ?? ath?.displayName ?? '?',
        minute:      d.clock?.displayValue ?? '',
        team:        d.team?.id === homeC.team?.id ? 'home' : 'away',
        ownGoal:     d.ownGoal     ?? false,
        penaltyKick: d.penaltyKick ?? false,
      }
    })

  return {
    homeC,
    awayC,
    home:    parseScore(homeC.score),
    away:    parseScore(awayC.score),
    scorers,
    stats: hasStats ? {
      home: { poss: homePoss, shots: homeShots, shotsOnTarget: homeSOT, corners: homeCorners },
      away: { poss: awayPoss, shots: awayShots, shotsOnTarget: awaySOT, corners: awayCorners },
    } : null,
  }
}

// ─────────────────────────────────────────────
// Helper : confirmer un FT et planifier l'éviction
// ─────────────────────────────────────────────

function confirmFt(match, now, queryClient) {
  const id    = match.id
  const cache = espnScoresCache[id]
  notifyFullTime(match, cache?.home ?? 0, cache?.away ?? 0)
  setLiveState(id, 'ended', { endedAt: now })

  // Persister le score ESPN pour MatchModal post-match
  if (espnScoresCache[id]) {
    try { localStorage.setItem(`foot_espn_${id}`, JSON.stringify(espnScoresCache[id])) } catch {}
  }

  // ft: true → stoppe calcMinute, MatchCard passe en "Terminé"
  try {
    localStorage.setItem(`foot_ms_${id}`, JSON.stringify({
      ...getMatchState(id),
      ft:        true,
      termineAt: now,
    }))
  } catch {}

  queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
  setTimeout(() => queryClient.invalidateQueries({ queryKey: ['todayMatches'] }), 2_000)
  if (match.competition?.code) {
    // La clé localCache utilise le préfixe foot_
    try { localStorage.removeItem(`foot_matches_${match.competition.code}_FINISHED`) } catch {}
  }

  // Éviction réelle après 5min (grace period : widget reste avec "Terminé")
  const code = match.competition?.code
  setTimeout(() => {
    markEnded(id)
    delete espnScoresCache[id]
    clearMatchState(id, { preserveEnded: true })
    queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
    if (code) {
      queryClient.invalidateQueries({ queryKey: ['matches', code, 'FINISHED'] })
      queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
    }
  }, 5 * 60_000)
}

// ─────────────────────────────────────────────
// ESPN — couche primaire
// ─────────────────────────────────────────────

function findMatchESPN(competitors, matches) {
  const homeComp = competitors.find(c => c.homeAway === 'home') ?? competitors[0]
  const awayComp = competitors.find(c => c.homeAway === 'away') ?? competitors[1]
  const espnHome = homeComp?.team?.displayName ?? homeComp?.team?.name ?? ''
  const espnAway = awayComp?.team?.displayName ?? awayComp?.team?.name ?? ''
  if (!espnHome || !espnAway) return null

  return matches.find(m => {
    const h = m.homeTeam?.name ?? m.homeTeam?.shortName ?? ''
    const a = m.awayTeam?.name ?? m.awayTeam?.shortName ?? ''
    return fuzzyTeam(h, espnHome) && fuzzyTeam(a, espnAway)
  }) ?? null
}

// ── Safeguards FT — appelés avant le early return, même sans slugs à poller ──
function _runFtSafeguards(matches, now, queryClient) {
  // Pool combiné : matches FD.org du jour + matchs stockés dans liveTracker
  // (un match terminé n'est plus dans matches FD.org mais reste dans liveTracker)
  const allLive = [...matches]
  for (const lm of getLiveMatches()) {
    if (!allLive.some(m => m.id === lm.id)) allLive.push(lm)
  }

  // Safeguard 1 : pendingFt timeout (45s)
  // ESPN a envoyé STATUS_FINAL une fois puis retiré l'event → confirmer après 45s
  for (const [midStr, pft] of Object.entries(pendingFt)) {
    if (now - pft.since < 45_000) continue
    const mid = Number(midStr)
    delete pendingFt[midStr]
    if (getLiveState(mid).state === 'ended') continue
    if (!isTrackedLive(mid)) continue
    const match = allLive.find(m => m.id === mid)
    if (!match) continue
    console.log(`[useLiveMinute] pendingFt timeout → FT auto-confirmé match ${mid}`)
    confirmFt(match, now, queryClient)
  }

  // Safeguard 2 : durée max live (150min depuis utcDate)
  // ESPN a arrêté d'envoyer le match sans STATUS_FINAL → FT forcé
  // Utilise getLiveMatches() (liveTracker) et non getTrackedMatches() (timing api-fb)
  for (const lm of getLiveMatches()) {
    const mid = lm.id
    if (getLiveState(mid).state === 'ended') continue
    if (pendingFt[mid]) continue
    const ageMin = (now - new Date(lm.utcDate)) / 60_000
    if (ageMin < 150) continue
    console.log(`[useLiveMinute] match ${mid} > 150min → FT forcé`)
    confirmFt(lm, now, queryClient)
  }

  // Safeguard 3 : FD.org confirme FINISHED mais match encore dans liveTracker
  // → FT immédiat, pas besoin d'attendre ESPN (FD.org se rafraîchit toutes les 2min en live)
  for (const lm of getLiveMatches()) {
    const mid = lm.id
    if (getLiveState(mid).state === 'ended') continue
    if (pendingFt[mid]) continue
    const fdMatch = allLive.find(m => m.id === mid)
    if (!fdMatch || fdMatch.status !== 'FINISHED') continue
    console.log(`[useLiveMinute] match ${mid} FINISHED (FD.org) → FT`)
    confirmFt(lm, now, queryClient)
  }

  // Safeguard 4 : match disparu du scoreboard ESPN depuis > 5min après avoir été vu
  // Cas : ESPN retire l'event sans STATUS_FINAL (pas de pendingFt, pas encore 150min)
  // → FT forcé dès que le match a > 90min de jeu et n'est plus dans le scoreboard
  for (const lm of getLiveMatches()) {
    const mid = lm.id
    if (getLiveState(mid).state === 'ended') continue
    if (pendingFt[mid]) continue
    const lastSeen = lastSeenInEspn[mid]
    if (!lastSeen) continue                         // jamais vu par ESPN cette session → skip
    if (now - lastSeen < 5 * 60_000) continue       // vu récemment → ok
    const ageMin = (now - new Date(lm.utcDate)) / 60_000
    if (ageMin < 90) continue                       // trop tôt pour être terminé
    console.log(`[useLiveMinute] match ${mid} disparu d'ESPN depuis ${Math.round((now - lastSeen) / 60_000)}min → FT`)
    confirmFt(lm, now, queryClient)
  }
}

async function pollESPN(matches, queryClient) {
  const now = Date.now()

  // Étendre matches avec les matchs persistés dans liveTracker
  // → fix cold start PWA : matches[] vide pendant 1-2s au chargement
  const allMatches = [...matches]
  for (const lm of getLiveMatches()) {
    if (!allMatches.some(m => m.id === lm.id)) allMatches.push(lm)
  }

  const slugSet = new Set()
  for (const m of allMatches) {
    const elapsed = (now - new Date(m.utcDate)) / 60000
    // Étendre la fenêtre si le match est déjà tracké live (prolongations, retard KO…)
    if ((elapsed >= -5 && elapsed <= 150) || isTrackedLive(m.id)) {
      const slug = COMP_ESPN[m.competition?.id]
      if (slug) slugSet.add(slug)
    }
  }

  // Pas de slugs → safeguards + sortie
  if (slugSet.size === 0) {
    _runFtSafeguards(allMatches, now, queryClient)
    return
  }

  const d = new Date()
  const todayESPN = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

  for (const slug of slugSet) {
    try {
      const res = await fetch(`/espn?slug=${slug}&dates=${todayESPN}&_t=${Date.now()}`)
      if (!res.ok) {
        espnFailStreak++
        if (espnFailStreak >= 3) setEspnWorking(false)
        continue
      }
      espnFailStreak = 0
      setEspnWorking(true)
      try { localStorage.setItem('foot_espn_last_poll', String(Date.now())) } catch {}

      const json = await res.json()
      for (const evt of json.events ?? []) {
        const comp = evt.competitions?.[0]
        if (!comp) continue

        const st         = comp.status
        const espnStatus = st?.type?.name
        const espnClock  = st?.displayClock
        if (!espnStatus) continue

        const match = findMatchESPN(comp.competitors ?? [], allMatches)
        if (!match) continue

        // Mémoriser que ce match est encore visible dans le scoreboard ESPN
        lastSeenInEspn[match.id] = now

        const prevState = getMatchState(match.id)

        // Toujours écrire les données ESPN brutes (pour calcMinute)
        setEspnData(match.id, { espnClock, espnStatus, espnPeriod: st.period ?? null })

        // ════════════════════════════════════════════════════════════════════
        // CAS 1 : Match EN COURS (IN_PROGRESS, HALFTIME, prolongations…)
        // ════════════════════════════════════════════════════════════════════
        if (
          espnStatus === 'STATUS_IN_PROGRESS' ||
          espnStatus === 'STATUS_HALFTIME'    ||
          espnStatus === 'STATUS_END_PERIOD'  ||
          espnStatus === 'STATUS_EXTRA_TIME'  ||
          espnStatus === 'STATUS_OVERTIME'      ||
          espnStatus === 'STATUS_SHOOTOUT'
        ) {
          const ls = getLiveState(match.id)

          // Si liveState était 'ended' (fausse éviction) → récupérer sans condition.
          // Un vrai match ne revient JAMAIS en IN_PROGRESS/HALFTIME après être terminé.
          if (ls.state !== 'live') {
            setLiveState(match.id, 'live')
          }

          // Annuler tout FT potentiel en cours (c'était un flash post-but, pas un vrai FT)
          delete pendingFt[match.id]

          // Effacer ft/termineAt résiduels SANS effacer liveState/matchSnapshot
          clearFtFlags(match.id)

          // ── Marquer live dans liveTracker → widget visible immédiatement ──
          // markLive persiste en localStorage → survit aux rechargements de page.
          markLive(match)

          // ── Scores + buteurs + stats ─────────────────────────────────────
          const data = extractMatchData(comp)
          if (data) {
            const prevCache = espnScoresCache[match.id]
            const prevStats = prevCache?.stats ?? null
            // Détecter un but : score total augmente
            const prevTotal = (prevCache?.home ?? -1) + (prevCache?.away ?? -1)
            const newTotal  = data.home + data.away
            if (prevCache && newTotal > prevTotal) {
              notifyGoal(match, data.home, data.away, data.scorers)
              // Push server-side → notifie tous les abonnés, même app fermée
              _sendPushGoal(match, data.home, data.away, data.scorers, slug)
            }
            espnScoresCache[match.id] = {
              home:       data.home,
              away:       data.away,
              scorers:    data.scorers,
              // Si ESPN ne renvoie pas les stats ce poll → garder celles du précédent
              stats:      data.stats ?? prevStats,
              // Stocker l'event ID + slug pour fetch summary (stats live) à la demande
              espnEventId: evt.id,
              espnSlug:    slug,
            }
          }
        }

        // ── KO détecté (1ère MT, kickoffAt pas encore connu) ──────────────
        if (
          espnStatus === 'STATUS_IN_PROGRESS' &&
          (st.period ?? 1) === 1 &&
          !prevState.kickoffAt
        ) {
          const mins = parseClockMins(espnClock)
          if (mins != null && mins > 0) {
            setKickoffAt(match.id, now - mins * 60_000)
          }
          notifyKickoff(match)
        }

        // ── HT détecté ────────────────────────────────────────────────────
        if (espnStatus === 'STATUS_HALFTIME' && !prevState.pausedAt) {
          trackMatchState({ ...match, status: 'PAUSED' })
          const cache = espnScoresCache[match.id]
          notifyHalfTime(match, cache?.home ?? 0, cache?.away ?? 0)
        }

        // ── 2H détecté ────────────────────────────────────────────────────
        if (
          espnStatus === 'STATUS_IN_PROGRESS' &&
          (st.period ?? 1) === 2 &&
          prevState.pausedAt &&
          !prevState.half2Start
        ) {
          const mins = parseClockMins(espnClock)
          if (mins != null) {
            setHalf2Start(match.id, now - Math.max(0, mins - 45) * 60_000)
          }
        }

        // ════════════════════════════════════════════════════════════════════
        // CAS 2 : FT / ANNULÉ / REPORTÉ
        // ════════════════════════════════════════════════════════════════════
        if (
          espnStatus === 'STATUS_FINAL'     ||
          espnStatus === 'STATUS_FULL_TIME' ||
          espnStatus === 'STATUS_POSTPONED' ||
          espnStatus === 'STATUS_CANCELED'
        ) {
          // Jamais suivi comme live → rien à faire
          if (!isTrackedLive(match.id)) continue

          // Déjà confirmé terminé → ignorer (évite de reschedule le timeout à chaque poll)
          if (getLiveState(match.id).state === 'ended') continue

          // ── Extraire le score actuel (toujours — le but EST dans cet event) ──
          const currData  = extractMatchData(comp)
          const prevCache = espnScoresCache[match.id]
          const prevStats = prevCache?.stats ?? null
          if (currData) {
            espnScoresCache[match.id] = {
              ...(prevCache ?? {}),
              home:        currData.home,
              away:        currData.away,
              scorers:     currData.scorers,
              stats:       currData.stats ?? prevStats,
              espnEventId: evt.id,
              espnSlug:    slug,
            }
          }

          // POSTPONED / CANCELED → pas de logique score, éviction immédiate
          if (espnStatus === 'STATUS_POSTPONED' || espnStatus === 'STATUS_CANCELED') {
            setLiveState(match.id, 'ended', { endedAt: now })
            setTimeout(() => { markEnded(match.id); clearMatchState(match.id) }, 5 * 60_000)
            continue
          }

          // ── DÉTECTION FT ──────────────────────────────────────────────────────
          //
          // ESPN peut flasher STATUS_FINAL juste après un but (but + sifflet dans
          // le même poll). On compare le score actuel avec le score du poll précédent
          // (prevCache, capturé AVANT la mise à jour espnScoresCache ci-dessus).
          //
          //   1) Horloge < 85min → faux positif certain (trop tôt)
          //   2) Score changé dans ce même poll → but tardif, rester live
          //   3) Score inchangé → FT immédiat (pas besoin d'un 2ème poll)
          const mins = parseClockMins(espnClock)
          const timePlausible = mins !== null && mins >= 85

          if (!timePlausible) {
            // Horloge trop basse → faux positif certain
            delete pendingFt[match.id]
            markLive(match)
            clearFtFlags(match.id)
            continue
          }

          // Horloge >= 85min — comparer score actuel vs score du poll précédent
          const prevScore    = prevCache ? `${prevCache.home}-${prevCache.away}` : null
          const currentScore = currData  ? `${currData.home}-${currData.away}`  : null

          if (prevScore !== null && currentScore !== null && prevScore !== currentScore) {
            // Score a changé dans CE poll en même temps que STATUS_FINAL → but tardif
            delete pendingFt[match.id]
            markLive(match)
            clearFtFlags(match.id)
            continue
          }

          // STATUS_FINAL + score inchangé → FT immédiat
          delete pendingFt[match.id]
          confirmFt(match, now, queryClient)
        }
      }
    } catch (err) {
      console.warn('[useLiveMinute] ESPN erreur pour slug', slug, ':', err.message)
    }
  }

  // Safeguards après traitement ESPN — scores à jour dans espnScoresCache
  // (évite que safeguard 3 confirme FT avec l'ancien score avant qu'ESPN mette à jour)
  _runFtSafeguards(allMatches, now, queryClient)

  // Pousser les scores dans React Query → useEspnScores réactif sans fetch séparé
  queryClient.setQueryData(['espnScores'], { ...espnScoresCache })
  try { localStorage.setItem('espn_scores_cache', JSON.stringify(espnScoresCache)) } catch {}

  // ── Fetch summary stats en background (toutes les 60s par match live) ────────
  // Le scoreboard ESPN ne retourne jamais de stats pour les matchs live.
  // On fetch l'endpoint summary séparément pour alimenter StatsBar (card) + modal.
  const SUMMARY_INTERVAL = 60_000
  for (const [midStr, cached] of Object.entries(espnScoresCache)) {
    const mid = Number(midStr)
    if (!isTrackedLive(mid)) continue
    if (!cached.espnEventId || !cached.espnSlug) continue
    if (lastSummaryFetch[mid] && now - lastSummaryFetch[mid] < SUMMARY_INTERVAL) continue
    lastSummaryFetch[mid] = now

    // Fire-and-forget : ne bloque pas le poll principal
    ;(async (mId, slug, eventId) => {
      try {
        const r = await fetch(`/espn?slug=${slug}&eventId=${eventId}`)
        if (!r.ok) return
        const json = await r.json()
        const teams    = json.boxscore?.teams ?? []
        const homeTeam = teams.find(t => t.homeAway === 'home')
        const awayTeam = teams.find(t => t.homeAway === 'away')

        const getStat = (team, ...names) => {
          for (const name of names) {
            const s = (team?.statistics ?? []).find(st => st.name === name)
            if (s != null) { const v = parseFloat(s.displayValue); return isNaN(v) ? null : v }
          }
          return null
        }

        const homePoss    = getStat(homeTeam, 'possessionPct')
        const awayPoss    = getStat(awayTeam, 'possessionPct')
        const homeShots   = getStat(homeTeam, 'totalShots', 'shotsTotal', 'shots')
        const awayShots   = getStat(awayTeam, 'totalShots', 'shotsTotal', 'shots')
        const homeSOT     = getStat(homeTeam, 'shotsOnTarget', 'onTargetShots', 'shotsOnGoal')
        const awaySOT     = getStat(awayTeam, 'shotsOnTarget', 'onTargetShots', 'shotsOnGoal')
        const homeCorners = getStat(homeTeam, 'cornerKicks', 'corners')
        const awayCorners = getStat(awayTeam, 'cornerKicks', 'corners')

        if (homePoss === null && homeShots === null) return

        if (espnScoresCache[mId]) {
          espnScoresCache[mId] = {
            ...espnScoresCache[mId],
            stats: {
              home: { poss: homePoss, shots: homeShots, shotsOnTarget: homeSOT, corners: homeCorners },
              away: { poss: awayPoss, shots: awayShots, shotsOnTarget: awaySOT, corners: awayCorners },
            },
          }
          queryClient.setQueryData(['espnScores'], { ...espnScoresCache })
          try { localStorage.setItem('espn_scores_cache', JSON.stringify(espnScoresCache)) } catch {}
        }
      } catch { /* silencieux */ }
    })(mid, cached.espnSlug, cached.espnEventId)
  }
}

// ─────────────────────────────────────────────
// api-football.com — couche de fallback
// ─────────────────────────────────────────────

function isInPollingWindow(match, trackedIds) {
  if (quotaRemaining < 5) return false

  const state   = getMatchState(match.id)
  const elapsed = (Date.now() - new Date(match.utcDate)) / 60000

  if (elapsed >= 0 && elapsed <= 90 && !state.kickoffAt) return true
  if (!trackedIds.has(String(match.id))) return false

  if (state.kickoffAt && !state.pausedAt) {
    const realElapsed = (Date.now() - state.kickoffAt) / 60000
    if (realElapsed >= 44 && realElapsed <= 55) return true
  }

  if (state.pausedAt && !state.half2Start) {
    const pause = (Date.now() - state.pausedAt) / 60000
    if (pause >= 13 && pause <= 30) return true
  }

  if (state.half2Start) {
    const half2 = (Date.now() - state.half2Start) / 60000
    if (half2 >= 44 && half2 <= 105) return true
  }

  return false
}

function findMatch(fixture, matches) {
  const apiHome = normalize(fixture.teams?.home?.name ?? '')
  const apiAway = normalize(fixture.teams?.away?.name ?? '')
  if (!apiHome || !apiAway) return null

  return matches.find(m => {
    const h = normalize(m.homeTeam?.name ?? m.homeTeam?.shortName ?? '')
    const a = normalize(m.awayTeam?.name ?? m.awayTeam?.shortName ?? '')
    return fuzzyTeam(h, apiHome) && fuzzyTeam(a, apiAway)
  }) ?? null
}

async function pollApiFootball(matches, queryClient) {
  try {
    const res = await fetch('/apifootball?live=all')
    if (!res.ok) {
      console.warn('[useLiveMinute] api-football réponse non-OK :', res.status)
      return
    }

    const remaining = res.headers.get('x-quota-remaining')
    if (remaining !== null) {
      quotaRemaining = parseInt(remaining, 10)
      if (quotaRemaining < 10) {
        console.warn(`[useLiveMinute] Quota api-football bas : ${quotaRemaining} req restantes`)
      }
    }

    const json     = await res.json()
    const fixtures = json.response ?? []
    let koDetected = false

    for (const fixture of fixtures) {
      const match = findMatch(fixture, matches)
      if (!match) continue

      const status     = fixture.fixture?.status?.short
      const apiElapsed = fixture.fixture?.status?.elapsed
      const state      = getMatchState(match.id)

      // Fenêtre 0 : KO détecté
      if (status === '1H') {
        if (!state.kickoffAt && apiElapsed != null) {
          setKickoffAt(match.id, Date.now() - apiElapsed * 60_000)
          setLiveState(match.id, 'live')
          markLive(match)
          koDetected = true
        }
      }

      // Fenêtre 1 : HT détecté
      if (status === 'HT' && !state.pausedAt) {
        trackMatchState({ ...match, status: 'PAUSED' })
      }

      // Fenêtre 2 : 2H détecté
      if (status === '2H') {
        if (apiElapsed != null && apiElapsed > 45 && apiElapsed < 90) {
          const half2Start = Date.now() - (apiElapsed - 46) * 60_000
          setHalf2Start(match.id, half2Start)
        } else if (!state.half2Start) {
          trackMatchState({ ...match, status: 'IN_PLAY' })
        }
      }

      // Fenêtre 3 : FT détecté
      if (status === 'FT' || status === 'AET' || status === 'PEN') {
        const ls = getLiveState(match.id)
        if (ls.state === 'ended') continue  // déjà géré
        if (!isTrackedLive(match.id)) continue

        const now = Date.now()
        setLiveState(match.id, 'ended', { endedAt: now })

        try {
          const currentState = getMatchState(match.id)
          localStorage.setItem(`foot_ms_${match.id}`, JSON.stringify({
            ...currentState,
            ft:        true,
            termineAt: now,
          }))
        } catch {}

        queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ['todayMatches'] }), 2_000)
        if (match.competition?.code) {
          try { localStorage.removeItem(`matches_${match.competition.code}_FINISHED`) } catch {}
        }

        const codeForEviction = match.competition?.code
        setTimeout(() => {
          markEnded(match.id)
          clearMatchState(match.id, { preserveEnded: true })
          queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
          if (codeForEviction) {
            queryClient.invalidateQueries({ queryKey: ['matches', codeForEviction, 'FINISHED'] })
            queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
          }
        }, 5 * 60_000)
      }
    }

    if (koDetected) {
      const liveState = queryClient.getQueryState(['liveMatches'])
      const liveAge   = Date.now() - (liveState?.dataUpdatedAt ?? 0)
      if (liveAge > 30_000) {
        queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
      }
    }
  } catch (err) {
    console.warn('[useLiveMinute] Erreur polling api-football :', err.message)
  }
}

// ─────────────────────────────────────────────
// Hook principal
// ─────────────────────────────────────────────

export function useLiveMinute(matches) {
  const queryClient  = useQueryClient()
  const matchesRef   = useRef(matches)
  matchesRef.current = matches

  // ── Seed immédiat depuis localStorage au montage ──
  // Évite le flash "stats vides" pendant le 1er poll réseau (~1-2s)
  useEffect(() => {
    if (Object.keys(espnScoresCache).length > 0) {
      queryClient.setQueryData(['espnScores'], { ...espnScoresCache })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── ESPN : Web Worker timer (non throttlé même en arrière-plan) ──
  useEffect(() => {
    const tick = () => pollESPN(matchesRef.current, queryClient)
    tick()

    let worker = null
    let fallbackId = null
    const lastTickAt = { t: Date.now() }

    try {
      worker = new EspnTimerWorker()
      worker.onmessage = () => { lastTickAt.t = Date.now(); tick() }
    } catch {
      fallbackId = setInterval(tick, 15_000)
    }

    // Watchdog : si le Worker se bloque, continuer depuis le main thread
    const watchdogId = setInterval(() => {
      if (Date.now() - lastTickAt.t > 10_000) tick()
    }, 10_000)

    return () => {
      worker?.terminate()
      if (fallbackId) clearInterval(fallbackId)
      clearInterval(watchdogId)
    }
  }, [queryClient])

  // ── api-football.com : intervalle 60s (fallback) ──
  const apiFbRef = useRef(null)
  useEffect(() => {
    const tick = async () => {
      const current    = matchesRef.current
      const trackedIds = getTrackedMatches()
      const needsPoll  = current.some(m => isInPollingWindow(m, trackedIds))
      if (needsPoll) {
        await pollApiFootball(current, queryClient)
      }
    }
    apiFbRef.current = tick
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [queryClient])

  // Poll api-football immédiat si un match passe IN_PLAY sans kickoffAt connu
  const knownInPlayRef = useRef(new Set())
  // Re-poll ESPN dès que matches[] se peuple (cold start PWA : premier poll était sur tableau vide)
  const prevMatchesLen = useRef(0)
  useEffect(() => {
    const newMatches = matches.filter(m =>
      (m.status === 'IN_PLAY' || m.status === 'PAUSED') &&
      !getMatchState(m.id).kickoffAt &&
      !knownInPlayRef.current.has(m.id)
    )
    newMatches.forEach(m => knownInPlayRef.current.add(m.id))
    if (newMatches.length > 0 && apiFbRef.current) {
      apiFbRef.current()
    }
    // Cold start : matches[] vient de se charger (0 → N) → re-poll ESPN immédiatement
    if (prevMatchesLen.current === 0 && matches.length > 0 && getLiveMatches().length > 0) {
      pollESPN(matches, queryClient)
    }
    prevMatchesLen.current = matches.length
  }, [matches, queryClient])

  // ── Cold start réseau pas prêt (iOS PWA) ──
  // Si le réseau est offline au montage du hook → attendre l'event 'online'
  // (iOS peut mettre 1-3s à établir la connexion après ouverture de la PWA)
  useEffect(() => {
    if (navigator.onLine) return
    const handler = () => pollESPN(matchesRef.current, queryClient)
    window.addEventListener('online', handler, { once: true })
    return () => window.removeEventListener('online', handler)
  }, [queryClient])

  // ── Repoll immédiat au retour sur l'app (PWA / Safari background) ──
  // iOS throttle les workers + timers en arrière-plan → score figé.
  // Dès que la page redevient visible, on force un poll ESPN immédiat
  // sans attendre le prochain tick (jusqu'à 15s de retard sinon).
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return
      // Poll immédiat
      await pollESPN(matchesRef.current, queryClient)
      // 2ème poll : si réseau pas encore disponible → attendre l'event 'online'
      // (plus précis qu'un timeout fixe — iOS fire 'online' exactement quand le réseau est prêt)
      if (!navigator.onLine) {
        window.addEventListener('online', () => pollESPN(matchesRef.current, queryClient), { once: true })
      } else {
        setTimeout(() => pollESPN(matchesRef.current, queryClient), 3_000)
      }
      const now = Date.now()
      // Invalider todayMatches si données > 2min
      const todayState = queryClient.getQueryState(['todayMatches'])
      if (now - (todayState?.dataUpdatedAt ?? 0) > 120_000) {
        queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
      }
      // Invalider TOUS les résultats FINISHED (toutes compétitions) si > 2min
      // (était hardcodé WC uniquement avant — fix pour Ligue 1, PL, etc.)
      queryClient.invalidateQueries({
        predicate: q =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === 'matches' &&
          q.queryKey[2] === 'FINISHED' &&
          (now - (q.state.dataUpdatedAt ?? 0)) > 120_000,
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [queryClient])

  // Recalibration manuelle
  const recalibrate = useRef(async () => {
    clearAllMatchStates()
    await Promise.all([
      pollESPN(matchesRef.current, queryClient),
      pollApiFootball(matchesRef.current, queryClient),
    ])
  })

  return { recalibrate: recalibrate.current }
}
