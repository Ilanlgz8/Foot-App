// Proxy api-football.com — clé APIFOOTBALL_KEY côté serveur uniquement
// Cache Redis par endpoint pour éviter de consommer le quota (100 req/jour)
// (redeploy forcé — vérif nouvelle clé, tentative 2)
import { Redis } from '@upstash/redis'
import crypto from 'node:crypto'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// Même helper que api/debug-push.js et api/cron-goals.js (audit sécurité) —
// évite une comparaison de secret vulnérable au timing attack. Ce fichier est
// coupé par PERMANENTLY_DISABLED avant d'atteindre ce code (risque nul tant
// que c'est le cas), mais reste cohérent avec le reste du code si réactivé un jour.
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

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

// ── Assistant IA foot (28/08, remplace le Simulateur — demande utilisateur :
// "les scores sont pas convaincants... si on remplace ça par une ia
// integrer qui repond au question de n'importe quelle personne", scopé à
// "foot uniquement" après clarification) — fusionné ICI (Vercel 12/12
// fonctions, aucun slot libre, voir CLAUDE.md) : ce fichier est déjà mort en
// pratique (PERMANENTLY_DISABLED ci-dessus, api-football coupé pour de bon
// après 8 suspensions) — le slot est réutilisé sans jamais toucher le
// comportement existant des 5 appelants encore en place (useApiFootball.js
// et consorts, qui reçoivent toujours exactement la même réponse "disabled"
// qu'avant) : ce bloc s'exécute AVANT le court-circuit PERMANENTLY_DISABLED,
// mais uniquement sur un contrat totalement différent (POST + body.mode ===
// 'ask'), jamais sur leurs appels GET habituels (_ep=...).
//
// Modèle : Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct) — même
// compte Cloudflare que cf-worker/ (déjà utilisé pour le cron ESPN), aucun
// nouveau fournisseur à créer. Gratuit jusqu'à 10 000 "neurones"/jour
// (≈15-25 réponses selon leur longueur, reset 00:00 UTC), source :
// developers.cloudflare.com/workers-ai (vérifié 28/08). Volontairement AUCUN
// fallback payant au-delà de ce quota gratuit — cohérent avec le reste de
// l'app (100% APIs gratuites jusqu'ici, jamais un coût engagé sans validation
// explicite) : une fois les plafonds ci-dessous atteints, message d'erreur
// clair côté client plutôt qu'un vrai appel facturé.
//
// ⚠️ Honnêteté sur les limites (à faire savoir à l'utilisateur, pas juste ici
// en commentaire) : ce modèle N'A PAS accès aux données live/temps réel de
// l'app (scores en cours, calendrier...) — connaissance générale sur le foot
// uniquement (règles, historique, clubs, joueurs, tactique...), d'où la
// consigne explicite dans le system prompt de ne jamais inventer un score
// et de renvoyer vers les pages Live/Résultats de l'app pour ça.
const AI_DAILY_GLOBAL_CAP = 15   // ~ quota Workers AI gratuit (10k neurones/j), prudent
const AI_DAILY_IP_CAP     = 3    // évite qu'un seul visiteur épuise le quota partagé
const AI_MAX_QUESTION_LEN = 300  // limite la taille du prompt (coût + abus)

const FOOT_SYSTEM_PROMPT = [
  "Tu es l'assistant football de l'app StatFootix.",
  'Tu réponds UNIQUEMENT à des questions sur le football : règles, clubs, joueurs, compétitions, histoire, statistiques générales, tactique.',
  "Si la question ne concerne pas le football, réponds poliment que tu ne réponds qu'aux questions de football, sans y répondre.",
  "Tu n'as PAS accès aux scores ou données en direct de StatFootix (pas de flux temps réel) : n'invente JAMAIS un score, un classement ou un résultat récent — dis à l'utilisateur de consulter les pages Live/Résultats/Classement de l'app pour ça.",
  'Réponds toujours en français, de façon concise (quelques phrases, pas un essai).',
].join(' ')

async function handleAsk(req, res) {
  const question = String(req.body?.question ?? '').trim()
  if (!question) return res.status(400).json({ error: 'Question vide' })
  if (question.length > AI_MAX_QUESTION_LEN) {
    return res.status(400).json({ error: `Question trop longue (max ${AI_MAX_QUESTION_LEN} caractères)` })
  }

  const ip    = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const today = new Date().toISOString().slice(0, 10)
  try {
    const [globalCount, ipCount] = await Promise.all([
      kv.incr(`ai:ask:day:${today}`),
      kv.incr(`ai:ask:day:${today}:${ip}`),
    ])
    if (globalCount === 1) { try { await kv.expire(`ai:ask:day:${today}`, 26 * 3600) } catch {} }
    if (ipCount === 1)     { try { await kv.expire(`ai:ask:day:${today}:${ip}`, 26 * 3600) } catch {} }
    if (globalCount > AI_DAILY_GLOBAL_CAP) {
      return res.status(429).json({ error: 'Quota IA gratuit du jour atteint, réessaie demain' })
    }
    if (ipCount > AI_DAILY_IP_CAP) {
      return res.status(429).json({ error: 'Limite quotidienne atteinte pour cet appareil, réessaie demain' })
    }
  } catch {
    // Redis down → best-effort, on laisse passer plutôt que de bloquer toute
    // la fonctionnalité pour un souci de comptage (même logique que
    // reserveQuota() plus bas dans ce fichier).
  }

  const accountId = process.env.CF_ACCOUNT_ID
  const apiToken  = process.env.CF_AI_API_TOKEN
  if (!accountId || !apiToken) {
    return res.status(500).json({ error: "Assistant IA pas encore configuré côté serveur" })
  }

  try {
    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: FOOT_SYSTEM_PROMPT },
            { role: 'user', content: question },
          ],
          max_tokens: 400,
        }),
        signal: AbortSignal.timeout(15000),
      }
    )
    const json = await cfRes.json().catch(() => null)
    if (!cfRes.ok || !json?.success) {
      return res.status(502).json({ error: "L'assistant IA n'a pas pu répondre, réessaie" })
    }
    const answer = json.result?.response?.trim()
    if (!answer) return res.status(502).json({ error: "Réponse vide de l'assistant" })
    return res.status(200).json({ answer })
  } catch {
    return res.status(500).json({ error: 'Erreur assistant IA, réessaie' })
  }
}

export default async function handler(req, res) {
  // Même parsing défensif que cron-goals.js (mode POST) : req.body arrive en
  // string si le client n'a pas posé Content-Type: application/json.
  let body = null
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch { body = null }
  }
  if (body?.mode === 'ask') {
    req.body = body
    return handleAsk(req, res)
  }

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
    if (!process.env.CRON_SECRET || !safeCompare(secret, process.env.CRON_SECRET)) {
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
