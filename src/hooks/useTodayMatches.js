import { useQuery, useQueries } from '@tanstack/react-query'
import { readCacheStale, getCacheSavedAt, writeCache, readCache } from './localCache'
import { fdFetch, fdUrl } from '../utils/fdFetch'

const VALID_STATUS = ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'FINISHED']
const EURO_COMPS = 'CL,PL,FL1,PD,BL1,SA' // EL/ECL non couverts par FD.org free tier


async function safeFetch(url) {
  const res = await fdFetch(fdUrl(url))
  // Erreurs serveur/rate-limit → throw pour que TanStack garde le dernier state valide
  if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
  if (res.status >= 500) throw new Error(`server_${res.status}`)
  if (!res.ok) return []
  const json = await res.json()
  return (json.matches ?? []).filter(m => VALID_STATUS.includes(m.status))
}

async function fetchTodayMatches(date) {
  // Calculer le jour UTC précédent pour capturer les matchs après minuit local
  // (ex: 00:00 local France UTC+2 = 22:00 UTC la veille → classé J-1 par FD.org)
  const prevD = new Date(date + 'T12:00:00')
  prevD.setDate(prevD.getDate() - 1)
  const prevDate = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}-${String(prevD.getDate()).padStart(2, '0')}`

  // Les 2 requêtes partent en parallèle — MAX_RPM=25 + cache Vercel edge = aucun risque de 429
  const [euroMatches, wcMatches] = await Promise.all([
    safeFetch(`/api/v4/matches?dateFrom=${prevDate}&dateTo=${date}&competitions=${EURO_COMPS}`),
    safeFetch(`/api/v4/competitions/WC/matches?dateFrom=${prevDate}&dateTo=${date}`),
  ])

  // Dédupliquer par id et filtrer par date LOCALE
  // → un match à 00:00 local (= 22:00 UTC J-1) apparaît bien dans J local seulement
  const seen = new Set()
  const all = [...euroMatches, ...wcMatches].filter(m => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    if (m.utcDate) {
      const d = new Date(m.utcDate)
      const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (localStr !== date) return false
    }
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

function getLocalDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useTodayMatches(targetDate) {
  const today = targetDate ?? getLocalDateStr()
  const isToday = today === getLocalDateStr()
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
      // Résultat vide : si le cache contient des matchs (dont un live), garder le cache
      // pour éviter que le panel s'efface sur une erreur réseau transitoire
      const stale = readCacheStale(cacheKey)
      if (stale?.length > 0) return stale
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

// ── useRecentDaysMatches ──────────────────────────────────────────────────
// Panneau "Résultats récents" (Accueil) — étendu de 2 jours (aujourd'hui +
// hier) à N jours en arrière, à la demande de l'utilisateur. Le coût réseau
// supplémentaire reste très faible : chaque jour PASSÉ (isToday=false) est
// mis en cache localStorage avec un TTL de 6h (voir useTodayMatches
// ci-dessus, réutilisé tel quel ici) — un résultat FINISHED ne change plus
// jamais, donc au-delà du tout premier chargement de chaque jour, tout part
// du cache, pas du réseau. Seul "aujourd'hui" reste rafraîchi souvent (utile
// s'il y a un match en cours). useQueries (même pattern que
// useTeamFormMulti dans useTeamForm.js) : N requêtes indépendantes, mais
// TanStack les dédup/partage déjà avec useTodayMatches si l'un des jours
// (typiquement aujourd'hui) est aussi demandé ailleurs sur la page — même
// queryKey ['todayMatches', date].
export function useRecentDaysMatches(numDays) {
  const today = getLocalDateStr()

  const dates = []
  for (let i = 0; i < numDays; i++) {
    const d = new Date(today + 'T12:00:00')
    d.setDate(d.getDate() - i)
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }

  const results = useQueries({
    queries: dates.map(date => {
      const isToday  = date === today
      const cacheKey = `matches_${date}`
      return {
        queryKey: ['todayMatches', date],
        queryFn: async () => {
          const result = await fetchTodayMatches(date)
          if (result.length > 0) {
            const hasLive = result.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')
            let ttl
            if (!isToday)    ttl = 6 * 60 * 60 * 1000
            else if (hasLive) ttl = 2 * 60 * 1000
            else              ttl = 60 * 60 * 1000
            writeCache(cacheKey, result, ttl)
            return result
          }
          const stale = readCacheStale(cacheKey)
          if (stale?.length > 0) return stale
          return []
        },
        initialData:          readCacheStale(cacheKey) ?? undefined,
        initialDataUpdatedAt: getCacheSavedAt(cacheKey),
        staleTime:            isToday ? 60 * 1000 : 30 * 60 * 1000,
        refetchInterval:      isToday ? getRefetchInterval : false,
        retry:                false,
      }
    }),
  })

  const seen = new Set()
  const matches = []
  for (const r of results) {
    for (const m of r.data ?? []) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      matches.push(m)
    }
  }

  return { matches, loading: results.some(r => r.isLoading) }
}
