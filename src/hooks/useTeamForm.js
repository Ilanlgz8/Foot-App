import { useQuery } from '@tanstack/react-query'
import { fdUrl } from '../utils/fdFetch'
import { readCache, getCacheSavedAt, writeCache } from './localCache'

// Retourne 'W', 'L' ou 'D' selon les buts marqués et encaissés
function getResult(myGoals, theirGoals) {
  if (myGoals > theirGoals) return 'W'
  if (myGoals < theirGoals) return 'L'
  return 'D'
}

const FORM_STALE = 1000 * 60 * 30  // 30min

export function useTeamForm(selectedComp) {
  const cacheKey = `teamform_${selectedComp}`

  const { data } = useQuery({
    queryKey: ['teamForm', selectedComp, selectedComp === 'WC' ? '2026' : 'cur'],
    queryFn: async () => {
      // WC 2026 : sans filtre saison FD.org renvoie WC 2022 → forme incorrecte
      const seasonParam = selectedComp === 'WC' ? '&season=2026' : ''
      const res = await fetch(
        fdUrl(`/api/v4/competitions/${selectedComp}/matches?status=FINISHED${seasonParam}`)
      )
      if (!res.ok) return { formMap: {}, matches: [] }

      const json = await res.json()
      const matches = json.matches ?? []

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
    retry: false
  })

  return {
    formMap:  data?.formMap  ?? {},
    // Matches bruts — utilisés pour extraire le H2H en modal
    compMatches: data?.matches ?? [],
  }
}
