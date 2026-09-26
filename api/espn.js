// Proxy ESPN — scores live, historique daté, et summary (stats live)
//
// ⚠️ Cache Redis ajouté sur le mode "summary" (buts/cartons + stats + compos
// d'un match précis) : avant, chaque requête tapait ESPN en direct, sans
// aucune mémoire partagée. Conséquence concrète pour l'utilisateur : les
// compos/stats d'un match n'étaient dispos dans "Résultats" QUE si LUI-MÊME
// (ou quelqu'un) l'avait ouvert pendant que ESPN avait encore la donnée
// (souvent limité dans le temps, surtout pour la CM) — et rien n'était
// jamais partagé entre utilisateurs (que du localStorage côté client).
// Le cache Redis ici est PARTAGÉ entre tous les utilisateurs : dès qu'UN
// SEUL visiteur (ou le cron, voir cron-goals.js) réussit à récupérer la
// donnée, elle reste dispo pour tout le monde ensuite, même si ESPN cesse
// de la servir plus tard.
//
// ⚠️ AJOUT (demande utilisateur explicite : "les stats et tout doivent rester
// en cache très longtemps sans jamais disparaître" — voir plus bas pour le
// cache permanent d'un match terminé) : un payload ESPN /summary brut pèse
// ~90 Ko (cotes, chaînes TV, classements de meilleurs joueurs, liens vers les
// pages joueur/club, photos... jamais lus par l'app, en plus des buts/cartons/
// stats/compos réellement affichés). Avec un cache Redis PERMANENT, stocker
// le payload brut pour chaque match de chaque compétition couverte
// approcherait la limite de stockage du tier gratuit Upstash (256 Mo) en
// environ une saison. compactEspnSummary() (voir src/utils/espnSummaryParse.js)
// réduit CE QUI EST MIS EN CACHE ET RENVOYÉ AU CLIENT au strict nécessaire —
// { scorers, cards, stats, lineups }, ~1-2 Ko/match — même donnée affichée à
// l'écran, permanent sans jamais s'approcher de la limite.
import { Redis } from '@upstash/redis'
import { compactEspnSummary, compactEspnStandings, extractGoalsFromSummary } from '../src/utils/espnSummaryParse.js'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const ALLOWED_SLUGS = new Set([
  'fra.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1',
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
  'fifa.world', 'uefa.euro',
  // Ligue des Nations / CAN / Copa America — tournois ponctuels, absents de
  // football-data.org en free tier (voir CLAUDE.md), couverts via ESPN.
  'uefa.nations', 'caf.nations', 'conmebol.america',
  // Coupes nationales — absentes de football-data.org en free tier, fusionnées
  // dans l'onglet du championnat parent (voir espnAdapter.js / useMatchs.js).
  'fra.coupe_de_france', 'esp.copa_del_rey', 'eng.fa',
  // ⚠️ AJOUT (16/08, bug réel trouvé en creusant "pourquoi PSG-Lens
  // n'apparaît pas dans Accueil malgré l'intégration ESPN côté client") :
  // supercoupes nationales/européennes à 1 match/an — espnAdapter.js/
  // competitions.js/espnSlugs.js savaient déjà tous les 3 récupérer ces
  // matchs (fetchEspnCompMatches → fetch('/espn?slug=...')), mais CETTE
  // liste, séparée et jamais synchronisée avec les autres, rejetait la
  // requête en 400 ("Slug non autorisé") avant même d'atteindre ESPN. USC
  // (Supercoupe UEFA, déjà présente dans l'app depuis un moment) avait
  // exactement le même problème, resté invisible jusqu'ici faute d'un match
  // suivi de près au bon moment — pas seulement TDC/CS, un vrai bug
  // préexistant révélé par cet ajout.
  'uefa.super_cup', 'fra.super_cup', 'eng.charity',
])

// ⚠️ HISTORIQUE (retour utilisateur : "Statistiques indisponibles" sur des
// matchs vieux d'une semaine+) : 7j puis 180j — à chaque fois, passé le
// délai, le cache expirait et l'app retentait un fetch ESPN EN DIRECT pour un
// event vieux, qu'ESPN ne sert plus forcément aussi complètement
// (boxscore/rosters).
// ⚠️ AJOUT (demande utilisateur explicite : "que les stats et tout restent en
// cache très longtemps sans jamais disparaître") : un match TERMINÉ ne change
// plus JAMAIS — un TTL, même de 180j, reste une limite arbitraire. Ce cache
// n'a désormais plus de `ex` du tout pour un match terminé (voir plus bas,
// `isMatchFinished(parsed)`) : la clé Redis Upstash correspondante n'expire
// jamais. Volume négligeable pour ce projet (quelques centaines de
// matchs/saison). Seul le match encore EN COURS garde un TTL court
// (LIVE_SUMMARY_CACHE_TTL) — ses stats évoluent réellement.
// ⚠️ ABAISSÉ 45s→15s (demande utilisateur, 24/07) : ce cache est PARTAGÉ (Redis,
// côté serveur) entre TOUS les visiteurs d'un même match — le baisser augmente
// la fréquence des vrais appels ESPN par match live, mais PAS le coût par
// visiteur (toujours 1 seul fetch réel par fenêtre, peu importe le nombre de
// spectateurs). Incohérence trouvée en creusant : fifa-live.js utilise déjà
// 10s pour un fetch quasi identique (mêmes stats poss/tirs/corners, voir
// SUMMARY_TTL) — 45s ici semblait être resté en retard sur ce même correctif
// ("les stats live ont l'air figées", déjà traité là-bas). 15s : plus proche
// de la fraîcheur déjà établie ailleurs, sans aller aussi vite que le 10s
// (pas de certitude absolue que les 2 chemins sont strictement comparables).
const LIVE_SUMMARY_CACHE_TTL = 15

// ⚠️ BUG CORRIGÉ (constat utilisateur très précis : "les compos d'un match
// terminé ne marchent qu'une fois sur dix, et une fois loupées ça ne
// revient jamais même en réessayant") : le cache Redis d'un match TERMINÉ
// était mis en PERMANENT (pas de `ex`, voir plus bas) dès que
// hasUsefulData() était vrai — or hasUsefulData() est vrai dès que les
// STATS SEULES sont présentes, même si la compo (lineups) est absente.
// ESPN publie parfois la compo avec un délai après le coup de sifflet, ou
// ne la publie jamais pour certaines rencontres (couverture variable selon
// la compétition) — mais le premier fetch qui "gagnait la course" (souvent
// juste après FT, rosters pas encore là) figeait alors `lineups: null`
// DANS LE CACHE PERMANENT, et plus aucun fetch frais n'était jamais
// retenté pour ce match, quel que soit le nombre de réouvertures de l'app :
// le proxy servait indéfiniment ce même null depuis Redis. D'où le "une
// fois sur dix" observé : seuls les matchs dont le TOUT PREMIER fetch avait
// la chance de tomber sur une compo déjà publiée s'affichaient, pour
// toujours ; tous les autres restaient bloqués sur "aucune compo
// disponible" pour toujours aussi.
// Fix : cache permanent réservé au cas où la compo EST là (donnée
// définitivement complète) ; sinon TTL généreux mais fini, pour qu'une
// consultation ultérieure ait une vraie chance de retomber sur une compo
// entre-temps publiée par ESPN.
const LINEUPS_PENDING_TTL = 24 * 60 * 60 // 24h — match terminé mais compo pas encore publiée par ESPN

// ⚠️ AJOUT (15/09, constat utilisateur : "match du jour" disparaît alors que
// le match en question est bien en cours — investigation a révélé un bug
// beaucoup plus large que la carte elle-même) : ESPN a commencé à rejeter
// (400) toute requête scoreboard dont la plage `dates=DEBUT-FIN` dépasse 7
// jours calendaires — confirmé par test direct sur plusieurs slugs (esp.1,
// eng.1, uefa.champions), avec une recherche par dichotomie qui isole le
// seuil exact : 7 jours passe, 8 jours échoue systématiquement. Avant ce
// changement (pas de notre fait — jamais documenté comme limite auparavant,
// voir l'historique de `windowRange()` dans espnAdapter.js qui utilisait
// cette plage EXACTE sans souci le 05/09), CE PROXY renvoyait la plage large
// (60j avant / 150j après, voir DAYS_BACK/DAYS_FORWARD côté client) en UN
// SEUL appel ESPN. Cassé net : `fetchEspnWindowJson` (espnAdapter.js),
// utilisé par TOUTE compétition sourcée ESPN (6 grands championnats + CL/
// UEL/UECL/NL/CAN/COPA/USC/TDC/CS + coupes nationales) échouait
// silencieusement (repli sur cache local périmé, voir son commentaire) —
// pas seulement le "match du jour", mais une bonne partie des données
// Accueil/team-form pour ces compétitions.
// Plutôt que de réduire la fenêtre (perdrait la couverture qui existait déjà
// — ex. trouver le "prochain jour avec un match" jusqu'à 30j en avance pour
// une compétition sporadique comme la Ligue des Nations, cf. l'historique de
// ce bug le 28/07 dans CLAUDE.md) ou de faire chunker le CLIENT (multiplierait
// par ~30 le nombre de requêtes comptées contre SON PROPRE plafond
// ratelimit:espn:{ip}, 100/60s — le ferait exploser dès le 1er chargement),
// le découpage se fait ICI, côté serveur : le client envoie TOUJOURS une
// seule requête (contrat inchangé, `{ events: [...] }`), et CE proxy la
// découpe en tranches ≤7j, chacune interrogée UNE FOIS puis mise en cache
// Redis PARTAGÉ entre tous les visiteurs (comme le reste de ce fichier) — le
// vrai coût réseau vers ESPN ne dépend donc que du nombre de tranches
// distinctes (slug × semaine), pas du nombre de visiteurs ni du nombre de
// requêtes client.
// ⚠️ MIS À JOUR (16/09, constat utilisateur : "j'ai plus rien dans accueil"
// juste après le déploiement du découpage par tranches de 7j ci-dessous) :
// re-testé en direct sur la prod — même une plage de SEULEMENT 2 jours
// (`dates=20260916-20260917`) était désormais rejetée en 400, alors qu'un
// test répété quelques heures plus tôt le même jour avait mesuré un seuil
// à 7j. Conclusion la plus probable : ESPN ne rejette pas "au-delà de 7j"
// de façon stable — le comportement est instable/en train de se durcir
// (possiblement lié à mes propres tests en rafale du jour, voir l'incident
// 403 documenté plus bas ; possiblement un changement côté ESPN indépendant
// de nous). Seul format encore confirmé fiable au moment de ce correctif :
// une DATE UNIQUE, sans aucun tiret (`dates=20260916` → 200 OK, vérifié en
// direct). Plutôt que de continuer à deviner un nouveau seuil de plage,
// chaque tranche envoyée à ESPN est désormais une SEULE date, sans tiret, le
// seul format qui n'a jamais échoué (voir splitScoreboardRange plus bas, qui
// découpe systématiquement en dates individuelles). Pour rester dans un
// temps d'exécution raisonnable (limite Vercel, voir vercel.json) malgré ce
// découpage bien plus fin, la fenêtre demandée par le client est réduite en
// parallèle (voir DAYS_BACK/DAYS_FORWARD dans espnAdapter.js, 60/150 → 30/45).
// Passé (dernier jour de la tranche < aujourd'hui) : matchs FINISHED,
// immuables — cache long. Futur lointain (1er jour de la tranche > 2j après
// aujourd'hui) : matchs SCHEDULED, changent rarement (report/replanification
// possible mais rare) — cache moyen. Une tranche qui touche aujourd'hui ±2j
// n'est JAMAIS mise en cache : c'est la seule zone qui doit rester "live",
// même contrat que le mode scoreboard non-chunké (voir plus bas, toujours
// `no-store` pour une requête simple).
const SCOREBOARD_PAST_CHUNK_TTL   = 24 * 60 * 60 // 24h
const SCOREBOARD_FUTURE_CHUNK_TTL = 2  * 60 * 60 // 2h

function ymd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}
function parseYmd(s) {
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`)
}

// Découpe `DEBUT-FIN` (ou une date simple, retournée telle quelle) en
// dates individuelles SANS tiret (voir commentaire ci-dessus, 16/09) — chaque
// tranche envoyée à ESPN est maintenant au format exact confirmé fiable.
function splitScoreboardRange(dates) {
  if (!dates.includes('-')) return [dates]
  const [startStr, endStr] = dates.split('-')
  const start = parseYmd(startStr)
  const end   = parseYmd(endStr)
  if (!(start <= end)) return [dates] // plage invalide — laisser ESPN renvoyer son erreur telle quelle

  const chunks = []
  let d = start
  while (d <= end) {
    chunks.push(ymd(d)) // date simple, sans tiret
    d = new Date(d.getTime() + 86_400_000)
  }
  return chunks
}

// TTL Redis (secondes) pour une tranche donnée, ou `null` si elle doit rester
// live (jamais mise en cache) — voir le commentaire au-dessus.
function scoreboardChunkTtl(chunkDates) {
  const [startStr, endStr] = chunkDates.includes('-') ? chunkDates.split('-') : [chunkDates, chunkDates]
  const today      = new Date(); today.setUTCHours(0, 0, 0, 0)
  const todayPlus2 = new Date(today.getTime() + 2 * 86_400_000)
  if (parseYmd(endStr) < today) return SCOREBOARD_PAST_CHUNK_TTL
  if (parseYmd(startStr) > todayPlus2) return SCOREBOARD_FUTURE_CHUNK_TTL
  return null
}

// ⚠️ AJOUT (21/09, demande explicite utilisateur — commandes Upstash/CPU actif
// Vercel en forte hausse) : jusqu'ici, `fetchScoreboardChunk` faisait un
// `kv.get` INDIVIDUEL par tranche pour vérifier le cache — avec des fenêtres
// désormais découpées en dates individuelles (16/09, voir plus haut, jusqu'à
// ~75 tranches par compétition) et ~17 compétitions ESPN suivies au total
// (ESPN_SOURCED_COMPS + coupes nationales, voir useTodayMatches.js), un seul
// chargement de page pouvait déclencher plus de 1000 commandes Redis rien
// que pour VÉRIFIER le cache. Même principe déjà en place ailleurs dans ce
// projet pour exactement ce problème (voir api/fifa-live.js, `kv.mget` sur
// `espn:sum:*`/`espn:fb:*`, et cf-worker/src/index.js, MGET sur les clés de
// suivi par match, 10/09) : Upstash facture un MGET de N clés comme UNE
// SEULE commande, peu importe N. Toutes les clés de cache des tranches
// CACHEABLES (celles qui ont un TTL défini — passé/futur lointain, voir
// `scoreboardChunkTtl` ; la zone "live" ±2j autour d'aujourd'hui n'est
// JAMAIS mise en cache, inchangé) sont donc lues en un seul aller-retour
// AVANT de lancer le moindre fetch ESPN — voir `readCachedChunks` plus bas,
// appelée une fois dans le handler avant `fetchScoreboardChunksStaggered`.
// Seules les tranches réellement absentes du cache (vrai cache miss) ou
// "live" déclenchent encore un vrai fetch ESPN, TOUJOURS par petits groupes
// espacés (voir `fetchScoreboardChunksStaggered` plus bas, INCHANGÉE — c'est
// ce qui protège contre le blocage anti-rafale ESPN, incident 403 du 15/09,
// voir plus haut) : ce changement ne touche QUE la lecture du cache, jamais
// la façon dont ESPN lui-même est interrogé.
function safeJsonChunk(val) {
  if (!val) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return null } }
  return val
}

// Lit d'un coup (1 seule commande Redis, voir commentaire ci-dessus) l'état
// de cache de toutes les tranches CACHEABLES d'une liste — retourne une Map
// chunkDates → résultat déjà prêt (`{ ok: true, events }`) pour les seules
// tranches trouvées en cache. Les tranches absentes de cette Map (cache
// miss OU zone "live" jamais cachée) doivent encore être fetchées pour de
// vrai (voir `fetchScoreboardChunksStaggered`).
async function readCachedChunks(slug, chunkList) {
  const cacheable = chunkList
    .map(chunk => ({ chunk, ttl: scoreboardChunkTtl(chunk) }))
    .filter(x => x.ttl != null)
  const hits = new Map()
  if (cacheable.length === 0) return hits
  try {
    const values = await kv.mget(...cacheable.map(x => `espn:sb:${slug}:${x.chunk}`))
    cacheable.forEach((x, i) => {
      const parsed = safeJsonChunk(values[i])
      if (parsed) hits.set(x.chunk, { ok: true, events: parsed.events ?? [] })
    })
  } catch { /* Redis indisponible → toutes les tranches retombent en fetch direct */ }
  return hits
}

// Fetch RÉEL d'une tranche auprès d'ESPN (le cache a déjà été vérifié en
// amont par `readCachedChunks` — cette fonction n'est plus appelée QUE pour
// un vrai cache miss ou une tranche "live"). AbortController dédié par
// tranche (indépendant de celui de la requête simple plus bas) : plusieurs
// tranches sont interrogées en petits groupes (voir
// fetchScoreboardChunksStaggered plus bas), chacune doit pouvoir s'annuler
// sans affecter les autres.
// ⚠️ Retourne `{ ok, events }` et NON directement `{ events }` (15/09,
// corrigé avant même le 1er déploiement de ce mécanisme) : si une tranche
// échoue réellement (ESPN en panne/bloque, timeout), la confondre avec "0
// match sur cette période" aurait fait perdre le filet de sécurité déjà en
// place côté client (`fetchEspnCompMatches`, espnAdapter.js) — qui ne retombe
// sur le cache local périmé QUE si `res.ok` est faux. Un merge qui renvoyait
// toujours 200 avec `events:[]` en cas d'échec aurait donc fait écraser un
// cache client valide par une liste vide à la moindre panne ESPN, PIRE que
// le comportement d'avant ce correctif.
async function fetchScoreboardChunk(slug, chunkDates) {
  const ttl = scoreboardChunkTtl(chunkDates)
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${chunkDates}&limit=100`
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, events: [] } // une tranche en échec ne doit pas faire tomber tout le reste
    const json = await response.json()
    if (ttl != null) {
      kv.set(`espn:sb:${slug}:${chunkDates}`, JSON.stringify(json), { ex: ttl }).catch(() => {})
    }
    return { ok: true, events: json.events ?? [] }
  } catch {
    return { ok: false, events: [] }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ⚠️ AJOUT (15/09, incident constaté PENDANT le tout premier test de ce
// mécanisme) : envoyer TOUTES les tranches d'un coup en Promise.all (jusqu'à
// ~31 pour la fenêtre complète 60j/150j) a fait répondre ESPN en 403 sur les
// requêtes suivantes, y compris des requêtes simples déjà validées quelques
// minutes plus tôt — un vrai blocage anti-rafale côté ESPN, déclenché par ce
// nombre de requêtes simultanées depuis la même IP serveur (celle de Vercel).
// Même principe déjà appliqué côté client pour la même raison
// (ESPN_CALL_STAGGER_MS, useTodayMatches.js/useMatchs.js) : petits groupes de
// GROUP_SIZE tranches à la fois, avec une pause entre chaque groupe, plutôt
// qu'une rafale totale. Les tranches déjà en cache Redis (le cas normal une
// fois la fenêtre "chauffée" une 1ère fois) ne comptent pas dans la rafale —
// seuls les VRAIS appels ESPN sont espacés (le cache répond immédiatement).
// ⚠️ AJUSTÉ (16/09, en même temps que le passage à des tranches d'1 jour) :
// beaucoup plus de tranches par fenêtre désormais (jusqu'à ~75 au lieu de
// ~31) — groupes légèrement plus larges (6 au lieu de 5) avec un espacement
// un peu réduit (150ms au lieu de 200ms) pour rester sous la limite
// d'exécution Vercel (maxDuration, voir vercel.json) sur un cache totalement
// froid, tout en gardant un vrai espacement anti-rafale (l'incident 403 du
// 15/09 avait été déclenché par une rafale de ~31 requêtes SIMULTANÉES sans
// aucun espacement — un groupe de 6 espacé de 150ms reste loin de ce
// scénario).
const CHUNK_GROUP_SIZE   = 6
const CHUNK_GROUP_DELAY_MS = 150

async function fetchScoreboardChunksStaggered(slug, chunkList) {
  const results = []
  for (let i = 0; i < chunkList.length; i += CHUNK_GROUP_SIZE) {
    const group = chunkList.slice(i, i + CHUNK_GROUP_SIZE)
    results.push(...await Promise.all(group.map(c => fetchScoreboardChunk(slug, c))))
    if (i + CHUNK_GROUP_SIZE < chunkList.length) {
      await new Promise(r => setTimeout(r, CHUNK_GROUP_DELAY_MS))
    }
  }
  return results
}

// Fusionne les tranches : `ok:false` si TOUTES ont échoué (préserve le filet
// de sécurité client, voir commentaire de fetchScoreboardChunk), sinon
// combine les `events` de celles qui ont réussi — dédupliqués par id (les
// tranches sont construites contiguës/non chevauchantes, mais un événement à
// cheval sur minuit UTC pourrait apparaître dans 2 tranches adjacentes selon
// la version de l'API ESPN — sécurité peu coûteuse).
function mergeScoreboardChunks(results) {
  const anyOk = results.some(r => r.ok)
  if (!anyOk) return { ok: false, events: [] }
  const seen = new Set()
  const events = []
  for (const r of results) {
    for (const e of r.events) {
      if (!e?.id || seen.has(e.id)) continue
      seen.add(e.id)
      events.push(e)
    }
  }
  return { ok: true, events }
}

// ── "Buteurs fait maison" (26/09) ───────────────────────────────────────
// Voir extractGoalsFromSummary (src/utils/espnSummaryParse.js) pour le
// contexte complet : remplace l'endpoint ESPN `/statistics` (retiré le même
// jour — cumul historique buggé, pas la saison en cours) par un calcul MAISON
// à partir des vrais matchs. Réutilise l'infra scoreboard déjà en place
// ci-dessus (readCachedChunks/fetchScoreboardChunksStaggered/
// mergeScoreboardChunks) pour découvrir les matchs joués jour par jour, sans
// aucun coût réseau supplémentaire pour les jours déjà en cache pour une
// autre raison (Programme/Résultats). Piloté sur NL uniquement pour l'instant
// (voir HOMEMADE_SCORERS_COMPS, data/competitions.js) — UEL/UECL ont
// beaucoup plus de matchs par journée, à valider séparément avant extension.
const HOMEMADE_SCORERS_FRESH_MS = 10 * 60 * 1000 // 10min — au-delà, un nouveau scan incrémental est tenté
// Marge large sur la 1ère journée de Ligue des Nations 2026-27, déjà jouée
// au moment de l'ajout de cette fonctionnalité (24-26/09) — couvre un
// éventuel 1er appel à froid (cache jamais chauffé) sans avoir à deviner la
// date exacte de reprise de la compétition.
const HOMEMADE_SCORERS_INITIAL_LOOKBACK_DAYS = 35

function isEventFinished(evt) {
  const t = evt?.status?.type
  return t?.completed === true || t?.name === 'STATUS_FULL_TIME' || t?.name === 'STATUS_FINAL'
}

// Détail but-par-but d'UN match, mis en cache PERMANENT par eventId (un match
// FINAL déjà confirmé ne rejoue jamais ses buts — même principe que le cache
// permanent du mode summary plus haut, mais volontairement séparé de
// `espn:summary:v2:*` : ce dernier ne garde QUE le format compact
// {scorers,cards,stats,lineups} sans id joueur, inutilisable tel quel pour
// une agrégation par joueur, et c'est un chemin partagé avec la détection
// live des buts (cron-goals.js/cf-worker) qu'il ne faut jamais reduppliquer
// ni fragiliser pour cette fonctionnalité annexe).
async function fetchEventSummaryGoals(slug, eventId, debugInfo) {
  const eventCacheKey = `espn:ownscorers:event:v2:${slug}:${eventId}`
  try {
    const cached = await kv.get(eventCacheKey)
    if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached
  } catch { /* Redis indisponible → on retente un fetch direct ci-dessous */ }

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      signal: controller.signal,
    })
    if (!response.ok) {
      debugInfo?.push({ eventId, status: response.status })
      return null // échec réel (pas "0 but") — jamais mis en cache, retenté au prochain scan
    }
    const json = await response.json()
    const teamCrests = {}
    for (const c of (json?.header?.competitions?.[0]?.competitors ?? [])) {
      if (c.team?.id) teamCrests[String(c.team.id)] = c.team.logos?.[0]?.href ?? null
    }
    const goals = extractGoalsFromSummary(json).map(g => ({ ...g, teamCrest: teamCrests[g.teamId] ?? null }))
    kv.set(eventCacheKey, JSON.stringify(goals)).catch(() => {}) // pas de `ex` : permanent, comme documenté ci-dessus
    debugInfo?.push({ eventId, status: 'ok', goals: goals.length })
    return goals
  } catch (err) {
    debugInfo?.push({ eventId, status: 'exception', message: String(err) })
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

// Additionne les buts déjà connus (chaque `goals` = le détail permanent d'UN
// match, voir fetchEventSummaryGoals) en un classement {player, team, goals,
// assists} — même contrat que football-data.org, déjà consommé tel quel par
// Classement.jsx. Passes décisives comptées en 2e passe, uniquement pour un
// joueur déjà connu comme buteur au moins une fois (extractGoalsFromSummary
// ne garde que l'id du passeur, pas son nom — un passeur qui n'a jamais
// marqué n'a donc pas assez d'info pour une entrée `player` complète ; limite
// assumée, sans impact réel puisque Classement.jsx n'affiche les passes qu'en
// info secondaire, jamais comme critère de tri principal).
function aggregateGoals(goalLists) {
  const players = new Map()
  for (const goals of goalLists) {
    for (const g of goals) {
      const cur = players.get(g.athleteId) ?? {
        player: { id: g.athleteId, name: g.athleteName },
        team:   { id: g.teamId, name: g.teamName, shortName: g.teamName, crest: g.teamCrest ?? null },
        goals: 0, assists: 0,
      }
      cur.goals += 1
      players.set(g.athleteId, cur)
    }
  }
  for (const goals of goalLists) {
    for (const g of goals) {
      if (!g.assistAthleteId) continue
      const cur = players.get(g.assistAthleteId)
      if (cur) cur.assists += 1
    }
  }
  return [...players.values()].sort((a, b) => (b.goals - a.goals) || (b.assists - a.assists))
}

// ⚠️ AJOUT (retour utilisateur : stats/déroulement d'un match terminé parfois
// manquants ou incomplets — "des fois ça marche, des fois pas") : jusqu'ici,
// pour afficher les stats d'un match terminé, CHAQUE appareil de CHAQUE
// utilisateur devait retrouver lui-même l'eventId ESPN en interrogeant le
// scoreboard du jour et en comparant les noms d'équipe (fetchEspnEventsDual,
// useMatchDetail.js) — refait de zéro à chaque fois, jamais partagé. Pour un
// vieux match qu'ESPN ne liste plus aussi facilement sur son scoreboard, cette
// recherche pouvait échouer ou mal matcher selon le moment exact de la
// requête — d'où l'incohérence "des fois oui, des fois non" observée.
// espnMap:{fdMatchId} mémorise ce mapping UNE FOIS résolu (par n'importe quel
// appareil), pour que TOUS les autres ensuite sautent cette recherche fragile
// et aillent direct au résumé ESPN. L'association match↔eventId ne change
// jamais une fois établie → pas de TTL (voir kv.set(`espnMap:...`) plus bas),
// même logique que les autres caches "définitifs" de ce fichier.

// ⚠️ Historique (constat utilisateur : "les stats live ont l'air figées") :
// un summary fetché juste avant/après le coup d'envoi (rosters dispo mais
// boxscore encore vide) ne doit PAS être traité comme "match terminé" — un
// match encore EN COURS doit garder un TTL court (LIVE_SUMMARY_CACHE_TTL),
// seul un match réellement terminé passe en cache permanent.
function isMatchFinished(json) {
  const statusName = json?.header?.competitions?.[0]?.status?.type?.name
  const completed  = json?.header?.competitions?.[0]?.status?.type?.completed
  return completed === true || statusName === 'STATUS_FULL_TIME' || statusName === 'STATUS_FINAL'
}

// ⚠️ AJOUT (21/09, demande explicite utilisateur — commandes Upstash
// toujours trop élevées même après le batching mget + cache Edge du mode
// scoreboard) : même principe étendu au mode "summary" — un match TERMINÉ
// avec compo publiée est une donnée IMMUABLE, déjà en cache Redis PERMANENT
// (voir isMatchFinished/hasLineups ci-dessous), mais la RÉPONSE HTTP restait
// marquée `no-store` dans tous les cas — donc CHAQUE consultation (n'importe
// qui parcourant "Résultats" et cliquant sur un vieux match pour voir ses
// stats/compo) réinvoquait quand même la fonction + au moins 1 commande
// Redis, pour une donnée qui ne change plus jamais. `_cacheHint` (embarqué
// UNIQUEMENT dans la valeur stockée en Redis via JSON.stringify, JAMAIS
// renvoyé tel quel au client — voir strip plus bas) mémorise à quel "cycle
// de vie" appartient l'entrée au moment de l'écriture, pour choisir le bon
// Cache-Control SANS commande Redis supplémentaire (pas de kv.ttl() par
// requête, qui aurait juste déplacé le problème) :
//   - 'permanent' (terminé + compo) : cache Edge long (24h) — la donnée ne
//     changera plus jamais, autant la servir directement depuis le réseau
//     Vercel pour toute consultation future de ce match précis.
//   - 'pending'   (terminé, compo pas encore publiée par ESPN, TTL Redis
//     24h) : cache Edge modéré (5min) — laisse une vraie chance à une
//     consultation ultérieure de retomber sur une compo entre-temps publiée,
//     sans resservir un cache HTTP vieux de plusieurs heures.
//   - 'live' (ou absent — entrée "legacy" écrite avant ce déploiement, sans
//     le hint) : cache Edge TRÈS court (10s), aligné sur LIVE_SUMMARY_
//     CACHE_TTL déjà en place — ne rend RIEN de plus périmé que ce que Redis
//     autorisait déjà (le TTL Redis reste le vrai garde-fou de fraîcheur),
//     seulement PARTAGÉ entre tous les spectateurs simultanés du même match
//     au lieu d'un aller-retour Redis par spectateur — le scénario qui
//     compte le plus (plusieurs personnes regardant le même match populaire
//     en même temps).
// Honnêteté : les entrées PERMANENTES déjà en Redis avant ce déploiement
// (des centaines de matchs déjà terminés) n'ont pas ce hint — elles restent
// sur le seuil "live" (10s) par défaut, un vrai mieux par rapport à avant
// (no-store) mais pas le gain maximal, tant qu'elles ne sont pas réécrites
// naturellement (ce qui n'arrive plus jamais pour une entrée permanente déjà
// correcte) — seuls les matchs qui se termineront APRÈS ce déploiement
// profitent du cache 24h dès le départ.
function summaryCacheControlFor(hint) {
  if (hint === 'permanent') return 'public, s-maxage=86400, stale-while-revalidate=604800'
  if (hint === 'pending')   return 'public, s-maxage=300, stale-while-revalidate=900'
  return 'public, s-maxage=10, stale-while-revalidate=30'
}

// Un résultat compacté "utile" contient au moins des stats ou une compo —
// évite de mettre en cache une réponse vide/quasi-vide qui bloquerait un
// refetch utile plus tard (le cache serait alors permanent pour RIEN).
// ⚠️ Historique : cette fonction vérifiait avant la présence de rosters/
// boxscore/header-roster sur le JSON BRUT ESPN — désormais redondant, cette
// même détection (y compris le repli header.competitions[].competitors[].roster
// pour la CM, où ESPN ne remplit quasiment jamais json.rosters) est déjà faite
// à l'intérieur de compactEspnSummary()/extractLineups() — on vérifie
// directement le résultat compacté.
function hasUsefulData(compact) {
  return !!(compact?.stats || compact?.lineups?.home?.starters?.length)
}

// ⚠️ BUG CORRIGÉ (constat utilisateur juste après le déploiement de la
// compaction : "plus de stats live complètes" + "plus de compos pour les
// matchs terminés") : tout ce qui était déjà en cache Redis AVANT ce
// déploiement (potentiellement des centaines de matchs déjà stockés en
// PERMANENT, voir isMatchFinished plus bas) est encore au format BRUT ESPN
// (header/boxscore/rosters, ~90 Ko), pas au nouveau format compact. Le
// cache-hit ci-dessous renvoyait ce JSON brut tel quel avec l'étiquette
// "c'est le format compact" — les hooks client (qui ne savent plus lire que
// { scorers, cards, stats, lineups }) n'y trouvaient jamais leurs champs et
// traitaient silencieusement le match comme "sans donnée". Un objet brut
// ESPN a toujours une clé `header` ou `boxscore` ; un objet compact n'en a
// jamais et a TOUJOURS `scorers`/`cards` en tableaux — marqueur fiable pour
// distinguer les deux formats sans avoir besoin de purger Redis à la main.
// Une entrée à l'ancien format est traitée comme une absence de cache : on
// retombe sur le fetch ESPN frais ci-dessous, qui réécrase la clé au format
// compact — auto-réparation progressive au fil des consultations, sans
// script de migration.
function isCompactShape(obj) {
  return !!obj && typeof obj === 'object'
    && Array.isArray(obj.scorers) && Array.isArray(obj.cards)
    && !('header' in obj) && !('boxscore' in obj)
}

export default async function handler(req, res) {
  // ⚠️ AJOUT (audit sécurité demandé par l'utilisateur) : ce proxy n'avait
  // AUCUNE limite de débit — un endpoint public appelable directement
  // (curl/bot), avec un mode "scoreboard" explicitement SANS cache (données
  // live), pouvait être martelé sans aucune défense, générant un fetch ESPN
  // réel à chaque appel. Même pattern déjà utilisé ailleurs dans l'app
  // (api/fifa-live.js, api/pulse.js, api/subscribe.js) : compteur Redis par
  // IP, fenêtre glissante de 60s.
  // ⚠️ RELEVÉ 60→100 (ajout Europa League + Conference League comme
  // compétitions ESPN suivies à part entière) : un commentaire dans
  // useTodayMatches.js documentait déjà ce plafond comme "proche voire
  // au-dessus" avec seulement 3 compétitions ESPN (NL/CAN/COPA) + 3 coupes
  // nationales — jusqu'à ~36 appels ESPN quasi simultanés rien qu'au premier
  // chargement d'Accueil (7 jours × 6 sources). Avec 2 compétitions ESPN de
  // plus, ce même calcul monte à ~50, dangereusement proche de l'ancien
  // plafond de 60 pour un usage 100% légitime (une seule vraie personne, un
  // seul chargement de page) — pas un abus. Ce plafond est une protection
  // anti-abus MAISON (voir commentaire au-dessus, `curl/bot`), pas une
  // limite imposée par ESPN elle-même : 100/60s reste largement en dessous
  // de ce qu'un vrai scraping ressemblerait, tout en gardant de la marge
  // pour un chargement de page légitime plus chargé qu'avant.
  const ip    = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rlKey = `ratelimit:espn:${ip}`
  try {
    const count = await kv.incr(rlKey)
    if (count === 1) await kv.expire(rlKey, 60)
    if (count > 100) return res.status(429).json({ error: 'Trop de requêtes' })
  } catch {}

  const { slug, dates, eventId, recap, forceFresh, fdMatchId, lookupMap, standings, computedScorers } = req.query
  const skipCache = forceFresh === '1' || forceFresh === 'true'
  // Validation minimale (fdMatchId doit être un id FD.org numérique) avant
  // toute lecture/écriture du mapping — évite d'accepter n'importe quelle
  // chaîne comme clé Redis.
  const safeFdMatchId = fdMatchId && /^\d+$/.test(String(fdMatchId)) ? String(fdMatchId) : null

  if (!slug)                    return res.status(400).json({ error: 'Paramètre slug manquant' })
  if (!ALLOWED_SLUGS.has(slug)) return res.status(400).json({ error: 'Slug non autorisé' })

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)

  try {
    // ── Mode standings : classement ESPN — source de secours indépendante de
    // football-data.org (voir useStandings.js, qui l'utilise en repli si
    // FD.org échoue) ET seule source possible pour Ligue des Nations/CAN/
    // Copa America (absentes de football-data.org en free tier, voir
    // NO_STANDINGS_COMPS dans data/competitions.js). Gratuite, sans clé,
    // jamais rencontré de suspension avec ESPN sur ce projet — voir
    // compactEspnStandings pour le détail du format ESPN et la conversion.
    // ⚠️ /apis/v2/ (PAS /apis/site/v2/, utilisé pour summary/scoreboard
    // ci-dessous) : ce dernier renvoie {} vide pour les standings soccer,
    // constaté par test réel avant d'écrire ce code.
    if (standings === '1') {
      const cacheKey = `espn:standings:${slug}`
      try {
        const cached = await kv.get(cacheKey)
        if (cached) {
          clearTimeout(timeoutId)
          const cachedObj = typeof cached === 'string' ? JSON.parse(cached) : cached
          return res.status(200)
            .setHeader('Content-Type', 'application/json')
            .setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=150')
            .json(cachedObj)
        }
      } catch { /* Redis indisponible → on continue vers le fetch direct */ }

      const standingsUrl = `https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`
      const response = await fetch(standingsUrl, {
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) return res.status(response.status).json({ error: `ESPN a répondu ${response.status}` })

      const rawBody = await response.text()
      let compact = { table: [], groups: [] }
      try {
        compact = compactEspnStandings(JSON.parse(rawBody))
        await kv.set(cacheKey, JSON.stringify(compact), { ex: 300 })
      } catch { /* JSON invalide ESPN ou KV en erreur → on renvoie quand même le résultat compacté (vide si le parse a échoué) */ }

      return res.status(200)
        .setHeader('Content-Type', 'application/json')
        .setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=150')
        .json(compact)
    }

    // ── Mode scorers ESPN `/statistics` : AJOUTÉ PUIS RETIRÉ LE MÊME JOUR
    // (26/09) — voir le commentaire détaillé dans data/competitions.js
    // (NO_SCORERS_COMPS) et useScorers.js. L'endpoint `/apis/site/v2/sports/
    // soccer/{slug}/statistics` renvoyait bien des noms/buts plausibles à
    // première vue, mais recoupé avec les propres standings ESPN, les totaux
    // se sont avérés mathématiquement impossibles pour la saison en cours
    // (ex. Portugal 1 but marqué au total vs João Félix seul à 2) —
    // vraisemblablement un cumul historique/all-time de la compétition, pas
    // la saison affichée. Mode entièrement retiré plutôt que laissé mort.
    // Remplacé par le mode `computedScorers` ci-dessous — calcul MAISON à
    // partir des vrais matchs plutôt que de faire confiance à cet endpoint.
    if (computedScorers === '1') {
      const debugEnabled = req.query.debug === '1'
      const debugInfo = debugEnabled ? [] : null
      // v2 : bump délibéré (même clé meta ET clé event, voir fetchEventSummaryGoals)
      // suite au tout 1er déploiement de cette fonctionnalité, qui avait écrit un
      // état figé "scannedThrough=aujourd'hui, doneEventIds=[...]" SANS jamais
      // avoir réussi à mettre en cache le moindre but (bug du group.forEach
      // inconditionnel corrigé juste avant, voir plus bas) — sans ce bump, cet
      // état déjà écrit resterait "frais" (HOMEMADE_SCORERS_FRESH_MS) et
      // bloquerait tout nouveau scan pendant 10min après le déploiement du fix.
      const metaKey = `espn:ownscorers:meta:v2:${slug}`
      let meta = null
      try {
        const raw = await kv.get(metaKey)
        meta = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
      } catch { /* Redis indisponible → traité comme "jamais scanné", repart d'un scan initial */ }

      const now = Date.now()
      const isFresh = meta && (now - (meta.updatedAt ?? 0)) < HOMEMADE_SCORERS_FRESH_MS

      if (!isFresh) {
        const today = new Date(); today.setUTCHours(0, 0, 0, 0)
        const scanFrom = meta?.scannedThrough
          ? new Date(parseYmd(meta.scannedThrough).getTime() + 86_400_000)
          : new Date(today.getTime() - HOMEMADE_SCORERS_INITIAL_LOOKBACK_DAYS * 86_400_000)

        const doneIds = new Set(meta?.doneEventIds ?? [])
        let nextScannedThrough = meta?.scannedThrough ?? null

        if (scanFrom <= today) {
          const dayList = []
          for (let d = scanFrom; d <= today; d = new Date(d.getTime() + 86_400_000)) dayList.push(ymd(d))

          const cachedByChunk = await readCachedChunks(slug, dayList)
          const toFetch = dayList.filter(c => !cachedByChunk.has(c))
          const fetched = await fetchScoreboardChunksStaggered(slug, toFetch)
          const merged = mergeScoreboardChunks([...cachedByChunk.values(), ...fetched])

          if (merged.ok) {
            const newFinishedIds = merged.events
              .filter(e => isEventFinished(e) && !doneIds.has(e.id))
              .map(e => e.id)

            // Groupes espacés, même précaution anti-rafale ESPN que le
            // scoreboard (incident 403 du 15/09) — un 1er scan à froid
            // pourrait sinon déclencher ~25 fetches /summary d'un coup.
            // ⚠️ Un id n'est ajouté à `doneIds` QUE si fetchEventSummaryGoals
            // a réellement réussi (renvoie un tableau, jamais `null`) — sinon
            // un simple raté réseau/timeout ESPN marquerait ce match comme
            // "déjà traité" POUR TOUJOURS, sans jamais avoir mis ses buts en
            // cache : ses buts disparaîtraient silencieusement du classement
            // sans plus jamais être retentés (bug trouvé et corrigé avant tout
            // déploiement, en vérifiant en direct pourquoi le tout 1er appel
            // renvoyait `scorers:[]`).
            for (let i = 0; i < newFinishedIds.length; i += CHUNK_GROUP_SIZE) {
              const group = newFinishedIds.slice(i, i + CHUNK_GROUP_SIZE)
              const results = await Promise.all(group.map(id => fetchEventSummaryGoals(slug, id, debugInfo)))
              group.forEach((id, idx) => { if (results[idx] != null) doneIds.add(id) })
              if (i + CHUNK_GROUP_SIZE < newFinishedIds.length) {
                await new Promise(res => setTimeout(res, CHUNK_GROUP_DELAY_MS))
              }
            }
            nextScannedThrough = ymd(today)
            if (debugInfo) debugInfo.push({ dayListLength: dayList.length, newFinishedIdsCount: newFinishedIds.length, mergedEventsCount: merged.events.length })
          } else if (debugInfo) {
            debugInfo.push({ mergedOk: false, dayListLength: dayList.length })
          }
          // merged.ok === false (ESPN indisponible sur toutes les tranches) :
          // on NE PERD PAS la progression déjà connue — scannedThrough/
          // doneEventIds restent inchangés, le prochain appel (une fois
          // HOMEMADE_SCORERS_FRESH_MS écoulé) retentera la même fenêtre.
        } else if (debugInfo) {
          debugInfo.push({ noScanNeeded: true })
        }
        // scanFrom > today : rien de nouveau à scanner, déjà à jour.

        meta = { scannedThrough: nextScannedThrough ?? ymd(today), doneEventIds: [...doneIds], updatedAt: now }
        kv.set(metaKey, JSON.stringify(meta)).catch(() => {})
      } else if (debugInfo) {
        debugInfo.push({ isFresh: true })
      }

      clearTimeout(timeoutId) // controller/timeoutId du haut de la fonction, jamais utilisé par ce mode

      const eventIds = meta?.doneEventIds ?? []
      let goalLists = []
      if (eventIds.length > 0) {
        try {
          // 1 seul kv.mget quel que soit le nombre de matchs déjà connus
          // (même optimisation Upstash qu'ailleurs dans ce fichier).
          const values = await kv.mget(...eventIds.map(id => `espn:ownscorers:event:v2:${slug}:${id}`))
          goalLists = values.map(v => {
            if (!v) return []
            try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return [] }
          })
        } catch { /* Redis indisponible → classement vide plutôt qu'une erreur, filet déjà géré côté client (useScorers.js) */ }
      }

      return res.status(200)
        .setHeader('Content-Type', 'application/json')
        .setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=150')
        .json({
          scorers: aggregateGoals(goalLists),
          ...(debugInfo ? { _debug: { meta, eventIdsCount: eventIds.length, goalListsNonEmpty: goalLists.filter(g => g.length > 0).length, steps: debugInfo } } : {}),
        })
    }

    // ── Mode lookupMap : lecture seule du mapping fdMatchId → eventId ESPN ──
    // Voir le commentaire sur espnMap plus haut pour le contexte. Écrit
    // uniquement dans le mode "eventId" ci-dessous (dès qu'un fdMatchId est
    // fourni avec un eventId déjà résolu côté client) — jamais ici, lecture seule.
    if (lookupMap === '1' && safeFdMatchId) {
      clearTimeout(timeoutId)
      try {
        const cachedEventId = await kv.get(`espnMap:${safeFdMatchId}`)
        return res.status(200)
          .setHeader('Content-Type', 'application/json')
          .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, s-maxage=0')
          .json({ eventId: cachedEventId ?? null })
      } catch {
        return res.status(200).json({ eventId: null })
      }
    }

    // ── Mode recap : lecture seule du résumé auto généré par cron-goals.js ──
    // Jamais généré ici (pas de fetch ESPN direct pour ce mode) — uniquement
    // une lecture Redis. Si rien n'est en cache, { recap: null } → le client
    // masque le composant plutôt que d'afficher un texte vide ou une erreur.
    if (eventId && recap === '1') {
      clearTimeout(timeoutId)
      try {
        const text = await kv.get(`recap:${eventId}`)
        return res.status(200)
          .setHeader('Content-Type', 'application/json')
          .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, s-maxage=0')
          .json({ recap: text ?? null })
      } catch {
        return res.status(200).json({ recap: null })
      }
    }

    if (eventId) {
      // ── Mémorisation du mapping fdMatchId → eventId (voir commentaire plus haut) ──
      // Le client envoie fdMatchId UNIQUEMENT après l'avoir déjà résolu lui-même
      // (ancienne méthode scoreboard+nom d'équipe, inchangée) — on fait juste
      // confiance à cette résolution et on la mémorise pour tout le monde
      // ensuite. Non bloquant pour la réponse (juste awaité en parallèle, coût
      // négligeable) : une erreur ici n'affecte jamais le résultat renvoyé au
      // client. Pas de TTL : ce mapping ne change jamais une fois établi.
      const mapWrite = safeFdMatchId
        ? kv.set(`espnMap:${safeFdMatchId}`, String(eventId)).catch(() => {})
        : Promise.resolve()

      // ── Mode summary : cache Redis partagé d'abord ──────────────────────────
      // forceFresh=1 (retour d'arrière-plan récent côté client, voir
      // window.__liveStatsForceFreshUntil dans useLiveMinute.js) contourne
      // cette lecture pour ne pas resservir un instantané potentiellement
      // périmé — le fetch frais ci-dessous réécrit quand même le cache après,
      // au bénéfice des autres utilisateurs.
      //
      // ⚠️ Ce qui est mis en cache ET renvoyé au client est désormais TOUJOURS
      // le résultat compacté (compactEspnSummary — voir en-tête de fichier),
      // que la réponse vienne du cache ou d'un fetch ESPN frais, match en
      // cours ou terminé — un seul format stable, jamais le JSON brut ESPN.
      // ⚠️ VERSION "v2" DANS LA CLÉ (05/09) — indispensable, et voici pourquoi.
      // Pour un match TERMINÉ dont la compo est publiée, l'entrée est écrite
      // SANS expiration (voir plus bas) : donnée réputée définitive. Or le
      // correctif d'attribution des buts et cartons (sideForTeam,
      // espnSummaryParse.js) change le RÉSULTAT de l'analyse pour des matchs
      // déjà en cache — Betis-Real Madrid du 04/09 renvoyait encore ses 9
      // événements du côté de Betis, cartons de Güler, Camavinga et Vinícius
      // compris, alors que la source ESPN portait bien le bon identifiant
      // d'équipe sur chacun (vérifié sur le scoreboard brut).
      // Un cache permanent rend donc tout correctif d'analyse invisible sur
      // l'historique : sans bump de version, le bug aurait été corrigé pour
      // les matchs à venir seulement, et l'utilisateur aurait continué à voir
      // le même défaut sur tous les matchs déjà consultés.
      // À REFAIRE à chaque fois que compactEspnSummary change de résultat.
      const cacheKey = `espn:summary:v2:${slug}:${eventId}`
      try {
        const cached = skipCache ? null : await kv.get(cacheKey)
        if (cached) {
          const cachedObj = typeof cached === 'string' ? JSON.parse(cached) : cached
          // Voir isCompactShape() : une entrée à l'ancien format brut ESPN
          // (déjà en cache avant la compaction) n'est PAS servie telle
          // quelle — on laisse tomber jusqu'au fetch frais plus bas, qui la
          // remplace par le format compact.
          if (isCompactShape(cachedObj)) {
            // ⚠️ BUG CORRIGÉ (constat utilisateur : "les matchs déjà essayés
            // avant le fix ne marchent toujours pas, ceux jamais ouverts
            // marchent très bien") : mon fix précédent (LINEUPS_PENDING_TTL)
            // ne s'applique QU'AUX NOUVELLES écritures — il ne change RIEN
            // aux entrées DÉJÀ en cache écrites par l'ANCIEN code bugué, qui
            // les avait mises en PERMANENT (sans aucun `ex`) avec
            // `lineups: null`. Une entrée sans expiration ne disparaît
            // JAMAIS toute seule — je m'étais trompé en disant que ça se
            // réglerait "au bout de 24h" : une clé permanente n'a pas de
            // TTL du tout, donc pas de "24h" qui s'écoule, elle reste figée
            // pour toujours tant que personne n'intervient. kv.ttl(cacheKey)
            // renvoie -1 pour une clé permanente (sans expiration), un
            // nombre positif pour une clé avec TTL (donc écrite par LE
            // NOUVEAU code, jamais concernée par ce bug). Ne vérifier le TTL
            // QUE quand lineups est vide (cas ambigu) — inutile et un appel
            // Redis de plus pour rien si la compo est déjà là.
            const hasLineups = !!cachedObj.lineups?.home?.starters?.length
            let isLegacyPermanentEmpty = false
            if (!hasLineups) {
              try { isLegacyPermanentEmpty = (await kv.ttl(cacheKey)) === -1 } catch {}
            }
            if (!isLegacyPermanentEmpty) {
              clearTimeout(timeoutId)
              await mapWrite
              // Strip _cacheHint avant l'envoi client (voir summaryCacheControlFor
              // plus haut — champ interne, jamais destiné au client).
              const { _cacheHint, ...clientObj } = cachedObj
              return res.status(200)
                .setHeader('Content-Type', 'application/json')
                .setHeader('Cache-Control', summaryCacheControlFor(_cacheHint))
                .json(clientObj)
            }
            // Sinon : entrée legacy figée sans compo → traitée comme une
            // absence de cache, on retombe sur le fetch frais ci-dessous, qui
            // la réécrit avec la bonne logique de TTL (permanent seulement si
            // la compo est vraiment là cette fois) — auto-réparation
            // progressive au fil des consultations, sans script de purge.
          }
        }
      } catch { /* KV indisponible/JSON invalide → on retombe sur le fetch direct ci-dessous */ }

      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) return res.status(response.status).json({ error: `ESPN a répondu ${response.status}` })

      const rawBody = await response.text()
      let compact = { scorers: [], cards: [], stats: null, lineups: null }
      let cacheHint = 'live' // défaut : pas de donnée utile mise en cache → traité comme "live" (cache Edge court)
      try {
        const parsed = JSON.parse(rawBody)
        compact = compactEspnSummary(parsed)
        if (hasUsefulData(compact)) {
          const hasLineups = !!compact.lineups?.home?.starters?.length
          // Match terminé + compo publiée : donnée définitivement complète et
          // immuable → pas de `ex`, cache permanent (voir LINEUPS_PENDING_TTL
          // ci-dessus pour le cas "pas encore" et pourquoi ce n'était PAS déjà
          // le cas avant).
          if (isMatchFinished(parsed) && hasLineups) {
            cacheHint = 'permanent'
            await kv.set(cacheKey, JSON.stringify({ ...compact, _cacheHint: cacheHint }))
          } else if (isMatchFinished(parsed)) {
            cacheHint = 'pending'
            await kv.set(cacheKey, JSON.stringify({ ...compact, _cacheHint: cacheHint }), { ex: LINEUPS_PENDING_TTL })
          } else {
            // Match en cours : TTL court (LIVE_SUMMARY_CACHE_TTL), les stats évoluent.
            cacheHint = 'live'
            await kv.set(cacheKey, JSON.stringify({ ...compact, _cacheHint: cacheHint }), { ex: LIVE_SUMMARY_CACHE_TTL })
          }
        }
      } catch { /* JSON invalide ESPN ou KV en erreur → on renvoie quand même le résultat compacté (vide si le parse a échoué), pas bloquant */ }
      await mapWrite

      // Voir summaryCacheControlFor plus haut — cache Edge choisi selon le
      // cycle de vie réel de la donnée (permanent/pending/live), jamais
      // moins frais que ce que le TTL Redis autorisait déjà.
      return res.status(200)
        .setHeader('Content-Type', 'application/json')
        .setHeader('Cache-Control', summaryCacheControlFor(cacheHint))
        .json(compact)
    }

    // ── Mode scoreboard ──────────────────────────────────────────────────
    // Format simple (YYYYMMDD) OU plage (YYYYMMDD-YYYYMMDD) — la plage est
    // nécessaire pour les tournois ponctuels (NL/CAN/Copa America) où l'on
    // interroge une fenêtre large plutôt qu'un jour précis.
    // ⚠️ Date simple (chunks.length === 1 plus bas) : jamais mise en cache
    // (`no-store`) — utilisée pour retrouver un event précis dans le
    // scoreboard du jour (useMatchDetail.js/useEspnMatchDetail.js), doit
    // rester fraîche. Plage multi-jours (chunks.length > 1) : les tranches
    // passées/futures lointaines SONT mises en cache individuellement (voir
    // fetchScoreboardChunk/scoreboardChunkTtl), et depuis le 21/09 la
    // réponse fusionnée elle-même l'est aussi, brièvement (voir plus bas,
    // Cache-Control public/s-maxage) — ce mode ne sert jamais le direct,
    // voir le commentaire détaillé à cet endroit.
    if (dates && !/^\d{8}(-\d{8})?$/.test(dates)) return res.status(400).json({ error: 'Format dates invalide (YYYYMMDD ou YYYYMMDD-YYYYMMDD attendu)' })

    // ⚠️ AJOUT (15/09, durci le 16/09) : ESPN rejette désormais (400) TOUTE
    // plage avec un tiret, même 2 jours — voir le commentaire détaillé de
    // splitScoreboardRange/fetchScoreboardChunk plus haut. Une date simple
    // (sans tiret, ou aucune date) suit le chemin EXISTANT ci-dessous,
    // inchangé — toute plage (ex. windowRange() côté client) passe désormais
    // par le découpage, en dates individuelles.
    const chunks = dates ? splitScoreboardRange(dates) : [null]
    if (chunks.length > 1) {
      // ⚠️ 1 seul kv.mget pour vérifier TOUTES les tranches cacheables d'un
      // coup (voir readCachedChunks plus haut) — seules celles non trouvées
      // (vrai cache miss ou zone "live") sont réellement fetchées auprès
      // d'ESPN, toujours par petits groupes espacés (anti-rafale, inchangé).
      const cachedByChunk = await readCachedChunks(slug, chunks)
      const toFetch = chunks.filter(c => !cachedByChunk.has(c))
      const fetched = await fetchScoreboardChunksStaggered(slug, toFetch)
      const results = [...cachedByChunk.values(), ...fetched]
      clearTimeout(timeoutId)
      const merged = mergeScoreboardChunks(results)
      // Toutes les tranches ont échoué (ESPN en panne/bloque) : un vrai
      // statut d'erreur, PAS un 200 avec `events:[]` — voir le commentaire de
      // fetchScoreboardChunk, ça préserve le repli sur cache local périmé
      // déjà en place côté client (fetchEspnCompMatches, espnAdapter.js).
      if (!merged.ok) return res.status(502).json({ error: 'ESPN indisponible sur toutes les tranches' })
      // ⚠️ AJOUT (21/09, demande explicite utilisateur — "si une seule
      // personne consulte l'app ça utilise trop de commandes Upstash") : le
      // kv.mget (voir readCachedChunks) réduit le coût PAR VISITEUR, mais ne
      // change rien si N visiteurs chargent l'Accueil dans la même minute —
      // chacun refait le même calcul (même optimisé). Ce mode (plage
      // multi-jours, windowRange() côté client, voir espnAdapter.js) est le
      // SEUL appelant de ce format `dates=DEBUT-FIN` — tous les autres
      // appelants (useMatchDetail.js/useEspnMatchDetail.js/DebugEspn.jsx)
      // passent une DATE UNIQUE, qui suit le chemin `chunks.length === 1`
      // plus bas, jamais touché ici. Et le direct (score en temps réel
      // pendant un match) ne passe JAMAIS par ce endpoint — useLiveMinute.js/
      // LiveProvider.jsx s'appuient sur un mécanisme de polling séparé (voir
      // leurs propres fichiers), pas sur fetchEspnCompMatches. Cette réponse
      // sert uniquement à établir la LISTE des matchs (calendrier), jamais
      // leur score en direct — un court cache PARTAGÉ ici (Vercel Edge,
      // même mécanisme déjà en place sans souci pour le mode "standings" de
      // ce fichier, voir plus haut) ne dégrade donc aucune fraîcheur
      // perçue : le client lui-même tolère déjà jusqu'à 60s de péremption
      // sur ces données (`staleTime` de useTodayMatches.js). 90s : dans le
      // même ordre de grandeur que cette tolérance déjà acceptée côté
      // client, tout en donnant à ce cache Edge une vraie chance d'absorber
      // une salve de visiteurs. `stale-while-revalidate` sert une copie
      // encore un peu périmée pendant qu'un revalidate se fait en tâche de
      // fond, plutôt qu'un visiteur "malchanceux" qui tombe pile à
      // l'expiration ne déclenche un aller-retour complet à découvert.
      // Effet concret : au lieu d'un calcul (même réduit à 1 mget) PAR
      // VISITEUR, un seul calcul PARTAGÉ toutes les ~90s, peu importe le
      // nombre de visiteurs simultanés — un visiteur qui tombe sur un cache
      // Edge HIT ne déclenche même plus l'exécution de cette fonction,
      // donc zéro commande Redis ET zéro CPU Vercel pour lui.
      return res.status(200)
        .setHeader('Content-Type', 'application/json')
        .setHeader('Cache-Control', 'public, s-maxage=90, stale-while-revalidate=300')
        .json({ events: merged.events })
    }

    // ⚠️ &limit=100 indispensable pour les matchs à élimination directe : sans
    // lui, ESPN renvoie des noms d'équipe placeholder de bracket ("Round of 32
    // 5 Winner") et un statut/score figés SCHEDULED/0-0 même après le vrai
    // coup d'envoi (bug confirmé en direct sur France-Paraguay, 8e de finale).
    const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`
    const url  = dates ? `${base}?dates=${dates}&limit=100` : `${base}?limit=100`

    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) return res.status(response.status).json({ error: `ESPN a répondu ${response.status}` })

    const body = await response.text()
    // ⚠️ AJOUT (24/09, quota Fluid Active CPU Vercel dépassé — confirmé via
    // dashboard Observability : /api/espn = 14K invocations / 2min de CPU en
    // 12h, très largement devant les autres routes) — ce mode "date simple"
    // était jusqu'ici `no-store` inconditionnel : chaque appelant (surtout
    // useMatchDetail.js/useEspnMatchDetail.js, déclenché à CHAQUE ouverture
    // d'un détail de match par N'IMPORTE QUEL visiteur) retapait ESPN pour de
    // vrai, sans aucune mutualisation entre visiteurs — profil qui colle bien
    // mieux au volume observé (rythme constant toute la journée, coût CPU par
    // appel très bas) que le mode plage juste au-dessus (déjà mis en cache
    // 90s le 21/09). Vérifié avant ce changement — AUCUN lien avec le direct :
    // le vrai suivi live (score qui bouge minute par minute) passe par
    // /api/fifa-live, qui interroge ESPN directement, jamais via cette route
    // (grep confirmé sur useLiveMinute.js/fifa-live.js). Cette route ne sert
    // qu'à LOCALISER un match une fois (eventId + snapshot initial) au
    // moment où un visiteur ouvre son détail — jamais à suivre son évolution.
    //
    // ⚠️ CORRIGÉ (25/09, toujours 13K invocations / 3min CPU sur 12h même
    // APRÈS ce cache 15s — soirée Ligue des Nations, plusieurs matchs
    // simultanés) : le vrai trou trouvé en auditant les appelants
    // (useMatchDetail.js) — `EMPTY_RETRY_INTERVAL_MS = 30_000` (useLineups/
    // useEspnMatchStats/résolution d'event, 4 points d'appel, retryWhileEmpty)
    // et `refetchInterval: 60_000` (useEspnSummaryStats, MatchModal.jsx:479)
    // repollent CETTE MÊME requête (même slug+date) tant que la compo/stat
    // n'est pas encore publiée par ESPN — situation plus fréquente/longue un
    // soir de sélections nationales (compos publiées souvent plus tard/moins
    // fiablement que pour un match de club). Avec 15s < 30s < 60s, le cache
    // Edge expirait TOUJOURS avant le repoll suivant — même le retry d'UN
    // SEUL visiteur sur UN SEUL match ne pouvait jamais taper le cache, qui
    // ne servait donc qu'aux rafales de plusieurs visiteurs sur le même match
    // dans la même seconde. 40s (> 60s/60=1 poll manqué max, largement au-
    // dessus du plus court cycle 30s) : un visiteur qui repoll toutes les 30s
    // tape désormais le cache un repoll sur deux au minimum, et tous les
    // visiteurs qui suivent le même match pendant sa fenêtre de résolution la
    // partagent. Toujours sans lien avec le direct (raisonnement inchangé
    // ci-dessus) — seule la fraîcheur de "ce match est-il déjà localisable"
    // passe de 15s à 40s de tolérance max, imperceptible pour un snapshot de
    // pré-match/résolution d'event.
    res.status(200)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'public, s-maxage=40, stale-while-revalidate=180')
       .send(body)
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'ESPN timeout (>8s)' })
    res.status(500).json({ error: err.message })
  }
}
