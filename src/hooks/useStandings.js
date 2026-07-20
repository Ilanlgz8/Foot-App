import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'

// Aligné sur le TTL du cache serveur (api/football.js).
const STALE_MS = 1000 * 60 * 2  // 2min (était 10min) — se met à jour pendant les matchs live

export function useStandings(selectedComp) {
  const key = `standings_${selectedComp}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', selectedComp],
    queryFn: async () => {
      const res = await fdFetch(fdUrl(`/api/v4/competitions/${selectedComp}/standings`))
      if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      const allGroups = json.standings ?? []

      const realGroups = allGroups.filter(g => g.group && (g.table?.length ?? 0) >= 2)

      const result = realGroups.length > 1
        ? {
            table: realGroups.flatMap(g => g.table ?? []),
            groups: realGroups.map(g => ({ name: g.group, table: g.table ?? [] })),
          }
        : {
            table: allGroups[0]?.table ?? [],
            groups: [],
          }

      writeCache(key, result, STALE_MS)
      return result
    },
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            STALE_MS,
    retry: false,
    enabled: !!selectedComp,
  })

  return {
    standings: data?.table  ?? [],
    groups:    data?.groups ?? [],
    loading:   isLoading,
    // Voir le commentaire sur isSilentFetchError dans useMatchs.js : un 429
    // ou 403 FD.org est transitoire et déjà géré côté serveur (cache stale +
    // circuit breaker, voir api/football.js) — inutile d'afficher le code
    // HTTP brut à l'utilisateur (constat : "403" affiché tel quel ailleurs
    // dans l'app avec le même throw new Error(String(status)) ci-dessus).
    error:     (error?.message === '429' || error?.message === '403') ? null : (error?.message ?? null),
  }
}
