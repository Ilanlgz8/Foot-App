import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'

// Aligné sur le TTL du cache serveur (api/football.js) — inutile d'être plus frais
// côté client que la donnée que le serveur peut réellement fournir.
const STALE_MS = 1000 * 60 * 2  // 2min (était 30min)

export function useScorers(compId) {
  const key = `scorers_${compId}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['scorers', compId],
    queryFn: async () => {
      // football-data.org résout la "saison courante" comme "la saison à la date
      // de début la plus récente" (doc officielle) — pour une compétition annuelle
      // (WC, EC) qui ne revient que tous les 4 ans, ça peut pointer sur l'édition
      // précédente au lieu de l'actuelle si on ne force pas ?season=. C'est déjà
      // le cas connu pour /matches (voir useMatchs.js) et ça explique très
      // probablement un classement buteurs qui semble "figé" à la phase de poules :
      // sans season explicite, on lisait peut-être une saison qui n'était plus
      // mise à jour en phase à élimination directe.
      const isAnnualIntl = compId === 'WC' || compId === 'EC'
      const season = new Date().getFullYear()

      async function tryFetch(url) {
        const r = await fdFetch(fdUrl(url))
        if (r.status === 429 || r.status === 403) throw new Error(String(r.status))
        if (!r.ok) return null
        const j = await r.json()
        return j.scorers ?? null
      }

      // limit=100 (au lieu de 20) : le paramètre "limit" n'est pas documenté
      // officiellement pour /scorers (seuls season/matchday le sont dans la
      // doc FD.org), mais il fonctionne déjà en pratique avec 20, et la doc
      // générale FD.org mentionne 100 comme plafond par défaut "overridable"
      // pour les ressources de liste — 100 est donc une valeur raisonnable
      // et sûre pour élargir la liste (utile pour la recherche par
      // pays/équipe : un buteur peut exister au-delà du top 20 affiché).
      // Non garanti de couvrir absolument TOUS les buteurs si l'API impose
      // un plafond serveur plus bas — c'est une vraie limite de la source
      // gratuite, pas quelque chose de contournable côté client.
      let scorers = null
      if (isAnnualIntl) {
        scorers = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=100&season=${season}`)
      }
      if (!scorers || scorers.length === 0) {
        scorers = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=100`)
      }
      scorers = scorers ?? []
      writeCache(key, scorers, STALE_MS)
      return scorers
    },
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            STALE_MS,
    retry: false,
    enabled: !!compId,
  })

  return {
    scorers: data ?? [],
    loading: isLoading,
    error:   error?.message ?? null,
  }
}
