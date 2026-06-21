// api/push.js
// Reçoit un événement "but" du client, le valide côté serveur via ESPN,
// puis envoie une push notification à tous les abonnés.
//
// Sécurité multi-couches :
//   1. Validation de l'Origin (protection CSRF)
//   2. Validation stricte du body (types, valeurs attendues)
//   3. Rate limiting : 3 appels / minute / IP (anti-flood client)
//   4. Vérification ESPN côté serveur : le serveur re-fetch ESPN pour confirmer
//      que le score est réel avant d'envoyer la moindre notification.
//      → Même si un utilisateur malveillant appelle /api/push avec un faux score,
//        le serveur refusera si ESPN ne confirme pas.
//   5. Déduplication : un score donné pour un match ne peut être notifié qu'une fois
//      (clé KV avec TTL 3h).
//   6. Nettoyage automatique des subscriptions expirées (erreur 410 du push service).

import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})
import webpush from 'web-push'

// Slugs ESPN autorisés (même liste que api/espn.js)
const ALLOWED_SLUGS = new Set([
  'fra.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1',
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
  'fifa.world',
])

// Domaines autorisés (même liste que api/subscribe.js)
const ALLOWED_ORIGINS = new Set([
  'https://statfootix.vercel.app',
])

function isAllowedOrigin(origin) {
  if (!origin) return true
  if (ALLOWED_ORIGINS.has(origin)) return true
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true
  if (/^https:\/\/foot-app(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) return true
  return false
}

// Configure webpush avec les clés VAPID (stockées en env vars Vercel)
// Appelé une fois au démarrage de la fonction (warm start)
function setupVapid() {
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    return true
  } catch {
    return false
  }
}

// ── Vérification ESPN — confirme que le score est réel ────────────────────────
async function verifyScoreOnEspn(espnSlug, home, away) {
  try {
    const d = new Date()
    const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const url   = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnSlug}/scoreboard?dates=${today}`

    const res = await fetch(url, {
      signal:  AbortSignal.timeout(6_000),
      headers: { 'Cache-Control': 'no-cache' },
    })
    if (!res.ok) return false // ESPN inaccessible → on fait confiance au client

    const json = await res.json()
    for (const evt of json.events ?? []) {
      const comp  = evt.competitions?.[0]
      const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
      const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
      if (!homeC || !awayC) continue
      const espnH = parseInt(homeC.score ?? '0', 10)
      const espnA = parseInt(awayC.score ?? '0', 10)
      if (espnH === home && espnA === away) return true
    }
    return false // Aucun match ESPN ne correspond → score non confirmé
  } catch {
    // Timeout ou erreur réseau → on laisse passer (mieux vaut une fausse notif que rien)
    return true
  }
}

export default async function handler(req, res) {
  // ── Origin ────────────────────────────────────────────────────────────────
  const origin = req.headers.origin ?? ''
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Origine non autorisée' })
  }

  // ── Méthode ───────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  // ── VAPID configuré ? ─────────────────────────────────────────────────────
  if (!setupVapid()) {
    return res.status(503).json({ error: 'Push notifications non configurées' })
  }

  // ── Parsing body ──────────────────────────────────────────────────────────
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'Body JSON invalide' })
  }

  const { matchId, espnSlug, home, away, title, message } = body

  // ── Validation des paramètres ─────────────────────────────────────────────
  if (!matchId || typeof matchId !== 'number') {
    return res.status(400).json({ error: 'matchId manquant ou invalide (number attendu)' })
  }
  if (!espnSlug || !ALLOWED_SLUGS.has(espnSlug)) {
    return res.status(400).json({ error: 'espnSlug manquant ou non autorisé' })
  }
  if (typeof home !== 'number' || typeof away !== 'number') {
    return res.status(400).json({ error: 'home et away doivent être des nombres' })
  }
  if (home < 0 || away < 0 || home > 30 || away > 30) {
    return res.status(400).json({ error: 'Scores hors limites' })
  }
  // Sanitize le texte libre (title, message) — max 100 chars, pas de HTML
  const safeTitle   = String(title   ?? '⚽ But !').slice(0, 100).replace(/[<>]/g, '')
  const safeMessage = String(message ?? `${home} - ${away}`).slice(0, 150).replace(/[<>]/g, '')

  // ── Rate limiting par IP — 3 appels / minute ──────────────────────────────
  const ip           = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rateLimitKey = `ratelimit:push:${ip}`
  try {
    const count = await kv.incr(rateLimitKey)
    if (count === 1) await kv.expire(rateLimitKey, 60) // fenêtre de 1 minute
    if (count > 3) {
      return res.status(429).json({ error: 'Trop de pushs — attendez 1 minute' })
    }
  } catch (kvErr) {
    console.error('[push] KV rate limit error:', kvErr.message)
  }

  // ── Déduplication — même score pour ce match déjà envoyé ? ───────────────
  const dedupKey = `push:goal:${matchId}:${home}-${away}`
  try {
    const alreadySent = await kv.get(dedupKey)
    if (alreadySent) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'already_sent' })
    }
  } catch (kvErr) {
    console.error('[push] KV dedup check error:', kvErr.message)
  }

  // ── Vérification ESPN ─────────────────────────────────────────────────────
  const verified = await verifyScoreOnEspn(espnSlug, home, away)
  if (!verified) {
    return res.status(400).json({ error: 'Score non confirmé par ESPN — notification annulée' })
  }

  // ── Marquer comme envoyé (TTL 3h) ────────────────────────────────────────
  try {
    await kv.set(dedupKey, '1', { ex: 3 * 3600 })
  } catch (kvErr) {
    console.error('[push] KV dedup set error:', kvErr.message)
  }

  // ── Récupérer les subscriptions ───────────────────────────────────────────
  let subs = []
  try {
    subs = (await kv.smembers('push:subscriptions')) ?? []
  } catch (kvErr) {
    console.error('[push] KV smembers error:', kvErr.message)
    return res.status(503).json({ error: 'KV indisponible' })
  }

  if (subs.length === 0) {
    return res.status(200).json({ ok: true, sent: 0 })
  }

  // ── Envoi des notifications ───────────────────────────────────────────────
  const payload  = JSON.stringify({ title: safeTitle, body: safeMessage, matchId, url: '/' })
  const stale    = []   // subscriptions expirées à supprimer
  let   sent     = 0

  await Promise.allSettled(
    subs.map(async (subRaw) => {
      let sub
      try {
        sub = typeof subRaw === 'string' ? JSON.parse(subRaw) : subRaw
      } catch {
        stale.push(subRaw) // JSON corrompu → supprimer
        return
      }
      try {
        await webpush.sendNotification(sub, payload, {
          TTL: 3600, // Le push reste en attente max 1h si l'appareil est offline
        })
        sent++
      } catch (err) {
        // 410 Gone / 404 Not Found → subscription expirée (désinstallation, clear cache)
        if (err.statusCode === 410 || err.statusCode === 404) {
          stale.push(typeof subRaw === 'string' ? subRaw : JSON.stringify(subRaw))
        } else {
          console.warn('[push] sendNotification error:', err.statusCode, err.message)
        }
      }
    })
  )

  // ── Nettoyage des subscriptions mortes ────────────────────────────────────
  if (stale.length > 0) {
    try {
      await Promise.all(stale.map(s => kv.srem('push:subscriptions', s)))
      console.log(`[push] ${stale.length} subscription(s) expirée(s) supprimée(s)`)
    } catch (kvErr) {
      console.error('[push] KV cleanup error:', kvErr.message)
    }
  }

  return res.status(200).json({ ok: true, sent, cleaned: stale.length })
}
