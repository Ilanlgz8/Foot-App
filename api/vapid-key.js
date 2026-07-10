// api/vapid-key.js
// Expose la clé VAPID publique au client pour s'abonner aux push notifications.
//
// La clé PUBLIQUE n'est pas secrète : elle sert uniquement à identifier notre
// serveur auprès des push services (Google FCM, Apple APNs…).
// La clé PRIVÉE, elle, ne sort jamais de Vercel (env var VAPID_PRIVATE_KEY).
//
// ── Token Ably fusionné ici (?ably=1) ──────────────────────────────────────
// Limite dure Vercel Hobby : 12 fonctions serverless max, déjà toutes prises
// (même raison que la fusion pulse.js+curve.js) — pas de nouveau fichier
// possible pour un endpoint dédié. Rôle identique dans l'esprit (donner au
// client de quoi se connecter à un service tiers sans jamais exposer de
// secret) donc regroupé ici plutôt que forcer un fichier séparé.
//
// Le client Realtime (src/hooks/useAblyLive.js) ne reçoit JAMAIS la clé API
// Ably brute (ABLY_API_KEY, secrète, reste côté serveur) : il obtient un
// tokenRequest borné, généré ici via le SDK serveur, avec capability
// restreinte à `subscribe` uniquement sur les canaux `live-*` — même un
// client malveillant qui l'intercepterait ne pourrait ni publier ni lire
// autre chose que les scores en direct.
import Ably from 'ably'

export default async function handler(req, res) {
  if (req.query.ably !== undefined) {
    const apiKey = process.env.ABLY_API_KEY
    if (!apiKey) {
      return res.status(503).json({ error: 'Ably non configuré sur ce serveur' })
    }
    try {
      const client = new Ably.Rest(apiKey)
      const tokenRequest = await client.auth.createTokenRequest({
        capability: { 'live-*': ['subscribe'] },
      })
      return res.status(200).json(tokenRequest)
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

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
