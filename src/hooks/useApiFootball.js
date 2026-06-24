/**
 * useApiFootball — hooks api-football (v3.football.api-sports.io)
 *
 * Proxy : /apifootball?_ep=<endpoint>&<params>
 * Utilisé pour : compos (useAflLineups) + stats live (useAflLiveStats)
 */

import { useQuery } from '@tanstack/react-query'

// ── Mapping FD.org competition code → api-football league + season ─────────────
const FD_TO_AFL = {
  // Clubs — Europe
  'FL1':  { league: 61,  season: 2025 }, // Ligue 1
  'PL':   { league: 39,  season: 2025 }, // Premier League
  'PD':   { league: 140, season: 2025 }, // La Liga
  'BL1':  { league: 78,  season: 2025 }, // Bundesliga
  'SA':   { league: 135, season: 2025 }, // Serie A
  'DED':  { league: 88,  season: 2025 }, // Eredivisie
  'PPL':  { league: 94,  season: 2025 }, // Primeira Liga
  'PL2':  { league: 40,  season: 2025 }, // Championship
  'FL2':  { league: 62,  season: 2025 }, // Ligue 2
  'BL2':  { league: 79,  season: 2025 }, // 2. Bundesliga
  // Coupes
  'CL':   { league: 2,   season: 2025 }, // Champions League
  'EL':   { league: 3,   season: 2025 }, // Europa League
  'UECL': { league: 848, season: 2025 }, // Conference League
  // Tournois nationaux
  'WC':   { league: 1,   season: 2026 }, // World Cup 2026
  'EC':   { league: 4,   season: 2024 }, // Euro 2024
  'CA':   { league: 9,   season: 2026 }, // Copa America 2026
  'CLI':  { league: 13,  season: 2026 }, // Copa Libertadores
  'UNL':  { league: 5,   season: 2024 }, // UEFA Nations League
  'NL':   { league: 5,   season: 2024 },
}

// ── Normalisation noms d'équipes pour fuzzy matching ──────────────────────────
const TEAM_ALIASES = {
  'paris saint-germain': 'paris saint-germain',
  'psg': 'paris saint-germain',
  'olympique de marseille': 'marseille',
  'olympique lyonnais': 'olympique lyonnais',
  'stade rennais': 'rennes',
  'stade brestois 29': 'brest',
  'manchester united': 'manchester united',
  'manchester city': 'manchester city',
  'tottenham hotspur': 'tottenham',
  'wolverhampton wanderers': 'wolverhampton',
  'brighton & hove albion': 'brighton',
  'nottingham forest': 'nottingham forest',
  'newcastle united': 'newcastle',
  'west ham united': 'west ham',
  'atletico madrid': 'atletico madrid',
  'athletic bilbao': 'athletic club',
  'bayer 04 leverkusen': 'bayer leverkusen',
  'inter milan': 'inter',
  'milan ac': 'ac milan',
  'ac milan': 'ac milan',
  'ss lazio': 'lazio',
  'as roma': 'roma',
}

function normTeam(name = '') {
  const lower = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (TEAM_ALIASES[lower]) return TEAM_ALIASES[lower]
  return lower
    .replace(/\b(fc|sc|cf|rc|us|sv|fk|sk|if|bk|gd|cd|sd|ud|rcd|afc|cfc|sfc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function teamSimilarity(a, b) {
  const na = normTeam(a)
  const nb = normTeam(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.9
  const wa = na.split(' ').filter(w => w.length > 2)
  const wb = new Set(nb.split(' ').filter(w => w.length > 2))
  if (wa.length === 0 || wb.size === 0) return 0
  const common = wa.filter(w => wb.has(w)).length
  return common / Math.max(wa.length, wb.size)
}

// ── Fetch via proxy /apifootball ───────────────────────────────────────────────
async function afetch(endpoint, params = {}) {
  const p = new URLSearchParams(params)
  if (endpoint !== 'fixtures') p.set('_ep', endpoint)
  const res = await fetch(`/apifootball?${p.toString()}`)
  if (!res.ok) throw new Error(`api-football ${res.status}: ${endpoint}`)
  return res.json()
}

// ── Résolution fixture ID à partir d'un match FD.org ─────────────────────────
async function resolveFixtureInfo(match) {
  if (!match?.utcDate || !match.homeTeam || !match.awayTeam) return null

  const leagueInfo = FD_TO_AFL[match.competition?.code]
  const date  = match.utcDate.slice(0, 10)
  const d     = new Date(date)
  const prev  = new Date(d); prev.setUTCDate(d.getUTCDate() - 1)
  const next  = new Date(d); next.setUTCDate(d.getUTCDate() + 1)
  const dates = [date, prev.toISOString().slice(0, 10), next.toISOString().slice(0, 10)]
  const home  = match.homeTeam?.name ?? match.homeTeam?.shortName ?? ''
  const away  = match.awayTeam?.name ?? match.awayTeam?.shortName ?? ''

  let best = null, bestScore = 0

  // Passe 1 : filtré par league + season (économise le quota)
  if (leagueInfo) {
    for (const tryDate of dates) {
      try {
        const data = await afetch('fixtures', { date: tryDate, league: leagueInfo.league, season: leagueInfo.season })
        for (const f of data.response ?? []) {
          const score = (teamSimilarity(home, f.teams?.home?.name ?? '') + teamSimilarity(away, f.teams?.away?.name ?? '')) / 2
          if (score > bestScore) { bestScore = score; best = f }
        }
        if (bestScore >= 0.8) break
      } catch {}
    }
  }

  // Passe 2 : fallback sans filtre league si rien trouvé
  if (bestScore < 0.4) {
    try {
      const data = await afetch('fixtures', { date })
      for (const f of data.response ?? []) {
        const score = (teamSimilarity(home, f.teams?.home?.name ?? '') + teamSimilarity(away, f.teams?.away?.name ?? '')) / 2
        if (score > bestScore) { bestScore = score; best = f }
      }
    } catch {}
  }

  if (!best || bestScore < 0.4) return null

  return {
    fixtureId:  best.fixture?.id,
    homeTeamId: best.teams?.home?.id,
    awayTeamId: best.teams?.away?.id,
  }
}

// ── Hook interne : résolution fixture info ────────────────────────────────────
function useFixtureInfo(match) {
  return useQuery({
    queryKey:   ['aflFixtureInfo', match?.id],
    queryFn:    () => resolveFixtureInfo(match),
    enabled:    !!match?.id && !!match?.utcDate && !!match?.competition?.code,
    staleTime:  60 * 60_000,
    gcTime:     4  * 60 * 60_000,
    retry:      1,
    retryDelay: 3_000,
  })
}

// ── Transformations ───────────────────────────────────────────────────────────
function transformLineups(data, homeTeamId) {
  const teams = data.response ?? []
  if (teams.length < 2) return null

  const homeData = teams.find(t => t.team?.id === homeTeamId) ?? teams[0]
  const awayData = teams.find(t => t.team?.id !== homeTeamId) ?? teams[1]

  const mapPlayer = (entry, isSub) => ({
    player: {
      name:      entry.player?.name ?? '?',
      shortName: (entry.player?.name ?? '?').split(' ').pop(),
      position:  entry.player?.pos ?? '',
    },
    shirtNumber: entry.player?.number ?? '',
    substitute:  isSub,
    position:    entry.player?.pos ?? '',
  })

  return {
    home: {
      formation: homeData.formation ?? '',
      players: [
        ...(homeData.startXI    ?? []).map(p => mapPlayer(p, false)),
        ...(homeData.substitutes ?? []).map(p => mapPlayer(p, true)),
      ],
    },
    away: {
      formation: awayData.formation ?? '',
      players: [
        ...(awayData.startXI    ?? []).map(p => mapPlayer(p, false)),
        ...(awayData.substitutes ?? []).map(p => mapPlayer(p, true)),
      ],
    },
  }
}

function transformStats(data, homeTeamId) {
  const teams = data.response ?? []
  if (teams.length === 0) return null

  const homeData = teams.find(t => t.team?.id === homeTeamId) ?? teams[0]
  const awayData = teams.find(t => t.team?.id !== homeTeamId) ?? teams[1]

  const TYPE_MAP = {
    'Ball Possession': 'Ball possession',
    'Total Shots':     'Total shots',
    'Shots on Goal':   'Shots on target',
    'Corner Kicks':    'Corner kicks',
    'Fouls':           'Fouls',
  }

  const homeStats = homeData?.statistics ?? []
  const awayStats = awayData?.statistics ?? []

  const items = homeStats
    .filter(s => TYPE_MAP[s.type])
    .map(hs => {
      const as_ = awayStats.find(a => a.type === hs.type)
      return {
        name: TYPE_MAP[hs.type],
        home: String(hs.value ?? '0'),
        away: String(as_?.value ?? '0'),
      }
    })

  return {
    statistics: [{
      period: 'ALL',
      groups: [{ statisticsItems: items }],
    }],
  }
}

// ── Hooks publics ─────────────────────────────────────────────────────────────

/** Compos des deux équipes. Disponible ~1h avant le KO. */
export function useAflLineups(match) {
  const { data: info } = useFixtureInfo(match)
  return useQuery({
    queryKey:  ['aflLineups', info?.fixtureId],
    queryFn:   async () => {
      const data = await afetch('fixtures/lineups', { fixture: info.fixtureId })
      return transformLineups(data, info.homeTeamId)
    },
    enabled:   !!info?.fixtureId,
    staleTime: 20 * 60_000,
    gcTime:    2  * 60 * 60_000,
    retry: 1,
  })
}

/**
 * Stats live : possession, tirs, corners, fautes.
 * Polling toutes les 90s (quota free 100 req/jour).
 * Utilisé seulement si ESPN n'a pas les stats.
 */
export function useAflLiveStats(match, isLive = true) {
  const { data: info } = useFixtureInfo(match)
  return useQuery({
    queryKey:        ['aflStats', info?.fixtureId],
    queryFn:         async () => {
      const data = await afetch('fixtures/statistics', { fixture: info.fixtureId })
      return transformStats(data, info.homeTeamId)
    },
    enabled:         !!info?.fixtureId && isLive,
    refetchInterval: isLive ? 90_000 : false,
    staleTime:       85_000,
    retry: 1,
  })
}
