// api/pulse.js
// Courbe de bascule (échantillons de calcLiveProno minute par minute),
// utilisée par ProbaCurve. Anciennement fusionné avec le "Pouls collectif"
// (vote/react/resolve/leaderboard) pour rester sous la limite de 12
// Serverless Functions du plan Hobby Vercel — cette partie a été retirée à
// la demande de l'utilisateur (fonctionnalité classement/pronostic des fans
// abandonnée), seule la courbe de bascule est conservée ici.
//
// GET  /api/pulse?matchId=X&resource=curve
//   → { samples: [{ minute, home, draw, away }, ...] } triés par minute
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

const CURVE_TTL  = 60 * 60 * 24 * 3   // 3j — le temps de consulter le récap après coup

function isValidMatchId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(id)
}
function isValidPct(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
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

  // ── GET : lecture publique (données déjà agrégées) ──────────────────────
  if (req.method === 'GET') {
    const matchId = String(req.query.matchId ?? '')
    if (!isValidMatchId(matchId)) return res.status(400).json({ error: 'matchId invalide' })
    try {
      if (resource === 'curve') {
        const samples = await readCurve(matchId)
        return res.status(200).json({ ok: true, samples })
      }
      return res.status(400).json({ error: 'resource invalide' })
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
  // pas seulement sur clic utilisateur.
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

  const { matchId, action } = body ?? {}
  if (!isValidMatchId(matchId)) return res.status(400).json({ error: 'matchId invalide' })

  try {
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
