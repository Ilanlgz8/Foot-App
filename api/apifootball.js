// Proxy api-football.com — clé APIFOOTBALL_KEY côté serveur uniquement
// Cache Redis par endpoint pour éviter de consommer le quota (100 req/jour)
// (redeploy forcé — vérif nouvelle clé, tentative 2)
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
// simples 429.
//
// ⚠️ MISE À JOUR après un 8e blocage malgré ce budget (constat utilisateur) :
// un compteur "≤7 par fenêtre de 60s" est une MOYENNE glissante — il n'empêche
// PAS que ces 7 appels arrivent tous regroupés en 1-2 secondes (ex: plusieurs
// utilisateurs différents ouvrent chacun un match différent au même moment,
// juste avant un coup d'envoi — chaque ouverture peut déclencher jusqu'à 4
// appels réels dans resolveFixtureInfo() côté client). Si l'anti-abus
// d'api-football réagit à une RAFALE (beaucoup de requêtes dans la même
// seconde) plutôt qu'à la seule moyenne/minute — ce qui n'est pas documenté
// publiquement par api-football, donc hypothèse la plus probable au vu des
// faits (blocages répétés malgré un compteur qui semblait correct), pas une
// certitude — un budget par minute seul ne protège pas contre ça.
// Ajout d'un verrou d'espacement minimum (SET NX PX) entre deux appels réels
// upstream : jamais plus d'1 appel toutes les SPACING_MS, quel que soit le
// nombre de requêtes qui arrivent en même temps. Lisse mécaniquement toute
// rafale, en plus du budget par minute/jour (abaissé aussi par prudence).
const MINUTE_CAP  = 4    // sur 10/min réels — abaissé (7 n'a pas suffi)
const DAILY_CAP    = 60  // sur 100/jour réels — abaissé (80 n'a pas suffi)
const SPACING_MS   = 600 // espacement minimum entre 2 appels upstream réels

async function reserveQuota() {
  const now       = new Date()
  const minuteKey = `aflcache:quota:min:${now.toISOString().slice(0, 16)}`
  const dayKey    = `aflcache:quota:day:${now.toISOString().slice(0, 10)}`
  const spaceKey  = 'aflcache:quota:spacing'
  try {
    const [minuteCount, dayCount, spacingOk] = await Promise.all([
      kv.incr(minuteKey),
      kv.incr(dayKey),
      kv.set(spaceKey, '1', { nx: true, px: SPACING_MS }),
    ])
    if (minuteCount === 1) { try { await kv.expire(minuteKey, 70) } catch {} }
    if (dayCount === 1)    { try { await kv.expire(dayKey, 26 * 3600) } catch {} }
    return minuteCount <= MINUTE_CAP && dayCount <= DAILY_CAP && !!spacingOk
  } catch {
    // Redis down → impossible de compter, mais on ne veut pas non plus
    // couper tout le fallback pour cette seule raison → on laisse passer.
    return true
  }
}

// Persiste le quota RÉEL restant (renvoyé par api-football dans les headers
// de chaque réponse) pour pouvoir diagnostiquer après coup sans deviner —
// avant ce fix, cette info existait déjà dans la réponse HTTP mais n'était
// jamais gardée nulle part, donc impossible de savoir a posteriori à quel
// point on était proche d'un blocage.
async function trackRealRemaining(remaining) {
  if (remaining == null) return
  try {
    await kv.set('aflcache:last_remaining', JSON.stringify({ remaining: Number(remaining), at: Date.now() }), { ex: 24 * 3600 })
  } catch {}
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  // ── Diagnostic ponctuel — vérifie QUELLE clé est réellement chargée en
  // production, sans jamais exposer la clé complète. Protégé par CRON_SECRET
  // (même convention que debug-push.js). Utile pour confirmer/infirmer qu'une
  // nouvelle valeur Vercel est bien celle utilisée par la fonction, sans coller
  // la clé en clair dans une conversation.
  if (req.query.debugkey !== undefined) {
    const secret = req.headers['x-cron-secret'] ?? req.query.secret ?? ''
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Non autorisé' })
    }
    const key = process.env.APIFOOTBALL_KEY ?? ''
    let lastRemaining = null
    try {
      const raw = await kv.get('aflcache:last_remaining')
      lastRemaining = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
    } catch {}
    return res.status(200).json({
      present: !!key,
      length:  key.length,
      preview: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null,
      // Dernier quota RÉEL restant (header api-football), pour diagnostiquer
      // après coup à quel point on était proche d'un blocage sans deviner.
      lastRemaining,
    })
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
    await trackRealRemaining(remaining)

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
