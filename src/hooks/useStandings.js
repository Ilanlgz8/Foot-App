import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { classifyFetchError } from '../utils/fetchErrors'
import { COMPETITION_ESPN_SLUG } from '../data/competitions'

// Aligné sur le TTL du cache serveur (api/football.js).
const STALE_MS = 1000 * 60 * 2  // 2min (était 10min) — se met à jour pendant les matchs live

// ⚠️ AJOUT (idée utilisateur, 23/07 : "si y'a zéro match en live le classement
// va pas bouger donc ça sert à rien de repoller, mais dès qu'y'a un match en
// live dans le championnat regardé on autorise à repoller") : avant ça, AUCUN
// refetchInterval n'existait ici — rester sur la page Classement pendant un
// match ne mettait jamais rien à jour tout seul, il fallait quitter/revenir
// après le TTL de 2min pour voir un changement. Le classement ne peut de
// toute façon changer QUE si un match de CETTE compétition est en train de se
// terminer — polling gaté sur hasLiveMatch (passé par l'appelant, dérivé de
// useLiveData().liveMatches filtré sur selectedComp) : zéro requête
// supplémentaire les ~99% du temps où aucun match n'est en cours dans le
// championnat affiché, et re-poll automatique toutes les 5min uniquement
// pendant qu'un match de ce championnat est live — largement sous le TTL
// serveur (2min) donc jamais de gaspillage, juste une mise à jour qui arrive
// sans avoir à recharger la page. Comme toute requête React Query,
// refetchInterval se met nativement en pause si l'onglet n'est pas au premier
// plan (pas de refetchIntervalInBackground ici) — pas de poll en arrière-plan.
const LIVE_REFETCH_MS = 1000 * 60 * 5  // 5min

// ⚠️ AJOUT 2 (idée utilisateur, même jour : "si toute la journée y'a pas de
// match, autant garder le cache toute la journée plutôt que 2min, et dès
// qu'y'a un match [genre à 18h] on repasse en mode 2min") : STALE_MS (2min)
// n'a de sens QUE les jours où la compétition affichée joue — un classement
// ne peut pas changer sans match. hasMatchToday (passé par l'appelant, dérivé
// des matchs SCHEDULED+FINISHED du jour pour cette compétition — déjà chargés
// par ailleurs, zéro coût réseau en plus) bascule le staleTime : 24h les jours
// sans match (revisiter la page ne retape plus jamais la source), 2min les
// jours où ça joue (comportement actuel inchangé). Défaut à `true` (2min) si
// l'appelant ne précise rien — comportement identique à avant pour les autres
// call sites (FavoritesPage, MatchModal) qui n'ont pas cette info sous la main.
const NO_MATCH_STALE_MS = 1000 * 60 * 60 * 24  // 24h

// ⚠️ AJOUT 3 (question utilisateur : "si je consulte la page un peu avant
// minuit et que je reste dessus jusqu'à minuit 5, ça peut louper le coche
// comment on fait pour que ça loupe jamais ?") : hasMatchToday est recalculé
// à chaque re-render, donc correct à CHAQUE VISITE — mais un onglet resté
// ouvert EN CONTINU sur la même page, sans jamais se démonter/remonter, ne
// re-render jamais spontanément juste parce que minuit sonne (staleTime n'est
// pas un minuteur vivant, juste un seuil vérifié au prochain déclencheur).
// Minuteur dédié : programmé pour la prochaine minuit locale (+5s de marge),
// invalide explicitement la query au passage — force une vraie réévaluation
// (nouveau hasMatchToday calculé par le composant appelant au re-render
// causé par l'invalidation, nouveau staleTime appliqué) même si la page n'a
// jamais été quittée. Se reprogramme après chaque déclenchement (scheduleNext
// récursif) : couvre aussi une page restée ouverte plusieurs jours d'affilée,
// pas seulement la nuit suivante.
function useMidnightInvalidation(queryClient, selectedComp) {
  useEffect(() => {
    let id
    function scheduleNext() {
      const now  = new Date()
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
      id = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['standings', selectedComp] })
        scheduleNext()
      }, next.getTime() - now.getTime())
    }
    scheduleNext()
    return () => clearTimeout(id)
  }, [queryClient, selectedComp])
}

export function useStandings(selectedComp, hasLiveMatch = false, hasMatchToday = true) {
  const key = `standings_${selectedComp}`
  const queryClient = useQueryClient()
  useMidnightInvalidation(queryClient, selectedComp)

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
    staleTime:            hasMatchToday ? STALE_MS : NO_MATCH_STALE_MS,
    refetchInterval:      hasLiveMatch ? LIVE_REFETCH_MS : false,
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
