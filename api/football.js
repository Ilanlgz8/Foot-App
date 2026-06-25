// Proxy football-data.org avec cache Redis (Upstash)
//
// Stratégie : check Redis d'abord → si hit, réponse instantanée (0 appel FD.org)
//             Si miss → fetch FD.org → stocke en Redis → répond au client
//
// TTL Redis par type d'endpoint :
//   IN_PLAY/PAUSED    → pas de cache (ESPN gère le live)
//   Résultats FINISHED → 5 min
//   Classements        → 10 min
//   Buteurs            → 30 min
//   Matchs du jour     → 2 min
//   SCHEDULED/TIMED    → 5 min
//   Détail match (FT)  → 1 h
//   Autres             → 2 min

import { Redis } from '@upstash/redis'

let kv = null
function getKv() {
  if (!kv && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  }
  return kv
}

function getTtl(fdPath, qs) {
  if (qs.includes('status=IN_PLAY') || qs.includes('status=PAUSED')) return 0
  if (/^\/v4\/matches\/\d+$/.test(fdPath) && !qs) return 3600         // détail FT — 1h
  if (fdPath.includes('/head2head'))             return 3600           // H2H stable — 1h
  if (qs.includes('status=FINISHED'))              return 300           // résultats — 5min
  if (fdPath.includes('/standings'))               return 600           // classements — 10min
  if (fdPath.includes('/scorers'))                 return 1800          // buteurs — 30min
  if (qs.includes('dateFrom=') && qs.includes('dateTo=')) return 120   // matchs du jour — 2min
  if (qs.includes('status=SCHEDULED') || qs.includes('status=TIMED')) return 300 // calendrier — 5min
  return 120  // défaut — 2min
}

function getCacheControl(ttl) {
  if (ttl === 0) return 'no-store'
  return `public, s-maxage=${ttl}, stale-while-revalidate=${Math.round(ttl / 2)}`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  try {
    const { apiPath } = req.query
    const fdPath = apiPath ?? '/'

    const rawQs = (req.url ?? '').split('?')[1] ?? ''
    const qs = rawQs
      .split('&')
      .filter(p => p && !p.startsWith('apiPath='))
      .join('&')

    const ttl      = getTtl(fdPath, qs)
    const cacheKey = `fd:${fdPath}${qs ? '?' + qs : ''}`
    const redis    = getKv()

    // ── Tentative de lecture depuis Redis ────────────────────────────────────
    if (ttl > 0 && redis) {
      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          return res
            .status(200)
            .setHeader('Content-Type', 'application/json')
            .setHeader('Cache-Control', getCacheControl(ttl))
            .setHeader('X-Cache', 'HIT')
            .send(typeof cached === 'string' ? cached : JSON.stringify(cached))
        }
      } catch { /* Redis indisponible → on continue vers FD.org */ }
    }

    // ── Fetch football-data.org ──────────────────────────────────────────────
    const url = `https://api.football-data.org${fdPath}${qs ? '?' + qs : ''}`
    const response = await fetch(url, {
      headers: { 'X-Auth-Token': process.env.API_KEY ?? process.env.FOOTBALL_DATA_API_KEY ?? '' },
      signal: AbortSignal.timeout(8_000),
    })

    const body = await response.text()

    // ── Mise en cache Redis si réponse OK ────────────────────────────────────
    if (ttl > 0 && redis && response.ok) {
      try {
        await redis.set(cacheKey, body, { ex: ttl })
      } catch { /* silently ignore — pas critique */ }
    }

    res
      .status(response.status)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', getCacheControl(ttl))
      .setHeader('X-Cache', 'MISS')
      .send(body)

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
