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

export async function fdFetch(url, options) {
  return fetch(url, options)
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
