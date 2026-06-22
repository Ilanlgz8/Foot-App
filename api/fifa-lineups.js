// api/fifa-lineups.js
// Compositions + statistiques live FIFA pour WC 2026.
// Utilisé par useLineups() pour les matchs avec espnSlug='fifa' (compétition 2000).
//
// GET /api/fifa-lineups?fdMatchId={fdMatchId}
//   → lit les IDs FIFA depuis Redis (fm:match:{fdMatchId}) puis fetch FIFA API
//
// Réponse : { home, away, stats }
//   home/away : même format que parseEspnRoster() dans useMatchDetail.js
//   stats     : { home, away } avec possession/shots/shotsOnTarget/corners/fouls/…

import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const FIFA_BASE  = 'https://api.fifa.com/api/v3'
const LINEUP_TTL = 20 * 60   // 20min cache Redis (compos — ne changent pas en match)
const STATS_TTL  = 60        // 60s cache Redis (stats live — mises à jour chaque minute)

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeJson(val) {
  if (!val) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return null } }
  return val
}

async function fifaFetch(url) {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal:  AbortSignal.timeout(8_000),
    })
    if (!res.ok) return { ok: false, data: null, status: res.status }
    const data = await res.json()
    return { ok: true, data }
  } catch (e) {
    return { ok: false, data: null, status: 0, err: e.message }
  }
}

// Extraire le nom localisé en anglais (ou premier dispo)
function parseName(arr) {
  if (!arr) return null
  if (!Array.isArray(arr)) return typeof arr === 'string' ? arr : null
  return (
    arr.find(n => /^en/i.test(n.Locale ?? n.locale ?? ''))?.Description
    ?? arr.find(n => /^en/i.test(n.Locale ?? n.locale ?? ''))?.description
    ?? arr[0]?.Description
    ?? arr[0]?.description
    ?? null
  )
}

// PositionId FIFA → abréviation (basé sur WC 2022 + WC 2026 confirmé)
// 0=GK  1=DEF  2=MID  3=FWD
const POSITION_MAP = { 0: 'GK', 1: 'DEF', 2: 'MID', 3: 'FWD' }

function parsePosition(posId, statusDesc) {
  if (posId != null && POSITION_MAP[posId] != null) return POSITION_MAP[posId]
  const desc = (parseName(statusDesc) ?? '').toLowerCase()
  if (desc.includes('goal'))            return 'GK'
  if (desc.includes('defend'))          return 'DEF'
  if (desc.includes('midfield'))        return 'MID'
  if (desc.includes('forward') || desc.includes('attack') || desc.includes('striker')) return 'FWD'
  return ''
}

// Mapper un joueur FIFA vers le format attendu par LineupPitch.jsx
function mapPlayer(p, i) {
  return {
    name:         parseName(p.PlayerName)     ?? parseName(p.ShortPlayerName) ?? '?',
    shortName:    parseName(p.ShortPlayerName) ?? parseName(p.PlayerName)     ?? '?',
    number:       p.ShirtNumber ?? p.JerseyNumber ?? '',
    position:     parsePosition(p.PositionId, p.StatusDescription),
    positionName: parseName(p.StatusDescription) ?? '',
    order:        i,
  }
}

// Mapper une équipe FIFA vers le format de parseEspnRoster()
function parseFifaTeam(teamData, fallbackName = '?') {
  if (!teamData) return null

  const starters = (teamData.StartingEleven ?? []).map(mapPlayer)
  const subs     = (teamData.Substitutes    ?? []).map(mapPlayer)

  return {
    name:      parseName(teamData.TeamName) ?? teamData.Abbreviation ?? fallbackName,
    shortName: teamData.Abbreviation        ?? parseName(teamData.TeamName) ?? fallbackName,
    color:     '#1e40af',    // FIFA lineup API ne retourne pas les couleurs
    altColor:  '#ffffff',
    formation: teamData.Formation ?? teamData.Tactics ?? '',
    starters,
    subs,
  }
}

// ── Stats FIFA ─────────────────────────────────────────────────────────────────

// Clés connues dans la réponse FIFA matchstatistics (WC 2022 + WC 2026)
const STAT_PICK_KEYS = {
  possession:    ['BallPossession', 'Possession'],
  shots:         ['Attempts', 'TotalAttempts', 'Shots', 'TotalShots'],
  shotsOnTarget: ['OnTarget', 'ShotsOnTarget', 'ShotsOnGoal', 'AttemptsOnTarget'],
  corners:       ['Corners', 'CornerKicks'],
  fouls:         ['Fouls', 'FoulsCommitted'],
  offside:       ['Offsides', 'Offside'],
  yellowCards:   ['YellowCards'],
  redCards:      ['RedCards'],
  saves:         ['Saves', 'Goalkeeper Saves'],
  passes:        ['Passes', 'TotalPasses'],
}

function pickStat(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null) return obj[k]
  }
  return null
}

function parseFifaStats(statsData) {
  if (!statsData) return null

  // Format A : HomeTeam / AwayTeam objects directs
  let h = statsData.HomeTeam ?? statsData.Team1 ?? null
  let a = statsData.AwayTeam ?? statsData.Team2 ?? null

  // Format B : tableau Statistics[] avec TeamType (1=home, 2=away)
  if (!h && Array.isArray(statsData.MatchStatistics)) {
    const homeEntry = statsData.MatchStatistics.find(e => e.Team?.TeamType === 1 || e.TeamType === 1)
    const awayEntry = statsData.MatchStatistics.find(e => e.Team?.TeamType === 2 || e.TeamType === 2)

    // Convertir tableau Statistics[{Type,Value}] vers objet flat par Type
    // Types connus WC 2022 : 30=possession 1=shots 6=shotsOnTarget 7=corners 10=fouls
    const typeMap = {
      30: 'BallPossession', 1: 'Attempts', 6: 'OnTarget',
       7: 'Corners', 10: 'Fouls', 15: 'Offsides',
      11: 'YellowCards', 12: 'RedCards', 41: 'Passes',
    }
    const flatten = (entry) => {
      if (!entry) return null
      const obj = {}
      for (const stat of (entry.Statistics ?? [])) {
        const key = typeMap[stat.Type]
        if (key) obj[key] = stat.Value
      }
      return obj
    }

    h = flatten(homeEntry)
    a = flatten(awayEntry)
  }

  if (!h && !a) return null

  const build = (team) => {
    if (!team) return null
    const out = {}
    for (const [key, candidates] of Object.entries(STAT_PICK_KEYS)) {
      out[key] = pickStat(team, candidates)
    }
    return out
  }

  return { home: build(h), away: build(a) }
}

// ── Construire les URL FIFA ────────────────────────────────────────────────────

function buildFifaUrls(matchId, compId, seasonId, stageId) {
  const urls = { lineup: [], stats: [] }

  if (compId && seasonId && stageId) {
    urls.lineup.push(`${FIFA_BASE}/matchlineup/${compId}/${seasonId}/${stageId}/${matchId}`)
    urls.stats.push(`${FIFA_BASE}/matchstatistics/${compId}/${seasonId}/${stageId}/${matchId}`)
  }

  // Fallback URL simplifiée (peut fonctionner sur certains endpoints)
  urls.lineup.push(`${FIFA_BASE}/matchlineup/${matchId}`)
  urls.stats.push(`${FIFA_BASE}/matchstatistics/${matchId}`)

  return urls
}

// Essayer les URLs dans l'ordre jusqu'au premier succès
async function fetchFirst(urlList) {
  for (const url of urlList) {
    const { ok, data } = await fifaFetch(url)
    if (ok && data) return data
  }
  return null
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const { fdMatchId } = req.query
  const fdHome = req.query.home ?? ''
  const fdAway = req.query.away ?? ''

  if (!fdMatchId) return res.status(400).json({ error: 'fdMatchId requis' })

  // ── 1. Récupérer les IDs FIFA depuis Redis ─────────────────────────────────
  let fifaMatchId = null, fifaCompId = null, fifaSeasonId = null, fifaStageId = null

  try {
    const stored = safeJson(await kv.get(`fm:match:${fdMatchId}`))
    if (stored) {
      fifaMatchId  = stored.espnEventId   ?? stored.fifaMatchId  ?? null
      fifaCompId   = stored.fifaCompId    ?? null
      fifaSeasonId = stored.fifaSeasonId  ?? null
      fifaStageId  = stored.fifaStageId   ?? null
    }
  } catch {}

  if (!fifaMatchId) {
    return res.status(404).json({ error: 'Match FIFA introuvable (pas encore en cache — ouvrir pendant le match)' })
  }

  // ── 2. Cache séparé lineup (20min) et stats (60s) ─────────────────────────
  // Les compos ne changent pas → cache long.
  // Les stats changent chaque minute → cache court pour ne pas bloquer les updates live.
  const lineupCacheKey = `fifa:lineup:${fifaMatchId}`
  const statsCacheKey  = `fifa:stats:${fifaMatchId}`

  let cachedLineup = null, cachedStats = undefined
  try {
    [cachedLineup, cachedStats] = await Promise.all([
      kv.get(lineupCacheKey).then(safeJson),
      kv.get(statsCacheKey).then(v => v !== null ? safeJson(v) : undefined),
    ])
  } catch {}

  // Si les deux sont en cache → retourner immédiatement
  if (cachedLineup && cachedStats !== undefined) {
    return res.json({ ...cachedLineup, stats: cachedStats })
  }

  // ── 3. Fetch ce qui manque ────────────────────────────────────────────────
  const { lineup: lineupUrls, stats: statsUrls } = buildFifaUrls(
    fifaMatchId, fifaCompId, fifaSeasonId, fifaStageId
  )

  let lineupData = null, statsData = null

  if (!cachedLineup) {
    // Lineup manquant → fetch les deux en parallèle
    ;[lineupData, statsData] = await Promise.all([
      fetchFirst(lineupUrls),
      fetchFirst(statsUrls),
    ])
  } else {
    // Lineup en cache, seulement les stats manquent → fetch stats seulement
    statsData = await fetchFirst(statsUrls)
  }

  // ── 4. Parser la lineup si nécessaire ────────────────────────────────────
  let lineupResult = cachedLineup
  if (!lineupResult) {
    if (!lineupData) {
      return res.status(404).json({ error: 'Compositions FIFA introuvables' })
    }
    const home = parseFifaTeam(lineupData.HomeTeam, fdHome)
    const away = parseFifaTeam(lineupData.AwayTeam, fdAway)

    if (!home?.starters?.length) {
      return res.status(404).json({ error: 'Lineup FIFA vide (pas encore publiée)' })
    }

    lineupResult = { home, away }
    // Cacher la lineup 20min (ne change pas pendant le match)
    try { await kv.set(lineupCacheKey, JSON.stringify(lineupResult), { ex: LINEUP_TTL }) } catch {}
  }

  // ── 5. Parser les stats ───────────────────────────────────────────────────
  const parsedStats = statsData ? parseFifaStats(statsData) : null
  // Cacher les stats 60s (se mettent à jour chaque minute pendant le match)
  try { await kv.set(statsCacheKey, JSON.stringify(parsedStats), { ex: STATS_TTL }) } catch {}

  return res.json({ ...lineupResult, stats: parsedStats })
}
