/**
 * fdFetch — wrapper pour football-data.org (proxy /api/football)
 *
 * ⚠️ CHANGEMENT (constat utilisateur : "on se prend un méchant tunnel à
 * attendre parce qu'on a déjà fait trop de requêtes en 1min") : ce fichier
 * bloquait AVANT chaque appel via waitForSlot(), une attente synchrone
 * pouvant aller jusqu'à 60s dès que 25 requêtes clientes avaient été émises
 * dans la dernière minute — c'était littéralement le "tunnel" ressenti (l'app
 * semble figée pendant que ce setTimeout tourne en boucle).
 *
 * Cette protection cliente était de toute façon la mauvaise couche : elle ne
 * protège qu'UN SEUL navigateur, sans savoir combien d'autres utilisateurs
 * interrogent /api/football au même moment — donc ni suffisante pour
 * vraiment garantir de rester sous les 10 req/min réels de FD.org (partagés
 * par TOUS les utilisateurs), ni nécessaire pour ça (le cache Redis déjà en
 * place protège les requêtes répétées).
 *
 * La vraie protection vit maintenant côté serveur (api/football.js) : budget
 * global partagé (Redis, tous utilisateurs confondus) + copie "stale" servie
 * en secours si le budget est épuisé ou qu'un vrai 429 survient — le client
 * n'a donc plus besoin d'attendre quoi que ce soit avant d'appeler, il reçoit
 * toujours une réponse rapide (fraîche ou légèrement périmée), jamais un gel.
 */

/**
 * ⚠️ AJOUT (constat utilisateur : "skeleton bloqué au lancement sur mobile") :
 * fetch() n'avait AUCUN timeout ici. Sur un réseau mobile qui répond mal
 * (4G faible, bascule wifi/4G, requête qui part mais ne revient jamais), la
 * promesse ne se résout NI en succès NI en erreur → React Query reste
 * bloqué en isLoading:true pour toujours, et le skeleton ne disparaît
 * jamais, même en rouvrant l'app (le cache localStorage de la requête
 * précédente peut lui-même être vide/perimé selon le cas). Avant, rien ne
 * pouvait débloquer ça côté client. Maintenant : timeout dur de 15s, la
 * requête échoue proprement (React Query passe isLoading:false), l'appelant
 * peut afficher une erreur / retomber sur du cache au lieu de rester figé.
 */
// ⚠️ AJOUT (demande utilisateur : détecter un réseau trop faible/lent pour
// afficher un message dédié — voir useNetworkQuality.js) : un timeout (15s
// ci-dessous) ou une erreur réseau (fetch rejeté, pas de connexion établie)
// est un signal concret de connexion dégradée — reportFetchFailure()
// alimente la fenêtre glissante utilisée par useWeakNetwork(). Purement
// informatif : ne change ni ne retarde le comportement de fdFetch, l'appel
// reste rejeté exactement comme avant pour l'appelant.
import { reportFetchFailure } from '../hooks/useNetworkQuality'
// ⚠️ AJOUT (04/09, constat utilisateur "le logo Monaco a l'air flou") : 8 clubs
// de l'élite n'ont qu'un écusson 70×70 chez football-data.org. Voir
// crestOverrides.js pour la liste vérifiée et le raisonnement complet.
import { overrideCrestUrls } from '../data/crestOverrides'
// ⚠️ AJOUT (04/09) : football-data.org renvoyait une DATE dans le champ
// `status` de 92 matchs de Ligue 1, ce qui les faisait disparaître de
// Programme, Résultats et de la forme récente. Voir fdRepair.js pour le
// diagnostic complet — la réparation est inerte quand la source va bien.
import { repairFdBody } from './fdRepair'

/**
 * Réécrit les URLs d'écusson basse résolution dans le corps de la réponse.
 *
 * Point d'application unique et volontaire : TOUT le trafic football-data.org
 * de l'app passe par fdFetch (vérifié), donc corriger ici couvre matchs,
 * classements, buteurs et confrontations d'un seul coup, sans toucher aux
 * ~20 composants qui affichent un `team.crest`.
 *
 * Le corps est lu puis réemballé dans une nouvelle Response : les appelants
 * continuent d'utiliser `.json()`, `.ok`, `.status` et surtout l'en-tête
 * `X-Cache` (lu par registerFdCallAttempt dans plusieurs hooks) exactement
 * comme avant — les en-têtes sont recopiés tels quels, à l'exception de
 * content-length / content-encoding qui décrivaient le corps compressé
 * d'origine et n'ont plus de sens sur un corps reconstruit.
 */
async function withSharpCrests(res) {
  const text = await res.text()
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  // Deux réécritures enchaînées sur le même corps, toutes deux sans effet
  // quand il n'y a rien à corriger : écussons basse résolution, puis statuts
  // de match invalides.
  return new Response(repairFdBody(overrideCrestUrls(text)), {
    status:     res.status,
    statusText: res.statusText,
    headers,
  })
}

export async function fdFetch(url, options = {}) {
  // Aucun appelant ne passe son propre signal aujourd'hui (vérifié) → pas besoin
  // d'AbortSignal.any (support iOS plus récent) pour l'instant, juste le timeout.
  //
  // ⚠️ AJOUT (24/07, capture Network utilisateur : ces appels revenaient en
  // 304, servis par le cache HTTP du NAVIGATEUR, pendant que Programme
  // affichait "aucun match" sans la moindre erreur console — un fetch
  // "réussi" mais dont on ne pouvait plus garantir la fraîcheur du corps).
  // api/football.js envoie déjà `Cache-Control: no-store` (voir son
  // getCacheControl()) — cache:'no-store' ici en plus, côté client, pour ne
  // JAMAIS dépendre du cache HTTP du navigateur pour ces appels, quel que
  // soit ce qu'un proxy/CDN intermédiaire ferait des en-têtes en route. La
  // fraîcheur reste gérée par Redis (serveur, partagé) + localStorage
  // (client, résilience hors-ligne) — les 2 couches déjà testées.
  try {
    const res = await fetch(url, { cache: 'no-store', ...options, signal: options.signal ?? AbortSignal.timeout(15000) })
    // Réponses en erreur (429/403 du garde-fou, 5xx) : renvoyées telles quelles,
    // sans toucher au corps — elles ne contiennent aucun écusson, et les
    // appelants gèrent déjà ces cas à l'identique depuis toujours.
    return res.ok ? await withSharpCrests(res) : res
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError' || err instanceof TypeError) {
      reportFetchFailure()
    }
    throw err
  }
}

/**
 * Transforme une URL /api/v4/PATH?QS en /api/football?apiPath=/v4/PATH&QS
 * Permet d'utiliser api/football.js comme proxy sans catch-all routing Vercel.
 * Le query string est passé tel quel (virgules non encodées).
 *
 * @param {string} rawPath  ex: '/api/v4/competitions/FL1/matches?status=FINISHED'
 * @returns {string}        ex: '/api/football?apiPath=%2Fv4%2Fcompetitions%2FFL1%2Fmatches&status=FINISHED'
 */
export function fdUrl(rawPath) {
  const sep = rawPath.indexOf('?')
  if (sep >= 0) {
    const p = rawPath.slice(4, sep)  // supprime '/api' → '/v4/...'
    const q = rawPath.slice(sep + 1) // query string brut, virgules préservées
    return `/api/football?apiPath=${encodeURIComponent(p)}&${q}`
  }
  return `/api/football?apiPath=${encodeURIComponent(rawPath.slice(4))}`
}
