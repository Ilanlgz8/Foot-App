// api/pulse.js
// "Pouls collectif" — pronostic des fans (vote anonyme 1/X/2) + réactions
// live (emoji) + courbe de bascule (échantillons de calcLiveProno minute par
// minute), tout agrégé par match dans un seul fichier. Fusionné avec l'ex
// api/curve.js pour rester sous la limite de 12 Serverless Functions du plan
// Hobby Vercel (deux endpoints très proches en usage/infra — même client
// Redis, même modèle "pas de compte" — n'avaient pas besoin d'être séparés).
//
// GET  /api/pulse?matchId=X
//   → { votes: { home, draw, away, total }, reactions: { '⚽': n, ... } }
// GET  /api/pulse?matchId=X&resource=curve
//   → { samples: [{ minute, home, draw, away }, ...] } triés par minute
//
// POST /api/pulse { matchId, deviceId, action: 'vote', choice: 'home'|'draw'|'away' }
//   → change (ou pose) le vote de ce device pour ce match, idempotent si
//     déjà le même choix.
// POST /api/pulse { matchId, deviceId, action: 'react', emoji }
//   → incrémente le compteur de cet emoji. Cooldown 1.5s/device (SET NX PX).
// POST /api/pulse { matchId, action: 'sample', minute, home, draw, away }
//   → enregistre un point de la courbe de bascule (pas de deviceId : donnée
//     algorithmique, pas une opinion utilisateur — dédupliquée par minute
//     côté serveur, peu importe qui l'envoie).

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

const CHOICES    = new Set(['home', 'draw', 'away'])
const EMOJIS     = new Set(['⚽', '🔥', '😱', '👏', '😡'])
const PULSE_TTL  = 60 * 60 * 8        // 8h — couvre largement un match + prolongations + tab
const CURVE_TTL  = 60 * 60 * 24 * 3   // 3j — le temps de consulter le récap après coup

function isValidMatchId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(id)
}
function isValidDeviceId(id) {
  return typeof id === 'string' && id.length >= 8 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id)
}
function isValidPct(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
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

async function readCurve(matchId) {
  const raw = await kv.hgetall(`curve:${matchId}`)
  return Object.entries(raw ?? {})
    .map(([minute, v]) => {
      try {
        const parsed = typeof v === 'string' ? JSON.parse(v) : v
        return { minute: Number(minute), home: parsed.home, draw: parsed.draw, away: parsed.away }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => a.minute - b.minute)
}

export default async function handler(req, res) {
  const origin = req.headers.origin ?? ''
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Origine non autorisée' })
  }

  const resource = String(req.query.resource ?? 'pulse')

  // ── GET : lecture publique (données déjà anonymes/agrégées) ─────────────
  if (req.method === 'GET') {
    const matchId = String(req.query.matchId ?? '')
    if (!isValidMatchId(matchId)) return res.status(400).json({ error: 'matchId invalide' })
    try {
      if (resource === 'curve') {
        const samples = await readCurve(matchId)
        return res.status(200).json({ ok: true, samples })
      }
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

  // Rate limit par IP — 300 actions / 10min. Généreux car 'sample' est
  // envoyé automatiquement par l'app (~1x/minute de match suivi en direct),
  // pas seulement sur clic utilisateur (vote/react).
  const ip = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rateLimitKey = `ratelimit:pulse:${ip}`
  try {
    const count = await kv.incr(rateLimitKey)
    if (count === 1) await kv.expire(rateLimitKey, 600)
    if (count > 300) return res.status(429).json({ error: 'Trop de tentatives — réessayez plus tard' })
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
  if (!isValidMatchId(matchId)) return res.status(400).json({ error: 'matchId invalide' })

  try {
    // ── Vote pronostic (1/X/2) ──────────────────────────────────────────────
    if (action === 'vote') {
      if (!isValidDeviceId(deviceId)) return res.status(400).json({ error: 'deviceId invalide' })
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
      if (!isValidDeviceId(deviceId)) return res.status(400).json({ error: 'deviceId invalide' })
      if (!EMOJIS.has(body.emoji)) return res.status(400).json({ error: 'emoji invalide' })

      // Cooldown 1.5s / device / match — SET NX PX atomique (une seule
      // requête réseau, pas de race condition entre lecture et écriture).
      const cooldownKey = `pulse:cooldown:${matchId}:${deviceId}`
      const acquired = await kv.set(cooldownKey, '1', { nx: true, px: 1500 })
      if (!acquired) return res.status(429).json({ error: 'Trop rapide' })

      const reactionsKey = `pulse:reactions:${matchId}`
      await kv.hincrby(reactionsKey, body.emoji, 1)
      await kv.expire(reactionsKey, PULSE_TTL)

      const data = await readAggregate(matchId)
      return res.status(200).json({ ok: true, ...data })
    }

    // ── Échantillon de la courbe de bascule ─────────────────────────────────
    if (action === 'sample') {
      const { minute, home, draw, away } = body
      if (!Number.isInteger(minute) || minute < 0 || minute > 130) {
        return res.status(400).json({ error: 'minute invalide' })
      }
      if (!isValidPct(home) || !isValidPct(draw) || !isValidPct(away)) {
        return res.status(400).json({ error: 'proba invalide' })
      }
      const curveKey = `curve:${matchId}`
      await kv.hset(curveKey, { [String(minute)]: JSON.stringify({ home, draw, away }) })
      await kv.expire(curveKey, CURVE_TTL)
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'action invalide' })
  } catch (e) {
    console.error('[pulse] write error:', e.message)
    return res.status(503).json({ error: 'Écriture temporairement indisponible' })
  }
}
