/**
 * liveTracker — source de vérité unique pour les matchs en cours.
 *
 * Principe : une Map simple persistée en localStorage.
 * markLive(match)  → le match est en cours
 * markEnded(id)    → le match est terminé
 * useLiveTracker() → hook React, disponible immédiatement au montage
 *
 * Aucune dépendance sur stickyLive, liveState, pendingEviction ou espnStatus.
 */

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'foot_live_v2'
const TTL = 4 * 60 * 60_000   // 4h — un match ne dure pas plus longtemps

// ── État module-level ─────────────────────────────────────────────────────────
// Partagé entre le hook React et les fonctions markLive/markEnded.
// Survit aux re-renders, mais reset au rechargement (récupéré depuis localStorage).
let _tracker = {}
const _listeners = new Set()

// Restauration immédiate depuis localStorage
// Filtres au reload pour éviter d'afficher un match déjà terminé :
//   1. ts trop vieux (> TTL 4h)
//   2. utcDate + 3h dépassé → match forcément terminé même sans polling (PC en veille)
//   3. liveState='ended' confirmé en localStorage
try {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    const saved = JSON.parse(raw)
    const now   = Date.now()
    for (const [id, entry] of Object.entries(saved)) {
      // Trop vieux
      if (entry.ts <= now - TTL) continue
      // utcDate + 3h dépassé → match forcément terminé
      if (entry.match?.utcDate) {
        const kickoff = new Date(entry.match.utcDate).getTime()
        if (now - kickoff > 3 * 60 * 60_000) continue
      }
      // liveState='ended' confirmé → grace period passée
      try {
        const ms = JSON.parse(localStorage.getItem(`foot_ms_${id}`) || '{}')
        if (ms.liveState === 'ended') continue
      } catch {}
      _tracker[id] = entry
    }
  }
} catch {}

// ── Fonctions internes ────────────────────────────────────────────────────────

function _persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_tracker)) } catch {}
}

function _notify() {
  _listeners.forEach(fn => fn())
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Marque un match comme "en cours".
 * Appelé à chaque poll ESPN IN_PROGRESS / HALFTIME / etc.
 * Met à jour le tracker ET persiste en localStorage.
 */
export function markLive(match) {
  if (!match?.id) return
  _tracker[match.id] = {
    match: {
      id:          match.id,
      utcDate:     match.utcDate,
      status:      'IN_PLAY',
      homeTeam:    match.homeTeam,
      awayTeam:    match.awayTeam,
      competition: match.competition,
      score:       match.score,
    },
    ts: Date.now(),
  }
  _persist()
  _notify()
}

/**
 * Marque un match comme "coup d'envoi imminent" (heure atteinte, ESPN pas encore confirmé).
 * Affiche le widget avec "Débute" au lieu de la minute.
 * Remplacé par markLive() dès qu'ESPN confirme STATUS_IN_PROGRESS.
 */
export function markPendingKickoff(match) {
  if (!match?.id) return
  // Ne pas écraser une entrée existante (markLive a priorité)
  if (_tracker[match.id]) return
  _tracker[match.id] = {
    match: {
      id:          match.id,
      utcDate:     match.utcDate,
      status:      'SCHEDULED',
      homeTeam:    match.homeTeam,
      awayTeam:    match.awayTeam,
      competition: match.competition,
      score:       match.score,
    },
    ts:      Date.now(),
    pending: true,
  }
  _persist()
  _notify()
}

/**
 * Retire un match du tracker (fin de match confirmée).
 */
export function markEnded(matchId) {
  if (!matchId || !_tracker[matchId]) return
  delete _tracker[matchId]
  _persist()
  _notify()
}

/**
 * Vérifie si un match est suivi comme live.
 * Remplace isStickyLive().
 */
export function isTrackedLive(matchId) {
  return !!_tracker[matchId]
}

/**
 * Purge les matchs périmés du tracker (TTL ou utcDate+3h dépassé).
 * Appelé au réveil du PC (visibilitychange) pour nettoyer sans reload.
 */
function _purgeStale() {
  const now = Date.now()
  let changed = false
  for (const [id, entry] of Object.entries(_tracker)) {
    const staleTs      = entry.ts <= now - TTL
    const kickoff      = entry.match?.utcDate ? new Date(entry.match.utcDate).getTime() : null
    const staleKickoff = kickoff && now - kickoff > 3 * 60 * 60_000
    if (staleTs || staleKickoff) {
      delete _tracker[id]
      changed = true
    }
  }
  if (changed) { _persist(); _notify() }
}

// Nettoyer automatiquement au réveil du PC
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _purgeStale()
  })
}

/**
 * Retourne les matchs en cours (filtrés par TTL).
 */
export function getLiveMatches() {
  const cutoff = Date.now() - TTL
  return Object.values(_tracker)
    .filter(e => e.ts > cutoff)
    .map(e => e.match)
}

/**
 * Hook React — retourne les matchs live et se met à jour automatiquement.
 *
 * Disponible IMMÉDIATEMENT au montage (lit depuis _tracker déjà initialisé
 * depuis localStorage) → widget affiché dès le premier render, sans attendre
 * le premier poll ESPN.
 */
export function useLiveTracker() {
  const [matches, setMatches] = useState(getLiveMatches)

  useEffect(() => {
    // Re-sync au cas où _tracker a changé entre module load et montage (HMR)
    setMatches(getLiveMatches())

    const handler = () => setMatches(getLiveMatches())
    _listeners.add(handler)
    return () => _listeners.delete(handler)
  }, [])

  return matches
}
