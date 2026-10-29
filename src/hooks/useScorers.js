import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { classifyFetchError } from '../utils/fetchErrors'
import { registerFdCallAttempt, waitForFdSpacing } from '../utils/fdSpacingTracker'
import { NO_SCORERS_COMPS } from '../data/competitions'

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
// ⚠️ Source ESPN AJOUTÉE PUIS RETIRÉE LE MÊME JOUR (26/09) : après le constat
// utilisateur "y'a pas... le classement des meilleurs buteurs dans ligue des
// nations", `/apis/site/v2/sports/soccer/{slug}/statistics` avait d'abord été
// branché ici (endpoint jamais essayé jusque-là, voir historique CLAUDE.md
// pour /leaders et TheSportsDB, tous deux vides). Retiré quelques minutes
// après déploiement : constat utilisateur PRÉCIS et vérifiable ("impossible
// que haaland il est 4 buts et joao felix 2 vu que y'avait meme pas 4 buts et
// 1 but au portugal seulement") — recroisé en direct avec les VRAIS totaux
// d'équipe de ce même ESPN (`/apis/v2/sports/soccer/uefa.nations/standings`) :
// Portugal n'a marqué QUE 1 but au total (1 match joué) alors que João Félix
// seul apparaissait à 2 ; la Norvège n'a marqué QUE 3 buts au total alors que
// Haaland (4) + Bobb (2) totalisaient 6 à eux deux. Mathématiquement
// impossible si l'endpoint reflétait la saison en cours — very probablement
// un cumul historique/all-time de la compétition (toutes éditions confondues)
// plutôt qu'un classement de la saison affichée, aucun paramètre de
// filtrage par saison/édition trouvé sur cet endpoint pour le corriger.
// CAN/COPA/UEL/UECL restent dans `NO_SCORERS_COMPS` (bouton "Buteurs" caché
// pour ces 4, voir Classement.jsx) — gap honnêtement documenté plutôt qu'une
// donnée fausse affichée. `compactEspnScorers`/le mode `scorers=1` de
// `api/espn.js` ont été retirés avec ce revert (code mort, plus aucun
// appelant) — voir CLAUDE.md pour l'historique complet de cette tentative.
//
// ⚠️ NL relancée le même jour via un calcul MAISON, puis RETIRÉE le 30/09
// (demande explicite utilisateur, feature qui n'affichait jamais rien tant
// que le quota Upstash reste épuisé — voir NO_SCORERS_COMPS, competitions.js,
// pour l'historique complet). NL rejoint CAN/COPA/UEL/UECL, aucune des 5 n'a
// de source de buteurs fiable actuellement.
// ⚠️ EXTRAIT (28/10, demande utilisateur : meilleurs buteurs de l'équipe
// dans la fiche équipe, voir TeamSearchPage.jsx) : la logique de fetch
// (NO_SCORERS_COMPS, repli limit=500→100, repli cache stale) vivait jusqu'ici
// inline dans le `queryFn` de useScorers — extraite ici en fonction pure
// réutilisable par useTeamScorersMulti (useTeamSearch.js), SANS AUCUN
// changement de comportement : useScorers l'appelle désormais elle aussi, à
// l'identique. Partage la MÊME queryKey (['scorers', compId]) que ce hook —
// un classement buteurs déjà consulté via la page Classement n'est jamais
// re-fetché pour la fiche équipe, et vice-versa.
export async function fetchScorersData(compId, delayMs = 0) {
  const key = `scorers3_${compId}`

  if (NO_SCORERS_COMPS.has(compId)) { writeCache(key, [], STALE_MS); return [] }

  if (delayMs > 0) await waitForFdSpacing(delayMs)
  const isAnnualIntl = compId === 'WC' || compId === 'EC'
  const season = new Date().getFullYear()

  async function tryFetch(url) {
    const fetchPromise = fdFetch(fdUrl(url))
    registerFdCallAttempt(fetchPromise.then(resp => !resp.headers.get('X-Cache')).catch(() => false))
    const r = await fetchPromise
    if (r.status === 429 || r.status === 403) throw new Error(String(r.status))
    const fresh = !r.headers.get('X-Cache')
    if (!r.ok) throw new Error(String(r.status))
    const j = await r.json()
    return { scorers: j.scorers ?? null, fresh }
  }

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
        if (e.message === '429' || e.message === '403') throw e
        const r3 = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=100`)
        scorers = r3.scorers
      }
    }
  } catch (err) {
    const stale = readCacheStale(key)
    if (stale) return stale
    throw err
  }
  scorers = scorers ?? []
  writeCache(key, scorers, STALE_MS)
  return scorers
}

export function useScorers(compId, hasMatchToday = true, delayMs = 0) {
  // ⚠️ Clé bumpée scorers_ → scorers2_ (même fix qu'ailleurs dans l'app pour
  // ce type de bug, voir Pronos.jsx classement) : le bug corrigé ci-dessus
  // (tryFetch) a pu déjà écrire un [] en cache localStorage AVANT ce
  // déploiement, avec un staleTime allant jusqu'à 24h (NO_MATCH_STALE_MS) —
  // sans ce bump, un appareil déjà "empoisonné" continuerait d'afficher
  // "Aucun buteur disponible" jusqu'à l'expiration naturelle de ce cache
  // périmé. Changer la clé fait repartir de zéro instantanément pour tout
  // le monde, sans jamais devoir attendre.
  // ⚠️ Re-bumpée scorers2_ → scorers3_ (28/08, 2e bug trouvé le même jour,
  // voir le `throw err` ci-dessous) : le tout premier déploiement du fix
  // précédent a pu, sur certains appareils, essuyer un 429 (budget FD.org
  // partagé, cf CLAUDE.md) juste après le changement de clé — cet ancien
  // code avalait alors l'erreur et écrivait quand même un faux [] sous
  // scorers2_. TTL court (2min) donc pas critique, mais autant repartir
  // propre plutôt que d'attendre une expiration naturelle.
  const key = `scorers3_${compId}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['scorers', compId],
    // ⚠️ Logique de fetch déplacée dans fetchScorersData (voir juste avant
    // cette fonction, extraction du 28/10) — appelée ici à l'identique,
    // aucun changement de comportement.
    queryFn: () => fetchScorersData(compId, delayMs),
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            hasMatchToday ? STALE_MS : NO_MATCH_STALE_MS,
    // ⚠️ BUG CORRIGÉ (constat utilisateur, 02/09 : "le classement des buteurs
    // a du mal à se charger, faut changer de championnat et revenir sur celui
    // qu'on voulait voir"). Ce `retry: false` était la cause exacte du
    // symptôme décrit : sur la page Classement, TROIS hooks visent
    // football-data.org pour la même compétition au même instant (standings,
    // forme récente, buteurs) et se disputent le verrou d'espacement global.
    // Les buteurs partent EN DERNIER (delayMs 12s, le plus gros stagger), donc
    // c'est celui qui perd le plus souvent la course et se prend un 429.
    // Sans retry, un seul échec transitoire laissait la liste vide DÉFINITIVEMENT
    // — jusqu'à ce que l'utilisateur quitte le championnat et y revienne, ce
    // qui remonte le composant et relance la requête. D'où sa manip.
    // Les deux autres hooks avaient déjà leur filet (useStandings a un repli
    // ESPN + copie stale, useTeamForm a `retry: 2`) ; les buteurs étaient les
    // seuls à n'en avoir aucun — et c'est justement la donnée pour laquelle il
    // n'existe AUCUNE source de secours gratuite (voir CLAUDE.md, gap connu).
    // Backoff volontairement LONG (8s puis 16s) : le verrou d'espacement
    // serveur dure ~7,5s (SPACING_MS = 60000/MINUTE_CAP, voir api/football.js).
    // Retenter plus tôt retomberait dans le même verrou et gâcherait l'essai
    // sans rien tenter de réel.
    retry: 2,
    retryDelay: attempt => 8_000 * (attempt + 1),
    enabled: !!compId,
  })

  return {
    scorers: data ?? [],
    loading: isLoading,
    // Voir classifyFetchError (utils/fetchErrors.js).
    error:   classifyFetchError(error?.message),
  }
}
