import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { classifyFetchError } from '../utils/fetchErrors'
import { registerFdCallAttempt, waitForFdSpacing } from '../utils/fdSpacingTracker'

// Aligné sur le TTL du cache serveur (api/football.js) — inutile d'être plus frais
// côté client que la donnée que le serveur peut réellement fournir.
const STALE_MS = 1000 * 60 * 2  // 2min (était 30min)

// ⚠️ AJOUT (même optimisation que useStandings.js, 23/07 — idée utilisateur
// appliquée par cohérence ici aussi) : les buteurs ne peuvent pas plus
// changer que le classement sans match — 2min tout le temps, même les jours
// sans aucun match pour cette compétition, n'avait pas de sens. hasMatchToday
// (passé par l'appelant, même valeur déjà calculée pour useStandings dans
// Classement.jsx — aucun calcul en double) bascule le staleTime : 24h les
// jours sans match, 2min les jours où ça joue.
const NO_MATCH_STALE_MS = 1000 * 60 * 60 * 24  // 24h

// ⚠️ AJOUT `delayMs` (24/07, trouvé via l'audit chronologique demandé par
// l'utilisateur) : Classement.jsx appelle useStandings + useTeamForm +
// useScorers pour LA MÊME compétition quasi au même instant à chaque
// changement de championnat — 3 hooks indépendants, aucun ne sait que les
// autres existent, donc aucun espacement entre eux malgré le même verrou
// FD.org global. Résultat concret : sur un championnat jamais consulté cette
// session (pas de repli stale possible), 2 des 3 requêtes perdent la course
// au verrou et échouent (buteurs/forme vides le temps d'un retry). Défaut à 0
// (comportement inchangé pour tout autre appelant — MatchPage.jsx,
// MatchPoster.jsx, LiveMatchPage.jsx... qui n'appellent jamais useStandings
// en parallèle) — seuls Classement.jsx et ClassementTab (MatchModal.jsx, même
// collision : standings+form ensemble) passent un délai explicite.
export function useScorers(compId, hasMatchToday = true, delayMs = 0) {
  // ⚠️ Clé bumpée scorers_ → scorers2_ (même fix qu'ailleurs dans l'app pour
  // ce type de bug, voir Pronos.jsx classement) : le bug corrigé ci-dessus
  // (tryFetch) a pu déjà écrire un [] en cache localStorage AVANT ce
  // déploiement, avec un staleTime allant jusqu'à 24h (NO_MATCH_STALE_MS) —
  // sans ce bump, un appareil déjà "empoisonné" continuerait d'afficher
  // "Aucun buteur disponible" jusqu'à l'expiration naturelle de ce cache
  // périmé. Changer la clé fait repartir de zéro instantanément pour tout
  // le monde, sans jamais devoir attendre.
  const key = `scorers2_${compId}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['scorers', compId],
    queryFn: async () => {
      // delayMs>0 : attente ADAPTATIVE (voir fdSpacingTracker.js), pas un
      // délai fixe — 0ms si aucun hook voisin (useStandings/useTeamForm,
      // même page) n'a vraiment tapé FD.org juste avant.
      if (delayMs > 0) await waitForFdSpacing(delayMs)
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
        // Enregistré AVANT le await (voir fdSpacingTracker.js).
        const fetchPromise = fdFetch(fdUrl(url))
        registerFdCallAttempt(fetchPromise.then(resp => !resp.headers.get('X-Cache')).catch(() => false))
        const r = await fetchPromise
        if (r.status === 429 || r.status === 403) throw new Error(String(r.status))
        const fresh = !r.headers.get('X-Cache')
        // ⚠️ BUG CORRIGÉ (constat utilisateur : "aucun buteur disponible" sur
        // La Liga/Serie A alors que l'API a bien de vraies données — confirmé
        // par appel réel direct sur /api/football?...scorers&limit=500,
        // timeout backend FD.org reproduit plusieurs fois sur CES 2 comps
        // précises à ce volume, alors que PL/FL1 répondent normalement) :
        // un !r.ok (timeout, 500...) retournait { scorers: null } SANS lever
        // d'exception — `scorers` finissait réécrit en [] plus bas et ÉCRIT
        // EN CACHE comme une vraie réponse "0 buteur" (2min, ou 24h si
        // NO_MATCH_STALE_MS) : un échec transitoire devenait un faux "aucun
        // buteur" persistant. Lève maintenant une exception sur TOUT !r.ok,
        // pas seulement 429/403 — tombe dans le vrai filet plus bas (repli
        // limit=100, puis readCacheStale), jamais un [] inventé.
        if (!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        return { scorers: j.scorers ?? null, fresh }
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
        let fresh = false
        if (isAnnualIntl) {
          const r = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=500&season=${season}`)
          scorers = r.scorers
          fresh = r.fresh
        }
        if (!scorers || scorers.length === 0) {
          if (fresh) await new Promise(res => setTimeout(res, 6_000))
          try {
            const r2 = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=500`)
            scorers = r2.scorers
          } catch (e) {
            // 429/403 : problème de compte/quota, pas de volume — retenter à
            // un limit plus bas n'y changerait rien, direction le filet
            // readCacheStale du catch englobant, comme avant.
            if (e.message === '429' || e.message === '403') throw e
            // ⚠️ AJOUT — filet spécifique au bug ci-dessus (voir tryFetch) :
            // limit=500 a été vu timeout côté backend FD.org précisément sur
            // La Liga et la Serie A (reproduit plusieurs fois, appel réel),
            // alors qu'un limit plus bas répond instantanément avec de vraies
            // données. Un dernier essai à limit=100 avant d'abandonner —
            // couvre largement les buteurs réellement utiles à l'affichage
            // (voir Classement.jsx), sans rien changer pour les compétitions
            // où limit=500 marchait déjà (tenté en 1er, ce repli n'est qu'un
            // 2e filet, jamais utilisé si le 1er essai réussit).
            const r3 = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=100`)
            scorers = r3.scorers
          }
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
    staleTime:            hasMatchToday ? STALE_MS : NO_MATCH_STALE_MS,
    retry: false,
    enabled: !!compId,
  })

  return {
    scorers: data ?? [],
    loading: isLoading,
    // Voir classifyFetchError (utils/fetchErrors.js).
    error:   classifyFetchError(error?.message),
  }
}
