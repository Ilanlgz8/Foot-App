import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'

const STALE_MS = 1000 * 60 * 10  // 10min

// football-data.org v4 n'utilise PAS "ROUND_OF_32" (cette valeur n'existe pas
// dans leur enum `stage`) : la bonne valeur est "LAST_32". Avec l'ancienne
// constante, les 32es de finale (nouveau tour propre au format à 48 équipes
// de la CM 2026) étaient silencieusement filtrés hors du bracket — le tableau
// démarrait directement aux 8es, et comme les 8es affichés dans l'API restent
// des places provisoires tant que les 32es ne sont pas joués/actés, l'affiche
// pouvait rester fausse (ex: "Canada-Paraguay" au lieu de "Paraguay-France")
// jusqu'à ce que football-data.org mette à jour les vrais qualifiés.
export const KNOCKOUT_ORDER = [
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
]

export const KNOCKOUT_LABELS = {
  LAST_32:        'Seizièmes de finale',
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
      // Comme pour /matches et /scorers (voir useMatchs.js / useScorers.js) :
      // football-data.org résout la "saison courante" comme "celle qui a la
      // date de début la plus récente", une règle ambiguë pour une compétition
      // non-annuelle comme la CM. Sans ?season= explicite, l'endpoint peut
      // silencieusement retourner un jeu de données obsolète/incomplet — vu en
      // pratique : seuls 3 matchs de phase finale au lieu de tous ceux déjà joués.
      const wcSeason = new Date().getFullYear()
      async function tryFetch(url) {
        const r = await fdFetch(fdUrl(url))
        if (r.status === 403 || r.status === 429) throw new Error(String(r.status))
        if (!r.ok) return null
        const j = await r.json()
        return j.matches ?? null
      }
      let all = await tryFetch(`/api/v4/competitions/WC/matches?season=${wcSeason}`)
      if (!all || all.length === 0) {
        all = await tryFetch(`/api/v4/competitions/WC/matches`)
      }
      all = all ?? []

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
