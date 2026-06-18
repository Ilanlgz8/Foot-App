// Suivi live en deux couches :
//
// ── PRIMAIRE : ESPN (site.api.espn.com via /espn) ──
//   • Pas de quota, pas de clé API
//   • Poll toutes les 15s dès qu'un match approche ou est en cours
//   • Lit displayClock ("42:00") et status.type.name ("STATUS_HALFTIME", etc.)
//   • Écrit espnClock + espnStatus → calcMinute utilise ces données en priorité
//   • Détecte aussi KO, HT, 2H, FT → écrit kickoffAt / pausedAt / half2Start
//   • Extrait scores + buteurs + stats → pousse dans React Query ['espnScores']
//     → useEspnScores ne fait PLUS de fetch ESPN séparé (0 doublon réseau)
//
// ── FALLBACK : api-football.com (/apifootball?live=all) ──
//   • Poll toutes les 60s, UNIQUEMENT dans les 4 fenêtres critiques
//   • Fenêtre 0 : de l'heure de KO jusqu'à kickoffAt écrit (cap 90min)
//   • Fenêtre 1 : de 44min réelles jusqu'à pausedAt écrit (cap 55min)
//   • Fenêtre 2 : après 13min de pause jusqu'à half2Start écrit (cap 30min)
//   • Fenêtre 3 : de 44min de 2ème MT jusqu'à FT (cap 105min)
//   • Zéro dépendance sur match.status (football-data.org trop lent)
//   • ~20 req/match max → ~3 matchs trackables sur quota 100 req/jour
//
// Si ESPN fonctionne, les fenêtres api-football ne s'ouvrent jamais
// (kickoffAt / pausedAt / half2Start sont déjà écrits → conditions non vérifiées).

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import EspnTimerWorker from '../workers/espnTimerWorker.js?worker'
import {
  getMatchState, trackMatchState, clearMatchState,
  getTrackedMatches, setKickoffAt, setHalf2Start,
  clearAllMatchStates, setEspnData,
  setEspnWorking,
} from '../utils/matchStateTracker'
import { injectLiveMatch, evictLiveMatch, isStickyLive } from './useLiveMatches'

// ─────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────

let quotaRemaining  = Infinity
let espnFailStreak  = 0   // nb d'appels ESPN consécutifs sans succès → down après 3

// Éviction différée : marque un match comme "FT pressenti" sur le 1er poll FINAL.
// Éviction réelle seulement sur le 2ème poll consécutif FINAL → évite les faux positifs
// ESPN (glitch où STATUS_FINAL apparaît brièvement puis redevient IN_PROGRESS).
const pendingEviction = {}  // { [matchId]: true }

// Matchs définitivement terminés ce chargement de page.
// Empêche toute ré-injection dans stickyLive si ESPN glitche post-FT.
const evictedToday = new Set()

// Cache module-level des scores ESPN (scores + buteurs + stats).
// Mis à jour à chaque poll ESPN (15s) puis poussé dans React Query ['espnScores']
// via setQueryData → useEspnScores lit ce cache sans faire de requête supplémentaire.
const espnScoresCache = {}  // { [matchId]: { home, away, scorers, stats } }

// Restauration partielle au chargement : uniquement si ESPN a pollé récemment (<5min)
// Évite de charger des scores d'hier dans le cache React Query.
try {
  const lastPoll = parseInt(localStorage.getItem('foot_espn_last_poll') ?? '0', 10)
  if (Date.now() - lastPoll < 5 * 60_000) {
    const raw = localStorage.getItem('espn_scores_cache')
    if (raw) Object.assign(espnScoresCache, JSON.parse(raw))
  }
} catch {}

// football-data.org competition ID → slug ESPN
export const COMP_ESPN = {
  2015: 'fra.1',          // Ligue 1
  2021: 'eng.1',          // Premier League
  2014: 'esp.1',          // La Liga
  2002: 'ger.1',          // Bundesliga
  2019: 'ita.1',          // Serie A
  2001: 'uefa.champions', // Champions League
  2146: 'uefa.europa',    // Europa League
  2048: 'uefa.europa.conf', // Conference League
  2000: 'fifa.world',     // Coupe du Monde
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

  // Test 1 : préfixe commun sur 5 caractères (couvre 95% des cas)
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true

  // Test 2 : mot significatif en commun (≥4 lettres) — couvre les cas où les deux APIs
  // ont des noms qui divergent en préfixe mais partagent un mot-clé commun.
  // Exemples : "Inter Milan" ↔ "FC Internazionale Milano"  (inter ↔ internazionale)
  //            "Atlético de Madrid" ↔ "Club Atlético de Madrid"  (atletico ↔ atletico)
  const wordsA = na.split(/\s+/).filter(w => w.length >= 4)
  const wordsB = nb.split(/\s+/).filter(w => w.length >= 4)
  return wordsA.some(wa =>
    wordsB.some(wb => wa.startsWith(wb.slice(0, 4)) || wb.startsWith(wa.slice(0, 4)))
  )
}

/**
 * Convertit un displayClock ESPN ("42:00", "45:00+2:00") en minutes entières.
 * Retourne null si non parseable.
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
// ESPN — couche primaire
// ─────────────────────────────────────────────

/**
 * Retrouve le match football-data.org correspondant à un event ESPN
 * (matching par noms d'équipes normalisés).
 */
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

async function pollESPN(matches, queryClient) {
  const now = Date.now()

  // Collecter les slugs uniques des matchs proches ou en cours (−5min → +130min)
  const slugSet = new Set()
  for (const m of matches) {
    const elapsed = (now - new Date(m.utcDate)) / 60000
    if (elapsed >= -5 && elapsed <= 150) { // 150min : couvre prolongations + tirs au but (WC)
      const slug = COMP_ESPN[m.competition?.id]
      if (slug) slugSet.add(slug)
    }
  }
  if (slugSet.size === 0) return

  for (const slug of slugSet) {
    try {
      const res = await fetch(`/espn?slug=${slug}`)
      if (!res.ok) {
        espnFailStreak++
        if (espnFailStreak >= 3) setEspnWorking(false)
        continue
      }
      // ESPN répond → réinitialiser le compteur d'échecs + mettre à jour le timestamp
      espnFailStreak = 0
      setEspnWorking(true)
      try { localStorage.setItem('foot_espn_last_poll', String(Date.now())) } catch {}
      const json = await res.json()

      for (const evt of json.events ?? []) {
        const comp = evt.competitions?.[0]
        if (!comp) continue

        const st         = comp.status
        const espnStatus = st?.type?.name   // STATUS_IN_PROGRESS, STATUS_HALFTIME, STATUS_FINAL…
        const espnClock  = st?.displayClock // "42:00" | "45:00+2:00"
        if (!espnStatus) continue

        const match = findMatchESPN(comp.competitors ?? [], matches)
        if (!match) continue

        const prevState = getMatchState(match.id)

        // Toujours mettre à jour les données ESPN (pour calcMinute)
        setEspnData(match.id, { espnClock, espnStatus })

        // ── Match en cours ou MT — stickyLive + scores + buteurs + stats ──────
        // injectLiveMatch appelé à CHAQUE poll (15s) → rafraîchit seenAt, évite TTL.
        // Score/buteurs/stats extraits ici (même boucle, même requête) → plus besoin
        // d'un poll useEspnScores séparé. Données poussées dans ['espnScores'] en fin
        // de fonction via setQueryData.
        if (
          espnStatus === 'STATUS_IN_PROGRESS' ||
          espnStatus === 'STATUS_HALFTIME'    ||
          espnStatus === 'STATUS_END_PERIOD'  || // fin de période (bref, entre 1MT et MT)
          espnStatus === 'STATUS_EXTRA_TIME'  || // prolongations (WC knockout)
          espnStatus === 'STATUS_OVERTIME'       // variante ESPN pour prolongations
        ) {
          // Match déjà définitivement terminé → ESPN glitch post-FT, ignorer
          if (evictedToday.has(match.id)) continue

          // Annuler une éviction différée si le match est de nouveau en cours
          delete pendingEviction[match.id]

          const alreadyLive = isStickyLive(match.id)
          injectLiveMatch(match)
          // (1) Première détection OU re-détection après éviction → invalider immédiatement
          //     (pas de garde 30s : on veut que le widget réapparaisse en ≤15s, pas en 60s)
          // (2) Match déjà dans stickyLive mais absent de queryData → invalider si données > 30s
          if (!alreadyLive) {
            queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
          } else {
            const currentLive = queryClient.getQueryData(['liveMatches']) ?? []
            const inLiveData  = currentLive.some(m => m.id === match.id)
            if (!inLiveData) {
              const liveState = queryClient.getQueryState(['liveMatches'])
              const liveAge   = Date.now() - (liveState?.dataUpdatedAt ?? 0)
              if (liveAge > 30_000) {
                queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
              }
            }
          }

          // Scores + buteurs + stats
          const homeC = (comp.competitors ?? []).find(c => c.homeAway === 'home')
          const awayC = (comp.competitors ?? []).find(c => c.homeAway === 'away')
          if (homeC && awayC) {
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
            const getStat = (c, name) => {
              const found = (c.statistics ?? []).find(stat => stat.name === name)
              return found != null ? (parseFloat(found.displayValue) || 0) : null
            }
            const homePoss = getStat(homeC, 'possessionPct')
            const awayPoss = getStat(awayC, 'possessionPct')
            espnScoresCache[match.id] = {
              home:    parseInt(homeC.score ?? '0', 10),
              away:    parseInt(awayC.score ?? '0', 10),
              scorers,
              stats: (homePoss !== null || awayPoss !== null) ? {
                home: { poss: homePoss, shots: getStat(homeC, 'totalShots'), corners: getStat(homeC, 'corners') },
                away: { poss: awayPoss, shots: getStat(awayC, 'totalShots'), corners: getStat(awayC, 'corners') },
              } : null,
            }
          }
        }

        // ── KO détecté (1ère MT, kickoffAt pas encore connu) ──
        if (
          espnStatus === 'STATUS_IN_PROGRESS' &&
          (st.period ?? 1) === 1 &&
          !prevState.kickoffAt
        ) {
          const mins = parseClockMins(espnClock)
          if (mins != null && mins > 0) {
            setKickoffAt(match.id, now - mins * 60_000)
          }
        }

        // ── HT détecté ──
        if (espnStatus === 'STATUS_HALFTIME' && !prevState.pausedAt) {
          trackMatchState({ ...match, status: 'PAUSED' })
        }

        // ── 2H détecté (reprise après MT) ──
        if (
          espnStatus === 'STATUS_IN_PROGRESS' &&
          (st.period ?? 1) === 2 &&
          prevState.pausedAt &&
          !prevState.half2Start
        ) {
          const mins = parseClockMins(espnClock) // minute globale ex. "46" ou "47"
          if (mins != null) {
            // La 2ème MT démarre à la 46ème minute globale.
            // half2Start = timestamp estimé du début de la 2ème MT
            const half2Start = now - Math.max(0, mins - 45) * 60_000
            setHalf2Start(match.id, half2Start)
          }
        }

        // ── FT détecté ──
        if (
          espnStatus === 'STATUS_FINAL' ||
          espnStatus === 'STATUS_FULL_TIME' ||
          espnStatus === 'STATUS_POSTPONED' ||
          espnStatus === 'STATUS_CANCELED'
        ) {
          // Guard : match déjà confirmé FT → ignorer les polls suivants pendant la grâce.
          // Sans ça, chaque poll FINAL relancerait le pendingEviction et tenterait une éviction.
          if (evictedToday.has(match.id)) continue

          // Guard : n'invalider que si le match était réellement suivi comme live.
          // Sans ça, ESPN retourne les matchs FINAL indéfiniment → 3 invalidateQueries
          // à chaque tick de setInterval (toutes les 30s) pour chaque match terminé.
          const wasLive = isStickyLive(match.id)
          if (!wasLive) continue  // jamais suivi comme live, rien à faire

          // Guard de plausibilité : ESPN flashe STATUS_FINAL lors des buts ou transitions
          // de période (changement de score, coup de sifflet mi-temps, etc.).
          // Si l'horloge affiche moins de 85 minutes, c'est forcément un faux positif —
          // un vrai FT ne peut pas arriver avant la 85ème minute.
          // On annule aussi tout pendingEviction en cours pour ce match.
          if (
            espnStatus === 'STATUS_FINAL' ||
            espnStatus === 'STATUS_FULL_TIME'
          ) {
            const mins = parseClockMins(espnClock)
            if (mins !== null && mins < 85) {
              delete pendingEviction[match.id]  // annuler si un cycle avait démarré
              continue  // glitch → ignorer complètement
            }
          }

          // Éviction différée : 1er poll FINAL → marquer en attente, PAS d'éviction immédiate.
          // ESPN peut glitcher brièvement en STATUS_FINAL alors que le match continue.
          // Si le match redevient IN_PROGRESS au prochain poll, pendingEviction est annulé (cf. ci-dessus).
          if (!pendingEviction[match.id]) {
            pendingEviction[match.id] = true
            // Mettre à jour le score même pendant la phase d'attente.
            // Sans ça, si un but est marqué exactement quand ESPN flashe FINAL,
            // le bloc IN_PROGRESS est sauté → espnScoresCache reste figé au score pré-but.
            // On extrait home/away + buteurs ici pour que le score soit correct si
            // le FINAL se confirme ou si on affiche "Terminé" lors du 2ème poll.
            const homeC = (comp.competitors ?? []).find(c => c.homeAway === 'home')
            const awayC = (comp.competitors ?? []).find(c => c.homeAway === 'away')
            if (homeC && awayC) {
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
              espnScoresCache[match.id] = {
                ...(espnScoresCache[match.id] ?? {}),
                home:    parseInt(homeC.score ?? '0', 10),
                away:    parseInt(awayC.score ?? '0', 10),
                scorers,
              }
            }
            continue  // attendre la confirmation au prochain poll (15s)
          }

          // 2ème poll consécutif FINAL → FT présumé
          // Avant d'évincer, cross-check avec api-football.com pour éviter les faux positifs
          // ESPN persistants (≥ 30s) que le guard clock < 85min n'a pas bloqués.
          // Si api-football dit que le match est encore en cours → faux positif → ne pas évincer.
          // Si api-football ne trouve pas le match ou confirme FT → évincer normalement.
          delete pendingEviction[match.id]

          if (quotaRemaining >= 5) {
            let apiStillLive = false
            try {
              const cfRes = await fetch('/apifootball?live=all')
              if (cfRes.ok) {
                const cfJson = await cfRes.json()
                const rem = cfRes.headers.get('x-quota-remaining')
                if (rem !== null) quotaRemaining = parseInt(rem, 10)

                const fdHome = normalize(match.homeTeam?.name ?? match.homeTeam?.shortName ?? '')
                const fdAway = normalize(match.awayTeam?.name ?? match.awayTeam?.shortName ?? '')
                const cfFixture = (cfJson.response ?? []).find(f => {
                  const apiHome = normalize(f.teams?.home?.name ?? '')
                  const apiAway = normalize(f.teams?.away?.name ?? '')
                  return fuzzyTeam(fdHome, apiHome) && fuzzyTeam(fdAway, apiAway)
                })
                if (cfFixture) {
                  // Match trouvé dans api-football live → vérifier son statut
                  const cfStatus = cfFixture.fixture?.status?.short
                  // Ces statuts indiquent que le match est encore en cours
                  apiStillLive = ['1H', 'HT', '2H', 'ET', 'BT', 'P'].includes(cfStatus)
                }
              }
            } catch (err) {
              console.warn('[useLiveMinute] Cross-check api-football échoué :', err.message)
            }

            if (apiStillLive) {
              // api-football confirme que le match est encore en cours → faux positif ESPN
              // pendingEviction est réinitialisé → un nouveau cycle peut démarrer si ESPN repersiste FINAL
              console.warn(`[useLiveMinute] Faux FT ESPN ignoré (api-football = en cours) : ${match.id}`)
              continue
            }
          }

          // Cross-check passé (ou quota insuffisant) → éviction réelle
          evictedToday.add(match.id)

          // Persister les scores ESPN avant la fenêtre de grâce → utilisés par MatchModal
          // après la fin du match (buteurs, stats) sans requête FD.org supplémentaire.
          if (espnScoresCache[match.id]) {
            try {
              localStorage.setItem(
                `foot_espn_${match.id}`,
                JSON.stringify(espnScoresCache[match.id])
              )
            } catch {}
          }

          // Écrire { ft: true, termineAt } :
          // • ft bloque calcMinute (plus de compteur qui tourne)
          // • termineAt pour traçabilité / éventuel affichage côté composant
          // L'éviction réelle (stickyLive.delete) se fait dans 5min → le widget reste
          // affiché avec "Terminé" + stats pendant cette fenêtre de grâce.
          try {
            localStorage.setItem(
              `foot_ms_${match.id}`,
              JSON.stringify({ ft: true, termineAt: Date.now() })
            )
          } catch {}

          // Rafraîchir immédiatement → MatchCard passe en mode "Terminé"
          queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
          // Invalider todayMatches + résultats pour afficher le score final dans les listes
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ['todayMatches'] }), 2_000)
          if (match.competition?.code) {
            const code = match.competition.code
            setTimeout(() => queryClient.invalidateQueries({ queryKey: ['matches', code, 'FINISHED'] }), 4_000)
          }

          // Éviction réelle après 5min → le widget disparaît
          setTimeout(() => {
            evictLiveMatch(match.id)
            delete espnScoresCache[match.id]
            try { localStorage.removeItem('liveMatches_v1') } catch {}
            clearMatchState(match.id)
            queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
          }, 5 * 60_000)
        }
      }
    } catch (err) {
      console.warn('[useLiveMinute] ESPN erreur pour slug', slug, ':', err.message)
    }
  }

  // Pousser les scores dans React Query → useEspnScores réactif sans fetch séparé
  queryClient.setQueryData(['espnScores'], { ...espnScoresCache })
  // Persister pour survivre au rechargement de page
  try { localStorage.setItem('espn_scores_cache', JSON.stringify(espnScoresCache)) } catch {}
}

// ─────────────────────────────────────────────
// api-football.com — couche de fallback
// ─────────────────────────────────────────────

/**
 * Détermine si un match est dans l'une des 4 fenêtres de polling api-football.
 * Aucune dépendance sur match.status (football-data.org trop lent à mettre à jour).
 * Les fenêtres se ferment automatiquement dès que ESPN (ou api-football lui-même)
 * a écrit kickoffAt / pausedAt / half2Start.
 */
function isInPollingWindow(match, trackedIds) {
  if (quotaRemaining < 5) return false

  const state   = getMatchState(match.id)
  const elapsed = (Date.now() - new Date(match.utcDate)) / 60000

  // Fenêtre 0 : de l'heure de KO jusqu'à kickoffAt écrit (cap 90min)
  // Ouverte même sans tracking — détecte le coup d'envoi pour tous les matchs.
  if (elapsed >= 0 && elapsed <= 90 && !state.kickoffAt) return true

  // Les fenêtres 1-3 requièrent un tracking explicite (bouton dans l'UI)
  if (!trackedIds.has(String(match.id))) return false

  // Fenêtre 1 : de 44min réelles jusqu'à pausedAt écrit (cap 55min pour temps additionnel)
  if (state.kickoffAt && !state.pausedAt) {
    const realElapsed = (Date.now() - state.kickoffAt) / 60000
    if (realElapsed >= 44 && realElapsed <= 55) return true
  }

  // Fenêtre 2 : après 13min de pause, jusqu'à half2Start écrit (cap 30min)
  if (state.pausedAt && !state.half2Start) {
    const pause = (Date.now() - state.pausedAt) / 60000
    if (pause >= 13 && pause <= 30) return true
  }

  // Fenêtre 3 : de 44min de 2ème MT jusqu'à FT (cap 105min pour temps additionnel)
  if (state.half2Start) {
    const half2 = (Date.now() - state.half2Start) / 60000
    if (half2 >= 44 && half2 <= 105) return true
  }

  return false
}

/** Matching api-football.com → football-data.org par noms d'équipes. */
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

      // Fenêtre 0 : KO détecté — stocker le timestamp exact + afficher le LiveWidget
      if (status === '1H') {
        if (!state.kickoffAt && apiElapsed != null) {
          setKickoffAt(match.id, Date.now() - apiElapsed * 60_000)
          injectLiveMatch(match)  // fallback ESPN down : même effet qu'ESPN
          koDetected = true
        }
      }

      // Fenêtre 1 : HT détecté
      if (status === 'HT' && !state.pausedAt) {
        trackMatchState({ ...match, status: 'PAUSED' })
      }

      // Fenêtre 2 : 2H détecté — enregistre/corrige half2Start
      // Guard elapsed < 90 : api-football cap à 90 pendant temps additionnel
      // → ne pas bloquer la minute à 45' en 2ème MT prolongée
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
        if (evictedToday.has(match.id)) continue  // déjà géré (ESPN l'a peut-être confirmé avant)
        const wasLive = isStickyLive(match.id)
        if (!wasLive) continue  // pas notre match
        evictedToday.add(match.id)

        // flag ft + termineAt : stoppe calcMinute, MatchCard passe en mode "Terminé"
        try { localStorage.setItem(`foot_ms_${match.id}`, JSON.stringify({ ft: true, termineAt: Date.now() })) } catch {}

        // Rafraîchir immédiatement → widget affiche "Terminé"
        queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ['todayMatches'] }), 2_000)
        if (match.competition?.code) {
          const code = match.competition.code
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ['matches', code, 'FINISHED'] }), 4_000)
        }

        // Éviction réelle après 5min → widget disparaît
        setTimeout(() => {
          evictLiveMatch(match.id)
          try { localStorage.removeItem('liveMatches_v1') } catch {}
          clearMatchState(match.id)
          queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
        }, 5 * 60_000)
      }
    }

    if (koDetected) {
      // Freshness check : évite de re-déclencher un fetch si liveMatches vient d'être mis à jour
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

/**
 * À appeler dans Accueil avec TOUS les matchs du jour.
 * Lance deux intervalles indépendants :
 *  • ESPN  : toutes les 20s (primaire, pas de quota)
 *  • api-football.com : toutes les 60s (fallback, fenêtres seulement)
 *
 * @param {Array} matches — tous les matchs du jour depuis useTodayMatches
 */
export function useLiveMinute(matches) {
  const queryClient  = useQueryClient()
  const matchesRef   = useRef(matches)
  matchesRef.current = matches

  // ── ESPN : Web Worker timer (non throttlé même en arrière-plan) ──
  // Les navigateurs limitent setInterval à ~1min sur le main thread pour les onglets
  // inactifs. Un Worker tourne dans un thread séparé sans cette restriction.
  // Le Worker envoie un 'tick' toutes les 15s → on exécute pollESPN.
  useEffect(() => {
    const tick = () => pollESPN(matchesRef.current, queryClient)
    tick() // poll immédiat au montage

    let worker = null
    let fallbackId = null
    const lastTickAt = { t: Date.now() }

    try {
      worker = new EspnTimerWorker()
      worker.onmessage = () => { lastTickAt.t = Date.now(); tick() }
    } catch {
      // Fallback si les Workers ne sont pas supportés (rare)
      fallbackId = setInterval(tick, 15_000)
    }

    // Watchdog : si le Worker se bloque silencieusement (crash, HMR, onglet gelé),
    // on continue à poller toutes les 10s depuis le main thread.
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
  // (sécurité : football-data.org peut changer de statut avant notre prochain ESPN tick)
  const knownInPlayRef = useRef(new Set())
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
  }, [matches])

  // Recalibration manuelle : réinitialise tous les états et force un re-poll complet
  const recalibrate = useRef(async () => {
    clearAllMatchStates()
    await Promise.all([
      pollESPN(matchesRef.current, queryClient),
      pollApiFootball(matchesRef.current, queryClient),
    ])
  })

  return { recalibrate: recalibrate.current }
}
