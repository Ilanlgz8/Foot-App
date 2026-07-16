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
// Le client Realtime (src/hooks/useLiveMinute.js, voir getAblyClient()) ne reçoit JAMAIS la clé API
// Ably brute (ABLY_API_KEY, secrète, reste côté serveur) : il obtient un
// tokenRequest borné, généré ici via le SDK serveur, avec capability
// restreinte à `subscribe` uniquement sur les canaux `live-*` — même un
// client malveillant qui l'intercepterait ne pourrait ni publier ni lire
// autre chose que les scores en direct.
import Ably from 'ably'
import { Redis } from '@upstash/redis'

let kv = null
function getKv() {
  if (!kv && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  }
  return kv
}

export default async function handler(req, res) {
  if (req.query.ably !== undefined) {
    const apiKey = process.env.ABLY_API_KEY
    if (!apiKey) {
      return res.status(503).json({ error: 'Ably non configuré sur ce serveur' })
    }
    // ── Rate limit (audit sécurité) : seul mode de cet endpoint qui déclenche
    // un vrai appel sortant (création de token Ably) — sans garde-fou, un
    // appel en boucle (curl/bot) pouvait générer un nombre illimité de
    // créations de token. Même pattern (compteur Redis/IP, fenêtre 60s) que
    // les autres proxies de l'app (espn.js, fifa-live.js, pulse.js...).
    const redis = getKv()
    if (redis) {
      try {
        const ip    = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
        const rlKey = `ratelimit:ablytoken:${ip}`
        const count = await redis.incr(rlKey)
        if (count === 1) await redis.expire(rlKey, 60)
        if (count > 30) return res.status(429).json({ error: 'Trop de requêtes' })
      } catch { /* Redis indisponible → on ne bloque pas le service pour ça */ }
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
