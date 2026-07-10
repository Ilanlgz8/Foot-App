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
const WC_COMP_ID = '17'  // ID compétition Coupe du Monde (stable)

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

// Découvre l'idSeason WC 2026 depuis l'API FIFA puis cherche le match par date
async function discoverFifaMatch(kv, utcDate, homeTeam, awayTeam) {
  if (!utcDate) return null

  // 1. Obtenir l'idSeason WC 2026 (cache Redis 30j)
  let seasonId = null
  try { seasonId = await kv.get('fifa:wc2026:seasonId') } catch {}

  if (!seasonId) {
    // Chercher la saison 2026 dans les saisons de la compétition WC
    const { ok, data } = await fifaFetch(`${FIFA_BASE}/competitions/${WC_COMP_ID}/seasons?language=en&count=20`)
    if (ok && data) {
      const seasons = data.Results ?? data.results ?? []
      const s2026 = seasons.find(s =>
        String(s.CalendarYear ?? s.Year ?? s.Name ?? '').includes('2026')
        || String(s.StartDate ?? '').startsWith('2026')
      )
      if (s2026?.IdSeason) {
        seasonId = s2026.IdSeason
        try { await kv.set('fifa:wc2026:seasonId', seasonId, { ex: 30 * 24 * 3600 }) } catch {}
      }
    }
  }

  const d = utcDate.slice(0, 10)  // YYYY-MM-DD
  const prev = new Date(d); prev.setUTCDate(prev.getUTCDate() - 1)
  const next = new Date(d); next.setUTCDate(next.getUTCDate() + 1)
  const datesToTry = [d, prev.toISOString().slice(0, 10), next.toISOString().slice(0, 10)]

  for (const tryDate of datesToTry) {
    // Essaie avec et sans seasonId
    const urlsToTry = []
    if (seasonId) {
      urlsToTry.push(`${FIFA_BASE}/calendar/matches?idCompetition=${WC_COMP_ID}&idSeason=${seasonId}&dateFrom=${tryDate}&dateTo=${tryDate}&language=en&count=20`)
    }
    urlsToTry.push(`${FIFA_BASE}/calendar/matches?idCompetition=${WC_COMP_ID}&dateFrom=${tryDate}&dateTo=${tryDate}&language=en&count=20`)

    for (const url of urlsToTry) {
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
            fifaSeasonId: m.IdSeason   ?? seasonId ?? null,
            fifaStageId:  m.IdStage    ?? null,
          }
        }
      }
      if (matches.length > 0) break  // On a eu une réponse valide, inutile de retry sans seasonId
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

  // ⚠️ AJOUT (audit sécurité demandé par l'utilisateur) : aucune limite de
  // débit ici, alors que ce endpoint a un vrai risque d'amplification — un
  // fdMatchId inconnu (donc jamais en cache Redis) déclenche discoverFifaMatch()
  // ET fetchFifaLineup() ET les stats, soit JUSQU'À ~10 fetchs sortants vers
  // l'API FIFA pour UNE SEULE requête entrante. Un attaquant envoyant des
  // fdMatchId bidons en boucle contournerait tout le cache et pourrait faire
  // monter le coût (et le risque de blocage de notre IP par FIFA) très vite.
  // Cap plus bas que les autres endpoints (30 vs 60/min) précisément à cause
  // de cette amplification — un usage normal (1 utilisateur, 1 match) reste
  // très largement en dessous.
  const ip    = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rlKey = `ratelimit:fifalineups:${ip}`
  try {
    const count = await kv.incr(rlKey)
    if (count === 1) await kv.expire(rlKey, 60)
    if (count > 30) return res.status(429).json({ error: 'Trop de requêtes' })
  } catch {}

  const { fdMatchId, home: fdHome = '', away: fdAway = '', utcDate = '', forceFresh = '' } = req.query
  if (!fdMatchId) return res.status(400).json({ error: 'fdMatchId requis' })
  // forceFresh=1 : contourne le cache Redis stats (mais pas les IDs/lineup,
  // qui n'ont pas besoin de fraîcheur) — voir même paramètre dans
  // api/fifa-live.js. Utilisé au retour au premier plan (useLiveMinute.js) :
  // sans ça, un retour d'arrière-plan pouvait retomber sur un snapshot déjà
  // vieux de près de 2min (TTL du cache stats) au lieu de données fraîches.
  const skipStatsCache = forceFresh === '1' || forceFresh === 'true'

  // ── 1. IDs FIFA : cache Redis (7j) → autodiscovery → fallback legacy ───────
  // ⚠️ Résolu AVANT le lineup (contrairement à avant) : les stats en ont besoin
  // même quand le lineup est déjà en cache (voir fix plus bas).
  const idsKey = `fifa:ids:${fdMatchId}`
  let ids = null
  try { ids = safeJson(await kv.get(idsKey)) } catch {}

  if (!ids?.fifaMatchId && utcDate) {
    ids = await discoverFifaMatch(kv, utcDate, fdHome, fdAway)
    if (ids?.fifaMatchId) {
      try { await kv.set(idsKey, JSON.stringify(ids), { ex: 7 * 24 * 3600 }) } catch {}
    }
  }

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

  // ── 2. Lineup : cache Redis (7j) sinon fetch FIFA ───────────────────────────
  // ⚠️ BUG CORRIGÉ : avant, dès que le lineup était introuvable (FIFA match ID
  // non résolu OU compo pas encore publiée), la route retournait un 404
  // IMMÉDIAT — avant même d'essayer les stats (section 3 ci-dessous), qui sont
  // pourtant indépendantes (elles n'ont besoin que de ids.fifaMatchId, déjà
  // résolu dans le 2e cas). Conséquence concrète : "possession" et les autres
  // stats FIFA n'apparaissaient JAMAIS pour un match sans compo dispo — ce qui
  // inclut tout match pas suivi en direct (les compos ne sont mises en cache
  // que si quelqu'un/le cron les a récupérées à temps), même si les stats,
  // elles, étaient parfaitement accessibles. On continue maintenant vers les
  // stats dans tous les cas, et on ne renvoie 404 qu'à la toute fin, si
  // vraiment rien (ni compo ni stats) n'a pu être trouvé.
  const lineupKey = `fifa:lineup:${fdMatchId}`
  let lineupResult = null
  try { lineupResult = safeJson(await kv.get(lineupKey)) } catch {}

  let lineupDiag = null
  if (!lineupResult?.home?.starters?.length) {
    if (!ids?.fifaMatchId) {
      // Diagnostic : tester directement l'accessibilité de l'API FIFA
      let fifaDiag = 'non testé'
      try {
        const r = await fetch(`${FIFA_BASE}/competitions/${WC_COMP_ID}/seasons?language=en&count=5`, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5_000),
        })
        fifaDiag = `status=${r.status}`
      } catch (e) { fifaDiag = `error=${e.message}` }

      lineupResult = null
      lineupDiag = { error: 'Match FIFA introuvable', diag: { utcDate, fdHome, fdAway, fifaApi: fifaDiag } }
    } else {
      lineupResult = await fetchFifaLineup(ids)
      if (lineupResult?.home?.starters?.length) {
        // Cache 7 jours — lineup d'un match terminé est définitive
        try { await kv.set(lineupKey, JSON.stringify(lineupResult), { ex: 7 * 24 * 3600 }) } catch {}
      } else {
        lineupResult = null
        lineupDiag = { error: 'Compositions FIFA introuvables (pas encore publiées)' }
      }
    }
  }

  // ── 3. Stats — TOUJOURS tentées, indépendamment du résultat du lineup ──────
  let stats = null
  if (ids?.fifaMatchId) {
    try {
      const cachedStats = skipStatsCache ? null : safeJson(await kv.get(`fifa:stats:${fdMatchId}`))
      if (cachedStats) {
        stats = cachedStats
      } else {
        const urlsToTry = []
        if (ids.fifaCompId && ids.fifaSeasonId && ids.fifaStageId)
          urlsToTry.push(`${FIFA_BASE}/matchstatistics/${ids.fifaCompId}/${ids.fifaSeasonId}/${ids.fifaStageId}/${ids.fifaMatchId}`)
        urlsToTry.push(`${FIFA_BASE}/matchstatistics/${ids.fifaMatchId}`)
        for (const url of urlsToTry) {
          const { ok, data } = await fifaFetch(url)
          if (ok && data) { stats = parseFifaStats(data); break }
        }
        if (stats) { try { await kv.set(`fifa:stats:${fdMatchId}`, JSON.stringify(stats), { ex: 120 }) } catch {} }
      }
    } catch {}
  }

  // Rien du tout (ni compo ni stats) → 404, avec le diagnostic le plus utile
  if (!lineupResult?.home?.starters?.length && !stats) {
    return res.status(404).json(lineupDiag ?? { error: 'Aucune donnée FIFA disponible' })
  }

  return res.json({ ...(lineupResult ?? {}), stats })
}
