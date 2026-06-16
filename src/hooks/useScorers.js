import { useQuery } from '@tanstack/react-query'


export function useScorers(compId) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['scorers', compId],
    queryFn: async () => {
      const res = await fetch(`/api/v4/competitions/${compId}/scorers?limit=20`)
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      return json.scorers ?? []
    },
    staleTime: 1000 * 60 * 10,
    enabled: !!compId,
  })

  return {
    scorers: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
  }
}
