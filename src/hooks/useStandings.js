import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { classifyFetchError } from '../utils/fetchErrors'
import { COMPETITION_ESPN_SLUG, COMPETITION_SPORTSDB_LEAGUE } from '../data/competitions'

// Aligné sur le TTL du cache serveur (api/football.js).
const STALE_MS = 1000 * 60 * 2  // 2min (était 10min) — se met à jour pendant les matchs live

export function useStandings(selectedComp) {
  const key = `standings_${selectedComp}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['standings', selectedComp],
    // ⚠️ BUG CORRIGÉ (constat utilisateur : "j'avais le classement, 5min après
    // plus rien, sans erreur visible") : le throw ci-dessous (429/403/!ok)
    // n'était entouré d'AUCUN try/catch — combiné à `retry: false`, une SEULE
    // erreur transitoire (réseau, 429/403 le temps qu'un nouveau compte
    // FD.org se stabilise, blip Redis côté serveur...) faisait échouer la
    // requête DÉFINITIVEMENT (React Query n'insiste pas sans retry), sans
    // aucun repli — contrairement à l'intention du reste du fichier
    // (readCacheStale existe déjà comme filet de secours, mais n'était en
    // réalité jamais atteint sur ce chemin d'erreur). Même mécanisme déjà
    // trouvé et corrigé côté ESPN (fetchEspnCompMatches/fetchEspnCupMatches,
    // espnAdapter.js) — appliqué ici pour rester cohérent.
    queryFn: async () => {
      try {
        const res = await fdFetch(fdUrl(`/api/v4/competitions/${selectedComp}/standings`))
        if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
        if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
        const json = await res.json()
        const allGroups = json.standings ?? []

        const realGroups = allGroups.filter(g => g.group && (g.table?.length ?? 0) >= 2)

        const result = realGroups.length > 1
          ? {
              table: realGroups.flatMap(g => g.table ?? []),
              groups: realGroups.map(g => ({ name: g.group, table: g.table ?? [] })),
            }
          : {
              table: allGroups[0]?.table ?? [],
              groups: [],
            }

        writeCache(key, result, STALE_MS)
        return result
      } catch (err) {
        // ⚠️ AJOUT (demande utilisateur, suite aux suspensions répétées du
        // compte football-data.org) : repli sur ESPN — source de secours
        // indépendante, gratuite, sans clé, jamais suspendue sur ce projet —
        // AVANT le repli sur le cache stale local. Réduit la dépendance à
        // FD.org : un incident FD.org (429/403/panne/suspension) n'empêche
        // plus d'afficher un classement à jour, tant qu'ESPN répond. Aucun
        // effet si la compétition n'a pas de slug ESPN connu (voir
        // COMPETITION_ESPN_SLUG) ou si ESPN échoue aussi — on retombe alors
        // sur le comportement existant (cache stale, puis erreur).
        const espnSlug = COMPETITION_ESPN_SLUG[selectedComp]
        if (espnSlug) {
          try {
            const espnRes = await fetch(`/espn?slug=${espnSlug}&standings=1`)
            if (espnRes.ok) {
              const espnResult = await espnRes.json()
              if ((espnResult.table?.length ?? 0) > 0 || (espnResult.groups?.length ?? 0) > 0) {
                writeCache(key, espnResult, STALE_MS)
                return espnResult
              }
            }
          } catch { /* ESPN aussi indisponible → repli TheSportsDB puis stale ci-dessous */ }
        }

        // ⚠️ AJOUT (demande utilisateur, 23/07 : "faut rien que ça casse") : 3e
        // repli, uniquement pour les 5 grands championnats domestiques où
        // TheSportsDB a été vérifié par appel réel (voir
        // COMPETITION_SPORTSDB_LEAGUE + compactSportsDbStandings). N'existe
        // que pour couvrir le cas rare où FD.org ET ESPN échouent tous les
        // deux en même temps — n'a jamais d'effet tant qu'ESPN répond.
        const sportsDbLeague = COMPETITION_SPORTSDB_LEAGUE[selectedComp]
        if (sportsDbLeague) {
          try {
            const sdbRes = await fetch(`/espn?sportsdbLeague=${sportsDbLeague}`)
            if (sdbRes.ok) {
              const sdbResult = await sdbRes.json()
              if ((sdbResult.table?.length ?? 0) > 0) {
                writeCache(key, sdbResult, STALE_MS)
                return sdbResult
              }
            }
          } catch { /* TheSportsDB aussi indisponible → repli stale ci-dessous */ }
        }

        const stale = readCacheStale(key)
        if (stale) return stale
        throw err
      }
    },
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            STALE_MS,
    retry: false,
    enabled: !!selectedComp,
  })

  return {
    standings: data?.table  ?? [],
    groups:    data?.groups ?? [],
    loading:   isLoading,
    // Voir classifyFetchError (utils/fetchErrors.js) : un 429/403 FD.org est
    // transitoire et déjà géré côté serveur (cache stale + circuit breaker,
    // voir api/football.js) — affiche un message "réessaie plus tard" plutôt
    // que le code HTTP brut ou un silence qui laisserait penser à tort qu'il
    // n'y a aucune donnée.
    error:     classifyFetchError(error?.message),
  }
}
