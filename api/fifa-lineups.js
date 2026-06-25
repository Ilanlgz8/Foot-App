// api/fifa-lineups.js
// Compositions FIFA pour WC 2026.
//
// Stratégie (sans Redis requis) :
//   1. Cache Redis lineup (7j) — si lineup déjà fetchée
//   2. Cache Redis matchIds (7j) — si IDs FIFA déjà découverts
//   3. Autodiscovery FIFA : calendar/matches?date → fuzzy match → IDs
//   4. Fetch lineup via api.fifa.com
//
// GET /api/fifa-lineups?fdMatchId=&home=&away=&utcDate=

import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const FIFA_BASE  = 'https://api.fifa.com/api/v3'
const WC_COMP_ID = '17'  // FIFA World Cup competition ID (stable)

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeJson(val) {
  if (!val) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return null } }
  return val
}

async function fifaFetch(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'Accept':          'application/json',
        'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return { ok: false, data: null, status: res.status }
    const data = await res.json()
    return { ok: true, data }
  } catch (e) {
    return { ok: false, data: null, status: 0, err: e.message }
  }
}

// Normalise un nom d'équipe pour comparaison fuzzy
function normTeam(name = '') {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|afc|cf|sc|republic|united|city|real|atletico|national|team)\b/gi, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function fuzzyMatch(a, b) {
  const na = normTeam(a), nb = normTeam(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  const wa = new Set(na.split(' ').filter(w => w.length > 1))
  const wb = new Set(nb.split(' ').filter(w => w.length > 1))
  const inter = [...wa].filter(w => wb.has(w)).length
  const union = new Set([...wa, ...wb]).size
  return union > 0 && inter / union >= 0.5
}

// Extrait un nom localisé en anglais depuis le tableau FIFA [{Locale, Description}]
function parseName(arr) {
  if (!arr) return null
  if (typeof arr === 'string') return arr
  if (!Array.isArray(arr)) return null
  return (
    arr.find(n => /^en/i.test(n.Locale ?? n.locale ?? ''))?.Description
    ?? arr.find(n => /^en/i.test(n.Locale ?? n.locale ?? ''))?.description
    ?? arr[0]?.Description ?? arr[0]?.description ?? null
  )
}

// ── Autodiscovery FIFA ─────────────────────────────────────────────────────────

async function discoverFifaMatch(utcDate, homeTeam, awayTeam) {
  if (!utcDate) return null

  const d = utcDate.slice(0, 10)  // YYYY-MM-DD
  const prev = new Date(d); prev.setUTCDate(prev.getUTCDate() - 1)
  const next = new Date(d); next.setUTCDate(next.getUTCDate() + 1)
  const datesToTry = [d, prev.toISOString().slice(0, 10), next.toISOString().slice(0, 10)]

  for (const tryDate of datesToTry) {
    const url = `${FIFA_BASE}/calendar/matches`
      + `?idCompetition=${WC_COMP_ID}`
      + `&dateFrom=${tryDate}&dateTo=${tryDate}`
      + `&language=en&count=20`

    const { ok, data } = await fifaFetch(url)
    if (!ok || !data) continue

    const matches = data.Results ?? data.results ?? []
    for (const m of matches) {
      const fifaHome = parseName(m.Home?.TeamName) ?? m.Home?.ShortClubName ?? ''
      const fifaAway = parseName(m.Away?.TeamName) ?? m.Away?.ShortClubName ?? ''

      if (fuzzyMatch(homeTeam, fifaHome) && fuzzyMatch(awayTeam, fifaAway)) {
        return {
          fifaMatchId:  m.IdMatch,
          fifaCompId:   m.IdCompetition ?? WC_COMP_ID,
          fifaSeasonId: m.IdSeason   ?? null,
          fifaStageId:  m.IdStage    ?? null,
        }
      }
    }
  }

  return null
}

// ── Parsing lineup FIFA ────────────────────────────────────────────────────────

const POSITION_MAP = { 0: 'GK', 1: 'DEF', 2: 'MID', 3: 'FWD' }

function parsePosition(posId, statusDesc) {
  if (posId != null && POSITION_MAP[posId] != null) return POSITION_MAP[posId]
  const desc = (parseName(statusDesc) ?? '').toLowerCase()
  if (desc.includes('goal'))                                                         return 'GK'
  if (desc.includes('defend'))                                                       return 'DEF'
  if (desc.includes('midfield'))                                                     return 'MID'
  if (desc.includes('forward') || desc.includes('attack') || desc.includes('striker')) return 'FWD'
  return ''
}

function mapPlayer(p, i) {
  return {
    name:         parseName(p.PlayerName)      ?? parseName(p.ShortPlayerName) ?? '?',
    shortName:    parseName(p.ShortPlayerName) ?? parseName(p.PlayerName)      ?? '?',
    number:       p.ShirtNumber ?? p.JerseyNumber ?? '',
    position:     parsePosition(p.PositionId, p.StatusDescription),
    positionName: parseName(p.StatusDescription) ?? '',
    order:        i,
  }
}

function parseFifaTeam(teamData, fallbackName = '?') {
  if (!teamData) return null
  const starters = (teamData.StartingEleven ?? []).map(mapPlayer)
  const subs     = (teamData.Substitutes    ?? []).map(mapPlayer)
  return {
    name:      parseName(teamData.TeamName) ?? teamData.Abbreviation ?? fallbackName,
    shortName: teamData.Abbreviation        ?? parseName(teamData.TeamName) ?? fallbackName,
    color:     '#1e40af',
    altColor:  '#ffffff',
    formation: teamData.Formation ?? teamData.Tactics ?? '',
    starters,
    subs,
  }
}

// ── Fetch lineup FIFA ──────────────────────────────────────────────────────────

async function fetchFifaLineup(ids) {
  const { fifaMatchId, fifaCompId, fifaSeasonId, fifaStageId } = ids
  if (!fifaMatchId) return null

  const urlsToTry = []
  if (fifaCompId && fifaSeasonId && fifaStageId)
    urlsToTry.push(`${FIFA_BASE}/matchlineup/${fifaCompId}/${fifaSeasonId}/${fifaStageId}/${fifaMatchId}`)
  urlsToTry.push(`${FIFA_BASE}/matchlineup/${fifaMatchId}`)

  for (const url of urlsToTry) {
    const { ok, data } = await fifaFetch(url)
    if (!ok || !data) continue
    const home = parseFifaTeam(data.HomeTeam)
    const away = parseFifaTeam(data.AwayTeam)
    if (home?.starters?.length) return { home, away }
  }

  return null
}

// ── Stats FIFA ─────────────────────────────────────────────────────────────────

const STAT_PICK_KEYS = {
  possession:    ['BallPossession', 'Possession'],
  shots:         ['Attempts', 'TotalAttempts', 'Shots'],
  shotsOnTarget: ['OnTarget', 'ShotsOnTarget', 'ShotsOnGoal'],
  corners:       ['Corners', 'CornerKicks'],
  fouls:         ['Fouls', 'FoulsCommitted'],
  offside:       ['Offsides', 'Offside'],
  yellowCards:   ['YellowCards'],
  redCards:      ['RedCards'],
}

function parseFifaStats(statsData) {
  if (!statsData) return null
  let h = statsData.HomeTeam ?? statsData.Team1 ?? null
  let a = statsData.AwayTeam ?? statsData.Team2 ?? null

  if (!h && Array.isArray(statsData.MatchStatistics)) {
    const typeMap = { 30: 'BallPossession', 1: 'Attempts', 6: 'OnTarget', 7: 'Corners', 10: 'Fouls', 15: 'Offsides', 11: 'YellowCards', 12: 'RedCards' }
    const flatten = (entry) => {
      const obj = {}
      for (const stat of (entry?.Statistics ?? [])) {
        const key = typeMap[stat.Type]
        if (key) obj[key] = stat.Value
      }
      return obj
    }
    h = flatten(statsData.MatchStatistics.find(e => e.Team?.TeamType === 1 || e.TeamType === 1))
    a = flatten(statsData.MatchStatistics.find(e => e.Team?.TeamType === 2 || e.TeamType === 2))
  }

  if (!h && !a) return null
  const build = (team) => {
    if (!team) return null
    const out = {}
    for (const [key, candidates] of Object.entries(STAT_PICK_KEYS)) {
      out[key] = candidates.reduce((v, k) => v ?? team[k] ?? null, null)
    }
    return out
  }
  return { home: build(h), away: build(a) }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const { fdMatchId, home: fdHome = '', away: fdAway = '', utcDate = '' } = req.query
  if (!fdMatchId) return res.status(400).json({ error: 'fdMatchId requis' })

  // ── 1. Lineup déjà en cache Redis (7j) ─────────────────────────────────────
  const lineupKey = `fifa:lineup:${fdMatchId}`
  let lineupResult = null
  try { lineupResult = safeJson(await kv.get(lineupKey)) } catch {}

  if (lineupResult?.home?.starters?.length) {
    return res.json({ ...lineupResult, stats: null })
  }

  // ── 2. IDs FIFA en cache Redis (7j) ────────────────────────────────────────
  const idsKey = `fifa:ids:${fdMatchId}`
  let ids = null
  try { ids = safeJson(await kv.get(idsKey)) } catch {}

  // ── 3. Autodiscovery via FIFA API ──────────────────────────────────────────
  if (!ids?.fifaMatchId && utcDate) {
    ids = await discoverFifaMatch(utcDate, fdHome, fdAway)
    if (ids?.fifaMatchId) {
      try { await kv.set(idsKey, JSON.stringify(ids), { ex: 7 * 24 * 3600 }) } catch {}
    }
  }

  // ── 4. Fallback : ancienne clé fm:match: (stockée par cron legacy) ─────────
  if (!ids?.fifaMatchId) {
    try {
      const stored = safeJson(await kv.get(`fm:match:${fdMatchId}`))
      if (stored) {
        ids = {
          fifaMatchId:  stored.espnEventId ?? stored.fifaMatchId ?? null,
          fifaCompId:   stored.fifaCompId  ?? WC_COMP_ID,
          fifaSeasonId: stored.fifaSeasonId ?? null,
          fifaStageId:  stored.fifaStageId  ?? null,
        }
      }
    } catch {}
  }

  if (!ids?.fifaMatchId) {
    return res.status(404).json({ error: 'Match FIFA introuvable (API FIFA indisponible ou hors WC 2026)' })
  }

  // ── 5. Fetch lineup FIFA ───────────────────────────────────────────────────
  lineupResult = await fetchFifaLineup(ids)

  if (!lineupResult?.home?.starters?.length) {
    return res.status(404).json({ error: 'Compositions FIFA introuvables (pas encore publiées)' })
  }

  // Cache 7 jours — lineup d'un match terminé est définitive
  try { await kv.set(lineupKey, JSON.stringify(lineupResult), { ex: 7 * 24 * 3600 }) } catch {}

  // ── 6. Stats (best-effort, TTL 2min) ─────────────────────────────────────
  let stats = null
  try {
    const urlsToTry = []
    if (ids.fifaCompId && ids.fifaSeasonId && ids.fifaStageId)
      urlsToTry.push(`${FIFA_BASE}/matchstatistics/${ids.fifaCompId}/${ids.fifaSeasonId}/${ids.fifaStageId}/${ids.fifaMatchId}`)
    urlsToTry.push(`${FIFA_BASE}/matchstatistics/${ids.fifaMatchId}`)
    for (const url of urlsToTry) {
      const { ok, data } = await fifaFetch(url)
      if (ok && data) { stats = parseFifaStats(data); break }
    }
    if (stats) await kv.set(`fifa:stats:${fdMatchId}`, JSON.stringify(stats), { ex: 120 })
  } catch {}

  return res.json({ ...lineupResult, stats })
}
