import { useQuery } from '@tanstack/react-query'
import { readCacheStale, getCacheSavedAt, writeCache, readCache } from './localCache'

const VALID_STATUS = ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'FINISHED']
const EURO_COMPS = 'CL,PL,FL1,PD,BL1,SA'

const delay = (ms) => new Promise(r => setTimeout(r, ms))

async function safeFetch(url) {
  const res = await fetch(url)
  // 429 → on lève une erreur pour que TanStack garde le dernier state valide
  if (res.status === 429) throw new Error('429')
  if (!res.ok) return []
  const json = await res.json()
  return (json.matches ?? []).filter(m => VALID_STATUS.includes(m.status))
}

async function fetchTodayMatches(date) {
  // Requête 1 : toutes les ligues européennes en une seule requête
  const euroMatches = await safeFetch(
    `/api/v4/matches?dateFrom=${date}&dateTo=${date}&competitions=${EURO_COMPS}`
  )

  await delay(700)

  // Requête 2 : WC séparément (non retourné par l'endpoint global sur free tier)
  const wcMatches = await safeFetch(
    `/api/v4/competitions/WC/matches?dateFrom=${date}&dateTo=${date}`
  )

  // Dédupliquer par id et trier par heure
  const seen = new Set()
  const all = [...euroMatches, ...wcMatches].filter(m => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })

  return all.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
}

// Préchargement des jours adjacents
export async function prefetchMatchesForDate(queryClient, date) {
  if (readCache(`matches_${date}`)) return
  await queryClient.prefetchQuery({
    queryKey: ['todayMatches', date],
    queryFn: async () => {
      const result = await fetchTodayMatches(date)
      if (result.length > 0) writeCache(`matches_${date}`, result, 6 * 60 * 60 * 1000)
      return result.length > 0 ? result : (readCacheStale(`matches_${date}`) ?? [])
    },
    staleTime: 30 * 60 * 1000,
  })
}

// Calcule l'intervalle de refetch selon si un match est en cours ou non
function getRefetchInterval(query) {
  const matches = query.state.data ?? []
  const hasLive = matches.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')
  return hasLive ? 2 * 60 * 1000 : 10 * 60 * 1000  // 2min si live, 10min sinon
}

export function useTodayMatches(targetDate) {
  const today = targetDate ?? new Date().toISOString().split('T')[0]
  const isToday = today === new Date().toISOString().split('T')[0]
  const cacheKey = `matches_${today}`

  const cachedData    = readCacheStale(cacheKey)
  const cachedSavedAt = getCacheSavedAt(cacheKey)

  const { data, isLoading } = useQuery({
    queryKey: ['todayMatches', today],
    queryFn: async () => {
      const result = await fetchTodayMatches(today)
      if (result.length > 0) {
        const hasLive = result.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')

        // Durée du cache selon le contexte
        let ttl
        if (!isToday) {
          ttl = 6 * 60 * 60 * 1000   // autre jour → cache 6h
        } else if (hasLive) {
          ttl = 2 * 60 * 1000         // match en cours → cache 2min
        } else {
          ttl = 60 * 60 * 1000        // aujourd'hui sans live → cache 1h
        }

        writeCache(cacheKey, result, ttl)
        return result
      }
      // API répond vide (pas de match ce jour) → retourner [] et NE PAS fallback sur le cache
      return []
    },
    initialData: cachedData ?? undefined,
    initialDataUpdatedAt: cachedSavedAt,
    staleTime: isToday ? 60 * 1000 : 30 * 60 * 1000,
    refetchInterval: isToday ? getRefetchInterval : false,
    retry: false,
  })

  return { matches: data ?? [], loading: isLoading }
}
