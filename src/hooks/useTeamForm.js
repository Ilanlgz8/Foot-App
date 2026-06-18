import { useQuery } from '@tanstack/react-query'


// Retourne 'W', 'L' ou 'D' selon les buts marqués et encaissés
function getResult(myGoals, theirGoals) {
  if (myGoals > theirGoals) return 'W'
  if (myGoals < theirGoals) return 'L'
  return 'D'
}

export function useTeamForm(selectedComp) {
  const { data } = useQuery({
    queryKey: ['teamForm', selectedComp],
    queryFn: async () => {
      const res = await fetch(
        `/api/v4/competitions/${selectedComp}/matches?status=FINISHED`
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

      return formMap
    },
    enabled:   !!selectedComp,  // ne pas fetch si compId est null (ex: modal match terminé)
    staleTime: 1000 * 60 * 30, // cache 30min
    retry: false
  })

  return { formMap: data ?? {} }
}