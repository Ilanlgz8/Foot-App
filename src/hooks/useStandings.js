import { useQuery } from '@tanstack/react-query'

const API_KEY = import.meta.env.VITE_API_KEY

export function useStandings(selectedComp) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', selectedComp],
    queryFn: async () => {
      const res = await fetch(
        `/api/v4/competitions/${selectedComp}/standings`,
        { headers: { 'X-Auth-Token': API_KEY } }
      )
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      return json.standings?.[0]?.table ?? []
    },
    staleTime: 1000 * 60 * 5,
  })

  return {
    standings: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
  }
}