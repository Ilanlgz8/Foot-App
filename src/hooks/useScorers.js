import { useQuery } from '@tanstack/react-query'
import { fdFetch } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'

const STALE_MS = 1000 * 60 * 30  // 30min

export function useScorers(compId) {
  const key = `scorers_${compId}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['scorers', compId],
    queryFn: async () => {
      const res = await fdFetch(`/api/v4/competitions/${compId}/scorers?limit=20`)
      if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      const scorers = json.scorers ?? []
      writeCache(key, scorers, STALE_MS)
      return scorers
    },
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            STALE_MS,
    retry: false,
    enabled: !!compId,
  })

  return {
    scorers: data ?? [],
    loading: isLoading,
    error:   error?.message ?? null,
  }
}
