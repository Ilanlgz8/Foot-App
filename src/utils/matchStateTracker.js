// Mémorise les transitions d'état des matchs dans le localStorage.
// But : détecter PAUSED → IN_PLAY pour connaître l'heure exacte du début de la 2ème MT.

// ─── Santé ESPN ───────────────────────────────────────────────────────────────
// Flag in-memory mis à jour par useLiveMinute :
//   • setEspnWorking(true)  → quand ESPN répond avec des données valides
//   • setEspnWorking(false) → après 3 échecs ESPN consécutifs (~60s)
// Consulté par useLiveMatches pour savoir si FD.org est nécessaire en fallback.
let _espnWorking = false

export const setEspnWorking = (v) => { _espnWorking = v }
export const isEspnWorking  = ()  => _espnWorking
// ─────────────────────────────────────────────────────────────────────────────

const key = (id) => `foot_ms_${id}`
const TRACKED_KEY = 'foot_tracked_matches'

/**
 * Retourne l'ensemble des IDs de matchs sélectionnés pour le suivi précis (API-Football).
 */
export function getTrackedMatches() {
  try {
    return new Set(JSON.parse(localStorage.getItem(TRACKED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

/**
 * Active ou désactive le suivi précis d'un match.
 * Retourne true si le match est désormais suivi, false sinon.
 */
export function toggleTrackedMatch(matchId) {
  const ids = getTrackedMatches()
  const sid = String(matchId)
  if (ids.has(sid)) ids.delete(sid)
  else ids.add(sid)
  localStorage.setItem(TRACKED_KEY, JSON.stringify([...ids]))
  return ids.has(sid)
}

/**
 * À appeler à chaque fois qu'on reçoit des données fraîches sur un match en live.
 * Enregistre les transitions PAUSED et IN_PLAY (reprise).
 */
export function trackMatchState(match) {
  if (!match?.id) return
  const stored = JSON.parse(localStorage.getItem(key(match.id)) || '{}')

  // On voit PAUSED pour la 1ère fois → noter l'heure
  if (match.status === 'PAUSED' && !stored.pausedAt) {
    stored.pausedAt = Date.now()
    localStorage.setItem(key(match.id), JSON.stringify(stored))
  }

  // half2Start est écrit uniquement par setHalf2Start() (useLiveMinute / api-football.com).
  // On ne le déduit plus du statut football-data.org : trop imprévisible.
  // calcMinute gère la transition MT→2ème MT via pausedAt + estimation 15min.
}

/**
 * Force l'enregistrement de half2Start (utile si pausedAt n'a jamais été capturé).
 * Reconstruit depuis apiElapsed : half2Start = now - (elapsed - 45) * 60s
 * N'écrase pas si déjà défini.
 */
export function setHalf2Start(matchId, half2Start) {
  if (!matchId) return
  const stored = JSON.parse(localStorage.getItem(key(matchId)) || '{}')
  // Pas de guard : on recalcule depuis apiElapsed à chaque poll 2H,
  // ce qui auto-corrige toute valeur pourrie issue d'un bug précédent.
  stored.half2Start = half2Start
  localStorage.setItem(key(matchId), JSON.stringify(stored))
}

/**
 * Mémorise le timestamp exact du coup d'envoi réel (détecté via API-Football).
 * Reconstruit depuis la minute elapsed au moment de la détection.
 * N'écrase pas si déjà défini.
 */
export function setKickoffAt(matchId, kickoffAt) {
  if (!matchId) return
  const stored = JSON.parse(localStorage.getItem(key(matchId)) || '{}')
  if (stored.kickoffAt) return  // déjà mémorisé, ne pas écraser
  stored.kickoffAt = kickoffAt
  localStorage.setItem(key(matchId), JSON.stringify(stored))
}

/**
 * Met à jour les données ESPN en direct (espnClock, espnStatus).
 * Écrase toujours : appelé à chaque poll ESPN (20s) pour avoir les données fraîches.
 * espnClock ex. "42:00" ou "45:00+2:00" ; espnStatus ex. "STATUS_IN_PROGRESS".
 */
export function setEspnData(matchId, { espnClock, espnStatus }) {
  if (!matchId) return
  const stored = JSON.parse(localStorage.getItem(key(matchId)) || '{}')
  stored.espnClock       = espnClock
  stored.espnStatus      = espnStatus
  stored.espnCapturedAt  = Date.now()  // timestamp du poll → permet l'interpolation côté client
  localStorage.setItem(key(matchId), JSON.stringify(stored))
}

/**
 * Retourne les données mémorisées pour un match :
 * { kickoffAt?, pausedAt?, half2Start?, espnClock?, espnStatus?, espnCapturedAt? }
 */
export function getMatchState(matchId) {
  return JSON.parse(localStorage.getItem(key(matchId)) || '{}')
}

/**
 * Nettoie l'état d'un match terminé.
 */
export function clearMatchState(matchId) {
  localStorage.removeItem(key(matchId))
}

/**
 * Efface tous les états de matchs (foot_ms_*).
 * Utile pour recalibrer les minutes en cas de dérive.
 */
export function clearAllMatchStates() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('foot_ms_'))
    .forEach(k => localStorage.removeItem(k))
}
