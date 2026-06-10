import { useQuery } from '@tanstack/react-query'

const API_KEY = import.meta.env.VITE_API_KEY
const TODAY_COMPETITIONS = ['FL1', 'PL', 'PD', 'BL1', 'SA', 'CL']

export function useTodayMatches() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['todayMatches'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

      const results = await Promise.all(
        TODAY_COMPETITIONS.map(comp =>
          fetch(
            `/api/v4/competitions/${comp}/matches?dateFrom=${today}&dateTo=${tomorrow}`,
            { headers: { 'X-Auth-Token': API_KEY } }
          )
            .then(res => res.ok ? res.json() : { matches: [] })
            .then(json => json.matches || [])
        )
      )

      return results.flat().sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    },
    staleTime: 1000 * 60 * 5,
  })

  return {
    matches: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
  }
}