/**
 * LiveProvider — contexte global pour les données live.
 *
 * Monté au niveau App (au-dessus des Routes) → survit aux navigations intra-app.
 * Quand l'utilisateur va sur Classement, Résultats, etc., le polling ESPN continue.
 *
 * Fournit via useLiveData() :
 *   • liveMatches  — matchs actuellement en cours (source : liveTracker, persisté localStorage)
 *   • espnScores   — scores + buteurs + stats ESPN en temps réel
 *   • recalibrate  — force un re-poll complet (bouton ⟳ dans LiveWidget)
 *
 * Architecture :
 *   liveTracker.js est la seule source de vérité.
 *   markLive(match) → widget visible immédiatement, même après reload.
 *   markEnded(id)   → widget disparaît (5min de STATUS_FINAL + horloge >= 85min).
 *   Pas de stickyLive, pas de machine d'états complexe, pas de pendingEviction.
 */

import { createContext, useContext, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTodayMatches } from '../hooks/useTodayMatches'
import { useLiveMatches } from '../hooks/useLiveMatches'
import { useLiveMinute } from '../hooks/useLiveMinute'
import { useEspnScores } from '../hooks/useEspnScores'
import { useLiveTracker } from '../hooks/liveTracker'
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

  // FD.org polling (fallback si ESPN down) — side effect uniquement
  // Quand ESPN est down, useLiveMatches appelle markLive() pour les matchs IN_PLAY FD.org
  useLiveMatches()

  const espnScores = useEspnScores()

  // ── Source de vérité unique ─────────────────────────────────────────────────
  // liveTracker lit depuis localStorage au module load → disponible immédiatement.
  // markLive() appelé dans useLiveMinute → met à jour liveTracker → re-render ici.
  // Survit aux rechargements, aux faux STATUS_FINAL ESPN, et aux buts.
  const liveMatches = useLiveTracker()

  const { recalibrate } = useLiveMinute(
    liveMatches.length > 0
      ? [...matches, ...liveMatches.filter(g => !matches.some(m => m.id === g.id))]
      : matches
  )

  // Quand un nouveau match passe en live → invalider useTodayMatches immédiatement
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
