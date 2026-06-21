/**
 * usePushNotifications.js
 *
 * Hook React qui gère tout le cycle de vie des push notifications :
 *   • Détection du support (navigateur + SW + PushManager)
 *   • Demande de permission
 *   • Abonnement au push service (subscribe)
 *   • Désabonnement (unsubscribe)
 *   • Persistance de l'état dans localStorage pour ne pas re-demander à chaque visite
 *
 * États possibles :
 *   'checking'     → on vérifie si l'utilisateur est déjà abonné (au montage)
 *   'unsupported'  → navigateur incompatible (pas de SW ou PushManager)
 *   'denied'       → l'utilisateur a refusé les permissions notifs dans le navigateur
 *   'idle'         → supporté mais pas encore abonné
 *   'loading'      → en cours d'abonnement
 *   'subscribed'   → abonné et subscription stockée sur le serveur
 *   'error'        → erreur inattendue (réseau, serveur…)
 */

import { useState, useEffect, useCallback } from 'react'

// Clé localStorage pour mémoriser que l'utilisateur est abonné
const LS_KEY = 'push_subscribed'

/**
 * Convertit une clé VAPID Base64url en Uint8Array.
 * Requis par pushManager.subscribe({ applicationServerKey })
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

export function usePushNotifications() {
  const [status, setStatus] = useState('checking')

  // ── Vérification au montage ───────────────────────────────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setStatus('unsupported')
      return
    }

    if (Notification.permission === 'denied') {
      setStatus('denied')
      return
    }

    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(async sub => {
        if (sub) {
          setStatus('subscribed')
          localStorage.setItem(LS_KEY, '1')
          // Re-sync silencieuse toutes les 4h : si Redis a été vidé, ou la subscription
          // supprimée suite à un 410, le cron n'aurait plus rien à qui envoyer.
          // L'endpoint /subscribe est idempotent (sadd ignore les doublons).
          const SYNC_INTERVAL = 4 * 60 * 60 * 1000
          const lastSync = parseInt(localStorage.getItem('push_last_sync') || '0', 10)
          if (Date.now() - lastSync > SYNC_INTERVAL) {
            try {
              const keyRes = await fetch('/api/vapid-key')
              if (keyRes.ok) {
                const storeRes = await fetch('/api/subscribe', {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify(sub.toJSON()),
                })
                if (storeRes.ok || storeRes.status === 201) {
                  localStorage.setItem('push_last_sync', String(Date.now()))
                }
              }
            } catch { /* silently fail — pas critique */ }
          }
        } else {
          localStorage.removeItem(LS_KEY)
          setStatus('idle')
        }
      })
      .catch(() => setStatus('idle'))
  }, [])

  // ── Abonnement ────────────────────────────────────────────────────────────
  const subscribe = useCallback(async () => {
    if (status === 'loading' || status === 'subscribed') return
    setStatus('loading')

    try {
      // 1. Récupérer la clé VAPID publique depuis le serveur
      const keyRes = await fetch('/api/vapid-key')
      if (!keyRes.ok) throw new Error(`vapid-key: ${keyRes.status}`)
      const { publicKey } = await keyRes.json()
      if (!publicKey) throw new Error('Clé VAPID manquante')

      // 2. Demander la permission à l'utilisateur
      const permission = await Notification.requestPermission()
      if (permission === 'denied') {
        setStatus('denied')
        return
      }
      if (permission !== 'granted') {
        // Dismissed (l'utilisateur a fermé sans choisir)
        setStatus('idle')
        return
      }

      // 3. Créer la subscription via le PushManager du navigateur
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,               // obligatoire (sécurité navigateur)
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      // 4. Envoyer la subscription au serveur Vercel pour stockage dans KV
      const storeRes = await fetch('/api/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(sub.toJSON()),
      })
      if (!storeRes.ok) {
        // Subscription créée côté navigateur mais pas stockée → annuler
        await sub.unsubscribe()
        throw new Error(`subscribe: ${storeRes.status}`)
      }

      localStorage.setItem(LS_KEY, '1')
      setStatus('subscribed')
    } catch (err) {
      console.error('[usePushNotifications] subscribe error:', err)
      setStatus('error')
      // Revenir à idle après 3s pour permettre une nouvelle tentative
      setTimeout(() => setStatus('idle'), 3_000)
    }
  }, [status])

  // ── Désabonnement ─────────────────────────────────────────────────────────
  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()
      // Note : on ne supprime pas du KV serveur ici (la subscription sera nettoyée
      // automatiquement côté api/push.js quand elle retournera 410 Gone)
      localStorage.removeItem(LS_KEY)
      setStatus('idle')
    } catch (err) {
      console.error('[usePushNotifications] unsubscribe error:', err)
    }
  }, [])

  // ── Auto-prompt première visite ──────────────────────────────────────────
  // Si l'utilisateur n'a jamais été invité ET le statut est idle → demander auto
  useEffect(() => {
    if (status !== 'idle') return
    const alreadyPrompted = localStorage.getItem('push_prompted')
    if (alreadyPrompted) return
    localStorage.setItem('push_prompted', '1')
    // Petit délai pour que l'app soit chargée avant d'afficher la demande
    const t = setTimeout(() => subscribe(), 1_500)
    return () => clearTimeout(t)
  }, [status, subscribe])

  return { status, subscribe, unsubscribe }
}
