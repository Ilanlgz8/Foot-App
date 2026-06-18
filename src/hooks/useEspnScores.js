// Scores ESPN en temps réel pour les matchs live.
//
// Avant : ce hook faisait son propre poll ESPN toutes les 10s → doublon réseau
// avec useLiveMinute (20s). Total : 30 req/min pour 2 compétitions live.
//
// Maintenant : useLiveMinute extrait scores + buteurs + stats dans son propre poll
// (15s) et les pousse dans React Query ['espnScores'] via setQueryData.
// Ce hook est une lecture passive de ce cache — zéro fetch supplémentaire.
//
// Avantage : 1 seul poll ESPN au lieu de 2, données cohérentes (même snapshot),
// aucune désynchronisation entre clock/status et score.

import { useQuery } from '@tanstack/react-query'

/**
 * Retourne les scores ESPN pour les matchs live.
 * Les données sont injectées par useLiveMinute via queryClient.setQueryData.
 *
 * @returns {{ [matchId]: { home: number, away: number, scorers: Array, stats: object|null } }}
 */
export function useEspnScores() {
  const { data } = useQuery({
    queryKey:   ['espnScores'],
    queryFn:    () => ({}),  // jamais appelé — données injectées par useLiveMinute
    enabled:    false,       // pas de fetch automatique
    staleTime:  Infinity,
    gcTime:     Infinity,
    initialData: () => {
      try {
        const raw = localStorage.getItem('espn_scores_cache')
        return raw ? JSON.parse(raw) : {}
      } catch { return {} }
    },
  })

  return data ?? {}
}
