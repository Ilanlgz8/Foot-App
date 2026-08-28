// cf-worker/src/index.js
// ── Worker Cloudflare : polling ESPN + détection (KO/but/carton/mi-temps/fin) ──
//
// CONTEXTE : ce Worker remplace la partie "polling toutes les minutes" de
// api/cron-goals.js (Vercel). Avant, cron-job.org appelait api/cron-goals.js
// chaque minute, 24/7/365, et TOUT (fetch ESPN, détection, ET envoi push VAPID
// chiffré par abonné) tournait sur Vercel — ce qui a fait dépasser le plafond
// gratuit "Fluid Active CPU" (4h/mois) dès la Coupe du Monde 2026, alors que
// tous les championnats européens n'avaient pas encore repris.
//
// NOUVELLE RÉPARTITION :
//   - Cloudflare Worker (ICI, gratuit) : Cron Trigger toutes les minutes →
//     fetch ESPN + détection de changement d'état. Coût CPU quasi nul : le
//     fetch réseau n'est PAS compté dans le budget CPU de Cloudflare (contrairement
//     à Vercel), seul le calcul réel (parsing JSON, comparaisons) compte — et
//     ça reste très en dessous des 10ms/exécution du plan gratuit dans l'usage
//     normal de cette app.
//   - Vercel (api/cron-goals.js, mode "notify") : reçoit UNIQUEMENT un appel
//     HTTP quand ce Worker a détecté un vrai événement à notifier (but, carton,
//     KO, mi-temps, fin — rare, quelques fois par match), fait le travail
//     réellement coûteux en CPU (signature VAPID + chiffrement AES-GCM par
//     abonné) UNIQUEMENT à ce moment-là. Le nombre d'appels Vercel passe ainsi
//     d'environ 1440/jour (24/7, qu'il y ait un match ou non) à quelques
//     dizaines par jour de match — le CPU actif Vercel redevient négligeable.
//
// Toute la logique de DÉTECTION ci-dessous est une adaptation directe de
// api/cron-goals.js (même clés Redis, même state machine, même garde-fous —
// voir les commentaires d'origine repris tels quels quand la logique est
// identique). Seule la partie ENVOI PUSH change : au lieu d'appeler
// webpush.sendNotification() directement (impossible ici : la lib `web-push`
// dépend du module `crypto` de Node, absent du runtime Workers), ce fichier
// appelle notifyVercel() qui fait juste UN fetch() POST vers Vercel avec le
// payload déjà prêt à envoyer.
//
// Redis : @upstash/redis est un client 100% basé sur fetch() (API REST
// Upstash) — aucune dépendance Node (TCP natif), documenté compatible
// Cloudflare Workers par Upstash eux-mêmes. Mêmes identifiants que côté
// Vercel (KV_REST_API_URL / KV_REST_API_TOKEN) : c'est LE MÊME Redis, partagé.

import { Redis } from '@upstash/redis'
import { TEAM_NAMES_FR } from '../../src/data/teamNames.js'
import { ESPN_SLUG_BY_COMP_ID, EXTRA_NOTIFY_SLUGS } from '../../src/data/espnSlugs.js'
// ⚠️ Toutes ces fonctions étaient dupliquées ici ET dans api/cron-goals.js —
// risque de divergence si un futur bug est corrigé d'un seul côté. Extraites
// dans src/utils/liveDetection.js (fonctions pures, sans dépendance
// Node/Workers), importées ici ET par Vercel. Voir ce fichier pour le détail
// et liveDetection.test.js pour les tests.
import {
  LIVE_ESPN, FINAL_ESPN, normalizeEspnStatus,
  fuzzyTeamFifa, fifaTeamNamesAll, fifaEffectiveStatus, fifaConfirmsShootoutOver,
  extractEspnScorers, extractEspnCards, generateRecap,
  minuteLabel, dateStr, parseMin, hasUsefulSummaryData,
} from '../../src/utils/liveDetection.js'

// EXTRA_NOTIFY_SLUGS (coupes nationales + NL/CAN/COPA, voir espnSlugs.js) :
// couvertes pour les notifs ici, mais volontairement absentes de
// ESPN_SLUG_BY_COMP_ID (utilisé ailleurs pour le matching FD.org↔ESPN par id
// numérique, pas ce dont ce Worker a besoin — voir commentaire dans
// espnSlugs.js).
const ESPN_SLUGS = [...new Set([...Object.values(ESPN_SLUG_BY_COMP_ID), ...EXTRA_NOTIFY_SLUGS])]
const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const FIFA_LIVE_URL = 'https://api.fifa.com/api/v3/live/football'
// ⚠️ SOLUTION AU BLOCAGE 403 (constat confirmé, 22/08 : ESPN bloque 100% des
// requêtes venant de Cloudflare Workers — testé en direct, la MÊME requête
// depuis Vercel réussit sans problème, header par header identiques via
// ESPN_FETCH_HEADERS ci-dessous, qui n'avait donc rien changé). C'est un
// blocage réseau (IP/plage Cloudflare), pas un problème d'en-têtes — aucun
// en-tête ne peut le contourner depuis ce Worker. api/espn.js (Vercel) sait
// déjà atteindre ESPN sans souci (utilisé par toute l'app côté client) — son
// mode "scoreboard" renvoie le JSON ESPN BRUT, tel quel, SANS transformation
// (voir api/espn.js, mode scoreboard : `res.send(body)`, pas de compaction —
// contrairement au mode "summary" qui compacte pour le client) : donc
// compatible tel quel avec fetchEspnEvents ci-dessous, aucun changement de
// parsing nécessaire. Le calcul/la décision (comparaison scores, détection
// buts/cartons/FT) restent intégralement ici, dans le Worker — seul le SAUT
// RÉSEAU vers ESPN passe désormais par Vercel plutôt que direct, un simple
// relais sans le coût CPU qui avait motivé le passage à Cloudflare (voir
// CLAUDE.md "Fluid Active CPU dépassé") : api/espn.js est un pass-through
// léger (fetch + forward), pas la logique complète de l'ancien cron.
const VERCEL_ESPN_PROXY = 'https://statfootix.vercel.app/api/espn'

// ⚠️ AJOUT (retour utilisateur, log réel : 403 systématique d'ESPN sur TOUS
// les slugs, à chaque vraie passe, depuis plusieurs heures) : ce Worker
// fetchait ESPN sans le moindre en-tête "navigateur" (juste Cache-Control),
// contrairement à api/espn.js et api/fifa-live.js (côté Vercel) qui
// atteignent le MÊME endpoint ESPN sans souci apparent — seule vraie
// différence observée entre les deux : l'origine réseau (IPs partagées
// Cloudflare Workers vs IPs Vercel). Piste la plus probable : ESPN applique
// un filtrage anti-bot qui cible soit l'absence d'en-têtes "navigateur"
// standards, soit les plages IP Cloudflare connues comme largement
// utilisées par des scrapers — la 1ère est corrigeable ici, la 2e ne l'est
// pas par du code. User-Agent + Accept + Accept-Language "réalistes" : sans
// risque (aucun effet si la cause est un blocage IP pur), et directement
// utile si c'est bien l'absence d'en-têtes qui déclenche le filtrage.
// Honnêteté : pas de certitude sur la cause exacte, pas d'accès aux logs
// ESPN — à vérifier après déploiement (le prochain [espn:...] dans le log
// cf-worker doit repasser à un vrai statut 200, sinon la cause est bien un
// blocage IP et il faudra une autre approche, ex. router ce fetch via
// api/espn.js/Vercel au lieu d'ESPN directement).
const ESPN_FETCH_HEADERS = {
  'Cache-Control': 'no-cache',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.espn.com/',
}

function t(name) { return TEAM_NAMES_FR[name] ?? name }

// Lecture protégée d'une valeur Redis censée être du JSON (goalTrack/cardTrack) :
// une entrée corrompue (aléa réseau/Upstash, ancien format, tampering externe)
// ferait planter JSON.parse() — rattrapé plus haut par le try/catch par-match
// (ligne ~246, "ERREUR match ignoré"), mais ça bloquerait alors TOUTES les
// notifs de but/carton pour ce match jusqu'à expiration du TTL (12h). Avec ce
// repli, une valeur corrompue redémarre juste le compteur à 0 pour cette passe
// au lieu de black-lister le match pendant des heures.
function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

// Renvoie { ok, events } — `ok` distingue "ESPN a confirmé 0 événement" (true,
// utilisable pour le cache noMatch plus bas, voir runOnePass) de "on n'a pas
// pu savoir" (false, timeout/erreur réseau/statut HTTP non-ok — surtout ne
// PAS mettre en cache un [] dans ce cas, sinon on figerait un faux "aucun
// match" pour le reste de la journée sur un simple aléa réseau ponctuel).
// ⚠️ Route désormais via VERCEL_ESPN_PROXY (voir commentaire à sa
// déclaration) au lieu d'ESPN en direct — ESPN bloque 100% des requêtes
// Cloudflare Workers (403 confirmé), Vercel non. `?dates=` et le format
// JSON en retour (`{events:[...]}`) sont identiques à un appel ESPN direct
// (mode scoreboard d'api/espn.js = passthrough brut, aucune transformation)
// — aucun changement de parsing nécessaire ici.
async function fetchEspnEvents(slug, date, log) {
  try {
    const r = await fetch(`${VERCEL_ESPN_PROXY}?slug=${slug}&dates=${date}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) { log.push(`[espn:${slug}] status=${r.status}`); return { ok: false, events: [] } }
    const j = await r.json()
    return { ok: true, events: j.events ?? [] }
  } catch (e) {
    log.push(`[espn:${slug}] error=${e.message}`)
    return { ok: false, events: [] }
  }
}

async function fetchFifaLiveMatches(kv, log) {
  try {
    const cached = await kv.get('fifa:live')
    if (cached) {
      const data = typeof cached === 'string' ? JSON.parse(cached) : cached
      return data ?? []
    }
  } catch {}
  try {
    const res = await fetch(FIFA_LIVE_URL, {
      headers: { Accept: 'application/json' },
      signal:  AbortSignal.timeout(8_000),
    })
    if (!res.ok) { log.push(`[fifa:live] http=${res.status}`); return [] }
    const json = await res.json()
    const data = json.Results ?? []
    try { await kv.set('fifa:live', JSON.stringify(data), { ex: 6 }) } catch {}
    return data
  } catch (e) {
    log.push(`[fifa:live] error=${e.message}`)
    return []
  }
}

// ── Capture proactive du summary ESPN (compos + stats + événements) ──────────
// Identique à cacheEspnSummary() dans api/cron-goals.js — pur fetch + Redis,
// aucune dépendance crypto, portable telle quelle. hasUsefulSummaryData :
// importée de src/utils/liveDetection.js (voir en tête de fichier) —
// anciennement dupliquée ici et dans api/cron-goals.js.
const SUMMARY_CACHE_TTL = 7 * 24 * 3600

// ── Confirmation FT accélérée (retour utilisateur : le tick Cron normal met
// jusqu'à 60s à confirmer un FT, trop lent pour la notif "Fin de match") ──
//
// Au lieu d'attendre passivement le prochain Cron Trigger pour la 2e
// vérification (isFinalConfirmed, voir plus bas), on la déclenche
// activement ~18s après la 1ère détection FINAL, dans une tâche de fond
// AWAIT-ée séparément à la fin de runOnePass (pendingFinalRechecks) — donc
// PAS bloquant pour le traitement des autres matchs de la même passe
// (aucun autre match n'attend ces 18s). Cloudflare ne compte pas le temps
// d'attente réseau/I/O dans le budget CPU 10ms du plan gratuit, et le Cron
// Trigger autorise jusqu'à 15min de temps d'exécution horloge murale — 18s
// est très largement dans ce budget.
//
// Réutilise EXACTEMENT la même source de données que le tick normal
// (fetchEspnEvents → scoreboard, PAS le endpoint /summary qui a un
// problème connu de header.competitions parfois absent, voir
// cacheEspnSummary/hasUsefulSummaryData) — comportement identique à un
// "tick anticipé", aucune nouvelle logique de détection introduite.
//
// Sûr par construction même en cas de double confirmation (ce recheck ET
// le tick normal suivant confirment tous les deux, ex. si ce recheck rate
// son fetch) : notifyVercel() est dédupliqué côté Redis (SET NX sur
// push:espn:ft:{eventId}) et le recap vérifie recapAlready avant d'écrire
// — au pire un no-op silencieux, jamais un doublon visible pour l'utilisateur.
const FINAL_RECHECK_DELAY_MS = 18_000
// Durée de vie de finalDoneKey (voir runOnePass, garde-fou en tête de boucle) —
// doit largement dépasser combien de temps ESPN peut continuer à lister un
// match FINAL dans son scoreboard (le reste de la journée + marge).
const FINAL_DONE_TTL = 26 * 3600

async function recheckFinalMatch(env, kv, slug, eventId, expectedScore, homeTeam, awayTeam, rawHomeTeam, rawAwayTeam, scoreStr, log) {
  await new Promise(resolve => setTimeout(resolve, FINAL_RECHECK_DELAY_MS))
  try {
    const today     = dateStr(new Date())
    const yesterday = dateStr(new Date(Date.now() - 86_400_000))
    const [resToday, resYesterday] = await Promise.all([
      fetchEspnEvents(slug, today, log),
      fetchEspnEvents(slug, yesterday, log),
    ])
    const evt = [...resToday.events, ...resYesterday.events].find(e => e.id === eventId)
    if (!evt) {
      log.push(`[final-recheck:${slug}:${eventId}] event introuvable au recheck — le tick normal reprendra le suivi`)
      return
    }
    const comp = evt.competitions?.[0]
    if (!comp) return
    const status = normalizeEspnStatus(comp.status)
    const homeC  = comp.competitors?.find(c => c.homeAway === 'home')
    const awayC  = comp.competitors?.find(c => c.homeAway === 'away')
    if (!homeC || !awayC) return
    const home = parseInt(homeC.score ?? '0', 10) || 0
    const away = parseInt(awayC.score ?? '0', 10) || 0
    const freshScore = `${home}-${away}`

    if (!FINAL_ESPN.has(status) || freshScore !== expectedScore) {
      log.push(`[final-recheck:${slug}:${eventId}] pas confirmé (statut=${status}, score=${freshScore} vs attendu ${expectedScore}) — probable glitch ESPN évité, le tick normal reprendra le suivi normalement`)
      return
    }

    log.push(`[final-recheck:${slug}:${eventId}] FT confirmé en avance (~${FINAL_RECHECK_DELAY_MS / 1000}s au lieu de jusqu'à 60s)`)
    // ⚠️ BUG CORRIGÉ (même investigation que sendToVercel/notifyVercel et le
    // bloc FT de runOnePass, voir leurs commentaires) : finalDoneKey +
    // cron:liveIds étaient touchés AVANT même de savoir si notifyVercel
    // allait réussir — un échec ici fermait le match pour de bon (finalDone)
    // ET le retirait du suivi actif (srem), alors que sa notif "Fin de
    // match" n'était jamais réellement partie. Si c'était le dernier match
    // live du jour, le Worker pouvait ensuite sauter jusqu'à 20-25min de
    // fetchs ESPN avant de s'en rendre compte — exactement le symptôme
    // remonté par l'utilisateur. Désormais : en cas d'échec, on ne touche à
    // RIEN (le match reste tel quel dans cron:liveIds, ajouté par le tick
    // normal qui a détecté ce FT potentiel) — le tick normal suivant (60s)
    // retentera tout seul via son propre bloc isFinalConfirmed.
    const ftSent = await notifyVercel(env, `push:espn:ft:${eventId}`,
      { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, { homeTeam, awayTeam, rawHomeTeam, rawAwayTeam }, log, FINAL_DONE_TTL)
    if (!ftSent) {
      log.push(`[final-recheck:${slug}:${eventId}] échec envoi FT — rien de figé, le tick normal (60s) retentera`)
      return
    }
    try { await kv.set(`cron:espn:${eventId}`, `${status}|${freshScore}`, { ex: 12 * 3600 }) } catch {}
    // Clos définitivement — voir finalDoneKey en tête de boucle dans runOnePass
    // (bug corrigé : notifs "Fin de match" répétées des heures après la vraie fin).
    try { await kv.set(`finalDone:${eventId}`, '1', { ex: FINAL_DONE_TTL }) } catch {}
    await cacheEspnSummary(kv, slug, eventId, log)
    try {
      const recapKey     = `recap:${eventId}`
      const recapAlready = await kv.get(recapKey)
      if (!recapAlready) {
        const scorers = extractEspnScorers(comp, homeC.team?.id)
        const cards   = extractEspnCards(comp, homeC.team?.id)
        const recap   = generateRecap({ homeTeam, awayTeam, home, away, scorers, cards })
        if (recap) {
          await kv.set(recapKey, recap, { ex: RECAP_TTL })
          log.push(`[recap:${eventId}] généré (via recheck accéléré)`)
        }
      }
    } catch (e) {
      log.push(`[recap:${eventId}] error (recheck)=${e.message}`)
    }
    try { await kv.srem('cron:liveIds', String(eventId)) } catch (e) {
      log.push(`[cron:liveIds:${eventId}] error (recheck)=${e.message}`)
    }
  } catch (e) {
    log.push(`[final-recheck:${slug}:${eventId}] error=${e.message}`)
  }
}

async function cacheEspnSummary(kv, slug, eventId, log) {
  try {
    const url = `${ESPN_BASE}/${slug}/summary?event=${eventId}`
    const res = await fetch(url, {
      headers: ESPN_FETCH_HEADERS,
      signal:  AbortSignal.timeout(8_000),
    })
    if (!res.ok) return
    const body = await res.text()
    const parsed = JSON.parse(body)
    if (!hasUsefulSummaryData(parsed)) return
    await kv.set(`espn:summary:${slug}:${eventId}`, body, { ex: SUMMARY_CACHE_TTL })
  } catch (e) {
    log.push(`[espn-summary-cache:${slug}:${eventId}] error=${e.message}`)
  }
}

// extractEspnScorers/extractEspnCards/generateRecap : importés de
// src/utils/liveDetection.js (voir en tête de fichier) — anciennement
// dupliqués ici et dans api/cron-goals.js, désormais une seule source, testée.
const RECAP_TTL = 60 * 24 * 3600

// ── Envoi (relais Vercel) ─────────────────────────────────────────────────
// Remplace sendDeduped()+sendPushToMatch() de api/cron-goals.js : le dédup
// (SET NX) reste ici (pur Redis, gratuit) — Vercel n'est appelé QUE si ce
// Worker vient d'acquérir la clé de dédup pour de vrai, jamais pour un
// événement déjà notifié. Vercel ne fait plus que le travail réellement
// coûteux (charger les abonnés, chiffrer, envoyer).
// Tentative d'acquisition d'une clé de dédup (SET NX) — extrait de notifyVercel
// ci-dessous pour pouvoir être appelé À L'AVANCE, groupé dans le pipeline
// Redis de la boucle principale (voir plus bas, audit perf limite Cloudflare
// 50 subrequests/exécution). Comportement identique à l'ancien bloc interne
// de notifyVercel, juste extrait tel quel.
async function acquireDedup(kv, dedupKey, ttl) {
  try {
    return await kv.set(dedupKey, '1', { ex: ttl, nx: true })
  } catch { return null }
}

// Envoi réel vers Vercel — extrait de notifyVercel ci-dessous.
// ⚠️ AJOUT (constat utilisateur, 24/07 : "certains matchs, rien reçu" pendant
// un dépassement de budget CPU Vercel) : un seul essai — si Vercel répond une
// erreur transitoire (429/5xx, souvent le signe d'un budget CPU/quota
// temporairement épuisé) ou si le réseau glisse, la notif était perdue pour
// de bon, sans aucune 2e tentative. Un seul retry (1,5s plus tard) rattrape
// les ratés PONCTUELS — ne règle pas un vrai blocage persistant (ex: budget
// CPU épuisé pour le reste du mois), seulement le cas, bien plus fréquent,
// d'un aléa transitoire d'une seule requête. Pas de retry sur 4xx (401/403 —
// secret invalide/refusé : réessayer donnerait exactement le même résultat).
// ⚠️ BUG CORRIGÉ (constat utilisateur, 28/08 : "2-3 buts presque en même
// temps + fin de match, pas de notif pour ça, et 10min après pour un autre
// but j'ai tout reçu d'un coup") — root cause trouvée en relisant ce fichier
// et ses appelants : `sendToVercel` ne renvoyait RIEN (void), donc TOUS les
// appelants (notifyVercel ci-dessous, mais aussi le KO plus bas) traitaient
// un échec (timeout Vercel sous charge, 429/5xx même après le seul retry
// déjà en place) EXACTEMENT comme un succès — la clé de dédup Redis restait
// posée pour de bon (3h, ou 26h pour un FT) et les compteurs track[side]/
// cardTrack[side] avançaient quand même (voir plus bas), rendant CET
// évènement précis irrécupérable pour toujours, sans la moindre 2e chance.
// Un pic de plusieurs évènements dans la même passe (le scénario même du
// signalement : 2-3 buts + fin de match quasi simultanés) est justement le
// moment où plusieurs appels Vercel enchaînés en série ont le plus de risque
// qu'un seul d'entre eux tombe sur un aléa transitoire — un seul perdu au
// milieu d'une rafale suffit à reproduire exactement le symptôme. Renvoie
// désormais `true`/`false` : chaque appelant peut alors choisir de NE PAS
// faire avancer son propre état tant que l'envoi n'est pas confirmé.
async function sendToVercel(env, payload, slug, options = {}, log = null, attempt = 1) {
  try {
    // Secret passé en HEADER (pas en query string) : une URL avec ?secret=
    // finit dans les logs d'accès Vercel/Cloudflare en clair — le header ne
    // l'est pas. api/cron-goals.js accepte déjà x-cron-secret en priorité.
    const res = await fetch(env.VERCEL_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.CRON_SECRET },
      body: JSON.stringify({ mode: 'notify', payload, slug, options }),
      signal: AbortSignal.timeout(8_000),
    })
    if (res.ok) return true
    const transient = res.status === 429 || res.status >= 500
    log?.push(`[notify→vercel] status=${res.status}${attempt === 1 && transient ? ' — retry dans 1.5s' : ''}`)
    if (attempt === 1 && transient) {
      await new Promise(r => setTimeout(r, 1_500))
      return sendToVercel(env, payload, slug, options, log, 2)
    }
    return false
  } catch (e) {
    log?.push(`[notify→vercel] error=${e.message}${attempt === 1 ? ' — retry dans 1.5s' : ''}`)
    if (attempt === 1) {
      await new Promise(r => setTimeout(r, 1_500))
      return sendToVercel(env, payload, slug, options, log, 2)
    }
    return false
  }
}

// ⚠️ MODIFIÉ (même bug, voir commentaire sendToVercel ci-dessus) : renvoie
// désormais `true` (déjà envoyé — soit à l'instant, soit par un passage
// précédent qui détenait déjà la clé de dédup) ou `false` (échec confirmé,
// après le retry de sendToVercel). Sur `false`, la clé de dédup vient d'être
// RELÂCHÉE (del) — un futur passage (60s plus tard) peut donc réellement
// retenter cet envoi précis, au lieu de rester bloqué pour de bon derrière
// une clé posée mais jamais honorée.
async function notifyVercel(env, dedupKey, payload, slug, options = {}, log = null, ttl = 3 * 3600) {
  const acquired = await acquireDedup(env._kv, dedupKey, ttl)
  if (!acquired) return true
  const ok = await sendToVercel(env, payload, slug, options, log)
  if (!ok) {
    try { await env._kv.del(dedupKey) } catch {}
    return false
  }
  return true
}

// Ticker live (score en direct) : PAS de dédup (même tag remplace côté SW à
// chaque minute, voir api/cron-goals.js d'origine), donc appelle Vercel
// directement sans passer par notifyVercel() (qui exige une clé de dédup).
// homeTeam/awayTeam transmis en plus (voir matchesFavoriteClub côté
// api/cron-goals.js) : un abonné avec des clubs favoris configurés doit
// pouvoir recevoir le ticker de SON club même sans championnat suivi (comps).
async function pushLiveTicker(env, payload, slug, log, homeTeam, awayTeam, rawHomeTeam, rawAwayTeam) {
  try {
    const res = await fetch(env.VERCEL_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.CRON_SECRET },
      body: JSON.stringify({ mode: 'notify', payload, slug, options: { onlyFavorites: true, urgency: 'high', homeTeam, awayTeam, rawHomeTeam, rawAwayTeam } }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) log?.push(`[ticker→vercel] status=${res.status}`)
  } catch (e) {
    log?.push(`[ticker→vercel] error=${e.message}`)
  }
}

// ⚠️ AJOUT (audit perf, question utilisateur : risque de dépasser la limite
// Cloudflare Workers gratuit 50 sous-requêtes/exécution un jour très chargé) :
// base fixe incompressible par passe = 34 (17 compétitions suivies × 2 fetchs
// ESPN today+yesterday) + 1 (mget finalDone) = 35. Il reste ~15 de marge.
// Le pipeline Redis par match (détection but/carton/mi-temps/fin — l'essentiel,
// JAMAIS coupé) coûte 1 sous-requête/match live. Le résumé ESPN
// (cacheEspnSummary) et le ticker score discret (pushLiveTicker) coûtent
// chacun 1 sous-requête EN PLUS, mais seulement les minutes paires — jusqu'à
// 2 de plus par match live sur ces minutes-là. Au-delà de ce seuil de matchs
// live traités dans la MÊME passe, on coupe ces 2 postes secondaires pour les
// matchs suivants (ils sont juste rattrapés à la minute paire suivante, rien
// de perdu) — garde toujours de la marge pour que le pipeline principal ne
// soit lui jamais impacté, quel que soit le nombre de matchs.
const SUBREQUEST_SAFE_LIVE_THRESHOLD = 6

// ── Une passe complète (équivalent runOnePass() de api/cron-goals.js) ──────
async function runOnePass(env) {
  const kv = env._kv
  const log      = []
  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))

  const emptyDayKey = 'cron:emptyDay'
  const nextCheckKey = 'cron:nextCheck'
  // ⚠️ AJOUT (question utilisateur : "5min avant le match, t'es sûr qu'y'aura
  // aucun problème ?") : abaissé de 90min à 5min après vérification — tant
  // qu'un match est encore STATUS_SCHEDULED, rien de détectable ne peut se
  // produire (aucun but/carton/mi-temps possible avant le coup d'envoi), la
  // SEULE chose qui compte est le changement de statut au moment même du
  // coup d'envoi. Aucune notif "match dans X minutes" n'existe dans le code
  // qui dépendrait d'un polling en avance (la notif liée au coup d'envoi se
  // déclenche seulement une fois le statut réellement passé à LIVE, voir
  // dédup koKey plus bas). Les 90min de polling 1x/min AVANT le coup d'envoi
  // ne servaient donc à rien fonctionnellement — juste une marge large et
  // jamais justifiée précisément. Avec 5min, le coup d'envoi reste détecté à
  // la minute près comme avant (on repasse en 1x/min bien avant qu'il ait
  // lieu), seul le polling inutile des ~85min précédentes disparaît.
  const NEXT_CHECK_BUFFER_MS = 5 * 60 * 1000
  const NEXT_CHECK_MAX_MS    = 25 * 60 * 1000
  // ⚠️ AJOUT (question utilisateur : "pourquoi revérifier toutes les 20min si
  // on sait déjà qu'il n'y a aucun match aujourd'hui ?") : emptyDayKey ne
  // s'arme QUE quand le scoreboard ESPN vient de confirmer, À L'INSTANT, zéro
  // match programmé aujourd'hui pour TOUTES les compétitions couvertes (voir
  // armement plus bas) — pas juste "rien en direct". Le seul scénario où 20min
  // protégeait vraiment quelque chose : un match ajouté au calendrier APRÈS
  // cette vérification pour AUJOURD'HUI MÊME — en football pro, une pratique
  // quasi inexistante (aucune compétition n'ajoute une rencontre le jour même
  // sans préavis d'au moins plusieurs heures, souvent des semaines). 20min
  // était donc une prudence largement disproportionnée par rapport au risque
  // réel, payée par un aller-retour ESPN + une réécriture Redis à CHAQUE
  // fenêtre, 24h/24, y compris pendant les longues coupures (trêve estivale,
  // entre 2 Coupes du Monde...). 3h : toujours réactif dans la même journée
  // pour le cas extrême d'un ajout de dernière minute, mais ~9x moins de
  // vérifications qu'avant — gros gain pendant les périodes creuses, aucun
  // effet sur la détection live elle-même (cron:liveIds, voir garde-fou
  // juste en dessous, prime de toute façon toujours sur cette optimisation).
  const EMPTY_DAY_TTL = 3 * 60 * 60

  // Garde-fou (audit bug notifs groupées) : si on suit encore un match vu
  // live sans confirmation de fin (cron:liveIds non vide), on ignore les 2
  // clés de skip ci-dessous même si l'une d'elles était déjà armée — un
  // match en cours qu'on connaît prime toujours sur une optimisation "aucun
  // match" potentiellement erronée.
  //
  // ⚠️ AJOUT (question utilisateur : "1,4M/500K commandes Upstash ce mois-ci,
  // c'est lié aux compos ?") : ces 2 branches de skip sont de très loin le cas
  // le plus fréquent (la grande majorité des minutes d'une journée sans match
  // en direct/imminent) — avant ce fix, chacune renvoyait un log NON VIDE, et
  // handlePass() persiste TOUJOURS en Redis (rpush+ltrim+expire, 3 commandes)
  // dès que log.length > 0. Résultat concret : ~3 commandes Redis gaspillées
  // CHAQUE MINUTE, 24h/24, 7j/7, rien que pour re-répéter en boucle "rien à
  // faire" dans un historique de debug (/api/debug-push) que personne ne
  // consulte en temps normal — jusqu'à ~130-190K commandes/mois pour zéro
  // valeur (aucune logique de notif/détection live ne lit logHistory). Log
  // vide ici : plus aucune écriture Redis pour ce cas 100% routinier — le
  // comportement de skip lui-même (fetch ESPN sauté) est totalement inchangé,
  // seul le log persistant de la raison disparaît.
  // ⚠️ AJOUT (question utilisateur : "pourquoi ça coûte encore des milliers de
  // commandes des jours ENTIERS sans le moindre match ?") : emptyDayKey et
  // nextCheckKey étaient lus par 2 commandes GET séparées, CHAQUE minute où
  // aucun match n'est suivi (donc la quasi-totalité des minutes d'un jour
  // sans match) — un MGET groupé les lit en 1 SEULE commande Redis (même
  // principe que le pré-filtre finalDone plus haut/api/fifa-live.js), sans
  // changer la moindre décision : skip immédiat si emptyDayKey posé, sinon
  // skip jusqu'à nextCheckKey si encore valide — comportement identique.
  // ⚠️ AJOUT (question utilisateur : "86K commandes/mois rien que pour ce
  // check, c'est beaucoup sur 500K") : ce check faisait encore 2 commandes
  // séparées CHAQUE minute — scard('cron:liveIds') PUIS, si vide, le mget
  // ci-dessus. MGET ne peut pas lire un Set (scard) directement, donc
  // impossible de le fusionner tel quel — mais cron:liveIds n'est JAMAIS
  // consulté nulle part ailleurs autrement que par sa cardinalité (aucun
  // smembers/sismember dans tout le fichier, vérifié), donc sa VALEUR
  // exacte (quels matchs précisément) n'a jamais d'importance ici, seulement
  // "vide ou pas". cron:anyLive (voir anyStillLive, recalculé à CHAQUE passe
  // complète, jamais sur ce chemin skip) est un simple flag string dérivé de
  // cron:liveIds, qui LUI peut rejoindre emptyDayKey/nextCheckKey dans le
  // MÊME mget — 1 seule commande au lieu de 2, dans le cas de très loin le
  // plus fréquent. cron:liveIds (le vrai Set) reste intact et reste la seule
  // source utilisée pour la décision plus sensible (armement d'emptyDayKey/
  // nextCheckKey, scard direct conservé plus bas dans ce fichier).
  let trackingLiveAtStart = 0
  let knownEmpty = false
  let skipUntil  = null
  try {
    const [rawAnyLive, rawEmpty, rawNextCheck] = await kv.mget('cron:anyLive', emptyDayKey, nextCheckKey)
    trackingLiveAtStart = rawAnyLive ? 1 : 0
    knownEmpty = !!rawEmpty
    skipUntil  = rawNextCheck
  } catch {}

  if (trackingLiveAtStart === 0) {
    if (knownEmpty) {
      return { events: 0, log: [], quiet: true }
    }
    if (skipUntil && Number(skipUntil) > now.getTime()) {
      return { events: 0, log: [], quiet: true }
    }
  }

  // ⚠️ AJOUT (retour utilisateur : "35 fetchs ESPN par minute pour TOUTES les
  // compétitions suivies, même celles sans le moindre match aujourd'hui, c'est
  // beaucoup trop") : avant ce fix, les 17 compétitions × 2 (today+yesterday)
  // étaient interrogées à CHAQUE passe sans exception — alors qu'en pratique
  // les 6 grands championnats jouent rarement tous le même jour (calendriers
  // décalés vendredi→lundi), et les coupes/compétitions européennes ne jouent
  // que sur leurs jours de coupe d'Europe. Un jour normal, souvent seulement
  // 2-4 des 17 slugs ont un vrai match ce jour précis.
  // Dès qu'un slug+date est CONFIRMÉ vide par ESPN (evts.length===0 ET fetch
  // réussi — voir fetchEspnEvents ci-dessus, un échec réseau n'est PAS un
  // "vide confirmé"), on le mémorise en cache — les passes suivantes, pour ce
  // même jour, sautent carrément ce fetch. La clé inclut la date : elle
  // s'auto-invalide chaque jour, la TTL (20h) n'est qu'une sécurité en plus.
  // ⚠️ DOUBLE CONFIRMATION (relecture avant déploiement — même risque que le
  // bug historique emptyDayKey/cron:liveIds documenté plus bas dans ce fichier,
  // incident Angleterre-Argentine : un GLITCH ESPN ponctuel — réponse 200 mais
  // events vide alors qu'un match est bien en cours — sur UNE SEULE passe
  // aurait figé "aucun match" pendant 20h pour ce slug, coupant toute
  // notif/détection pour un vrai match en cours). Donc : 1ère passe vide →
  // simple marqueur "pending" (TTL 3min, survit à une passe ratée/lente) ; ce
  // n'est QUE si la MÊME date+slug est retrouvée vide à une 2e passe (avec un
  // pending déjà posé) que le skip réel (20h) s'arme. Un glitch isolé d'une
  // seule minute ne peut donc plus jamais couper un slug pour le reste du
  // jour — il faut 2 confirmations consécutives.
  // Lecture : 1 seul mget groupé (68 clés — flag + pending par slug/date —
  // toujours 1 seule sous-requête, même principe que finalDone plus bas).
  // Écriture : 1 seul pipeline groupé en fin de fetch. Gain concret un jour
  // normal : ~34 fetchs ESPN/minute → ~4-8 (après la 2e minute de la journée).
  const NO_MATCH_TTL      = 20 * 3600
  const NO_MATCH_PENDING_TTL = 3 * 60
  const slugDatePairs = ESPN_SLUGS.flatMap(slug => [
    { slug, date: today,     key: `noMatch:${slug}:${today}`,     pendingKey: `noMatchPending:${slug}:${today}` },
    { slug, date: yesterday, key: `noMatch:${slug}:${yesterday}`, pendingKey: `noMatchPending:${slug}:${yesterday}` },
  ])
  let noMatchFlags = new Set()
  let noMatchPending = new Set()
  try {
    const flatKeys = slugDatePairs.flatMap(p => [p.key, p.pendingKey])
    const flags = await kv.mget(...flatKeys)
    slugDatePairs.forEach((p, i) => {
      if (flags[i * 2])     noMatchFlags.add(p.key)
      if (flags[i * 2 + 1]) noMatchPending.add(p.pendingKey)
    })
  } catch {}

  const pairsToFetch = slugDatePairs.filter(p => !noMatchFlags.has(p.key))
  const allResults = await Promise.allSettled(
    pairsToFetch.map(p => fetchEspnEvents(p.slug, p.date, log).then(res => ({ pair: p, res })))
  )

  const allEvents = []
  const newlyEmptyKeys   = [] // 2e confirmation consécutive → skip réel (20h)
  const newlyPendingKeys = [] // 1ère confirmation seulement → juste marquer, pas encore skip
  for (const r of allResults) {
    if (r.status !== 'fulfilled') continue
    const { pair, res } = r.value
    if (res.ok && res.events.length === 0) {
      if (noMatchPending.has(pair.pendingKey)) newlyEmptyKeys.push(pair.key)
      else newlyPendingKeys.push(pair.pendingKey)
    } else {
      for (const evt of res.events) allEvents.push({ slug: pair.slug, evt })
    }
  }
  if (newlyEmptyKeys.length > 0 || newlyPendingKeys.length > 0) {
    try {
      let flagPipe = kv.pipeline()
      for (const k of newlyEmptyKeys)   flagPipe = flagPipe.set(k, '1', { ex: NO_MATCH_TTL })
      for (const k of newlyPendingKeys) flagPipe = flagPipe.set(k, '1', { ex: NO_MATCH_PENDING_TTL })
      await flagPipe.exec()
    } catch {}
  }

  const espnFetchFailed = log.some(l => /^\[espn:.*\] error=/.test(l))
  // ⚠️ Armement des 2 optimisations "on peut sauter le prochain fetch"
  // (emptyDayKey / nextCheckKey) déplacé APRÈS la boucle de traitement des
  // matchs ci-dessous — voir le commentaire à cet endroit pour le bug réel
  // que ça corrige (notifs but/mi-temps/fin reçues d'un coup avec ~1h43 de
  // retard sur Angleterre-Argentine).

  const hasWc = allEvents.some(({ slug }) => slug === 'fifa.world')
  const fifaLiveMatches = hasWc ? await fetchFifaLiveMatches(kv, log) : []

  const pendingSummaryFetches = []
  // Tâches de fond "recheck FT accéléré" (voir recheckFinalMatch) — collectées
  // ici et attendues tout à la fin de runOnePass, APRÈS le reste de la passe
  // (armement cron:emptyDay/cron:nextCheck inclus) pour ne rien changer à
  // l'ordre/timing de la logique existante, seulement prolonger la passe.
  const pendingFinalRechecks = []

  // ⚠️ AJOUT (question utilisateur : "6K commandes Redis en <10h une nuit sans
  // nouveau match, c'est pas normal") : ESPN continue de lister un match dans
  // son scoreboard/dates=... pendant tout le reste de sa journée ET le
  // lendemain (via le fetch "yesterday" ci-dessus), même des HEURES après sa
  // vraie fin — donc allEvents contient encore des matchs déjà clos
  // (finalDoneKey déjà posé, voir plus bas) pendant ~48h après chaque journée
  // de championnat. AVANT ce fix, CHAQUE match déjà clos payait quand même le
  // pipeline complet (5-7 commandes Redis) à CHAQUE passe où il traînait
  // encore ici, avant de découvrir (via pick(5), plus bas) qu'il n'y avait
  // plus rien à faire — un coût jugé "inévitable" à l'origine (voir
  // commentaire historique sur finalDoneKey/pick(5)) parce qu'on ne
  // connaissait alreadyDone qu'APRÈS avoir exécuté le pipeline. Avec plusieurs
  // championnats qui reprennent la même semaine (donc souvent 10-20+ matchs
  // clos qui traînent en même temps dans la fenêtre 48h), ce coût devient vite
  // significatif — y compris la nuit, quand aucun nouveau match ne justifie
  // pourtant la moindre commande.
  //
  // Fix : un seul MGET groupé lit le statut "clos" de TOUS les matchs de
  // cette passe en 1 SEULE commande Redis (peu importe leur nombre — même
  // principe déjà utilisé dans api/fifa-live.js/fetchEspnEvents) — donc aussi
  // 1 seule sous-requête Cloudflare, pas 1 par match (important : un get()
  // séparé par match aurait doublé le nombre de sous-requêtes pour CHAQUE
  // match encore actif, au risque de re-cogner la limite de 50/exécution que
  // le passage en pipeline, voir plus bas, avait justement réglée). Les
  // matchs déjà clos sautent alors la boucle avant de payer le moindre coût
  // du pipeline par-match. Purement ADDITIF : le pipeline par-match et son
  // propre .get(finalDoneKey) (voir pick(5) plus bas) restent INCHANGÉS —
  // ce pré-filtre ne fait que sauter les matchs qu'on sait DÉJÀ clos depuis
  // AVANT cette passe ; un match qui vient tout juste d'être confirmé clos
  // PENDANT cette passe (1ère fois) n'est pas concerné, traité normalement
  // comme avant.
  let alreadyDoneIds = new Set()
  if (allEvents.length > 0) {
    try {
      const doneFlags = await kv.mget(...allEvents.map(({ evt }) => `finalDone:${evt.id}`))
      allEvents.forEach(({ evt }, i) => { if (doneFlags[i]) alreadyDoneIds.add(evt.id) })
    } catch {}
  }

  // Voir SUBREQUEST_SAFE_LIVE_THRESHOLD plus haut — compteur de matchs live
  // vus DANS CETTE PASSE, sert à couper résumé+ticker au-delà du seuil sûr.
  let liveMatchesSeenThisPass = 0

  // ⚠️ AJOUT (investigation "~10K commandes/jour sans match") : drapeau
  // dénormalisé, recalculé à CHAQUE passe complète (jamais sur le
  // skip-fast-path, voir plus bas) à partir de cron:liveIds — sert
  // UNIQUEMENT à fusionner le `scard('cron:liveIds')` du skip-fast-path avec
  // le `mget(emptyDayKey, nextCheckKey)` juste à côté en UNE seule commande
  // Redis au lieu de 2 (MGET porte sur des clés string, pas sur un Set —
  // scard ne peut pas y être inclus directement). cron:liveIds (le vrai Set,
  // source de vérité) n'est PAS touché, reste utilisé tel quel pour
  // l'armement d'emptyDayKey/nextCheckKey (voir stillTrackingLive plus bas,
  // scard direct conservé à cet endroit précis — décision plus sensible,
  // autant rester sur la source authentique). Auto-réparateur en pire cas :
  // recalculé à chaque passe complète (pas seulement au moment où un match
  // démarre/finit), donc un échec d'écriture isolé s'auto-corrige au plus
  // tard à la passe suivante (60s), largement sous les marges de sécurité
  // déjà en place ailleurs dans ce fichier (grâce 45s-5min).
  let anyStillLive = false

  for (const { slug, evt } of allEvents) {
   if (alreadyDoneIds.has(evt.id)) continue
   try {
    const comp = evt.competitions?.[0]
    if (!comp) continue

    let   status   = normalizeEspnStatus(comp.status)
    const homeC    = comp.competitors?.find(c => c.homeAway === 'home')
    const awayC    = comp.competitors?.find(c => c.homeAway === 'away')
    if (!homeC || !awayC) continue

    let   home     = parseInt(homeC.score ?? '0', 10) || 0
    let   away     = parseInt(awayC.score ?? '0', 10) || 0
    const homeTeam = t(homeC.team?.shortDisplayName ?? homeC.team?.displayName ?? '?')
    const awayTeam = t(awayC.team?.shortDisplayName ?? awayC.team?.displayName ?? '?')
    // Noms ESPN BRUTS (avant traduction FR) — transmis à Vercel pour le
    // filtre par club favori (voir matchesFavoriteClub dans api/cron-goals.js).
    const rawHomeTeam = homeC.team?.shortDisplayName ?? homeC.team?.displayName ?? ''
    const rawAwayTeam = awayC.team?.shortDisplayName ?? awayC.team?.displayName ?? ''
    const eventId  = evt.id

    // ⚠️ BUG CRITIQUE CORRIGÉ (retour utilisateur : notif "🏁 Fin de match"
    // reçue 3 fois à plusieurs heures d'intervalle sur un match terminé
    // depuis longtemps) : ESPN continue de lister un match FINAL dans son
    // scoreboard/dates=... pendant potentiellement des HEURES après la vraie
    // fin (le reste de la journée, parfois même le lendemain via le fetch
    // "yesterday"). Or finalConfirmKey (voir plus bas) n'a qu'un TTL de 5min
    // — pensé pour combler l'écart entre 2 passes consécutives, PAS pour
    // durer des heures. Une fois ces 5min passées, si ESPN liste TOUJOURS ce
    // match comme FINAL à la passe suivante, finalConfirmKey se ré-acquiert
    // (la clé a expiré) → le match repasse en "1ère détection, pas encore
    // confirmé" comme si c'était un tout nouveau FT → redéclenche tout le
    // circuit de confirmation (dont recheckFinalMatch) → et une fois que le
    // dédup de la notif elle-même (push:espn:ft:{id}, TTL 3h par défaut) a
    // fini par expirer depuis le DERNIER envoi réel, une vraie notif
    // repart — en boucle, tant qu'ESPN garde le match dans son scoreboard.
    // finalDoneKey (TTL 26h, largement au-delà de ce qu'ESPN peut lister un
    // même jour + marge) mémorise "ce match est confirmé clos pour de bon" —
    // dès qu'il existe, on saute TOUT traitement de cet évènement (buts,
    // cartons, mi-temps, reprise, FT, recheck), plus aucune notif ne peut
    // repartir, quel que soit le nombre de fois qu'ESPN le re-liste ensuite.
    // Lue dans le MÊME pipeline groupé que le reste (voir plus bas, audit
    // perf limite Cloudflare 50 subrequests/exécution) — PAS un await séparé
    // ici, qui coûterait 1 subrequest de plus par match à CHAQUE passe,
    // même pour les matchs encore en cours (le cas de très loin le plus
    // fréquent) : gaspillage inutile du budget pour une lecture qui n'est
    // utile QUE pour les quelques matchs déjà terminés depuis longtemps.
    const finalDoneKey = `finalDone:${eventId}`

    if (slug === 'fifa.world' && fifaLiveMatches.length > 0) {
      const rawHome = homeC.team?.displayName ?? homeC.team?.shortDisplayName ?? ''
      const rawAway = awayC.team?.displayName ?? awayC.team?.shortDisplayName ?? ''
      const fifaMatch = fifaLiveMatches.find(m => {
        const homeNames = fifaTeamNamesAll(m.HomeTeam)
        const awayNames = fifaTeamNamesAll(m.AwayTeam)
        return homeNames.some(n => fuzzyTeamFifa(rawHome, n)) && awayNames.some(n => fuzzyTeamFifa(rawAway, n))
      })
      if (fifaMatch) {
        const fifaStatus = fifaEffectiveStatus(fifaMatch)
        if (status === 'STATUS_SCHEDULED' && fifaStatus) {
          status = fifaStatus
          log.push(`[fifa-override:${eventId}] ESPN=SCHEDULED → FIFA=${fifaStatus}`)
        } else if (status === 'STATUS_IN_PROGRESS' && fifaStatus === 'STATUS_HALFTIME') {
          status = 'STATUS_HALFTIME'
          log.push(`[fifa-override:${eventId}] ESPN=IN_PROGRESS → FIFA=HALFTIME`)
        } else if (status === 'STATUS_SHOOTOUT' && fifaConfirmsShootoutOver(fifaMatch)) {
          status = 'STATUS_FINAL_PEN'
          log.push(`[fifa-override:${eventId}] ESPN=STATUS_SHOOTOUT → FIFA=FINAL`)
        }
        const fh = fifaMatch.HomeTeam?.Score
        const fa = fifaMatch.AwayTeam?.Score
        if (typeof fh === 'number') home = Math.max(home, fh)
        if (typeof fa === 'number') away = Math.max(away, fa)
      }
    }

    const score    = `${home}-${away}`
    const scoreStr = `${home} – ${away}`
    const isLive        = LIVE_ESPN.has(status)
    const notPostponed  = status !== 'STATUS_POSTPONED' && status !== 'STATUS_CANCELED'
    const isFinalNow    = FINAL_ESPN.has(status)

    if (isLive) liveMatchesSeenThisPass++
    const underSubrequestSafeLimit = liveMatchesSeenThisPass <= SUBREQUEST_SAFE_LIVE_THRESHOLD

    if (isLive && underSubrequestSafeLimit && shouldRefreshSummary()) {
      pendingSummaryFetches.push(cacheEspnSummary(kv, slug, eventId, log))
    }

    if (status === 'STATUS_SCHEDULED' && notPostponed) continue

    // ── Regroupement Redis en 1 seul aller-retour (audit perf : limite
    // Cloudflare Workers gratuit = 50 requêtes sortantes/exécution, CHAQUE
    // commande Redis Upstash en compte une — constat : un match live "sans
    // rien de particulier cette minute" (le cas de très loin le plus
    // fréquent) coûtait à lui seul ~7-8 requêtes séparées : sadd/srem
    // liveIds, dédup KO, get+set état, get compteur buts, get compteur
    // cartons, verrou but — de quoi épuiser le budget dès 2-3 matchs
    // simultanés (samedi normal multi-championnats, ou simple soirée Ligue
    // des Champions). Ces commandes sont toutes INDÉPENDANTES les unes des
    // autres (aucune n'a besoin du RÉSULTAT d'une autre pour être ENVOYÉE —
    // seul le code plus bas, une fois les résultats revenus, décide quoi en
    // faire), donc regroupables sans rien changer au comportement : un
    // pipeline Upstash exécute chaque commande dans l'ordre et de façon
    // atomique côté serveur, exactement comme si elles étaient envoyées une
    // par une — seul le TRANSPORT réseau est mutualisé en une seule requête
    // HTTP (voir doc Upstash : "each command in the pipeline will be
    // executed in order").
    //
    // ⚠️ goalTrack/cardTrack/verrou but sont ici toujours inclus dans le
    // pipeline dès qu'un match n'est pas SCHEDULED (donc aussi un match
    // reporté/annulé/déjà terminé), même si la condition qui les UTILISE
    // plus bas reste IDENTIQUE à avant (LIVE_ESPN sur le statut précédent OU
    // actuel — nécessaire pour ne pas rater un but marqué à la toute
    // dernière seconde, pile au coup de sifflet final). Coût : quelques
    // lectures/un verrou tenté sans être utilisés sur les matchs
    // reportés/déjà terminés (rares, sans effet de bord observable — le
    // verrou expire tout seul en 5s, jamais lu ailleurs), en échange d'un
    // seul aller-retour réseau au lieu de plusieurs branches séparées.
    const stateKey        = `cron:espn:${eventId}`
    const trackKey        = `goalTrack:${eventId}`
    const cardTrackKey    = `cardTrack:${eventId}`
    const lockKey         = `goalLock:${eventId}`
    const koKey           = `push:espn:ko:${eventId}`
    const recapKey        = `recap:${eventId}`
    // ⚠️ AJOUT (retour utilisateur : "j'ai eu comme quoi le match est fini
    // alors qu'il est pas fini, on est encore dans le temps additionnel, c'est
    // pas normal") : ESPN peut renvoyer un statut FINAL de façon transitoire
    // pendant une seule passe (glitch ponctuel côté API — déjà rencontré une
    // fois pour un tout autre symptôme, voir le commentaire sur les notifs
    // groupées reçues avec ~10min de retard plus bas). Avant ce fix, la
    // notif "🏁 Fin de match" ET le passage "Terminé" côté client (voir
    // confirmFt, useLiveMinute.js) faisaient confiance à UNE SEULE passe
    // FINAL — un unique glitch (le temps additionnel confondu avec la fin
    // par erreur côté ESPN) suffisait à déclarer le match terminé pour de
    // bon. finalConfirmKey (SET NX, TTL 5min) sert de compteur "vu au moins
    // une fois" : la 1ère passe FINAL l'acquiert et n'est PAS encore
    // considérée confirmée (le match reste traité comme en cours) ; ce n'est
    // qu'à la 2e passe FINAL consécutive (~1min plus tard, Cron Trigger
    // toutes les minutes) — ET score inchangé entretemps (voir
    // isFinalConfirmed plus bas) — que la fin est vraiment confirmée. Coût :
    // ~1min de délai supplémentaire sur les notifs/passage "Terminé" pour
    // TOUS les matchs (même ceux qui se terminent normalement), largement
    // acceptable face au risque d'une fausse alerte "match terminé" envoyée
    // en push à tous les abonnés en plein temps additionnel.
    const finalConfirmKey = `finalConfirm:${eventId}`

    // ⚠️ Les indices [5]/[6] ci-dessous sont OPTIONNELS (ajoutés seulement
    // sous condition) — finalDoneKey [5] doit donc rester le DERNIER ajout
    // INCONDITIONNEL avant eux (position fixe, toujours [5]), sinon sa
    // position réelle dans pipeResults se décale selon isLive/isFinalNow et
    // pick(5) lirait le mauvais résultat (bug trouvé et corrigé pendant la
    // relecture de ce fix, avant tout déploiement).
    let pipe = kv.pipeline()
      .get(stateKey)                                          // [0] prevState
      .set(stateKey, `${status}|${score}`, { ex: 12 * 3600 })  // [1] (résultat inutilisé)
      .get(trackKey)                                           // [2] rawTrack
      .get(cardTrackKey)                                       // [3] rawCardTrack
      .set(lockKey, '1', { px: 5_000, nx: true })              // [4] lockAcquired
      .get(finalDoneKey)                                       // [5] alreadyDone — voir commentaire plus haut, garde-fou bug notifs répétées
    // [6] optionnel : dédup coup d'envoi (si live) OU lecture recap (si
    // terminé) — isLive et isFinalNow sont mutuellement exclusifs (aucun
    // statut n'appartient aux 2 ensembles à la fois), jamais les deux en
    // même temps dans le même pipeline.
    if (isLive) pipe = pipe.set(koKey, '1', { ex: 6 * 3600, nx: true })
    else if (isFinalNow) pipe = pipe.get(recapKey)
    // [7] optionnel : 1ère acquisition de finalConfirmKey (voir commentaire
    // ci-dessus) — uniquement pertinent quand isFinalNow.
    if (isFinalNow) pipe = pipe.set(finalConfirmKey, '1', { ex: 300, nx: true })

    let pipeResults = []
    try {
      pipeResults = await pipe.exec({ keepErrors: true })
    } catch (e) {
      log.push(`[espn:${slug}:${eventId}] pipeline error=${e.message}`)
    }
    // keepErrors:true → chaque entrée est { result, error? } — une commande
    // en erreur individuelle (ou un échec réseau total, pipeResults=[])
    // retombe sur null, exactement comme l'ancien "un .catch() par appel"
    // séparé pour chaque commande.
    const pick = (i) => (pipeResults[i] && !pipeResults[i].error) ? pipeResults[i].result : null

    const prevState    = pick(0)
    const rawTrack      = pick(2)
    const rawCardTrack  = pick(3)
    const lockAcquired  = pick(4)
    // Match déjà confirmé clos pour de bon lors d'une passe précédente (voir
    // finalDoneKey plus haut, position FIXE [5]) → on s'arrête ICI, avant
    // tout le reste (buts, cartons, mi-temps, reprise, FT, recheck). Le
    // stateKey/trackKey/etc. ont déjà été écrits ci-dessus par le pipeline
    // (coût déjà payé, inévitable vu qu'on ne connaît alreadyDone qu'APRÈS
    // avoir exécuté le pipeline), mais aucune notif ne peut plus jamais
    // repartir pour cet évènement à partir d'ici.
    if (pick(5)) continue
    const koAcquired    = isLive ? pick(6) : false
    const recapAlready  = (!isLive && isFinalNow) ? pick(6) : null
    // true = c'est la 1ère fois qu'on voit ce match FINAL (clé tout juste
    // créée) → PAS encore confirmé. false/null = la clé existait déjà → au
    // moins une passe FINAL précédente → confirmation possible (sous réserve
    // du score inchangé, voir isFinalConfirmed plus bas).
    const finalFirstSeen = isFinalNow ? pick(7) : null

    const [prevStatus = null, prevScore = null] = prevState ? prevState.split('|') : []
    // Confirmé seulement à la 2e passe FINAL consécutive (ou plus), avec un
    // score identique à la passe précédente — voir commentaire finalConfirmKey.
    const isFinalConfirmed = isFinalNow && !finalFirstSeen && FINAL_ESPN.has(prevStatus) && prevScore === score

    // Marque ce match comme "toujours en cours" côté Redis, indépendamment du
    // résultat de CETTE passe précise — voir cron:liveIds (garde-fou contre
    // le bug de blackout notifs, déjà en place). Un match FINAL mais PAS
    // ENCORE confirmé (1ère passe, potentiel glitch) reste traité comme
    // "encore en direct" ici — sinon cron:liveIds pourrait se vider et
    // armer l'optimisation "sauter le prochain fetch ESPN pendant 20-25min"
    // en pleine confusion, empêchant toute correction rapide si c'était
    // effectivement un faux FINAL.
    const stayTrackedAsLive = isLive || (isFinalNow && !isFinalConfirmed)
    if (stayTrackedAsLive) anyStillLive = true
    try {
      if (stayTrackedAsLive) await kv.sadd('cron:liveIds', String(eventId))
      else await kv.srem('cron:liveIds', String(eventId))
    } catch (e) {
      log.push(`[cron:liveIds:${eventId}] error=${e.message}`)
    }

    // 🔴 Coup d'envoi — dédup déjà tenté ci-dessus (pipeline) : on n'envoie
    // que si on vient vraiment de l'acquérir, comportement identique à avant.
    if (isLive && notPostponed && koAcquired) {
      const koSent = await sendToVercel(env,
        { title: "🔴 Coup d'envoi !", body: `${homeTeam} – ${awayTeam}`, url: '/live' }, slug, { homeTeam, awayTeam, rawHomeTeam, rawAwayTeam }, log)
      if (koSent) {
        log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} KO (confirmé ESPN)`)
      } else {
        // Échec confirmé — koKey a été posé dans le pipeline plus haut (SET
        // NX) AVANT de savoir si l'envoi allait réussir ; on le relâche pour
        // qu'un futur passage puisse retenter, même bug/même fix que
        // notifyVercel ci-dessus.
        try { await kv.del(koKey) } catch {}
        log.push(`[espn:${slug}:${eventId}] échec envoi KO — retenté au prochain passage`)
      }
    }

    if (prevState === null) {
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} baseline ${status}|${score}`)
      try { await kv.set(trackKey, JSON.stringify({ home, away }), { ex: 12 * 3600 }) } catch {}
      continue
    }

    if (status !== prevStatus) {
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} transition ${prevStatus} → ${status}`)
    }

    const steadyHalftime = prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME'

    // ⚽ But (+ ❌ but annulé) — même state machine que api/cron-goals.js
    if (LIVE_ESPN.has(prevStatus) || isLive) {
      if (!lockAcquired) {
        log.push(`[espn:${slug}:${eventId}] verrou but déjà pris — passe suivante`)
      } else {
        let track = rawTrack
        track = track ? (typeof track === 'string' ? safeJsonParse(track, { home, away }) : track) : { home, away }

        const sides = []
        if (home > track.home) sides.push('home')
        if (away > track.away) sides.push('away')

        let trackChanged = false

        const cancelledSides = []
        if (home < track.home) cancelledSides.push('home')
        if (away < track.away) cancelledSides.push('away')

        for (const side of cancelledSides) {
          const scoringTeam  = side === 'home' ? homeTeam : awayTeam
          const newCount     = side === 'home' ? home : away
          const prevCount    = track[side]
          log.push(`[espn:${slug}:${eventId}] BUT ANNULÉ ${side} ${prevCount}→${newCount}`)
          const cancelSent = await notifyVercel(env, `push:espn:goalcancel:${eventId}:${side}:${newCount}`,
            { title: `❌ But annulé (${scoringTeam})`, body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live', matchId: eventId, tag: `goal-cancel-${eventId}-${side}-${newCount}` }, slug, { homeTeam, awayTeam, rawHomeTeam, rawAwayTeam }, log)
          if (!cancelSent) {
            // Échec confirmé — voir commentaire sendToVercel/notifyVercel en
            // tête de fichier : on ne touche PAS track[side]/les anciennes
            // clés de dédup "but", le prochain passage retentera cette même
            // annulation depuis le début.
            log.push(`[espn:${slug}:${eventId}] échec envoi but annulé ${side} — retenté au prochain passage`)
            continue
          }
          for (let i = newCount; i < prevCount; i++) {
            try { await kv.del(`push:espn:goal:${eventId}:${side}:${i + 1}`) } catch {}
          }
          track[side] = newCount
          trackChanged = true
        }

        for (const side of sides) {
          const targetCount = side === 'home' ? home : away
          if (steadyHalftime) { track[side] = targetCount; trackChanged = true; continue }

          const scoringTeam = side === 'home' ? homeTeam : awayTeam
          const goalScorers = extractEspnScorers(comp, homeC.team?.id)
            .filter(g => g.team === side)
            .sort((a, b) => parseMin(a.minute) - parseMin(b.minute))

          while (track[side] < targetCount) {
            const goalIndex = track[side]
            const scorer     = goalScorers[goalIndex] ?? null
            const scorerSuffix = scorer ? (scorer.ownGoal ? ', csc' : scorer.penaltyKick ? ', pen' : '') : ''
            const minuteText   = scorer ? minuteLabel(scorer.minute) : ''
            const goalTitle    = `⚽ But pour ${scoringTeam} !`
            const scorerLine   = scorer
              ? `${scorer.name}${scorerSuffix}${minuteText ? ` ${minuteText}` : ''}`
              : 'But marqué'
            const goalBody     = `${scorerLine}\n${homeTeam} ${scoreStr} ${awayTeam}`

            log.push(`[espn:${slug}:${eventId}] BUT ${side} ${goalIndex + 1}/${targetCount}`)
            const goalSent = await notifyVercel(env, `push:espn:goal:${eventId}:${side}:${goalIndex + 1}`,
              { title: goalTitle, body: goalBody, url: '/live', matchId: eventId, tag: `goal-${eventId}-${side}-${goalIndex + 1}` }, slug, { homeTeam, awayTeam, rawHomeTeam, rawAwayTeam }, log)
            if (!goalSent) {
              // Échec confirmé — voir commentaire sendToVercel/notifyVercel en
              // tête de fichier : on N'AVANCE PAS track[side], sinon ce but
              // précis ne serait plus jamais redétecté (le prochain passage
              // comparerait le score à un compteur déjà à jour). On arrête ici
              // pour ce côté cette passe (garde l'ordre chronologique des
              // buts) — retenté depuis ce même but au prochain passage (60s).
              log.push(`[espn:${slug}:${eventId}] échec envoi but ${side} ${goalIndex + 1} — retenté au prochain passage`)
              break
            }
            track[side]++
            trackChanged = true
          }
        }

        if (trackChanged) {
          try { await kv.set(trackKey, JSON.stringify(track), { ex: 12 * 3600 }) } catch {}
        }
      }
    }

    // 🟥 Carton rouge
    if (isLive || LIVE_ESPN.has(prevStatus)) {
      const reds = extractEspnCards(comp, homeC.team?.id).filter(c => c.red)
        .sort((a, b) => parseMin(a.minute) - parseMin(b.minute))
      const redsBySide = { home: reds.filter(c => c.team === 'home'), away: reds.filter(c => c.team === 'away') }

      let cardTrack = rawCardTrack
      cardTrack = cardTrack ? (typeof cardTrack === 'string' ? safeJsonParse(cardTrack, { home: 0, away: 0 }) : cardTrack) : { home: 0, away: 0 }
      let cardTrackChanged = false

      for (const side of ['home', 'away']) {
        const list = redsBySide[side]
        while (cardTrack[side] < list.length) {
          const card       = list[cardTrack[side]]
          const teamName   = side === 'home' ? homeTeam : awayTeam
          const minuteText = minuteLabel(card.minute)
          log.push(`[espn:${slug}:${eventId}] carton rouge ${side} ${card.name}`)
          const redSent = await notifyVercel(env, `push:espn:red:${eventId}:${side}:${cardTrack[side] + 1}`,
            { title: '🟥 Carton rouge', body: `${card.name} (${teamName})${minuteText ? ` — ${minuteText}` : ''}`, url: '/live' }, slug, { homeTeam, awayTeam, rawHomeTeam, rawAwayTeam }, log)
          if (!redSent) {
            // Même fix que le but ci-dessus : ne pas avancer cardTrack[side]
            // tant que l'envoi n'est pas confirmé, sinon ce carton précis ne
            // serait plus jamais redétecté.
            log.push(`[espn:${slug}:${eventId}] échec envoi carton rouge ${side} — retenté au prochain passage`)
            break
          }
          cardTrack[side]++
          cardTrackChanged = true
        }
      }
      if (cardTrackChanged) {
        try { await kv.set(cardTrackKey, JSON.stringify(cardTrack), { ex: 12 * 3600 }) } catch {}
      }
    }

    // ⏸ Mi-temps
    if (LIVE_ESPN.has(prevStatus) && prevStatus !== 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME') {
      log.push(`[espn:${slug}:${eventId}] mi-temps`)
      await notifyVercel(env, `push:espn:ht:${eventId}`,
        { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, { homeTeam, awayTeam, rawHomeTeam, rawAwayTeam }, log)
    }

    // ▶️ Reprise 2ème MT
    if (prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_IN_PROGRESS') {
      log.push(`[espn:${slug}:${eventId}] reprise`)
      await notifyVercel(env, `push:espn:2h:${eventId}`,
        { title: '▶️ Reprise !', body: `2ème MT · ${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, { homeTeam, awayTeam, rawHomeTeam, rawAwayTeam }, log)
    }

    // 🏁 Fin de match — seulement une fois CONFIRMÉ (2e passe FINAL
    // consécutive, score inchangé — voir finalConfirmKey/isFinalConfirmed
    // plus haut). Sur la 1ère passe FINAL (potentiel glitch ESPN, ex. temps
    // additionnel confondu avec la fin), on ne notifie PAS encore — juste
    // au cas où la passe suivante infirme ce statut.
    if (isFinalConfirmed) {
      log.push(`[espn:${slug}:${eventId}] FT (confirmé)`)
      // ⚠️ BUG CORRIGÉ (même investigation que sendToVercel/notifyVercel en
      // tête de fichier) : finalDoneKey était posé AVANT même de savoir si
      // l'envoi allait réussir — un échec (timeout/429/5xx) laissait quand
      // même le match "clos pour de bon" (plus aucun traitement possible,
      // voir `if (pick(5)) continue` en tête de boucle), la notif "Fin de
      // match" perdue pour toujours. Posé désormais SEULEMENT si l'envoi est
      // confirmé.
      const ftSent = await notifyVercel(env, `push:espn:ft:${eventId}`,
        { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, { homeTeam, awayTeam, rawHomeTeam, rawAwayTeam }, log, FINAL_DONE_TTL)
      if (ftSent) {
        try { await kv.set(finalDoneKey, '1', { ex: FINAL_DONE_TTL }) } catch {}
        await cacheEspnSummary(kv, slug, eventId, log)
        // Voir FD_SLUG_TO_WARM_COMP/queueFdPriorityRefresh plus bas dans ce
        // fichier — priorise le rafraîchissement FD.org (calendrier+classement)
        // de cette compétition au lieu d'attendre la rotation aveugle.
        await queueFdPriorityRefresh(kv, slug, log)
      } else {
        // Échec confirmé — ANNULE le retrait de cron:liveIds fait plus haut
        // (stayTrackedAsLive, calculé uniquement sur le statut/score ESPN,
        // pas sur le succès de l'envoi) : sinon ce match serait considéré
        // "plus rien à surveiller", et si c'était le DERNIER match live du
        // jour, le Worker pourrait sauter jusqu'à 20-25min de fetchs ESPN
        // (optimisation "aucun match en direct", voir plus haut dans ce
        // fichier) avant de retenter — exactement le symptôme remonté par
        // l'utilisateur ("notifs reçues d'un coup ~10min plus tard").
        log.push(`[espn:${slug}:${eventId}] échec envoi FT — match gardé "en direct", retenté au prochain passage`)
        anyStillLive = true
        try { await kv.sadd('cron:liveIds', String(eventId)) } catch {}
      }
    } else if (isFinalNow) {
      log.push(`[espn:${slug}:${eventId}] FT potentiel (1ère passe, pas encore confirmé)`)
      // 1ère détection cette passe (finalConfirmKey tout juste acquis) → programmer
      // le recheck accéléré (~18s) au lieu d'attendre le tick normal (jusqu'à 60s).
      // finalFirstSeen garantit que ceci ne se déclenche qu'UNE SEULE fois par
      // 5min — voir finalDoneKey en tête de boucle pour ce qui empêche
      // vraiment toute répétition au-delà (finalConfirmKey seul ne suffisait
      // pas : sa courte TTL pouvait se ré-armer des heures plus tard tant
      // qu'ESPN listait encore le match FINAL, voir bug corrigé ci-dessus).
      if (finalFirstSeen) {
        pendingFinalRechecks.push(
          recheckFinalMatch(env, kv, slug, eventId, score, homeTeam, awayTeam, rawHomeTeam, rawAwayTeam, scoreStr, log)
        )
      }
    }

    // 📝 Résumé auto — écrit directement en Redis, aucun appel Vercel. Le
    // "déjà généré ?" vient du pipeline ci-dessus (recapAlready) — seule
    // l'écriture reste un appel séparé, rare (une fois par match, jamais
    // ensuite puisque recapAlready sera non-null derrière). Gêné derrière le
    // même garde-fou isFinalConfirmed — un résumé généré sur un faux FT
    // (temps additionnel toujours en cours) risquerait d'omettre un
    // but/carton arrivé juste après.
    if (isFinalConfirmed) {
      try {
        if (!recapAlready) {
          const scorers = extractEspnScorers(comp, homeC.team?.id)
          const cards   = extractEspnCards(comp, homeC.team?.id)
          const recap   = generateRecap({ homeTeam, awayTeam, home, away, scorers, cards })
          if (recap) {
            await kv.set(recapKey, recap, { ex: RECAP_TTL })
            log.push(`[recap:${eventId}] généré`)
          }
        }
      } catch (e) {
        log.push(`[recap:${eventId}] error=${e.message}`)
      }
    }

    // 📊 Ticker "score en direct" — pas de dédup (même tag, remplace côté SW).
    // Espacé à 1 passe sur 2 (shouldSendLiveTicker) — voir son commentaire.
    if (isLive && underSubrequestSafeLimit && shouldSendLiveTicker()) {
      const mLabel = status === 'STATUS_HALFTIME' ? 'Mi-temps' : `${comp.status?.displayClock ?? ''}`.trim()
      await pushLiveTicker(env, {
        title: `${homeTeam} ${scoreStr} ${awayTeam}`,
        body:  mLabel ? `⏱ ${mLabel}` : 'En direct',
        url:   '/live',
        matchId: eventId,
        tag:     `live-${eventId}`,
        silent:  true,
        renotify: false,
      }, slug, log, homeTeam, awayTeam, rawHomeTeam, rawAwayTeam)
    }
   } catch (e) {
     log.push(`[espn:${slug}:${evt?.id ?? '?'}] ERREUR match ignoré : ${e.message}`)
   }
  }

  // Voir anyStillLive plus haut — 1 seule commande, 1 seule fois par passe
  // complète (jamais sur le skip-fast-path). ex 3h : purement défensif, se
  // réarme de toute façon à chaque passe complète tant qu'un match est suivi.
  try {
    if (anyStillLive) await kv.set('cron:anyLive', '1', { ex: 3 * 3600 })
    else await kv.del('cron:anyLive')
  } catch {}

  if (pendingSummaryFetches.length > 0) {
    await Promise.allSettled(pendingSummaryFetches)
  }

  // ── Armement des optimisations "on peut sauter le prochain fetch" ──────────
  // ⚠️ BUG CORRIGÉ (constat utilisateur : notifs but/mi-temps/fin reçues
  // toutes d'un coup ~10min après la fin du match, alors que le coup d'envoi
  // était arrivé à l'heure — reproduit sur les logs réels du direct
  // Angleterre-Argentine : trou total de 19h47 à 21h30, un seul but/mi-temps/
  // reprise jamais loggés individuellement). AVANT : ces 2 clés (emptyDayKey/
  // nextCheckKey, jusqu'à 20-25min de fetch ESPN sauté chacune) s'armaient sur
  // la seule base du fetch de CETTE passe — si ESPN renvoyait par accident (glitch
  // ponctuel, statut mal classé le temps d'une passe...) une réponse qui ne
  // montrait plus le match comme "live", le Worker croyait le match terminé/
  // absent et coupait le prochain fetch pendant 20-25min, potentiellement
  // reconduit passe après passe si le même aléa persistait — exactement le
  // scénario reproduit ici. MAINTENANT : cron:liveIds (Set Redis) retient tout
  // match qu'on a VU live à un moment (ajouté dès LIVE_ESPN, retiré seulement
  // une fois FINAL/POSTPONED/CANCELED confirmé) — tant qu'il contient au moins
  // un match, on n'arme JAMAIS ces 2 optimisations, même si LE FETCH DE CETTE
  // PASSE PRÉCISE ne montre rien de live. Le coût : dans le pire cas, quelques
  // minutes de fetch ESPN "pour rien" de plus après la vraie fin d'un match
  // (le temps que FINAL_ESPN soit confirmé) — largement acceptable face au
  // risque de rater des buts en direct.
  let stillTrackingLive = 0
  try { stillTrackingLive = await kv.scard('cron:liveIds') } catch {}

  // ⚠️ AJOUT (question utilisateur : "pourquoi revérifier toutes les 25min
  // alors qu'il n'y a plus de match jusqu'au lendemain ou plusieurs jours
  // après ?") : ce calcul se basait sur allEvents.length — TOUT ce qu'ESPN
  // liste aujourd'hui/hier, y COMPRIS les matchs déjà entièrement traités et
  // clos (finalDone posé, plus aucun but/carton/recap à en tirer). Un match
  // fini la veille reste listé par ESPN dans sa fenêtre "yesterday" jusqu'à
  // ~24-48h après sa vraie fin — pendant tout ce temps, allEvents.length
  // restait > 0 à cause de lui SEUL, forçant une revérification toutes les
  // 25min (nextCheckKey) au lieu de passer au mode économie 3h (emptyDayKey)
  // dès qu'il n'y a plus RIEN à surveiller activement. activeEvents réutilise
  // alreadyDoneIds (déjà calculé plus haut pour le pré-filtre de la boucle
  // principale, donc AUCUNE lecture Redis supplémentaire ici) pour exclure
  // ces matchs clos du calcul — "plus rien à faire aujourd'hui" est détecté
  // dès la confirmation FINAL de tous les matchs du jour, pas seulement quand
  // ESPN cesse de les lister des heures/jours plus tard.
  const activeEvents = allEvents.filter(({ evt }) => !alreadyDoneIds.has(evt.id))

  if (stillTrackingLive === 0) {
    if (activeEvents.length === 0 && !espnFetchFailed) {
      try { await kv.set(emptyDayKey, '1', { ex: EMPTY_DAY_TTL }) } catch {}
    } else if (activeEvents.length > 0 && !espnFetchFailed) {
      const anyLive = activeEvents.some(({ evt }) =>
        LIVE_ESPN.has(normalizeEspnStatus(evt.competitions?.[0]?.status)))
      if (!anyLive) {
        const upcomingKickoffs = activeEvents
          .filter(({ evt }) => normalizeEspnStatus(evt.competitions?.[0]?.status) === 'STATUS_SCHEDULED')
          .map(({ evt }) => Date.parse(evt.date))
          .filter(t => Number.isFinite(t))
        const nextKickoff = upcomingKickoffs.length ? Math.min(...upcomingKickoffs) : null
        const farEnough = nextKickoff == null || (nextKickoff - now.getTime()) > NEXT_CHECK_BUFFER_MS
        if (farEnough) {
          const skipCandidate = nextKickoff != null
            ? Math.min(nextKickoff - NEXT_CHECK_BUFFER_MS, now.getTime() + NEXT_CHECK_MAX_MS)
            : now.getTime() + NEXT_CHECK_MAX_MS
          try { await kv.set(nextCheckKey, skipCandidate, { ex: Math.ceil(NEXT_CHECK_MAX_MS / 1000) + 60 }) } catch {}
        }
      }
    }
  }

  // Attendu en tout dernier, après TOUT le reste de la passe (armement des
  // optimisations inclus juste au-dessus) — voir recheckFinalMatch/
  // pendingFinalRechecks plus haut : n'affecte l'ordre/timing d'AUCUNE
  // logique existante, prolonge seulement la durée totale de CETTE passe de
  // ~18s quand un match vient de flasher FINAL pour la 1ère fois (rare — une
  // fois par match). Le Cron Trigger suivant se déclenche de toute façon sur
  // son propre horaire, indépendamment de la fin de cette passe.
  if (pendingFinalRechecks.length > 0) {
    await Promise.allSettled(pendingFinalRechecks)
  }

  return { events: allEvents.length, log }
}

// ⚠️ AJOUT (même contexte que le log ci-dessus, quota Upstash 1,4M/500K) :
// lastRun/lastResult ne servent qu'au diagnostic (/api/debug-push, staleness
// "depuis combien de temps le Worker tourne encore") — une précision à la
// minute près n'apporte rien de plus qu'une précision à 5min près pour cet
// usage (détecter que le Worker s'est complètement arrêté, pas un monitoring
// fin). N'écrire qu'1 minute sur 5 divise ce coût par 5 (~86K → ~17K
// commandes/mois à elles deux) SANS lecture Redis supplémentaire pour décider
// (gate purement local sur l'horloge, aucun coût ajouté) — au pire 5min de
// retard sur l'affichage debug, sans aucun effet sur les notifs/détection.
// ⚠️ REVU (investigation "~10K commandes un jour sans match") : même
// raisonnement poussé plus loin — 15min de retard max sur un diagnostic qui
// sert uniquement à détecter "le Worker s'est arrêté depuis combien de
// temps" reste largement suffisant (personne ne consulte ça en temps réel,
// et un vrai arrêt du Worker se voit de toute façon dans les minutes qui
// suivent, pas besoin de précision à 5min près pour ça). ~17K → ~5,8K
// commandes/mois à elles deux, sans aucun changement fonctionnel.
function shouldWriteDebugBookkeeping() {
  return new Date().getMinutes() % 15 === 0
}

// ⚠️ AJOUT (03/08, demande utilisateur : réduire les commandes Upstash SANS
// toucher à la latence du direct) : cacheEspnSummary (voir plus haut) écrit
// espn:summary:{slug}:{eventId} dans Redis à CHAQUE passe (1min) pour CHAQUE
// match en direct — mais ce n'est qu'un pré-chauffage de secours. La vraie
// fraîcheur pour un spectateur actif vient d'ailleurs : api/espn.js relit
// CETTE MÊME clé avec son propre TTL de 15s pour un match en cours
// (LIVE_SUMMARY_CACHE_TTL) et refait un fetch ESPN dès qu'elle expire, à
// chaque requête client (poll 10-30s, voir CLAUDE.md) — indépendamment de ce
// Worker. cacheEspnSummary ne sert donc qu'à garder une copie "pas trop
// vieille" pour le tout premier visiteur d'un match sans spectateur récent —
// aucun rapport avec la détection buts/cartons/score (le pipeline juste
// au-dessus, states/trackKey/cardTrackKey, reste à 1min, jamais touché ici)
// ni avec les notifs push. Espacer à 1 passe sur 2 (paire uniquement) coupe
// ce poste en 2 pendant les jours de match, avec un pré-chauffage encore
// largement assez frais (≤2min) pour ce rôle de secours — gate purement
// local sur l'horloge (même pattern que shouldWriteDebugBookkeeping
// ci-dessus), zéro lecture Redis supplémentaire pour décider.
function shouldRefreshSummary() {
  return new Date().getMinutes() % 2 === 0
}

// ⚠️ AJOUT (question utilisateur : "225K/500K commandes Upstash alors qu'il y
// a eu des matchs en continu depuis début août, faut optimiser") : contrairement
// à cacheEspnSummary/warmFdCache/shouldWriteDebugBookkeeping ci-dessus (déjà
// espacés), pushLiveTicker (score en direct silencieux, filtré par club
// favori — voir plus bas dans la boucle) tournait encore à CHAQUE passe (1min),
// pour CHAQUE match en direct, sans aucun espacement — 1 appel Vercel + au
// moins 1 lecture Redis (smembers push:subscriptions) par match live et par
// minute, même si personne ne suit ce match en favori. Espacé à 1 passe sur 2,
// même pattern que shouldRefreshSummary : coupe ce poste en 2 les jours de
// match chargés (plusieurs matchs simultanés). Contrepartie honnête, à
// distinguer du reste : CETTE fonctionnalité EST directement visible par
// l'utilisateur (le badge de notif "score en direct" silencieux, tray
// Android/iOS) — son rafraîchissement passe de 1min à 2min. Les vraies
// alertes (but/carton/mi-temps/fin, notifyVercel plus haut) ne sont PAS
// concernées, restent instantanées comme avant — seul ce ticker de fond
// ralentit légèrement.
function shouldSendLiveTicker() {
  return new Date().getMinutes() % 2 === 0
}

// ⚠️ AJOUT (28/08, optimisation latence notifs) : le Cron Trigger reste
// bloqué à 1 déclenchement/minute (plancher de la plateforme, tous plans
// confondus) — mais RIEN n'empêche de faire tourner runOnePass() plusieurs
// fois DANS la même invocation, avec une pause entre les deux (même
// technique que recheckFinalMatch un peu plus haut : un vrai `setTimeout`
// dans un `ctx.waitUntil`, le temps d'attente réseau ne compte pas dans le
// budget CPU facturé). Effet : un but détectable à la 2e passe au lieu
// d'attendre le tick suivant réduit la latence moyenne de détection d'environ
// moitié (~30s → ~15s en moyenne), sans invocation Worker supplémentaire et
// sans appel Vercel en plus (toujours uniquement si un vrai événement est
// détecté, logique de notifyVercel() totalement inchangée).
// Limité à 2 passes (pas 3+) après vérification d'une limite CONCRÈTE, pas
// juste le budget CPU : le plan gratuit Workers plafonne à 50 SOUS-REQUÊTES
// externes par invocation — et ce plafond compte À LA FOIS les fetchs ESPN
// ET les appels Upstash Redis (le client Redis fait lui aussi un fetch HTTP
// par commande), pas seulement le réseau "visible". Une passe chargée (
// plusieurs matchs suivis, plusieurs slugs ESPN, événements à notifier) peut
// déjà consommer une part non négligeable de ces 50 — tripler ce coût
// (3 passes) ferait courir un vrai risque de dépasser le plafond pendant les
// moments les plus chargés, c'est-à-dire exactement quand la fiabilité
// compte le plus. 2 passes reste un gain réel et concret tout en gardant une
// marge de sécurité raisonnable. À confirmer/ajuster après un vrai match
// chargé (métriques Cloudflare → Workers → sous-requêtes par invocation).
const PASS_SPACING_MS = 25_000

async function handlePass(env) {
  const kv = new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN })
  env._kv = kv
  const writeBookkeeping = shouldWriteDebugBookkeeping()
  if (writeBookkeeping) {
    try { await kv.set('cron:goals:lastRun', Date.now(), { ex: 7 * 24 * 3600 }) } catch {}
  }

  let combinedEvents = 0
  let combinedLog    = []
  let lastResult      = null

  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await new Promise(resolve => setTimeout(resolve, PASS_SPACING_MS))
    lastResult = await runOnePass(env)
    combinedEvents += lastResult.events
    combinedLog = combinedLog.concat(lastResult.log)
    // Journée/minute confirmée "rien à suivre" (voir les 2 early-return dans
    // runOnePass) : une 2e passe ne changerait rien (mêmes clés de skip
    // encore valides 25s plus tard) — inutile de payer son coût (même
    // minime) pour ce cas, de très loin le plus fréquent.
    if (lastResult.quiet) break
  }

  // Préchauffage FD.org (voir warmFdCache) — volontairement INDÉPENDANT de la
  // logique ESPN ci-dessus (early-return "aucun match aujourd'hui" incluse) :
  // Programme/Résultats/Classement sont consultés par les visiteurs même les
  // jours sans match en direct, donc ce préchauffage doit tourner tout le
  // temps, pas seulement pendant les fenêtres où le direct est actif.
  // Une seule fois par invocation (pas une fois par passe) : pas de rapport
  // avec le nombre de passes ESPN ci-dessus.
  await warmFdCache(combinedLog, kv, lastResult.quiet)

  if (writeBookkeeping) {
    try {
      await kv.set('cron:goals:lastResult', JSON.stringify({
        at: Date.now(), events: combinedEvents, source: 'cf-worker',
      }), { ex: 7 * 24 * 3600 })
    } catch {}
  }

  try {
    if (combinedLog.length) {
      const stamped = combinedLog.map(l => `${new Date().toISOString()} ${l}`)
      await kv.rpush('cron:goals:logHistory', ...stamped)
      await kv.ltrim('cron:goals:logHistory', -30_000, -1)
      await kv.expire('cron:goals:logHistory', 4 * 24 * 3600)
    }
  } catch {}

  return { events: combinedEvents, log: combinedLog, quiet: lastResult.quiet }
}

// ── Préchauffage cache FD.org (Programme/Résultats/Classement) ─────────────
// CONTEXTE (demande utilisateur, 23/07 — "si plusieurs personnes consultent
// l'app en même temps faudrait trouver une solution") : le budget FD.org
// partagé (8/min, voir MINUTE_CAP dans api/football.js) peut être épuisé
// pile au moment où un visiteur demande une requête JAMAIS encore mise en
// cache — dans ce cas précis, aucune copie stale n'existe pour servir de
// secours, la requête échoue dur (403/429 visible côté utilisateur). Plus il
// y a de visiteurs simultanés, plus ce cas devient probable.
//
// Solution : ce Worker (déjà actif chaque minute, gratuit, coût CPU quasi
// nul — le réseau ne compte pas dans le budget Cloudflare) rafraîchit
// PROACTIVEMENT, en tournante, les requêtes FD.org les plus demandées — une
// copie récente existe alors TOUJOURS en cache avant qu'un visiteur la
// demande, quel que soit le nombre de visiteurs simultanés. Appelle notre
// PROPRE /api/football (jamais FD.org directement) : passe par le même
// budget/circuit-breaker que les vrais utilisateurs, aucun chemin parallèle
// qui contournerait la protection existante.
//
// Liste limitée aux 6 grands championnats (FL1/PL/PD/BL1/SA/CL) × 2
// endpoints (calendrier+résultats fusionnés, classement) — la combinaison la
// plus consultée (Programme/Résultats/Classement). WC/EC/coupes nationales
// hors périmètre pour l'instant (trafic plus faible, moins exposées au
// problème).
// ⚠️ CORRIGÉ (constat utilisateur, 24/07 : "Programme LaLiga affiche Veuillez
// réessayer quelques secondes après un retour sur la page, pas les autres
// championnats") — Programme et Résultats ont été fusionnés le même jour en
// UN SEUL appel FD.org par compét (`/matches?season=X`, SANS `status=`, voir
// useMatchs.js fetchMatchesForComp) pour partager la même clé de cache Redis
// serveur. Cette liste ici n'avait PAS été mise à jour en même temps : elle
// continuait à préchauffer les 2 ANCIENNES clés (`status=FINISHED` et
// `status=SCHEDULED`), qui ne sont plus jamais demandées par personne depuis
// la fusion — la VRAIE clé désormais utilisée (`season=X`, sans status)
// n'était donc jamais préchauffée par ce Worker, et dépendait entièrement du
// trafic utilisateur réel pour obtenir sa toute première copie de secours
// ("stale", voir api/football.js) — si son tout premier appel réel tombait
// pile pendant un blocage FD.org (voir incidents 403 documentés le même
// jour), aucun filet de secours n'existait encore pour elle, contrairement
// aux clés plus anciennes déjà préchauffées depuis des mois. Remplacé les 2
// entrées `status=` par la vraie clé fusionnée.
function getClubSeasonWarm() {
  const now = new Date()
  const month = now.getUTCMonth() + 1
  const year = now.getUTCFullYear()
  return month <= 7 ? year - 1 : year
}
// ⚠️ 2e CORRECTIF le même jour (constat utilisateur : "Résultats charge,
// Programme jamais, même après le 1er correctif ci-dessus") — le 1er
// correctif ne réchauffait QUE `season=X`. Or fetchMatchesForComp
// (useMatchs.js) fait un 2e essai SANS season du tout dès que le résultat
// filtré du 1er essai est vide pour le statut demandé — exactement le cas de
// Programme (SCHEDULED) en ce moment : `season=X` (la saison qui vient de
// finir) ne contient QUE des matchs FINISHED, donc Programme est TOUJOURS
// obligé de retomber sur le repli sans season pour trouver les matchs à
// venir. Résultats (FINISHED), lui, est déjà satisfait par `season=X` seul —
// il n'atteint donc JAMAIS ce repli, qui reste une clé de cache Redis
// totalement différente et jamais préchauffée. D'où l'asymétrie observée :
// Résultats toujours bon, Programme jamais. Les deux URLs (avec ET sans
// season) sont maintenant préchauffées pour ne plus dépendre de qui, de
// Programme ou Résultats, "gagne la course" pour warmer la bonne clé.
// ⚠️ BUG TROUVÉ ET CORRIGÉ (retour utilisateur, log réel : tous les appels
// `season=1969`, échec systématique 403/404 depuis des heures) : FD_WARM_LIST
// est un `const` de PORTÉE MODULE — évalué UNE SEULE FOIS, au chargement du
// script par l'isolate Cloudflare, jamais réévalué ensuite. `getClubSeasonWarm()`
// était appelée directement DANS cette évaluation, donc `new Date()` s'exécutait
// à ce moment précis — hors de tout event/handler. Cloudflare Workers ne
// garantit PAS l'heure réelle pour `Date`/`Date.now()` en dehors d'un handler
// (fetch/scheduled) : par mesure de sécurité (anti timing side-channel), le
// scope module peut voir une horloge figée à l'epoch Unix (1970) — d'où
// `getUTCFullYear() - 1 = 1969`, gelé pour toute la durée de vie de l'isolate
// (potentiellement des heures/jours). Fix : season calculée PARESSEUSEMENT,
// à l'intérieur de warmFdCache() (appelée depuis handlePass(), donc dans le
// contexte réel du scheduled() handler — Date y est fiable). FD_WARM_LIST ne
// stocke plus qu'un marqueur `dynamicSeason: true`, résolu au moment de l'appel.
const FD_WARM_COMPS = ['FL1', 'PL', 'PD', 'BL1', 'SA', 'CL']
const FD_WARM_LIST = FD_WARM_COMPS.flatMap(id => [
  { apiPath: `/v4/competitions/${id}/matches`, qs: '', dynamicSeason: true },
  { apiPath: `/v4/competitions/${id}/matches`, qs: '' },
  { apiPath: `/v4/competitions/${id}/standings`, qs: '' },
])
const FD_WARM_BASE_URL = 'https://statfootix.vercel.app/api/football'

// Construit l'URL de préchauffage — résout dynamicSeason ICI (temps réel,
// dans le contexte du handler), jamais au chargement du module. Voir
// commentaire ci-dessus sur FD_WARM_LIST.
function buildWarmUrl({ apiPath, qs, dynamicSeason }) {
  const effectiveQs = dynamicSeason ? `season=${getClubSeasonWarm()}` : qs
  return `${FD_WARM_BASE_URL}?apiPath=${encodeURIComponent(apiPath)}${effectiveQs ? `&${effectiveQs}` : ''}`
}

// ⚠️ AJOUT (24/07, demande utilisateur : "un vrai dispositif" pour ne plus
// jamais se prendre de 429 FD.org) : la rotation aveugle ci-dessous protège
// les 18 clés "en moyenne" sur un cycle de 36min, mais un match qui vient de
// finir peut laisser Programme/Résultats/Classement de SA compétition à
// découvert jusqu'à 34min avant que la rotation ne repasse dessus par hasard
// — exactement le genre de trou qui a produit un vrai 429 (constat
// utilisateur, switch LaLiga→Serie A). Ce Worker sait déjà, À LA MINUTE
// PRÈS, quand un match finit VRAIMENT (isFinalConfirmed dans runOnePass,
// même garde-fou anti-faux-positif que la notif "Fin de match") — on
// réutilise ce signal : dès qu'un match d'une des 6 ligues suivies par
// FD.org (voir FD_WARM_COMPS) se termine, ses clés (calendrier ×2 +
// classement) passent en PRIORITÉ dans les prochains ticks de warmFdCache,
// à la place de la rotation aveugle — au lieu d'attendre le hasard du cycle.
// Toujours 1 seul vrai appel FD.org par minute au maximum (même discipline
// qu'avant), juste mieux ciblé sur ce qui vient RÉELLEMENT de changer plutôt
// que sur une rotation fixe déconnectée des vrais événements du jour.
const FD_SLUG_TO_WARM_COMP = {
  'fra.1': 'FL1', 'eng.1': 'PL', 'esp.1': 'PD', 'ger.1': 'BL1', 'ita.1': 'SA', 'uefa.champions': 'CL',
}
const FD_PRIORITY_QUEUE_KEY = 'fd:warmPriority'

// Appelé depuis runOnePass juste après un FT confirmé (voir isFinalConfirmed) —
// met en file les index FD_WARM_LIST (calendrier + classement) de la
// compétition concernée, pour que warmFdCache les traite avant la rotation
// aveugle. Pas d'effet pour WC/EC (endpoint dateFrom/dateTo différent, voir
// useTodayMatches.js — hors scope de FD_WARM_LIST) ni pour une compétition
// non couverte par FD.org (NL/CAN/COPA/UEL/UECL, ESPN pur) — `comp` est alors
// `undefined` et la fonction ne fait rien.
async function queueFdPriorityRefresh(kv, slug, log) {
  const comp = FD_SLUG_TO_WARM_COMP[slug]
  if (!comp || !kv) return
  try {
    const indices = FD_WARM_LIST
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) =>
        entry.apiPath === `/v4/competitions/${comp}/matches` ||
        entry.apiPath === `/v4/competitions/${comp}/standings`)
      .map(({ i }) => i)
    if (indices.length === 0) return
    await kv.rpush(FD_PRIORITY_QUEUE_KEY, ...indices.map(String))
    // Garde-fou anti-croissance illimitée (ne devrait normalement jamais
    // dépasser ~18 vu le nombre fini de clés possibles) — même pattern que
    // cron:goals:logHistory plus haut dans ce fichier.
    await kv.ltrim(FD_PRIORITY_QUEUE_KEY, -60, -1)
    await kv.expire(FD_PRIORITY_QUEUE_KEY, 3600)
    log.push(`[fd-warm:queue] ${comp} → ${indices.length} clé(s) mise(s) en priorité (FT confirmé)`)
  } catch (e) {
    log.push(`[fd-warm:queue] error=${e.message}`)
  }
}

// Un seul élément traité par tick (1min) au maximum : soit une clé en attente
// suite à un vrai FT (queueFdPriorityRefresh ci-dessus), soit — file vide —
// l'entrée suivante de la rotation aveugle habituelle (aligné sur le TTL
// serveur le plus court, FINISHED=120s — voir getTtl() dans api/football.js).
// Rotation déterministe basée sur l'horloge (pas besoin de state Redis dédié)
// pour le cas passif : cycle complet de la liste (18 entrées, 6 compét × 3 :
// matches avec season, matches sans season, standings) en 36min. Consomme au
// pire 1 des 8 créneaux/min disponibles par tick, jamais plus — impact
// négligeable sur le budget partagé avec les vrais utilisateurs même les
// jours de match chargés (plusieurs FT à la même minute se drainent sur les
// ticks suivants, pas d'un coup).
// ⚠️ AJOUT (03/08, demande utilisateur : "le jour où y'a pas de match y'a
// déjà 100k commandes cramées, comment optimiser sans casser le direct") —
// AVANT ce fix, seule la rotation aveugle plus bas était déjà espacée à 1
// tick sur 2 (voir `now.getMinutes() % 2`) — mais le kv.lpop(priorityQueue)
// juste en dessous tournait, lui, à CHAQUE minute, INCONDITIONNELLEMENT,
// 1440 fois/jour, MÊME les jours sans un seul match qui se termine (donc la
// file d'attente reste vide en permanence — cas de très loin le plus
// fréquent hors saison/période creuse). Coût : ~1440 commandes Redis/jour
// (~43K/mois) pour vérifier une file quasi toujours vide. Alignée sur LE
// MÊME gate horloge que la rotation juste en dessous (déjà en place, déjà
// jugé sans risque pour Programme/Résultats/Classement — TTL le plus court
// 120s largement au-dessus de 2min) : au pire, un match qui vient de finir
// attend jusqu'à 1min de plus avant que SA priorité soit traitée — sans
// aucun rapport avec le direct (score/buts/notifs, gérés entièrement par le
// pipeline runOnePass ci-dessus, jamais touché ici) — juste un délai
// négligeable sur la fraîcheur de Résultats/Classement juste après un FT.
// ⚠️ AJOUT (question utilisateur : "pourquoi ça coûte encore des milliers de
// commandes des jours ENTIERS sans le moindre match, même les heures sans
// rien en direct ?") : ce préchauffage tourne INCONDITIONNELLEMENT 24h/24
// (voir commentaire en tête de handlePass — Programme/Résultats/Classement
// sont consultés même sans match en direct, donc ce warm ne peut pas dépendre
// de l'optimisation "jour vide" ci-dessus). Espacé 1 tick sur 2 (2min) le
// 03/08 ; repassé à 1 tick sur 4 (4min) ici — double la marge par rapport à
// avant. Contrepartie honnête : le TTL le plus court protégé (FINISHED/
// standings, 120s) est désormais plus court que ce cycle de préchauffage —
// une clé peut donc rester stale jusqu'à ~2min de plus avant d'être
// rafraîchie PROACTIVEMENT. Sans risque de casse pour autant : ce préchauffage
// n'est qu'un FILET DE SECOURS (voir commentaire plus haut, "copie stale
// servie en secours") — un vrai visiteur qui tombe sur une clé pas encore
// rechauffée déclenche simplement son propre vrai appel FD.org (protégé par
// le même budget/circuit-breaker que d'habitude, voir api/football.js), au
// lieu d'un cache HIT instantané — juste un peu de latence en plus dans ce
// cas précis (rare), jamais d'erreur/429 nouveau.
// ⚠️ AJOUT (investigation : "~10K commandes Upstash un mardi SANS aucun
// match") : ce warm tournait à la même cadence (1 tick/4min, 24h/24) qu'il y
// ait match ou non — alors que runOnePass SAIT déjà, sans lecture Redis
// supplémentaire (résultat déjà calculé, voir `quiet` sur les 2 early-return
// du skip-fast-path ci-dessus), quand la journée est confirmée sans match ni
// reprise imminente. Programme/Résultats/Classement ne bougent pas entre 2
// matchs — pas besoin de les réchauffer aussi souvent dans ce cas précis.
// Cadence ralentie à 1 tick/30min (au lieu de 4min) quand `quiet` est vrai :
// divise ce poste par 7,5 les jours creux (lpop file de priorité + fetch
// warm → ~6-8 commandes Redis côté api/football.js à chaque tick, voir son
// rate-limit/cache), sans aucun effet les jours de match (`quiet` redevient
// faux dès qu'un match est suivi ou programmé sous peu — TTL le plus court
// protégé, 120s, reste largement couvert par les 2 cadences). 30min plutôt
// qu'un intervalle encore plus long : un jour "quiet" reste réversible à tout
// moment (nouveau match ajouté au calendrier en dernière minute, voir
// emptyDayKey plus haut) — on garde une marge de fraîcheur raisonnable pour
// le tout premier visiteur de la journée, plutôt que de pousser l'économie
// au maximum théorique au prix d'un 1er chargement plus souvent en cache MISS.
function shouldWarmFdCache(quiet) {
  const m = new Date().getMinutes()
  return quiet ? m % 30 === 0 : m % 4 === 0
}

async function warmFdCache(log, kv, quiet) {
  try {
    if (kv && shouldWarmFdCache(quiet)) {
      try {
        const queued = await kv.lpop(FD_PRIORITY_QUEUE_KEY)
        if (queued != null) {
          const idx = Number(queued)
          if (Number.isInteger(idx) && FD_WARM_LIST[idx]) {
            const entry = FD_WARM_LIST[idx]
            const url = buildWarmUrl(entry)
            const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
            if (!res.ok) log.push(`[fd-warm:priority:${entry.apiPath}] status=${res.status} url=${url}`)
            else log.push(`[fd-warm:priority:${entry.apiPath}] ok`)
            return
          }
        }
      } catch (e) { log.push(`[fd-warm:priority] error=${e.message}`) }
    }

    if (!shouldWarmFdCache(quiet)) return
    const idx = Math.floor(Date.now() / 240_000) % FD_WARM_LIST.length
    const entry = FD_WARM_LIST[idx]
    const url = buildWarmUrl(entry)
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) log.push(`[fd-warm:${entry.apiPath}] status=${res.status} url=${url}`)
  } catch (e) {
    log.push(`[fd-warm] error=${e.message}`)
  }
}

// Comparaison constant-time (audit sécurité, cohérent avec safeCompare côté
// Vercel dans api/debug-push.js / api/cron-goals.js). Le runtime Worker n'a
// pas node:crypto (donc pas crypto.timingSafeEqual) — implémentation manuelle :
// on compare TOUJOURS la longueur du secret attendu (jamais la longueur reçue,
// qui pourrait fuiter via son propre timing) et on XOR chaque caractère sans
// sortir en avance sur une différence, pour ne pas laisser le temps de réponse
// varier selon où survient le premier caractère différent.
function safeCompare(received, expected) {
  let diff = received.length === expected.length ? 0 : 1
  const len = expected.length
  for (let i = 0; i < len; i++) {
    diff |= (received.charCodeAt(i) || 0) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handlePass(env))
  },
  // Handler HTTP manuel — pratique pour tester/déclencher une passe à la main
  // pendant le déploiement, protégé par le même secret que Vercel.
  async fetch(req, env) {
    const url = new URL(req.url)
    const secret = url.searchParams.get('secret') ?? req.headers.get('x-cron-secret') ?? ''
    if (!env.CRON_SECRET || !safeCompare(secret, env.CRON_SECRET)) {
      return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 })
    }
    const result = await handlePass(env)
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
