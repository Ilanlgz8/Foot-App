/**
 * notify.js — Notifications PWA pour les événements live
 *
 * Fonctionne quand l'app est ouverte OU en arrière-plan (PWA installée).
 * Utilise serviceWorker.showNotification() pour les notifications background-safe.
 *
 * Événements couverts : KO · Mi-temps · But · Fin de match
 */

// Set des événements déjà notifiés → évite les doublons entre polls
const _notified = new Set()

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
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    tag,                      // tag identique → remplace la notif précédente du même match
    renotify: true,
    silent: false,
  }
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      reg.showNotification(title, opts)
    } else {
      new Notification(title, opts)
    }
  } catch {
    // Pas de permission ou contexte non supporté
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _teamName(team) {
  return team?.shortName || team?.name || '?'
}

// ── API publique ──────────────────────────────────────────────────────────────

/** Coup d'envoi */
export function notifyKickoff(match) {
  const key = `ko_${match.id}`
  if (_notified.has(key)) return
  _notified.add(key)
  const h = _teamName(match.homeTeam)
  const a = _teamName(match.awayTeam)
  _show('⚽ Coup d\'envoi !', `${h} – ${a}`, `match_${match.id}`)
}

/** Mi-temps */
export function notifyHalfTime(match, home, away) {
  const key = `ht_${match.id}`
  if (_notified.has(key)) return
  _notified.add(key)
  const h = _teamName(match.homeTeam)
  const a = _teamName(match.awayTeam)
  _show('🕐 Mi-temps', `${h} ${home} – ${away} ${a}`, `match_${match.id}`)
}

/** But marqué */
export function notifyGoal(match, home, away, scorers) {
  const key = `goal_${match.id}_${home}-${away}`
  if (_notified.has(key)) return
  _notified.add(key)
  const h = _teamName(match.homeTeam)
  const a = _teamName(match.awayTeam)
  // Dernier buteur connu
  const last = scorers?.[scorers.length - 1]
  const scorer = last?.name ? ` · ${last.name}` : ''
  _show(`⚽ BUT !${scorer}`, `${h} ${home} – ${away} ${a}`, `match_${match.id}`)
}

/** Fin de match */
export function notifyFullTime(match, home, away) {
  const key = `ft_${match.id}`
  if (_notified.has(key)) return
  _notified.add(key)
  const h = _teamName(match.homeTeam)
  const a = _teamName(match.awayTeam)
  _show('🏁 Fin du match', `${h} ${home} – ${away} ${a}`, `match_${match.id}`)
}
