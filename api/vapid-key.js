// api/vapid-key.js
// Expose la clé VAPID publique au client pour s'abonner aux push notifications.
//
// La clé PUBLIQUE n'est pas secrète : elle sert uniquement à identifier notre
// serveur auprès des push services (Google FCM, Apple APNs…).
// La clé PRIVÉE, elle, ne sort jamais de Vercel (env var VAPID_PRIVATE_KEY).

export default function handler(req, res) {
  // On n'accepte que les GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY

  // Si les env vars ne sont pas configurées (ex: dev local sans vercel dev)
  if (!publicKey) {
    return res.status(503).json({ error: 'Push notifications non configurées sur ce serveur' })
  }

  // Cache court : la clé change rarement, mais on ne veut pas qu'elle reste en cache trop longtemps
  res
    .status(200)
    .setHeader('Cache-Control', 'public, max-age=3600')
    .json({ publicKey })
}
