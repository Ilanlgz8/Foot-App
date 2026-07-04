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
  'fifa.world',
])

const SUMMARY_CACHE_TTL = 7 * 24 * 3600  // 7j — largement de quoi couvrir la consultation des résultats

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
  const { slug, dates, eventId, recap } = req.query

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
      const cacheKey = `espn:summary:${slug}:${eventId}`
      try {
        const cached = await kv.get(cacheKey)
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
          await kv.set(cacheKey, body, { ex: SUMMARY_CACHE_TTL })
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
    if (dates && !/^\d{8}$/.test(dates)) return res.status(400).json({ error: 'Format dates invalide (YYYYMMDD attendu)' })
    const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`
    const url  = dates ? `${base}?dates=${dates}` : base

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
