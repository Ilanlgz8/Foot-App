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

import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { usePushNotifications } from '../hooks/usePushNotifications'
import FavoriteTeamsPanel from './FavoriteTeamsPanel'
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
  const [panelOpen, setPanelOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const wrapRef  = useRef(null)
  const panelRef = useRef(null)

  // ⚠️ La navbar a `overflow: hidden` (pour contenir ses effets de bordure
  // animée) — un panneau positionné en `absolute` à l'intérieur serait donc
  // coupé/invisible dès qu'il déborde de la navbar, quel que soit son
  // z-index (overflow:hidden clippe peu importe le z-index). On rend le
  // panneau via un portail dans <body>, positionné en `fixed` à partir des
  // coordonnées réelles de la cloche — il échappe complètement au clipping.
  useLayoutEffect(() => {
    if (!panelOpen || !wrapRef.current) return
    const r = wrapRef.current.getBoundingClientRect()
    setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right })
  }, [panelOpen])

  // Fermeture au clic en dehors du bouton/panneau
  useEffect(() => {
    if (!panelOpen) return
    const onClick = (e) => {
      if (wrapRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setPanelOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [panelOpen])

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
    // La cloche ouvre désormais le panneau de réglages (équipes suivies +
    // activer/désactiver) au lieu de basculer directement — un seul point
    // d'entrée pour tout ce qui touche aux notifs.
    setPanelOpen(o => !o)
  }

  const label = isLoading  ? 'Activation en cours…'
    : isSubscribed         ? 'Réglages des notifications'
    : isDenied             ? 'Notifications bloquées — voir les réglages'
    :                        'Activer les notifications'

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
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

      {panelOpen && anchor && createPortal(
        <FavoriteTeamsPanel
          ref={panelRef}
          anchor={anchor}
          status={status}
          subscribe={subscribe}
          unsubscribe={unsubscribe}
          onClose={() => setPanelOpen(false)}
        />,
        document.body
      )}
    </div>
  )
}
