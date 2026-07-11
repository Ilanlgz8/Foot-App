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
//
// ── Pronos entre amis (groupe par code, pas de compte) ──────────────────────
// Ajouté ici (pas de nouveau fichier, limite 12/12 functions Hobby). Aucune
// donnée sensible : un code à 6 caractères (comme un code Kahoot), un pseudo,
// un deviceId généré côté client (localStorage) qui ne sert qu'à identifier
// "qui a écrit quoi" dans le groupe — aucun mot de passe, aucun email.
// Le calcul des points (pronostic vs résultat réel) se fait côté client
// (Pronos.jsx), pas ici : on ne fait aucun appel réseau supplémentaire pour
// les résultats, donc zéro coût CPU cron ajouté.
// Simplification assumée : le serveur ne vérifie PAS l'heure de coup d'envoi
// du match avant d'accepter un pronostic (pas d'appel FD.org/ESPN ici pour
// rester gratuit) — c'est Pronos.jsx qui masque la saisie une fois le match
// commencé. Feature "entre amis", enjeu nul, donc ce compromis est raisonnable.
//
// POST { action:'createGroup', deviceId, name } → { ok, code }
// POST { action:'join',        deviceId, name, code } → { ok }
// POST { action:'predict', deviceId, code, matchId, home, away } → { ok }
// GET  /api/pulse?resource=group&code=X
//   → { ok, players: {deviceId:name}, predictions: {matchId:{deviceId:{home,away}}} }

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
const GROUP_TTL  = 60 * 60 * 24 * 60  // 60j — largement au-delà de la fin du Mondial 2026
const MAX_PLAYERS = 30
// Alphabet sans caractères ambigus (pas de 0/O ni 1/I) — code lisible à l'oral/écrit
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function isValidMatchId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 40 && /^[a-zA-Z0-9_-]+$/.test(id)
}
function isValidPct(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
}
function isValidGroupCode(code) {
  return typeof code === 'string' && /^[A-Z2-9]{6}$/.test(code)
}
function isValidDeviceId(id) {
  return typeof id === 'string' && id.length >= 8 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id)
}
function isValidName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 24
}
function isValidScore(n) {
  return Number.isInteger(n) && n >= 0 && n <= 20
}
function generateGroupCode() {
  let code = ''
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return code
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
    if (resource === 'group') {
      const code = String(req.query.code ?? '').toUpperCase()
      if (!isValidGroupCode(code)) return res.status(400).json({ error: 'code invalide' })
      try {
        const players = await kv.hgetall(`pg:${code}:players`)
        if (!players) return res.status(404).json({ error: 'groupe introuvable' })
        const matchIds = await kv.smembers(`pg:${code}:predMatches`)
        const predictions = {}
        for (const matchId of matchIds ?? []) {
          const raw = await kv.hgetall(`pg:${code}:pred:${matchId}`)
          if (!raw) continue
          const parsed = {}
          for (const [deviceId, v] of Object.entries(raw)) {
            try { parsed[deviceId] = typeof v === 'string' ? JSON.parse(v) : v } catch { /* ignore */ }
          }
          predictions[matchId] = parsed
        }
        return res.status(200).json({ ok: true, players, predictions })
      } catch (e) {
        console.error('[pulse] group read error:', e.message)
        return res.status(503).json({ error: 'Lecture temporairement indisponible' })
      }
    }

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

  const { action } = body ?? {}

  // ── Actions groupe pronos (pas de matchId requis pour create/join) ───────
  if (action === 'createGroup' || action === 'join') {
    const { deviceId, name } = body
    if (!isValidDeviceId(deviceId)) return res.status(400).json({ error: 'deviceId invalide' })
    if (!isValidName(name)) return res.status(400).json({ error: 'pseudo invalide (1-24 caractères)' })
    const cleanName = name.trim()

    try {
      if (action === 'createGroup') {
        let code = ''
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = generateGroupCode()
          const exists = await kv.exists(`pg:${candidate}:meta`)
          if (!exists) { code = candidate; break }
        }
        if (!code) return res.status(503).json({ error: 'Impossible de générer un code, réessayez' })

        await kv.hset(`pg:${code}:meta`, { createdAt: Date.now() })
        await kv.hset(`pg:${code}:players`, { [deviceId]: cleanName })
        await kv.expire(`pg:${code}:meta`, GROUP_TTL)
        await kv.expire(`pg:${code}:players`, GROUP_TTL)
        return res.status(200).json({ ok: true, code })
      }

      // action === 'join'
      const code = String(body.code ?? '').toUpperCase()
      if (!isValidGroupCode(code)) return res.status(400).json({ error: 'code invalide' })
      const exists = await kv.exists(`pg:${code}:meta`)
      if (!exists) return res.status(404).json({ error: 'groupe introuvable' })
      const players = await kv.hgetall(`pg:${code}:players`)
      const already = players && Object.prototype.hasOwnProperty.call(players, deviceId)
      if (!already && players && Object.keys(players).length >= MAX_PLAYERS) {
        return res.status(403).json({ error: 'groupe complet (30 joueurs max)' })
      }
      await kv.hset(`pg:${code}:players`, { [deviceId]: cleanName })
      await kv.expire(`pg:${code}:players`, GROUP_TTL)
      await kv.expire(`pg:${code}:meta`, GROUP_TTL)
      return res.status(200).json({ ok: true })
    } catch (e) {
      console.error('[pulse] group write error:', e.message)
      return res.status(503).json({ error: 'Écriture temporairement indisponible' })
    }
  }

  if (action === 'predict') {
    const { deviceId, home, away } = body
    const code = String(body.code ?? '').toUpperCase()
    const matchId = String(body.matchId ?? '')
    if (!isValidDeviceId(deviceId)) return res.status(400).json({ error: 'deviceId invalide' })
    if (!isValidGroupCode(code)) return res.status(400).json({ error: 'code invalide' })
    if (!isValidMatchId(matchId)) return res.status(400).json({ error: 'matchId invalide' })
    if (!isValidScore(home) || !isValidScore(away)) return res.status(400).json({ error: 'score invalide' })

    try {
      const isPlayer = await kv.hexists(`pg:${code}:players`, deviceId)
      if (!isPlayer) return res.status(403).json({ error: 'rejoignez le groupe avant de pronostiquer' })

      const predKey = `pg:${code}:pred:${matchId}`
      await kv.hset(predKey, { [deviceId]: JSON.stringify({ home, away }) })
      await kv.expire(predKey, GROUP_TTL)
      await kv.sadd(`pg:${code}:predMatches`, matchId)
      await kv.expire(`pg:${code}:predMatches`, GROUP_TTL)
      return res.status(200).json({ ok: true })
    } catch (e) {
      console.error('[pulse] predict write error:', e.message)
      return res.status(503).json({ error: 'Écriture temporairement indisponible' })
    }
  }

  const { matchId } = body ?? {}
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
