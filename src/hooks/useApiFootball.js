/**
 * useApiFootball — hooks api-football (v3.football.api-sports.io)
 *
 * Proxy : /apifootball?_ep=<endpoint>&<params>
 * Utilisé pour : compos (useAflLineups) + stats live (useAflLiveStats)
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

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
  const home  = match.homeTeam?.name ?? match.homeTeam?.shortName ?? ''
  const away  = match.awayTeam?.name ?? match.awayTeam?.shortName ?? ''

  let best = null, bestScore = 0

  // Passe 1 : date exacte + league (1 requête, cache Redis 6h → quasi gratuit)
  if (leagueInfo) {
    try {
      const data = await afetch('fixtures', { date, league: leagueInfo.league, season: leagueInfo.season })
      for (const f of data.response ?? []) {
        const score = (teamSimilarity(home, f.teams?.home?.name ?? '') + teamSimilarity(away, f.teams?.away?.name ?? '')) / 2
        if (score > bestScore) { bestScore = score; best = f }
      }
    } catch {}
  }

  // Passe 2 : ±1 jour si le match est à cheval sur minuit UTC (rare)
  if (bestScore < 0.8 && leagueInfo) {
    const d    = new Date(date)
    const prev = new Date(d); prev.setUTCDate(d.getUTCDate() - 1)
    const next = new Date(d); next.setUTCDate(d.getUTCDate() + 1)
    for (const tryDate of [prev.toISOString().slice(0, 10), next.toISOString().slice(0, 10)]) {
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

  // Passe 3 : fallback sans filtre league si toujours rien
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
const AFL_POS_MAP = { G: 'GK', D: 'DEF', M: 'MID', F: 'FWD' }

function transformLineups(data, homeTeamId) {
  const teams = data.response ?? []
  if (teams.length < 2) return null // il faut les 2 équipes, jamais une compo à moitié

  const homeData = teams.find(t => t.team?.id === homeTeamId)
  const awayData = teams.find(t => t !== homeData)

  // Si homeTeamId ne correspond à AUCUNE des 2 équipes renvoyées par l'API
  // (mismatch d'id entre resolveFixtureInfo et /fixtures/lineups), l'ancien
  // fallback (`?? teams[0]` des 2 côtés) affichait la MÊME équipe en home
  // et en away (bug rapporté : "Suisse"/"Maroc" affiché deux fois). Mieux
  // vaut ne rien afficher que d'afficher une compo fausse.
  if (!homeData || !awayData) return null

  // `grid` (ex: "2:3" = ligne 2, colonne 3) : coordonnée exacte du joueur sur
  // le schéma tactique DE CE MATCH précis, fournie par api-football depuis
  // 2021. Contrairement au champ "pos" (G/D/M/F, catégorie générale du
  // joueur, parfois périmée), le grid ne peut pas être faux : il décrit
  // directement où le joueur a été placé pour cette compo — utilisé en
  // priorité par LineupPitch.jsx pour le placement quand disponible.
  const mapPlayer = (entry, i) => ({
    name:      entry.player?.name ?? '?',
    shortName: (entry.player?.name ?? '?').split(' ').pop(),
    number:    entry.player?.number ?? '',
    position:  AFL_POS_MAP[entry.player?.pos] ?? entry.player?.pos ?? '',
    grid:      entry.player?.grid ?? null,
    order:     i,
  })

  const build = (teamData) => ({
    name:      teamData.team?.name ?? '',
    shortName: teamData.team?.name ?? '',
    color:     '#1e293b',
    altColor:  '#ffffff',
    formation: teamData.formation ?? '',
    starters:  (teamData.startXI     ?? []).map((p, i) => mapPlayer(p, i)),
    subs:      (teamData.substitutes ?? []).map((p, i) => mapPlayer(p, i)),
  })

  const home = build(homeData)
  const away = build(awayData)
  if (!home.starters.length) return null
  return { home, away }
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
  const { data: info, isLoading: infoLoading } = useFixtureInfo(match)
  const query = useQuery({
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
  return { ...query, isLoading: infoLoading || query.isLoading }
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

/**
 * Compositions probables via api-football — fallback WC quand ESPN n'a pas les rosters.
 * Trouve le dernier XI connu de chaque équipe via leur dernier match dans compMatches.
 * Zéro quota supplémentaire grâce au cache Redis 7j sur les lineups.
 */
export function useAflProbableLineups(match, compMatches) {
  const homeId = match?.homeTeam?.id
  const awayId = match?.awayTeam?.id

  // Dernier match terminé de chaque équipe (calcul synchrone via useMemo)
  const [lastHomeMatch, lastAwayMatch] = useMemo(() => {
    if (!compMatches?.length || !homeId || !awayId) return [null, null]
    const sorted = [...compMatches]
      .filter(m => m.status === 'FINISHED')
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    return [
      sorted.find(m => m.homeTeam?.id === homeId || m.awayTeam?.id === homeId) ?? null,
      sorted.find(m => m.homeTeam?.id === awayId || m.awayTeam?.id === awayId) ?? null,
    ]
  }, [compMatches, homeId, awayId])

  // Récupère les compos des deux matchs précédents via api-football
  const { data: homeMatchLineups, isLoading: homeLoading } = useAflLineups(lastHomeMatch)
  const { data: awayMatchLineups, isLoading: awayLoading } = useAflLineups(lastAwayMatch)

  const isLoading = homeLoading || awayLoading

  const home = useMemo(() => {
    if (!homeMatchLineups || !lastHomeMatch) return null
    const wasHome = lastHomeMatch.homeTeam?.id === homeId
    const roster  = wasHome ? homeMatchLineups.home : homeMatchLineups.away
    if (!roster?.starters?.length) return null
    const opponent = wasHome
      ? (lastHomeMatch.awayTeam?.shortName ?? lastHomeMatch.awayTeam?.name ?? '?')
      : (lastHomeMatch.homeTeam?.shortName ?? lastHomeMatch.homeTeam?.name ?? '?')
    return { ...roster, fromMatch: { date: lastHomeMatch.utcDate, opponent } }
  }, [homeMatchLineups, lastHomeMatch, homeId])

  const away = useMemo(() => {
    if (!awayMatchLineups || !lastAwayMatch) return null
    const wasHome = lastAwayMatch.homeTeam?.id === awayId
    const roster  = wasHome ? awayMatchLineups.home : awayMatchLineups.away
    if (!roster?.starters?.length) return null
    const opponent = wasHome
      ? (lastAwayMatch.awayTeam?.shortName ?? lastAwayMatch.awayTeam?.name ?? '?')
      : (lastAwayMatch.homeTeam?.shortName ?? lastAwayMatch.homeTeam?.name ?? '?')
    return { ...roster, fromMatch: { date: lastAwayMatch.utcDate, opponent } }
  }, [awayMatchLineups, lastAwayMatch, awayId])

  const data = (home || away) ? { home, away } : null
  return { data, isLoading }
}

// Stats d'un match terminé — même source mais sans polling
export function useAflMatchStats(match) {
  const { data: info, isLoading: infoLoading } = useFixtureInfo(match)
  const query = useQuery({
    queryKey: ['aflMatchStats', info?.fixtureId],
    queryFn:  async () => {
      const data = await afetch('fixtures/statistics', { fixture: info.fixtureId })
      return transformStats(data, info.homeTeamId)
    },
    enabled:   !!info?.fixtureId,
    staleTime: 30 * 60_000,
    retry: 1,
  })
  return { ...query, isLoading: infoLoading || query.isLoading }
}

// ── Classement des meilleurs passeurs décisifs ──────────────────────────────
// ⚠️ football-data.org (useScorers.js) n'a PAS d'endpoint "top assists" — son
// /scorers est un classement de BUTEURS, qui n'inclut donc que des joueurs
// ayant marqué au moins 1 but. Un joueur avec 0 but mais des passes décisives
// (ex: Michael Olise) n'apparaît jamais dans cette liste, quel que soit le tri
// appliqué dessus — c'était le bug de la 1ère version (Classement.jsx
// re-triait juste useScorers). api-football expose un vrai endpoint dédié,
// indépendant des buts marqués : /players/topassists?league=&season=
// (confirmé existant et documenté, cf. api-football.com/documentation-v3).
//
// Champs de la réponse api-football (forme `results[].{player,statistics[0]}`,
// mêmes conventions que /players/topscorers) — mappés ici vers le format déjà
// utilisé par Classement.jsx pour éviter de dupliquer le rendu :
//   { player: { name }, team: { name, shortName, crest }, goals, assists }
// ⚠️ Les noms d'équipe api-football suivent une convention différente de
// football-data.org (celle utilisée par translateTeam()) — la traduction FR
// peut donc ne pas s'appliquer sur cette liste précise (dictionnaire
// TEAM_NAMES_FR pas garanti de matcher les noms api-football exactement).
function transformTopAssists(data) {
  const rows = data?.response ?? []
  return rows
    .map(r => {
      const stat = r.statistics?.[0] ?? {}
      const p    = r.player ?? {}
      const name = p.name ?? ([p.firstname, p.lastname].filter(Boolean).join(' ') || '?')
      return {
        player: { id: p.id, name },
        team: {
          id:        stat.team?.id,
          name:      stat.team?.name ?? '',
          shortName: stat.team?.name ?? '',
          crest:     stat.team?.logo ?? null,
        },
        goals:   stat.goals?.total    ?? 0,
        assists: stat.goals?.assists  ?? 0,
      }
    })
    .filter(r => (r.assists ?? 0) > 0)
    // Tri explicite par passes décisives — l'API renvoie déjà normalement dans
    // cet ordre, mais on ne se repose pas dessus (le filtre ci-dessus pourrait
    // en théorie désordonner si l'API changeait son tri interne un jour).
    .sort((a, b) => (b.assists ?? 0) - (a.assists ?? 0) || (b.goals ?? 0) - (a.goals ?? 0))
}

// staleTime volontairement long (10min) : l'endpoint topassists lui-même
// n'est mis à jour que "plusieurs fois par semaine" côté api-football (doc
// officielle) — pas la peine de le repoller plus souvent, la donnée réelle
// ne bouge de toute façon pas plus vite que ça.
export function useAflTopAssists(compId) {
  const leagueInfo = FD_TO_AFL[compId]
  return useQuery({
    queryKey: ['aflTopAssists', compId],
    queryFn: async () => {
      const data = await afetch('players/topassists', { league: leagueInfo.league, season: leagueInfo.season })
      return transformTopAssists(data)
    },
    enabled:   !!leagueInfo,
    staleTime: 10 * 60_000,
    retry: 1,
  })
}
