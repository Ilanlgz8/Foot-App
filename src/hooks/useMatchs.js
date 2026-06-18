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
      const isClub = selectedComp !== 'WC' && selectedComp !== 'EC'

      // Helper : fetch une URL et retourne les matches (null si 429/403/erreur)
      async function tryFetch(url) {
        const res = await fdFetch(url)
        if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
        if (!res.ok) return null
        const json = await res.json()
        return json.matches ?? []
      }

      let matches = null

      if (status === 'FINISHED' && isClub) {
        // 1. Essai avec saison courante (ex: 2025 pour la saison 2025/26)
        matches = await tryFetch(
          `/api/v4/competitions/${selectedComp}/matches?status=${status}&season=${getClubSeason()}`
        )
        // 2. Si 0 résultats, fallback saison précédente (ex: 2024 pour la saison 2024/25)
        if (!matches || matches.length === 0) {
          matches = await tryFetch(
            `/api/v4/competitions/${selectedComp}/matches?status=${status}&season=${getClubSeason() - 1}`
          )
        }
        // 3. Si toujours 0, fallback sans season= (FD.org retourne la saison courante par défaut)
        if (!matches || matches.length === 0) {
          matches = await tryFetch(
            `/api/v4/competitions/${selectedComp}/matches?status=${status}`
          )
        }
      } else {
        matches = await tryFetch(
          `/api/v4/competitions/${selectedComp}/matches?status=${status}`
        )
      }

      if (!matches) return readCacheStale(key) ?? []
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