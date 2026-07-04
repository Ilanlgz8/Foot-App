// Proxy api-football.com — clé APIFOOTBALL_KEY côté serveur uniquement
// Cache Redis par endpoint pour éviter de consommer le quota (100 req/jour)
// (redeploy forcé pour vérifier la prise en compte d'une nouvelle valeur de clé)
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

// ── Budget interne — empêche de redéclencher le blocage anti-abus d'api-football ──
// Confirmé (api-football.com/news/post/how-ratelimit-works, recherche faite
// suite au constat utilisateur "le compte a déjà sauté 6 fois") : le plan
// gratuit autorise 10 req/min ET 100 req/jour (reset 00:00 UTC) — dépasser le
// débit PAR MINUTE (via un pic de trafic, même bref) peut déclencher un
// blocage TEMPORAIRE OU PERMANENT de la clé/l'IP, sans préavis, en plus des
// simples 429. Root cause très probable des suspensions répétées : ce proxy
// ne limitait QUE les appels identiques (cache par endpoint+params), jamais
// le DÉBIT global vers l'upstream — un pic de matchs live simultanés
// (plusieurs championnats + Mondial, plusieurs utilisateurs, endpoints/params
// différents = autant de cache miss) peut facilement dépasser 10/min sans
// qu'aucun garde-fou ne l'empêche jusqu'ici.
//
// Fix : un budget interne, sous les vraies limites (marge de sécurité), qui
// empêche TOUT appel upstream au-delà — mieux vaut renvoyer "pas de donnée
// pour l'instant" (déjà géré gracieusement côté UI, voir le fix Classement.jsx
// qui masque l'onglet Passeurs sur erreur) que de re-déclencher un blocage.
const MINUTE_CAP = 7   // sur 10/min réels
const DAILY_CAP   = 80  // sur 100/jour réels

async function reserveQuota() {
  const now       = new Date()
  const minuteKey = `aflcache:quota:min:${now.toISOString().slice(0, 16)}`
  const dayKey    = `aflcache:quota:day:${now.toISOString().slice(0, 10)}`
  try {
    const [minuteCount, dayCount] = await Promise.all([kv.incr(minuteKey), kv.incr(dayKey)])
    if (minuteCount === 1) { try { await kv.expire(minuteKey, 70) } catch {} }
    if (dayCount === 1)    { try { await kv.expire(dayKey, 26 * 3600) } catch {} }
    return minuteCount <= MINUTE_CAP && dayCount <= DAILY_CAP
  } catch {
    // Redis down → impossible de compter, mais on ne veut pas non plus
    // couper tout le fallback pour cette seule raison → on laisse passer.
    return true
  }
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

  // ── 2. Budget interne — voir reserveQuota() ci-dessus ─────────────────────────
  // Réponse dans la MÊME forme qu'une erreur api-football réelle (`errors`
  // non-vide, HTTP 200) : le code client (afetch() dans useApiFootball.js)
  // détecte déjà ce champ et bascule en état d'erreur proprement, donc aucune
  // duplication de logique de gestion d'erreur nécessaire côté front.
  const allowed = await reserveQuota()
  if (!allowed) {
    res.status(200).setHeader('Content-Type', 'application/json')
    res.setHeader('x-cache', 'QUOTA')
    return res.json({ errors: { quota: 'Budget interne api-football atteint, réessaie plus tard' }, response: [] })
  }

  // ── 3. Fetch api-football ────────────────────────────────────────────────────
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
