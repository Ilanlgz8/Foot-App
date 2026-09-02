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
    // ⚠️ BUG CORRIGÉ (02/09, trouvé en audit, reproduit avec node) : la valeur
    // par défaut de `title` était `` `But ! ${matchId}` `` — un template
    // literal qui lit `matchId`, déclaré PLUS BAS dans la MÊME déstructuration.
    // Les valeurs par défaut sont évaluées dans l'ordre d'écriture, donc
    // `matchId` était encore dans sa zone morte temporelle (TDZ) à ce
    // moment-là : tout payload push SANS `title` faisait lever un
    // `ReferenceError: Cannot access 'matchId' before initialization` AVANT
    // le showNotification — le filet de sécurité censé rattraper un payload
    // incomplet faisait donc exactement l'inverse : il supprimait la notif,
    // silencieusement (une exception dans un handler `push` de Service Worker
    // n'est visible nulle part côté utilisateur).
    // Latent aujourd'hui (api/cron-goals.js envoie toujours un `title`), mais
    // c'est précisément le genre de piège qui se déclenche le jour où un
    // nouveau type de notif est ajouté sans titre. `matchId` est maintenant
    // extrait AVANT (ligne du dessus) : plus aucune dépendance en avant.
    matchId  = null,
    title    = matchId ? `But ! ${matchId}` : 'But !',
    body     = '',
    url      = '/',
    // `tag`/`silent`/`renotify` pilotables depuis le payload serveur (ex: le
    // ticker "score en direct" de cron-goals.js les fixe explicitement pour
    // remplacer silencieusement sans re-notifier) — sinon comportement
    // historique (notif de but : tag par match, toujours ré-alertée).
    tag      = `statfootix-goal-${matchId ?? Date.now()}`,
    silent   = false,
    renotify = true,
  } = data

  // waitUntil garantit que le SW reste actif jusqu'à la fin de l'affichage
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/statfootix.png',   // icône app
      badge: '/statfootix.png',   // badge (barre de notifs Android)
      tag, silent, renotify,
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
