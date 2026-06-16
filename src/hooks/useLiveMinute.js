// Polling intelligent vers api-football.com pour détecter précisément :
//   • Le coup d'envoi (KO)  → invalide le cache liveMatches pour refresh immédiat
//   • La mi-temps (HT)      → enregistre pausedAt
//   • La reprise (2H)       → enregistre half2Start (timestamp exact)
//   • La fin du match (FT)  → nettoie l'état
//
// 4 fenêtres de polling par match (économise le quota de 100 req/jour) :
//   Fenêtre 0 : à partir de l'heure de KO (max 10min)  → détecte le début du match
//   Fenêtre 1 : à partir de la 45ème minute             → détecte le passage en HT
//   Fenêtre 2 : à partir de 15min de pause MT           → détecte la reprise en 2ème MT
//   Fenêtre 3 : à partir de la 90ème minute             → détecte la fin du match
//
// 1 seule requête couvre TOUS les matchs en polling → /apifootball?live=all
// Quota : si x-quota-remaining < 5, bascule silencieusement en heuristique.

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getMatchState, trackMatchState, clearMatchState, getTrackedMatches, setKickoffAt, setHalf2Start, clearAllMatchStates } from '../utils/matchStateTracker'

let quotaRemaining = Infinity

function isInPollingWindow(match, trackedIds) {
  if (quotaRemaining < 5) return false

  const elapsed = (Date.now() - new Date(match.utcDate)) / 60000

  // Fenêtre 0 : coup d'envoi — pas besoin d'être tracké, s'applique à tous les matchs
  // On poll pour détecter le passage en IN_PLAY et rafraîchir le widget live.
  // On continue à poller si le match est IN_PLAY mais kickoffAt pas encore stocké
  // (cas où football-data.org a changé de statut avant notre premier poll Window 0)
  if (elapsed >= 0 && elapsed <= 60) {
    if (match.status === 'TIMED' || match.status === 'SCHEDULED') return true
    if (match.status === 'IN_PLAY' && !getMatchState(match.id).kickoffAt) return true
  }

  if (match.status === 'FINISHED') return false

  // Toutes les fenêtres nécessitent un tracking explicite
  if (!trackedIds.has(String(match.id))) return false

  const state = getMatchState(match.id)

  // Fenêtre 1 : temps additionnel 1ère MT (à partir de 45min)
  // On inclut PAUSED car football-data.org peut switcher avant notre poll :
  // dans ce cas on poll quand même API-Football pour y détecter HT et set pausedAt.
  if ((match.status === 'IN_PLAY' || match.status === 'PAUSED') && elapsed >= 45 && elapsed <= 60 && !state.pausedAt) return true

  // Fenêtre 2 : attente reprise après MT (à partir de 15min de pause)
  if (state.pausedAt && !state.half2Start) {
    const pauseDuration = (Date.now() - state.pausedAt) / 60000
    if (pauseDuration >= 15) return true
  }

  // Fenêtre 3 : temps additionnel 2ème MT (à partir de la 90ème minute globale)
  if (state.half2Start) {
    const half2Elapsed = (Date.now() - state.half2Start) / 60000
    if (half2Elapsed >= 44) return true
  }

  return false
}

function normalize(name = '') {
  return name.toLowerCase()
    .replace(/[àáâ]/g, 'a')
    .replace(/[éèê]/g, 'e')
    .trim()
}

function findMatch(fixture, matches) {
  const apiHome = normalize(fixture.teams?.home?.name ?? '')
  const apiAway = normalize(fixture.teams?.away?.name ?? '')
  if (!apiHome || !apiAway) return null

  return matches.find(m => {
    const h = normalize(m.homeTeam?.name ?? m.homeTeam?.shortName ?? '')
    const a = normalize(m.awayTeam?.name ?? m.awayTeam?.shortName ?? '')
    const homeMatch = h.startsWith(apiHome.slice(0, 5)) || apiHome.startsWith(h.slice(0, 5))
    const awayMatch = a.startsWith(apiAway.slice(0, 5)) || apiAway.startsWith(a.slice(0, 5))
    return homeMatch && awayMatch
  }) ?? null
}

async function pollApiFootball(matches, queryClient) {
  try {
    const res = await fetch('/apifootball?live=all')
    if (!res.ok) {
      console.warn('[useLiveMinute] Réponse API-Football non-OK :', res.status)
      return
    }

    const remaining = res.headers.get('x-quota-remaining')
    if (remaining !== null) {
      quotaRemaining = parseInt(remaining, 10)
      if (quotaRemaining < 10) {
        console.warn(`[useLiveMinute] Quota bas : ${quotaRemaining} requêtes restantes`)
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

      // Fenêtre 0 : KO détecté → stocker le timestamp exact du vrai coup d'envoi
      if (status === '1H') {
        if (match.status === 'TIMED' || match.status === 'SCHEDULED') {
          koDetected = true
        }
        // Reconstruire l'heure exacte du KO depuis la minute API-Football
        if (apiElapsed != null && !state.kickoffAt) {
          const kickoffAt = Date.now() - apiElapsed * 60_000
          setKickoffAt(match.id, kickoffAt)
        }
      }

      // Fenêtre 1 : HT détecté
      if (status === 'HT' && !state.pausedAt) {
        trackMatchState({ ...match, status: 'PAUSED' })
      }

      // Fenêtre 2 : 2H détecté — enregistre/corrige half2Start
      // On n'écrase que si elapsed < 90 : API-Football cap elapsed à 90 pendant
      // le temps additionnel (le vrai extra est dans un champ séparé).
      // Si on écrasait avec elapsed=90, min2 resterait bloqué à 45 → 90' figé.
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
        clearMatchState(match.id)
      }
    }

    if (koDetected) {
      queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
    }
  } catch (err) {
    console.warn('[useLiveMinute] Erreur lors du polling :', err.message)
  }
}

/**
 * Hook à appeler dans Accueil avec TOUS les matchs du jour.
 * Active le polling uniquement pendant les 4 fenêtres critiques,
 * et uniquement pour les matchs sélectionnés par l'utilisateur.
 *
 * @param {Array} matches — tous les matchs du jour depuis useTodayMatches
 */
export function useLiveMinute(matches) {
  const queryClient  = useQueryClient()
  const matchesRef   = useRef(matches)
  matchesRef.current = matches
  const pollRef      = useRef(null)

  useEffect(() => {
    const tick = async () => {
      const current    = matchesRef.current
      const trackedIds = getTrackedMatches()
      const needsPoll  = current.some(m => isInPollingWindow(m, trackedIds))
      if (needsPoll) {
        await pollApiFootball(current, queryClient)
      }
    }

    pollRef.current = tick
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [queryClient])

  // Recalibration manuelle : clear les états + poll forcé (ignore les fenêtres)
  // Consomme 1 requête API-Football intentionnellement.
  const recalibrate = useRef(async () => {
    clearAllMatchStates()
    await pollApiFootball(matchesRef.current, queryClient)
  })

  return { recalibrate: recalibrate.current }
}
