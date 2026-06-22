// api/fifa-live.js
// Source live : FIFA API officielle (primaire — couvre WC 2026 + toutes compétitions)
//               ESPN (fallback ligues club si match pas dans FIFA live)
// Fallback final : données Redis last-known
//
// Input:  POST { matches: FD_Match[] }
// Output: { [fdMatchId]: { espnStatus, espnClock, espnPeriod, home, away, scorers, stats, espnEventId, espnSlug } }

import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const FIFA_LIVE_URL = 'https://api.fifa.com/api/v3/live/football'
const FIFA_TTL      = 12          // Cache Redis FIFA live (s)
const ESPN_BASE     = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const ESPN_TTL      = 15          // Cache Redis ESPN (s)
const MATCH_TTL     = 6 * 3600   // Données match persistées (s)
const ESPN_TIMEOUT  = 5_000
const FIFA_TIMEOUT  = 7_000

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeJson(val) {
  if (!val) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return null } }
  return val
}

function dateStr(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function normalize(name = '') {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function fuzzyTeam(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true
  const wa = na.match(/[a-z]{4,}/g) ?? []
  const wb = nb.match(/[a-z]{4,}/g) ?? []
  return wa.some(x => wb.some(y => x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))))
}

// ── FIFA fetch + cache ─────────────────────────────────────────────────────────

async function fetchFifaLive() {
  const cKey = 'fifa:live'
  try {
    const cached = await kv.get(cKey)
    if (cached) return { data: safeJson(cached), fromCache: true }
  } catch {}

  try {
    const res = await fetch(FIFA_LIVE_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(FIFA_TIMEOUT),
    })
    if (!res.ok) return { data: null, fromCache: false }
    const json = await res.json()
    const data = json.Results ?? []
    try { await kv.set(cKey, JSON.stringify(data), { ex: FIFA_TTL }) } catch {}
    return { data, fromCache: false }
  } catch {
    return { data: null, fromCache: false }
  }
}

// ── FIFA status/period → ESPN-style ───────────────────────────────────────────
// MatchStatus : 0=pas commencé  1=en cours  3=terminé
// Period      : 1=1erMT  2=2èmeMT  3=pause MT  4=Prol MT1  5=pause Prol  6=Prol MT2  7=TAB  8=FT

function fifaToEspnStatus(m) {
  const s = m.MatchStatus, p = m.Period
  if (s === 3 || p === 8) return 'STATUS_FINAL'
  // Period=0 = pré-match : FIFA inclut le match avec MatchStatus=1 avant le vrai KO.
  // Traiter comme SCHEDULED pour éviter un faux STATUS_IN_PROGRESS qui déclencherait
  // markLive() + notifyKickoff() 5min avant l'heure.
  if (s !== 1 || p === 0) return 'STATUS_SCHEDULED'
  if (p === 3 || p === 5) return 'STATUS_HALFTIME'
  if (p === 4 || p === 6) return 'STATUS_EXTRA_TIME'
  if (p === 7)            return 'STATUS_SHOOTOUT'
  return 'STATUS_IN_PROGRESS'
}

function fifaToClock(m) {
  const t = (m.MatchTime ?? '').replace(/'/g, '').trim()
  if (!t || t === 'HT' || t === 'FT') return ''
  const mins = parseInt(t, 10)
  return isNaN(mins) ? '' : `${mins}:00`
}

function fifaToPeriod(m) {
  const p = m.Period
  if (p === 4 || p === 6) return 3   // prolongations → period 3 (ET)
  if (p === 7)            return 5   // TAB → period 5
  if (p === 2)            return 2   // 2ème MT
  return 1
}

function fifaScore(m) {
  return { home: m.HomeTeam?.Score ?? 0, away: m.AwayTeam?.Score ?? 0 }
}

function fifaTeamName(team) {
  return team?.TeamName?.find(t => /^en/i.test(t.Locale))?.Description
    ?? team?.TeamName?.[0]?.Description
    ?? '?'
}

function fifaPlayerName(goal) {
  // FIFA WC API peut utiliser différents formats selon la compétition / version API.
  // On essaie tous les champs connus dans l'ordre de préférence.
  return (
    // Format standard : tableau { Locale, Description }
    goal.PlayerName?.find(n => /^en/i.test(n.Locale))?.Description
    ?? goal.PlayerName?.[0]?.Description
    // Format alternatif parfois utilisé en WC
    ?? goal.ShortPlayerName?.find(n => /^en/i.test(n.Locale))?.Description
    ?? goal.ShortPlayerName?.[0]?.Description
    // Champs plats éventuels
    ?? goal.PlayerShortName
    ?? goal.Name
    ?? null  // null = pas de nom connu → le widget cachera le scorer
  )
}

function extractFifaScorers(m) {
  const scorers = []
  try {
    for (const goal of (m.HomeTeam?.Goals ?? [])) {
      const name = fifaPlayerName(goal)
      if (!name) continue  // but sans nom connu → ne pas afficher '?'
      scorers.push({
        name,
        minute:      goal.Minute != null ? `${goal.Minute}'` : '',
        team:        'home',
        ownGoal:     goal.OwnGoal === true,
        penaltyKick: goal.Penalty === true,
      })
    }
    for (const goal of (m.AwayTeam?.Goals ?? [])) {
      const name = fifaPlayerName(goal)
      if (!name) continue
      scorers.push({
        name,
        minute:      goal.Minute != null ? `${goal.Minute}'` : '',
        team:        'away',
        ownGoal:     goal.OwnGoal === true,
        penaltyKick: goal.Penalty === true,
      })
    }
    scorers.sort((a, b) => parseInt(a.minute) - parseInt(b.minute))
  } catch {}
  return scorers
}

// ── ESPN fallback (ligues club) ────────────────────────────────────────────────

// competition FD.org → slug ESPN (WC 2026 exclu — FIFA couvre le WC)
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
      if (cached) events = safeJson(cached)
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

// ── Handler ────────────────────────────────────────────────────────────────────

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

  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))

  // Charger les données Redis last-known
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

  const result = {}

  // ── FIFA live ──────────────────────────────────────────────────────────────
  const { data: fifaLive, fromCache: fifaCached } = await fetchFifaLive()

  if (fifaLive && fifaLive.length > 0) {
    const matchedIds = new Set()

    for (const fdMatch of matches) {
      const fdHome = fdMatch.homeTeam?.name ?? fdMatch.homeTeam?.shortName ?? ''
      const fdAway = fdMatch.awayTeam?.name ?? fdMatch.awayTeam?.shortName ?? ''
      if (!fdHome || !fdAway) continue

      const fifaMatch = fifaLive.find(m => {
        if (matchedIds.has(m.IdMatch)) return false
        return fuzzyTeam(fdHome, fifaTeamName(m.HomeTeam))
          && fuzzyTeam(fdAway, fifaTeamName(m.AwayTeam))
      })
      if (!fifaMatch) continue

      matchedIds.add(fifaMatch.IdMatch)

      const espnStatus = fifaToEspnStatus(fifaMatch)
      const { home, away } = fifaScore(fifaMatch)
      const scorers   = extractFifaScorers(fifaMatch)
      const prevData  = storedData[fdMatch.id]
      const bestScorers = scorers.length >= (prevData?.scorers?.length ?? 0)
        ? scorers : (prevData?.scorers ?? [])

      result[fdMatch.id] = {
        espnEventId: fifaMatch.IdMatch,
        espnSlug:    'fifa',
        espnStatus,
        espnClock:   fifaToClock(fifaMatch),
        espnPeriod:  fifaToPeriod(fifaMatch),
        home,
        away,
        scorers:   bestScorers,
        stats:     prevData?.stats ?? null,
        fromCache: fifaCached,
      }
    }
  }

  // ── ESPN fallback pour matchs pas dans FIFA live ───────────────────────────
  const needsEspn = matches.filter(m => !result[m.id])
  if (needsEspn.length > 0) {
    const slugSet = new Set()
    for (const m of needsEspn) {
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

        const fdMatch = needsEspn.find(m => {
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
          scorers:   bestScorers,
          stats:     prevData?.stats ?? null,
          source:    'espn',
        }
      }
    }
  }

  // ── Persistance Redis ─────────────────────────────────────────────────────
  const writes = []
  for (const [midStr, data] of Object.entries(result)) {
    writes.push(kv.set(`fm:match:${midStr}`, JSON.stringify(data), { ex: MATCH_TTL }))
  }
  if (writes.length > 0) await Promise.allSettled(writes)

  // ── Redis last-known pour matchs non trouvés ──────────────────────────────
  for (const m of matches) {
    if (result[m.id]) continue
    const stored = storedData[m.id]
    if (stored) result[m.id] = { ...stored, fromCache: true }
  }

  return res.json(result)
}
