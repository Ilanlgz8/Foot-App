/**
 * NotificationBell.jsx
 *
 * Bouton d'activation/désactivation des push notifications.
 * Utilise le hook usePushNotifications pour gérer tout le cycle d'abonnement.
 *
 * États visuels :
 *   • Cloche barrée  → non abonné (idle)     → clic pour s'abonner
 *   • Cloche active  → abonné (subscribed)   → clic pour se désabonner
 *   • Spinner        → chargement (loading)
 *   • Caché          → non supporté / refusé / vérification initiale
 */

import { usePushNotifications } from '../hooks/usePushNotifications'
import '../notificationBell.css'

// Icône cloche SVG inline — pas de dépendance externe
function BellIcon({ muted = false }) {
  return (
    <svg
      className={`notif-bell__icon${muted ? ' notif-bell__icon--muted' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      {muted && (
        /* Barre diagonale pour l'état "non abonné" */
        <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  )
}

// Spinner minimaliste
function Spinner() {
  return <span className="notif-bell__spinner" aria-hidden="true" />
}

export default function NotificationBell() {
  const { status, subscribe, unsubscribe } = usePushNotifications()

  // Ne pas afficher si non supporté, refusé, ou en cours de vérification initiale
  if (status === 'unsupported' || status === 'denied' || status === 'checking') {
    return null
  }

  const isSubscribed = status === 'subscribed'
  const isLoading    = status === 'loading'

  const handleClick = () => {
    if (isLoading) return
    if (isSubscribed) unsubscribe()
    else subscribe()
  }

  const label = isLoading
    ? 'Activation en cours…'
    : isSubscribed
      ? 'Désactiver les notifications de buts'
      : 'Activer les notifications de buts'

  return (
    <button
      className={`notif-bell${isSubscribed ? ' notif-bell--active' : ''}${isLoading ? ' notif-bell--loading' : ''}`}
      onClick={handleClick}
      disabled={isLoading}
      aria-label={label}
      title={label}
      type="button"
    >
      {isLoading ? <Spinner /> : <BellIcon muted={!isSubscribed} />}
    </button>
  )
}
