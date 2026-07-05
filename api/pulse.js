// api/pulse.js
// "Pouls collectif" — pronostic des fans (vote anonyme 1/X/2) + réactions
// live (emoji), agrégés par match. Aucun compte utilisateur : chaque device
// est identifié par un UUID anonyme généré côté client et persisté en
// localStorage (même modèle de confidentialité que matchStateTracker.js /
// notify.js ailleurs dans l'app) — pas de nom, pas d'email, rien de
// personnel, juste un compteur agrégé.
//
// GET  /api/pulse?matchId=X
//   → { votes: { home, draw, away, total }, reactions: { '⚽': n, ... } }
//
// POST /api/pulse { matchId, deviceId, action: 'vote', choice: 'home'|'draw'|'away' }
//   → change (ou pose) le vote de ce device pour ce match, idempotent si
//     déjà le même choix. Un device peut changer d'avis (rare mais géré
//     proprement : décrémente l'ancien choix avant d'incrémenter le nouveau).
//
// POST /api/pulse { matchId, deviceId, action: 'react', emoji }
//   → incrémente le compteur de cet emoji pour ce match. Cooldown 1.5s par
//     device (SET NX PX atomique) — anti-spam sans bloquer un vrai fan qui
//     tape plusieurs fois de suite.

import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// Domaines autorisés — même liste que api/subscribe.js
const ALLOWED_ORIGINS = new Set([
  'https://statfootix.vercel.app',
])

function isAllowedOrigin(origin) {
  if (!origin) return true // pas d'origin = requête serveur (curl, cron)
  if (ALLOWED_ORIGINS.has(origin)) return true
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true
  if (/^https:\/\/foot-app(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) return true
  return false
}

const CHOICES  = new Set(['home', 'draw', 'away'])
const EMOJIS   = new Set(['⚽', '🔥', '😱', '👏', '😡'])
const PULSE_TTL = 60 * 60 * 8 // 8h — couvre largement un match + prolongations + tab

function isValidMatchId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(id)
}
function isValidDeviceId(id) {
  return typeof id === 'string' && id.length >= 8 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id)
}

async function readAggregate(matchId) {
  const [votes, reactions] = await Promise.all([
    kv.hgetall(`pulse:votes:${matchId}`),
    kv.hgetall(`pulse:reactions:${matchId}`),
  ])
  const home = Number(votes?.home ?? 0)
  const draw = Number(votes?.draw ?? 0)
  const away = Number(votes?.away ?? 0)
  return {
    votes: { home, draw, away, total: home + draw + away },
    reactions: reactions ?? {},
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin ?? ''
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Origine non autorisée' })
  }

  // ── GET : lecture de l'agrégat — public, pas d'auth (données déjà anonymes) ──
  if (req.method === 'GET') {
    const matchId = String(req.query.matchId ?? '')
    if (!isValidMatchId(matchId)) return res.status(400).json({ error: 'matchId invalide' })
    try {
      const data = await readAggregate(matchId)
      return res.status(200).json({ ok: true, ...data })
    } catch (e) {
      console.error('[pulse] read error:', e.message)
      return res.status(503).json({ error: 'Lecture temporairement indisponible' })
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  const ct = req.headers['content-type'] ?? ''
  if (!ct.includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type application/json requis' })
  }

  // Rate limit par IP — 60 actions / 10min (vote + réactions cumulés). Le
  // cooldown par device (voir action 'react' plus bas) gère le spam fin ;
  // ceci protège contre un abus plus large (script, plusieurs devices/IP).
  const ip = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rateLimitKey = `ratelimit:pulse:${ip}`
  try {
    const count = await kv.incr(rateLimitKey)
    if (count === 1) await kv.expire(rateLimitKey, 600)
    if (count > 60) return res.status(429).json({ error: 'Trop de tentatives — réessayez plus tard' })
  } catch (e) {
    console.error('[pulse] rate limit error:', e.message)
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'Body JSON invalide' })
  }
  if (JSON.stringify(body ?? {}).length > 512) {
    return res.status(413).json({ error: 'Payload trop grand' })
  }

  const { matchId, deviceId, action } = body ?? {}
  if (!isValidMatchId(matchId) || !isValidDeviceId(deviceId)) {
    return res.status(400).json({ error: 'matchId/deviceId invalide' })
  }

  try {
    // ── Vote pronostic (1/X/2) ──────────────────────────────────────────────
    if (action === 'vote') {
      const { choice } = body
      if (!CHOICES.has(choice)) return res.status(400).json({ error: 'choice invalide' })

      const voterKey = `pulse:voter:${matchId}:${deviceId}`
      const previous  = await kv.get(voterKey)

      if (previous !== choice) {
        const votesKey = `pulse:votes:${matchId}`
        if (previous && CHOICES.has(previous)) {
          await kv.hincrby(votesKey, previous, -1)
        }
        await kv.hincrby(votesKey, choice, 1)
        await kv.expire(votesKey, PULSE_TTL)
        await kv.set(voterKey, choice, { ex: PULSE_TTL })
      }

      const data = await readAggregate(matchId)
      return res.status(200).json({ ok: true, myVote: choice, ...data })
    }

    // ── Réaction emoji live ─────────────────────────────────────────────────
    if (action === 'react') {
      if (!EMOJIS.has(body.emoji)) return res.status(400).json({ error: 'emoji invalide' })

      // Cooldown 1.5s / device / match — SET NX PX atomique (une seule
      // requête réseau, pas de race condition possible entre lecture et
      // écriture comme le serait un GET puis SET séparés).
      const cooldownKey = `pulse:cooldown:${matchId}:${deviceId}`
      const acquired = await kv.set(cooldownKey, '1', { nx: true, px: 1500 })
      if (!acquired) return res.status(429).json({ error: 'Trop rapide' })

      const reactionsKey = `pulse:reactions:${matchId}`
      await kv.hincrby(reactionsKey, body.emoji, 1)
      await kv.expire(reactionsKey, PULSE_TTL)

      const data = await readAggregate(matchId)
      return res.status(200).json({ ok: true, ...data })
    }

    return res.status(400).json({ error: 'action invalide' })
  } catch (e) {
    console.error('[pulse] write error:', e.message)
    return res.status(503).json({ error: 'Écriture temporairement indisponible' })
  }
}
