// api/cron/goals.js
// Appelé par cron-job.org toutes les minutes (Vercel Hobby = pas de crons natifs).
//
// Flow :
//   1. Poll ESPN scoreboard pour J + J-1 (couvre les matchs tardifs UTC)
//   2. Pour chaque match EN COURS (STATUS_IN_PROGRESS / STATUS_HALFTIME)
//      → compare le score avec le précédent stocké dans KV
//   3. Score changé → envoie push à tous les abonnés (web-push VAPID)
//   4. Met à jour le score dans KV pour le prochain poll
//
// Sécurité : header "x-cron-secret" ou param ?secret= doit matcher CRON_SECRET.

import { Redis } from '@upstash/redis'
import webpush    from 'web-push'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const SLUGS = [
  'fra.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1',
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
  'fifa.world',
]

const LIVE_STATUSES = new Set([
  'STATUS_IN_PROGRESS',
  'STATUS_HALFTIME',
  'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME',
  'STATUS_OVERTIME',
  'STATUS_SHOOTOUT',
])

// ── Helpers ──────────────────────────────────────────────────────────────────

function dateStr(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function setupVapid() {
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    return true
  } catch { return false }
}

async function fetchEvents(slug, dates) {
  try {
    const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`
    const url  = dates ? `${base}?dates=${dates}` : base
    const res  = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      signal:  AbortSignal.timeout(5_000),
    })
    if (!res.ok) return []
    const json = await res.json()
    return json.events ?? []
  } catch {
    return []
  }
}

async function sendPushToAll(payload) {
  let subs = []
  try {
    subs = (await kv.smembers('push:subscriptions')) ?? []
  } catch { return 0 }
  if (!subs.length) return 0

  const payloadStr = JSON.stringify(payload)
  const stale = []
  let sent = 0

  await Promise.allSettled(subs.map(async (subRaw) => {
    let sub
    try {
      sub = typeof subRaw === 'string' ? JSON.parse(subRaw) : subRaw
    } catch { stale.push(subRaw); return }

    try {
      await webpush.sendNotification(sub, payloadStr, { TTL: 3600 })
      sent++
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        stale.push(typeof subRaw === 'string' ? subRaw : JSON.stringify(subRaw))
      }
    }
  }))

  // Nettoyer les subscriptions mortes
  if (stale.length) {
    try { await Promise.all(stale.map(s => kv.srem('push:subscriptions', s))) } catch {}
  }

  return sent
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = req.headers['x-cron-secret'] ?? req.query.secret ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' })
  }

  if (!setupVapid()) {
    return res.status(503).json({ error: 'VAPID non configuré' })
  }

  // ── Dates ESPN : J + J-1 ─────────────────────────────────────────────────
  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))

  // Fetch tous les slugs pour J et J-1 en parallèle (~2s max)
  const fetches = await Promise.allSettled(
    SLUGS.flatMap(slug => [
      fetchEvents(slug, today),
      fetchEvents(slug, yesterday),
    ])
  )

  // Dédupliquer les events par ID (J et J-1 peuvent retourner le même)
  const eventsById = new Map()
  for (const result of fetches) {
    if (result.status !== 'fulfilled') continue
    for (const evt of result.value) {
      if (!eventsById.has(evt.id)) eventsById.set(evt.id, evt)
    }
  }

  // Filtrer uniquement les matchs en cours
  const liveEvents = []
  for (const evt of eventsById.values()) {
    const status = evt.competitions?.[0]?.status?.type?.name
    if (LIVE_STATUSES.has(status)) liveEvents.push(evt)
  }

  let goalsFound = 0
  const log = []

  for (const evt of liveEvents) {
    const comp  = evt.competitions?.[0]
    const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
    const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
    if (!homeC || !awayC) continue

    const eventId  = evt.id
    const home     = parseInt(homeC.score ?? '0', 10)
    const away     = parseInt(awayC.score ?? '0', 10)
    const homeTeam = homeC.team?.shortDisplayName ?? homeC.team?.displayName ?? homeC.team?.name ?? '?'
    const awayTeam = awayC.team?.shortDisplayName ?? awayC.team?.displayName ?? awayC.team?.name ?? '?'
    const newScore = `${home}-${away}`

    // ── Lire le score précédent depuis KV ─────────────────────────────────
    const scoreKey = `cron:score:${eventId}`
    let prevScore  = null
    try { prevScore = await kv.get(scoreKey) } catch {}

    // Sauvegarder le score actuel (TTL 6h — nettoyage auto après le match)
    try { await kv.set(scoreKey, newScore, { ex: 6 * 3600 }) } catch {}

    // Premier poll pour ce match (pas de score précédent) → baseline, pas de notif
    if (prevScore === null) {
      log.push(`[${eventId}] baseline ${newScore}`)
      continue
    }

    // Score inchangé → rien à faire
    if (prevScore === newScore) continue

    // ── But détecté ! ─────────────────────────────────────────────────────
    log.push(`[${eventId}] but détecté ${prevScore} → ${newScore}`)

    // Déduplication : éviter d'envoyer 2x la même notif (si cron overlap)
    const dedupKey   = `push:goal:cron:${eventId}:${newScore}`
    let alreadySent  = false
    try { alreadySent = !!(await kv.get(dedupKey)) } catch {}
    if (alreadySent) {
      log.push(`[${eventId}] déjà envoyé (dedup)`)
      continue
    }
    try { await kv.set(dedupKey, '1', { ex: 3 * 3600 }) } catch {}

    // ── Envoyer la push notification ──────────────────────────────────────
    const title   = `⚽ But !`
    const message = `${homeTeam} ${home} – ${away} ${awayTeam}`

    const sent = await sendPushToAll({
      title,
      body:    message,
      matchId: eventId,
      url:     '/',
    })

    log.push(`[${eventId}] push envoyé à ${sent} abonné(s)`)
    goalsFound++
  }

  return res.status(200).json({
    ok:          true,
    liveMatches: liveEvents.length,
    goalsFound,
    log,
  })
}
