/**
 * useSofaScore — propulsé par api-football (v3.football.api-sports.io)
 *
 * SofaScore était bloqué côté serveur ET navigateur (Cloudflare 403).
 * On réutilise le proxy /apifootball déjà en place, avec le paramètre _ep
 * pour accéder à n'importe quel endpoint api-football.
 *
 * API exportée identique à avant → MatchModal.jsx inchangé.
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
  'SB':   { league: 78,  season: 2025 }, // Bundesliga alias
  // Clubs — Europe (coupes)
  'CL':   { league: 2,   season: 2025 }, // Champions League 2025-26
  'EL':   { league: 3,   season: 2025 }, // Europa League 2025-26
  'UECL': { league: 848, season: 2025 }, // Conference League 2025-26
  // Nationales — Tournois
  'WC':   { league: 1,   season: 2026 }, // World Cup 2026
  'EC':   { league: 4,   season: 2024 }, // Euro 2024
  'CA':   { league: 9,   season: 2026 }, // Copa America 2026
  'CLI':  { league: 13,  season: 2026 }, // Copa Libertadores
  'CSL':  { league: 169, season: 2026 }, // Chinese Super League
  'BSA':  { league: 71,  season: 2026 }, // Série A Brésil
  // Nations League
  'UNL':  { league: 5,   season: 2024 }, // UEFA Nations League
  'NL':   { league: 5,   season: 2024 }, // alias
}

// ── Normalisation pour le fuzzy matching ───────────────────────────────────────
function normTeam(name = '') {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|sc|ac|cf|rc|as|us|sv|fk|sk|if|bk|gd|cd|sd|ud|rcd|afc|cfc|sfc|real|atletico|atletico|borussia|sporting|olympique|stade|racing|paris|saint|germain|manchester|united|city)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
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
  // _ep sélectionne l'endpoint ; absent = "fixtures" (compat ascendante)
  if (endpoint !== 'fixtures') p.set('_ep', endpoint)
  const res = await fetch(`/apifootball?${p.toString()}`)
  if (!res.ok) throw new Error(`api-football ${res.status}: ${endpoint}`)
  return res.json()
}

// ── Résolution fixture info (ID + team IDs) ────────────────────────────────────
async function resolveAflFixtureInfo(match) {
  if (!match?.utcDate || !match.homeTeam || !match.awayTeam) return null

  const leagueInfo = FD_TO_AFL[match.competition?.code]
  if (!leagueInfo) {
    // Compétition non dans le mapping → on saute la passe 1 (league filtrée)
    // et on tente directement la passe 2 (fallback sans filtre, toutes les ligues du jour)
    console.warn(`[api-football] Compétition non mappée: ${match.competition?.code} — fallback broad search`)
  }

  const date = match.utcDate.slice(0, 10)
  const d = new Date(date)
  const prev = new Date(d); prev.setUTCDate(d.getUTCDate() - 1)
  const next = new Date(d); next.setUTCDate(d.getUTCDate() + 1)
  const dates = [
    date,
    prev.toISOString().slice(0, 10),
    next.toISOString().slice(0, 10),
  ]

  const home = match.homeTeam?.name ?? match.homeTeam?.shortName ?? ''
  const away = match.awayTeam?.name ?? match.awayTeam?.shortName ?? ''

  let best = null
  let bestScore = 0

  // Passe 1 : recherche par league+season (précis, économise le quota)
  // Skippée si la compétition n'est pas dans FD_TO_AFL
  if (leagueInfo) {
    for (const tryDate of dates) {
      let data
      try {
        data = await afetch('fixtures', {
          date:   tryDate,
          league: leagueInfo.league,
          season: leagueInfo.season,
        })
      } catch (e) {
        console.warn(`[api-football] Erreur fetch fixtures ${tryDate}:`, e.message)
        continue
      }

      const fixtures = data.response ?? []
      console.log(`[api-football] ${tryDate} league=${leagueInfo.league} → ${fixtures.length} fixtures`)
      for (const f of fixtures) {
        const hn = f.teams?.home?.name ?? ''
        const an = f.teams?.away?.name ?? ''
        const score = (teamSimilarity(home, hn) + teamSimilarity(away, an)) / 2
        if (score > bestScore) { bestScore = score; best = f }
      }
      if (bestScore >= 0.8) break
    }
  }

  // Passe 2 (fallback) : si 0 résultats avec le filtre league, cherche sans filtre
  // (ex : WC 2026 non indexé sous league=1 dans le plan gratuit)
  if (bestScore < 0.4) {
    const tryDate = dates[0]  // juste la date principale
    let data
    try {
      data = await afetch('fixtures', { date: tryDate })
    } catch (e) {
      console.warn(`[api-football] Erreur fetch fallback ${tryDate}:`, e.message)
    }
    if (data) {
      const fixtures = data.response ?? []
      console.log(`[api-football] Fallback sans league ${tryDate} → ${fixtures.length} fixtures`)
      for (const f of fixtures) {
        const hn = f.teams?.home?.name ?? ''
        const an = f.teams?.away?.name ?? ''
        const score = (teamSimilarity(home, hn) + teamSimilarity(away, an)) / 2
        if (score > bestScore) { bestScore = score; best = f }
      }
    }
  }

  if (!best || bestScore < 0.4) {
    console.warn(`[api-football] Aucun fixture pour ${home} vs ${away} (score=${bestScore.toFixed(2)})`)
    return null
  }

  console.log(`[api-football] Fixture trouvé: ${best.teams?.home?.name} vs ${best.teams?.away?.name} (id=${best.fixture?.id}, score=${bestScore.toFixed(2)})`)
  return {
    fixtureId:  best.fixture?.id,
    homeTeamId: best.teams?.home?.id,
    awayTeamId: best.teams?.away?.id,
  }
}

// ── Transformations api-football → format SofaScore attendu par MatchModal ────

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

  // Mapping api-football type → nom SofaScore attendu par LiveStatsTab
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

function transformH2H(data) {
  const events = (data.response ?? []).slice(0, 10).map(m => ({
    startTimestamp: Math.floor(new Date(m.fixture?.date ?? 0).getTime() / 1000),
    homeTeam: {
      name:      m.teams?.home?.name ?? '',
      shortName: (m.teams?.home?.name ?? '').split(' ').pop(),
    },
    awayTeam: {
      name:      m.teams?.away?.name ?? '',
      shortName: (m.teams?.away?.name ?? '').split(' ').pop(),
    },
    homeScore: { current: m.goals?.home },
    awayScore: { current: m.goals?.away },
  }))
  return { events }
}

function transformPredictions(data) {
  const resp = data.response?.[0]
  if (!resp) return null

  const percent = resp.predictions?.percent
  const formHome = resp.teams?.home?.last_5?.form ?? ''
  const formAway = resp.teams?.away?.last_5?.form ?? ''

  const parseP    = s => parseInt(String(s ?? '0').replace('%', '')) || 0
  const parseForm = str =>
    str.split('').filter(c => 'WDL'.includes(c)).map(r => ({ result: r }))

  return {
    // Probabilités (pour useSofaOdds)
    markets: [{
      marketName: '1x2',
      choices: percent ? [
        { name: '1', probability: parseP(percent.home) },
        { name: 'X', probability: parseP(percent.draw) },
        { name: '2', probability: parseP(percent.away) },
      ] : [],
    }],
    // Forme (pour useSofaPreGameForm)
    homeTeam: { form: parseForm(formHome).slice(0, 5) },
    awayTeam: { form: parseForm(formAway).slice(0, 5) },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Hook interne : résolution fixture info ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function useAflFixtureInfo(match) {
  return useQuery({
    queryKey:  ['aflFixtureInfo', match?.id],
    queryFn:   () => resolveAflFixtureInfo(match),
    enabled:   !!match?.id && !!match?.utcDate && !!match?.competition?.code,
    staleTime: 60 * 60_000,
    gcTime:    4  * 60 * 60_000,
    retry:     1,
    retryDelay: 3_000,
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Hooks publics (même API que l'ancien useSofaScore) ─────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

/** Compos des deux équipes + formations. Disponible ~1h avant le KO. */
export function useSofaLineups(match) {
  const { data: info } = useAflFixtureInfo(match)
  return useQuery({
    queryKey: ['aflLineups', info?.fixtureId],
    queryFn:  async () => {
      const data = await afetch('fixtures/lineups', { fixture: info.fixtureId })
      return transformLineups(data, info.homeTeamId)
    },
    enabled:  !!info?.fixtureId,
    staleTime: 20 * 60_000,
    gcTime:    2  * 60 * 60_000,
    retry: 1,
  })
}

/**
 * Stats live : possession, tirs, tirs cadrés, corners, fautes.
 * Polling toutes les 90s (économise le quota free 100 req/jour).
 * Note : si espnScore.stats est disponible dans LiveStatsTab, ce hook n'est pas appelé.
 */
export function useSofaLiveStats(match, isLive = true) {
  const { data: info } = useAflFixtureInfo(match)
  return useQuery({
    queryKey: ['aflStats', info?.fixtureId],
    queryFn:  async () => {
      const data = await afetch('fixtures/statistics', { fixture: info.fixtureId })
      return transformStats(data, info.homeTeamId)
    },
    enabled:  !!info?.fixtureId && isLive,
    refetchInterval: isLive ? 90_000 : false,  // 90s pour économiser le quota
    staleTime: 85_000,
    retry: 1,
  })
}

/**
 * Momentum — n'existe pas dans api-football.
 * Retourne vide → MomentumChart affiche rien (gère déjà le cas null/vide).
 */
export function useSofaMomentum(_match, _isLive) {
  return { data: null, isLoading: false, isError: false }
}

/** H2H — 5 dernières confrontations. */
export function useSofaH2H(match) {
  const { data: info } = useAflFixtureInfo(match)
  return useQuery({
    queryKey: ['aflH2H', info?.homeTeamId, info?.awayTeamId],
    queryFn:  async () => {
      const data = await afetch('fixtures/headtohead', {
        h2h:  `${info.homeTeamId}-${info.awayTeamId}`,
        last: 5,
      })
      return transformH2H(data)
    },
    enabled:  !!info?.homeTeamId && !!info?.awayTeamId,
    staleTime: 60 * 60_000,
    gcTime:    6  * 60 * 60_000,
    retry: 1,
  })
}

/**
 * Prédictions api-football — utilisées à la fois pour les cotes (useSofaOdds)
 * et la forme (useSofaPreGameForm). Même queryKey → 1 seul fetch pour les deux.
 */
function useAflPredictions(match) {
  const { data: info } = useAflFixtureInfo(match)
  return useQuery({
    queryKey: ['aflPredictions', info?.fixtureId],
    queryFn:  async () => {
      const data = await afetch('predictions', { fixture: info.fixtureId })
      return transformPredictions(data)
    },
    enabled:  !!info?.fixtureId,
    staleTime: 30 * 60_000,
    gcTime:    4  * 60 * 60_000,
    retry: 1,
  })
}

/**
 * Cotes 1/N/2 → probabilités.
 * Retourne : { markets: [{ marketName, choices: [{ name, probability }] }] }
 * MatchModal lit choice.probability (entier %) directement.
 */
export function useSofaOdds(match) {
  return useAflPredictions(match)
}

/**
 * Forme pré-match (5 derniers matchs par équipe).
 * Retourne : { homeTeam: { form: [{result}] }, awayTeam: { form: [{result}] } }
 */
export function useSofaPreGameForm(match) {
  return useAflPredictions(match)
}

/** Compat shim — si MatchModal référençait useSofaEventId directement. */
export function useSofaEventId(match) {
  return useAflFixtureInfo(match)
}
