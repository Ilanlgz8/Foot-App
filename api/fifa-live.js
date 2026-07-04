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
const FIFA_TTL      = 6           // Cache Redis FIFA live (s)
const ESPN_BASE     = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const ESPN_TTL      = 8           // Cache Redis ESPN (s)
const MATCH_TTL     = 90 * 24 * 3600   // Données match persistées 90 jours (WC 2026)
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

async function fetchFifaLive(bypassCache = false) {
  const cKey = 'fifa:live'
  if (!bypassCache) {
    try {
      const cached = await kv.get(cKey)
      if (cached) return { data: safeJson(cached), fromCache: true }
    } catch {}
  }

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
  // Préserver le temps additionnel : "45+2" → "45:00+2:00"
  // (sans ça, parseInt("45+2") = 45 → perd l'info stoppage, affiche "45'" figé)
  const plusIdx = t.indexOf('+')
  if (plusIdx !== -1) {
    const base  = parseInt(t.slice(0, plusIdx), 10)
    const extra = parseInt(t.slice(plusIdx + 1), 10)
    if (!isNaN(base) && !isNaN(extra) && extra > 0) return `${base}:00+${extra}:00`
  }
  const mins = parseInt(t, 10)
  if (isNaN(mins)) return ''

  // FIFA envoie parfois les minutes en comptage linéaire pendant le temps additionnel
  // (ex: "49" pour la 4ème min de stoppage de la 1ère MT au lieu de "45+4").
  // Convertir en format "base:00+extra:00" selon la période en cours.
  const p = m.Period
  if (p === 1 && mins > 45 && mins <= 60)  return `45:00+${mins - 45}:00`
  if (p === 2 && mins > 90 && mins <= 105) return `90:00+${mins - 90}:00`
  if (p === 4 && mins > 105 && mins <= 125) return `105:00+${mins - 105}:00`
  if (p === 6 && mins > 120 && mins <= 140) return `120:00+${mins - 120}:00`

  return `${mins}:00`
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

// Retourne TOUS les noms d'équipe disponibles dans toutes les locales.
// Permet de faire matcher "Iraq" (FD.org) avec "Irak" (FIFA locale fr), etc.
function fifaTeamNames(team) {
  const names = (team?.TeamName ?? [])
    .map(t => t.Description)
    .filter(Boolean)
  // Mettre l'anglais en premier si dispo
  const enIdx = (team?.TeamName ?? []).findIndex(t => /^en/i.test(t.Locale))
  if (enIdx > 0) {
    const en = names.splice(enIdx, 1)[0]
    names.unshift(en)
  }
  return names.length ? names : ['?']
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

// ── ESPN (source primaire pour statuts/clock) ──────────────────────────────────
// ESPN est la source principale pour espnStatus / espnClock / espnPeriod.
// WC 2026 : slug 'fifa.world' → ESPN couvre aussi la WC, statuts fiables.
// FIFA sert UNIQUEMENT pour le score + buteurs WC (plus réactif sur les buts).
const COMP_ESPN = {
  2000: 'fifa.world',       // WC 2026
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

// Cartons (jaune/rouge) — mêmes ids ESPN que ceux vérifiés en direct sur de vrais
// matchs (type.id "94"="Yellow Card", "93"="Red Card"). Pas d'équivalent FIFA
// fiable pour les cartons (contrairement aux buts) → ESPN uniquement.
function extractEspnCards(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const id = String(d.type?.id ?? '')
      return id === '93' || id === '94'
    })
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      return {
        name:   ath?.shortName ?? ath?.displayName ?? '?',
        minute: d.clock?.displayValue ?? '',
        team:   d.team?.id === homeTeamId ? 'home' : 'away',
        red:    d.redCard === true || String(d.type?.id) === '93',
      }
    })
}

// ── ESPN summary → stats live (possession, tirs, corners) ─────────────────────
// Le scoreboard ESPN n'inclut pas statistics[] pour le soccer.
// Les stats réelles sont dans l'endpoint /summary?event={espnEventId}.
// ⚠️ TTL abaissé de 30s à 10s (proche de ESPN_TTL=8s du score, marge de
// sécurité volontaire) : avant ce fix, la possession/tirs/corners pouvait
// traîner jusqu'à 30s de retard sur le score lui-même — signalé par
// l'utilisateur comme une asymétrie gênante en live. 10s plutôt que 8s :
// aucune limite de débit ESPN documentée publiquement, donc marge de
// prudence délibérée (25% de requêtes en moins qu'à 8s) pour une perte de
// fraîcheur perçue négligeable. Cache toujours PARTAGÉ entre tous les
// utilisateurs (une requête ESPN par fenêtre de 10s, pas par utilisateur).
const SUMMARY_TTL = 10   // Cache Redis summary (s)

async function fetchEspnSummaryStats(slug, espnEventId) {
  if (!slug || !espnEventId) return null
  const cKey = `espn:sum:${espnEventId}`
  try {
    const cached = await kv.get(cKey)
    if (cached) {
      const d = safeJson(cached)
      return d  // peut être null si match pas encore de stats
    }
  } catch {}

  try {
    const r = await fetch(
      `${ESPN_BASE}/${slug}/summary?event=${espnEventId}`,
      { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(ESPN_TIMEOUT) }
    )
    if (!r.ok) return null
    const j = await r.json()

    // Les stats sont dans boxscore.teams[]
    const teams = j.boxscore?.teams ?? []
    const homeT = teams.find(t => t.homeAway === 'home')
    const awayT = teams.find(t => t.homeAway === 'away')
    const stats = extractBoxscoreStats(homeT?.statistics, awayT?.statistics)
    // Stocker même si null pour éviter de re-fetcher inutilement
    try { await kv.set(cKey, JSON.stringify(stats), { ex: SUMMARY_TTL }) } catch {}
    return stats
  } catch {
    return null
  }
}

function extractBoxscoreStats(hArr, aArr) {
  if (!hArr?.length && !aArr?.length) return null

  // Log temporaire — voir tous les noms de stats ESPN disponibles
  if (hArr?.length) console.log('[espn:stats] home fields:', hArr.map(s => s.name).join(', '))

  function find(arr, ...names) {
    if (!arr) return null
    for (const name of names) {
      const s = arr.find(s => s.name === name || s.abbreviation === name)
      if (s == null) continue
      const v = parseFloat(s.displayValue ?? String(s.value ?? ''))
      if (!isNaN(v)) return v
    }
    return null
  }

  const hPoss    = find(hArr, 'possessionPct', 'possession')
  const aPoss    = find(aArr, 'possessionPct', 'possession')
  const hShots   = find(hArr, 'totalShots', 'shotsTotal', 'shots')
  const aShots   = find(aArr, 'totalShots', 'shotsTotal', 'shots')
  const hSOT     = find(hArr, 'shotsOnTarget', 'shotsOnGoal', 'onGoalAttempts')
  const aSOT     = find(aArr, 'shotsOnTarget', 'shotsOnGoal', 'onGoalAttempts')
  const hCorners = find(hArr, 'cornerKicks', 'cornerKick', 'cornersTotal', 'corners')
  const aCorners = find(aArr, 'cornerKicks', 'cornerKick', 'cornersTotal', 'corners')
  const hFouls   = find(hArr, 'foulsCommitted', 'totalFouls', 'fouls', 'foulCommitted')
  const aFouls   = find(aArr, 'foulsCommitted', 'totalFouls', 'fouls', 'foulCommitted')
  const hYellow  = find(hArr, 'yellowCards', 'yellowCard')
  const aYellow  = find(aArr, 'yellowCards', 'yellowCard')
  const hOffside = find(hArr, 'offsides', 'offside')
  const aOffside = find(aArr, 'offsides', 'offside')
  // xG — ESPN l'inclut pour certaines ligues/compétitions (WC inclus)
  const hXG      = find(hArr, 'expectedGoals', 'xg', 'xG', 'expectedGoalsTotal', 'expectedGoal')
  const aXG      = find(aArr, 'expectedGoals', 'xg', 'xG', 'expectedGoalsTotal', 'expectedGoal')

  if (hPoss == null && hShots == null && hCorners == null) return null

  return {
    home: { poss: hPoss, shots: hShots, shotsOnTarget: hSOT, corners: hCorners, fouls: hFouls, yellow: hYellow, offsides: hOffside, xg: hXG },
    away: { poss: aPoss, shots: aShots, shotsOnTarget: aSOT, corners: aCorners, fouls: aFouls, yellow: aYellow, offsides: aOffside, xg: aXG },
  }
}

async function fetchEspnEvents(slugSet, today, yesterday, bypassCache = false) {
  const allEvents = []
  await Promise.allSettled([...slugSet].map(async slug => {
    const cKey = `espn:fb:${slug}`
    let events = null
    if (!bypassCache) {
      try {
        const cached = await kv.get(cKey)
        if (cached) events = safeJson(cached)
      } catch {}
    }

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

  // forceFresh : envoyé par le client au retour au premier plan (voir onVisible
  // dans useLiveMinute.js) — contourne le cache Redis (6-8s) pour CET appel
  // précis, afin de ne pas rater un but marqué juste avant/pendant l'arrière-plan
  // si ce cache a été rafraîchi par un autre appel juste avant notre retour.
  const { matches, forceFresh } = req.body ?? {}
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

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1 : FIFA live → score + buteurs + IDs (WC uniquement)
  // FIFA est UNIQUEMENT utilisé pour les données de score/buteurs WC.
  // Les statuts (espnStatus/espnClock/espnPeriod) viennent d'ESPN — plus fiables.
  // ══════════════════════════════════════════════════════════════════════════
  const { data: fifaLive, fromCache: fifaCached } = await fetchFifaLive(!!forceFresh)

  // Index FIFA par fdMatchId : score + buteurs + IDs FIFA pour les compos/stats
  const fifaByFdId = {}
  if (fifaLive?.length > 0) {
    const usedFifaIds = new Set()
    for (const fdMatch of matches) {
      if (fdMatch.competition?.id !== 2000) continue   // WC seulement

      const fdHome = fdMatch.homeTeam?.name ?? fdMatch.homeTeam?.shortName ?? ''
      const fdAway = fdMatch.awayTeam?.name ?? fdMatch.awayTeam?.shortName ?? ''
      if (!fdHome || !fdAway) continue

      const fifaMatch = fifaLive.find(m => {
        if (usedFifaIds.has(m.IdMatch)) return false
        const homeNames = fifaTeamNames(m.HomeTeam)
        const awayNames = fifaTeamNames(m.AwayTeam)
        return homeNames.some(n => fuzzyTeam(fdHome, n))
            && awayNames.some(n => fuzzyTeam(fdAway, n))
      })
      if (!fifaMatch) continue

      usedFifaIds.add(fifaMatch.IdMatch)
      const { home, away } = fifaScore(fifaMatch)

      fifaByFdId[fdMatch.id] = {
        home, away,
        scorers:      extractFifaScorers(fifaMatch),
        fifaMatchId:  fifaMatch.IdMatch,
        fifaCompId:   fifaMatch.IdCompetition ?? null,
        fifaSeasonId: fifaMatch.IdSeason      ?? null,
        fifaStageId:  fifaMatch.IdStage       ?? null,
        fifaRaw:      fifaMatch,              // gardé pour fallback statut
        fromCache:    fifaCached,
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2 : ESPN → statuts + clock + period (source primaire pour TOUS)
  // WC inclus via slug 'fifa.world'. Pas de faux STATUS_FINAL / STATUS_EXTRA_TIME.
  // ══════════════════════════════════════════════════════════════════════════
  const slugSet = new Set()
  for (const m of matches) {
    const s = COMP_ESPN[m.competition?.id]
    if (s) slugSet.add(s)
  }

  const espnEvents = slugSet.size > 0
    ? await fetchEspnEvents(slugSet, today, yesterday, !!forceFresh)
    : []

  // Matcher chaque match FD.org avec un event ESPN
  const usedEspnIds = new Set()
  for (const fdMatch of matches) {
    const slug = COMP_ESPN[fdMatch.competition?.id]
    if (!slug) continue

    const fdHome = fdMatch.homeTeam?.name ?? fdMatch.homeTeam?.shortName ?? ''
    const fdAway = fdMatch.awayTeam?.name ?? fdMatch.awayTeam?.shortName ?? ''
    if (!fdHome || !fdAway) continue

    // ── Raccourci : ré-utiliser l'ID ESPN déjà résolu lors d'un poll précédent ──
    // Root cause d'une bonne partie des bugs "intermittents" déjà corrigés cette
    // session (matchs simultanés, noms légèrement différents...) : le fuzzy-match
    // par NOM était re-exécuté à chaque poll (~toutes les 15-20s), pour CHAQUE
    // match, y compris ceux déjà identifiés avec certitude auparavant. Ré-tenter
    // un pari probabiliste en boucle indéfiniment, c'est mathématiquement
    // garanti de finir par tomber sur le mauvais tirage tôt ou tard. On ne
    // devrait avoir à "deviner" qu'UNE SEULE FOIS par match (à son apparition),
    // puis se souvenir du bon ID ESPN et le réutiliser directement tant qu'il
    // reste valide — beaucoup plus fiable ET moins de travail à chaque poll.
    // (espnRealEventId ≠ le champ espnEventId du résultat final, qui contient
    // l'ID FIFA pour la CM — deux systèmes d'ID différents, à ne pas confondre.)
    const prevRealId = storedData[fdMatch.id]?.espnRealEventId ?? null
    let found = prevRealId != null
      ? espnEvents.find(({ slug: s, evt }) =>
          s === slug && evt.id === prevRealId && !usedEspnIds.has(evt.id))
      : null

    // Si l'ID connu n'est plus dans le scoreboard actuel (rare — event retiré,
    // changement de jour...), on retombe sur le fuzzy-match par nom comme avant.
    if (!found) {
      found = espnEvents.find(({ slug: s, evt }) => {
        if (s !== slug) return false
        if (usedEspnIds.has(evt.id)) return false
        const comp  = evt.competitions?.[0]
        const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
        const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
        const eHome = homeC?.team?.displayName ?? homeC?.team?.name ?? ''
        const eAway = awayC?.team?.displayName ?? awayC?.team?.name ?? ''
        return fuzzyTeam(fdHome, eHome) && fuzzyTeam(fdAway, eAway)
      })
    }

    // Repli : le fuzzy-match strict (2 côtés) peut échouer sur un des deux
    // matchs quand plusieurs commencent à la même minute — situation garantie
    // pour les derniers matchs de poule (kickoff simultané obligatoire), pas
    // juste un hasard. Dans ce cas un match restait bloqué sur "Débute" sans
    // jamais se raccrocher à son event ESPN. Repli : n'exiger qu'UN des deux
    // côtés + un coup d'envoi ESPN à ±10min du nôtre (assez précis pour ne pas
    // accrocher un mauvais match, assez large pour couvrir les petits écarts
    // de synchro d'horloge entre FD.org et ESPN).
    if (!found) {
      const fdKickoff = new Date(fdMatch.utcDate).getTime()
      found = espnEvents.find(({ slug: s, evt }) => {
        if (s !== slug) return false
        if (usedEspnIds.has(evt.id)) return false
        const comp  = evt.competitions?.[0]
        const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
        const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
        const eHome = homeC?.team?.displayName ?? homeC?.team?.name ?? ''
        const eAway = awayC?.team?.displayName ?? awayC?.team?.name ?? ''
        if (!fuzzyTeam(fdHome, eHome) && !fuzzyTeam(fdAway, eAway)) return false
        const rawKickoff = evt.date ?? comp?.date
        if (!rawKickoff) return false
        const evtKickoff = new Date(rawKickoff).getTime()
        return Math.abs(evtKickoff - fdKickoff) <= 10 * 60_000
      })
    }

    if (!found) continue

    usedEspnIds.add(found.evt.id)
    const comp     = found.evt.competitions[0]
    const st       = comp.status
    const espnStatus = st?.type?.name ?? 'STATUS_SCHEDULED'
    const espnClock  = st?.displayClock ?? ''
    const espnPeriod = st?.period ?? null

    const homeC = comp.competitors?.find(c => c.homeAway === 'home')
    const awayC = comp.competitors?.find(c => c.homeAway === 'away')

    const isWC    = fdMatch.competition?.id === 2000
    const fifaD   = isWC ? fifaByFdId[fdMatch.id] : null
    const prevData = storedData[fdMatch.id]

    // WC : si ESPN retourne encore STATUS_SCHEDULED mais que FIFA confirme Period=1
    // (match réellement commencé), utiliser le statut FIFA pour ne pas attendre
    // le lag ESPN (~4min). Le garde Period=0 → SCHEDULED est déjà dans fifaToEspnStatus.
    let finalEspnStatus = espnStatus
    let finalEspnClock  = espnClock
    let finalEspnPeriod = espnPeriod
    if (isWC && espnStatus === 'STATUS_SCHEDULED' && fifaD?.fifaRaw) {
      const fifaStatus = fifaToEspnStatus(fifaD.fifaRaw)
      if (fifaStatus === 'STATUS_IN_PROGRESS' || fifaStatus === 'STATUS_HALFTIME') {
        finalEspnStatus = fifaStatus
        finalEspnClock  = fifaToClock(fifaD.fifaRaw)
        finalEspnPeriod = fifaToPeriod(fifaD.fifaRaw)
      }
    }

    // Score : FIFA si WC (plus réactif sur les buts), ESPN sinon
    // Pour WC : max(FIFA, ESPN) → le premier à détecter le but gagne
    // Évite d'attendre FIFA si ESPN a déjà mis à jour (ou inversement)
    let home, away, scorers
    if (fifaD) {
      const espnHome = parseEspnScore(homeC?.score) ?? 0
      const espnAway = parseEspnScore(awayC?.score) ?? 0
      home    = Math.max(fifaD.home ?? 0, espnHome)
      away    = Math.max(fifaD.away ?? 0, espnAway)
      // FIFA scorers en priorité, fallback ESPN si FIFA n'a pas trouvé les noms
      scorers = fifaD.scorers.length > 0
        ? fifaD.scorers
        : extractEspnScorers(comp, homeC?.team?.id)
    } else {
      home    = parseEspnScore(homeC?.score)
      away    = parseEspnScore(awayC?.score)
      scorers = extractEspnScorers(comp, homeC?.team?.id)
    }

    const bestScorers = scorers.length >= (prevData?.scorers?.length ?? 0)
      ? scorers : (prevData?.scorers ?? [])

    // Cartons — ESPN uniquement (voir extractEspnCards ci-dessus)
    const cards = extractEspnCards(comp, homeC?.team?.id)
    const bestCards = cards.length >= (prevData?.cards?.length ?? 0)
      ? cards : (prevData?.cards ?? [])

    // ── Score des tirs au but ────────────────────────────────────────────────
    // ESPN expose un champ dédié `shootoutScore` sur chaque compétiteur (vérifié
    // sur un vrai match : finale CM 2022, Argentine 4 - France 2). FIFA n'a pas
    // d'équivalent confirmé pour ce champ précis (contrairement au score/buteurs
    // où FIFA est privilégié) — et ses transitions de période sont déjà connues
    // pour avoir des ratés (cf plus haut STATUS_EXTRA_TIME/STATUS_FINAL foireux).
    // Donc ESPN uniquement ici, avec le même garde anti-régression que le score
    // (le compteur de tab ne peut que monter, jamais redescendre).
    const rawHomeShootout = homeC?.shootoutScore ?? null
    const rawAwayShootout = awayC?.shootoutScore ?? null
    const prevHomeShootout = prevData?.homeShootout ?? null
    const prevAwayShootout = prevData?.awayShootout ?? null
    const homeShootout = (rawHomeShootout != null && prevHomeShootout != null)
      ? Math.max(rawHomeShootout, prevHomeShootout)
      : (rawHomeShootout ?? prevHomeShootout)
    const awayShootout = (rawAwayShootout != null && prevAwayShootout != null)
      ? Math.max(rawAwayShootout, prevAwayShootout)
      : (rawAwayShootout ?? prevAwayShootout)

    // Stats : scoreboard ESPN d'abord
    // Si scoreboard vide (WC et beaucoup de ligues club) ET match en cours
    // → appel summary endpoint ESPN (cached 30s Redis) qui contient boxscore complet
    let matchStats = extractBoxscoreStats(homeC?.statistics, awayC?.statistics)
    if (
      !matchStats &&
      (finalEspnStatus === 'STATUS_IN_PROGRESS' ||
       finalEspnStatus === 'STATUS_HALFTIME'    ||
       finalEspnStatus === 'STATUS_END_PERIOD')
    ) {
      // found.slug = 'fifa.world' pour WC, 'fra.1' etc pour club
      matchStats = await fetchEspnSummaryStats(found.slug, found.evt.id)
    }
    matchStats = matchStats ?? prevData?.stats ?? null

    result[fdMatch.id] = {
      // IDs : FIFA match ID pour WC (nécessaire pour les compos), ESPN sinon.
      // Si fifaD absent (FIFA live cache stale), on préserve l'ID FIFA depuis prevData
      // pour ne pas écraser un bon espnEventId par un ID ESPN inutilisable.
      espnEventId:  fifaD?.fifaMatchId
                      ?? (isWC ? prevData?.espnEventId : null)
                      ?? found.evt.id,
      espnSlug:     isWC ? 'fifa' : found.slug,
      // ID ESPN "brut" — distinct de espnEventId ci-dessus (qui est l'ID FIFA
      // pour la CM) — mémorisé pour éviter de re-fuzzy-matcher ce match par nom
      // à chaque poll (voir commentaire plus haut sur le raccourci de matching).
      espnRealEventId: found.evt.id,
      // Statut : ESPN primaire, mais si ESPN lag au KO WC → FIFA Period=1 utilisé
      espnStatus:   finalEspnStatus,
      espnClock:    finalEspnClock,
      espnPeriod:   finalEspnPeriod,
      // Score FIFA (WC) ou ESPN (club)
      home,
      away,
      scorers:      bestScorers,
      cards:        bestCards,
      // Tirs au but (ESPN uniquement — voir commentaire ci-dessus)
      homeShootout,
      awayShootout,
      // Stats : summary ESPN (possession, tirs, corners) — scoreboard souvent vide en soccer
      stats:        matchStats,
      // IDs FIFA pour api/fifa-lineups.js — préserver depuis prevData si fifaD absent
      ...(fifaD ? {
        fifaCompId:   fifaD.fifaCompId,
        fifaSeasonId: fifaD.fifaSeasonId,
        fifaStageId:  fifaD.fifaStageId,
      } : isWC && prevData?.fifaCompId ? {
        fifaCompId:   prevData.fifaCompId,
        fifaSeasonId: prevData.fifaSeasonId,
        fifaStageId:  prevData.fifaStageId,
      } : {}),
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3 : Fallback FIFA pour matchs WC non trouvés dans ESPN
  // Si ESPN ne retourne pas encore le match (lag ou match tout juste commencé)
  // → utiliser FIFA status en dernier recours (plutôt que rien).
  // ══════════════════════════════════════════════════════════════════════════
  for (const fdMatch of matches) {
    if (result[fdMatch.id]) continue
    const fifaD = fifaByFdId[fdMatch.id]
    if (!fifaD?.fifaRaw) continue

    const fm       = fifaD.fifaRaw
    const prevData = storedData[fdMatch.id]
    const bestScorers = fifaD.scorers.length >= (prevData?.scorers?.length ?? 0)
      ? fifaD.scorers : (prevData?.scorers ?? [])

    result[fdMatch.id] = {
      espnEventId:  fifaD.fifaMatchId,
      espnSlug:     'fifa',
      espnStatus:   fifaToEspnStatus(fm),
      espnClock:    fifaToClock(fm),
      espnPeriod:   fifaToPeriod(fm),
      home:         fifaD.home,
      away:         fifaD.away,
      scorers:      bestScorers,
      // Pas de source fiable pour les cartons ici (fallback FIFA sans ESPN) →
      // on préserve juste la dernière valeur ESPN connue plutôt que de la perdre.
      cards:        prevData?.cards ?? [],
      stats:        prevData?.stats ?? null,
      // Pas de source fiable pour le score des tab ici (fallback FIFA sans ESPN)
      // → on préserve juste la dernière valeur ESPN connue plutôt que de la perdre.
      homeShootout: prevData?.homeShootout ?? null,
      awayShootout: prevData?.awayShootout ?? null,
      // Préserver l'ID ESPN déjà résolu (voir raccourci de matching plus haut) —
      // sinon un aller-retour en fallback FIFA (ex: fetch ESPN temporairement en
      // échec) ferait perdre le raccourci et forcerait un nouveau fuzzy-match.
      espnRealEventId: prevData?.espnRealEventId ?? null,
      fifaCompId:   fifaD.fifaCompId,
      fifaSeasonId: fifaD.fifaSeasonId,
      fifaStageId:  fifaD.fifaStageId,
      fromCache:    fifaD.fromCache,
      source:       'fifa_fallback',
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
