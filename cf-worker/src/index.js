// cf-worker/src/index.js
// ── Worker Cloudflare : polling ESPN + détection (KO/but/carton/mi-temps/fin) ──
//
// CONTEXTE : ce Worker remplace la partie "polling toutes les minutes" de
// api/cron-goals.js (Vercel). Avant, cron-job.org appelait api/cron-goals.js
// chaque minute, 24/7/365, et TOUT (fetch ESPN, détection, ET envoi push VAPID
// chiffré par abonné) tournait sur Vercel — ce qui a fait dépasser le plafond
// gratuit "Fluid Active CPU" (4h/mois) dès la Coupe du Monde 2026, alors que
// tous les championnats européens n'avaient pas encore repris.
//
// NOUVELLE RÉPARTITION :
//   - Cloudflare Worker (ICI, gratuit) : Cron Trigger toutes les minutes →
//     fetch ESPN + détection de changement d'état. Coût CPU quasi nul : le
//     fetch réseau n'est PAS compté dans le budget CPU de Cloudflare (contrairement
//     à Vercel), seul le calcul réel (parsing JSON, comparaisons) compte — et
//     ça reste très en dessous des 10ms/exécution du plan gratuit dans l'usage
//     normal de cette app.
//   - Vercel (api/cron-goals.js, mode "notify") : reçoit UNIQUEMENT un appel
//     HTTP quand ce Worker a détecté un vrai événement à notifier (but, carton,
//     KO, mi-temps, fin — rare, quelques fois par match), fait le travail
//     réellement coûteux en CPU (signature VAPID + chiffrement AES-GCM par
//     abonné) UNIQUEMENT à ce moment-là. Le nombre d'appels Vercel passe ainsi
//     d'environ 1440/jour (24/7, qu'il y ait un match ou non) à quelques
//     dizaines par jour de match — le CPU actif Vercel redevient négligeable.
//
// Toute la logique de DÉTECTION ci-dessous est une adaptation directe de
// api/cron-goals.js (même clés Redis, même state machine, même garde-fous —
// voir les commentaires d'origine repris tels quels quand la logique est
// identique). Seule la partie ENVOI PUSH change : au lieu d'appeler
// webpush.sendNotification() directement (impossible ici : la lib `web-push`
// dépend du module `crypto` de Node, absent du runtime Workers), ce fichier
// appelle notifyVercel() qui fait juste UN fetch() POST vers Vercel avec le
// payload déjà prêt à envoyer.
//
// Redis : @upstash/redis est un client 100% basé sur fetch() (API REST
// Upstash) — aucune dépendance Node (TCP natif), documenté compatible
// Cloudflare Workers par Upstash eux-mêmes. Mêmes identifiants que côté
// Vercel (KV_REST_API_URL / KV_REST_API_TOKEN) : c'est LE MÊME Redis, partagé.

import { Redis } from '@upstash/redis'
import { TEAM_NAMES_FR } from '../../src/data/teamNames.js'
import { ESPN_SLUG_BY_COMP_ID } from '../../src/data/espnSlugs.js'

const ESPN_SLUGS = Object.values(ESPN_SLUG_BY_COMP_ID)
const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const FIFA_LIVE_URL = 'https://api.fifa.com/api/v3/live/football'

const LIVE_ESPN  = new Set([
  'STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME', 'STATUS_OVERTIME', 'STATUS_SHOOTOUT',
])
const FINAL_ESPN = new Set([
  'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
])
const KNOWN_ESPN_STATUS = new Set([
  'STATUS_SCHEDULED', 'STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME', 'STATUS_OVERTIME', 'STATUS_SHOOTOUT',
  'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
  'STATUS_POSTPONED', 'STATUS_CANCELED',
])

function normalizeEspnStatus(st) {
  const name = st?.type?.name ?? ''
  if (KNOWN_ESPN_STATUS.has(name)) return name
  if (name === 'STATUS_FIRST_HALF' || name === 'STATUS_SECOND_HALF') return 'STATUS_IN_PROGRESS'
  if (st?.type?.completed === true) return 'STATUS_FINAL'
  if (st?.type?.state === 'in')   return 'STATUS_IN_PROGRESS'
  if (st?.type?.state === 'post') return 'STATUS_FINAL'
  return name || 'STATUS_SCHEDULED'
}

function normalizeFifa(name = '') {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}
function fuzzyTeamFifa(a, b) {
  const na = normalizeFifa(a), nb = normalizeFifa(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true
  const wa = na.match(/[a-z]{4,}/g) ?? []
  const wb = nb.match(/[a-z]{4,}/g) ?? []
  return wa.some(x => wb.some(y => x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))))
}
function fifaTeamNamesAll(team) {
  return (team?.TeamName ?? []).map(t => t.Description).filter(Boolean)
}
function fifaEffectiveStatus(m) {
  if (m.MatchStatus !== 1 || m.Period === 0) return null
  if (m.Period === 3 || m.Period === 5) return 'STATUS_HALFTIME'
  return 'STATUS_IN_PROGRESS'
}
function fifaConfirmsShootoutOver(m) {
  return m.MatchStatus === 3 && m.Period === 8
}

function t(name) { return TEAM_NAMES_FR[name] ?? name }

function minuteLabel(raw) {
  const base = String(raw ?? '').split(':')[0]
  return base ? `${base}'` : ''
}

function dateStr(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function parseMin(m) { return parseInt(String(m ?? '').replace(/[^\d]/g, ''), 10) || 0 }

async function fetchEspnEvents(slug, date, log) {
  try {
    const r = await fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${date}&limit=100`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) { log.push(`[espn:${slug}] status=${r.status}`); return [] }
    const j = await r.json()
    return j.events ?? []
  } catch (e) {
    log.push(`[espn:${slug}] error=${e.message}`)
    return []
  }
}

async function fetchFifaLiveMatches(kv, log) {
  try {
    const cached = await kv.get('fifa:live')
    if (cached) {
      const data = typeof cached === 'string' ? JSON.parse(cached) : cached
      return data ?? []
    }
  } catch {}
  try {
    const res = await fetch(FIFA_LIVE_URL, {
      headers: { Accept: 'application/json' },
      signal:  AbortSignal.timeout(8_000),
    })
    if (!res.ok) { log.push(`[fifa:live] http=${res.status}`); return [] }
    const json = await res.json()
    const data = json.Results ?? []
    try { await kv.set('fifa:live', JSON.stringify(data), { ex: 6 }) } catch {}
    return data
  } catch (e) {
    log.push(`[fifa:live] error=${e.message}`)
    return []
  }
}

// ── Capture proactive du summary ESPN (compos + stats + événements) ──────────
// Identique à cacheEspnSummary() dans api/cron-goals.js — pur fetch + Redis,
// aucune dépendance crypto, portable telle quelle.
const SUMMARY_CACHE_TTL = 7 * 24 * 3600

function hasUsefulSummaryData(json) {
  const hasRosters  = Array.isArray(json?.rosters) && json.rosters.length > 0
  const hasBoxscore = Array.isArray(json?.boxscore?.teams) && json.boxscore.teams.length > 0
  const competitors  = json?.header?.competitions?.[0]?.competitors ?? []
  const hasHeaderRoster = competitors.some(c => Array.isArray(c?.roster) && c.roster.length > 0)
  return hasRosters || hasBoxscore || hasHeaderRoster
}

async function cacheEspnSummary(kv, slug, eventId, log) {
  try {
    const url = `${ESPN_BASE}/${slug}/summary?event=${eventId}`
    const res = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      signal:  AbortSignal.timeout(8_000),
    })
    if (!res.ok) return
    const body = await res.text()
    const parsed = JSON.parse(body)
    if (!hasUsefulSummaryData(parsed)) return
    await kv.set(`espn:summary:${slug}:${eventId}`, body, { ex: SUMMARY_CACHE_TTL })
  } catch (e) {
    log.push(`[espn-summary-cache:${slug}:${eventId}] error=${e.message}`)
  }
}

// ── Résumé auto de match (recap) — identique à generateRecap() dans
// api/cron-goals.js, aucune dépendance crypto, copié tel quel. ──────────────
function extractEspnScorers(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const txt = (d.type?.text ?? '').toLowerCase()
      const id  = String(d.type?.id ?? '')
      return txt.includes('goal') || (txt.includes('penalty') && !txt.includes('miss')) || id === '57' || id === '58' || id === '72'
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

const RECAP_TTL = 60 * 24 * 3600

function generateRecap({ homeTeam, awayTeam, home, away, scorers, cards }) {
  if (home == null || away == null) return null
  const diff    = Math.abs(home - away)
  const total   = home + away
  const winner  = home > away ? 'home' : away > home ? 'away' : null
  const winnerName = winner === 'home' ? homeTeam : winner === 'away' ? awayTeam : null
  const loserName  = winner === 'home' ? awayTeam : winner === 'away' ? homeTeam : null

  let intro
  if (winner === null) {
    intro = total === 0
      ? `${homeTeam} et ${awayTeam} n'ont pas réussi à se départager (0-0).`
      : `${homeTeam} et ${awayTeam} se quittent sur un match nul (${home}-${away}).`
  } else if (diff >= 3) {
    intro = `${winnerName} s'impose largement face à ${loserName} (${home}-${away}).`
  } else if (diff === 2) {
    intro = `${winnerName} prend le dessus sur ${loserName} (${home}-${away}).`
  } else {
    intro = `${winnerName} s'impose de justesse face à ${loserName} (${home}-${away}).`
  }

  const sortedGoals = [...(scorers ?? [])].sort((a, b) => parseMin(a.minute) - parseMin(b.minute))
  const lastGoal = sortedGoals[sortedGoals.length - 1]
  if (winner && diff === 1 && lastGoal && parseMin(lastGoal.minute) >= 80 && lastGoal.team === winner) {
    intro += ` Le but décisif est tombé tardivement, à la ${lastGoal.minute}.`
  }
  if (winner && sortedGoals.length >= 2 && sortedGoals[0].team !== winner) {
    intro += ` ${winnerName} a renversé la situation après avoir été mené.`
  }
  if (total >= 5) intro += ' Un match spectaculaire, riche en buts.'

  let scorersLine = ''
  if (sortedGoals.length) {
    const label = g => `${g.name} (${g.minute}${g.ownGoal ? ', csc' : g.penaltyKick ? ', pen' : ''})`
    scorersLine = `Buteurs : ${sortedGoals.map(label).join(', ')}.`
  }

  const reds = (cards ?? []).filter(c => c.red)
  let cardsLine = ''
  if (reds.length === 1) {
    const teamName = reds[0].team === 'home' ? homeTeam : awayTeam
    cardsLine = `${teamName} a terminé la rencontre à 10 après le carton rouge de ${reds[0].name} (${reds[0].minute}).`
  } else if (reds.length > 1) {
    cardsLine = `La rencontre a été marquée par ${reds.length} exclusions.`
  }

  return [intro, scorersLine, cardsLine].filter(Boolean).join(' ')
}

// ── Envoi (relais Vercel) ─────────────────────────────────────────────────
// Remplace sendDeduped()+sendPushToMatch() de api/cron-goals.js : le dédup
// (SET NX) reste ici (pur Redis, gratuit) — Vercel n'est appelé QUE si ce
// Worker vient d'acquérir la clé de dédup pour de vrai, jamais pour un
// événement déjà notifié. Vercel ne fait plus que le travail réellement
// coûteux (charger les abonnés, chiffrer, envoyer).
async function notifyVercel(env, dedupKey, payload, slug, options = {}, log = null, ttl = 3 * 3600) {
  try {
    const acquired = await env._kv.set(dedupKey, '1', { ex: ttl, nx: true })
    if (!acquired) return
  } catch { return }
  try {
    const res = await fetch(`${env.VERCEL_NOTIFY_URL}?secret=${encodeURIComponent(env.CRON_SECRET)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'notify', payload, slug, options }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) log?.push(`[notify→vercel] status=${res.status}`)
  } catch (e) {
    log?.push(`[notify→vercel] error=${e.message}`)
  }
}

// Ticker live (score en direct) : PAS de dédup (même tag remplace côté SW à
// chaque minute, voir api/cron-goals.js d'origine), donc appelle Vercel
// directement sans passer par notifyVercel() (qui exige une clé de dédup).
async function pushLiveTicker(env, payload, slug, log) {
  try {
    const res = await fetch(`${env.VERCEL_NOTIFY_URL}?secret=${encodeURIComponent(env.CRON_SECRET)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'notify', payload, slug, options: { onlyFavorites: true, urgency: 'high' } }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) log?.push(`[ticker→vercel] status=${res.status}`)
  } catch (e) {
    log?.push(`[ticker→vercel] error=${e.message}`)
  }
}

// ── Une passe complète (équivalent runOnePass() de api/cron-goals.js) ──────
async function runOnePass(env) {
  const kv = env._kv
  const log      = []
  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))

  const emptyDayKey = 'cron:emptyDay'
  let knownEmpty = false
  try { knownEmpty = !!(await kv.get(emptyDayKey)) } catch {}
  if (knownEmpty) {
    return { events: 0, log: ['jour sans match connu (re-check <20min) — fetch ESPN sauté'] }
  }

  const NEXT_CHECK_BUFFER_MS = 90 * 60 * 1000
  const NEXT_CHECK_MAX_MS    = 25 * 60 * 1000
  const nextCheckKey = 'cron:nextCheck'
  let skipUntil = null
  try { skipUntil = await kv.get(nextCheckKey) } catch {}
  if (skipUntil && Number(skipUntil) > now.getTime()) {
    return { events: 0, log: [`aucun match en direct/imminent — fetch ESPN sauté`] }
  }

  const allResults = await Promise.allSettled(
    ESPN_SLUGS.flatMap(slug => [
      fetchEspnEvents(slug, today,     log).then(evts => evts.map(e => ({ slug, evt: e }))),
      fetchEspnEvents(slug, yesterday, log).then(evts => evts.map(e => ({ slug, evt: e }))),
    ])
  )
  const allEvents = allResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])

  const espnFetchFailed = log.some(l => /^\[espn:.*\] error=/.test(l))
  if (allEvents.length === 0 && !espnFetchFailed) {
    try { await kv.set(emptyDayKey, '1', { ex: 20 * 60 }) } catch {}
  }

  if (allEvents.length > 0 && !espnFetchFailed) {
    const anyLive = allEvents.some(({ evt }) =>
      LIVE_ESPN.has(normalizeEspnStatus(evt.competitions?.[0]?.status)))
    if (!anyLive) {
      const upcomingKickoffs = allEvents
        .filter(({ evt }) => normalizeEspnStatus(evt.competitions?.[0]?.status) === 'STATUS_SCHEDULED')
        .map(({ evt }) => Date.parse(evt.date))
        .filter(t => Number.isFinite(t))
      const nextKickoff = upcomingKickoffs.length ? Math.min(...upcomingKickoffs) : null
      const farEnough = nextKickoff == null || (nextKickoff - now.getTime()) > NEXT_CHECK_BUFFER_MS
      if (farEnough) {
        const skipCandidate = nextKickoff != null
          ? Math.min(nextKickoff - NEXT_CHECK_BUFFER_MS, now.getTime() + NEXT_CHECK_MAX_MS)
          : now.getTime() + NEXT_CHECK_MAX_MS
        try { await kv.set(nextCheckKey, skipCandidate, { ex: Math.ceil(NEXT_CHECK_MAX_MS / 1000) + 60 }) } catch {}
      }
    }
  }

  const hasWc = allEvents.some(({ slug }) => slug === 'fifa.world')
  const fifaLiveMatches = hasWc ? await fetchFifaLiveMatches(kv, log) : []

  const pendingSummaryFetches = []

  for (const { slug, evt } of allEvents) {
   try {
    const comp = evt.competitions?.[0]
    if (!comp) continue

    let   status   = normalizeEspnStatus(comp.status)
    const homeC    = comp.competitors?.find(c => c.homeAway === 'home')
    const awayC    = comp.competitors?.find(c => c.homeAway === 'away')
    if (!homeC || !awayC) continue

    let   home     = parseInt(homeC.score ?? '0', 10) || 0
    let   away     = parseInt(awayC.score ?? '0', 10) || 0
    const homeTeam = t(homeC.team?.shortDisplayName ?? homeC.team?.displayName ?? '?')
    const awayTeam = t(awayC.team?.shortDisplayName ?? awayC.team?.displayName ?? '?')
    const eventId  = evt.id

    if (slug === 'fifa.world' && fifaLiveMatches.length > 0) {
      const rawHome = homeC.team?.displayName ?? homeC.team?.shortDisplayName ?? ''
      const rawAway = awayC.team?.displayName ?? awayC.team?.shortDisplayName ?? ''
      const fifaMatch = fifaLiveMatches.find(m => {
        const homeNames = fifaTeamNamesAll(m.HomeTeam)
        const awayNames = fifaTeamNamesAll(m.AwayTeam)
        return homeNames.some(n => fuzzyTeamFifa(rawHome, n)) && awayNames.some(n => fuzzyTeamFifa(rawAway, n))
      })
      if (fifaMatch) {
        const fifaStatus = fifaEffectiveStatus(fifaMatch)
        if (status === 'STATUS_SCHEDULED' && fifaStatus) {
          status = fifaStatus
          log.push(`[fifa-override:${eventId}] ESPN=SCHEDULED → FIFA=${fifaStatus}`)
        } else if (status === 'STATUS_IN_PROGRESS' && fifaStatus === 'STATUS_HALFTIME') {
          status = 'STATUS_HALFTIME'
          log.push(`[fifa-override:${eventId}] ESPN=IN_PROGRESS → FIFA=HALFTIME`)
        } else if (status === 'STATUS_SHOOTOUT' && fifaConfirmsShootoutOver(fifaMatch)) {
          status = 'STATUS_FINAL_PEN'
          log.push(`[fifa-override:${eventId}] ESPN=STATUS_SHOOTOUT → FIFA=FINAL`)
        }
        const fh = fifaMatch.HomeTeam?.Score
        const fa = fifaMatch.AwayTeam?.Score
        if (typeof fh === 'number') home = Math.max(home, fh)
        if (typeof fa === 'number') away = Math.max(away, fa)
      }
    }

    const score    = `${home}-${away}`
    const scoreStr = `${home} – ${away}`

    if (LIVE_ESPN.has(status)) {
      pendingSummaryFetches.push(cacheEspnSummary(kv, slug, eventId, log))
    }

    // 🔴 Coup d'envoi
    const notPostponed = status !== 'STATUS_POSTPONED' && status !== 'STATUS_CANCELED'
    if (LIVE_ESPN.has(status) && notPostponed) {
      await notifyVercel(env, `push:espn:ko:${eventId}`,
        { title: "🔴 Coup d'envoi !", body: `${homeTeam} – ${awayTeam}`, url: '/live' }, slug, {}, log, 6 * 3600)
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} KO (confirmé ESPN)`)
    }

    if (status === 'STATUS_SCHEDULED' && notPostponed) continue

    const stateKey  = `cron:espn:${eventId}`
    let   prevState = null
    try { prevState = await kv.get(stateKey) } catch {}
    const [prevStatus = null, prevScore = null] = prevState ? prevState.split('|') : []

    try { await kv.set(stateKey, `${status}|${score}`, { ex: 12 * 3600 }) } catch {}

    if (prevState === null) {
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} baseline ${status}|${score}`)
      try { await kv.set(`goalTrack:${eventId}`, JSON.stringify({ home, away }), { ex: 12 * 3600 }) } catch {}
      continue
    }

    if (status !== prevStatus) {
      log.push(`[espn:${slug}:${eventId}] ${homeTeam}-${awayTeam} transition ${prevStatus} → ${status}`)
    }

    const steadyHalftime = prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME'

    // ⚽ But (+ ❌ but annulé) — même state machine que api/cron-goals.js
    if (LIVE_ESPN.has(prevStatus) || LIVE_ESPN.has(status)) {
      const lockKey = `goalLock:${eventId}`
      const lockAcquired = await kv.set(lockKey, '1', { px: 5_000, nx: true }).catch(() => null)
      if (!lockAcquired) {
        log.push(`[espn:${slug}:${eventId}] verrou but déjà pris — passe suivante`)
      } else {
        const trackKey = `goalTrack:${eventId}`
        let track = null
        try { track = await kv.get(trackKey) } catch {}
        track = track ? (typeof track === 'string' ? JSON.parse(track) : track) : { home, away }

        const sides = []
        if (home > track.home) sides.push('home')
        if (away > track.away) sides.push('away')

        let trackChanged = false

        const cancelledSides = []
        if (home < track.home) cancelledSides.push('home')
        if (away < track.away) cancelledSides.push('away')

        for (const side of cancelledSides) {
          const scoringTeam  = side === 'home' ? homeTeam : awayTeam
          const newCount     = side === 'home' ? home : away
          const prevCount    = track[side]
          log.push(`[espn:${slug}:${eventId}] BUT ANNULÉ ${side} ${prevCount}→${newCount}`)
          await notifyVercel(env, `push:espn:goalcancel:${eventId}:${side}:${newCount}`,
            { title: `❌ But annulé (${scoringTeam})`, body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live', matchId: eventId, tag: `goal-cancel-${eventId}-${side}-${newCount}` }, slug, {}, log)
          for (let i = newCount; i < prevCount; i++) {
            try { await kv.del(`push:espn:goal:${eventId}:${side}:${i + 1}`) } catch {}
          }
          track[side] = newCount
          trackChanged = true
        }

        for (const side of sides) {
          const targetCount = side === 'home' ? home : away
          if (steadyHalftime) { track[side] = targetCount; trackChanged = true; continue }

          const scoringTeam = side === 'home' ? homeTeam : awayTeam
          const goalScorers = extractEspnScorers(comp, homeC.team?.id)
            .filter(g => g.team === side)
            .sort((a, b) => parseMin(a.minute) - parseMin(b.minute))

          while (track[side] < targetCount) {
            const goalIndex = track[side]
            const scorer     = goalScorers[goalIndex] ?? null
            const scorerSuffix = scorer ? (scorer.ownGoal ? ', csc' : scorer.penaltyKick ? ', pen' : '') : ''
            const minuteText   = scorer ? minuteLabel(scorer.minute) : ''
            const goalTitle    = `⚽ But pour ${scoringTeam} !`
            const scorerLine   = scorer
              ? `${scorer.name}${scorerSuffix}${minuteText ? ` ${minuteText}` : ''}`
              : 'But marqué'
            const goalBody     = `${scorerLine}\n${homeTeam} ${scoreStr} ${awayTeam}`

            log.push(`[espn:${slug}:${eventId}] BUT ${side} ${goalIndex + 1}/${targetCount}`)
            await notifyVercel(env, `push:espn:goal:${eventId}:${side}:${goalIndex + 1}`,
              { title: goalTitle, body: goalBody, url: '/live', matchId: eventId, tag: `goal-${eventId}-${side}-${goalIndex + 1}` }, slug, {}, log)
            track[side]++
            trackChanged = true
          }
        }

        if (trackChanged) {
          try { await kv.set(trackKey, JSON.stringify(track), { ex: 12 * 3600 }) } catch {}
        }
      }
    }

    // 🟥 Carton rouge
    if (LIVE_ESPN.has(status) || LIVE_ESPN.has(prevStatus)) {
      const reds = extractEspnCards(comp, homeC.team?.id).filter(c => c.red)
        .sort((a, b) => parseMin(a.minute) - parseMin(b.minute))
      const redsBySide = { home: reds.filter(c => c.team === 'home'), away: reds.filter(c => c.team === 'away') }

      const cardTrackKey = `cardTrack:${eventId}`
      let cardTrack = null
      try { cardTrack = await kv.get(cardTrackKey) } catch {}
      cardTrack = cardTrack ? (typeof cardTrack === 'string' ? JSON.parse(cardTrack) : cardTrack) : { home: 0, away: 0 }
      let cardTrackChanged = false

      for (const side of ['home', 'away']) {
        const list = redsBySide[side]
        while (cardTrack[side] < list.length) {
          const card       = list[cardTrack[side]]
          const teamName   = side === 'home' ? homeTeam : awayTeam
          const minuteText = minuteLabel(card.minute)
          log.push(`[espn:${slug}:${eventId}] carton rouge ${side} ${card.name}`)
          await notifyVercel(env, `push:espn:red:${eventId}:${side}:${cardTrack[side] + 1}`,
            { title: '🟥 Carton rouge', body: `${card.name} (${teamName})${minuteText ? ` — ${minuteText}` : ''}`, url: '/live' }, slug, {}, log)
          cardTrack[side]++
          cardTrackChanged = true
        }
      }
      if (cardTrackChanged) {
        try { await kv.set(cardTrackKey, JSON.stringify(cardTrack), { ex: 12 * 3600 }) } catch {}
      }
    }

    // ⏸ Mi-temps
    if (LIVE_ESPN.has(prevStatus) && prevStatus !== 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME') {
      log.push(`[espn:${slug}:${eventId}] mi-temps`)
      await notifyVercel(env, `push:espn:ht:${eventId}`,
        { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, {}, log)
    }

    // ▶️ Reprise 2ème MT
    if (prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_IN_PROGRESS') {
      log.push(`[espn:${slug}:${eventId}] reprise`)
      await notifyVercel(env, `push:espn:2h:${eventId}`,
        { title: '▶️ Reprise !', body: `2ème MT · ${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, {}, log)
    }

    // 🏁 Fin de match
    if (LIVE_ESPN.has(prevStatus) && FINAL_ESPN.has(status)) {
      log.push(`[espn:${slug}:${eventId}] FT`)
      await notifyVercel(env, `push:espn:ft:${eventId}`,
        { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, {}, log)
      await cacheEspnSummary(kv, slug, eventId, log)
    }

    // 📝 Résumé auto — écrit directement en Redis, aucun appel Vercel
    if (FINAL_ESPN.has(status)) {
      try {
        const already = await kv.get(`recap:${eventId}`)
        if (!already) {
          const scorers = extractEspnScorers(comp, homeC.team?.id)
          const cards   = extractEspnCards(comp, homeC.team?.id)
          const recap   = generateRecap({ homeTeam, awayTeam, home, away, scorers, cards })
          if (recap) {
            await kv.set(`recap:${eventId}`, recap, { ex: RECAP_TTL })
            log.push(`[recap:${eventId}] généré`)
          }
        }
      } catch (e) {
        log.push(`[recap:${eventId}] error=${e.message}`)
      }
    }

    // 📊 Ticker "score en direct" — pas de dédup (même tag, remplace côté SW)
    if (LIVE_ESPN.has(status)) {
      const mLabel = status === 'STATUS_HALFTIME' ? 'Mi-temps' : `${comp.status?.displayClock ?? ''}`.trim()
      await pushLiveTicker(env, {
        title: `${homeTeam} ${scoreStr} ${awayTeam}`,
        body:  mLabel ? `⏱ ${mLabel}` : 'En direct',
        url:   '/live',
        matchId: eventId,
        tag:     `live-${eventId}`,
        silent:  true,
        renotify: false,
      }, slug, log)
    }
   } catch (e) {
     log.push(`[espn:${slug}:${evt?.id ?? '?'}] ERREUR match ignoré : ${e.message}`)
   }
  }

  if (pendingSummaryFetches.length > 0) {
    await Promise.allSettled(pendingSummaryFetches)
  }

  return { events: allEvents.length, log }
}

async function handlePass(env) {
  const kv = new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN })
  env._kv = kv
  try { await kv.set('cron:goals:lastRun', Date.now(), { ex: 7 * 24 * 3600 }) } catch {}

  const result = await runOnePass(env)

  try {
    await kv.set('cron:goals:lastResult', JSON.stringify({
      at: Date.now(), events: result.events, source: 'cf-worker',
    }), { ex: 7 * 24 * 3600 })
  } catch {}

  try {
    if (result.log.length) {
      const stamped = result.log.map(l => `${new Date().toISOString()} ${l}`)
      await kv.rpush('cron:goals:logHistory', ...stamped)
      await kv.ltrim('cron:goals:logHistory', -30_000, -1)
      await kv.expire('cron:goals:logHistory', 4 * 24 * 3600)
    }
  } catch {}

  return result
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handlePass(env))
  },
  // Handler HTTP manuel — pratique pour tester/déclencher une passe à la main
  // pendant le déploiement, protégé par le même secret que Vercel.
  async fetch(req, env) {
    const url = new URL(req.url)
    const secret = url.searchParams.get('secret') ?? req.headers.get('x-cron-secret') ?? ''
    if (secret !== env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 })
    }
    const result = await handlePass(env)
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
