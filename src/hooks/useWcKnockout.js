import { useQuery } from '@tanstack/react-query'


/* Ordre des tours et libellés FR */
export const KNOCKOUT_ORDER = [
  'ROUND_OF_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
]

export const KNOCKOUT_LABELS = {
  ROUND_OF_32:    'Huitièmes de finale',
  LAST_16:        'Huitièmes de finale',
  QUARTER_FINALS: 'Quarts de finale',
  SEMI_FINALS:    'Demi-finales',
  THIRD_PLACE:    'Petite finale',
  FINAL:          'Finale',
}

/* Référence stable pour éviter que `data ?? []` recrée un tableau à chaque render */
const EMPTY_ROUNDS = []

export function useWcKnockout() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['wc-knockout'],
    queryFn: async () => {
      const res = await fetch(`/api/v4/competitions/WC/matches`)
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      const all = json.matches ?? []

      /* Ne garder que les tours à élimination directe */
      const knockout = all.filter(m => KNOCKOUT_ORDER.includes(m.stage))

      /* Indexer par stage dans l'ordre */
      const rounds = []
      for (const stage of KNOCKOUT_ORDER) {
        const stageMatches = knockout.filter(m => m.stage === stage)
        if (stageMatches.length > 0) {
          rounds.push({
            stage,
            label: KNOCKOUT_LABELS[stage],
            matches: stageMatches,
          })
        }
      }

      return rounds
    },
    staleTime: 1000 * 60 * 5,
  })

  return {
    rounds:  data ?? EMPTY_ROUNDS,
    loading: isLoading,
    error:   error?.message ?? null,
  }
}
