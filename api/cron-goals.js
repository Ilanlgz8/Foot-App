// api/cron/goals.js
// Appelé par cron-job.org toutes les minutes.
// Source : ESPN (primaire — couvre WC 2026 via 'fifa.world' + toutes ligues club)
//          FIFA live (couche rapide additionnelle, WC uniquement — voir plus bas)
//
// Détecte et notifie :
//   ⚽ But         — score change pendant un match en cours
//   🔴 Coup d'envoi — match démarre
//   ⏸  Mi-temps    — pause mi-temps
//   ▶️  Reprise     — reprise 2ème MT
//   🏁 Fin de match — match terminé
//
// ⚠️ FIX retard notif WC (~10min) : ESPN a un lag connu sur le slug 'fifa.world'
// (le statut scoreboard ESPN met du temps à passer SCHEDULED → IN_PROGRESS).
// api/fifa-live.js contourne déjà ça côté affichage live en croisant avec l'API
// FIFA officielle. On applique la même logique ici, uniquement pour les matchs WC :
// si ESPN dit encore SCHEDULED mais que FIFA confirme Period=1 (match démarré),
// on utilise le statut FIFA → notif coup d'envoi immédiate au lieu d'attendre ESPN.
//
// Sécurité : header "x-cron-secret" ou param ?secret= doit matcher CRON_SECRET.

import { Redis } from '@upstash/redis'
import webpush   from 'web-push'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// ── Config ESPN ────────────────────────────────────────────────────────────────
const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
// WC 2026 via 'fifa.world' + toutes compétitions club couvertes par l'app
const ESPN_SLUGS = [
  'fifa.world',          // WC 2026 — ESPN couvre le WC, statuts fiables
  'fra.1',
  'eng.1',
  'esp.1',
  'ger.1',
  'ita.1',
  'uefa.champions',
  'uefa.europa',
  'uefa.europa.conf',
]

const LIVE_ESPN  = new Set([
  'STATUS_IN_PROGRESS',
  'STATUS_HALFTIME',
  'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME',
  'STATUS_OVERTIME',
  'STATUS_SHOOTOUT',
])
const FINAL_ESPN = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME'])

// ── FIFA live — couche rapide WC (même cache Redis que api/fifa-live.js) ───────
const FIFA_LIVE_URL = 'https://api.fifa.com/api/v3/live/football'

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

// MatchStatus : 0=pas commencé 1=en cours 3=terminé
// Period      : 0=pré-match 1=1èreMT 2=2èmeMT 3=pause MT 4=Prol MT1 5=pause Prol 6=Prol MT2 7=TAB 8=FT
// ⚠️ Volontairement PAS de mapping vers STATUS_FINAL ici : FIFA peut retourner un
// faux statut "terminé" lors de transitions normales (VAR, mi-temps) — même limite
// documentée côté client (useLiveMinute.js) contre les faux FT. On ne l'utilise donc
// que pour accélérer la détection du coup d'envoi et de la mi-temps, jamais la fin.
function fifaEffectiveStatus(m) {
  if (m.MatchStatus !== 1 || m.Period === 0) return null
  if (m.Period === 3 || m.Period === 5) return 'STATUS_HALFTIME'
  return 'STATUS_IN_PROGRESS'
}

async function fetchFifaLiveMatches(log) {
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
      signal:  AbortSignal.timeout(6_000),
    })
    if (!res.ok) return []
    const json = await res.json()
    const data = json.Results ?? []
    try { await kv.set('fifa:live', JSON.stringify(data), { ex: 6 }) } catch {}
    return data
  } catch (e) {
    log.push(`[fifa:live] error=${e.message}`)
    return []
  }
}

// ── Traduction noms ESPN → français ───────────────────────────────────────────
const TEAM_FR = {
  // Ligue 1
  'Paris Saint-Germain': 'Paris SG', 'PSG': 'Paris SG',
  'Olympique de Marseille': 'Marseille', 'Olympique Lyonnais': 'Lyon',
  'AS Monaco': 'Monaco', 'LOSC Lille': 'Lille', 'OGC Nice': 'Nice',
  'Stade Rennais': 'Rennes', 'RC Lens': 'Lens', 'Toulouse FC': 'Toulouse',
  'Stade Brestois': 'Brest', 'Nantes': 'Nantes', 'RC Strasbourg': 'Strasbourg',
  'Angers SCO': 'Angers', 'Le Havre AC': 'Le Havre',
  // Premier League
  'Manchester City': 'Man. City', 'Manchester United': 'Man. United',
  'Arsenal': 'Arsenal', 'Liverpool': 'Liverpool', 'Chelsea': 'Chelsea',
  'Tottenham Hotspur': 'Tottenham', 'Newcastle United': 'Newcastle',
  'Aston Villa': 'Aston Villa', 'Brighton & Hove Albion': 'Brighton',
  'West Ham United': 'West Ham', 'Wolverhampton Wanderers': 'Wolves',
  'Crystal Palace': 'C. Palace', 'Nottingham Forest': 'Nott. Forest',
  'Fulham': 'Fulham', 'Brentford': 'Brentford', 'Everton': 'Everton',
  // La Liga
  'Real Madrid': 'Real Madrid', 'FC Barcelona': 'Barcelone', 'Barcelona': 'Barcelone',
  'Atletico Madrid': 'Atl. Madrid', 'Athletic Bilbao': 'Ath. Bilbao',
  'Real Sociedad': 'R. Sociedad', 'Villarreal': 'Villarreal',
  'Sevilla': 'Séville', 'Real Betis': 'Betis', 'Valencia': 'Valence',
  'Rayo Vallecano': 'Rayo', 'Girona': 'Girona',
  // Bundesliga
  'Bayern Munich': 'Bayern', 'Borussia Dortmund': 'Dortmund',
  'RB Leipzig': 'Leipzig', 'Bayer Leverkusen': 'Leverkusen',
  'Eintracht Frankfurt': 'Frankfurt', 'Borussia Mönchengladbach': "M'gladbach",
  'Werder Bremen': 'Werder', 'Union Berlin': 'Union Berlin',
  // Serie A
  'Internazionale': 'Inter', 'Inter Milan': 'Inter',
  'AC Milan': 'Milan', 'Juventus': 'Juventus', 'Napoli': 'Naples',
  'AS Roma': 'Rome', 'Lazio': 'Lazio', 'Atalanta': 'Atalanta',
  // Divers
  'PSV Eindhoven': 'PSV', 'Club Brugge': 'Bruges', 'Ajax': 'Ajax',
  'Porto': 'Porto', 'Benfica': 'Benfica',
}

function t(name) { return TEAM_FR[name] ?? name }

// ── Helpers ────────────────────────────────────────────────────────────────────

function dateStr(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function setupVapid() {
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); return true }
  catch { return false }
}

async function fetchEspnEvents(slug, date, log) {
  try {
    const r = await fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${date}`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!r.ok) { log.push(`[espn:${slug}] status=${r.status}`); return [] }
    const j = await r.json()
    return j.events ?? []
  } catch (e) {
    log.push(`[espn:${slug}] error=${e.message}`)
    return []
  }
}

// ── Push helpers ───────────────────────────────────────────────────────────────

async function sendPushToAll(payload) {
  let subs = []
  try { subs = (await kv.smembers('push:subscriptions')) ?? [] } catch { return 0 }
  if (!subs.length) return 0

  const payloadStr = JSON.stringify(payload)
  const stale = []
  let sent = 0

  await Promise.allSettled(subs.map(async subRaw => {
    let sub
    try { sub = typeof subRaw === 'string' ? JSON.parse(subRaw) : subRaw }
    catch { stale.push(subRaw); return }
    try {
      await webpush.sendNotification(sub, payloadStr, { TTL: 3600 })
      sent++
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404)
        stale.push(typeof subRaw === 'string' ? subRaw : JSON.stringify(subRaw))
    }
  }))

  if (stale.length) {
    try { await Promise.all(stale.map(s => kv.srem('push:subscriptions', s))) } catch {}
  }
  return sent
}

async function sendDeduped(dedupKey, payload, ttl = 3 * 3600) {
  try {
    const already = await kv.get(dedupKey)
    if (already) return 0
    await kv.set(dedupKey, '1', { ex: ttl })
  } catch { return 0 }
  return sendPushToAll(payload)
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const secret     = req.headers['x-cron-secret'] ?? req.query.secret ?? ''
  const bearerAuth = req.headers['authorization'] ?? ''
  // Accepte : header x-cron-secret (cron-job.org), ?secret= (debug),
  //           ou Authorization: Bearer <CRON_SECRET> (Vercel Cron natif)
  const authorized =
    process.env.CRON_SECRET && (
      secret        === process.env.CRON_SECRET ||
      bearerAuth    === `Bearer ${process.env.CRON_SECRET}`
    )
  if (!authorized)
    return res.status(401).json({ error: 'Non autorisé' })

  if (!setupVapid())
    return res.status(503).json({ error: 'VAPID non configuré' })

  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))
  let notifsSent  = 0
  const log       = []

  // Fetch tous les slugs ESPN en parallèle (aujourd'hui + hier pour les matchs tardifs)
  const allResults = await Promise.allSettled(
    ESPN_SLUGS.flatMap(slug => [
      fetchEspnEvents(slug, today,     log).then(evts => evts.map(e => ({ slug, evt: e }))),
      fetchEspnEvents(slug, yesterday, log).then(evts => evts.map(e => ({ slug, evt: e }))),
    ])
  )

  const allEvents = allResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  log.push(`[espn] total events=${allEvents.length}`)

  // FIFA live — fetché une seule fois, utilisé pour accélérer la détection WC (voir plus bas)
  const hasWc = allEvents.some(({ slug }) => slug === 'fifa.world')
  const fifaLiveMatches = hasWc ? await fetchFifaLiveMatches(log) : []

  for (const { slug, evt } of allEvents) {
    const comp = evt.competitions?.[0]
    if (!comp) continue

    let   status   = comp.status?.type?.name ?? ''
    const homeC    = comp.competitors?.find(c => c.homeAway === 'home')
    const awayC    = comp.competitors?.find(c => c.homeAway === 'away')
    if (!homeC || !awayC) continue

    let   home     = parseInt(homeC.score ?? '0', 10) || 0
    let   away     = parseInt(awayC.score ?? '0', 10) || 0
    const homeTeam = t(homeC.team?.shortDisplayName ?? homeC.team?.displayName ?? '?')
    const awayTeam = t(awayC.team?.shortDisplayName ?? awayC.team?.displayName ?? '?')
    const eventId  = evt.id

    // ── FIX retard notif WC : ESPN lag ~10min sur le statut du slug 'fifa.world' ──
    // Si ESPN dit encore SCHEDULED mais que l'API FIFA officielle confirme que le
    // match a commencé (Period != 0), on bascule immédiatement en IN_PROGRESS →
    // notif coup d'envoi (et détection de buts) sans attendre ESPN.
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
          log.push(`[fifa-override:${eventId}] ESPN=SCHEDULED → FIFA=${fifaStatus} (KO anticipé)`)
        } else if (status === 'STATUS_IN_PROGRESS' && fifaStatus === 'STATUS_HALFTIME') {
          // ESPN n'a pas encore basculé sur la pause → FIFA la confirme plus vite.
          // (Jamais l'inverse : on ne fait pas confiance à FIFA pour repasser
          // HALFTIME → IN_PROGRESS ni pour déclarer une fin de match.)
          status = 'STATUS_HALFTIME'
          log.push(`[fifa-override:${eventId}] ESPN=IN_PROGRESS → FIFA=HALFTIME (mi-temps anticipée)`)
        }
        const fh = fifaMatch.HomeTeam?.Score
        const fa = fifaMatch.AwayTeam?.Score
        if (typeof fh === 'number') home = Math.max(home, fh)
        if (typeof fa === 'number') away = Math.max(away, fa)
      }
    }

    const score    = `${home}-${away}`
    const scoreStr = `${home} – ${away}`

    const stateKey  = `cron:espn:${eventId}`
    let   prevState = null
    try { prevState = await kv.get(stateKey) } catch {}
    const [prevStatus = null, prevScore = null] = prevState ? prevState.split('|') : []

    // Sauvegarder état courant (TTL 12h)
    try { await kv.set(stateKey, `${status}|${score}`, { ex: 12 * 3600 }) } catch {}

    // Premier poll → baseline, pas de notif.
    // Exception : si le match est déjà en cours ET a démarré il y a < 5min
    // (2 matchs simultanés : le 2ème n'avait pas de baseline au 1er cron → KO manqué)
    if (prevState === null) {
      if (LIVE_ESPN.has(status) && !FINAL_ESPN.has(status)) {
        const matchStart = evt.date ? new Date(evt.date).getTime() : null
        const freshKickoff = matchStart && (Date.now() - matchStart < 5 * 60_000)
        if (freshKickoff) {
          log.push(`[espn:${slug}:${eventId}] KO catch-up (~${Math.round((Date.now() - matchStart) / 60_000)}min)`)
          const sent = await sendDeduped(`push:espn:ko:${eventId}`,
            { title: "🔴 Coup d'envoi !", body: `${homeTeam} – ${awayTeam}`, url: '/live' })
          if (sent > 0) notifsSent++
        }
      }
      log.push(`[espn:${slug}:${eventId}] baseline ${status}|${score}`)
      continue
    }

    // 🔴 Coup d'envoi
    if (!LIVE_ESPN.has(prevStatus) && !FINAL_ESPN.has(prevStatus) && status === 'STATUS_IN_PROGRESS') {
      log.push(`[espn:${slug}:${eventId}] KO`)
      const sent = await sendDeduped(`push:espn:ko:${eventId}`,
        { title: '🔴 Coup d\'envoi !', body: `${homeTeam} – ${awayTeam}`, url: '/live' })
      if (sent > 0) notifsSent++
    }

    // ⏸ Mi-temps
    if (LIVE_ESPN.has(prevStatus) && prevStatus !== 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME') {
      log.push(`[espn:${slug}:${eventId}] mi-temps`)
      const sent = await sendDeduped(`push:espn:ht:${eventId}`,
        { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
      if (sent > 0) notifsSent++
    }

    // ▶️ Reprise 2ème MT
    if (prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_IN_PROGRESS') {
      log.push(`[espn:${slug}:${eventId}] reprise`)
      const sent = await sendDeduped(`push:espn:2h:${eventId}`,
        { title: '▶️ Reprise !', body: `2ème MT · ${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
      if (sent > 0) notifsSent++
    }

    // 🏁 Fin de match — garde anti-faux FT : ESPN STATUS_FINAL est fiable, on le prend tel quel
    if (LIVE_ESPN.has(prevStatus) && FINAL_ESPN.has(status)) {
      log.push(`[espn:${slug}:${eventId}] FT`)
      const sent = await sendDeduped(`push:espn:ft:${eventId}`,
        { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' })
      if (sent > 0) notifsSent++
    }

    // ⚽ But — score change pendant un match en cours (pas pendant halftime)
    if (
      LIVE_ESPN.has(status) &&
      status !== 'STATUS_HALFTIME' &&
      prevScore !== null &&
      prevScore !== score
    ) {
      log.push(`[espn:${slug}:${eventId}] BUT ${prevScore} → ${score}`)
      const sent = await sendDeduped(`push:espn:goal:${eventId}:${score}`,
        { title: '⚽ But !', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live', matchId: eventId })
      if (sent > 0) notifsSent++
    }
  }

  return res.status(200).json({
    ok: true,
    slugs: ESPN_SLUGS.length,
    events: allEvents.length,
    notifsSent,
    log,
  })
}
