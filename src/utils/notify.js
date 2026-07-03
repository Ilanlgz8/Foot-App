/**
 * notify.js — Demande de permission Notification native (App.jsx, au lancement).
 *
 * Les fonctions d'envoi de notif (but/mi-temps/fin) ont été retirées : elles
 * n'étaient plus appelées nulle part depuis que le cron VAPID (/api/cron-goals)
 * est devenu l'unique source des notifications live (voir CLAUDE.md).
 */

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
