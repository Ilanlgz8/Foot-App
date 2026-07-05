// useProbaCurve — lit la courbe de bascule agrégée d'un match (api/curve.js)
// pour l'afficher une fois le match terminé (voir <ProbaCurve>). Un match
// terminé ne change plus : staleTime infini, pas de polling.
import { useQuery } from '@tanstack/react-query'

export function useProbaCurve(matchId, enabled = true) {
  const id = matchId != null ? String(matchId) : null

  const { data, isLoading } = useQuery({
    queryKey: ['probaCurve', id],
    queryFn:  async () => {
      const res = await fetch(`/api/curve?matchId=${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error(`curve ${res.status}`)
      const json = await res.json()
      return json.samples ?? []
    },
    enabled:   !!id && enabled,
    staleTime: Infinity,
    retry:     1,
  })

  return { samples: data ?? [], isLoading }
}
