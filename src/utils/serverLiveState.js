// serverLiveState.js — lecture de l'« état officiel » d'un match publié par le Worker (06/11, étape 1 de
// la refonte « le serveur décide, le téléphone affiche »). Le Worker (cf-worker/src/index.js,
// publishLiveState) écrit chaque minute, par événement ESPN : état ESPN (pre/in/post), score, minute,
// et `final` = fin de match CONFIRMÉE par sa double vérification (la même que la notif « Fin de match »).
// api/fifa-live.js le joint à sa réponse (`serverState`). Ce module dit au client quoi en penser.
//
// Une donnée trop vieille (Worker en panne, base injoignable…) est ignorée : le client retombe alors sur
// sa logique d'avant, inchangée.
export const SERVER_STATE_MAX_AGE_MS = 10 * 60_000   // fin confirmée : reste vraie, on tolère plus
export const SERVER_LIVE_MAX_AGE_MS  = 3 * 60_000    // « en cours » : doit être récent

export function serverStateVerdict(ss, nowMs = Date.now()) {
  const none = { final: false, live: false, seenAt: 0 }
  if (!ss || typeof ss !== 'object' || typeof ss.seenAt !== 'number') return none
  const age = nowMs - ss.seenAt
  if (age < 0 || age > SERVER_STATE_MAX_AGE_MS) return none
  const final = ss.final === true
  const live  = !final && ss.state === 'in' && age <= SERVER_LIVE_MAX_AGE_MS
  return { final, live, seenAt: ss.seenAt }
}
