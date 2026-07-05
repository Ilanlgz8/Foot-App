// Récupère les détails ESPN d'un match terminé (buteurs + stats) à la demande.
//
// Stratégie en 2 passes :
//   1. Scoreboard (dates=YYYYMMDD) → trouve l'event + son ID ESPN
//   2. Summary (?eventId=XXX)      → détails complets : buts, stats, possession
//
// Le summary ESPN est la seule source fiable de buts pour les matchs passés.
// FD.org ne fournit pas de buts pour toutes les compétitions sur le free tier.

import { useQuery } from '@tanstack/react-query'
import { COMP_ESPN, fuzzyTeam } from './useLiveMinute'

function espnDate(match) {
  if (!match?.utcDate) return null
  const d = new Date(match.utcDate)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

function isMatchToday(match) {
  if (!match?.utcDate) return false
  const d = new Date(match.utcDate), t = new Date()
  return d.getUTCFullYear() === t.getUTCFullYear() && d.getUTCMonth() === t.getUTCMonth() && d.getUTCDate() === t.getUTCDate()
}

/** Passe 1 : trouve l'event ESPN dans le scoreboard et retourne { eventId, homeTeamId }. */
function findEspnEvent(json, match) {
  for (const evt of json.events ?? []) {
    const comp  = evt.competitions?.[0]
    if (!comp) continue
    const homeC = (comp.competitors ?? []).find(c => c.homeAway === 'home')
    const awayC = (comp.competitors ?? []).find(c => c.homeAway === 'away')
    if (!homeC || !awayC) continue
    const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
    const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
    const fdHome   = match.homeTeam?.name ?? match.homeTeam?.shortName ?? ''
    const fdAway   = match.awayTeam?.name ?? match.awayTeam?.shortName ?? ''
    if (fuzzyTeam(fdHome, espnHome) && fuzzyTeam(fdAway, espnAway)) {
      return { eventId: evt.id, homeTeamId: homeC.team?.id }
    }
  }
  return null
}

/** Passe 2 : extrait buts + stats depuis la réponse summary ESPN. */
function extractFromSummary(json, homeTeamId) {
  const comp  = json.header?.competitions?.[0] ?? json.competitions?.[0]
  const homeC = (comp?.competitors ?? []).find(c => c.homeAway === 'home') ??
                (comp?.competitors ?? []).find(c => c.team?.id === homeTeamId)
  const awayC = (comp?.competitors ?? []).find(c => c.homeAway === 'away') ??
                (comp?.competitors ?? []).find(c => c.team?.id !== homeTeamId)

  // ── Buts depuis les plays ESPN ──
  const scorers = []
  for (const play of json.plays ?? []) {
    if (play.type?.id !== '57' && play.scoringPlay !== true) continue
    const ath = play.participants?.[0]?.athlete ?? play.athletes?.[0]
    scorers.push({
      name:        ath?.shortName ?? ath?.displayName ?? '?',
      minute:      play.clock?.displayValue ?? '',
      team:        play.team?.id === homeC?.team?.id ? 'home' : 'away',
      ownGoal:     play.ownGoal     ?? false,
      penaltyKick: play.penaltyKick ?? false,
    })
  }

  // ── Buts depuis gameInfo (fallback) ──
  if (scorers.length === 0) {
    const details = comp?.details ?? []
    for (const d of details) {
      if (d.type?.text !== 'Goal' && d.type?.id !== '57') continue
      const ath = d.athletesInvolved?.[0]
      scorers.push({
        name:        ath?.shortName ?? ath?.displayName ?? '?',
        minute:      d.clock?.displayValue ?? '',
        team:        d.team?.id === homeC?.team?.id ? 'home' : 'away',
        ownGoal:     d.ownGoal     ?? false,
        penaltyKick: d.penaltyKick ?? false,
      })
    }
  }

  // ── Cartons (jaune/rouge) — mêmes ids ESPN vérifiés (93=Red Card, 94=Yellow Card).
  // Pas d'équivalent dans json.plays pour le soccer, uniquement dans comp.details.
  const cards = []
  for (const d of (comp?.details ?? [])) {
    const id = String(d.type?.id ?? '')
    if (id !== '93' && id !== '94') continue
    const ath = d.athletesInvolved?.[0]
    cards.push({
      name:   ath?.shortName ?? ath?.displayName ?? '?',
      minute: d.clock?.displayValue ?? '',
      team:   d.team?.id === homeC?.team?.id ? 'home' : 'away',
      red:    d.redCard === true || id === '93',
    })
  }

  // ── Stats ──
  const getStat = (c, name) => {
    if (!c) return null
    const found = (c.statistics ?? []).find(s => s.name === name)
    return found != null ? (parseFloat(found.displayValue) || 0) : null
  }
  const homePoss = getStat(homeC, 'possessionPct')
  const awayPoss = getStat(awayC, 'possessionPct')

  return {
    scorers,
    cards,
    stats: (homePoss !== null || awayPoss !== null) ? {
      home: { poss: homePoss, shots: getStat(homeC, 'totalShots'), shotsOnTarget: getStat(homeC, 'shotsOnTarget'), corners: getStat(homeC, 'corners'), fouls: getStat(homeC, 'fouls'), offside: getStat(homeC, 'offsides') },
      away: { poss: awayPoss, shots: getStat(awayC, 'totalShots'), shotsOnTarget: getStat(awayC, 'shotsOnTarget'), corners: getStat(awayC, 'corners'), fouls: getStat(awayC, 'fouls'), offside: getStat(awayC, 'offsides') },
    } : null,
  }
}

// Extrait UNIQUEMENT les minutes de but (pas le côté home/away, pas le nom du
// buteur) d'une réponse summary ESPN — utilisé par useGoalsByMinute.js pour
// agréger la répartition des buts par minute sur toute une compétition, sans
// dupliquer la logique déjà écrite dans extractFromSummary ci-dessus.
export function extractGoalMinutes(json) {
  const comp = json?.header?.competitions?.[0] ?? json?.competitions?.[0]
  const minutes = []
  for (const play of json?.plays ?? []) {
    if (play.type?.id !== '57' && play.scoringPlay !== true) continue
    if (play.clock?.displayValue) minutes.push(play.clock.displayValue)
  }
  if (minutes.length === 0) {
    for (const d of (comp?.details ?? [])) {
      if (d.type?.text !== 'Goal' && d.type?.id !== '57') continue
      if (d.clock?.displayValue) minutes.push(d.clock.displayValue)
    }
  }
  return minutes
}

export function useEspnMatchDetail(match, compId, enabled = true) {
  const slug = COMP_ESPN[compId] ?? COMP_ESPN[match?.competition?.id] ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['espnMatchDetail', match?.id, slug],
    queryFn: async () => {
      if (!slug || !match) return null

      // ── Passe 1 : scoreboard → event ID ──
      const dateParam = isMatchToday(match) ? '' : `&dates=${espnDate(match)}`
      const res1 = await fetch(`/espn?slug=${slug}${dateParam}`)
      if (!res1.ok) return null
      const board = await res1.json()

      const found = findEspnEvent(board, match)
      if (!found) return null   // match non trouvé dans le scoreboard

      // ── Passe 2 : summary → buts + stats complets ──
      const res2 = await fetch(`/espn?slug=${slug}&eventId=${found.eventId}`)
      if (!res2.ok) return null
      const summary = await res2.json()

      const result = extractFromSummary(summary, found.homeTeamId)

      // Persister pour prochaines ouvertures
      try {
        localStorage.setItem(`foot_espn_${match.id}`, JSON.stringify(result))
      } catch {}

      return result
    },
    enabled:   enabled && !!slug && !!match?.id,
    staleTime: 60 * 60_000,   // 1h — match terminé, données stables
    retry:     1,
    retryDelay: 2_000,
  })

  return { espnData: data ?? null, loading: isLoading }
}
