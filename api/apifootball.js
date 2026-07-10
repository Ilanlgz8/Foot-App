// Proxy api-football.com — clé APIFOOTBALL_KEY côté serveur uniquement
// Cache Redis par endpoint pour éviter de consommer le quota (100 req/jour)
// (redeploy forcé — vérif nouvelle clé, tentative 2)
import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// TTL cache Redis selon le type d'endpoint
// ⚠️ BUG CORRIGÉ (constat utilisateur : "les stats live ont l'air figées,
// surtout après un passage en arrière-plan") : 'statistics' était caché 2h.
// Pour un match EN COURS, ce cache Redis est PARTAGÉ entre tous les
// utilisateurs — dès qu'UN SEUL client déclenche le 1er fetch (souvent tôt
// dans le match, quand ESPN/FIFA n'ont pas encore de données et que le
// fallback api-football prend le relais), la possession/tirs/corners
// restaient figés à cette valeur pour TOUT LE MONDE pendant les 2 HEURES
// suivantes — largement plus long qu'un match complet. Ramené à 60s, cohérent
// avec le cache stats FIFA (120s, voir api/fifa-lineups.js) : toujours un
// vrai cache (protège le quota api-football, cf. les suspensions de compte
// déjà rencontrées), mais qui laisse les stats réellement évoluer en direct.
function cacheTTL(endpoint) {
  if (endpoint.includes('lineups'))    return 7  * 24 * 3600  // 7 jours — lineups ne changent pas
  if (endpoint.includes('statistics')) return 60               // 1min — stats live (était 2h, bug)
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

// ── Circuit breaker anti-gaspillage (constat utilisateur : 8e blocage du
// compte api-football malgré MINUTE_CAP/DAILY_CAP/SPACING_MS déjà très
// prudents) : une fois le compte bloqué/suspendu, TOUS les appels suivants
// échouent de toute façon jusqu'à ce qu'api-football le débloque — les
// retenter quand même ne fait que gaspiller le budget interne (4 req/min)
// ET du CPU Vercel pour un résultat connu d'avance (déjà au plafond gratuit
// "Active CPU" une fois ce mois-ci, voir cron-goals.js). Dès qu'un appel
// upstream échoue clairement (HTTP non-ok OU `errors` non-vide dans le
// corps), on pose ce flag pour couper court aux appels suivants pendant
// DOWN_TTL. Auto-guérison : le flag expire tout seul, un futur appel retente
// alors normalement, sans intervention manuelle.
const DOWN_TTL   = 20 * 60 // 20min — assez long pour épargner du budget, assez court pour retenter vite si débloqué
const DOWN_KEY   = 'aflcache:down'

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

// ── Coupure définitive (demande utilisateur : "mon compte sera suspendu à
// jamais, oublie api-football") ────────────────────────────────────────────
// Après 8 blocages malgré un throttling déjà très strict, plus la peine de
// retenter automatiquement (voir DOWN_TTL plus haut, devenu inutile dans ce
// cas) : chaque appel est coupé ICI, avant même Redis/le budget interne — coût
// réel nul (juste un retour immédiat), et les autres sources déjà branchées
// (ESPN, football-data.org, compos probables) prennent le relais partout où
// api-football était utilisé, exactement comme si le compte n'avait jamais
// existé. Pour réactiver un jour (nouvelle clé, nouveau compte) : repasser à
// `false` suffit, tout le reste du fichier (cache, circuit breaker DOWN_TTL,
// quota) redevient actif tel quel sans rien à réécrire.
const PERMANENTLY_DISABLED = true

export default async function handler(req, res) {
  if (PERMANENTLY_DISABLED) {
    res.status(200).setHeader('Content-Type', 'application/json')
    res.setHeader('x-cache', 'DISABLED')
    return res.json({ errors: { disabled: 'api-football désactivé définitivement côté app' }, response: [] })
  }

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

  const { _ep, forceFresh, ...rest } = req.query
  const endpoint = _ep ?? 'fixtures'

  if (!/^[a-z0-9/_-]+$/i.test(endpoint)) {
    return res.status(400).json({ error: 'Invalid endpoint' })
  }

  const queryStr = new URLSearchParams(rest).toString()

  // ── 1. Cache Redis (avant le rate limit pour économiser quota) ────────────────
  // forceFresh=1 (posé côté client juste après un retour d'arrière-plan, voir
  // window.__liveStatsForceFreshUntil dans useLiveMinute.js) contourne cette
  // lecture pour ne pas renvoyer les mêmes stats live périmées qu'avant la
  // mise en arrière-plan (le TTL 60s seul ne suffit pas si le retour tombe
  // dans la fenêtre). Le paramètre est exclu de rest → n'affecte ni la clé
  // de cache ni les params envoyés à l'API upstream.
  const skipCache = forceFresh === '1' || forceFresh === 'true'
  const cacheKey = `aflcache:${endpoint}:${queryStr}`
  try {
    const cached = skipCache ? null : await kv.get(cacheKey)
    if (cached) {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('x-cache', 'HIT')
      return res.send(typeof cached === 'string' ? cached : JSON.stringify(cached))
    }
  } catch { /* Redis down → continue */ }

  // ── 2. Circuit breaker — voir commentaire DOWN_TTL ci-dessus ──────────────────
  // Vérifié AVANT reserveQuota() : pas la peine de consommer le budget interne
  // pour un appel qu'on sait déjà condamné à échouer.
  try {
    const down = await kv.get(DOWN_KEY)
    if (down) {
      res.status(200).setHeader('Content-Type', 'application/json')
      res.setHeader('x-cache', 'DOWN')
      return res.json({ errors: { down: 'api-football indisponible (bloqué/suspendu), nouvelle tentative automatique plus tard' }, response: [] })
    }
  } catch { /* Redis down → on tente quand même l'appel réel */ }

  // ── 3. Budget interne — voir reserveQuota() ci-dessus ─────────────────────────
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

  // ── 4. Fetch api-football ────────────────────────────────────────────────────
  try {
    const url = `https://v3.football.api-sports.io/${endpoint}${queryStr ? `?${queryStr}` : ''}`
    const response = await fetch(url, {
      headers: { 'x-apisports-key': process.env.APIFOOTBALL_KEY ?? '' },
    })

    const body      = await response.text()
    const remaining = response.headers.get('x-ratelimit-requests-remaining')
    await trackRealRemaining(remaining)

    // Détecter un blocage/suspension même sous HTTP 200 (api-football encode
    // certaines erreurs dans le corps, voir commentaire afetch() côté client)
    // pour armer le circuit breaker ci-dessus dès ce constat, sans attendre
    // un prochain appel qui échouerait à nouveau pour rien.
    let bodyErrors = null
    try {
      const parsed = JSON.parse(body)
      bodyErrors = parsed?.errors
    } catch {}
    const hasBodyErrors = bodyErrors && (Array.isArray(bodyErrors) ? bodyErrors.length > 0 : Object.keys(bodyErrors).length > 0)

    // ── 5. Stocker en cache si succès ─────────────────────────────────────────
    if (response.ok && !hasBodyErrors) {
      const ttl = cacheTTL(endpoint)
      try { await kv.set(cacheKey, body, { ex: ttl }) } catch {}
    } else if (!response.ok || hasBodyErrors) {
      try { await kv.set(DOWN_KEY, '1', { ex: DOWN_TTL }) } catch {}
    }

    res.status(response.status).setHeader('Content-Type', 'application/json')
    res.setHeader('x-cache', 'MISS')
    if (remaining) res.setHeader('x-quota-remaining', remaining)
    res.send(body)
  } catch (err) {
    // Erreur réseau (timeout, DNS...) : pas forcément un blocage compte, mais
    // le comportement sûr par défaut reste d'armer le circuit breaker plutôt
    // que de retenter en boucle sur une source instable.
    try { await kv.set(DOWN_KEY, '1', { ex: DOWN_TTL }) } catch {}
    res.status(500).json({ error: err.message })
  }
}
