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
// ⚠️ REVU À LA BAISSE (demande explicite utilisateur suite à une VRAIE
// suspension de compte FD.org le 20/07, malgré ce garde-fou déjà en place à
// 7/min) : 7/min laissait passer les 7 appels en RAFALE dès le début de
// chaque minute (le verrou d'espacement de 800ms n'empêchait qu'un
// chevauchement de 2 appels simultanés, pas un profil "7 d'un coup puis plus
// rien pendant 55s") — un profil de trafic en pics, plus proche d'un usage
// automatisé/abusif aux yeux d'un système anti-abus qu'un usage humain
// régulier, même largement sous les 10/min réels. 5/min (50% de marge sous
// la vraie limite, au lieu de 30%) + espacement STRICTEMENT régulier sur
// toute la minute (voir SPACING_MS plus bas, dérivé de ce plafond) : profil
// de trafic lissé, jamais de rafale possible par construction — beaucoup
// plus proche d'un usage humain normal.
// ⚠️ REMONTÉ à 8/min de nouveau (23/07, 3e changement de la journée — demande
// explicite utilisateur après analyse détaillée). Contexte complet : le
// rollback à 5/min (quelques heures plus tôt) n'a RIEN changé — les 403
// continuaient à l'identique. Analyse d'un 2e screenshot Network (fenêtre de
// capture ~30s) : seuls 3 vrais appels FD.org avaient atteint le serveur sur
// cette fenêtre, cohérent avec l'espacement de 12s à 5/min — l'espacement
// fonctionnait donc correctement, ce n'était pas une rafale non maîtrisée
// côté serveur. Conclusion la plus probable : le compte est actuellement
// bloqué par FD.org AU NIVEAU COMPTE, indépendamment de notre débit — même
// des appels bien espacés (1/12s, très en dessous des 10/min officiels)
// recevaient un vrai 403. Remonter ou redescendre le plafond ne change donc
// rien à un blocage déjà actif. L'utilisateur privilégie une théorie
// différente (rafale au lancement desktop) — non confirmée par le code
// (fetchTodayMatches lance bien 3 appels FD.org simultanés par jour, mais le
// verrou d'espacement Redis les sérialise déjà à 1 réel/12s peu importe
// combien sont "en attente" côté client, donc FD.org ne voit jamais plus
// qu'1 appel/12s sur le fil, qu'il y en ait 3 ou 30 en file d'attente).
// Espacement (7,5s) toujours dérivé automatiquement du plafond, aucune
// rafale possible par construction, quel que soit MINUTE_CAP.
const MINUTE_CAP = 8
const STALE_TTL  = 24 * 3600  // copie de secours longue durée, servie si budget épuisé ou 429 réel
const DOWN_TTL   = 70  // un peu plus d'1min : si FD.org renvoie un vrai 429, on arrête d'insister le temps que sa propre fenêtre se réinitialise
// ⚠️ AJOUT (incident réel du 20/07 : rafale de 403 Forbidden sur TOUS les
// endpoints FD.org, des dizaines d'affilée) : le circuit breaker ci-dessous
// ne se déclenchait QUE sur 429 — un 403 (souvent un blocage anti-abus plus
// dur/plus long qu'un simple "ralentis", contrairement au 429 qui dit juste
// "réessaie dans ta fenêtre") passait tel quel SANS jamais couper les
// tentatives suivantes. Résultat concret : chaque nouvelle clé de cache
// (jamais vue avant) retentait quand même un appel réel vers FD.org, qui
// répondait encore 403 — la rafale continuait de plus belle au lieu de
// s'arrêter, aggravant potentiellement un blocage déjà en cours plutôt que
// de laisser sa fenêtre se réinitialiser. DOWN_TTL plus long pour un 403
// (5min vs ~1min pour un 429) : un signal qu'on préfère traiter avec plus de
// prudence, quitte à servir une copie stale un peu plus longtemps.
const DOWN_TTL_FORBIDDEN = 300
// ⚠️ REVU (même incident que MINUTE_CAP ci-dessus) : passé de 800ms fixe (ne
// faisait qu'empêcher 2 appels simultanés, laissait les 5-7 autorisés
// s'entasser en rafale en quelques secondes) à un espacement STRICT et
// régulier dérivé du plafond — 60s / MINUTE_CAP (7,5s à 8/min, calculé
// automatiquement, pas une valeur en dur) entre 2 appels réels vers FD.org,
// peu importe combien de requêtes différentes arrivent en même
// temps côté app. Garantit PAR CONSTRUCTION un profil de trafic lissé sur
// toute la minute (jamais de pic), et rend physiquement impossible de
// dépasser MINUTE_CAP même en cas de bug ailleurs — la seule protection qui
// ne dépend d'aucun autre code pour être fiable.
const SPACING_MS = Math.floor(60_000 / MINUTE_CAP)

// ⚠️ CORRIGÉ (auto-relecture après coup — même faille qu'api-football avant
// son propre correctif SPACING_MS) : un compteur par MINUTE CALENDAIRE fixe
// ("2026-07-10T03:47") n'empêche pas une rafale à la frontière entre 2
// fenêtres — ex: 7 appels à 03:47:59 (comptés dans la fenêtre :47) suivis de
// 7 autres à 03:48:00 (comptés dans la fenêtre :48) = 14 appels réels en à
// peine 1 seconde, largement au-dessus des 10/min réels de FD.org, alors que
// chaque compteur pris séparément semblait pourtant "sous le budget". C'est
// exactement le trou déjà découvert sur api-football (voir son commentaire
// SPACING_MS) — je l'avais reproduit ici sans y penser au premier passage.
// Le verrou d'espacement (SET NX PX) ci-dessous lisse mécaniquement ce cas,
// peu importe le nombre de requêtes qui arrivent au même instant.
async function reserveQuota(redis) {
  if (!redis) return true  // Redis down → impossible de compter, on laisse passer plutôt que tout bloquer
  try {
    const now       = new Date()
    const minuteKey = `fd:quota:${now.toISOString().slice(0, 16)}`
    const spaceKey  = 'fd:quota:spacing'
    const [count, spacingOk] = await Promise.all([
      redis.incr(minuteKey),
      redis.set(spaceKey, '1', { nx: true, px: SPACING_MS }),
    ])
    if (count === 1) { try { await redis.expire(minuteKey, 70) } catch {} }
    return count <= MINUTE_CAP && !!spacingOk
  } catch { return true }
}

function getTtl(fdPath, qs) {
  if (qs.includes('status=IN_PLAY') || qs.includes('status=PAUSED')) return 0
  if (/^\/v4\/matches\/\d+$/.test(fdPath) && !qs) return 3600         // détail FT — 1h
  if (fdPath.includes('/head2head'))             return 3600           // H2H stable — 1h
  if (qs.includes('status=FINISHED'))              return 120           // résultats — 2min
  if (fdPath.includes('/standings'))               return 120           // classements — 2min
  if (fdPath.includes('/scorers'))                 return 120           // buteurs — 2min
  // ⚠️ AJOUT (24/07, question utilisateur directe : "ça va pas bouger dans
  // Résultats récents, pourquoi pas le garder en cache 7 jours ?" — repéré
  // en creusant la rafale de 429 au lancement de l'Accueil). Un jour
  // ENTIÈREMENT passé (dateTo < aujourd'hui, UTC) ne contient plus que des
  // matchs FINISHED, immuables — 120s (2min) comme "aujourd'hui" (qui peut
  // avoir un match en cours) n'a aucune raison d'être ici. Repris à 7 jours,
  // aligné sur RESULTS_DAYS_BACK (Accueil.jsx, panneau "Résultats récents") :
  // au-delà du tout premier appel jamais fait pour cette date précise, PLUS
  // AUCUN appel réel FD.org nécessaire — ni pour ce client (localStorage,
  // voir useTodayMatches.js), ni pour aucun autre utilisateur (ce cache
  // Redis est partagé). dateTo >= aujourd'hui garde 120s (peut contenir un
  // match pas encore FINISHED, doit rester frais).
  if (qs.includes('dateFrom=') && qs.includes('dateTo=')) {
    const dateToMatch = qs.match(/dateTo=(\d{4}-\d{2}-\d{2})/)
    const todayUtc = new Date().toISOString().slice(0, 10)
    if (dateToMatch && dateToMatch[1] < todayUtc) return 7 * 24 * 3600   // jour passé — 7j
    return 120                                                          // matchs du jour — 2min
  }
  if (qs.includes('status=SCHEDULED') || qs.includes('status=TIMED')) return 300 // calendrier — 5min
  // ⚠️ TROU TROUVÉ (24/07, suite au constat utilisateur "veuillez patienter"
  // récurrent sur Ligue 1 juste après la fusion Programme+Résultats) :
  // l'URL fusionnée (competitions/X/matches?season=Y OU sans aucun param) n'a
  // PLUS de status= du tout — c'est justement le but de la fusion (tous les
  // statuts en un seul appel) — donc elle ratait TOUS les cas ci-dessus et
  // retombait dans le défaut générique 120s (2min) au lieu des 300s (5min)
  // que `status=SCHEDULED` avait avant la fusion. Un calendrier de matchs
  // change rarement d'une minute à l'autre — ce TTL 2.5x trop court faisait
  // expirer le cache Redis bien avant le prochain passage du préchauffage
  // Cloudflare Worker (un cycle complet ~36min pour 18 URLs), donc la
  // fenêtre où un vrai appel FD.org était nécessaire (au lieu d'un cache HIT
  // instantané) était bien plus large que prévu — exactement le genre
  // d'appel supplémentaire qui épuise plus vite le budget/minute partagé et
  // déclenche "Veuillez patienter" pour des utilisateurs qui, avant la
  // fusion, n'auraient tapé qu'un cache encore valide.
  if (/^\/v4\/competitions\/[A-Z0-9]+\/matches$/.test(fdPath) && !qs.includes('status=')) return 300
  return 120  // défaut — 2min
}

// ⚠️ SIMPLIFIÉ (24/07, capture Network utilisateur : les requêtes
// /api/football revenaient en 304, servies depuis le cache HTTP du
// NAVIGATEUR, pendant que Programme affichait "aucun match" sans la moindre
// erreur console — donc un fetch "réussi" (200 effectif, transparent pour le
// JS) mais avec un corps qu'on ne peut plus garantir à jour). On a déjà 2
// couches de cache qu'on contrôle et qu'on a durcies pendant des semaines :
// Redis PARTAGÉ côté serveur (la vraie protection anti-429/anti-suspension
// FD.org, commune à tous les utilisateurs) et localStorage côté client
// (résilience hors-ligne, voir readCacheStale). Laisser EN PLUS le
// navigateur gérer sa propre 3e couche de cache HTTP (ETag/304) n'apporte
// aucun bénéfice supplémentaire — le vrai gain anti-429 vient du Redis
// partagé, pas du cache d'un navigateur individuel — et c'est une source de
// bugs qu'on ne peut ni observer ni déboguer depuis ce serveur. no-store
// partout : chaque appel client repasse par notre proxy, qui lui-même sert
// depuis Redis en quelques ms dans l'immense majorité des cas (cache HIT).
function getCacheControl() {
  return 'no-store'
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

    // ⚠️ AJOUT (audit sécurité demandé par l'utilisateur) : ce endpoint est
    // PUBLIC et SANS AUTH (contrairement à cron-goals/debug-push/apifootball,
    // protégés par CRON_SECRET) — son URL est visible par n'importe qui dans
    // l'onglet Network du navigateur. Jusqu'ici, seule protection : le budget
    // GLOBAL (MINUTE_CAP, partagé entre TOUS les appelants confondus) — aucune
    // limite PAR appelant, contrairement à tous les autres proxies de l'app
    // (api/espn.js, api/fifa-live.js, api/fifa-lineups.js, api/vapid-key.js,
    // api/subscribe.js, api/pulse.js, qui limitent tous par IP). N'importe qui
    // pouvait donc appeler cette URL directement (curl/bot, sans même passer
    // par l'app) et consommer à lui seul tout le quota football-data.org de
    // l'app — avec sa propre clé API. Vu l'historique de suspensions à
    // répétition du compte FD.org, jamais totalement élucidé malgré plusieurs
    // changements de clé, c'est une piste sérieuse et corrigée ici, même
    // pattern (compteur Redis par IP, fenêtre glissante 60s) que les autres
    // endpoints déjà protégés.
    if (redis) {
      const ip    = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
      const rlKey = `ratelimit:football:${ip}`
      try {
        const count = await redis.incr(rlKey)
        if (count === 1) await redis.expire(rlKey, 60)
        if (count > 30) return res.status(429).json({ error: 'Trop de requêtes' })
      } catch {}
    }

    // ── Tentative de lecture depuis Redis ────────────────────────────────────
    if (ttl > 0 && redis) {
      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          return res
            .status(200)
            .setHeader('Content-Type', 'application/json')
            .setHeader('Cache-Control', getCacheControl())
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
        // ⚠️ CORRIGÉ (trou réel trouvé après une nouvelle suspension FD.org
        // malgré MINUTE_CAP=5 déjà en place) : l'ancien code, faute de copie
        // stale disponible pour une clé jamais vue (nouvelle compétition,
        // nouvel endpoint — ex: le mini-classement ajouté sur l'Accueil,
        // chaque championnat cliqué = une clé JAMAIS mise en cache la 1ère
        // fois), CONTOURNAIT silencieusement tout le garde-fou et faisait
        // quand même l'appel réel ("faute de mieux") — MINUTE_CAP n'était
        // donc un plafond dur QUE pour les clés déjà vues au moins une fois,
        // jamais pour une requête inédite. On bloque maintenant vraiment :
        // mieux vaut un message "réessaie dans un instant" (déjà géré
        // partout côté client, voir fetchErrors.js RATE_LIMITED_MESSAGE)
        // qu'un risque réel de nouvelle suspension de compte.
        return res
          .status(429)
          .setHeader('Retry-After', '15')
          .json({ error: 'Budget football-data.org temporairement épuisé' })
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
    } else if ((response.status === 429 || response.status === 403) && redis) {
      // Vrai 429 (malgré notre propre budget) OU 403 (blocage anti-abus,
      // voir commentaire sur DOWN_TTL_FORBIDDEN plus haut) → circuit breaker :
      // on arrête d'insister pendant un moment plutôt que d'aggraver un
      // blocage en cours avec de nouvelles tentatives.
      const downTtl = response.status === 403 ? DOWN_TTL_FORBIDDEN : DOWN_TTL
      try { await redis.set(downKey, '1', { ex: downTtl }) } catch {}
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

    // ⚠️ CORRIGÉ (23/07, trouvé en analysant un screenshot Network utilisateur :
    // des 403 identiques revenaient en 2-3ms "(disk cache)" juste après un vrai
    // 403 à ~650ms) : cette réponse finale utilisait getCacheControl(ttl) SANS
    // regarder response.status — un vrai 403/429 upstream héritait donc du
    // même Cache-Control public/s-maxage que les réponses 200 (jusqu'à 5min
    // selon l'endpoint), et le NAVIGATEUR le mettait en cache disque tel quel.
    // Résultat : une seule vraie erreur FD.org pouvait ensuite se "rejouer"
    // plusieurs fois depuis le disque, sans le moindre appel réseau réel — ça
    // ressemble à du spam côté onglet Network alors qu'aucune nouvelle
    // requête n'atteint même notre serveur, encore moins FD.org. no-store
    // sur tout ce qui n'est pas 2xx : chaque nouvelle tentative repasse
    // vraiment par le garde-fou serveur (Redis) au lieu d'un mirage local.
    res
      .status(response.status)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', getCacheControl())
      .setHeader('X-Cache', 'MISS')
      .send(body)

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
