import { useQuery } from '@tanstack/react-query'
import { readCache, readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { fdFetch } from '../utils/fdFetch'

// TTL selon le statut : les matchs à venir/terminés changent rarement → cache long
// → évite les 429 (free tier football-data.org : 10 req/min)
const TTL = {
  SCHEDULED: 60 * 60 * 1000,   // 1h — calendrier très stable
  FINISHED:  30 * 60 * 1000,   // 30min — résultats définitifs, nouveaux matchs peu fréquents
  IN_PLAY:    2 * 60 * 1000,   // 2min — géré ailleurs mais garde un fallback court
}

function cacheKey(comp, status) {
  return `matches_${comp}_${status}`
}

function groupByMatchday(matches, order = 'asc') {
  const groups = {}
  matches.forEach(match => {
    const day = match.matchday
    if (!groups[day]) groups[day] = []
    groups[day].push(match)
  })
  Object.values(groups).forEach(g =>
    g.sort((a, b) =>
      order === 'desc'
        ? new Date(b.utcDate) - new Date(a.utcDate)
        : new Date(a.utcDate) - new Date(b.utcDate)
    )
  )
  return Object.entries(groups).sort((pairA, pairB) => {
    const dayA = Number(pairA[0])
    const dayB = Number(pairB[0])
    return order === 'asc' ? dayA - dayB : dayB - dayA
  })
}

// Calcule l'année de saison pour les ligues clubs (ex: juin 2026 → 2025)
// Les ligues club tournent Août-Mai, donc en juin/juillet on est en intersaison
// WC 2026 : saison spéciale juin-juillet 2026
function getClubSeason() {
  const now = new Date()
  const month = now.getMonth() + 1 // 1-12
  const year = now.getFullYear()
  // En juin et juillet, la saison précédente vient de se terminer
  return month <= 7 ? year - 1 : year
}

export function useMatches(selectedComp, status = 'SCHEDULED', order = 'asc') {
  const key         = cacheKey(selectedComp, status)
  const cachedData  = readCacheStale(key)
  const cachedAt    = getCacheSavedAt(key)
  const ttl         = TTL[status] ?? 30 * 60 * 1000

  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', selectedComp, status],
    queryFn: async () => {
      // Pour les ligues club FINISHED en intersaison, ajouter season= pour éviter 0 résultats
      const isClub = selectedComp !== 'WC' && selectedComp !== 'EC'
      const seasonParam = (status === 'FINISHED' && isClub)
        ? `&season=${getClubSeason()}`
        : ''
      const res = await fdFetch(
        `/api/v4/competitions/${selectedComp}/matches?status=${status}${seasonParam}`
      )
      // 429/403 → TanStack garde la dernière donnée valide (pas d'erreur affichée)
      if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json    = await res.json()
      const matches = json.matches ?? []
      if (matches.length > 0) writeCache(key, matches, ttl)
      return matches.length > 0 ? matches : (readCacheStale(key) ?? [])
    },
    initialData:          cachedData ?? undefined,
    initialDataUpdatedAt: cachedAt,
    // staleTime = TTL → si le cache est encore frais, 0 requête API au montage du composant
    staleTime: ttl,
    retry: false,
  })

  return {
    matches: data ?? [],
    loading: isLoading,
    error: error?.message === '429' ? null : (error?.message ?? null), // 429 silencieux
    grouped: groupByMatchday(data ?? [], order),
  }
}