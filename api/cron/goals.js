// api/cron/goals.js
// Appelé par cron-job.org toutes les minutes (Vercel Hobby = pas de crons natifs).
//
// Détecte et notifie :
//   ⚽ But         — score change pendant STATUS_IN_PROGRESS
//   🟢 Coup d'envoi — STATUS_SCHEDULED → STATUS_IN_PROGRESS (period 1)
//   ⏸  Mi-temps    — STATUS_IN_PROGRESS → STATUS_HALFTIME
//   🏁 Fin de match — statut live → STATUS_FINAL / STATUS_FULL_TIME
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

const FINAL_STATUSES = new Set([
  'STATUS_FINAL',
  'STATUS_FULL_TIME',
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

  if (stale.length) {
    try { await Promise.all(stale.map(s => kv.srem('push:subscriptions', s))) } catch {}
  }

  return sent
}

async function sendDeduped(dedupKey, payload, ttl = 3 * 3600) {
  try {
    const already = await kv.get(dedupKey)
    if (already) return 0
    await kv.set(dedupKey, '1', { ex: ttl })
  } catch { return 0 }
  return sendPushToAll(payload)
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

  const fetches = await Promise.allSettled(
    SLUGS.flatMap(slug => [
      fetchEvents(slug, today),
      fetchEvents(slug, yesterday),
    ])
  )

  // Dédupliquer les events par ID
  const eventsById = new Map()
  for (const result of fetches) {
    if (result.status !== 'fulfilled') continue
    for (const evt of result.value) {
      if (!eventsById.has(evt.id)) eventsById.set(evt.id, evt)
    }
  }

  let notifsSent = 0
  const log = []

  for (const evt of eventsById.values()) {
    const comp    = evt.competitions?.[0]
    if (!comp) continue

    const status  = comp.status?.type?.name ?? ''
    const period  = comp.status?.period ?? 1
    const clock   = comp.status?.displayClock ?? ''
    const homeC   = comp.competitors?.find(c => c.homeAway === 'home')
    const awayC   = comp.competitors?.find(c => c.homeAway === 'away')
    if (!homeC || !awayC) continue

    const eventId  = evt.id
    const home     = parseInt(homeC.score ?? '0', 10)
    const away     = parseInt(awayC.score ?? '0', 10)
    const homeTeam = homeC.team?.shortDisplayName ?? homeC.team?.displayName ?? '?'
    const awayTeam = awayC.team?.shortDisplayName ?? awayC.team?.displayName ?? '?'
    const scoreStr = `${home} – ${away}`
    const score    = `${home}-${away}`

    // ── Lire l'état précédent depuis KV ───────────────────────────────────
    const stateKey   = `cron:state:${eventId}`
    let   prevState  = null
    try { prevState = await kv.get(stateKey) } catch {}
    // prevState = "STATUS_XXX|score" ex: "STATUS_IN_PROGRESS|1-0"

    const [prevStatus = null, prevScore = null] = prevState ? prevState.split('|') : []

    // Sauvegarder l'état actuel (TTL 12h)
    try { await kv.set(stateKey, `${status}|${score}`, { ex: 12 * 3600 }) } catch {}

    // Premier poll pour ce match → baseline, pas de notif
    if (prevState === null) {
      log.push(`[${eventId}] baseline ${status}|${score}`)
      continue
    }

    // ── 🔴 Coup d'envoi ───────────────────────────────────────────────────
    if (
      !LIVE_STATUSES.has(prevStatus) &&
      status === 'STATUS_IN_PROGRESS' &&
      period === 1
    ) {
      log.push(`[${eventId}] KO`)
      const sent = await sendDeduped(
        `push:cron:ko:${eventId}`,
        {
          title:   '🔴 Coup d\'envoi !',
          body:    `${homeTeam} – ${awayTeam}`,
          matchId: eventId,
          url:     '/',
        }
      )
      if (sent > 0) notifsSent++
    }

    // ── 🔴 Mi-temps ───────────────────────────────────────────────────────
    if (
      LIVE_STATUSES.has(prevStatus) &&
      prevStatus !== 'STATUS_HALFTIME' &&
      status === 'STATUS_HALFTIME'
    ) {
      log.push(`[${eventId}] mi-temps`)
      const sent = await sendDeduped(
        `push:cron:ht:${eventId}`,
        {
          title:   '🔴 Mi-temps',
          body:    `${homeTeam} ${scoreStr} ${awayTeam}`,
          matchId: eventId,
          url:     '/',
        }
      )
      if (sent > 0) notifsSent++
    }

    // ── 🔴 Fin de match ───────────────────────────────────────────────────
    if (
      LIVE_STATUSES.has(prevStatus) &&
      FINAL_STATUSES.has(status)
    ) {
      log.push(`[${eventId}] fin de match`)
      const sent = await sendDeduped(
        `push:cron:ft:${eventId}`,
        {
          title:   '🔴 Fin de match',
          body:    `${homeTeam} ${scoreStr} ${awayTeam}`,
          matchId: eventId,
          url:     '/',
        }
      )
      if (sent > 0) notifsSent++
    }

    // ── 🔴 But ────────────────────────────────────────────────────────────
    if (
      LIVE_STATUSES.has(status) &&
      status !== 'STATUS_HALFTIME' &&
      prevScore !== null &&
      prevScore !== score
    ) {
      log.push(`[${eventId}] but ${prevScore} → ${score}`)

      // Chercher le buteur dans comp.details (scoring plays ESPN)
      const details   = comp.details ?? []
      const goalTypes = new Set(['Goal', 'goal', 'PenaltyKick', 'penalty'])
      // Prendre le dernier événement de type but (le plus récent)
      const lastGoal  = [...details].reverse().find(d =>
        goalTypes.has(d.type?.text) || goalTypes.has(d.type?.name)
      )
      const scorer    = lastGoal?.athletesInvolved?.[0]?.displayName ?? null
      const clockLabel = clock ? ` ${clock}'` : ''

      const title = scorer ? `🔴 But ! ${scorer}` : '🔴 But !'
      const body  = `${homeTeam} ${scoreStr} ${awayTeam}${clockLabel}`

      const sent = await sendDeduped(
        `push:goal:cron:${eventId}:${score}`,
        { title, body, matchId: eventId, url: '/' }
      )
      if (sent > 0) notifsSent++
    }
  }

  return res.status(200).json({
    ok: true,
    events: eventsById.size,
    notifsSent,
    log,
  })
}
