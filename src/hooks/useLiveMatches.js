import { useQuery } from '@tanstack/react-query'
import { trackMatchState } from '../utils/matchStateTracker'

export function useLiveMatches() {
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
        return [...live, ...paused, ...wcLive, ...wcPaused].filter(m => {
          if (seen.has(m.id)) return false
          seen.add(m.id)
          return true
        })
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
