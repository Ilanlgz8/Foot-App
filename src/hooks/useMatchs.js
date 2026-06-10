import { useQuery } from '@tanstack/react-query'

const API_KEY = import.meta.env.VITE_API_KEY

function groupByMatchday(matches, order = 'asc') {
  const groups = {}
  matches.forEach(match => {
    const day = match.matchday
    if (!groups[day]) groups[day] = []
    groups[day].push(match)
  })
  return Object.entries(groups).sort(([a], [b]) =>
    order === 'asc' ? Number(a) - Number(b) : Number(b) - Number(a)
  )
}

export function useMatches(selectedComp, status = 'SCHEDULED', order = 'asc') {
  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', selectedComp, status],
    queryFn: async () => {
      const res = await fetch(
        `/api/v4/competitions/${selectedComp}/matches?status=${status}`,
        { headers: { 'X-Auth-Token': API_KEY } }
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