// api/espn-live.js
// Endpoint server-side ESPN : fetch + Redis cache + matching FD.org → ESPN.
//
// Avantages vs fetch direct côté client :
//   • Scoreboard mis en cache Redis 12s → partagé entre tous les clients,
//     ESPN n'est appelé que si le cache est expiré
//   • eventId → fdMatchId stocké Redis 6h → survit aux rechargements iOS
//   • Scorer preservation côté serveur → plus de perte de noms au reload
//   • Stats summary cachées 55s → un seul fetch ESPN/min par match live
//   • Si ESPN est down → Redis renvoie les dernières données connues

import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// football-data.org competition ID → slug ESPN
const COMP_ESPN = {
  2015: 'fra.1',
  2021: 'eng.1',
  2014: 'esp.1',
  2002: 'ger.1',
  2019: 'ita.1',
  2001: 'uefa.champions',
  2146: 'uefa.europa',
  2048: 'uefa.europa.conf',
  2000: 'fifa.world',
}

const LIVE_STATUSES = new Set([
  'STATUS_IN_PROGRESS',
  'STATUS_HALFTIME',
  'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME',
  'STATUS_OVERTIME',
  'STATUS_SHOOTOUT',
])

const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const SB_TTL     = 12         // scoreboard Redis TTL : 12s
const SUM_TTL    = 20         // summary Redis TTL : 20s (réduit pour buteurs plus réactifs)
const EID_TTL    = 6 * 3600  // eventId mapping : 6h
const MATCH_TTL  = 6 * 3600  // données match : 6h
const SB_TIMEOUT = 3_500      // timeout scoreboard ESPN : 3.5s (Vercel Hobby limit = 10s)
const SUM_TIMEOUT = 2_500     // timeout summary ESPN : 2.5s

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function parseScore(raw) {
  if (raw == null) return 0
  if (typeof raw === 'number') return Math.round(raw)
  if (typeof raw === 'string') return parseInt(raw, 10) || 0
  if (typeof raw === 'object') return parseInt(raw.displayValue ?? raw.value ?? '0', 10) || 0
  return 0
}

function getStatVal(obj, ...names) {
  for (const n of names) {
    const f = (obj?.statistics ?? []).find(s => s.name === n)
    if (f != null) { const v = parseFloat(f.displayValue); return isNaN(v) ? null : v }
  }
  return null
}

function extractScorers(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const txt = (d.type?.text ?? '').toLowerCase()
      const id  = String(d.type?.id ?? '')
      // Couvrir Goal, PenaltyKick, OwnGoal et variantes ESPN (IDs connus : 57, 58, 72)
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

function extractStats(homeC, awayC) {
  const hp  = getStatVal(homeC, 'possessionPct')
  const ap  = getStatVal(awayC, 'possessionPct')
  const hs  = getStatVal(homeC, 'totalShots', 'shotsTotal', 'shots')
  const as_ = getStatVal(awayC, 'totalShots', 'shotsTotal', 'shots')
  const hSOT = getStatVal(homeC, 'shotsOnTarget', 'onTargetShots', 'shotsOnGoal')
  const aSOT = getStatVal(awayC, 'shotsOnTarget', 'onTargetShots', 'shotsOnGoal')
  const hC  = getStatVal(homeC, 'cornerKicks', 'corners')
  const aC  = getStatVal(awayC, 'cornerKicks', 'corners')
  if (hp === null && hs === null) return null
  return {
    home: { poss: hp,  shots: hs,  shotsOnTarget: hSOT, corners: hC },
    away: { poss: ap,  shots: as_, shotsOnTarget: aSOT, corners: aC },
  }
}

function extractSummaryData(json, homeTeamId) {
  const teams    = json.boxscore?.teams ?? []
  const homeTeam = teams.find(t => t.homeAway === 'home')
  const awayTeam = teams.find(t => t.homeAway === 'away')

  // Stats
  const hp   = getStatVal(homeTeam, 'possessionPct')
  const ap   = getStatVal(awayTeam, 'possessionPct')
  const hs   = getStatVal(homeTeam, 'totalShots', 'shotsTotal', 'shots')
  const as_  = getStatVal(awayTeam, 'totalShots', 'shotsTotal', 'shots')
  const hSOT = getStatVal(homeTeam, 'shotsOnTarget', 'onTargetShots', 'shotsOnGoal')
  const aSOT = getStatVal(awayTeam, 'shotsOnTarget', 'onTargetShots', 'shotsOnGoal')
  const hC   = getStatVal(homeTeam, 'cornerKicks', 'corners')
  const aC   = getStatVal(awayTeam, 'cornerKicks', 'corners')
  const stats = (hp === null && hs === null) ? null : {
    home: { poss: hp,  shots: hs,  shotsOnTarget: hSOT, corners: hC },
    away: { poss: ap,  shots: as_, shotsOnTarget: aSOT, corners: aC },
  }

  // Buteurs depuis scoringPlays (plus complet que details du scoreboard)
  let scorers = null
  const scoringPlays = json.scoringPlays ?? []
  if (scoringPlays.length > 0) {
    scorers = scoringPlays
      .filter(p => {
        const txt = p.type?.text?.toLowerCase() ?? ''
        return txt.includes('goal') || p.type?.id === '57' || p.type?.id === '58'
      })
      .map(p => {
        const ath   = p.participants?.[0]?.athlete ?? p.athletes?.[0]
        const isHome = p.team?.id === homeTeamId
        const isOG   = p.type?.text?.toLowerCase().includes('own') ?? false
        return {
          name:        ath?.shortName ?? ath?.displayName ?? '?',
          minute:      p.clock?.displayValue ?? '',
          team:        isHome ? 'home' : 'away',
          ownGoal:     isOG,
          penaltyKick: (p.type?.text?.toLowerCase().includes('penalty') ?? false) && !isOG,
        }
      })
  }

  return { stats, scorers }
}

function safeJson(val) {
  if (!val) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return null } }
  return val
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') return res.status(405).end()

  // Rate limiting : 60 req / IP / minute (poll client = 15s, max ~4 req/min légitimes)
  const ip     = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rlKey  = `ratelimit:espnlive:${ip}`
  try {
    const count = await kv.incr(rlKey)
    if (count === 1) await kv.expire(rlKey, 60)
    if (count > 60) return res.status(429).json({ error: 'Trop de requêtes' })
  } catch { /* Redis down → continuer */ }

  const { matches } = req.body ?? {}
  if (!Array.isArray(matches) || !matches.length) return res.json({})

  // Limite : max 20 matchs par requête (anti-abus payload oversized)
  if (matches.length > 20) return res.status(400).json({ error: 'Trop de matchs (max 20)' })

  // Dates ESPN : J et J-1 pour couvrir les matchs après minuit UTC
  const now  = new Date()
  const yest = new Date(now - 86_400_000)
  const fmt  = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  const today     = fmt(now)
  const yesterday = fmt(yest)

  // Slugs ESPN requis pour ces matchs
  const slugSet = new Set()
  for (const m of matches) {
    const s = COMP_ESPN[m.competition?.id]
    if (s) slugSet.add(s)
  }

  // ── Batch load Redis ──
  // eventId mappings + données stockées (pour scorer preservation + fallback cache)
  let storedEids    = Array(matches.length).fill(null)
  let storedMatches = Array(matches.length).fill(null)
  try {
    const eidKeys   = matches.map(m => `espn:eid:${m.id}`)
    const matchKeys = matches.map(m => `espn:match:${m.id}`)
    ;[storedEids, storedMatches] = await Promise.all([
      kv.mget(...eidKeys),
      kv.mget(...matchKeys),
    ])
  } catch { /* Redis down — continue sans cache */ }

  // eventId → fdMatchId
  const eidToFdId = {}
  matches.forEach((m, i) => {
    if (storedEids[i]) eidToFdId[storedEids[i]] = m.id
  })

  // Données persistées (fallback si ESPN ne répond pas)
  const storedData = {}
  matches.forEach((m, i) => {
    const d = safeJson(storedMatches[i])
    if (d) storedData[m.id] = d
  })

  // ── Fetch scoreboards ESPN (avec cache Redis 12s) ──
  // { slug, evt }[] — tous les events ESPN des slugs requis
  const allEvents = []

  for (const slug of slugSet) {
    const cKey = `espn:sb:${slug}`
    let events = null

    try {
      const cached = await kv.get(cKey)
      if (cached) events = safeJson(cached)
    } catch {}

    if (!events) {
      // Cache expiré ou absent → fetch ESPN
      try {
        const [rT, rY] = await Promise.all([
          fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${today}`,     { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(SB_TIMEOUT) }),
          fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${yesterday}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(SB_TIMEOUT) }),
        ])
        const [jT, jY] = await Promise.all([
          rT.ok ? rT.json() : { events: [] },
          rY.ok ? rY.json() : { events: [] },
        ])
        events = [...(jT.events ?? []), ...(jY.events ?? [])]
        // Stocker en cache Redis
        try { await kv.setex(cKey, SB_TTL, JSON.stringify(events)) } catch {}
      } catch {
        // ESPN injoignable — on n'a pas d'events pour ce slug
        events = null
      }
    }

    if (Array.isArray(events)) {
      for (const evt of events) allEvents.push({ slug, evt })
    }
  }

  // ── Matching ESPN events → matchs FD.org ──
  const result      = {}  // { [fdMatchId]: matchData }
  const homeTeamIds = {}  // { [fdMatchId]: espnHomeTeamId } — pour summary
  const newEidMaps  = []  // nouveaux mappings à écrire en Redis

  for (const { slug, evt } of allEvents) {
    const comp = evt.competitions?.[0]
    if (!comp) continue

    const st         = comp.status
    const espnStatus = st?.type?.name
    if (!espnStatus) continue

    const homeC = (comp.competitors ?? []).find(c => c.homeAway === 'home')
    const awayC = (comp.competitors ?? []).find(c => c.homeAway === 'away')
    if (!homeC || !awayC) continue

    const homeTeamId = homeC.team?.id

    // 1. Lookup direct par eventId stocké (fiable à 100%)
    let fdMatch = null
    if (eidToFdId[evt.id]) {
      fdMatch = matches.find(m => m.id === eidToFdId[evt.id]) ?? null
    }
    // 2. Fuzzy matching sur les noms d'équipes (fallback)
    if (!fdMatch) {
      const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
      const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
      fdMatch = matches.find(m => {
        if (result[m.id]) return false // déjà matché dans cet event
        const h = m.homeTeam?.name ?? m.homeTeam?.shortName ?? ''
        const a = m.awayTeam?.name ?? m.awayTeam?.shortName ?? ''
        return fuzzyTeam(h, espnHome) && fuzzyTeam(a, espnAway)
      }) ?? null

      if (fdMatch) {
        // Stocker le mapping pour les polls futurs
        newEidMaps.push({ key: `espn:eid:${fdMatch.id}`, val: String(evt.id) })
        eidToFdId[evt.id] = fdMatch.id
      }
    }
    if (!fdMatch) continue

    // Extraction des données
    const home    = parseScore(homeC.score)
    const away    = parseScore(awayC.score)
    const scorers = extractScorers(comp, homeTeamId)
    const stats   = extractStats(homeC, awayC)

    // Scorer preservation : garder la liste la plus complète
    const prevData    = storedData[fdMatch.id]
    const prevScorers = prevData?.scorers ?? []
    const bestScorers = scorers.length >= prevScorers.length ? scorers : prevScorers
    // Stats : nouvelles si disponibles, sinon fallback cache
    const bestStats   = stats ?? prevData?.stats ?? null

    // But détecté côté serveur → invalider le cache summary immédiatement
    // pour que le prochain poll (15s) ramène le buteur depuis scoringPlays ESPN
    const prevTotal = (prevData?.home ?? -1) + (prevData?.away ?? -1)
    const newTotal  = home + away
    if (prevData && newTotal > prevTotal) {
      try { await kv.del(`espn:sum:${fdMatch.id}`) } catch {}
    }

    result[fdMatch.id]      = {
      espnEventId: evt.id,
      espnSlug:    slug,
      espnStatus,
      espnClock:   st.displayClock ?? '',
      espnPeriod:  st.period ?? null,
      home,
      away,
      scorers: bestScorers,
      stats:   bestStats,
    }
    homeTeamIds[fdMatch.id] = homeTeamId
  }

  // ── Summary stats pour matchs live (cache Redis 55s) ──
  // Fetch ESPN summary en parallèle pour tous les matchs live
  // → possession / tirs / corners + buteurs depuis scoringPlays
  const summaryJobs = []

  for (const [midStr, data] of Object.entries(result)) {
    if (!LIVE_STATUSES.has(data.espnStatus)) continue
    if (!data.espnEventId || !data.espnSlug)  continue

    const mid    = Number(midStr)
    const sumKey = `espn:sum:${mid}`

    summaryJobs.push((async () => {
      // Check Redis cache
      let sumData = null
      try {
        const cached = await kv.get(sumKey)
        if (cached) sumData = safeJson(cached)
      } catch {}

      if (!sumData) {
        // Fetch depuis ESPN
        try {
          const url = `${ESPN_BASE}/${data.espnSlug}/summary?event=${data.espnEventId}`
          const r   = await fetch(url, {
            headers: { 'Cache-Control': 'no-cache' },
            signal:  AbortSignal.timeout(SUM_TIMEOUT),
          })
          if (r.ok) {
            const json = await r.json()
            sumData = extractSummaryData(json, homeTeamIds[mid])
            try { await kv.setex(sumKey, SUM_TTL, JSON.stringify(sumData)) } catch {}
          }
        } catch {}
      }

      if (!sumData) return

      const curr = result[midStr]
      if (!curr) return

      // Fusionner : prendre les données les plus complètes
      if (sumData.scorers && sumData.scorers.length >= (curr.scorers?.length ?? 0)) {
        curr.scorers = sumData.scorers
      }
      if (sumData.stats) {
        curr.stats = sumData.stats
      }
    })())
  }

  if (summaryJobs.length > 0) {
    await Promise.allSettled(summaryJobs)
  }

  // ── Écriture Redis en parallèle ──
  const writes = []

  // Nouveaux mappings eventId → fdMatchId
  for (const { key, val } of newEidMaps) {
    writes.push(kv.setex(key, EID_TTL, val))
  }

  // Données match (scorer preservation cross-session)
  for (const [midStr, data] of Object.entries(result)) {
    writes.push(kv.setex(`espn:match:${midStr}`, MATCH_TTL, JSON.stringify(data)))
  }

  if (writes.length > 0) {
    await Promise.allSettled(writes)
  }

  // ── Fallback cache pour matchs non trouvés dans scoreboard ──
  // Si ESPN était down ou le match n'est pas dans la fenêtre → renvoyer
  // les dernières données connues (evite l'affichage vide côté client)
  for (const m of matches) {
    if (result[m.id]) continue
    const stored = storedData[m.id]
    if (stored) result[m.id] = { ...stored, fromCache: true }
  }

  return res.json(result)
}
