import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { classifyFetchError } from '../utils/fetchErrors'
import { COMPETITION_ESPN_SLUG } from '../data/competitions'

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
    // ⚠️ TheSportsDB RETIRÉ (23/07, quelques heures après son ajout) : la clé
    // publique gratuite (`3`) plafonne `lookuptable.php` à 5 lignes SEULEMENT,
    // quelle que soit la ligue — confirmé par 2 appels réels indépendants
    // (Premier League, French Ligue 1), toujours exactement 5 équipes malgré
    // une vraie ligue à 18-20. Mon erreur : la vérification initiale n'avait
    // comparé que le TOP 5 (Arsenal/Man City/... à la bonne place) sans
    // jamais vérifier la longueur totale de la liste — donc jamais détecté
    // que le reste du classement (relégation comprise) manquait purement et
    // simplement. Un classement à 5 lignes est pire qu'aucun classement
    // (trompeur), donc retiré entièrement plutôt que corrigé : rien dans
    // l'offre gratuite de TheSportsDB ne permet d'obtenir la liste complète.
    // Voir l'historique git pour le détail (ajouté puis retiré le même jour).
    queryFn: async () => {
      const espnSlug = COMPETITION_ESPN_SLUG[selectedComp]

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
