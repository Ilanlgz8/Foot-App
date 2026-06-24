/**
 * notify.js — Notifications PWA pour les événements live
 *
 * Utilisé uniquement comme fallback si le cron VAPID n'est pas configuré.
 * Le cron /api/cron-goals est la source principale des notifications.
 */

import { translateTeam } from '../data/teamNames'

// ── Persistance _notified (survit aux rechargements) ─────────────────────────
const NOTIF_KEY = 'foot_notified_v1'
const NOTIF_TTL = 4 * 60 * 60_000 // 4h

const _notified = new Set()

// Restaurer depuis localStorage au chargement du module
try {
  const raw = localStorage.getItem(NOTIF_KEY)
  if (raw) {
    const { ts, keys } = JSON.parse(raw)
    if (Date.now() - ts < NOTIF_TTL) {
      keys.forEach(k => _notified.add(k))
    } else {
      localStorage.removeItem(NOTIF_KEY)
    }
  }
} catch { /* silently ignore */ }

function _persistNotified() {
  try {
    localStorage.setItem(NOTIF_KEY, JSON.stringify({
      ts:   Date.now(),
      keys: [..._notified],
    }))
  } catch { /* silently ignore */ }
}

// ── Permission ────────────────────────────────────────────────────────────────

export function canNotify() {
  return (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  )
}

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied')  return false
  try {
    const result = await Notification.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}

// ── Affichage ─────────────────────────────────────────────────────────────────

async function _show(title, body, tag) {
  if (!canNotify()) return
  const opts = {
    body,
    icon:     '/icon-192.png',
    badge:    '/icon-192.png',
    tag,
    renotify: true,
    silent:   false,
  }
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      reg.showNotification(title, opts)
    } else {
      new Notification(title, opts)
    }
  } catch { /* pas de permission ou contexte non supporté */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _teamName(team) {
  return translateTeam(team?.shortName || team?.name || '?')
}

// ── API publique ──────────────────────────────────────────────────────────────

/** Coup d'envoi */
export function notifyKickoff(match) {
  const key = `ko_${match.id}`
  if (_notified.has(key)) return
  _notified.add(key)
  _persistNotified()
  const h = _teamName(match.homeTeam)
  const a = _teamName(match.awayTeam)
  _show('🔴 Coup d\'envoi !', `${h} – ${a}`, `match_${match.id}`)
}

/** Mi-temps */
export function notifyHalfTime(match, home, away) {
  const key = `ht_${match.id}`
  if (_notified.has(key)) return
  _notified.add(key)
  _persistNotified()
  const h = _teamName(match.homeTeam)
  const a = _teamName(match.awayTeam)
  _show('⏸ Mi-temps', `${h} ${home} – ${away} ${a}`, `match_${match.id}`)
}

/** But marqué */
export function notifyGoal(match, home, away, scorers) {
  const key = `goal_${match.id}_${home}-${away}`
  if (_notified.has(key)) return
  _notified.add(key)
  _persistNotified()
  const h = _teamName(match.homeTeam)
  const a = _teamName(match.awayTeam)
  const last   = scorers?.[scorers.length - 1]
  const scorer = last?.name ? ` · ${last.name}` : ''
  _show(`⚽ BUT !${scorer}`, `${h} ${home} – ${away} ${a}`, `match_${match.id}`)
}

/** Fin de match */
export function notifyFullTime(match, home, away) {
  const key = `ft_${match.id}`
  if (_notified.has(key)) return
  _notified.add(key)
  _persistNotified()
  const h = _teamName(match.homeTeam)
  const a = _teamName(match.awayTeam)
  _show('🏁 Fin du match', `${h} ${home} – ${away} ${a}`, `match_${match.id}`)
}
