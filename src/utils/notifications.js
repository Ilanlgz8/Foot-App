// Notifications navigateur pour les buts.
// S'affiche uniquement quand l'onglet est en arrière-plan
// (si l'onglet est visible, l'animation "BUT !" dans MatchCard suffit).

/**
 * Demande la permission d'envoyer des notifications.
 * À appeler une seule fois, de préférence quand un match passe en live
 * (contexte pertinent → l'utilisateur comprend pourquoi on demande).
 */
export function requestNotificationPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

/**
 * Envoie une notification navigateur pour un but.
 * Ne fait rien si :
 *   - le navigateur ne supporte pas les notifications
 *   - la permission n'est pas accordée
 *   - l'onglet est actuellement visible (animation déjà visible)
 *
 * @param {string} teamName  — nom de l'équipe qui a marqué
 * @param {string} scoreStr  — score affiché ex. "2 – 0"
 * @param {string} minute    — minute du but ex. "67'"
 */
export function notifyGoal({ teamName, scoreStr, minute }) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  // Page active et en focus → l'animation "BUT !" est déjà visible, pas besoin de notif
  if (document.hasFocus()) return

  new Notification(`⚽ BUT ! ${teamName}`, {
    body: `${scoreStr}${minute ? '  ·  ' + minute : ''}`,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    // tag unique → évite les doublons si le but est détecté plusieurs fois
    tag: `goal-${teamName}-${scoreStr}`,
  })
}
