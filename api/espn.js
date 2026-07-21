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
import { compactEspnSummary } from '../src/utils/espnSummaryParse.js'

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
const LIVE_SUMMARY_CACHE_TTL = 45 // 45s — match encore EN COURS (stats poss/tirs/corners évoluent)

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
  const ip    = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rlKey = `ratelimit:espn:${ip}`
  try {
    const count = await kv.incr(rlKey)
    if (count === 1) await kv.expire(rlKey, 60)
    if (count > 60) return res.status(429).json({ error: 'Trop de requêtes' })
  } catch {}

  const { slug, dates, eventId, recap, forceFresh, fdMatchId, lookupMap } = req.query
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
      const cacheKey = `espn:summary:${slug}:${eventId}`
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
              return res.status(200)
                .setHeader('Content-Type', 'application/json')
                .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, s-maxage=0, proxy-revalidate')
                .json(cachedObj)
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
            await kv.set(cacheKey, JSON.stringify(compact))
          } else if (isMatchFinished(parsed)) {
            await kv.set(cacheKey, JSON.stringify(compact), { ex: LINEUPS_PENDING_TTL })
          } else {
            // Match en cours : TTL court (LIVE_SUMMARY_CACHE_TTL), les stats évoluent.
            await kv.set(cacheKey, JSON.stringify(compact), { ex: LIVE_SUMMARY_CACHE_TTL })
          }
        }
      } catch { /* JSON invalide ESPN ou KV en erreur → on renvoie quand même le résultat compacté (vide si le parse a échoué), pas bloquant */ }
      await mapWrite

      return res.status(200)
        .setHeader('Content-Type', 'application/json')
        .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, s-maxage=0, proxy-revalidate')
        .setHeader('Pragma', 'no-cache')
        .setHeader('Surrogate-Control', 'no-store')
        .json(compact)
    }

    // ── Mode scoreboard (pas de cache — données live, doivent rester fraîches) ──
    // Format simple (YYYYMMDD) OU plage (YYYYMMDD-YYYYMMDD) — la plage est
    // nécessaire pour les tournois ponctuels (NL/CAN/Copa America) où l'on
    // interroge une fenêtre large plutôt qu'un jour précis.
    if (dates && !/^\d{8}(-\d{8})?$/.test(dates)) return res.status(400).json({ error: 'Format dates invalide (YYYYMMDD ou YYYYMMDD-YYYYMMDD attendu)' })
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
    res.status(200)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, s-maxage=0, proxy-revalidate')
       .setHeader('Pragma', 'no-cache')
       .setHeader('Surrogate-Control', 'no-store')
       .send(body)
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'ESPN timeout (>8s)' })
    res.status(500).json({ error: err.message })
  }
}
