/**
 * LiveProvider — contexte global pour les données live.
 *
 * Monté au niveau App (au-dessus des Routes) → survit aux navigations intra-app.
 * Quand l'utilisateur va sur Classement, Résultats, etc., le polling ESPN continue.
 *
 * Fournit via useLiveData() :
 *   • liveMatches  — matchs actuellement en cours (source : stickyLive)
 *   • espnScores   — scores + buteurs + stats ESPN en temps réel
 *   • recalibrate  — force un re-poll complet (bouton ⟳ dans LiveWidget)
 */

import { createContext, useContext, useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTodayMatches } from '../hooks/useTodayMatches'
import { useLiveMatches } from '../hooks/useLiveMatches'
import { useLiveMinute } from '../hooks/useLiveMinute'
import { useEspnScores } from '../hooks/useEspnScores'
import { getMatchState } from '../utils/matchStateTracker'
import { requestNotificationPermission } from '../utils/notifications'

const ESPN_LIVE_STATUSES = new Set([
  'STATUS_IN_PROGRESS',
  'STATUS_HALFTIME',
  'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME',
  'STATUS_OVERTIME',
])

const LiveCtx = createContext({
  liveMatches:  [],
  espnScores:   {},
  recalibrate:  null,
})

export function LiveProvider({ children }) {
  const queryClient = useQueryClient()

  // Toujours aujourd'hui — le live ne concerne que le jour courant
  const { matches } = useTodayMatches()
  const rawLiveMatches = useLiveMatches()
  const espnScores = useEspnScores()

  // Source de vérité combinée :
  // 1. rawLiveMatches (stickyLive via useLiveMatches)
  // 2. Fallback : matchs du jour dont ESPN confirme le live via localStorage (espnStatus)
  //    → si stickyLive se vide (visibilité, refresh), le widget reste affiché
  //    → espnScores comme dépendance garantit le recalcul à chaque poll ESPN (5s)
  const liveMatches = useMemo(() => {
    const result = [...rawLiveMatches]
    for (const m of matches) {
      if (result.some(r => r.id === m.id)) continue
      const state = getMatchState(m.id)
      if (ESPN_LIVE_STATUSES.has(state.espnStatus)) {
        result.push({ ...m, status: 'IN_PLAY' })
      }
    }
    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawLiveMatches, matches, espnScores])

  const { recalibrate } = useLiveMinute(
    liveMatches.length > 0
      ? [...matches, ...liveMatches.filter(g => !matches.some(m => m.id === g.id))]
      : matches
  )

  // Quand un nouveau match passe en live → invalider useTodayMatches immédiatement
  // (sinon le panel attend jusqu'à 10min pour afficher IN_PLAY)
  // + demander la permission de notifier au bon moment
  const prevLiveCount = useRef(0)
  useEffect(() => {
    if (liveMatches.length > prevLiveCount.current) {
      queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
      requestNotificationPermission()
    }
    prevLiveCount.current = liveMatches.length
  }, [liveMatches.length, queryClient])

  return (
    <LiveCtx.Provider value={{ liveMatches, espnScores, recalibrate }}>
      {children}
    </LiveCtx.Provider>
  )
}

/** Accès aux données live depuis n'importe quel composant. */
export function useLiveData() {
  return useContext(LiveCtx)
}
