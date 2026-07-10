// Proxy football-data.org avec cache Redis (Upstash)
//
// Stratégie : check Redis d'abord → si hit, réponse instantanée (0 appel FD.org)
//             Si miss → fetch FD.org → stocke en Redis → répond au client
//
// TTL Redis par type d'endpoint :
//   IN_PLAY/PAUSED    → pas de cache (ESPN gère le live)
//   Résultats FINISHED → 2 min  (était 5min — buteurs/classement doivent suivre les matchs qui viennent de finir)
//   Classements        → 2 min  (était 10min)
//   Buteurs            → 2 min  (était 30min)
//   Matchs du jour     → 2 min
//   SCHEDULED/TIMED    → 5 min
//   Détail match (FT)  → 1 h
//   Autres             → 2 min
//
// ⚠️ Ce cache est PARTAGÉ (Redis, côté serveur) entre TOUS les utilisateurs pour
// une même requête — le réduire à 2min ne multiplie donc pas les appels à
// football-data.org par le nombre d'utilisateurs. Marge de sécurité calculée pour
// rester sous le quota free tier (10 req/min) : en pratique seule la CM (WC) a du
// trafic significatif actuellement (les ligues club sont en intersaison), soit
// 3 endpoints (buteurs/classement/résultats) × 1 requête / 2min max = largement
// sous la limite. Si beaucoup de compétitions club redeviennent actives en même
// temps (rentrée août), surveiller les 429 via /api/debug-push et remonter ce TTL
// si besoin plutôt que de descendre encore plus bas.

import { Redis } from '@upstash/redis'

let kv = null
function getKv() {
  if (!kv && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  }
  return kv
}

// ── Budget global anti-429 (constat utilisateur : "on se prend un méchant
// tunnel à attendre" — le vrai problème n'était PAS le cache Redis par clé
// ci-dessus (qui protège bien les requêtes RÉPÉTÉES identiques), mais
// l'absence de garde-fou GLOBAL, tous utilisateurs confondus, sur le nombre
// de vrais appels upstream/minute — exactement le même trou que celui déjà
// corrigé pour api-football (voir reserveQuota() dans api/apifootball.js,
// même principe repris ici). Le "tunnel" lui-même venait du client
// (fdFetch.js, waitForSlot() bloquant en synchrone jusqu'à 60s) — traité
// séparément côté client, ce budget ici est le vrai garde-fou serveur.
const MINUTE_CAP = 7   // sur 10/min réels — marge de sécurité, même logique qu'api-football
const STALE_TTL  = 24 * 3600  // copie de secours longue durée, servie si budget épuisé ou 429 réel
const DOWN_TTL   = 70  // un peu plus d'1min : si FD.org renvoie un vrai 429, on arrête d'insister le temps que sa propre fenêtre se réinitialise

async function reserveQuota(redis) {
  if (!redis) return true  // Redis down → impossible de compter, on laisse passer plutôt que tout bloquer
  try {
    const now       = new Date()
    const minuteKey = `fd:quota:${now.toISOString().slice(0, 16)}`
    const count     = await redis.incr(minuteKey)
    if (count === 1) { try { await redis.expire(minuteKey, 70) } catch {} }
    return count <= MINUTE_CAP
  } catch { return true }
}

function getTtl(fdPath, qs) {
  if (qs.includes('status=IN_PLAY') || qs.includes('status=PAUSED')) return 0
  if (/^\/v4\/matches\/\d+$/.test(fdPath) && !qs) return 3600         // détail FT — 1h
  if (fdPath.includes('/head2head'))             return 3600           // H2H stable — 1h
  if (qs.includes('status=FINISHED'))              return 120           // résultats — 2min
  if (fdPath.includes('/standings'))               return 120           // classements — 2min
  if (fdPath.includes('/scorers'))                 return 120           // buteurs — 2min
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
    const staleKey = `fd:stale:${fdPath}${qs ? '?' + qs : ''}`
    const downKey  = 'fd:down'
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

    // ── Garde-fous avant d'attaquer FD.org : budget/minute + circuit breaker ──
    // Constat utilisateur : "on se prend un méchant tunnel à attendre parce
    // qu'on a déjà fait trop de requêtes en 1min". Le cache Redis ci-dessus
    // protège les requêtes RÉPÉTÉES (même clé), mais rien ne protégeait le
    // total de VRAIS appels upstream/minute tous utilisateurs confondus — si
    // beaucoup de clés différentes expirent en même temps, on pouvait quand
    // même dépasser les 10/min réels de FD.org. Si le budget est épuisé OU
    // qu'un vrai 429 a été vu récemment (circuit breaker), on sert la copie
    // "stale" (dernière bonne réponse connue, jusqu'à 24h) plutôt que
    // d'attendre/échouer — un score vieux de quelques minutes reste bien
    // plus utile qu'une erreur ou une attente bloquante.
    if (redis) {
      let blocked = false
      try { blocked = !!(await redis.get(downKey)) } catch {}
      if (!blocked) blocked = !(await reserveQuota(redis))
      if (blocked) {
        try {
          const stale = await redis.get(staleKey)
          if (stale) {
            return res
              .status(200)
              .setHeader('Content-Type', 'application/json')
              .setHeader('Cache-Control', 'no-store')
              .setHeader('X-Cache', 'STALE')
              .send(typeof stale === 'string' ? stale : JSON.stringify(stale))
          }
        } catch {}
        // Pas de copie de secours disponible (1re requête pour cette clé) →
        // on tente quand même l'appel réel, faute de mieux.
      }
    }

    // ── Fetch football-data.org ──────────────────────────────────────────────
    const url = `https://api.football-data.org${fdPath}${qs ? '?' + qs : ''}`
    const response = await fetch(url, {
      headers: { 'X-Auth-Token': process.env.API_KEY ?? process.env.FOOTBALL_DATA_API_KEY ?? '' },
      signal: AbortSignal.timeout(8_000),
    })

    const body = await response.text()

    // ── Mise en cache Redis si réponse OK ────────────────────────────────────
    if (redis && response.ok) {
      try {
        if (ttl > 0) await redis.set(cacheKey, body, { ex: ttl })
        await redis.set(staleKey, body, { ex: STALE_TTL })
      } catch { /* silently ignore — pas critique */ }
    } else if (response.status === 429 && redis) {
      // Vrai 429 malgré notre propre budget (autre source de trafic partageant
      // le quota, marge insuffisante...) → circuit breaker : on arrête
      // d'insister pendant DOWN_TTL plutôt que d'aggraver un blocage en cours.
      try { await redis.set(downKey, '1', { ex: DOWN_TTL }) } catch {}
      try {
        const stale = await redis.get(staleKey)
        if (stale) {
          return res
            .status(200)
            .setHeader('Content-Type', 'application/json')
            .setHeader('Cache-Control', 'no-store')
            .setHeader('X-Cache', 'STALE')
            .send(typeof stale === 'string' ? stale : JSON.stringify(stale))
        }
      } catch {}
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
