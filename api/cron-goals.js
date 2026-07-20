// api/cron/goals.js
// Appelé par cron-job.org toutes les minutes.
// Source : ESPN (primaire — couvre WC 2026 via 'fifa.world' + toutes ligues club)
//          FIFA live (couche rapide additionnelle, WC uniquement — voir plus bas)
//
// Détecte et notifie :
//   ⚽ But         — score change pendant un match en cours
//   🔴 Coup d'envoi — match démarre
//   ⏸  Mi-temps    — pause mi-temps
//   ▶️  Reprise     — reprise 2ème MT
//   🏁 Fin de match — match terminé
//
// ⚠️ FIX retard notif WC (~10min) : ESPN a un lag connu sur le slug 'fifa.world'
// (le statut scoreboard ESPN met du temps à passer SCHEDULED → IN_PROGRESS).
// api/fifa-live.js contourne déjà ça côté affichage live en croisant avec l'API
// FIFA officielle. On applique la même logique ici, uniquement pour les matchs WC :
// si ESPN dit encore SCHEDULED mais que FIFA confirme Period=1 (match démarré),
// on utilise le statut FIFA → notif coup d'envoi immédiate au lieu d'attendre ESPN.
//
// Sécurité : header "x-cron-secret" ou param ?secret= doit matcher CRON_SECRET.

import { Redis } from '@upstash/redis'
import webpush   from 'web-push'
import crypto    from 'crypto'
import { TEAM_NAMES_FR } from '../src/data/teamNames.js'
import { ESPN_SLUG_BY_COMP_ID } from '../src/data/espnSlugs.js'
// ⚠️ Ces fonctions vivaient ici en dur, puis ont été DUPLIQUÉES telles
// quelles dans cf-worker/src/index.js lors de la migration Cloudflare (voir
// CLAUDE.md, section Stack) — 2 copies identiques = risque de divergence si
// l'une est corrigée sans l'autre. Extraites dans src/utils/liveDetection.js
// (fonctions pures, aucune dépendance Node/Workers) comme source unique,
// importée ici ET par le Worker — voir ce fichier pour le détail de chaque
// fonction et les tests associés (liveDetection.test.js).
import {
  LIVE_ESPN, FINAL_ESPN, normalizeEspnStatus,
  fuzzyTeamFifa, fifaTeamNamesAll, fifaEffectiveStatus, fifaConfirmsShootoutOver,
  extractEspnScorers, extractEspnCards, generateRecap,
  minuteLabel, dateStr, parseMin, hasUsefulSummaryData,
} from '../src/utils/liveDetection.js'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// ── Config ESPN ────────────────────────────────────────────────────────────────
const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
// WC 2026 + toutes compétitions club couvertes par l'app.
// ⚠️ INCOHÉRENCE CORRIGÉE : cette liste était dupliquée ici ET dans
// api/fifa-live.js (sous forme d'un mapping id FD.org → slug, plus complet
// puisqu'il sert aussi au matching FD.org↔ESPN) — déplacée dans
// src/data/espnSlugs.js comme source unique, ce fichier n'en dérive plus
// qu'un tableau à plat (l'id FD.org ne sert à rien ici : le cron parcourt
// tous les événements ESPN sans les rattacher à un match FD.org précis).
const ESPN_SLUGS = Object.values(ESPN_SLUG_BY_COMP_ID)

// ── FIFA live — couche rapide WC (même cache Redis que api/fifa-live.js) ───────
const FIFA_LIVE_URL = 'https://api.fifa.com/api/v3/live/football'

async function fetchFifaLiveMatches(log) {
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
      signal:  AbortSignal.timeout(6_000),
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

// ── Traduction noms ESPN → français ───────────────────────────────────────────
// ⚠️ INCOHÉRENCE CORRIGÉE : une 2e table de clubs (TEAM_FR_CLUBS) faisait
// doublon avec TEAM_NAMES_FR (src/data/teamNames.js, déjà utilisée partout
// ailleurs dans l'app via translateTeam()). Vérifié : 28 des 63 clés de
// TEAM_FR_CLUBS existaient déjà dans TEAM_NAMES_FR, dont 4 avec une traduction
// DIFFÉRENTE (ex: "Crystal Palace" → "C. Palace" ici mais "Crystal Palace"
// partout ailleurs dans l'app) — donc une notif push pouvait afficher une
// abréviation différente de ce que montre le reste de l'app pour la même
// équipe. TEAM_FR_CLUBS utilisait en plus des clés en nom LONG ("Manchester
// City") alors que t() est appelé avec shortDisplayName en priorité ("Man
// City") : la plupart de ses entrées ne matchaient donc jamais. Supprimée au
// profit de TEAM_NAMES_FR seule, qui couvre déjà clubs + pays avec les bonnes
// clés (shortDisplayName) et reste l'unique source de vérité utilisée partout.
function t(name) { return TEAM_NAMES_FR[name] ?? name }

// ── Helpers ────────────────────────────────────────────────────────────────────

function setupVapid() {
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); return true }
  catch { return false }
}

async function fetchEspnEvents(slug, date, log) {
  try {
    // ⚠️ BUG MAJEUR TROUVÉ (preuve directe) : SANS &limit=100, ESPN renvoie pour
    // les matchs à élimination directe pas encore "affichés" par défaut des noms
    // d'équipe PLACEHOLDER de bracket ("Round of 32 5 Winner" au lieu de
    // "France") ET un statut/score figés à SCHEDULED/0-0 — vérifié en comparant
    // en direct la MÊME URL avec et sans ce paramètre pour le match France-
    // Paraguay (8e de finale) : sans limit=100 → noms placeholder ; avec
    // limit=100 → "France"/"Paraguay" corrects. C'est cette variante "placeholder"
    // que ce fetch recevait depuis le début, ce qui empêchait TOUT matching par
    // nom (fuzzyTeamFifa côté FIFA) de fonctionner pour ces matchs → aucune
    // notif (coup d'envoi/but) ne pouvait jamais partir. Le paramètre ne change
    // rien pour les matchs de poule (déjà correctement nommés) — ajout sans risque.
    const r = await fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${date}&limit=100`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!r.ok) { log.push(`[espn:${slug}] status=${r.status}`); return [] }
    const j = await r.json()
    return j.events ?? []
  } catch (e) {
    log.push(`[espn:${slug}] error=${e.message}`)
    return []
  }
}

// ── Push helpers ───────────────────────────────────────────────────────────────

// Un abonné sans `comps` (ou liste vide) = pas de filtre configuré → reçoit
// tout, comportement historique préservé pour ne rien casser pour les
// utilisateurs existants. Un abonné avec des championnats suivis ne reçoit
// que les notifs des matchs de ces championnats (comparaison sur le slug
// ESPN, identique à celui utilisé pour boucler sur les matchs ci-dessous —
// plus simple et plus fiable qu'un matching par nom d'équipe/traduction).
function matchesFavorite(subComps, slug) {
  if (!Array.isArray(subComps) || subComps.length === 0) return true
  if (!slug) return true
  return subComps.includes(slug)
}

// Variante stricte pour le ticker live : contrairement aux notifs classiques
// (KO/mi-temps/but/FT, où l'absence de filtre = tout recevoir, comportement
// historique préservé), un abonné SANS championnat suivi ne doit PAS recevoir
// de ticker en direct pour chaque match — sinon ça spamme tout le monde à
// chaque minute pour chaque match en cours dans le monde entier.
function matchesFavoriteStrict(subComps, slug) {
  if (!Array.isArray(subComps) || subComps.length === 0) return false
  if (!slug) return false
  return subComps.includes(slug)
}

// ⚠️ AJOUT (question utilisateur : optimiser encore le CPU du cron) : avant,
// CHAQUE appel à sendPushToMatch() (donc chaque notif ET le ticker "score en
// direct", appelé une fois PAR MATCH EN DIRECT à CHAQUE passe) refaisait un
// kv.smembers('push:subscriptions') + un JSON.parse() de CHAQUE abonné —
// alors que la liste ne change quasiment jamais dans la même passe. Avec
// plusieurs matchs en direct simultanés (fréquent en phase de poule), ça
// relisait/reparsait la même liste plusieurs fois par minute pour rien.
// loadSubscriptions() la récupère et la parse UNE SEULE FOIS par passe
// (appelé une fois dans runOnePass(), voir plus bas), puis le résultat est
// réutilisé pour tous les matchs/types de notifs de cette même passe.
async function loadSubscriptions(log) {
  // Pas d'initialisation ([]) : toujours réassigné par le try avant lecture,
  // ou la fonction retourne avant d'atteindre la boucle qui lit `raw` (voir
  // no-useless-assignment, ESLint) — l'ancien `= []` initial n'était jamais lu.
  let raw
  try { raw = (await kv.smembers('push:subscriptions')) ?? [] } catch { return [] }
  const parsed = []
  const stale  = []
  for (const subRaw of raw) {
    try { parsed.push({ raw: subRaw, sub: typeof subRaw === 'string' ? JSON.parse(subRaw) : subRaw }) }
    catch { stale.push(subRaw) }
  }
  if (stale.length) {
    try { await Promise.all(stale.map(s => kv.srem('push:subscriptions', s))) } catch {}
    log?.push(`[push] ${stale.length} abonnement(s) illisible(s) retiré(s)`)
  }
  return parsed
}

async function sendPushToMatch(payload, slug, options = {}, log = null, subsCache = null) {
  const subs = subsCache ?? await loadSubscriptions(log)
  if (!subs.length) return 0

  const matcher = options.onlyFavorites ? matchesFavoriteStrict : matchesFavorite
  const payloadStr = JSON.stringify(payload)
  const stale = []
  let sent = 0
  let failed = 0

  await Promise.allSettled(subs.map(async ({ raw: subRaw, sub }) => {
    if (!matcher(sub.comps, slug)) return
    try {
      // urgency: 'high' — sans ça, les services de push (notamment Apple sur
      // iOS, largement majoritaire chez nos abonnés) peuvent différer la
      // livraison en arrière-plan/économie d'énergie, ce qui correspond
      // exactement au symptôme observé (notifs de but rares et imprévisibles,
      // alors qu'il n'y en a que ~0-10 par match — pas un problème de volume).
      await webpush.sendNotification(sub, payloadStr, {
        TTL: options.ttl ?? 3600,
        urgency: options.urgency ?? 'normal',
      })
      sent++
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        stale.push(typeof subRaw === 'string' ? subRaw : JSON.stringify(subRaw))
      } else {
        // Avant : erreur silencieusement ignorée (aucune trace) → impossible de
        // savoir pourquoi une notif n'arrive pas chez un abonné donné. On log
        // désormais le statusCode/message pour pouvoir diagnostiquer via le log
        // renvoyé par ce endpoint (visible dans les logs Vercel du cron).
        failed++
        log?.push(`[push:fail] status=${err.statusCode ?? '?'} msg=${err.message ?? err}`)
      }
    }
  }))

  if (stale.length) {
    try { await Promise.all(stale.map(s => kv.srem('push:subscriptions', s))) } catch {}
  }
  // Log systématique (avant : seulement si échec) — permet de distinguer "le
  // serveur a bien envoyé et le service de push a accepté" (sent=X, rien à
  // corriger côté code, la suite dépend d'Apple/Google/l'OS du téléphone) de
  // "le serveur n'a même pas réussi à envoyer" (failed>0, cause visible).
  log?.push(`[push] sent=${sent} failed=${failed} stale=${stale.length} total=${subs.length}`)
  return sent
}

// ⚠️ DURCISSEMENT : l'ancien check "get puis set" n'était pas atomique — deux
// exécutions qui se chevauchent (cron-job.org qui relance avant que la
// précédente ait fini de répondre, retry réseau côté cron-job.org...)
// pouvaient toutes les deux lire "pas encore envoyé" avant que l'une des deux
// n'ait eu le temps de poser la clé, et déclencher un envoi en double — ou,
// combiné au compteur goalTrack (lecture/modification/écriture non-atomique
// lui aussi), corrompre le compteur d'un but au point qu'il ne soit plus
// jamais renvoyé. SET...NX (déjà utilisé ailleurs dans l'app, voir
// api/pulse.js) pose la clé de façon atomique : si elle existe déjà, l'appel
// renvoie null immédiatement sans l'écraser — une seule des exécutions
// concurrentes peut gagner la course, l'autre voit qu'elle a perdu.
async function sendDeduped(dedupKey, payload, slug, log = null, ttl = 3 * 3600, subsCache = null) {
  try {
    const acquired = await kv.set(dedupKey, '1', { ex: ttl, nx: true })
    if (!acquired) return 0
  } catch { return 0 }
  // urgency 'high' : ces notifs (KO/but/mi-temps/reprise/fin) sont rares et
  // importantes — priorité max pour limiter les retards/pertes en arrière-plan.
  return sendPushToMatch(payload, slug, { urgency: 'high' }, log, subsCache)
}

// ── Capture proactive du summary ESPN (compos + stats + événements) ────────────
// Root cause du "pas de compo/stats si je n'ai pas suivi le match en direct" :
// avant, la donnée summary ESPN n'était récupérée QUE quand un utilisateur
// ouvrait la page du match (via api/espn.js) — si personne ne l'a fait
// pendant que ESPN avait encore la donnée dispo, elle n'était jamais
// capturée. Ici, à CHAQUE match en direct détecté par le cron (donc pour
// TOUS les matchs, suivis ou non par qui que ce soit), on la récupère et on
// l'écrit dans le même cache Redis partagé que api/espn.js (même clé) — donc
// n'importe quel utilisateur consultant "Résultats" plus tard la retrouve,
// même s'il n'a jamais ouvert le match en direct.
// Match en cours au moment de cette capture proactive → TTL court (les stats
// vont encore changer). Une fois le match RÉELLEMENT terminé, api/espn.js
// (consulté par n'importe quel client ensuite) réécrit cette même clé SANS
// TTL (voir son commentaire "cache permanent, demande utilisateur explicite")
// — mais si personne ne rouvre jamais ce match précis après coup, cette
// capture-ci reste la seule en place. Pour que "les stats restent en cache
// sans jamais disparaître" (demande utilisateur explicite) tienne vraiment
// même dans ce cas, on retire aussi le TTL ici dès que LE SUMMARY LUI-MÊME
// indique un match terminé — même donnée immuable, même traitement.
const LIVE_SUMMARY_CACHE_TTL = 7 * 24 * 3600  // 7j — match encore en cours au moment de la capture

// hasUsefulSummaryData : importée de src/utils/liveDetection.js (voir en
// tête de fichier) — anciennement dupliquée ici et dans cf-worker/src/index.js.

function isSummaryFinished(json) {
  const statusName = json?.header?.competitions?.[0]?.status?.type?.name
  const completed  = json?.header?.competitions?.[0]?.status?.type?.completed
  return completed === true || statusName === 'STATUS_FULL_TIME' || statusName === 'STATUS_FINAL'
    || statusName === 'STATUS_FINAL_AET' || statusName === 'STATUS_FINAL_PEN'
}

async function cacheEspnSummary(slug, eventId, log) {
  try {
    const url = `${ESPN_BASE}/${slug}/summary?event=${eventId}`
    const res = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      signal:  AbortSignal.timeout(6_000),
    })
    if (!res.ok) return
    const body = await res.text()
    const parsed = JSON.parse(body)
    if (!hasUsefulSummaryData(parsed)) return
    if (isSummaryFinished(parsed)) {
      await kv.set(`espn:summary:${slug}:${eventId}`, body)
    } else {
      await kv.set(`espn:summary:${slug}:${eventId}`, body, { ex: LIVE_SUMMARY_CACHE_TTL })
    }
  } catch (e) {
    log.push(`[espn-summary-cache:${slug}:${eventId}] error=${e.message}`)
  }
}

const RECAP_TTL = 60 * 24 * 3600  // 60j — largement de quoi couvrir une compétition + consultation après coup

// extractEspnScorers/extractEspnCards/generateRecap/parseMin : importés de
// src/utils/liveDetection.js (voir en tête de fichier) — anciennement dupliqués
// ici et dans cf-worker/src/index.js, désormais une seule source, testée
// (voir liveDetection.test.js).

// ── Handler ────────────────────────────────────────────────────────────────────

// Comparaison à temps constant (audit sécurité) : évite qu'une différence de
// timing sur le `===` classique fuite un signal exploitable pour deviner
// CRON_SECRET octet par octet. Même helper que api/debug-push.js.
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export default async function handler(req, res) {
  const secret     = req.headers['x-cron-secret'] ?? req.query.secret ?? ''
  const bearerAuth = req.headers['authorization'] ?? ''
  // Accepte : header x-cron-secret (cron-job.org / cf-worker), ?secret= (debug),
  //           ou Authorization: Bearer <CRON_SECRET> (Vercel Cron natif)
  const authorized =
    !!process.env.CRON_SECRET && (
      safeCompare(secret,     process.env.CRON_SECRET) ||
      safeCompare(bearerAuth, `Bearer ${process.env.CRON_SECRET}`)
    )
  if (!authorized)
    return res.status(401).json({ error: 'Non autorisé' })

  if (!setupVapid())
    return res.status(503).json({ error: 'VAPID non configuré' })

  // ── Mode "notify" (appelé par le Worker Cloudflare, voir cf-worker/) ──────
  // ⚠️ AJOUT (sortir le polling ESPN/minute du plafond CPU Vercel — voir
  // cf-worker/src/index.js pour le contexte complet) : avant, TOUT (fetch
  // ESPN 1x/min 24/7 + envoi push) tournait ici sur Vercel, ce qui a fait
  // dépasser le plafond gratuit "Fluid Active CPU" dès la Coupe du Monde
  // 2026. Le polling + la détection (but/carton/KO/mi-temps/fin) tournent
  // maintenant sur un Worker Cloudflare (gratuit, coût CPU quasi nul car le
  // fetch réseau n'y compte pas dans le budget CPU, contrairement à Vercel).
  // Ce Worker n'appelle CET endpoint que pour la partie réellement coûteuse
  // en CPU (signature VAPID + chiffrement par abonné), et UNIQUEMENT quand il
  // a détecté un vrai événement à notifier — donc quelques dizaines de fois
  // par jour de match, au lieu de 1440 fois/jour inconditionnellement.
  // Le mode complet ci-dessous (polling ESPN + multi-passes) reste intact et
  // inchangé : fallback manuel/debug si besoin (ex: le Worker Cloudflare est
  // en panne), sans avoir à ajouter une nouvelle fonction serverless
  // (12/12 déjà atteint sur le plan Hobby — tout reste dans ce même fichier).
  let body = null
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch { body = null }
  }
  if (body?.mode === 'notify') {
    const { payload, slug, options } = body
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload manquant' })
    }
    // Dédup déjà géré côté Worker (SET NX Redis avant l'appel) — ici on ne
    // fait plus que le travail réellement coûteux : charger les abonnés,
    // filtrer, chiffrer et envoyer. sendPushToMatch() est la même fonction
    // inchangée que dans le mode complet ci-dessous (voir plus bas).
    const sentCount = await sendPushToMatch(payload, slug ?? null, options ?? {})
    return res.status(200).json({ ok: true, mode: 'notify', sent: sentCount })
  }

  // Marqueur "dernière exécution" — lu par /api/debug-push pour vérifier que
  // cron-job.org appelle bien cet endpoint chaque minute. Avant ce fix,
  // aucune trace de la dernière exécution réelle n'existait nulle part :
  // impossible de distinguer "le cron tourne mais rien à notifier" de
  // "cron-job.org a arrêté d'appeler cet endpoint" (secret expiré, job
  // désactivé côté cron-job.org...) — cause plausible de notifs manquantes
  // non détectable depuis le code de l'app seul.
  try { await kv.set('cron:goals:lastRun', Date.now(), { ex: 7 * 24 * 3600 }) } catch {}

  // ── Une "passe" = un cycle complet fetch ESPN + traitement de tous les
  // événements, identique à ce que faisait cet endpoint avant (une seule
  // fois par appel cron-job.org, donc au mieux toutes les 60s). Extrait en
  // fonction pour pouvoir être rejouée PLUSIEURS fois au sein du même appel
  // (voir boucle interne juste après la définition) — c'est ça qui réduit le
  // délai réel sans dépendre d'un cron plus fréquent que 60s (cron-job.org
  // ne descend jamais sous la minute, même sur un plan payant).
  async function runOnePass() {
    const log      = []
    let notifsSent = 0
    const now       = new Date()
    const today     = dateStr(now)
    const yesterday = dateStr(new Date(now - 86_400_000))

  // ── Jour sans aucun match connu : sauter les 18 fetchs ESPN ─────────────────
  // ⚠️ AJOUT (question utilisateur : "les jours où y'a pas de match, faudrait
  // que le cron ne tourne pas") : cron-job.org appelle cet endpoint 1x/min
  // 24/7, y compris les jours sans AUCUN match sur les 9 compétitions suivies
  // (trêve internationale, jour creux...). Avant ce fix, chaque passe faisait
  // quand même les 18 fetchs ESPN (9 slugs × today+yesterday) et tout le
  // traitement associé pour ne rien trouver. Marqueur posé UNIQUEMENT quand un
  // fetch RÉEL vient de confirmer 0 event (jamais deviné à l'avance) — voir
  // plus bas où il est posé, avec garde contre une panne ESPN temporaire
  // confondue avec "vraiment aucun match". Fenêtre courte (20min) : le
  // scoreboard ESPN liste déjà les matchs SCHEDULED à venir dans la journée,
  // pas seulement ceux en cours — donc "0 event" veut dire "rien du tout
  // aujourd'hui", pas juste "rien en direct maintenant". Un nouveau match ne
  // peut pas apparaître par surprise en moins de 20min dans ce contexte, mais
  // on revérifie quand même régulièrement par sécurité plutôt que de rester
  // silencieux toute la journée sur une fausse détection.
  const emptyDayKey = 'cron:emptyDay'
  // ⚠️ BUG CORRIGÉ (audit sécurité + constat utilisateur : notifs but/mi-temps/
  // fin reçues d'un coup ~1h43 après avoir été détectées côté ESPN, sur le
  // direct Angleterre-Argentine, via cf-worker qui partage cette même logique
  // et ce même Redis) : les 2 marqueurs "on peut sauter le prochain fetch"
  // ci-dessous (emptyDayKey/nextCheckKey) s'armaient sur la seule base du
  // fetch de LA PASSE EN COURS — un aléa ESPN ponctuel (match absent du
  // scoreboard ou statut mal classé le temps d'une passe) suffisait à couper
  // jusqu'à 20-25min de détection, potentiellement reconduit passe après passe.
  // cron:liveIds (Set Redis, partagé avec cf-worker) retient tout match VU
  // live à un moment (ajouté/retiré au fil de la boucle plus bas) — tant qu'il
  // n'est pas vide, on n'arme JAMAIS ces 2 marqueurs, même si l'un d'eux était
  // déjà posé par une passe précédente.
  let stillTrackingLive = 0
  try { stillTrackingLive = await kv.scard('cron:liveIds') } catch {}

  let knownEmpty = false
  if (stillTrackingLive === 0) {
    try { knownEmpty = !!(await kv.get(emptyDayKey)) } catch {}
  }
  if (knownEmpty) {
    return { notifsSent: 0, events: 0, log: ['jour sans match connu (re-check <20min) — fetch ESPN sauté'] }
  }

  // ── Aucun match imminent (mais pas "jour vide") : lever le pied jusqu'au
  // prochain coup d'envoi connu ──────────────────────────────────────────────
  // ⚠️ AJOUT (question utilisateur : "pour ce genre de requêtes toutes les
  // minutes, pourquoi pas ne pas fetcher tant qu'y'a pas de match ce jour-là ?")
  // : le mécanisme "jour vide" ci-dessus ne couvre QUE les jours SANS AUCUN
  // match. Un jour avec un seul match tardif (ex: 21h) fait quand même les 18
  // fetchs ESPN toutes les minutes depuis minuit, alors que rien ne peut se
  // passer avant le coup d'envoi. Même prudence que "jour vide" : jamais deviné
  // à l'avance, uniquement posé après un fetch RÉEL qui confirme qu'aucun match
  // n'est en direct, et TOUJOURS re-vérifié en vrai au plus tard 25min après
  // (jamais un blocage figé jusqu'au coup d'envoi — si l'horaire bouge ou qu'un
  // match commence plus tôt que prévu, on le rattrape au prochain re-check).
  // Marge de sécurité 1h30 avant le coup d'envoi le plus proche connu : le
  // polling normal reprend largement avant l'heure programmée, jamais pile
  // dessus. Champ d'application volontairement étroit (uniquement "aucun match
  // en direct ET prochain KO loin") pour ne jamais toucher au comportement
  // pendant/juste avant un match — seul le temps mort matinal/après-midi avant
  // un match du soir est concerné.
  const NEXT_CHECK_BUFFER_MS = 90 * 60 * 1000  // 1h30 de marge avant le 1er coup d'envoi connu
  const NEXT_CHECK_MAX_MS    = 25 * 60 * 1000  // jamais plus de 25min sans re-vérifier en vrai
  const nextCheckKey = 'cron:nextCheck'
  let skipUntil = null
  if (stillTrackingLive === 0) {
    try { skipUntil = await kv.get(nextCheckKey) } catch {}
  }
  if (skipUntil && Number(skipUntil) > now.getTime()) {
    return { notifsSent: 0, events: 0, log: [`aucun match en direct/imminent (re-check ${new Date(Number(skipUntil)).toLocaleTimeString('fr-FR')}) — fetch ESPN sauté`] }
  }

  // Fetch tous les slugs ESPN en parallèle (aujourd'hui + hier pour les matchs tardifs)
  const allResults = await Promise.allSettled(
    ESPN_SLUGS.flatMap(slug => [
      fetchEspnEvents(slug, today,     log).then(evts => evts.map(e => ({ slug, evt: e }))),
      fetchEspnEvents(slug, yesterday, log).then(evts => evts.map(e => ({ slug, evt: e }))),
    ])
  )

  const allEvents = allResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])

  // Poser le marqueur "jour vide" seulement si le fetch a vraiment abouti pour
  // toutes les compétitions (aucune erreur réseau dans ce passage) — sinon une
  // panne ESPN temporaire serait à tort mémorisée comme "aucun match", et on
  // resterait aveugle jusqu'à 20min sur de vrais matchs en cours.
  const espnFetchFailed = log.some(l => /^\[espn:.*\] error=/.test(l))
  if (stillTrackingLive === 0 && allEvents.length === 0 && !espnFetchFailed) {
    try { await kv.set(emptyDayKey, '1', { ex: 20 * 60 }) } catch {}
  }

  // Poser le marqueur "rien d'imminent" (voir commentaire plus haut) —
  // uniquement si le fetch a abouti, qu'AUCUN match trouvé n'est actuellement
  // en direct, qu'il reste une vraie marge avant le prochain coup d'envoi
  // programmé (les matchs déjà terminés/reportés n'entrent pas en compte), ET
  // qu'on ne suit déjà aucun match live connu (cron:liveIds — voir plus haut).
  if (stillTrackingLive === 0 && allEvents.length > 0 && !espnFetchFailed) {
    const anyLive = allEvents.some(({ evt }) =>
      LIVE_ESPN.has(normalizeEspnStatus(evt.competitions?.[0]?.status)))
    if (!anyLive) {
      // ⚠️ BUG CORRIGÉ (constat utilisateur : notif de coup d'envoi reçue
      // ~25min après le vrai coup d'envoi, pour 2 matchs de suite) : ce
      // filtre excluait un match SCHEDULED dont l'heure prévue (evt.date)
      // vient tout juste d'être dépassée — exactement le cas d'un match qui
      // DÉMARRE VRAIMENT à l'instant mais dont le statut ESPN n'a pas encore
      // basculé sur IN_PROGRESS (lag connu et déjà documenté ailleurs dans ce
      // fichier — jusqu'à ~10min sur le slug WC, voir plus haut). Résultat :
      // `nextKickoff` retombait à `null` (plus aucun événement "futur"), donc
      // `farEnough` passait à `true` sans aucune vraie certitude qu'aucun
      // match n'était imminent — le cron partait alors se rendormir 25min
      // (NEXT_CHECK_MAX_MS) PILE au moment où le match commençait, ratant le
      // coup d'envoi jusqu'au réveil suivant. On garde maintenant aussi les
      // matchs SCHEDULED dont l'heure est déjà passée (evt.date <= now) : un
      // `nextKickoff` dans le passé proche donne un delta négatif, largement
      // sous le seuil de 90min (NEXT_CHECK_BUFFER_MS) → `farEnough` reste
      // `false`, le cron continue de poller normalement (1x/min) au lieu de
      // sauter 25min, et rattrape le KO au prochain passage normal.
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
  // ⚠️ Ces 2 lignes de diagnostic (total events / matches FIFA live) étaient
  // loggées à CHAQUE passe, identiques la plupart du temps — ça remplissait le
  // buffer glissant `cron:goals:logHistory` (1000 lignes) de bruit sans intérêt
  // en ~1h30-2h (constat : un but signalé par l'utilisateur n'était déjà plus
  // dans l'historique au moment où il l'a vérifié). Le nombre d'events est de
  // toute façon déjà visible dans la ligne "[pass N] notifs=X events=Y" ajoutée
  // par la boucle multi-passes plus bas — pas la peine de le dupliquer ici.
  // Retiré de la persistance pour laisser la place à des lignes réellement
  // utiles (KO/but/mi-temps/fin) sur une fenêtre de temps plus longue.

  // FIFA live — fetché une seule fois, utilisé pour accélérer la détection WC (voir plus bas)
  const hasWc = allEvents.some(({ slug }) => slug === 'fifa.world')
  const fifaLiveMatches = hasWc ? await fetchFifaLiveMatches(log) : []

  // ⚠️ PERF (même classe de bug que api/fifa-live.js, voir son commentaire
  // détaillé — question utilisateur sur la tenue en charge avec ~30-50
  // matchs/jour à la reprise des championnats) : cacheEspnSummary() était
  // attendu (await) séquentiellement DANS la boucle, un match à la fois. Avec
  // beaucoup de matchs live en même temps, ça pouvait cumuler plusieurs
  // secondes avant même d'atteindre la détection de but/notif pour les
  // derniers matchs de la liste — risque de dépasser le timeout de la
  // fonction (10s par défaut sur Vercel Hobby) et de perdre TOUTE la passe
  // (aucune notif envoyée), pas juste ralentir. cacheEspnSummary() ne
  // retourne rien d'utile à la suite du traitement (effet de bord Redis
  // uniquement, déjà protégé par son propre try/catch) → sans risque de
  // paralléliser : chaque appel part immédiatement, résolu tous ensemble
  // juste avant de retourner, pour ne pas être coupé par la fin de la fonction.
  const pendingSummaryFetches = []
  // Chargée UNE FOIS pour toute la passe (voir loadSubscriptions() plus haut)
  // — réutilisée par tous les appels sendDeduped/sendPushToMatch ci-dessous,
  // qu'il y ait 1 ou plusieurs matchs en direct dans cette même passe.
  const subsCache = await loadSubscriptions(log)

  for (const { slug, evt } of allEvents) {
   // ⚠️ Durcissement : avant, une erreur inattendue sur UN SEUL match (donnée
   // ESPN malformée, champ manquant non prévu...) faisait planter TOUT le
   // reste de la boucle — donc tous les autres matchs de cette passe, y
   // compris ceux dont la notif était sur le point de partir. Avec la boucle
   // interne (plusieurs passes par appel, voir plus bas), une passe entière
   // perdue pèse un peu plus qu'avant sur le total. Un try/catch par match
   // isole le problème : un match cassé est loggé et ignoré, les autres
   // continuent d'être traités normalement dans la même passe.
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

    // ── FIX retard notif WC : ESPN lag ~10min sur le statut du slug 'fifa.world' ──
    // Si ESPN dit encore SCHEDULED mais que l'API FIFA officielle confirme que le
    // match a commencé (Period != 0), on bascule immédiatement en IN_PROGRESS →
    // notif coup d'envoi (et détection de buts) sans attendre ESPN.
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
          log.push(`[fifa-override:${eventId}] ESPN=SCHEDULED → FIFA=${fifaStatus} (KO anticipé)`)
        } else if (status === 'STATUS_IN_PROGRESS' && fifaStatus === 'STATUS_HALFTIME') {
          // ESPN n'a pas encore basculé sur la pause → FIFA la confirme plus vite.
          // (Jamais l'inverse : on ne fait pas confiance à FIFA pour repasser
          // HALFTIME → IN_PROGRESS ni pour déclarer une fin de match.)
          status = 'STATUS_HALFTIME'
          log.push(`[fifa-override:${eventId}] ESPN=IN_PROGRESS → FIFA=HALFTIME (mi-temps anticipée)`)
        } else if (status === 'STATUS_SHOOTOUT' && fifaConfirmsShootoutOver(fifaMatch)) {
          // Voir commentaire de fifaConfirmsShootoutOver() : fenêtre étroite et sûre
          // (ESPN nous a déjà confirmé nous-mêmes qu'on est en tab), donc pas le
          // même risque de faux FT que pendant le jeu normal.
          status = 'STATUS_FINAL_PEN'
          log.push(`[fifa-override:${eventId}] ESPN=STATUS_SHOOTOUT → FIFA=FINAL (fin tab anticipée)`)
        }
        const fh = fifaMatch.HomeTeam?.Score
        const fa = fifaMatch.AwayTeam?.Score
        if (typeof fh === 'number') home = Math.max(home, fh)
        if (typeof fa === 'number') away = Math.max(away, fa)
      }
    }

    const score    = `${home}-${away}`
    const scoreStr = `${home} – ${away}`

    // Capture proactive compos/stats/événements pendant que le match est en
    // direct — voir cacheEspnSummary() plus haut. Tourne pour CHAQUE match
    // live à CHAQUE poll (1/min), suivi ou non par un utilisateur.
    if (LIVE_ESPN.has(status)) {
      pendingSummaryFetches.push(cacheEspnSummary(slug, eventId, log))
      // cron:liveIds partagé avec cf-worker/src/index.js (même Redis) — voir
      // le garde-fou plus haut dans cette fonction (bug notifs groupées).
      try { await kv.sadd('cron:liveIds', String(eventId)) } catch {}
    } else if (FINAL_ESPN.has(status) || status === 'STATUS_POSTPONED' || status === 'STATUS_CANCELED') {
      try { await kv.srem('cron:liveIds', String(eventId)) } catch {}
    }

    // 🔴 Coup d'envoi — basé sur la confirmation RÉELLE (statut LIVE_ESPN, déjà
    // corrigé par le fifa-override ci-dessus pour compenser le lag ESPN connu
    // sur le Mondial), plutôt que sur l'heure programmée (evt.date).
    // ⚠️ Avant : notifiait dès l'heure prévue dépassée, même si le coup
    // d'envoi réel avait du retard (VAR, retard d'équipe...) — décalage
    // signalé par l'utilisateur, symétrique au bug corrigé côté affichage
    // client (calcMinute affichait "1'" avant la vraie confirmation ESPN,
    // voir useLiveMinute.js/matchUtils.js). Même correctif appliqué ici pour
    // rester cohérent : la notif part exactement quand le match passe "Débute"
    // → minute réelle côté client. sendDeduped() garantit un envoi unique par
    // match, peu importe le nombre de polls où LIVE_ESPN.has(status) reste vrai.
    const notPostponed = status !== 'STATUS_POSTPONED' && status !== 'STATUS_CANCELED'
    if (LIVE_ESPN.has(status) && notPostponed) {
      // TTL de dédup à 6h : marge de sécurité pour un match prolongation+tab
      // (peut dépasser 3h depuis le coup d'envoi).
      const sent = await sendDeduped(`push:espn:ko:${eventId}`,
        { title: "🔴 Coup d'envoi !", body: `${homeTeam} – ${awayTeam}`, url: '/live' }, slug, log, 6 * 3600, subsCache)
      if (sent > 0) { notifsSent++; log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} KO (confirmé ESPN)`) }
    }

    // ⚠️ CORRIGÉ (constat utilisateur : commandes Redis Upstash qui montent
    // pendant la nuit "alors qu'il n'y a rien" — +16K en une nuit) : jusqu'ici,
    // le get+set de stateKey ci-dessous s'exécutait pour CHAQUE événement
    // renvoyé par ESPN (today+yesterday, toutes compétitions confondues), y
    // compris les matchs encore STATUS_SCHEDULED (pas commencés) — un match
    // programmé n'a AUCUNE transition à détecter avant son coup d'envoi (le
    // KO lui-même est géré juste au-dessus, indépendamment de ce state). La
    // nuit, avec plusieurs compétitions et des matchs à venir dans le
    // calendrier ESPN mais aucun en direct, ce coût tournait quand même en
    // fond 24/7 (le cron externe ne s'arrête jamais, cron-job.org appelle
    // toutes les minutes même sans aucun match live). On saute maintenant
    // entièrement ce match tant qu'il n'est pas devenu live/terminé au moins
    // une fois — le baseline (voir plus bas) se posera alors naturellement
    // au premier poll où il l'est vraiment, sans rien perdre.
    if (status === 'STATUS_SCHEDULED' && notPostponed) continue

    const stateKey  = `cron:espn:${eventId}`
    let   prevState = null
    try { prevState = await kv.get(stateKey) } catch {}
    const [prevStatus = null] = prevState ? prevState.split('|') : []

    // Sauvegarder état courant (TTL 12h)
    try { await kv.set(stateKey, `${status}|${score}`, { ex: 12 * 3600 }) } catch {}

    // Premier poll → baseline, pas de notif de changement d'état (le KO est
    // déjà géré ci-dessus, indépendamment de prevState). On initialise aussi
    // le compteur "buts déjà notifiés" (goalTrack, voir bloc But ci-dessous)
    // sur le score de départ, pour ne jamais déclencher un rattrapage
    // rétroactif sur des buts antérieurs au premier poll de ce match.
    if (prevState === null) {
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} baseline ${status}|${score}`)
      try { await kv.set(`goalTrack:${eventId}`, JSON.stringify({ home, away }), { ex: 12 * 3600 }) } catch {}
      continue
    }

    // ⚠️ Diagnostic (constat : la notif "mi-temps" ne s'est jamais déclenchée sur
    // plusieurs vrais matchs de CM 2026 récents alors qu'ils ont bien eu une vraie
    // pause — aucune preuve directe trouvée dans le code, ESPN pourrait ne jamais
    // renvoyer STATUS_HALFTIME pour ce statut précis, ou une autre valeur inconnue).
    // Log de CHAQUE transition de statut brute (pas juste celles qu'on gère
    // explicitement plus bas) pour avoir la preuve exacte au prochain match live,
    // au lieu de deviner un correctif sans donnée réelle.
    if (status !== prevStatus) {
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} transition ${prevStatus} → ${status} (period=${comp.status?.period ?? '?'}, clock=${comp.status?.displayClock ?? '?'})`)
    }

    // ⚽ But — envoi IMMÉDIAT dès que le score diffère du poll précédent (plus
    // d'attente du nom du buteur avant d'envoyer quoi que ce soit).
    //
    // ⚠️ REVERT (constat utilisateur direct : "avant ça marchait, à partir du
    // moment où on a dit d'attendre le buteur, ça a cassé") : ce fichier avait
    // introduit une attente (GOAL_SCORER_WAIT_MS, d'abord 5min puis réduite à
    // 45s) pour inclure le nom du buteur quand ESPN ne l'avait pas encore
    // publié au moment exact du changement de score — dans l'idée d'éviter un
    // "⚽ But !" générique. Mais d'après le retour direct de l'utilisateur,
    // c'est précisément à partir de l'introduction de cette attente que les
    // notifs de but ont cessé d'arriver de façon fiable, alors que coup
    // d'envoi/mi-temps/fin (qui n'ont jamais eu ce mécanisme d'attente)
    // continuaient d'arriver normalement — signal clair que le bug est dans
    // cette logique d'attente spécifiquement, même si aucune preuve directe
    // (log serveur) n'a pu être obtenue pour le confirmer avec certitude
    // absolue. Plutôt que de continuer à retoucher un mécanisme déjà repris
    // 3 fois (5min→45s, fix multi-buts, fix pendingSince par camp) sans
    // pouvoir prouver le bug exact, la solution la plus sûre et la plus
    // simple est de supprimer l'attente : le nom du buteur est utilisé s'il
    // est DÉJÀ présent dans comp.details au moment du poll qui détecte le
    // but, sinon message générique envoyé tout de suite (jamais de retry
    // différé). Le compteur goalTrack (1 but à la fois, un envoi par but
    // manquant) est conservé : c'est lui qui gère les buts multiples entre
    // deux polls (ex: 0→2 d'un coup), pas la partie retirée ici.
    //
    // Exclusion conservée : un changement de score alors qu'on était DÉJÀ en
    // mi-temps au poll précédent ET qu'on y est toujours (vraie pause, aucun
    // but possible) = correction tardive de données ESPN, pas un but réel →
    // absorbé silencieusement dans le compteur, jamais notifié.
    const steadyHalftime = prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME'
    // Retour utilisateur : notif de carton rouge reçue des heures après un match
    // fini (3h du mat', notif reçue en pleine journée). Cause : ce bloc restait
    // vrai à CHAQUE poll tant que le match était FINAL (`|| FINAL_ESPN.has(status)`,
    // sans lien avec prevStatus), pas seulement au moment réel de la transition
    // live→FT — dans la fenêtre de rattrapage recap (12h, cron:espn:${eventId}),
    // une correction tardive d'ESPN sur comp.details (but/carton ajouté après
    // coup) déclenchait donc une notif alors que le match est terminé depuis
    // longtemps. `LIVE_ESPN.has(prevStatus)` seul suffit à couvrir la transition
    // live→FT (événement du sifflet final) sans rouvrir la fenêtre indéfiniment.
    if (LIVE_ESPN.has(prevStatus) || LIVE_ESPN.has(status)) {
      // Verrou léger (5s, NX) anti-concurrence : le compteur `track` ci-dessous
      // est lu puis réécrit en 2 étapes (pas atomique par nature, contrairement
      // à sendDeduped() qui l'est déjà via SET NX). Si deux exécutions de ce
      // cron traitent CE MÊME match au même instant (chevauchement cron-job.org,
      // retry réseau, ou un futur 2e cron externe ajouté pour réduire le délai
      // moyen), une lecture/écriture concurrente pourrait faire "reculer" le
      // compteur et bloquer silencieusement un but suivant. Si le verrou est
      // déjà pris, on saute cette passe pour ce match — sans risque : la passe
      // suivante (quelques secondes plus tard) retraitera avec des données à jour.
      const lockKey = `goalLock:${eventId}`
      const lockAcquired = await kv.set(lockKey, '1', { px: 5_000, nx: true }).catch(() => null)
      if (!lockAcquired) {
        log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} verrou but déjà pris (exécution concurrente) — passe suivante`)
      } else {
      const trackKey = `goalTrack:${eventId}`
      let track = null
      try { track = await kv.get(trackKey) } catch {}
      track = track ? (typeof track === 'string' ? JSON.parse(track) : track) : { home, away }

      const sides = []
      if (home > track.home) sides.push('home')
      if (away > track.away) sides.push('away')

      let trackChanged = false

      // ⚽❌ But annulé (VAR / correction ESPN) — demande utilisateur : "si le
      // but est refusé avec la VAR au bout de quelques minutes faut que
      // l'app puisse annuler le but". Le score ESPN (home/away, relu à
      // CHAQUE poll) reflète déjà automatiquement l'annulation dès qu'ESPN
      // la publie — mais SANS ce bloc, track[side] restait bloqué au-dessus
      // du score réel corrigé : le prochain VRAI but à cet index ne
      // déclenchait plus jamais rien (track[side] < targetCount devenait
      // durablement faux), et personne n'était prévenu que le but affiché
      // avait disparu du score.
      const cancelledSides = []
      if (home < track.home) cancelledSides.push('home')
      if (away < track.away) cancelledSides.push('away')

      for (const side of cancelledSides) {
        const scoringTeam  = side === 'home' ? homeTeam : awayTeam
        const newCount     = side === 'home' ? home : away
        const prevCount    = track[side]

        log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} BUT ANNULÉ ${side} ${prevCount}→${newCount}`)

        const sent = await sendDeduped(`push:espn:goalcancel:${eventId}:${side}:${newCount}`,
          { title: `❌ But annulé (${scoringTeam})`, body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live', matchId: eventId, tag: `goal-cancel-${eventId}-${side}-${newCount}` }, slug, log, undefined, subsCache)
        if (sent > 0) notifsSent++

        // Libère les clés de dédup des buts retirés : si un VRAI but est
        // marqué plus tard à ce même index (ex: le but annulé était le 2e
        // du camp, un nouveau 2e but légitime est marqué 10min après),
        // sendDeduped() doit pouvoir renvoyer une notif à cet index — sans
        // ce nettoyage, la clé laissée par l'envoi original bloquerait
        // silencieusement ce futur but pendant tout le TTL restant (3h).
        for (let i = newCount; i < prevCount; i++) {
          try { await kv.del(`push:espn:goal:${eventId}:${side}:${i + 1}`) } catch {}
        }

        track[side] = newCount
        trackChanged = true
      }

      for (const side of sides) {
        const targetCount = side === 'home' ? home : away

        if (steadyHalftime) {
          track[side] = targetCount
          trackChanged = true
          continue
        }

        const scoringTeam = side === 'home' ? homeTeam : awayTeam
        const goalScorers = extractEspnScorers(comp, homeC.team?.id)
          .filter(g => g.team === side)
          .sort((a, b) => parseMin(a.minute) - parseMin(b.minute))

        // Un but à la fois — tant que track[side] < targetCount, il reste au
        // moins un but réel non notifié. Envoi immédiat, avec le nom du
        // buteur s'il est déjà connu côté ESPN à ce poll précis, sinon
        // message générique tout de suite (voir commentaire plus haut).
        while (track[side] < targetCount) {
          const goalIndex = track[side] // 0 = 1er but de ce camp, 1 = 2e, etc.
          const scorer     = goalScorers[goalIndex] ?? null

          // Format "But pour {équipe}" en titre + "joueur[, pen/csc] minute'"
          // puis le score sur une 2e ligne dans le body — même convention
          // (nom + ", pen"/", csc" entre parenthèses… ici sans parenthèses
          // puisque isolé sur sa propre ligne) que generateRecap() plus haut
          // dans ce fichier. Retour utilisateur : le titre et le body sont
          // déjà rendus sur des lignes séparées par l'OS (titre en gras,
          // body en dessous) — mettre l'équipe dans le titre et le
          // buteur+minute dans le body donne donc naturellement le saut de
          // ligne demandé entre "équipe qui a marqué" et "buteur + minute".
          const scorerSuffix = scorer ? (scorer.ownGoal ? ', csc' : scorer.penaltyKick ? ', pen' : '') : ''
          const minuteText   = scorer ? minuteLabel(scorer.minute) : ''
          const goalTitle    = `⚽ But pour ${scoringTeam} !`
          const scorerLine   = scorer
            ? `${scorer.name}${scorerSuffix}${minuteText ? ` ${minuteText}` : ''}`
            : 'But marqué'
          const goalBody     = `${scorerLine}\n${homeTeam} ${scoreStr} ${awayTeam}`

          log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} BUT ${side} ${goalIndex + 1}/${targetCount}${scorer ? '' : ' (générique, buteur pas encore publié)'}`)

          // Clé de dédup basée sur "le Nème but de ce camp dans ce match" —
          // stable et unique même si 2 buts du même camp partagent le même
          // score de départ/arrivée entre deux passes (contrairement à
          // l'ancienne clé basée sur le score complet, qui ne pouvait pas
          // distinguer 2 buts consécutifs du même camp).
          const sent = await sendDeduped(`push:espn:goal:${eventId}:${side}:${goalIndex + 1}`,
            { title: goalTitle, body: goalBody, url: '/live', matchId: eventId, tag: `goal-${eventId}-${side}-${goalIndex + 1}` }, slug, log, undefined, subsCache)
          if (sent > 0) notifsSent++

          track[side]++
          trackChanged = true
        }
      }

      if (trackChanged) {
        try { await kv.set(trackKey, JSON.stringify(track), { ex: 12 * 3600 }) } catch {}
      }
      } // fin du else (verrou acquis)
    }

    // 🟥 Carton rouge — même schéma de dédup par compteur que les buts, mais
    // SANS délai d'attente : contrairement au buteur d'un but (parfois publié
    // par ESPN quelques secondes après le changement de score), le joueur
    // exclu est TOUJOURS déjà présent dans comp.details au moment où le
    // carton y apparaît. Coût réseau/Redis : nul en plus — extractEspnCards()
    // relit comp.details, déjà récupéré pour ce match dans cette même passe
    // (déjà utilisé plus bas pour generateRecap) ; seul ajout réel : la
    // commande de lecture/écriture du compteur cardTrack, négligeable (un
    // carton rouge reste rare, 0-2 par match en moyenne).
    // Même correctif que le bloc but ci-dessus : ne pas rouvrir la fenêtre de
    // notif indéfiniment tant que le match reste FINAL (voir commentaire ligne
    // ~869) — sinon un carton ajouté tardivement par ESPN à comp.details après
    // la fin du match déclenche une notif "hors match" des heures plus tard.
    if (LIVE_ESPN.has(status) || LIVE_ESPN.has(prevStatus)) {
      const reds = extractEspnCards(comp, homeC.team?.id).filter(c => c.red)
        .sort((a, b) => parseMin(a.minute) - parseMin(b.minute))
      const redsBySide = { home: reds.filter(c => c.team === 'home'), away: reds.filter(c => c.team === 'away') }

      const cardTrackKey = `cardTrack:${eventId}`
      let cardTrack = null
      try { cardTrack = await kv.get(cardTrackKey) } catch {}
      cardTrack = cardTrack ? (typeof cardTrack === 'string' ? JSON.parse(cardTrack) : cardTrack) : { home: 0, away: 0 }
      let cardTrackChanged = false

      for (const side of ['home', 'away']) {
        const list = redsBySide[side]
        while (cardTrack[side] < list.length) {
          const card       = list[cardTrack[side]]
          const teamName   = side === 'home' ? homeTeam : awayTeam
          const minuteText = minuteLabel(card.minute)
          const sent = await sendDeduped(`push:espn:red:${eventId}:${side}:${cardTrack[side] + 1}`,
            { title: '🟥 Carton rouge', body: `${card.name} (${teamName})${minuteText ? ` — ${minuteText}` : ''}`, url: '/live' }, slug, log, undefined, subsCache)
          if (sent > 0) { notifsSent++; log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} carton rouge ${side} ${card.name}`) }
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
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} mi-temps`)
      const sent = await sendDeduped(`push:espn:ht:${eventId}`,
        { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, log, undefined, subsCache)
      if (sent > 0) notifsSent++
    }

    // ▶️ Reprise 2ème MT
    if (prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_IN_PROGRESS') {
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} reprise`)
      const sent = await sendDeduped(`push:espn:2h:${eventId}`,
        { title: '▶️ Reprise !', body: `2ème MT · ${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, log, undefined, subsCache)
      if (sent > 0) notifsSent++
    }

    // 🏁 Fin de match — garde anti-faux FT : ESPN STATUS_FINAL est fiable, on le prend tel quel
    if (LIVE_ESPN.has(prevStatus) && FINAL_ESPN.has(status)) {
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} FT`)
      const sent = await sendDeduped(`push:espn:ft:${eventId}`,
        { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, log, undefined, subsCache)
      if (sent > 0) notifsSent++
      // Capture finale — le boxscore/évènements se stabilisent parfois
      // quelques secondes après le sifflet final (corrections tardives).
      await cacheEspnSummary(slug, eventId, log)
    }

    // 📝 Résumé auto — tant qu'aucun recap n'est stocké pour ce match terminé,
    // on retente à chaque poll (1/min). Nécessaire car comp.details (buteurs/
    // cartons) peut arriver quelques dizaines de secondes après le FT — un
    // essai unique au moment exact de la transition manquerait parfois un but
    // tardif. S'arrête naturellement quand cron:espn:${eventId} expire (12h,
    // voir stateKey plus haut) : le match sort alors de la boucle de rattrapage.
    if (FINAL_ESPN.has(status)) {
      try {
        const already = await kv.get(`recap:${eventId}`)
        if (!already) {
          const scorers = extractEspnScorers(comp, homeC.team?.id)
          const cards   = extractEspnCards(comp, homeC.team?.id)
          const recap   = generateRecap({ homeTeam, awayTeam, home, away, scorers, cards })
          if (recap) {
            await kv.set(`recap:${eventId}`, recap, { ex: RECAP_TTL })
            log.push(`[recap:${eventId}] généré`)
          }
        }
      } catch (e) {
        log.push(`[recap:${eventId}] error=${e.message}`)
      }
    }

    // 📊 Ticker "score en direct" — uniquement pour les abonnés qui suivent
    // une des deux équipes (jamais envoyé aux abonnés sans filtre configuré,
    // pour ne pas transformer l'app en spam pour tout le monde). Même `tag`
    // à chaque minute → remplace la notif précédente au lieu d'empiler
    // (silent + renotify:false côté SW → pas de nouveau son/vibration).
    // ⚠️ CORRIGÉ (demande utilisateur : "moins de délai sur le live") : ce
    // ticker passait en urgency 'normal' par défaut (seul point de tout ce
    // fichier oublié lors du fix urgency:'high' plus haut) — sur iOS, une
    // notif 'normal' peut être différée par Apple pour économiser la
    // batterie, ce qui allait justement à l'encontre de son rôle (suivre le
    // direct). Passé en 'high' comme le reste des notifs importantes : le
    // risque de limitation par excès de priorité reste faible ici (déjà
    // restreint aux seuls abonnés qui suivent l'une des deux équipes, pas
    // envoyé à tout le monde).
    if (LIVE_ESPN.has(status)) {
      const minuteLabel = status === 'STATUS_HALFTIME' ? 'Mi-temps' : `${comp.status?.displayClock ?? ''}`.trim()
      await sendPushToMatch(
        {
          title: `${homeTeam} ${scoreStr} ${awayTeam}`,
          body:  minuteLabel ? `⏱ ${minuteLabel}` : 'En direct',
          url:   '/live',
          matchId: eventId,
          tag:     `live-${eventId}`,
          silent:  true,
          renotify: false,
        },
        slug,
        { onlyFavorites: true, urgency: 'high' },
        log,
        subsCache,
      )
    }
   } catch (e) {
     log.push(`[espn:${slug}:${evt?.id ?? '?'}] ERREUR match ignoré : ${e.message}`)
   }
  }

    // Attendre que tous les cacheEspnSummary() lancés en parallèle soient
    // terminés avant de retourner — sinon la fonction pourrait rendre sa
    // réponse (et donc être coupée par Vercel) alors que certains sont
    // encore en vol.
    if (pendingSummaryFetches.length > 0) {
      await Promise.allSettled(pendingSummaryFetches)
    }

    return { notifsSent, events: allEvents.length, log }
  }

  // ── Boucle interne : plusieurs passes par appel cron-job.org ────────────
  // ⚠️ cron-job.org ne descend jamais sous 1 appel/minute (vérifié — limite
  // dure de leur service, même sur un plan payant) : impossible d'aller plus
  // vite en augmentant la fréquence du cron externe. En revanche, RIEN
  // n'empêche CET appel de faire plusieurs passes ESPN à l'intérieur de lui-
  // même avant de répondre — c'est ce qu'on fait ici, gratuitement, sans
  // nouvelle infra. Seule contrainte réelle : le plan gratuit de cron-job.org
  // coupe la connexion après 30s d'exécution (leur FAQ), donc on reste
  // volontairement sous cette limite (BUDGET_MS) par sécurité — sur un
  // compte "Sustaining Member" payant chez eux (limite plus haute), BUDGET_MS
  // peut être augmenté sans toucher au reste du code.
  //
  // ⚠️ IMPORTANT pour comprendre le vrai gain : le pire délai n'est PAS
  // POLL_INTERVAL_MS (l'écart entre les passes internes), il est dominé par
  // le "trou mort" entre la DERNIÈRE passe d'un appel et la 1ère passe de
  // l'appel suivant (60s plus tard) = environ (60 - BUDGET_MS). Faire plus de
  // passes internes rapprochées n'aide quasiment pas le pire cas si
  // BUDGET_MS reste petit — le vrai levier, c'est de pousser BUDGET_MS aussi
  // près que possible des 30s de cron-job.org.
  //
  // ⚠️ RÉDUIT (compte Vercel Hobby a atteint 100% du quota gratuit "Fluid
  // Active CPU", mail reçu le 08/07) : cette boucle interne — 1 fetch ESPN +
  // toute la logique de détection par match, à CHAQUE passe — tournait 4x/min,
  // 1440 fois/jour (cron-job.org), soit jusqu'à ~5760 passes/jour. C'est de
  // très loin le plus gros poste de calcul actif de tout le projet, largement
  // responsable d'avoir atteint le plafond gratuit alors qu'il reste encore
  // des jours de Mondial. Repassé à 1 seule passe par appel (BUDGET_MS=0) :
  // on retombe sur la cadence native de cron-job.org (1 appel/min, pas de
  // boucle interne), ce qui réduit le calcul actif d'environ 4x d'un coup.
  // Contrepartie honnête : le pire délai remonte à environ 60s (au lieu de
  // ~35s avec 4 passes) pour une notif de but. Si le tableau de bord Vercel
  // (Usage → Fluid Active CPU) repasse sous le plafond avec de la marge, ces
  // deux constantes peuvent être remontées prudemment (ex: 2 passes) — je n'ai
  // pas accès à ce tableau de bord donc je ne peux pas calibrer plus finement
  // à distance.
  const BUDGET_MS         = 0       // 1 seule passe par appel — voir commentaire ci-dessus
  const POLL_INTERVAL_MS  = 8_000
  const loopStart = Date.now()
  const allLogs   = []
  let totalNotifs = 0
  let totalEvents = 0
  let passes      = 0

  while (true) {
    const passStart = Date.now()
    // ⚠️ Durcissement : si runOnePass() lève une erreur inattendue AVANT même
    // d'entrer dans la boucle par-match (ex: le fetch ESPN groupé plante), on
    // ne veut pas perdre TOUTE la réponse HTTP (et donc que cron-job.org voie
    // un échec/timeout au lieu d'un 200 avec le détail de l'erreur). On log
    // et on arrête proprement la boucle plutôt que de laisser l'exception
    // remonter jusqu'au handler (qui n'a pas de try/catch englobant).
    try {
      const result = await runOnePass()
      totalNotifs += result.notifsSent
      totalEvents  = result.events
      allLogs.push(`[pass ${passes + 1}] notifs=${result.notifsSent} events=${result.events}`, ...result.log)
      passes++
    } catch (e) {
      allLogs.push(`[pass ${passes + 1}] ERREUR passe entière : ${e.message}`)
      break
    }

    const elapsedTotal = Date.now() - loopStart
    const remaining    = BUDGET_MS - elapsedTotal
    if (remaining <= POLL_INTERVAL_MS) break // pas assez de marge pour une passe de plus
    const elapsedPass = Date.now() - passStart
    await new Promise(r => setTimeout(r, Math.max(0, POLL_INTERVAL_MS - elapsedPass)))
  }

  // Résultat détaillé de CETTE exécution — utile pour /api/debug-push (voir
  // marqueur lastRun plus haut) : distingue "0 notif car rien à notifier" de
  // "le cron ne tourne plus du tout".
  try {
    await kv.set('cron:goals:lastResult', JSON.stringify({
      at: Date.now(), events: totalEvents, notifsSent: totalNotifs, passes,
    }), { ex: 7 * 24 * 3600 })
  } catch {}

  // ⚠️ Historique persistant des logs (constat utilisateur : notifs de but/fin
  // de match manquées sans qu'on puisse voir a posteriori ce qui s'est passé
  // côté serveur — jusqu'ici, `log` n'existait que dans la réponse HTTP de
  // CET appel précis, jamais consultable après coup). On empile chaque ligne
  // (préfixée d'un horodatage) dans une liste Redis glissante, exposée par
  // /api/debug-push, pour pouvoir diagnostiquer un incident après qu'il se
  // soit produit plutôt que de deviner sans preuve.
  try {
    if (allLogs.length) {
      const stamped = allLogs.map(l => `${new Date().toISOString()} ${l}`)
      await kv.rpush('cron:goals:logHistory', ...stamped)
      // ⚠️ RELEVÉ (constat direct via /api/debug-push, demandé par l'utilisateur
      // pour diagnostiquer une notif de but manquante) : même sans aucun match
      // live, la ligne "[pass N] notifs=0 events=Y" à elle seule tourne autour
      // de 4 lignes/minute (une par passe) → ~5760 lignes/jour rien qu'en
      // bruit de fond, ce qui dépassait le cap de 4000 en MOINS DE 24h — donc
      // bien avant que la fenêtre glissante ait la moindre chance de couvrir
      // un match joué la veille, contrairement à ce que suggérait le
      // commentaire précédent ("vise plusieurs heures"). C'est très
      // probablement pourquoi la soirée Argentine-Égypte n'était déjà plus
      // dans l'historique le lendemain. Cap relevé 4000 → 30000 et fenêtre
      // 24h → 96h (4 jours) : de quoi couvrir un jour de bruit de fond +
      // plusieurs matchs live avec de la marge, pour pouvoir vérifier un
      // incident signalé le lendemain (voire 2-3 jours après).
      await kv.ltrim('cron:goals:logHistory', -30_000, -1)
      await kv.expire('cron:goals:logHistory', 4 * 24 * 3600)
    }
  } catch {}

  return res.status(200).json({
    ok: true,
    slugs: ESPN_SLUGS.length,
    passes,
    events: totalEvents,
    notifsSent: totalNotifs,
    log: allLogs,
  })
}
