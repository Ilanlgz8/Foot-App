// Proxy api-football.com — clé APIFOOTBALL_KEY côté serveur uniquement
import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  // GET uniquement
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  // Rate limiting : 30 req / IP / heure (quota FD = 100/jour, on protège)
  const ip  = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const key = `ratelimit:apifb:${ip}`
  try {
    const count = await kv.incr(key)
    if (count === 1) await kv.expire(key, 3600)
    if (count > 30) return res.status(429).json({ error: 'Trop de requêtes — réessayez dans 1h' })
  } catch { /* Redis down → laisser passer en dégradation gracieuse */ }

  try {
    const { _ep, ...rest } = req.query
    const endpoint = _ep ?? 'fixtures'

    if (!/^[a-z0-9/_-]+$/i.test(endpoint)) return res.status(400).json({ error: 'Invalid endpoint' })

    const queryStr = new URLSearchParams(rest).toString()
    const url = `https://v3.football.api-sports.io/${endpoint}${queryStr ? `?${queryStr}` : ''}`

    const response = await fetch(url, {
      headers: { 'x-apisports-key': process.env.APIFOOTBALL_KEY ?? '' },
    })

    const body      = await response.text()
    const remaining = response.headers.get('x-ratelimit-requests-remaining')

    res.status(response.status).setHeader('Content-Type', 'application/json')
    if (remaining) res.setHeader('x-quota-remaining', remaining)
    res.send(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
