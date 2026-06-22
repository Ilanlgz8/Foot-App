// api/espn-live.js
// Source live : FotMob (remplace ESPN — near real-time, couvre la CM 2026)
// Fallback : données Redis si FotMob ne répond pas
//
// Input:  POST { matches: FD_Match[] }
// Output: { [fdMatchId]: { espnStatus, espnClock, espnPeriod, home, away, scorers, stats, espnEventId, espnSlug } }
//
// Les clés espnStatus/espnClock/espnPeriod conservent la nomenclature ESPN
// pour rester compatible avec useLiveMinute.js sans modification côté client.

import { Redis } from '@upstash/redis'
import crypto    from 'crypto'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const FM_BASE     = 'https://www.fotmob.com'
const SB_TTL      = 12          // Cache Redis scoreboard (s)
const DET_TTL     = 20          // Cache Redis matchDetails (s)
const MATCH_TTL   = 6 * 3600   // Données match persistées (s)
const SB_TIMEOUT  = 7_000
const DET_TIMEOUT = 3_500

// ── Auth FotMob ───────────────────────────────────────────────────────────────
// Le header X-Fm-Req = base64( JSON({ body: {url, code}, signature: MD5(body+secret) }) )
// Le secret est stocké dans FOTMOB_SECRET (variable d'env Vercel).
// C'est les paroles de la chanson "Never Gonna Give You Up" de Rick Astley,
// avec des sauts de ligne \n (pas \r\n) et sans saut de ligne final.
function generateFotmobToken(path) {
  const secret = (process.env.FOTMOB_SECRET ?? '').replace(/\r\n/g, '\n').trimEnd()
  if (!secret) return null
  const code = Date.now()
  const body = { url: path, code }
  const signature = crypto
    .createHash('md5')
    .update(JSON.stringify(body) + secret)
    .digest('hex')
    .toUpperCase()
  return Buffer.from(JSON.stringify({ body, signature })).toString('base64')
}

async function fotmobFetch(path, ttl) {
  const cKey = `fm:${path}`

  // Check Redis cache
  try {
    const cached = await kv.get(cKey)
    if (cached) return { data: safeJson(cached), fromCache: true }
  } catch {}

  const token = generateFotmobToken(path)
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
    'Accept':     'application/json',
    'Accept-Language': 'fr-FR,fr;q=0.9',
  }
  if (token) headers['X-Fm-Req'] = token

  try {
    const res = await fetch(`${FM_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(SB_TIMEOUT),
    })
    if (!res.ok) return { data: null, fromCache: false, status: res.status }
    const data = await res.json()
    try { await kv.set(cKey, JSON.stringify(data), { ex: ttl }) } catch {}
    return { data, fromCache: false }
  } catch (err) {
    return { data: null, fromCache: false, error: err.message }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(name = '') {
  return name.toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[éèêë]/g, 'e')
    .replace(/[ûùüú]/g, 'u').replace(/[îïí]/g, 'i')
    .replace(/[ôöó]/g, 'o').replace(/ç/g, 'c')
    .trim()
}

function fuzzyTeam(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (!na || !nb) return false
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true
  const wa = na.split(/\s+/).filter(w => w.length >= 4)
  const wb = nb.split(/\s+/).filter(w => w.length >= 4)
  return wa.some(a => wb.some(b => a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))))
}

function safeJson(val) {
  if (!val) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return null } }
  return val
}

function dateStr(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

// ── FotMob status → ESPN-style status (compatibilité useLiveMinute.js) ────────
function fmToEspnStatus(fm) {
  if (!fm?.status) return 'STATUS_SCHEDULED'
  const { started, finished, cancelled, liveTime } = fm.status
  if (cancelled) return 'STATUS_CANCELED'
  if (!started)  return 'STATUS_SCHEDULED'
  if (finished)  return 'STATUS_FINAL'
  const short = liveTime?.short ?? ''
  if (short === 'HT')               return 'STATUS_HALFTIME'
  if (short === 'ET' || short === 'ET2') return 'STATUS_EXTRA_TIME'
  if (short === 'Pen' || short === 'PEN') return 'STATUS_SHOOTOUT'
  return 'STATUS_IN_PROGRESS'
}

// FotMob "67'" ou "45+2'" → "67:00" ou "45:00+2:00" (format parseClockMins)
function fmClockToEspn(short) {
  if (!short || short === 'HT' || short === 'FT') return ''
  const m = short.replace(/'/g, '').trim()
  if (!m || m === 'ET' || m === 'ET2' || m === 'Pen' || m === 'PEN') return '90:00'
  if (m.includes('+')) {
    const [base, extra] = m.split('+').map(s => parseInt(s, 10))
    if (!isNaN(base) && !isNaN(extra)) return `${base}:00+${extra}:00`
  }
  const mins = parseInt(m, 10)
  return isNaN(mins) ? '' : `${mins}:00`
}

function fmPeriod(fm) {
  if (!fm?.status?.started || fm.status.finished) return null
  const short = fm.status?.liveTime?.short ?? ''
  if (!short || short === 'HT') return null
  const m = short.replace(/'/g, '').trim()
  if (m === 'ET' || m === 'ET2') return 3
  if (m === 'Pen' || m === 'PEN') return 5
  const mins = parseInt(m.split('+')[0], 10)
  if (isNaN(mins)) return null
  return mins <= 45 ? 1 : 2
}

function fmScore(fm) {
  // Préférer le score direct, sinon parser scoreStr "1 - 0"
  const h = fm.home?.score
  const a = fm.away?.score
  if (typeof h === 'number' && typeof a === 'number') return { home: h, away: a }
  const str = fm.status?.scoreStr ?? '0 - 0'
  const parts = str.split(/\s*-\s*/).map(Number)
  return { home: parts[0] || 0, away: parts[1] || 0 }
}

// ── Extraction des buteurs depuis matchDetails FotMob ─────────────────────────
function extractFmScorers(detailData, homeTeamId) {
  if (!detailData) return []
  try {
    // Les events sont dans content.matchFacts.events.events (structure commune)
    const events =
      detailData.content?.matchFacts?.events?.events ??
      detailData.content?.events?.events ??
      []

    return events
      .filter(e => {
        const t = (e.type ?? '').toLowerCase()
        return t === 'goal' || t === 'penaltygoal' || t === 'owngoal'
      })
      .map(e => ({
        name:        e.player?.shortName ?? e.player?.name ?? '?',
        minute:      e.time != null ? `${e.time}'` : '',
        team:        e.teamId === homeTeamId ? 'home' : 'away',
        ownGoal:     (e.type ?? '').toLowerCase() === 'owngoal' || e.isOwnGoal === true,
        penaltyKick: (e.type ?? '').toLowerCase() === 'penaltygoal' || e.isPenalty === true,
      }))
  } catch { return [] }
}

// ── Extraction des stats depuis matchDetails FotMob ───────────────────────────
function extractFmStats(detailData) {
  if (!detailData) return null
  try {
    const statsArr =
      detailData.content?.stats?.stats?.[0]?.stats ??
      detailData.content?.stats?.stats ?? []

    const find = (...titles) => {
      for (const title of titles) {
        const s = statsArr.find(x =>
          x.title?.toLowerCase().includes(title.toLowerCase())
        )
        if (s?.stats?.length >= 2) return s.stats
      }
      return null
    }

    const poss   = find('possession')
    const shots  = find('total shots', 'shots')
    const sot    = find('shots on target', 'on target')
    const corner = find('corners', 'corner kicks')

    const parsePct = v => v ? parseFloat(v.replace('%', '')) || null : null
    const parseNum = v => v != null ? parseInt(v, 10) || null : null

    const result = {
      home: {
        poss:         poss   ? parsePct(poss[0])   : null,
        shots:        shots  ? parseNum(shots[0])  : null,
        shotsOnTarget: sot   ? parseNum(sot[0])    : null,
        corners:      corner ? parseNum(corner[0]) : null,
      },
      away: {
        poss:         poss   ? parsePct(poss[1])   : null,
        shots:        shots  ? parseNum(shots[1])  : null,
        shotsOnTarget: sot   ? parseNum(sot[1])    : null,
        corners:      corner ? parseNum(corner[1]) : null,
      },
    }
    if (result.home.poss === null && result.home.shots === null) return null
    return result
  } catch { return null }
}

const LIVE_FM_STATUSES = new Set([
  'STATUS_IN_PROGRESS',
  'STATUS_HALFTIME',
  'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME',
  'STATUS_OVERTIME',
  'STATUS_SHOOTOUT',
])

// ── Fallback ESPN (si FotMob down) ────────────────────────────────────────────
// ESPN fonctionne pour les ligues club (Ligue 1, PL, Liga…)
// mais PAS pour la CM 2026 (cache CDN statique côté ESPN).
// On skip fifa.world dans le fallback ESPN — les matchs WC restent en Redis last-known.

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const ESPN_TTL  = 15   // cache Redis pour ESPN fallback (s)
const ESPN_TIMEOUT = 5_000

// competition FD.org → slug ESPN (sans fifa.world — ESPN ne retourne pas le live WC)
const COMP_ESPN_FALLBACK = {
  2015: 'fra.1',
  2021: 'eng.1',
  2014: 'esp.1',
  2002: 'ger.1',
  2019: 'ita.1',
  2001: 'uefa.champions',
  2146: 'uefa.europa',
  2048: 'uefa.europa.conf',
}

function parseEspnScore(raw) {
  if (raw == null) return 0
  if (typeof raw === 'number') return Math.round(raw)
  if (typeof raw === 'string') return parseInt(raw, 10) || 0
  if (typeof raw === 'object') return parseInt(raw.displayValue ?? raw.value ?? '0', 10) || 0
  return 0
}

function extractEspnScorers(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const txt = (d.type?.text ?? '').toLowerCase()
      const id  = String(d.type?.id ?? '')
      return txt.includes('goal') || txt === 'penaltykick' || id === '57' || id === '58' || id === '72'
    })
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      const txt = (d.type?.text ?? '').toLowerCase()
      return {
        name:        ath?.shortName ?? ath?.displayName ?? '?',
        minute:      d.clock?.displayValue ?? '',
        team:        d.team?.id === homeTeamId ? 'home' : 'away',
        ownGoal:     d.ownGoal ?? txt.includes('own') ?? false,
        penaltyKick: d.penaltyKick ?? txt.includes('penalty') ?? false,
      }
    })
}

async function fetchEspnEvents(slugSet, today, yesterday) {
  const allEvents = []

  await Promise.allSettled([...slugSet].map(async slug => {
    const cKey = `espn:fb:${slug}`
    let events = null
    try {
      const cached = await kv.get(cKey)
      if (cached) { events = safeJson(cached); }
    } catch {}

    if (!events) {
      try {
        const [rT, rY] = await Promise.all([
          fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${today}`,     { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(ESPN_TIMEOUT) }),
          fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${yesterday}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(ESPN_TIMEOUT) }),
        ])
        const [jT, jY] = await Promise.all([
          rT.ok ? rT.json() : { events: [] },
          rY.ok ? rY.json() : { events: [] },
        ])
        events = [...(jT.events ?? []), ...(jY.events ?? [])]
        try { await kv.set(cKey, JSON.stringify(events), { ex: ESPN_TTL }) } catch {}
      } catch { events = [] }
    }

    for (const evt of (events ?? [])) allEvents.push({ slug, evt })
  }))

  return allEvents
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') return res.status(405).end()

  // Rate limiting : 60 req / IP / minute
  const ip    = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rlKey = `ratelimit:espnlive:${ip}`
  try {
    const count = await kv.incr(rlKey)
    if (count === 1) await kv.expire(rlKey, 60)
    if (count > 60) return res.status(429).json({ error: 'Trop de requêtes' })
  } catch {}

  const { matches } = req.body ?? {}
  if (!Array.isArray(matches) || !matches.length) return res.json({})
  if (matches.length > 20) return res.status(400).json({ error: 'Trop de matchs (max 20)' })

  // Dates : J + J-1
  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))

  // Données persistées (fallback si FotMob ne répond pas)
  let storedMatches = Array(matches.length).fill(null)
  try {
    const keys = matches.map(m => `fm:match:${m.id}`)
    storedMatches = await kv.mget(...keys)
  } catch {}

  const storedData = {}
  matches.forEach((m, i) => {
    const d = safeJson(storedMatches[i])
    if (d) storedData[m.id] = d
  })

  // ── Fetch FotMob (today + yesterday) ──────────────────────────────────────
  const [resT, resY] = await Promise.all([
    fotmobFetch(`/api/matches?date=${today}`,     SB_TTL),
    fotmobFetch(`/api/matches?date=${yesterday}`, SB_TTL),
  ])

  // Aplatir tous les matchs FotMob
  const allFmMatches = []
  for (const r of [resT, resY]) {
    if (!r.data) continue
    for (const league of (r.data.leagues ?? [])) {
      for (const fm of (league.matches ?? [])) {
        allFmMatches.push(fm)
      }
    }
  }

  // ── Matching FotMob → FD.org ──────────────────────────────────────────────
  const result       = {}
  const matchedFmIds = new Set()

  for (const fdMatch of matches) {
    const fdHome = fdMatch.homeTeam?.name ?? fdMatch.homeTeam?.shortName ?? ''
    const fdAway = fdMatch.awayTeam?.name ?? fdMatch.awayTeam?.shortName ?? ''
    if (!fdHome || !fdAway) continue

    const fm = allFmMatches.find(x => {
      if (matchedFmIds.has(x.id)) return false
      return fuzzyTeam(fdHome, x.home?.name ?? '') && fuzzyTeam(fdAway, x.away?.name ?? '')
    })
    if (!fm) continue

    matchedFmIds.add(fm.id)

    const espnStatus = fmToEspnStatus(fm)
    const espnClock  = fmClockToEspn(fm.status?.liveTime?.short)
    const espnPeriod = fmPeriod(fm)
    const { home, away } = fmScore(fm)

    const prevData    = storedData[fdMatch.id]
    const prevScorers = prevData?.scorers ?? []

    // Invalider le cache details si nouveau but
    const prevTotal = (prevData?.home ?? -1) + (prevData?.away ?? -1)
    if (prevData && (home + away) > prevTotal) {
      try { await kv.del(`fm:det:${fdMatch.id}`) } catch {}
    }

    result[fdMatch.id] = {
      espnEventId: String(fm.id),
      espnSlug:    'fotmob',
      espnStatus,
      espnClock,
      espnPeriod,
      home,
      away,
      scorers: prevScorers,  // sera enrichi par matchDetails ci-dessous
      stats:   prevData?.stats ?? null,
      fromCache: resT.fromCache && resY.fromCache,
    }
  }

  // ── Fallback ESPN (si FotMob down — 0 matchs retournés) ───────────────────
  // Couvre les ligues club (Ligue 1, PL, Liga…) mais pas la WC.
  // Les matchs WC non couverts tomberont en Redis last-known ci-dessous.
  if (allFmMatches.length === 0) {
    const slugSet = new Set()
    for (const m of matches) {
      const s = COMP_ESPN_FALLBACK[m.competition?.id]
      if (s) slugSet.add(s)
    }

    if (slugSet.size > 0) {
      const espnEvents = await fetchEspnEvents(slugSet, today, yesterday)

      for (const { slug, evt } of espnEvents) {
        const comp = evt.competitions?.[0]
        if (!comp) continue
        const st         = comp.status
        const espnStatus = st?.type?.name
        if (!espnStatus) continue

        const homeC = (comp.competitors ?? []).find(c => c.homeAway === 'home')
        const awayC = (comp.competitors ?? []).find(c => c.homeAway === 'away')
        if (!homeC || !awayC) continue

        const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
        const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''

        const fdMatch = matches.find(m => {
          if (result[m.id]) return false
          const h = m.homeTeam?.name ?? m.homeTeam?.shortName ?? ''
          const a = m.awayTeam?.name ?? m.awayTeam?.shortName ?? ''
          return fuzzyTeam(h, espnHome) && fuzzyTeam(a, espnAway)
        })
        if (!fdMatch) continue

        const home    = parseEspnScore(homeC.score)
        const away    = parseEspnScore(awayC.score)
        const scorers = extractEspnScorers(comp, homeC.team?.id)
        const prevData = storedData[fdMatch.id]
        const bestScorers = scorers.length >= (prevData?.scorers?.length ?? 0)
          ? scorers : (prevData?.scorers ?? [])

        result[fdMatch.id] = {
          espnEventId: evt.id,
          espnSlug:    slug,
          espnStatus,
          espnClock:   st.displayClock ?? '',
          espnPeriod:  st.period ?? null,
          home,
          away,
          scorers: bestScorers,
          stats:   prevData?.stats ?? null,
          source:  'espn-fallback',
        }
      }
    }
  }

  // ── matchDetails pour matchs live (buteurs + stats) ───────────────────────
  const detailJobs = []

  for (const [midStr, data] of Object.entries(result)) {
    if (!LIVE_FM_STATUSES.has(data.espnStatus)) continue

    const mid    = Number(midStr)
    const fmId   = data.espnEventId
    const detKey = `fm:det:${mid}`

    detailJobs.push((async () => {
      let detData = null
      try {
        const cached = await kv.get(detKey)
        if (cached) detData = safeJson(cached)
      } catch {}

      if (!detData) {
        const detPath = `/api/matchDetails?matchId=${fmId}`
        const r = await fotmobFetch(detPath, DET_TTL)
        if (r.data) {
          detData = r.data
          try { await kv.set(detKey, JSON.stringify(detData), { ex: DET_TTL }) } catch {}
        }
      }

      if (!detData) return

      // Identifier l'ID de l'équipe à domicile
      const homeTeam = detData.header?.teams?.[0] ?? {}
      const homeTeamId = homeTeam.id

      const scorers = extractFmScorers(detData, homeTeamId)
      const stats   = extractFmStats(detData)

      const curr = result[midStr]
      if (!curr) return
      if (scorers.length >= (curr.scorers?.length ?? 0)) curr.scorers = scorers
      if (stats) curr.stats = stats
    })())
  }

  if (detailJobs.length > 0) {
    await Promise.allSettled(detailJobs)
  }

  // ── Persistance Redis (scorer preservation cross-session) ─────────────────
  const writes = []
  for (const [midStr, data] of Object.entries(result)) {
    writes.push(kv.set(`fm:match:${midStr}`, JSON.stringify(data), { ex: MATCH_TTL }))
  }
  if (writes.length > 0) await Promise.allSettled(writes)

  // ── Fallback cache pour matchs non trouvés dans FotMob ────────────────────
  for (const m of matches) {
    if (result[m.id]) continue
    const stored = storedData[m.id]
    if (stored) result[m.id] = { ...stored, fromCache: true }
  }

  return res.json(result)
}
