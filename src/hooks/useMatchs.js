import { useQuery } from '@tanstack/react-query'


function groupByMatchday(matches, order = 'asc') {
  const groups = {}
  matches.forEach(match => {
    const day = match.matchday
    if (!groups[day]) groups[day] = []
    groups[day].push(match)
  })
  // Trier les matchs dans chaque groupe par date (desc si order=desc, asc sinon)
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

export function useMatches(selectedComp, status = 'SCHEDULED', order = 'asc') {
  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', selectedComp, status],
    queryFn: async () => {
      const res = await fetch(
        `/api/v4/competitions/${selectedComp}/matches?status=${status}`
      )
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      return json.matches ?? []
    },
    staleTime: 1000 * 60 * 5, // cache 5 minutes
  })

  return {
    matches: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
    grouped: groupByMatchday(data ?? [], order),
  }
}