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
    // ⚠️ ORDRE DES SOURCES (demande utilisateur explicite, 23/07 : "si the
    // sport db n'a pas mis a jour on passe a espn et si espn n'a pas
    // ftdata.org") : pour les 5 championnats où TheSportsDB est vérifié
    // (voir COMPETITION_SPORTSDB_LEAGUE), l'ordre est désormais
    // TheSportsDB → ESPN → FD.org → cache stale — les deux sources
    // gratuites/sans clé/jamais suspendues sur ce projet sont épuisées
    // AVANT de toucher FD.org, dont le budget global est fragile (comptes
    // suspendus à répétition, voir api/football.js). FD.org reste la
    // source PRIMAIRE pour les compétitions non couvertes par TheSportsDB
    // (CL/WC/EC/NL/CAN/COPA), comportement inchangé pour elles : FD.org →
    // ESPN → cache stale.
    //
    // Honnêteté sur le compromis : TheSportsDB est une base communautaire,
    // pas un flux temps réel — `dateUpdated` observé lors des tests (23/07)
    // montrait des mises à jour espacées de plusieurs jours, pas après
    // chaque match. Si TheSportsDB est en retard, ESPN (temps quasi réel)
    // prend le relais avant même d'envisager FD.org.
    queryFn: async () => {
      const sportsDbLeague = COMPETITION_SPORTSDB_LEAGUE[selectedComp]
      const espnSlug       = COMPETITION_ESPN_SLUG[selectedComp]

      const tryTheSportsDb = async () => {
        try {
          const sdbRes = await fetch(`/espn?sportsdbLeague=${sportsDbLeague}`)
          if (sdbRes.ok) {
            const sdbResult = await sdbRes.json()
            if ((sdbResult.table?.length ?? 0) > 0) return sdbResult
          }
        } catch { /* → repli suivant */ }
        return null
      }

      const tryEspn = async () => {
        if (!espnSlug) return null
        try {
          const espnRes = await fetch(`/espn?slug=${espnSlug}&standings=1`)
          if (espnRes.ok) {
            const espnResult = await espnRes.json()
            if ((espnResult.table?.length ?? 0) > 0 || (espnResult.groups?.length ?? 0) > 0) return espnResult
          }
        } catch { /* → repli suivant */ }
        return null
      }

      // ⚠️ BUG CORRIGÉ (constat utilisateur : "j'avais le classement, 5min après
      // plus rien, sans erreur visible") : ce fetch n'était entouré d'AUCUN
      // try/catch — combiné à `retry: false`, une SEULE erreur transitoire
      // (réseau, 429/403 le temps qu'un nouveau compte FD.org se stabilise,
      // blip Redis côté serveur...) faisait échouer la requête DÉFINITIVEMENT
      // (React Query n'insiste pas sans retry), sans aucun repli —
      // contrairement à l'intention du reste du fichier (readCacheStale
      // existe déjà comme filet de secours, mais n'était en réalité jamais
      // atteint sur ce chemin d'erreur). Même mécanisme déjà trouvé et
      // corrigé côté ESPN (fetchEspnCompMatches/fetchEspnCupMatches,
      // espnAdapter.js) — appliqué ici pour rester cohérent.
      const tryFdOrg = async () => {
        const res = await fdFetch(fdUrl(`/api/v4/competitions/${selectedComp}/standings`))
        if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
        if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
        const json = await res.json()
        const allGroups = json.standings ?? []
        const realGroups = allGroups.filter(g => g.group && (g.table?.length ?? 0) >= 2)
        return realGroups.length > 1
          ? {
              table: realGroups.flatMap(g => g.table ?? []),
              groups: realGroups.map(g => ({ name: g.group, table: g.table ?? [] })),
            }
          : {
              table: allGroups[0]?.table ?? [],
              groups: [],
            }
      }

      if (sportsDbLeague) {
        const sdbResult = await tryTheSportsDb()
        if (sdbResult) { writeCache(key, sdbResult, STALE_MS); return sdbResult }

        const espnResult = await tryEspn()
        if (espnResult) { writeCache(key, espnResult, STALE_MS); return espnResult }

        try {
          const fdResult = await tryFdOrg()
          writeCache(key, fdResult, STALE_MS)
          return fdResult
        } catch (err) {
          const stale = readCacheStale(key)
          if (stale) return stale
          throw err
        }
      }

      // Compétitions non couvertes par TheSportsDB : comportement historique
      // inchangé (FD.org primaire, ESPN en repli).
      try {
        const fdResult = await tryFdOrg()
        writeCache(key, fdResult, STALE_MS)
        return fdResult
      } catch (err) {
        const espnResult = await tryEspn()
        if (espnResult) { writeCache(key, espnResult, STALE_MS); return espnResult }

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
