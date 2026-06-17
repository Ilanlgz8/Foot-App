import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { trackMatchState, clearMatchState } from '../utils/matchStateTracker'

// IDs des matchs vus lors du dernier fetch réussi
// Quand un match disparaît de la liste live → il est terminé → on nettoie son état
const prevLiveIds = new Set()

// Matches vus IN_PLAY/PAUSED avec leur dernière version connue + timestamp
// Permet de les garder dans la liste si l'API les fait brièvement disparaître (faux SCHEDULED)
const stickyLive = new Map() // id → { match, seenAt }
const STICKY_TTL = 3 * 60_000 // 3 minutes max sans confirmation API

export function useLiveMatches() {
  const queryClient = useQueryClient()

  // Quand la page redevient visible (réveil ordi, retour sur l'onglet),
  // forcer un refetch immédiat — évite les données périmées après une longue inactivité
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [queryClient])

  const { data } = useQuery({
    queryKey: ['liveMatches'],
    queryFn: async () => {
      try {
        // 4 requêtes : global IN_PLAY/PAUSED + WC spécifique
        // L'endpoint global /v4/matches ne retourne PAS la WC sur le free tier
        const [r1, r2, r3, r4] = await Promise.all([
          fetch('/api/v4/matches?status=IN_PLAY'),
          fetch('/api/v4/matches?status=PAUSED'),
          fetch('/api/v4/competitions/WC/matches?status=IN_PLAY'),
          fetch('/api/v4/competitions/WC/matches?status=PAUSED'),
        ])
        const live   = r1.ok ? (await r1.json()).matches ?? [] : []
        const paused = r2.ok ? (await r2.json()).matches ?? [] : []
        const wcLive   = r3.ok ? (await r3.json()).matches ?? [] : []
        const wcPaused = r4.ok ? (await r4.json()).matches ?? [] : []

        // Mémorise les transitions d'état pour calcMinute
        ;[...live, ...paused, ...wcLive, ...wcPaused].forEach(trackMatchState)

        // Dédupliquer par id
        const seen = new Set()
        const result = [...live, ...paused, ...wcLive, ...wcPaused].filter(m => {
          if (seen.has(m.id)) return false
          seen.add(m.id)
          return true
        })

        const now = Date.now()

        // Mettre à jour le cache sticky avec les matchs fraîchement vus
        result.forEach(m => stickyLive.set(m.id, { match: m, seenAt: now }))

        // Ré-injecter les matchs "sticky" que l'API a fait disparaître temporairement
        // (football-data.org peut brièvement retourner SCHEDULED pendant un match live)
        for (const [id, { match: m, seenAt }] of stickyLive) {
          if (m.status === 'FINISHED') { stickyLive.delete(id); continue }
          if (now - seenAt > STICKY_TTL) { stickyLive.delete(id); continue }
          if (!seen.has(id)) { result.push(m); seen.add(id) }
        }

        // Nettoyer le localStorage des matchs qui ont quitté la liste live (terminés)
        // On n'efface que si hors du sticky aussi
        for (const id of prevLiveIds) {
          if (!seen.has(id)) clearMatchState(id)
        }
        prevLiveIds.clear()
        seen.forEach(id => prevLiveIds.add(id))

        return result
      } catch {
        return []
      }
    },
    // 30s si des matchs sont en cours, 60s sinon (évite de rester bloqué 5min)
    refetchInterval: (query) => {
      const hasLive = (query.state.data ?? []).length > 0
      return hasLive ? 30_000 : 60_000
    },
    staleTime: 20_000,
    retry: false,
  })

  return data ?? []
}
