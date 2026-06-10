import { useQuery } from '@tanstack/react-query'
import { COMPETITIONS } from '../data/competitions'

const API_KEY = import.meta.env.VITE_API_KEY

const LEAGUE_COMPETITIONS = ['FL1', 'PL', 'PD', 'BL1', 'SA']

export function useTopStandings() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['topStandings'],
    queryFn: async () => {
      const results = await Promise.all(
        LEAGUE_COMPETITIONS.map(id =>
          fetch(`/api/v4/competitions/${id}/standings`, {
            headers: { 'X-Auth-Token': API_KEY }
          })
            .then(res => res.ok ? res.json() : null)
            .then(json => ({
              comp: COMPETITIONS.find(c => c.id === id),
              table: json?.standings?.[0]?.table?.slice(0, 5) ?? []
            }))
        )
      )
      return results.filter(r => r.table.length > 0)
    },
    staleTime: 1000 * 60 * 10,
  })

  return {
    standings: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
  }
}