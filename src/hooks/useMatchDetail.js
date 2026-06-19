// Détail d'un match terminé : buteurs, cartons, score mi-temps, arbitres, stade.
// Endpoint football-data.org : GET /v4/matches/{id}
// Cache localStorage 24h — les données d'un match terminé ne changent jamais.
import { useQuery } from '@tanstack/react-query'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { fdFetch, fdUrl } from '../utils/fdFetch'

export function useMatchDetail(matchId) {
  const key = `matchdetail_${matchId}`

  const { data, isLoading } = useQuery({
    queryKey: ['matchDetail', matchId],
    queryFn: async () => {
      const res = await fdFetch(fdUrl(`/api/v4/matches/${matchId}`))
      if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      writeCache(key, json, 24 * 60 * 60 * 1000)
      return json
    },
    enabled:              !!matchId,
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            24 * 60 * 60 * 1000,
    retry:                false,
  })

  return { detail: data ?? null, loading: isLoading }
}
