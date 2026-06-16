import { useQuery } from '@tanstack/react-query'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'

const TTL_MS = 30 * 60 * 1000  // 30min (au lieu de 1h)

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

export function useRecentResults() {
  const dateTo   = isoDate(new Date())
  const dateFrom = isoDate(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000))

  // Clé incluant la date du jour → cache invalidé automatiquement chaque nouveau jour
  const cacheKey = `results_wc_${dateTo}`

  const cachedData    = readCacheStale(cacheKey)
  const cachedSavedAt = getCacheSavedAt(cacheKey)

  const { data, isLoading } = useQuery({
    queryKey: ['recentResults', dateTo],
    queryFn: async () => {
      try {
        const res = await fetch(
          `/api/v4/competitions/WC/matches?status=FINISHED&dateFrom=${dateFrom}&dateTo=${dateTo}`
        )

        if (!res.ok) {
          console.warn('[results] WC HTTP', res.status)
          return cachedData ?? []
        }

        const json = await res.json()
        const matches = (json.matches ?? [])
          .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))

        if (matches.length > 0) writeCache(cacheKey, matches, TTL_MS)
        return matches.length > 0 ? matches : (cachedData ?? [])
      } catch (e) {
        console.warn('[results]', e.message)
        return cachedData ?? []
      }
    },
    initialData: cachedData ?? undefined,
    initialDataUpdatedAt: cachedSavedAt,
    staleTime: TTL_MS,
    retry: false,
  })

  return {
    results: data ?? [],
    loading: isLoading,
  }
}
