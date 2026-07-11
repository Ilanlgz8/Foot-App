// Proxy ESPN — scores live, historique daté, et summary (stats live)
//
// ⚠️ Cache Redis ajouté sur le mode "summary" (rosters + boxscore + events
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
import { Redis } from '@upstash/redis'

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
])

const SUMMARY_CACHE_TTL      = 7 * 24 * 3600  // 7j — matchs TERMINÉS uniquement (retrospective)
const LIVE_SUMMARY_CACHE_TTL = 45              // 45s — match encore EN COURS (stats poss/tirs/corners évoluent)

// ⚠️ BUG CORRIGÉ (constat utilisateur : "les stats live ont l'air figées") :
// hasUsefulData() ne regardait QUE la présence de rosters/boxscore pour
// décider de mettre en cache — or les rosters sont dispo dès l'AVANT-MATCH.
// Résultat : le tout premier summary fetché (souvent avant/juste après le
// coup d'envoi, quand le boxscore est encore vide ou quasi) se retrouvait
// caché pour 7 JOURS ENTIERS, et absolument TOUS les utilisateurs recevaient
// ensuite ce même instantané figé pendant tout le reste du match — bien plus
// large que le simple cas "retour d'arrière-plan". Le TTL 7j reste justifié
// pour un match TERMINÉ (permet de revoir les stats bien après qu'ESPN les
// retire), mais un match encore EN COURS doit garder un TTL court.
function isMatchFinished(json) {
  const statusName = json?.header?.competitions?.[0]?.status?.type?.name
  const completed  = json?.header?.competitions?.[0]?.status?.type?.completed
  return completed === true || statusName === 'STATUS_FULL_TIME' || statusName === 'STATUS_FINAL'
}

// Un summary "utile" contient au moins des rosters ou un boxscore — évite de
// mettre en cache une réponse vide/quasi-vide qui bloquerait un refetch utile.
function hasUsefulData(json) {
  const hasRosters  = Array.isArray(json?.rosters) && json.rosters.length > 0
  const hasBoxscore = Array.isArray(json?.boxscore?.teams) && json.boxscore.teams.length > 0
  // ⚠️ BUG CORRIGÉ : pour la Coupe du Monde, ESPN ne remplit quasiment jamais
  // json.rosters — les compos sont dans header.competitions[0].competitors[].
  // roster à la place (déjà géré côté client, voir useLineups/useEspnMatchStats
  // dans useMatchDetail.js). Cette fonction ne le vérifiait pas : un summary WC
  // avec compo dispo UNIQUEMENT à cet endroit était jugé "pas utile" et jamais
  // mis en cache Redis. Résultat concret : dès qu'ESPN cesse de servir les
  // rosters en direct (fenêtre limitée), plus aucune compo n'était récupérable
  // pour ce match, même pour un utilisateur qui l'avait consulté pendant qu'ESPN
  // avait encore la donnée — rien n'avait jamais été sauvegardé.
  const competitors  = json?.header?.competitions?.[0]?.competitors ?? []
  const hasHeaderRoster = competitors.some(c => Array.isArray(c?.roster) && c.roster.length > 0)
  return hasRosters || hasBoxscore || hasHeaderRoster
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

  const { slug, dates, eventId, recap, forceFresh } = req.query
  const skipCache = forceFresh === '1' || forceFresh === 'true'

  if (!slug)                    return res.status(400).json({ error: 'Paramètre slug manquant' })
  if (!ALLOWED_SLUGS.has(slug)) return res.status(400).json({ error: 'Slug non autorisé' })

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)

  try {
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
      // ── Mode summary : cache Redis partagé d'abord ──────────────────────────
      // forceFresh=1 (retour d'arrière-plan récent côté client, voir
      // window.__liveStatsForceFreshUntil dans useLiveMinute.js) contourne
      // cette lecture pour ne pas resservir un instantané potentiellement
      // périmé — le fetch frais ci-dessous réécrit quand même le cache après,
      // au bénéfice des autres utilisateurs.
      const cacheKey = `espn:summary:${slug}:${eventId}`
      try {
        const cached = skipCache ? null : await kv.get(cacheKey)
        if (cached) {
          clearTimeout(timeoutId)
          const body = typeof cached === 'string' ? cached : JSON.stringify(cached)
          return res.status(200)
            .setHeader('Content-Type', 'application/json')
            .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, s-maxage=0, proxy-revalidate')
            .send(body)
        }
      } catch { /* KV indisponible → on retombe sur le fetch direct ci-dessous */ }

      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) return res.status(response.status).json({ error: `ESPN a répondu ${response.status}` })

      const body = await response.text()
      try {
        const parsed = JSON.parse(body)
        if (hasUsefulData(parsed)) {
          const ttl = isMatchFinished(parsed) ? SUMMARY_CACHE_TTL : LIVE_SUMMARY_CACHE_TTL
          await kv.set(cacheKey, body, { ex: ttl })
        }
      } catch { /* JSON invalide ou KV en erreur → tant pis, pas bloquant pour la réponse */ }

      return res.status(200)
        .setHeader('Content-Type', 'application/json')
        .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, s-maxage=0, proxy-revalidate')
        .setHeader('Pragma', 'no-cache')
        .setHeader('Surrogate-Control', 'no-store')
        .send(body)
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
