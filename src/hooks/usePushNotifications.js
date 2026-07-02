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
import { getFavoriteTeams } from './useFavoriteTeams'

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
          // Re-sync à chaque lancement : si Redis a été vidé (Vercel KV flush, TTL expiré…)
          // ou si la première subscription n'a pas été stockée, on la renvoie silencieusement.
          // L'endpoint /subscribe est idempotent (sadd ignore les doublons).
          // Throttle : on attend au moins 5 min entre deux re-sync pour ne pas spammer.
          const SYNC_INTERVAL = 5 * 60 * 1000 // 5 min
          const lastSync = parseInt(localStorage.getItem('push_last_sync') || '0', 10)
          if (Date.now() - lastSync > SYNC_INTERVAL) {
            try {
              const storeRes = await fetch('/api/subscribe', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ ...sub.toJSON(), comps: getFavoriteTeams() }),
              })
              if (storeRes.ok || storeRes.status === 201) {
                localStorage.setItem('push_last_sync', String(Date.now()))
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
        body:    JSON.stringify({ ...sub.toJSON(), comps: getFavoriteTeams() }),
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
  // Si l'utilisateur n'a jamais été invité ET le statut est idle → demander auto.
  // ⚠️ push_prompted est posé AVANT subscribe() pour éviter d'envoyer plusieurs
  //    requêtes si l'effet se re-exécute. Si subscribe() échoue par erreur réseau,
  //    l'utilisateur peut re-tenter via la cloche dans la navbar.
  useEffect(() => {
    if (status !== 'idle') return
    const alreadyPrompted = localStorage.getItem('push_prompted')
    if (alreadyPrompted) return
    // Petit délai pour que l'app soit chargée avant d'afficher la demande
    const t = setTimeout(() => {
      localStorage.setItem('push_prompted', '1')
      subscribe()
    }, 1_500)
    return () => clearTimeout(t)
  }, [status, subscribe])

  return { status, subscribe, unsubscribe }
}

/**
 * Renvoie la subscription courante au serveur avec la liste de favoris à jour.
 * À appeler quand l'utilisateur change ses équipes suivies, pour que le filtre
 * prenne effet immédiatement (sans attendre le re-sync périodique de 5 min).
 * Ne fait rien si l'utilisateur n'est pas abonné aux notifs.
 */
export async function resyncFavoriteTeams() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await fetch('/api/subscribe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...sub.toJSON(), comps: getFavoriteTeams() }),
    })
  } catch { /* silencieux — pas critique, re-sync périodique rattrapera */ }
}
