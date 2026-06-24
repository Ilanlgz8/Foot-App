// Suivi live en deux couches :
//
// ── PRIMAIRE : /api/fifa-live (Vercel function → ESPN + Redis cache) ──
//   • Fetch server-side : scoreboard ESPN mis en cache Redis 12s
//   • eventId → fdMatchId stocké Redis 6h → survit aux rechargements iOS
//   • Scorer preservation + stats summary côté serveur
//   • Données parsées retournées proprement : { [fdMatchId]: { home, away, scorers, stats, ... } }
//   • Si ESPN est down → Redis renvoie les dernières données connues
//   • Poll toutes les 15s dès qu'un match approche ou est en cours
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
import { markLive, markEnded, markPendingKickoff, isTrackedLive, getLiveMatches } from './liveTracker'
import { notifyKickoff, notifyHalfTime, notifyGoal, notifyFullTime } from '../utils/notify'
import { playGoalSound, playWhistleKO, playWhistleHT, playWhistleFT } from '../utils/sounds'

// Push côté client supprimé — le cron /api/cron/goals gère toutes les notifs
// (buts, KO, MT, reprise, prolongations, FT) pour éviter les doublons.

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
// Exporté pour useEspnMatchDetail
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
// Helpers communs (conservés pour api-football fallback)
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

  const code = match.competition?.code

  // À 2s : mise à jour immédiate Accueil (recent results) + page Résultats
  setTimeout(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    // Invalider React Query
    queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
    if (code) {
      queryClient.invalidateQueries({ queryKey: ['matches', code, 'FINISHED'] })
    }
    // Effacer les caches localStorage pour forcer un refetch propre
    try { localStorage.removeItem(`foot_matches_${todayStr}`) } catch {}
    if (code) {
      try { localStorage.removeItem(`foot_matches_${code}_FINISHED`) } catch {}
    }
  }, 2_000)

  // Éviction réelle après 5min (grace period : widget reste avec "Terminé")
  setTimeout(() => {
    markEnded(id)
    delete espnScoresCache[id]
    clearMatchState(id, { preserveEnded: true })
    queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
    queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
    if (code) {
      queryClient.invalidateQueries({ queryKey: ['matches', code, 'FINISHED'] })
    }
  }, 5 * 60_000)
}

// ─────────────────────────────────────────────
// Pending kickoff — affichage immédiat à l'heure prévue
// ─────────────────────────────────────────────

/**
 * Détecte les matchs SCHEDULED dont l'heure de KO est atteinte.
 * Appelle markPendingKickoff() → widget s'affiche avec "Débute".
 * Pré-seed espnScoresCache avec des 0 pour que les stats s'affichent dès le départ.
 * Dès qu'ESPN confirme STATUS_IN_PROGRESS, markLive() écrase l'entrée pending.
 */
function _checkPendingKickoffs(matches, queryClient) {
  const now = Date.now()
  let changed = false

  for (const match of matches) {
    // FD.org utilise 'TIMED' pour les matchs à venir (WC inclus), pas seulement 'SCHEDULED'
    if (match.status !== 'SCHEDULED' && match.status !== 'TIMED') continue
    if (isTrackedLive(match.id)) continue

    const slug = COMP_ESPN[match.competition?.id]
    if (!slug) continue // compétition non suivie → skip

    const utcMs = new Date(match.utcDate).getTime()
    // Fenêtre : entre l'heure prévue et +30min (sécurité si ESPN tarde ou match annulé)
    if (now < utcMs || now - utcMs > 30 * 60_000) continue

    markPendingKickoff(match)

    // Pré-seeder le cache à 0 si rien encore
    if (!espnScoresCache[match.id]) {
      espnScoresCache[match.id] = {
        home: 0, away: 0, scorers: [],
        stats: {
          home: { poss: 0, shots: 0, shotsOnTarget: 0, corners: 0 },
          away: { poss: 0, shots: 0, shotsOnTarget: 0, corners: 0 },
        },
      }
      changed = true
    }
  }

  if (changed) {
    queryClient.setQueryData(['espnScores'], { ...espnScoresCache })
    try { localStorage.setItem('espn_scores_cache', JSON.stringify(espnScoresCache)) } catch {}
  }
}

// ─────────────────────────────────────────────
// Safeguards FT — appelés avant le early return, même sans slugs à poller
// ─────────────────────────────────────────────
function _runFtSafeguards(matches, now, queryClient) {
  // Pool combiné : matches FD.org du jour + matchs stockés dans liveTracker
  const allLive = [...matches]
  for (const lm of getLiveMatches()) {
    if (!allLive.some(m => m.id === lm.id)) allLive.push(lm)
  }

  // Safeguard 1 : pendingFt timeout (45s)
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
  // ⚠️ FD.org réplique parfois les faux STATUS_FINAL de FIFA (ex: "FINISHED" à 72').
  //   Double garde : âge plausible (>= 85min) ET ESPN ne dit pas encore IN_PROGRESS.
  for (const lm of getLiveMatches()) {
    const mid = lm.id
    if (getLiveState(mid).state === 'ended') continue
    if (pendingFt[mid]) continue
    const fdMatch = allLive.find(m => m.id === mid)
    if (!fdMatch || fdMatch.status !== 'FINISHED') continue
    // Garde âge : ignorer si le match a moins de 85min (faux FT de transition FIFA/FD.org)
    const ageMin3 = (now - new Date(lm.utcDate)) / 60_000
    if (ageMin3 < 85) {
      console.log(`[useLiveMinute] Safeguard 3 ignoré — FD.org FINISHED mais ${Math.round(ageMin3)}min < 85 (faux FT ?)`)
      continue
    }
    // Garde ESPN : si ESPN confirme toujours que le match est en cours, on lui fait confiance
    const ms3 = getMatchState(mid)
    if (
      ms3.espnStatus === 'STATUS_IN_PROGRESS' ||
      ms3.espnStatus === 'STATUS_HALFTIME'    ||
      ms3.espnStatus === 'STATUS_END_PERIOD'
    ) {
      console.log(`[useLiveMinute] Safeguard 3 ignoré — FD.org FINISHED mais ESPN=${ms3.espnStatus} (priorité ESPN)`)
      continue
    }
    console.log(`[useLiveMinute] match ${mid} FINISHED (FD.org, ${Math.round(ageMin3)}min) → FT`)
    confirmFt(lm, now, queryClient)
  }

  // Safeguard 4 : match disparu du scoreboard ESPN depuis > 5min après avoir été vu
  for (const lm of getLiveMatches()) {
    const mid = lm.id
    if (getLiveState(mid).state === 'ended') continue
    if (pendingFt[mid]) continue
    const lastSeen = lastSeenInEspn[mid]
    if (!lastSeen) continue
    if (now - lastSeen < 5 * 60_000) continue
    const ageMin = (now - new Date(lm.utcDate)) / 60_000
    if (ageMin < 90) continue
    console.log(`[useLiveMinute] match ${mid} disparu d'ESPN depuis ${Math.round((now - lastSeen) / 60_000)}min → FT`)
    confirmFt(lm, now, queryClient)
  }
}

// ─────────────────────────────────────────────
// ESPN — couche primaire (via /api/fifa-live)
// ─────────────────────────────────────────────

async function pollESPN(matches, queryClient) {
  const now = Date.now()

  // ── Pending kickoff : afficher le widget dès l'heure prévue ──
  _checkPendingKickoffs(matches, queryClient)

  // Étendre matches avec les matchs persistés dans liveTracker
  // → fix cold start PWA : matches[] vide pendant 1-2s au chargement
  const allMatches = [...matches]
  for (const lm of getLiveMatches()) {
    if (!allMatches.some(m => m.id === lm.id)) allMatches.push(lm)
  }

  // Filtrer les matchs dans la fenêtre de poll (0min → +150min).
  // Exception WC (FIFA, compId=2000) : on commence 60min avant le KO pour récupérer
  // les IDs FIFA (IdCompetition/Season/Stage) en cache Redis avant le coup d'envoi.
  // Cela permet d'afficher les compos dès que FIFA les publie (~1h avant).
  // ⚠️ Sûr : fifaToEspnStatus() retourne STATUS_SCHEDULED pour Period=0 → pas de faux KO.
  const toTrack = allMatches.filter(m => {
    const elapsed   = (now - new Date(m.utcDate)) / 60_000
    const preBuffer = m.competition?.id === 2000 ? -60 : 0   // WC : poll 60min avant
    return (elapsed >= preBuffer && elapsed <= 150) || isTrackedLive(m.id)
  })

  if (toTrack.length === 0) {
    _runFtSafeguards(allMatches, now, queryClient)
    return
  }

  try {
    // ── Appel au nouvel endpoint server-side ──
    // Fetch ESPN + Redis cache + matching + stats → retourne { [fdMatchId]: { ... } }
    const res = await fetch('/api/fifa-live', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ matches: toTrack }),
    })

    if (!res.ok) {
      espnFailStreak++
      if (espnFailStreak >= 3) setEspnWorking(false)
      _runFtSafeguards(allMatches, now, queryClient)
      return
    }

    espnFailStreak = 0
    setEspnWorking(true)
    try { localStorage.setItem('foot_espn_last_poll', String(Date.now())) } catch {}

    // liveData = { [fdMatchId]: { espnEventId, espnSlug, espnStatus, espnClock, espnPeriod, home, away, scorers, stats, fromCache? } }
    const liveData = await res.json()

    for (const [midStr, data] of Object.entries(liveData)) {
      const mid   = Number(midStr)
      const match = allMatches.find(m => m.id === mid)
      if (!match) continue

      const { espnStatus, espnClock, espnPeriod, home, away, scorers, stats, fromCache } = data

      // Mémoriser que ce match est visible dans le scoreboard ESPN (sauf si fromCache)
      if (!fromCache) lastSeenInEspn[mid] = now

      const prevState = getMatchState(mid)
      const matchAge  = (now - new Date(match.utcDate)) / 60_000

      // ── Correction statuts FIFA implausibles ─────────────────────────────────
      // FIFA retourne parfois STATUS_EXTRA_TIME/OVERTIME lors de transitions normales
      // (halftime, début 2e MT) — même bug que le faux STATUS_FINAL à la 21e min.
      // Condition : clock < 90' ET matchAge < 90min → impossible d'être en prolongations.
      let safeStatus = espnStatus
      let safePeriod = espnPeriod ?? null
      if (safeStatus === 'STATUS_EXTRA_TIME' || safeStatus === 'STATUS_OVERTIME') {
        const clockMins = parseClockMins(espnClock)
        const etImplausible = (clockMins === null || clockMins < 90) && matchAge < 90
        if (etImplausible) {
          safeStatus = 'STATUS_IN_PROGRESS'
          // Période estimée depuis matchAge (1re MT si < 50min depuis utcDate, 2e MT sinon)
          safePeriod = matchAge < 50 ? 1 : 2
        }
      }

      // Toujours écrire les données ESPN (pour calcMinute + interpolation)
      setEspnData(mid, { espnClock, espnStatus: safeStatus, espnPeriod: safePeriod })

      // ════════════════════════════════════════════════════════════════════
      // CAS 1 : Match EN COURS — utilise safeStatus (statuts corrigés inclus)
      // ════════════════════════════════════════════════════════════════════
      if (
        safeStatus === 'STATUS_IN_PROGRESS' ||
        safeStatus === 'STATUS_HALFTIME'    ||
        safeStatus === 'STATUS_END_PERIOD'  ||
        safeStatus === 'STATUS_EXTRA_TIME'  ||
        safeStatus === 'STATUS_OVERTIME'    ||
        safeStatus === 'STATUS_SHOOTOUT'
      ) {
        if (getLiveState(mid).state !== 'live') setLiveState(mid, 'live')
        delete pendingFt[mid]
        clearFtFlags(mid)
        markLive(match)

        const prevCache = espnScoresCache[mid]
        const prevTotal = (prevCache?.home ?? -1) + (prevCache?.away ?? -1)
        const newTotal  = home + away

        // Détection but : score total augmente
        if (prevCache && newTotal > prevTotal) {
          notifyGoal(match, home, away, scorers)
          playGoalSound()
        }

        espnScoresCache[mid] = {
          home,
          away,
          scorers:     scorers ?? prevCache?.scorers ?? [],
          stats:       stats   ?? prevCache?.stats   ?? null,
          espnEventId: data.espnEventId,
          espnSlug:    data.espnSlug,
        }
      }

      // ── KO détecté (1ère MT, kickoffAt pas encore connu) ──
      if (
        safeStatus === 'STATUS_IN_PROGRESS' &&
        (safePeriod ?? 1) === 1 &&
        !prevState.kickoffAt
      ) {
        const mins = parseClockMins(espnClock)
        if (mins != null && mins > 0) setKickoffAt(mid, now - mins * 60_000)
        notifyKickoff(match)
        // Ne siffler que si on détecte le KO dans les 5 premières minutes
        // (évite le sifflet intempestif si on détecte un match déjà en cours)
        const minsFromKickoff = (now - new Date(match.utcDate)) / 60_000
        if (minsFromKickoff <= 5) playWhistleKO()
      }

      // ── HT détecté ──
      if (espnStatus === 'STATUS_HALFTIME' && !prevState.pausedAt) {
        trackMatchState({ ...match, status: 'PAUSED' })
        const cache = espnScoresCache[mid]
        notifyHalfTime(match, cache?.home ?? 0, cache?.away ?? 0)
        playWhistleHT()
      }

      // ── 2H détecté ──
      if (
        safeStatus === 'STATUS_IN_PROGRESS' &&
        (safePeriod ?? 1) === 2 &&
        prevState.pausedAt &&
        !prevState.half2Start
      ) {
        const mins = parseClockMins(espnClock)
        // mins - 46 : la 2ème MT commence à 46', donc half2Start = now - (mins-46)min en arrière
        // (mins-45 donnait un décalage systématique de +1')
        if (mins != null) setHalf2Start(mid, now - Math.max(0, mins - 46) * 60_000)
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
        if (!isTrackedLive(mid)) continue
        if (getLiveState(mid).state === 'ended') continue

        const prevCache = espnScoresCache[mid]
        const prevStats = prevCache?.stats ?? null

        // Toujours mettre à jour le score (le but est peut-être dans ce poll)
        espnScoresCache[mid] = {
          ...(prevCache ?? {}),
          home,
          away,
          scorers:     scorers ?? prevCache?.scorers ?? [],
          stats:       stats   ?? prevStats,
          espnEventId: data.espnEventId,
          espnSlug:    data.espnSlug,
        }

        if (espnStatus === 'STATUS_POSTPONED' || espnStatus === 'STATUS_CANCELED') {
          setLiveState(mid, 'ended', { endedAt: now })
          setTimeout(() => { markEnded(mid); clearMatchState(mid) }, 5 * 60_000)
          continue
        }

        // DÉTECTION FT : horloge >= 85min OU match vieux de >= 85min depuis le KO prévu.
        // Source FIFA : MatchTime='FT' → fifaToClock renvoie '' → mins=null.
        //   Dans ce cas, on se rabat sur l'âge du match (utcDate + 85min).
        // ⚠️ isFifaSource ne lève PAS le garde à lui seul : FIFA peut retourner
        //   MatchStatus=3/Period=8 lors d'une transition (but, VAR) même à la 21ème min.
        const mins = parseClockMins(espnClock)
        // matchAge déjà calculé en haut du bloc (réutilisé ici)
        // timePlausible : horloge >= 85min OU match vieux >= 85min depuis le KO prévu
        // ⚠️ ne pas bypass avec isFifaSource seul : FIFA peut retourner Status=3/Period=8
        //    lors de transitions (but, VAR) même à la 21ème min → faux FT.
        const timePlausible = (mins !== null && mins >= 85) || matchAge >= 85

        if (!timePlausible) {
          delete pendingFt[mid]
          markLive(match)
          clearFtFlags(mid)
          // Override espnStatus → STATUS_IN_PROGRESS pour que calcMinute ne retourne
          // pas null (STATUS_FINAL → null). Si espnClock est vide, on dérive depuis utcDate.
          const ftMins = espnClock ? parseClockMins(espnClock) : null
          const safeClock = ftMins != null && ftMins > 0
            ? espnClock
            : `${Math.max(1, Math.floor((now - new Date(match.utcDate)) / 60_000))}:00`
          // Corriger aussi espnPeriod : espnPeriod peut valoir 3 si FIFA envoie Period=4
          // (faux STATUS_EXTRA_TIME) en même temps que Status=3 (faux FT) → "Prolongations".
          // Estimation depuis matchAge : < 50min = 1ère MT, ≥ 50min = 2ème MT.
          const implausiblePeriod = matchAge < 50 ? 1 : 2
          setEspnData(mid, { espnClock: safeClock, espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: implausiblePeriod })
          // Initialiser kickoffAt si absent (effacé après clearMatchState post-FT)
          const safeMins = parseClockMins(safeClock)
          if (safeMins) setKickoffAt(mid, now - safeMins * 60_000)
          continue
        }

        const prevScore    = prevCache ? `${prevCache.home}-${prevCache.away}` : null
        const currentScore = `${home}-${away}`

        if (prevScore !== null && prevScore !== currentScore) {
          // But tardif dans le même poll → rester live
          delete pendingFt[mid]
          markLive(match)
          clearFtFlags(mid)
          continue
        }

        // STATUS_FINAL + score inchangé + horloge >= 85 → FT confirmé
        delete pendingFt[mid]
        confirmFt(match, now, queryClient)
        playWhistleFT()
      }

      // ── FALLBACK J-1 : STATUS_SCHEDULED mais FD.org sait que c'est live ──
      if (
        espnStatus === 'STATUS_SCHEDULED' &&
        (match.status === 'IN_PLAY' || match.status === 'PAUSED' || isTrackedLive(mid))
      ) {
        if (!espnScoresCache[mid]) {
          espnScoresCache[mid] = { home: null, away: null, scorers: [], stats: null }
        }
        if (!espnScoresCache[mid].espnEventId) {
          espnScoresCache[mid] = {
            ...espnScoresCache[mid],
            espnEventId: data.espnEventId,
            espnSlug:    data.espnSlug,
          }
        }
        // FD.org confirme IN_PLAY mais FIFA/ESPN retourne encore SCHEDULED
        // (lag FIFA ou fuzzy-match partiel) → marquer comme live quand même
        if (match.status === 'IN_PLAY' || match.status === 'PAUSED') {
          markLive(match)
        }
      }
    }

    // ── FD.org fallback global : match IN_PLAY selon FD.org mais absent de liveData ──
    // Peut arriver si fuzzy-match FIFA échoue côté serveur ou si FIFA API lag.
    // isEspnWorking()=true bloque useLiveMatches → ce fallback prend le relais.
    for (const match of toTrack) {
      const mid = match.id
      if (match.status !== 'IN_PLAY' && match.status !== 'PAUSED') continue
      if (isTrackedLive(mid)) continue          // déjà suivi → ok
      if (getLiveState(mid).state === 'ended') continue
      // Initialiser avec le score FD.org si disponible (visible dans le panel)
      if (!espnScoresCache[mid]) {
        espnScoresCache[mid] = {
          home:    match.score?.fullTime?.home ?? null,
          away:    match.score?.fullTime?.away ?? null,
          scorers: [],
          stats:   null,
        }
      }
      console.log(`[useLiveMinute] FD.org fallback → markLive match ${mid} (${match.homeTeam?.name} vs ${match.awayTeam?.name})`)
      markLive(match)
    }
  } catch (err) {
    console.warn('[useLiveMinute] /api/fifa-live erreur :', err.message)
    espnFailStreak++
    if (espnFailStreak >= 3) setEspnWorking(false)
  }

  // Safeguards après traitement ESPN
  _runFtSafeguards(allMatches, now, queryClient)

  // Pousser les scores dans React Query
  queryClient.setQueryData(['espnScores'], { ...espnScoresCache })
  try { localStorage.setItem('espn_scores_cache', JSON.stringify(espnScoresCache)) } catch {}
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
    // (même sans live en cours — pour détecter les pending kickoffs au bon moment)
    if (prevMatchesLen.current === 0 && matches.length > 0) {
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
