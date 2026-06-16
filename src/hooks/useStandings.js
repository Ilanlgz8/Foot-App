import { useQuery } from '@tanstack/react-query'


export function useStandings(selectedComp) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', selectedComp],
    queryFn: async () => {
      const res = await fetch(`/api/v4/competitions/${selectedComp}/standings`)
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      const allGroups = json.standings ?? []

      // Compétitions à groupes multiples (CdM, LDC phase de ligue…)
      // On filtre les entrées parasites (type TOTAL, phase suivante, table à 1 équipe)
      const realGroups = allGroups.filter(g => g.group && (g.table?.length ?? 0) >= 2)

      if (realGroups.length > 1) {
        return {
          table: realGroups.flatMap(g => g.table ?? []),
          groups: realGroups.map(g => ({
            name: g.group,    // ex: "GROUP_A"
            table: g.table ?? [],
          })),
        }
      }

      // Championnat classique (1 seul groupe)
      return {
        table: allGroups[0]?.table ?? [],
        groups: [],
      }
    },
    staleTime: 1000 * 60 * 5,
  })

  return {
    standings: data?.table  ?? [],
    groups:    data?.groups ?? [],
    loading:   isLoading,
    error:     error?.message ?? null,
  }
}
