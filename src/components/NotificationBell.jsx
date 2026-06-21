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

// Cloche sonnante (abonné) — avec lignes de vibration
function BellRinging() {
  return (
    <svg className="notif-bell__icon notif-bell__icon--ringing" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      {/* Lignes de vibration */}
      <path d="M20.5 5.5a9 9 0 0 1 0 13" strokeOpacity="0.5" />
      <path d="M3.5 5.5a9 9 0 0 0 0 13"  strokeOpacity="0.5" />
    </svg>
  )
}

// Cloche barrée (non abonné ou refusé)
function BellMuted({ faded = false }) {
  return (
    <svg className={`notif-bell__icon${faded ? ' notif-bell__icon--faded' : ''}`} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

function Spinner() {
  return <span className="notif-bell__spinner" aria-hidden="true" />
}

export default function NotificationBell() {
  const { status, subscribe, unsubscribe } = usePushNotifications()

  // Cacher seulement si navigateur incompatible ou vérification en cours
  if (status === 'unsupported' || status === 'checking') return null

  const isSubscribed = status === 'subscribed'
  const isLoading    = status === 'loading'
  const isDenied     = status === 'denied'

  const handleClick = () => {
    if (isLoading) return
    if (isDenied) {
      alert('Les notifications sont bloquées. Activez-les dans les réglages de votre navigateur.')
      return
    }
    if (isSubscribed) unsubscribe()
    else subscribe()
  }

  const label = isLoading  ? 'Activation en cours…'
    : isSubscribed         ? 'Désactiver les notifications'
    : isDenied             ? 'Notifications bloquées — voir les réglages'
    :                        'Activer les notifications'

  return (
    <button
      className={`notif-bell${isSubscribed ? ' notif-bell--active' : ''}${isLoading ? ' notif-bell--loading' : ''}${isDenied ? ' notif-bell--denied' : ''}`}
      onClick={handleClick}
      disabled={isLoading}
      aria-label={label}
      title={label}
      type="button"
    >
      {isLoading
        ? <Spinner />
        : isSubscribed
          ? <BellRinging />
          : <BellMuted faded={isDenied} />}
    </button>
  )
}
