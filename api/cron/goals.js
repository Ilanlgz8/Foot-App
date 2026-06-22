// api/cron/goals.js
// Appelé par cron-job.org toutes les minutes.
// Source : FIFA API officielle (primaire — couvre WC 2026 + toutes compétitions)
//          ESPN (fallback uniquement si FIFA down — erreur réseau)
//
// Détecte et notifie :
//   ⚽ But         — score change pendant un match en cours
//   🔴 Coup d'envoi — match démarre
//   ⏸  Mi-temps    — pause mi-temps
//   ▶️  Reprise     — reprise 2ème MT
//   🏁 Fin de match — match terminé
//
// Sécurité : header "x-cron-secret" ou param ?secret= doit matcher CRON_SECRET.

import { Redis } from '@upstash/redis'
import webpush   from 'web-push'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const FIFA_LIVE_URL = 'https://api.fifa.com/api/v3/live/football'

// ── FIFA helpers ───────────────────────────────────────────────────────────────

async function fetchFifaLive(log = []) {
  try {
    const res = await fetch(FIFA_LIVE_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(7_000),
    })
    log.push(`[fifa] status=${res.status}`)
    if (!res.ok) return null   // null = erreur → fallback ESPN
    const json = await res.json()
    const results = json.Results ?? []
    log.push(`[fifa] live=${results.length}`)
    return results             // [] = pas de matchs en cours (normal)
  } catch (e) {
    log.push(`[fifa] error=${e.message}`)
    return null
  }
}

function fifaTeamName(team) {
  return team?.TeamName?.find(t => /^en/i.test(t.Locale))?.Description
    ?? team?.TeamName?.[0]?.Description
    ?? '?'
}

// ── Filtre compétitions suivies (source FIFA) ──────────────────────────────────
// L'API FIFA /live/football renvoie TOUTES compétitions FIFA (U20 WC, Club WC,
// qualifications olympiques, etc.). On ne notifie que celles couvertes par l'app.
// Principalement : FIFA World Cup 2026.
// Si le champ CompetitionName est absent → on laisse passer (safe default).
const FIFA_COMP_WHITELIST = [
  /world\s*cup/i,        // FIFA World Cup
  /coupe\s*du\s*monde/i, // traduction FR éventuelle
]

function isFifaTrackedComp(m) {
  // Essai sur le nom de la compétition (champ localisé)
  const compArr = m.CompetitionName ?? m.Competition?.Name ?? []
  if (Array.isArray(compArr) && compArr.length > 0) {
    const name = compArr.find(n => /^en/i.test(n.Locale))?.Description
      ?? compArr[0]?.Description
      ?? ''
    return FIFA_COMP_WHITELIST.some(re => re.test(name))
  }
  // Essai sur IdCompetition (FIFA World Cup 2026 = '43' historiquement)
  // À ajuster si l'ID réel diffère — le champ CompetitionName est plus fiable.
  if (m.IdCompetition != null) {
    const id = String(m.IdCompetition)
    const TRACKED_IDS = new Set(['43', '17'])  // WC + valeurs alternatives connues
    return TRACKED_IDS.has(id)
  }
  // Pas d'info de compétition → laisser passer pour ne pas bloquer les notifs WC
  return true
}

function fifaScore(m) {
  return { home: m.HomeTeam?.Score ?? 0, away: m.AwayTeam?.Score ?? 0 }
}

// MatchStatus: 0=pas commencé, 1=en cours, 3=terminé
// Period:      0=pré-match, 1=1erMT, 2=2èmeMT, 3=pause MT, 4=Prol MT1, 5=pause Prol, 6=Prol MT2, 7=TAB, 8=FT
function fifaState(m) {
  if (m.MatchStatus === 3 || m.Period === 8) return 'finished'
  // Period=0 = pré-match : FIFA inclut le match dans /live avec MatchStatus=1 avant le coup d'envoi.
  // Sans ce garde, on enverrait un faux KO et potentiellement une fausse "fin de match".
  if (m.MatchStatus !== 1 || m.Period === 0) return 'scheduled'
  if (m.Period === 3 || m.Period === 5)       return 'ht'
  return 'live'
}

// ── Helpers généraux ───────────────────────────────────────────────────────────

function dateStr(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function setupVapid() {
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); return true }
  catch { return false }
}

// ── ESPN fallback (uniquement si FIFA down) ────────────────────────────────────
const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const ESPN_SLUGS = ['fra.1','eng.1','esp.1','ger.1','ita.1','uefa.champions','uefa.europa','uefa.europa.conf']
const LIVE_ESPN  = new Set(['STATUS_IN_PROGRESS','STATUS_HALFTIME','STATUS_END_PERIOD','STATUS_EXTRA_TIME','STATUS_OVERTIME','STATUS_SHOOTOUT'])
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

// ── Push helpers ───────────────────────────────────────────────────────────────

async function sendPushToAll(payload) {
  let subs = []
  try { subs = (await kv.smembers('push:subscriptions')) ?? [] } catch { return 0 }
  if (!subs.length) return 0

  const payloadStr = JSON.stringify(payload)
  const stale = []
  let sent = 0

  await Promise.allSettled(subs.map(async subRaw => {
    let sub
    try { sub = typeof subRaw === 'string' ? JSON.parse(subRaw) : subRaw }
    catch { stale.push(subRaw); return }
    try {
      await webpush.sendNotification(sub, payloadStr, { TTL: 3600 })
      sent++
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404)
        stale.push(typeof subRaw === 'string' ? subRaw : JSON.stringify(subRaw))
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

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] ?? req.query.secret ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: 'Non autorisé' })

  if (!setupVapid())
    return res.status(503).json({ error: 'VAPID non configuré' })

  const now        = new Date()
  const today      = dateStr(now)
  const yesterday  = dateStr(new Date(now - 86_400_000))
  let   notifsSent = 0
  const log        = []

  // ── FIFA live ──────────────────────────────────────────────────────────────
  const fifaMatches = await fetchFifaLive(log)
  const fifaOk      = fifaMatches !== null   // false = erreur réseau

  if (fifaOk) {
    for (const m of fifaMatches) {
      // Filtrer les compétitions non suivies (U20 WC, Club WC qualifs, etc.)
      if (!isFifaTrackedComp(m)) {
        log.push(`[fifa:${m.IdMatch}] compétition ignorée (${m.CompetitionName?.[0]?.Description ?? m.IdCompetition ?? '?'})`)
        continue
      }

      const matchId  = m.IdMatch
      const homeTeam = fifaTeamName(m.HomeTeam)
      const awayTeam = fifaTeamName(m.AwayTeam)
      const { home, away } = fifaScore(m)
      const score    = `${home}-${away}`
      const scoreStr = `${home} – ${away}`
      const state    = fifaState(m)

      const stateKey  = `cron:fifa:${matchId}`
      let   prevState = null
      try { prevState = await kv.get(stateKey) } catch {}
      const [prevSt = null, prevScore = null] = prevState ? prevState.split('|') : []

      // Sauvegarder état (TTL 12h)
      try { await kv.set(stateKey, `${state}|${score}`, { ex: 12 * 3600 }) } catch {}

      // Premier poll → baseline, pas de notif
      if (prevState === null) { log.push(`[fifa:${matchId}] baseline ${state}|${score}`); continue }

      // 🔴 Coup d'envoi
      if (prevSt === 'scheduled' && state === 'live') {
        log.push(`[fifa:${matchId}] KO`)
        const sent = await sendDeduped(`push:fifa:ko:${matchId}`,
          { title: '🔴 Coup d\'envoi !', body: `${homeTeam} – ${awayTeam}`, url: '/live' })
        if (sent > 0) notifsSent++
      }

      // ⏸ Mi-temps
      if (prevSt === 'live' && state === 'ht') {
        log.push(`[fifa:${matchId}] mi-temps`)
        const sent = await sendDeduped(`push:fifa:ht:${matchId}`,
          { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
        if (sent > 0) notifsSent++
      }

      // ▶️ Reprise
      if (prevSt === 'ht' && state === 'live') {
        log.push(`[fifa:${matchId}] reprise`)
        const sent = await sendDeduped(`push:fifa:2h:${matchId}`,
          { title: '▶️ Reprise !', body: `2ème MT · ${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
        if (sent > 0) notifsSent++
      }

      // 🏁 Fin de match
      if ((prevSt === 'live' || prevSt === 'ht') && state === 'finished') {
        // Garde anti-faux-FT : vérifier que le match a vraiment eu lieu au moins ~85 min.
        // FIFA peut brièvement montrer MatchStatus=3 pendant la transition pré-match → 1erMT.
        // MatchTime='FT' ou '90+X' = FT réel. MatchTime vide ou '0' = faux FT.
        const rawTime  = (m.MatchTime ?? '').replace(/[^0-9+]/g, '').trim()
        const isFakeFt = rawTime === '' || rawTime === '0'
        if (isFakeFt) {
          // Remettre à 'scheduled' pour pouvoir détecter le vrai KO ensuite
          try { await kv.set(stateKey, `scheduled|${score}`, { ex: 12 * 3600 }) } catch {}
          log.push(`[fifa:${matchId}] faux FT ignoré (MatchTime='${m.MatchTime ?? ''}') → reset scheduled`)
        } else {
          log.push(`[fifa:${matchId}] FT`)
          const sent = await sendDeduped(`push:fifa:ft:${matchId}`,
            { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
          if (sent > 0) notifsSent++
        }
      }

      // ⚽ But
      if ((state === 'live' || state === 'ht') && prevScore !== null && prevScore !== score) {
        log.push(`[fifa:${matchId}] but ${prevScore} → ${score}`)
        const sent = await sendDeduped(`push:fifa:goal:${matchId}:${score}`,
          { title: '⚽ But !', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/' })
        if (sent > 0) notifsSent++
      }
    }
  }

  // ── ESPN fallback si FIFA down (erreur réseau) ─────────────────────────────
  if (!fifaOk) {
    log.push('[fallback] FIFA erreur → ESPN')
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

      if (!LIVE_ESPN.has(prevStatus) && status === 'STATUS_IN_PROGRESS') {
        const sent = await sendDeduped(`push:cron:ko:${eventId}`, { title: '🔴 Coup d\'envoi !', body: `${homeTeam} – ${awayTeam}`, url: '/live' })
        if (sent > 0) notifsSent++
      }
      if (LIVE_ESPN.has(prevStatus) && prevStatus !== 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME') {
        const sent = await sendDeduped(`push:cron:ht:${eventId}`, { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
        if (sent > 0) notifsSent++
      }
      if (LIVE_ESPN.has(prevStatus) && FINAL_ESPN.has(status)) {
        const sent = await sendDeduped(`push:cron:ft:${eventId}`, { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
        if (sent > 0) notifsSent++
      }
      if (LIVE_ESPN.has(status) && status !== 'STATUS_HALFTIME' && prevScore !== null && prevScore !== score) {
        log.push(`[espn:${eventId}] but ${prevScore} → ${score}`)
        const sent = await sendDeduped(`push:goal:cron:${eventId}:${score}`, { title: '⚽ But !', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/' })
        if (sent > 0) notifsSent++
      }
    }
  }

  return res.status(200).json({
    ok:          true,
    fifaOk,
    live:        fifaMatches?.length ?? 0,
    notifsSent,
    log,
  })
}
