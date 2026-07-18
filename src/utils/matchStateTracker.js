// Mémorise les transitions d'état des matchs dans le localStorage.
// But : détecter PAUSED → IN_PLAY pour connaître l'heure exacte du début de la 2ème MT,
// et suivre la machine d'états live (unknown → live → pendingEnd → ended).

// ─── Santé ESPN ───────────────────────────────────────────────────────────────
let _espnWorking = false
export const setEspnWorking = (v) => { _espnWorking = v }
export const isEspnWorking  = ()  => _espnWorking
// ─────────────────────────────────────────────────────────────────────────────

const key = (id) => `foot_ms_${id}`

// Lecture protégée de l'état stocké — un localStorage corrompu (écriture
// interrompue, quota dépassé, format d'une ancienne version de l'app...)
// ferait planter JSON.parse() sans catch ; comme getMatchState() est appelé
// dans le chemin chaud de quasiment tous les composants live (MatchCard,
// Live.jsx, LiveMatchPage.jsx, MatchPage.jsx, useLiveMinute.js...), une seule
// entrée corrompue pour un match aurait fait planter son affichage partout.
// Repli sûr : état vide, comme si le match n'avait encore jamais été suivi.
function readState(id) {
  try {
    return JSON.parse(localStorage.getItem(key(id)) || '{}')
  } catch {
    return {}
  }
}

// Auto-nettoyage au chargement : supprimer les états 'ended' de plus de 3h
// (ils bloquent la ré-injection si ESPN revient — inutile après 3h)
try {
  const cutoff = Date.now() - 3 * 60 * 60_000
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('foot_ms_')) continue
    try {
      const st = JSON.parse(localStorage.getItem(k) || '{}')
      if (st.liveState === 'ended' && st.endedAt && st.endedAt < cutoff) {
        localStorage.removeItem(k)
      }
    } catch {}
  }
} catch {}

/**
 * Retourne l'état live d'un match :
 * { state: 'unknown' | 'live' | 'pendingEnd' | 'ended', since?, endedAt? }
 *
 * - 'unknown'    : pas encore vu comme live
 * - 'live'       : ESPN a confirmé en cours au moins une fois
 * - 'pendingEnd' : ESPN dit FINAL depuis `since` ms (en attente confirmation 2min)
 * - 'ended'      : fin confirmée (espéré réel, pas un faux positif)
 *
 * L'état 'ended' auto-expire après 3h (nettoyé au module load ci-dessus).
 */
export function getLiveState(matchId) {
  try {
    const stored = readState(matchId)
    return {
      state:   stored.liveState    ?? 'unknown',
      since:   stored.pendingEndSince ?? null,
      endedAt: stored.endedAt      ?? null,
    }
  } catch {
    return { state: 'unknown', since: null, endedAt: null }
  }
}

/**
 * Écrit l'état live dans foot_ms_ (sans écraser les autres champs).
 *
 * @param {string} state - 'live' | 'pendingEnd' | 'ended'
 * @param {object} opts
 *   since    : timestamp de début de pendingEnd (pour state='pendingEnd')
 *   endedAt  : timestamp de fin confirmée (pour state='ended')
 */
export function setLiveState(matchId, state, { since, endedAt } = {}) {
  if (!matchId) return
  try {
    const stored = readState(matchId)
    stored.liveState = state

    if (state === 'pendingEnd') {
      stored.pendingEndSince = since ?? stored.pendingEndSince ?? Date.now()
    } else {
      delete stored.pendingEndSince
    }

    if (state === 'ended') {
      stored.endedAt = endedAt ?? Date.now()
    } else {
      delete stored.endedAt
    }

    localStorage.setItem(key(matchId), JSON.stringify(stored))
  } catch {}
}

/**
 * À appeler à chaque fois qu'on reçoit des données fraîches sur un match en live.
 *
 * @param {number} [pausedAtOverride] - timestamp à utiliser pour pausedAt au lieu de
 *   Date.now(). Utile quand la mi-temps est détectée alors qu'elle a en réalité
 *   commencé plus tôt (app fermée/arrière-plan pendant le coup de sifflet) : sans
 *   ça, le countdown "reprise dans Xmin" repartirait de 15min à chaque réouverture
 *   au lieu de refléter le temps de pause déjà écoulé (bug signalé).
 */
export function trackMatchState(match, pausedAtOverride) {
  if (!match?.id) return
  const stored = readState(match.id)

  if (match.status === 'PAUSED' && !stored.pausedAt) {
    stored.pausedAt = pausedAtOverride ?? Date.now()
    localStorage.setItem(key(match.id), JSON.stringify(stored))
  }
}

/**
 * Force l'enregistrement de half2Start.
 */
export function setHalf2Start(matchId, half2Start) {
  if (!matchId) return
  const stored = readState(matchId)
  stored.half2Start = half2Start
  localStorage.setItem(key(matchId), JSON.stringify(stored))
}

/**
 * Mémorise le timestamp exact du coup d'envoi réel.
 */
export function setKickoffAt(matchId, kickoffAt) {
  if (!matchId) return
  const stored = readState(matchId)
  if (stored.kickoffAt) return
  stored.kickoffAt = kickoffAt
  localStorage.setItem(key(matchId), JSON.stringify(stored))
}

/**
 * Met à jour les données ESPN en direct (espnClock, espnStatus).
 */
export function setEspnData(matchId, { espnClock, espnStatus, espnPeriod }) {
  if (!matchId) return
  const stored = readState(matchId)
  stored.espnClock      = espnClock
  stored.espnStatus     = espnStatus
  stored.espnCapturedAt = Date.now()
  if (espnPeriod != null) stored.espnPeriod = espnPeriod
  localStorage.setItem(key(matchId), JSON.stringify(stored))
}

/**
 * Retourne toutes les données mémorisées pour un match.
 */
export function getMatchState(matchId) {
  return readState(matchId)
}

// ── Fenêtre de grâce "Terminé" ──────────────────────────────────────────────
// Avant : un match ft===true restait affiché "en direct" (Live.jsx,
// LiveSidebar, LiveMatchPage) jusqu'à l'éviction complète du tracker
// (5min — délai gardé pour laisser le temps à FD.org/classement/forme de se
// mettre à jour, voir confirmFt dans useLiveMinute.js). Résultat : le badge
// passait bien à "Terminé" immédiatement, mais restait visible dans ces
// widgets jusqu'à 5min après la fin réelle → confusion signalée par
// l'utilisateur ("ça a l'air encore en direct"). Cette fenêtre courte permet
// aux widgets live d'afficher "Terminé" quelques secondes puis de disparaître,
// indépendamment du délai (toujours 5min) avant l'éviction réelle du tracker.
export const TERMINE_GRACE_MS = 8_000

/**
 * True si le match vient de passer "Terminé" il y a moins de `graceMs`.
 */
export function isRecentlyFinished(matchId, graceMs = TERMINE_GRACE_MS) {
  const st = getMatchState(matchId)
  if (st.ft !== true) return false
  const termineAt = st.termineAt ?? 0
  return Date.now() - termineAt < graceMs
}

/**
 * Efface uniquement les flags ft/termineAt sans toucher le reste du state.
 * Utilisé quand ESPN revient en IN_PLAY après un faux STATUS_FINAL :
 * on veut supprimer le flag "Terminé" sans perdre liveState, matchSnapshot,
 * kickoffAt, pausedAt, espnClock, etc.
 */
export function clearFtFlags(matchId) {
  if (!matchId) return
  try {
    const stored = readState(matchId)
    if (!stored.ft && !stored.termineAt) return  // rien à faire
    delete stored.ft
    delete stored.termineAt
    localStorage.setItem(key(matchId), JSON.stringify(stored))
  } catch {}
}

/**
 * Nettoie l'état d'un match.
 *
 * @param {object} opts
 *   preserveEnded : si true et que liveState === 'ended', conserve uniquement
 *                   { liveState, endedAt } — utilisé après la grace period pour
 *                   bloquer toute ré-injection ESPN post-FT sans perdre l'info.
 */
export function clearMatchState(matchId, { preserveEnded = false } = {}) {
  if (preserveEnded) {
    try {
      const stored = readState(matchId)
      if (stored.liveState === 'ended') {
        // Garder uniquement l'info de fin — efface kickoffAt, pausedAt, espnClock, ft, etc.
        localStorage.setItem(key(matchId), JSON.stringify({
          liveState: 'ended',
          endedAt:   stored.endedAt ?? Date.now(),
        }))
        return
      }
    } catch {}
  }
  localStorage.removeItem(key(matchId))
}

/**
 * Efface tous les états de matchs (foot_ms_*).
 */
export function clearAllMatchStates() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('foot_ms_'))
    .forEach(k => localStorage.removeItem(k))
}
