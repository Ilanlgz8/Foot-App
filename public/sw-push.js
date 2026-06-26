// ─────────────────────────────────────────────────────────────────────────────
// sw-push.js — Handlers Web Push pour StatFootix
//
// Ce fichier est importé par le Service Worker principal (généré par workbox).
// Il gère deux events natifs du navigateur :
//   • push          → afficher la notification quand un but est détecté
//   • notificationclick → ouvrir / focus l'app quand l'utilisateur clique
//
// ⚠️  Pas d'import ici — ce fichier est du vanilla JS pur exécuté dans le SW.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * push — reçu quand le serveur Vercel envoie une notification.
 * event.data contient le payload JSON envoyé par api/push.js.
 */
self.addEventListener('push', event => {
  // Rien dans le payload → rien à afficher
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    // Payload non-JSON → ignorer silencieusement
    return
  }

  const {
    title   = 'But !',
    body    = '',
    matchId = null,
    url     = '/',
  } = data

  // waitUntil garantit que le SW reste actif jusqu'à la fin de l'affichage
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:     '/statfootix.png',   // icône app
      badge:    '/statfootix.png',   // badge (barre de notifs Android)
      // tag identique pour le même match → remplace la notif précédente
      // au lieu d'en empiler plusieurs pour le même match
      tag:      `statfootix-goal-${matchId ?? Date.now()}`,
      renotify: true,              // vibre même si tag identique
      silent:   false,
      // Données transmises au click handler
      data: { url },
    })
  )
})

/**
 * notificationclick — l'utilisateur clique sur la notification.
 * → focus l'onglet PWA déjà ouvert, ou ouvre une nouvelle fenêtre.
 */
self.addEventListener('notificationclick', event => {
  event.notification.close()

  const target = event.notification.data?.url ?? '/live'

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Si l'app est déjà ouverte → focus + navigation vers la cible
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus().then(() => {
              // navigate() redirige l'onglet existant vers /live
              if ('navigate' in client) return client.navigate(target)
            })
          }
        }
        // Sinon ouvrir une nouvelle fenêtre directement sur /live
        if (clients.openWindow) {
          return clients.openWindow(target)
        }
      })
  )
})
