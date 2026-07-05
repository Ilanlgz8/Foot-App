// api/curve.js
// Courbe de bascule post-match — échantillonne la proba de victoire en
// direct (calcLiveProno, calculée côté client) minute par minute, agrégée
// côté serveur (Redis) pour que TOUT utilisateur consultant le match a
// posteriori voie la courbe, même s'il n'a pas suivi ce match en direct
// lui-même. Dédupliqué par minute (Hash Redis, un champ par minute) :
// plusieurs spectateurs du même match en même temps écrivent simplement la
// même valeur au même champ, aucune accumulation ni doublon.
//
// GET  /api/curve?matchId=X                        → { samples: [{ minute, home, draw, away }, ...] } triés
// POST /api/curve { matchId, minute, home, draw, away }

import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

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

const CURVE_TTL = 60 * 60 * 24 * 3 // 3 jours — largement assez pour consulter le récap après coup

function isValidMatchId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(id)
}
function isValidPct(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
}

export default async function handler(req, res) {
  const origin = req.headers.origin ?? ''
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Origine non autorisée' })
  }

  // ── GET : lecture publique de la courbe agrégée ─────────────────────────
  if (req.method === 'GET') {
    const matchId = String(req.query.matchId ?? '')
    if (!isValidMatchId(matchId)) return res.status(400).json({ error: 'matchId invalide' })
    try {
      const raw = await kv.hgetall(`curve:${matchId}`)
      const samples = Object.entries(raw ?? {})
        .map(([minute, v]) => {
          try {
            const parsed = typeof v === 'string' ? JSON.parse(v) : v
            return { minute: Number(minute), home: parsed.home, draw: parsed.draw, away: parsed.away }
          } catch { return null }
        })
        .filter(Boolean)
        .sort((a, b) => a.minute - b.minute)
      return res.status(200).json({ ok: true, samples })
    } catch (e) {
      console.error('[curve] read error:', e.message)
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

  // Rate limit IP généreux : ce endpoint est appelé automatiquement par
  // l'app en arrière-plan (pas par un clic), potentiellement une fois par
  // minute de match suivi en direct — pas un clic utilisateur isolé.
  const ip = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rateLimitKey = `ratelimit:curve:${ip}`
  try {
    const count = await kv.incr(rateLimitKey)
    if (count === 1) await kv.expire(rateLimitKey, 600)
    if (count > 300) return res.status(429).json({ error: 'Trop de tentatives' })
  } catch (e) {
    console.error('[curve] rate limit error:', e.message)
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

  const { matchId, minute, home, draw, away } = body ?? {}
  if (!isValidMatchId(matchId)) return res.status(400).json({ error: 'matchId invalide' })
  if (!Number.isInteger(minute) || minute < 0 || minute > 130) {
    return res.status(400).json({ error: 'minute invalide' })
  }
  if (!isValidPct(home) || !isValidPct(draw) || !isValidPct(away)) {
    return res.status(400).json({ error: 'proba invalide' })
  }

  try {
    const curveKey = `curve:${matchId}`
    await kv.hset(curveKey, { [String(minute)]: JSON.stringify({ home, draw, away }) })
    await kv.expire(curveKey, CURVE_TTL)
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('[curve] write error:', e.message)
    return res.status(503).json({ error: 'Écriture temporairement indisponible' })
  }
}
