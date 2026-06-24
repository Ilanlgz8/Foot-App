// Proxy api-football.com — clé APIFOOTBALL_KEY côté serveur uniquement
// Cache Redis par endpoint pour éviter de consommer le quota (100 req/jour)
import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// TTL cache Redis selon le type d'endpoint
function cacheTTL(endpoint) {
  if (endpoint.includes('lineups'))    return 7  * 24 * 3600  // 7 jours — lineups ne changent pas
  if (endpoint.includes('statistics')) return 2  * 3600        // 2h — stats live
  if (endpoint.includes('status'))     return 60               // 1min — quota restant
  return 6 * 3600                                              // 6h — fixtures et autres
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  const { _ep, ...rest } = req.query
  const endpoint = _ep ?? 'fixtures'

  if (!/^[a-z0-9/_-]+$/i.test(endpoint)) {
    return res.status(400).json({ error: 'Invalid endpoint' })
  }

  const queryStr = new URLSearchParams(rest).toString()

  // ── 1. Cache Redis (avant le rate limit pour économiser quota) ────────────────
  const cacheKey = `aflcache:${endpoint}:${queryStr}`
  try {
    const cached = await kv.get(cacheKey)
    if (cached) {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('x-cache', 'HIT')
      return res.send(typeof cached === 'string' ? cached : JSON.stringify(cached))
    }
  } catch { /* Redis down → continue */ }

  // ── 2. Fetch api-football ────────────────────────────────────────────────────
  try {
    const url = `https://v3.football.api-sports.io/${endpoint}${queryStr ? `?${queryStr}` : ''}`
    const response = await fetch(url, {
      headers: { 'x-apisports-key': process.env.APIFOOTBALL_KEY ?? '' },
    })

    const body      = await response.text()
    const remaining = response.headers.get('x-ratelimit-requests-remaining')

    // ── 4. Stocker en cache si succès ─────────────────────────────────────────
    if (response.ok) {
      const ttl = cacheTTL(endpoint)
      try { await kv.set(cacheKey, body, { ex: ttl }) } catch {}
    }

    res.status(response.status).setHeader('Content-Type', 'application/json')
    res.setHeader('x-cache', 'MISS')
    if (remaining) res.setHeader('x-quota-remaining', remaining)
    res.send(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
