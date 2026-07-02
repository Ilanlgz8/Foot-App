import { useQuery } from '@tanstack/react-query'
import { readCache, readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { KNOCKOUT_ORDER, KNOCKOUT_LABELS } from './useWcKnockout'

// TTL selon le statut : les matchs à venir/terminés changent rarement → cache long
// → évite les 429 (free tier football-data.org : 10 req/min)
const TTL = {
  SCHEDULED: 60 * 60 * 1000,   // 1h — calendrier très stable
  FINISHED:   2 * 60 * 1000,   // 2min (était 5min) — aligné sur le cache serveur, résultats/classement/buteurs à jour plus vite
  IN_PLAY:    2 * 60 * 1000,   // 2min — géré ailleurs mais garde un fallback court
}

function cacheKey(comp, status) {
  return `matches_${comp}_${status}`
}

// Regroupe les matchs pour la navigation "par journée" :
//   - phase de poules → par match.matchday (1, 2, 3…), comme avant
//   - phase à élimination directe → match.matchday est TOUJOURS null pour ces
//     matchs (vérifié : c'est ce qui provoquait l'affichage "Journée null" en
//     Résultats/Programme dès la fin de la phase de groupes). On les regroupe
//     alors par match.stage, avec les libellés français déjà définis dans
//     useWcKnockout.js (Seizièmes, Huitièmes, Quarts, Demies, Finale…).
// Retourne un tableau de { key, label, matches } dans l'ordre chronologique
// (poules d'abord, puis tours à élimination directe dans l'ordre du tableau),
// inversé si order === 'desc' (utilisé par Résultats : le plus récent d'abord).
export function groupRounds(matches, order = 'asc') {
  const groupStage = matches.filter(m => m.matchday != null)
  const knockout    = matches.filter(m => m.matchday == null && m.stage)

  const mdMap = {}
  groupStage.forEach(m => { (mdMap[m.matchday] ??= []).push(m) })
  const mdEntries = Object.keys(mdMap)
    .map(Number).sort((a, b) => a - b)
    .map(day => ({
      key: `md-${day}`,
      label: `Journée ${day}`,
      matches: [...mdMap[day]].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)),
    }))

  const koEntries = KNOCKOUT_ORDER
    .map(stage => ({ stage, ms: knockout.filter(m => m.stage === stage) }))
    .filter(({ ms }) => ms.length > 0)
    .map(({ stage, ms }) => ({
      key: stage,
      label: KNOCKOUT_LABELS[stage] ?? stage,
      matches: [...ms].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)),
    }))

  const chrono   = [...mdEntries, ...koEntries]
  const ordered  = order === 'desc' ? [...chrono].reverse() : chrono
  return ordered.map(g => ({
    ...g,
    matches: order === 'desc' ? [...g.matches].reverse() : g.matches,
  }))
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
        const res = await fdFetch(fdUrl(url))
        if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
        if (!res.ok) return null
        const json = await res.json()
        return json.matches ?? []
      }

      let matches = null

      if (!isClub) {
        const wcSeason = new Date().getFullYear()
        if (status === 'SCHEDULED') {
          // Essai 1 : tous les matchs de la saison (poules + bracket complets)
          matches = await tryFetch(
            `/api/v4/competitions/${selectedComp}/matches?season=${wcSeason}`
          )
          // Essai 2 : seulement TIMED si retourne vide (FD.org utilise TIMED pour heure confirmée)
          if (!matches || matches.length === 0) {
            matches = await tryFetch(
              `/api/v4/competitions/${selectedComp}/matches?status=TIMED&season=${wcSeason}`
            )
          }
          // Essai 3 : sans filtre de saison (saison courante par défaut sur FD.org)
          if (!matches || matches.length === 0) {
            matches = await tryFetch(
              `/api/v4/competitions/${selectedComp}/matches`
            )
          }
        } else {
          // Résultats WC : seulement FINISHED
          matches = await tryFetch(
            `/api/v4/competitions/${selectedComp}/matches?status=FINISHED&season=${wcSeason}`
          )
          if (!matches || matches.length === 0) {
            matches = await tryFetch(
              `/api/v4/competitions/${selectedComp}/matches?status=FINISHED`
            )
          }
        }
      } else if (status === 'FINISHED') {
        // Clubs : saison qui vient de se terminer (juin 2026 → 2025)
        matches = await tryFetch(
          `/api/v4/competitions/${selectedComp}/matches?status=${status}&season=${getClubSeason()}`
        )
        if (!matches || matches.length === 0) {
          matches = await tryFetch(
            `/api/v4/competitions/${selectedComp}/matches?status=${status}`
          )
        }
      } else {
        // Clubs SCHEDULED
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
    grouped: groupRounds(data ?? [], order),
  }
}