// api/subscribe.js
// Reçoit une Web Push subscription et la stocke dans Vercel KV.
//
// Sécurité :
//   • POST uniquement
//   • Validation stricte de la structure subscription (endpoint + keys)
//   • Rate limiting : 5 tentatives max / IP / heure (stocké dans KV avec TTL)
//   • Vérification de l'Origin pour bloquer les requêtes cross-site non autorisées
//   • Taille max du body : 4 ko (une subscription ne devrait jamais dépasser 1 ko)

import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// Domaines autorisés — production + previews Vercel propres au projet
const ALLOWED_ORIGINS = new Set([
  'https://statfootix.vercel.app',
])

function isAllowedOrigin(origin) {
  if (!origin) return true // pas d'origin = requête serveur (curl, cron)
  if (ALLOWED_ORIGINS.has(origin)) return true
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true
  // Previews Vercel du projet uniquement (préfixe foot-app-)
  if (/^https:\/\/foot-app(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) return true
  return false
}

// Valide qu'un objet est bien une Web Push subscription
function isValidSubscription(sub) {
  if (!sub || typeof sub !== 'object') return false
  if (typeof sub.endpoint !== 'string') return false
  // L'endpoint doit être une URL HTTPS d'un push service connu
  if (!sub.endpoint.startsWith('https://')) return false
  if (!sub.keys || typeof sub.keys !== 'object') return false
  if (typeof sub.keys.p256dh !== 'string' || sub.keys.p256dh.length < 10) return false
  if (typeof sub.keys.auth !== 'string'   || sub.keys.auth.length < 5)    return false
  return true
}

// `teams` (optionnel) : liste des équipes suivies pour filtrer les notifs
// côté cron-goals.js. Absent/vide = comportement historique (tout reçoit).
function sanitizeTeams(teams) {
  if (!Array.isArray(teams)) return []
  return teams
    .filter(t => typeof t === 'string' && t.length > 0 && t.length <= 40)
    .slice(0, 60)
}

export default async function handler(req, res) {
  // ── Vérification Origin (protection CSRF basique) ─────────────────────────
  // En dev local (origin undefined ou localhost), on laisse passer
  const origin = req.headers.origin ?? ''
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Origine non autorisée' })
  }

  // ── Méthode ───────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  // ── Content-Type ──────────────────────────────────────────────────────────
  const ct = req.headers['content-type'] ?? ''
  if (!ct.includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type application/json requis' })
  }

  // ── Rate limiting par IP — 20 tentatives / heure ──────────────────────────
  // Augmenté à 20 car la re-sync automatique à chaque ouverture d'app consomme des slots.
  const ip = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rateLimitKey = `ratelimit:subscribe:${ip}`
  try {
    const count = await kv.incr(rateLimitKey)
    // TTL seulement à la 1ère incrémentation (évite de reset à chaque appel)
    if (count === 1) await kv.expire(rateLimitKey, 3600)
    if (count > 20) {
      return res.status(429).json({ error: 'Trop de tentatives — réessayez dans 1 heure' })
    }
  } catch (kvErr) {
    // Si KV indisponible, on continue (dégradation gracieuse)
    console.error('[subscribe] KV rate limit error:', kvErr.message)
  }

  // ── Parsing du body ───────────────────────────────────────────────────────
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'Body JSON invalide' })
  }

  // Taille max : 4 ko (sécurité anti-payload oversized)
  const bodyStr = JSON.stringify(body)
  if (bodyStr.length > 4096) {
    return res.status(413).json({ error: 'Payload trop grand' })
  }

  // ── Validation de la subscription ─────────────────────────────────────────
  if (!isValidSubscription(body)) {
    return res.status(400).json({ error: 'Structure de subscription invalide' })
  }

  // Reconstruit un objet propre (endpoint + keys + teams) plutôt que de stocker
  // le body brut : évite qu'un champ superflu envoyé par le client change la
  // chaîne JSON et empêche la déduplication/remplacement ci-dessous.
  const teams = sanitizeTeams(body.teams)
  const clean = { endpoint: body.endpoint, keys: body.keys, teams }
  const cleanStr = JSON.stringify(clean)

  // ── Stockage dans Vercel KV (Set Redis) ────────────────────────────────────
  // Le Set est dédupliqué par CONTENU EXACT — si l'utilisateur change ses
  // équipes suivies, le nouveau JSON diffère de l'ancien (même endpoint) et
  // sadd() créerait un doublon au lieu de remplacer. On retire donc d'abord
  // toute entrée existante avec le même endpoint avant d'ajouter la nouvelle.
  try {
    const existing = (await kv.smembers('push:subscriptions')) ?? []
    const stale = existing.filter(raw => {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        return parsed?.endpoint === body.endpoint
      } catch { return false }
    })
    if (stale.length) await Promise.all(stale.map(s => kv.srem('push:subscriptions', s)))
    await kv.sadd('push:subscriptions', cleanStr)
  } catch (kvErr) {
    console.error('[subscribe] KV store error:', kvErr.message)
    return res.status(503).json({ error: 'Stockage temporairement indisponible' })
  }

  return res.status(201).json({ ok: true })
}
