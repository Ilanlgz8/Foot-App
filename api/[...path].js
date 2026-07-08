// Proxy football-data.org — catch-all Vercel pour /api/v4/**
//
// ⚠️ Ce endpoint n'est PAS utilisé par le front actuel (tous les hooks passent
// par fdUrl()/api/football.js, qui a son propre cache Redis) — vérifié par
// audit du code. Il reste néanmoins une route publique appelable directement
// (curl, bot) qui utiliserait notre clé API_KEY sans aucune protection.
// Budget global léger en défense en profondeur, avec sa PROPRE clé Redis
// (fdcatchall:quota:min:*, distincte de celle du cache de football.js) —
// ⚠️ ne JAMAIS partager cette clé avec api/football.js : ce dernier gère un
// volume légitime bien plus élevé (tout le trafic normal de l'app), et un
// budget partagé finirait par bloquer de vraies requêtes utilisateur (bug
// vécu : classements/stats saison indisponibles après un partage de clé mal
// dimensionné).
import { Redis } from '@upstash/redis'

let kv = null
function getKv() {
  if (!kv && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  }
  return kv
}

const FD_MINUTE_CAP = 5 // ce endpoint n'a normalement AUCUN trafic légitime

async function reserveFdQuota() {
  const redis = getKv()
  if (!redis) return true // Redis indisponible → on ne bloque pas tout le service pour ça
  const minuteKey = `fdcatchall:quota:min:${new Date().toISOString().slice(0, 16)}`
  try {
    const count = await redis.incr(minuteKey)
    if (count === 1) await redis.expire(minuteKey, 70)
    return count <= FD_MINUTE_CAP
  } catch {
    return true
  }
}

export default async function handler(req, res) {
  // GET uniquement — pas de proxying de mutations vers FD.org avec notre clé API
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  if (!(await reserveFdQuota())) {
    return res.status(200).json({ errors: { quota: 'Budget interne football-data.org atteint, réessaie plus tard' } })
  }

  try {
    const { path: segments } = req.query
    const parts   = Array.isArray(segments) ? segments : [segments]
    const apiPath = '/' + parts.join('/')

    // Utiliser le query string brut de req.url pour éviter le re-encodage des virgules
    // (new URLSearchParams encoderait competitions=CL,PL → CL%2CPL, rejeté par football-data.org)
    const qsStart = (req.url ?? '').indexOf('?')
    const qs      = qsStart >= 0 ? req.url.slice(qsStart) : ''
    const url     = `https://api.football-data.org${apiPath}${qs}`

    if (!process.env.API_KEY) {
      return res.status(500).json({ error: 'API_KEY not configured on Vercel' })
    }

    const response = await fetch(url, {
      headers: { 'X-Auth-Token': process.env.API_KEY },
    })

    const body = await response.text()
    res.status(response.status)
       .setHeader('Content-Type', 'application/json')
       .send(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
