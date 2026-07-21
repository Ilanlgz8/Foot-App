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

      // limit=500 : le paramètre "limit" n'est pas documenté officiellement
      // pour /scorers (seuls season/matchday le sont dans la doc FD.org),
      // mais il fonctionne déjà en pratique (validé avec 20 puis 100), et la
      // doc générale FD.org confirme un paramètre limit [1-500] sur d'autres
      // ressources de liste de la même API — 500 couvre en pratique TOUTE
      // compétition réelle (une Coupe du Monde n'a jamais plus de ~250
      // buteurs différents), donc plus de raison de rater un joueur cherché
      // par équipe/pays dans la barre de recherche. Si l'API plafonne quand
      // même plus bas en interne, on récupère simplement moins — pas d'erreur.
      // ⚠️ BUG CORRIGÉ (même mécanisme que useStandings.js/useMatchs.js —
      // constat utilisateur : "j'avais tout, 5min après plus rien") : tryFetch
      // lève une exception sur 429/403, jamais interceptée ici → avec
      // `retry: false`, une seule erreur transitoire faisait disparaître les
      // buteurs sans repli, malgré readCacheStale déjà en place plus bas pour
      // le cas "réponse vide".
      let scorers = null
      try {
        if (isAnnualIntl) {
          scorers = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=500&season=${season}`)
        }
        if (!scorers || scorers.length === 0) {
          scorers = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=500`)
        }
      } catch {
        const stale = readCacheStale(key)
        if (stale) return stale
        scorers = null
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
    // Voir le commentaire sur isSilentFetchError dans useMatchs.js.
    error:   (error?.message === '429' || error?.message === '403') ? null : (error?.message ?? null),
  }
}
