import { useQuery } from '@tanstack/react-query'

const API_KEY = import.meta.env.VITE_API_KEY

export function useTeamForm(selectedComp) {
  const { data } = useQuery({
    queryKey: ['teamForm', selectedComp],
    queryFn: async () => {
      const res = await fetch(
        `/api/v4/competitions/${selectedComp}/matches?status=FINISHED`,
        { headers: { 'X-Auth-Token': API_KEY } }
      )
      if (!res.ok) return {}

      const json = await res.json()
      const matches = json.matches ?? []

      const formMap = {}

      matches.forEach(match => {
        const homeId = match.homeTeam.id
        const awayId = match.awayTeam.id
        const homeGoals = match.score.fullTime.home
        const awayGoals = match.score.fullTime.away

        if (homeGoals === null || awayGoals === null) return

        const homeResult = homeGoals > awayGoals ? 'W' : homeGoals < awayGoals ? 'L' : 'D'
        const awayResult = awayGoals > homeGoals ? 'W' : awayGoals < homeGoals ? 'L' : 'D'

        if (!formMap[homeId]) formMap[homeId] = []
        if (!formMap[awayId]) formMap[awayId] = []

        formMap[homeId].push(homeResult)
        formMap[awayId].push(awayResult)
      })

      // Garde seulement les 5 derniers résultats par équipe
      Object.keys(formMap).forEach(id => {
        formMap[id] = formMap[id].slice(-5)
      })

      return formMap
    },
    staleTime: 1000 * 60 * 60 * 24, // cache 24h
    retry: false
  })

  return { formMap: data ?? {} }
}