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
import { ESPN_SLUG_BY_COMP_ID } from '../../src/data/espnSlugs.js'
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

const ESPN_SLUGS = Object.values(ESPN_SLUG_BY_COMP_ID)
const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const FIFA_LIVE_URL = 'https://api.fifa.com/api/v3/live/football'

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

async function fetchEspnEvents(slug, date, log) {
  try {
    const r = await fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${date}&limit=100`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) { log.push(`[espn:${slug}] status=${r.status}`); return [] }
    const j = await r.json()
    return j.events ?? []
  } catch (e) {
    log.push(`[espn:${slug}] error=${e.message}`)
    return []
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

async function recheckFinalMatch(env, kv, slug, eventId, expectedScore, homeTeam, awayTeam, scoreStr, log) {
  await new Promise(resolve => setTimeout(resolve, FINAL_RECHECK_DELAY_MS))
  try {
    const today     = dateStr(new Date())
    const yesterday = dateStr(new Date(Date.now() - 86_400_000))
    const [evtsToday, evtsYesterday] = await Promise.all([
      fetchEspnEvents(slug, today, log),
      fetchEspnEvents(slug, yesterday, log),
    ])
    const evt = [...evtsToday, ...evtsYesterday].find(e => e.id === eventId)
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
    try { await kv.set(`cron:espn:${eventId}`, `${status}|${freshScore}`, { ex: 12 * 3600 }) } catch {}
    // Clos définitivement — voir finalDoneKey en tête de boucle dans runOnePass
    // (bug corrigé : notifs "Fin de match" répétées des heures après la vraie fin).
    try { await kv.set(`finalDone:${eventId}`, '1', { ex: FINAL_DONE_TTL }) } catch {}
    await notifyVercel(env, `push:espn:ft:${eventId}`,
      { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, {}, log, FINAL_DONE_TTL)
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
      headers: { 'Cache-Control': 'no-cache' },
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

// Envoi réel vers Vercel — extrait de notifyVercel ci-dessous, inchangé.
async function sendToVercel(env, payload, slug, options = {}, log = null) {
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
    if (!res.ok) log?.push(`[notify→vercel] status=${res.status}`)
  } catch (e) {
    log?.push(`[notify→vercel] error=${e.message}`)
  }
}

// Inchangé pour TOUS les appelants existants (goal/goalcancel/red/ht/reprise/
// ft) : acquiert le dédup puis envoie, exactement comme avant — seule la
// mécanique interne a été découpée en 2 fonctions réutilisables séparément.
async function notifyVercel(env, dedupKey, payload, slug, options = {}, log = null, ttl = 3 * 3600) {
  const acquired = await acquireDedup(env._kv, dedupKey, ttl)
  if (!acquired) return
  await sendToVercel(env, payload, slug, options, log)
}

// Ticker live (score en direct) : PAS de dédup (même tag remplace côté SW à
// chaque minute, voir api/cron-goals.js d'origine), donc appelle Vercel
// directement sans passer par notifyVercel() (qui exige une clé de dédup).
async function pushLiveTicker(env, payload, slug, log) {
  try {
    const res = await fetch(env.VERCEL_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': env.CRON_SECRET },
      body: JSON.stringify({ mode: 'notify', payload, slug, options: { onlyFavorites: true, urgency: 'high' } }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) log?.push(`[ticker→vercel] status=${res.status}`)
  } catch (e) {
    log?.push(`[ticker→vercel] error=${e.message}`)
  }
}

// ── Une passe complète (équivalent runOnePass() de api/cron-goals.js) ──────
async function runOnePass(env) {
  const kv = env._kv
  const log      = []
  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))

  const emptyDayKey = 'cron:emptyDay'
  const nextCheckKey = 'cron:nextCheck'
  const NEXT_CHECK_BUFFER_MS = 90 * 60 * 1000
  const NEXT_CHECK_MAX_MS    = 25 * 60 * 1000

  // Garde-fou (audit bug notifs groupées) : si on suit encore un match vu
  // live sans confirmation de fin (cron:liveIds non vide), on ignore les 2
  // clés de skip ci-dessous même si l'une d'elles était déjà armée — un
  // match en cours qu'on connaît prime toujours sur une optimisation "aucun
  // match" potentiellement erronée.
  let trackingLiveAtStart = 0
  try { trackingLiveAtStart = await kv.scard('cron:liveIds') } catch {}

  if (trackingLiveAtStart === 0) {
    let knownEmpty = false
    try { knownEmpty = !!(await kv.get(emptyDayKey)) } catch {}
    if (knownEmpty) {
      return { events: 0, log: ['jour sans match connu (re-check <20min) — fetch ESPN sauté'] }
    }

    let skipUntil = null
    try { skipUntil = await kv.get(nextCheckKey) } catch {}
    if (skipUntil && Number(skipUntil) > now.getTime()) {
      return { events: 0, log: [`aucun match en direct/imminent — fetch ESPN sauté`] }
    }
  }

  const allResults = await Promise.allSettled(
    ESPN_SLUGS.flatMap(slug => [
      fetchEspnEvents(slug, today,     log).then(evts => evts.map(e => ({ slug, evt: e }))),
      fetchEspnEvents(slug, yesterday, log).then(evts => evts.map(e => ({ slug, evt: e }))),
    ])
  )
  const allEvents = allResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])

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

  for (const { slug, evt } of allEvents) {
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

    if (isLive) {
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
    try {
      if (stayTrackedAsLive) await kv.sadd('cron:liveIds', String(eventId))
      else await kv.srem('cron:liveIds', String(eventId))
    } catch (e) {
      log.push(`[cron:liveIds:${eventId}] error=${e.message}`)
    }

    // 🔴 Coup d'envoi — dédup déjà tenté ci-dessus (pipeline) : on n'envoie
    // que si on vient vraiment de l'acquérir, comportement identique à avant.
    if (isLive && notPostponed && koAcquired) {
      await sendToVercel(env,
        { title: "🔴 Coup d'envoi !", body: `${homeTeam} – ${awayTeam}`, url: '/live' }, slug, {}, log)
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} KO (confirmé ESPN)`)
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
          await notifyVercel(env, `push:espn:goalcancel:${eventId}:${side}:${newCount}`,
            { title: `❌ But annulé (${scoringTeam})`, body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live', matchId: eventId, tag: `goal-cancel-${eventId}-${side}-${newCount}` }, slug, {}, log)
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
            await notifyVercel(env, `push:espn:goal:${eventId}:${side}:${goalIndex + 1}`,
              { title: goalTitle, body: goalBody, url: '/live', matchId: eventId, tag: `goal-${eventId}-${side}-${goalIndex + 1}` }, slug, {}, log)
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
          await notifyVercel(env, `push:espn:red:${eventId}:${side}:${cardTrack[side] + 1}`,
            { title: '🟥 Carton rouge', body: `${card.name} (${teamName})${minuteText ? ` — ${minuteText}` : ''}`, url: '/live' }, slug, {}, log)
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
        { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, {}, log)
    }

    // ▶️ Reprise 2ème MT
    if (prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_IN_PROGRESS') {
      log.push(`[espn:${slug}:${eventId}] reprise`)
      await notifyVercel(env, `push:espn:2h:${eventId}`,
        { title: '▶️ Reprise !', body: `2ème MT · ${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, {}, log)
    }

    // 🏁 Fin de match — seulement une fois CONFIRMÉ (2e passe FINAL
    // consécutive, score inchangé — voir finalConfirmKey/isFinalConfirmed
    // plus haut). Sur la 1ère passe FINAL (potentiel glitch ESPN, ex. temps
    // additionnel confondu avec la fin), on ne notifie PAS encore — juste
    // au cas où la passe suivante infirme ce statut.
    if (isFinalConfirmed) {
      log.push(`[espn:${slug}:${eventId}] FT (confirmé)`)
      // Clos définitivement — voir finalDoneKey en tête de boucle (bug corrigé :
      // notifs "Fin de match" répétées des heures après la vraie fin, tant
      // qu'ESPN continuait à lister le match FINAL et que finalConfirmKey
      // (TTL 5min) se ré-armait entretemps).
      try { await kv.set(finalDoneKey, '1', { ex: FINAL_DONE_TTL }) } catch {}
      await notifyVercel(env, `push:espn:ft:${eventId}`,
        { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, {}, log, FINAL_DONE_TTL)
      await cacheEspnSummary(kv, slug, eventId, log)
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
          recheckFinalMatch(env, kv, slug, eventId, score, homeTeam, awayTeam, scoreStr, log)
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

    // 📊 Ticker "score en direct" — pas de dédup (même tag, remplace côté SW)
    if (isLive) {
      const mLabel = status === 'STATUS_HALFTIME' ? 'Mi-temps' : `${comp.status?.displayClock ?? ''}`.trim()
      await pushLiveTicker(env, {
        title: `${homeTeam} ${scoreStr} ${awayTeam}`,
        body:  mLabel ? `⏱ ${mLabel}` : 'En direct',
        url:   '/live',
        matchId: eventId,
        tag:     `live-${eventId}`,
        silent:  true,
        renotify: false,
      }, slug, log)
    }
   } catch (e) {
     log.push(`[espn:${slug}:${evt?.id ?? '?'}] ERREUR match ignoré : ${e.message}`)
   }
  }

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

  if (stillTrackingLive === 0) {
    if (allEvents.length === 0 && !espnFetchFailed) {
      try { await kv.set(emptyDayKey, '1', { ex: 20 * 60 }) } catch {}
    } else if (allEvents.length > 0 && !espnFetchFailed) {
      const anyLive = allEvents.some(({ evt }) =>
        LIVE_ESPN.has(normalizeEspnStatus(evt.competitions?.[0]?.status)))
      if (!anyLive) {
        const upcomingKickoffs = allEvents
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

async function handlePass(env) {
  const kv = new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN })
  env._kv = kv
  try { await kv.set('cron:goals:lastRun', Date.now(), { ex: 7 * 24 * 3600 }) } catch {}

  const result = await runOnePass(env)

  try {
    await kv.set('cron:goals:lastResult', JSON.stringify({
      at: Date.now(), events: result.events, source: 'cf-worker',
    }), { ex: 7 * 24 * 3600 })
  } catch {}

  try {
    if (result.log.length) {
      const stamped = result.log.map(l => `${new Date().toISOString()} ${l}`)
      await kv.rpush('cron:goals:logHistory', ...stamped)
      await kv.ltrim('cron:goals:logHistory', -30_000, -1)
      await kv.expire('cron:goals:logHistory', 4 * 24 * 3600)
    }
  } catch {}

  return result
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
    if (secret !== env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 })
    }
    const result = await handlePass(env)
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
