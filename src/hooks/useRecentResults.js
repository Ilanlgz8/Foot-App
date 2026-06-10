import { useQuery } from '@tanstack/react-query'
import { COMPETITIONS } from '../data/competitions'

const API_KEY = import.meta.env.VITE_API_KEY
const LEAGUE_COMPETITIONS = ['FL1', 'PL', 'PD', 'BL1', 'SA']

export function useRecentResults() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['recentResults'],
    queryFn: async () => {
      const results = await Promise.all(
        LEAGUE_COMPETITIONS.map(id =>
          fetch(`/api/v4/competitions/${id}/matches?status=FINISHED`, {
            headers: { 'X-Auth-Token': API_KEY }
          })
            .then(res => res.ok ? res.json() : { matches: [] })
            .then(json => {
              const matches = json.matches ?? []
              return matches.slice(-3).reverse().map(m => ({
                ...m,
                compId: id
              }))
            })
        )
      )
      return results.flat()
    },
    staleTime: 1000 * 60 * 10,
  })

  return {
    results: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
  }
}