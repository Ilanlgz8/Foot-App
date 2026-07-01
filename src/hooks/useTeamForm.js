import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCache, getCacheSavedAt, writeCache } from './localCache'

// Retourne 'W', 'L' ou 'D' selon les buts marqués et encaissés
function getResult(myGoals, theirGoals) {
  if (myGoals > theirGoals) return 'W'
  if (myGoals < theirGoals) return 'L'
  return 'D'
}

// Aligné sur le cache serveur (api/football.js retourne déjà ce endpoint avec un
// TTL de 2min par défaut) — 30min côté client empêchait de profiter d'une donnée
// pourtant déjà plus fraîche côté serveur.
const FORM_STALE = 1000 * 60 * 2  // 2min (était 30min)

export function useTeamForm(selectedComp) {
  const cacheKey = `teamform2_${selectedComp}`

  const { data, isLoading } = useQuery({
    queryKey: ['teamForm2', selectedComp, selectedComp === 'WC' ? '2026' : 'cur'],
    queryFn: async () => {
      // WC 2026 : forcer season=2026 sinon FD.org renvoie WC 2022
      // On NE filtre PAS status=FINISHED côté serveur (non supporté par le free tier FD.org
      // sur certains endpoints) → on filtre côté client
      const seasonParam = selectedComp === 'WC' ? '?season=2026' : ''
      const res = await fdFetch(
        fdUrl(`/api/v4/competitions/${selectedComp}/matches${seasonParam}`)
      )
      // 429 → throw pour que React Query retente (rate limit temporaire)
      if (res.status === 429) throw new Error('rate_limit')
      if (!res.ok) return { formMap: {}, matches: [] }

      const json = await res.json()
      // Filtrer les matchs terminés côté client
      const matches = (json.matches ?? []).filter(m => m.status === 'FINISHED')

      const formMap = {}

      matches.forEach(match => {
        const homeId = match.homeTeam.id
        const awayId = match.awayTeam.id
        const homeGoals = match.score.fullTime.home
        const awayGoals = match.score.fullTime.away

        if (homeGoals === null || awayGoals === null) return

        const homeResult = getResult(homeGoals, awayGoals)
        const awayResult = getResult(awayGoals, homeGoals)

        if (!formMap[homeId]) formMap[homeId] = []
        if (!formMap[awayId]) formMap[awayId] = []

        formMap[homeId].push(homeResult)
        formMap[awayId].push(awayResult)
      })

      // Garde seulement les 5 derniers résultats par équipe
      Object.keys(formMap).forEach(id => {
        formMap[id] = formMap[id].slice(-5)
      })

      const result = { formMap, matches }
      writeCache(cacheKey, result, FORM_STALE)
      return result
    },
    enabled:              !!selectedComp,
    initialData:          readCache(cacheKey) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(cacheKey),
    staleTime:            FORM_STALE,
    retry:                2,
    retryDelay:           attempt => Math.min(1000 * 2 ** attempt, 15_000)
  })

  return {
    formMap:     data?.formMap  ?? {},
    // Matches bruts — utilisés pour extraire le H2H en modal
    compMatches: data?.matches ?? [],
    isLoading,
  }
}
