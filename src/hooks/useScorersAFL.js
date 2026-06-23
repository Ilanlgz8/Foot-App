/**
 * useScorersAFL — buteurs via api-football (avec photos joueurs)
 *
 * Remplace useScorers (FD.org) pour la vue Classement > Buteurs.
 * api-football fournit player.photo directement dans la réponse.
 */

import { useQuery } from '@tanstack/react-query'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'

// Mapping code FD.org → league id + saison api-football
const AFL_MAP = {
  'FL1':  { league: 61,  season: 2025 },
  'PL':   { league: 39,  season: 2025 },
  'PD':   { league: 140, season: 2025 },
  'BL1':  { league: 78,  season: 2025 },
  'SA':   { league: 135, season: 2025 },
  'DED':  { league: 88,  season: 2025 },
  'PPL':  { league: 94,  season: 2025 },
  'PL2':  { league: 40,  season: 2025 },
  'FL2':  { league: 62,  season: 2025 },
  'BL2':  { league: 79,  season: 2025 },
  'CL':   { league: 2,   season: 2025 },
  'EL':   { league: 3,   season: 2025 },
  'UECL': { league: 848, season: 2025 },
  'WC':   { league: 1,   season: 2026 },
  'EC':   { league: 4,   season: 2024 },
  'CA':   { league: 9,   season: 2026 },
  'CLI':  { league: 13,  season: 2026 },
  'UNL':  { league: 5,   season: 2024 },
}

const STALE_MS = 1000 * 60 * 30  // 30 min

export function useScorersAFL(compCode) {
  const afl      = AFL_MAP[compCode]
  const cacheKey = `scorers_afl_${compCode}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['scorersAFL', compCode],
    queryFn: async () => {
      const params = new URLSearchParams({
        _ep:    'players/topscorers',
        league: afl.league,
        season: afl.season,
      })
      const res = await fetch(`/apifootball?${params}`)
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()

      const scorers = (json.response ?? []).map(r => ({
        player: {
          id:    r.player.id,
          name:  r.player.name,
          photo: r.player.photo ?? null,
        },
        team: {
          id:    r.statistics[0]?.team?.id,
          name:  r.statistics[0]?.team?.name  ?? '',
          crest: r.statistics[0]?.team?.logo  ?? null,
        },
        goals:   r.statistics[0]?.goals?.total    ?? 0,
        assists: r.statistics[0]?.goals?.assists   ?? null,
        games:   r.statistics[0]?.games?.appearences ?? null,
      }))

      writeCache(cacheKey, scorers, STALE_MS)
      return scorers
    },
    initialData:          readCacheStale(cacheKey) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(cacheKey),
    staleTime:            STALE_MS,
    retry: false,
    enabled: !!afl,
  })

  return {
    scorers: data ?? [],
    loading: isLoading,
    error:   error?.message ?? null,
  }
}
