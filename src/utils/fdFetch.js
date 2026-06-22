/**
 * fdFetch — wrapper rate-limité pour football-data.org (free tier : 10 req/min)
 *
 * Sliding window counter PERSISTÉ en localStorage :
 *   - Le log survit aux rechargements de page
 *   - Le serveur se souvient des requêtes des 60s précédentes même après reload
 *   - Sans persistence, le limiter se réinitialisait à 0 au reload → 429 garanti
 *
 * MAX_RPM = 9 (1 de marge sur la limite officielle de 10 req/min)
 */

// Avec le cache Vercel edge sur api/football.js, la plupart des requêtes sont
// servies par le CDN et n'atteignent pas FD.org. On peut monter la limite client
// à 25 sans risquer de 429 côté FD.org (quota réel protégé par le CDN).
const MAX_RPM    = 25
const WINDOW     = 60_000
const STORAGE_KEY = 'fd_req_log'

// Restaure le log depuis localStorage au chargement du module
function loadLog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // Ne garder que les entrées encore dans la fenêtre
    return Array.isArray(parsed) ? parsed.filter(t => t > Date.now() - WINDOW) : []
  } catch { return [] }
}

function saveLog(log) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)) } catch {}
}

// Singleton partagé entre tous les hooks
const log = loadLog()

async function waitForSlot() {
  for (;;) {
    const now = Date.now()

    // Purger les requêtes hors fenêtre
    while (log.length > 0 && log[0] < now - WINDOW) {
      log.shift()
    }

    if (log.length < MAX_RPM) {
      log.push(now)
      saveLog(log)
      return
    }

    // Slot plein → attendre que le plus ancien expire
    const waitMs = WINDOW - (now - log[0]) + 50
    console.warn(`[fdFetch] Limite atteinte (${log.length}/${MAX_RPM} req/min) — attente ${waitMs}ms`)
    await new Promise(r => setTimeout(r, waitMs))
  }
}

export async function fdFetch(url, options) {
  await waitForSlot()
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
