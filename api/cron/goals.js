// api/cron/goals.js
// Appelé par cron-job.org toutes les minutes.
// Source : FotMob (remplace ESPN + FD.org WC — near real-time, toutes compétitions)
//
// Détecte et notifie :
//   ⚽ But         — score change pendant un match en cours
//   🔴 Coup d'envoi — match démarre (started passe à true)
//   ⏸  Mi-temps    — liveTime.short === 'HT'
//   ▶️  Reprise     — HT → IN_PROGRESS
//   🏁 Fin de match — finished passe à true
//
// Sécurité : header "x-cron-secret" ou param ?secret= doit matcher CRON_SECRET.

import { Redis } from '@upstash/redis'
import webpush   from 'web-push'
import crypto    from 'crypto'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// ── Auth FotMob ───────────────────────────────────────────────────────────────
function generateFotmobToken(path) {
  const secret = (process.env.FOTMOB_SECRET ?? '').replace(/\r\n/g, '\n').trimEnd()
  if (!secret) return null
  const code = Date.now()
  const body = { url: path, code }
  const sig = crypto
    .createHash('md5')
    .update(JSON.stringify(body) + secret)
    .digest('hex')
    .toUpperCase()
  return Buffer.from(JSON.stringify({ body, signature: sig })).toString('base64')
}

async function fetchFotmobMatches(date) {
  const path = `/api/matches?date=${date}`
  const token = generateFotmobToken(path)
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
    'Accept': 'application/json',
  }
  if (token) headers['X-Fm-Req'] = token
  try {
    const res = await fetch(`https://www.fotmob.com${path}`, {
      headers,
      signal: AbortSignal.timeout(7_000),
    })
    if (!res.ok) return []
    const json = await res.json()
    return (json.leagues ?? []).flatMap(l => l.matches ?? [])
  } catch {
    return []
  }
}

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

function fmScore(fm) {
  const h = fm.home?.score
  const a = fm.away?.score
  if (typeof h === 'number' && typeof a === 'number') return { home: h, away: a }
  const parts = (fm.status?.scoreStr ?? '0 - 0').split(/\s*-\s*/).map(Number)
  return { home: parts[0] || 0, away: parts[1] || 0 }
}

// ── Fallback ESPN (si FotMob down) ────────────────────────────────────────────
// ESPN ne couvre pas la WC 2026 en live → on skip fifa.world
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const ESPN_SLUGS = ['fra.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf']

const LIVE_ESPN = new Set(['STATUS_IN_PROGRESS','STATUS_HALFTIME','STATUS_END_PERIOD','STATUS_EXTRA_TIME','STATUS_OVERTIME','STATUS_SHOOTOUT'])
const FINAL_ESPN = new Set(['STATUS_FINAL','STATUS_FULL_TIME'])

async function fetchEspnEvents(date) {
  const results = await Promise.allSettled(
    ESPN_SLUGS.map(async slug => {
      try {
        const r = await fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${date}`, {
          headers: { 'Cache-Control': 'no-cache' },
          signal: AbortSignal.timeout(5_000),
        })
        if (!r.ok) return []
        const j = await r.json()
        return (j.events ?? []).map(e => ({ slug, evt: e }))
      } catch { return [] }
    })
  )
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
}

function fmIsHalftime(fm) {
  return fm.status?.started && !fm.status?.finished &&
    (fm.status?.liveTime?.short === 'HT')
}

function fmIsLive(fm) {
  return fm.status?.started === true && fm.status?.finished !== true && !fm.status?.cancelled
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

  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))

  // ── Fetch FotMob (today + yesterday en parallèle) ─────────────────────────
  const [matchesToday, matchesYesterday] = await Promise.all([
    fetchFotmobMatches(today),
    fetchFotmobMatches(yesterday),
  ])

  // Dédupliquer par ID FotMob (un match peut apparaître dans les deux si minuit UTC)
  const matchMap = new Map()
  for (const fm of [...matchesToday, ...matchesYesterday]) {
    if (!matchMap.has(fm.id)) matchMap.set(fm.id, fm)
  }

  let notifsSent = 0
  const log = []

  for (const fm of matchMap.values()) {
    const fmId     = fm.id
    const homeTeam = fm.home?.name ?? '?'
    const awayTeam = fm.away?.name ?? '?'
    const { home, away } = fmScore(fm)
    const score    = `${home}-${away}`
    const scoreStr = `${home} – ${away}`
    const isLive   = fmIsLive(fm)
    const isHT     = fmIsHalftime(fm)
    const isFinished = fm.status?.finished === true

    // ── Lire l'état précédent depuis KV ───────────────────────────────────
    const stateKey  = `cron:fm:${fmId}`
    let   prevState = null
    try { prevState = await kv.get(stateKey) } catch {}
    // prevState = "live|0-0" | "ht|1-0" | "finished|2-1" | "scheduled|0-0"

    const stateNow = isFinished ? 'finished' : isHT ? 'ht' : isLive ? 'live' : 'scheduled'
    const [prevSt = null, prevScore = null] = prevState ? prevState.split('|') : []

    // Sauvegarder l'état actuel (TTL 12h)
    try { await kv.set(stateKey, `${stateNow}|${score}`, { ex: 12 * 3600 }) } catch {}

    // Premier poll pour ce match → baseline, pas de notif
    if (prevState === null) {
      log.push(`[fm:${fmId}] baseline ${stateNow}|${score}`)
      continue
    }

    // ── 🔴 Coup d'envoi ──────────────────────────────────────────────────
    if (prevSt === 'scheduled' && isLive && !isHT) {
      log.push(`[fm:${fmId}] KO`)
      const sent = await sendDeduped(
        `push:fm:ko:${fmId}`,
        { title: '🔴 Coup d\'envoi !', body: `${homeTeam} – ${awayTeam}`, url: '/live' }
      )
      if (sent > 0) notifsSent++
    }

    // ── ⏸ Mi-temps ───────────────────────────────────────────────────────
    if (prevSt === 'live' && isHT) {
      log.push(`[fm:${fmId}] mi-temps`)
      const sent = await sendDeduped(
        `push:fm:ht:${fmId}`,
        { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }
      )
      if (sent > 0) notifsSent++
    }

    // ── ▶️ Reprise 2ème MT ────────────────────────────────────────────────
    if (prevSt === 'ht' && isLive && !isHT) {
      log.push(`[fm:${fmId}] reprise`)
      const sent = await sendDeduped(
        `push:fm:2h:${fmId}`,
        { title: '▶️ Reprise !', body: `2ème MT · ${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }
      )
      if (sent > 0) notifsSent++
    }

    // ── 🏁 Fin de match ───────────────────────────────────────────────────
    if ((prevSt === 'live' || prevSt === 'ht') && isFinished) {
      log.push(`[fm:${fmId}] FT`)
      const sent = await sendDeduped(
        `push:fm:ft:${fmId}`,
        { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }
      )
      if (sent > 0) notifsSent++
    }

    // ── ⚽ But ─────────────────────────────────────────────────────────────
    if (isLive && !isHT && prevScore !== null && prevScore !== score) {
      log.push(`[fm:${fmId}] but ${prevScore} → ${score}`)
      const sent = await sendDeduped(
        `push:fm:goal:${fmId}:${score}`,
        { title: '⚽ But !', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/' }
      )
      if (sent > 0) notifsSent++
    }
  }

  // ── Fallback ESPN si FotMob down (0 matchs récupérés) ────────────────────
  const liveCount = [...matchMap.values()].filter(fmIsLive).length
  if (matchMap.size === 0) {
    log.push('[fallback] FotMob vide → ESPN')
    const espnEventsT = await fetchEspnEvents(today)
    const espnEventsY = await fetchEspnEvents(yesterday)

    for (const { slug, evt } of [...espnEventsT, ...espnEventsY]) {
      const comp = evt.competitions?.[0]
      if (!comp) continue
      const status  = comp.status?.type?.name ?? ''
      const homeC   = comp.competitors?.find(c => c.homeAway === 'home')
      const awayC   = comp.competitors?.find(c => c.homeAway === 'away')
      if (!homeC || !awayC) continue

      const home     = parseInt(homeC.score ?? '0', 10) || 0
      const away     = parseInt(awayC.score ?? '0', 10) || 0
      const homeTeam = homeC.team?.shortDisplayName ?? homeC.team?.displayName ?? '?'
      const awayTeam = awayC.team?.shortDisplayName ?? awayC.team?.displayName ?? '?'
      const score    = `${home}-${away}`
      const scoreStr = `${home} – ${away}`
      const eventId  = evt.id

      const stateKey  = `cron:state:${eventId}`
      let   prevState = null
      try { prevState = await kv.get(stateKey) } catch {}
      const [prevStatus = null, prevScore = null] = prevState ? prevState.split('|') : []
      try { await kv.set(stateKey, `${status}|${score}`, { ex: 12 * 3600 }) } catch {}

      if (prevState === null) { log.push(`[espn:${eventId}] baseline`); continue }

      // KO
      if (!LIVE_ESPN.has(prevStatus) && status === 'STATUS_IN_PROGRESS') {
        const sent = await sendDeduped(`push:cron:ko:${eventId}`, { title: '🔴 Coup d\'envoi !', body: `${homeTeam} – ${awayTeam}`, url: '/live' })
        if (sent > 0) notifsSent++
      }
      // Mi-temps
      if (LIVE_ESPN.has(prevStatus) && prevStatus !== 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME') {
        const sent = await sendDeduped(`push:cron:ht:${eventId}`, { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
        if (sent > 0) notifsSent++
      }
      // FT
      if (LIVE_ESPN.has(prevStatus) && FINAL_ESPN.has(status)) {
        const sent = await sendDeduped(`push:cron:ft:${eventId}`, { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
        if (sent > 0) notifsSent++
      }
      // But
      if (LIVE_ESPN.has(status) && status !== 'STATUS_HALFTIME' && prevScore !== null && prevScore !== score) {
        log.push(`[espn:${eventId}] but ${prevScore} → ${score}`)
        const sent = await sendDeduped(`push:goal:cron:${eventId}:${score}`, { title: '⚽ But !', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/' })
        if (sent > 0) notifsSent++
      }
    }
  }

  return res.status(200).json({
    ok: true,
    matches: matchMap.size,
    live: liveCount,
    notifsSent,
    log,
  })
}
