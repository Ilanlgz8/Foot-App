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

import { createContext, useContext, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTodayMatches } from '../hooks/useTodayMatches'
import { useLiveMatches } from '../hooks/useLiveMatches'
import { useLiveMinute } from '../hooks/useLiveMinute'
import { useEspnScores } from '../hooks/useEspnScores'
import { requestNotificationPermission } from '../utils/notifications'

const LiveCtx = createContext({
  liveMatches:  [],
  espnScores:   {},
  recalibrate:  null,
})

export function LiveProvider({ children }) {
  const queryClient = useQueryClient()

  // Toujours aujourd'hui — le live ne concerne que le jour courant
  const { matches } = useTodayMatches()
  const liveMatches = useLiveMatches()

  const { recalibrate } = useLiveMinute(
    liveMatches.length > 0
      ? [...matches, ...liveMatches.filter(g => !matches.some(m => m.id === g.id))]
      : matches
  )

  const espnScores = useEspnScores()

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
