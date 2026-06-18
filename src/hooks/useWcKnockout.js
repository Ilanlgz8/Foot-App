import { useQuery } from '@tanstack/react-query'
import { fdFetch } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'

const STALE_MS = 1000 * 60 * 10  // 10min

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

const EMPTY_ROUNDS = []
const CACHE_KEY = 'wc_knockout'

export function useWcKnockout() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['wc-knockout'],
    queryFn: async () => {
      const res = await fdFetch(`/api/v4/competitions/WC/matches`)
      if (res.status === 403 || res.status === 429) throw new Error(String(res.status))
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      const all = json.matches ?? []

      const knockout = all.filter(m => KNOCKOUT_ORDER.includes(m.stage))

      const rounds = []
      for (const stage of KNOCKOUT_ORDER) {
        const stageMatches = knockout.filter(m => m.stage === stage)
        if (stageMatches.length > 0) {
          rounds.push({ stage, label: KNOCKOUT_LABELS[stage], matches: stageMatches })
        }
      }

      writeCache(CACHE_KEY, rounds, STALE_MS)
      return rounds
    },
    initialData:          readCacheStale(CACHE_KEY) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(CACHE_KEY),
    staleTime:            STALE_MS,
    retry: false,
  })

  return {
    rounds:  data ?? EMPTY_ROUNDS,
    loading: isLoading,
    error:   error?.message ?? null,
  }
}
