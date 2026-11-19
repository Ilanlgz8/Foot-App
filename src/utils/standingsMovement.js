// Flèches ▲▼ du classement (19/11) : évolution de chaque équipe depuis AVANT la dernière journée —
// la même règle que les sites de foot, identique sur tous les téléphones.
// (Avant : comparaison avec la dernière fois que CE téléphone avait ouvert la page → flèches
// différentes d'une visite à l'autre, disparues à la 2e ouverture, agitées pendant le direct.)
//
// Méthode : on recompte, à partir des matchs, le classement d'avant la dernière journée. Pour ne
// JAMAIS afficher une flèche fausse, une équipe n'a de flèche que si notre recomptage retombe
// exactement sur son nombre de matchs joués du classement officiel (sinon : données incomplètes,
// pas de flèche). Les pénalités de points (DNCG…) sont conservées : écart officiel − recompté.
import { finalScore } from './matchUtils'

const STARTED = new Set(['FINISHED', 'IN_PLAY', 'PAUSED'])
const ROUND_GAP_MS = 36 * 3600 * 1000

function teamStats() { return { played: 0, points: 0, gf: 0, ga: 0 } }
function addResult(s, gf, ga) {
  s.played++; s.gf += gf; s.ga += ga
  s.points += gf > ga ? 3 : gf === ga ? 1 : 0
}

// Matchs de la dernière journée commencée. Avec `matchday` (football-data.org) : la journée du
// dernier match commencé. Sinon : le dernier groupe de matchs sans trou de plus de 36 h.
function latestRound(started) {
  if (!started.length) return new Set()
  const sorted = [...started].sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
  const md = sorted[0].matchday
  if (md != null && sorted.every(m => m.matchday != null)) {
    return new Set(sorted.filter(m => m.matchday === md).map(m => m.id))
  }
  const ids = new Set([sorted[0].id])
  for (let i = 1; i < sorted.length; i++) {
    if (new Date(sorted[i - 1].utcDate) - new Date(sorted[i].utcDate) > ROUND_GAP_MS) break
    ids.add(sorted[i].id)
  }
  return ids
}

// rows : lignes officielles ({ position, team, playedGames, points, goalDifference, goalsFor }).
// matches : matchs de la compétition (terminés + en cours). resolveId(team) → id de l'équipe tel
// qu'il apparaît dans matches (ou null). Renvoie Map(row.team.id → delta), delta > 0 = gagné des
// places ; une équipe absente de la Map n'a pas de flèche.
export function computeStandingsMovement(rows, matches, resolveId) {
  const out = new Map()
  if (!rows?.length || !matches?.length) return out
  const idOf = new Map()
  for (const r of rows) { const id = resolveId(r.team); if (id != null) idOf.set(r.team.id, id) }
  const inTable = new Set(idOf.values())
  // Championnat seulement : les matchs de coupe nationale (isCup, mêlés aux matchs du championnat
  // par useTeamForm) et ceux d'une autre saison ne comptent pas (19/11, Bundesliga sans flèches).
  const latestSeason = matches.reduce((acc, m) => (m.season?.startDate && m.season.startDate > acc ? m.season.startDate : acc), '')
  const started = matches.filter(m => STARTED.has(m.status) && !m.isCup
    && (!latestSeason || !m.season?.startDate || m.season.startDate === latestSeason)
    && inTable.has(m.homeTeam?.id) && inTable.has(m.awayTeam?.id)
    && finalScore(m.score).home != null)
  if (!started.length) return out
  const round = latestRound(started)

  const now = new Map(), nowFinished = new Map(), prev = new Map()
  const get = (map, id) => { if (!map.has(id)) map.set(id, teamStats()); return map.get(id) }
  for (const m of started) {
    const { home, away } = finalScore(m.score)
    const h = m.homeTeam.id, a = m.awayTeam.id
    addResult(get(now, h), home, away); addResult(get(now, a), away, home)
    if (m.status === 'FINISHED') { addResult(get(nowFinished, h), home, away); addResult(get(nowFinished, a), away, home) }
    if (!round.has(m.id)) { addResult(get(prev, h), home, away); addResult(get(prev, a), away, home) }
  }

  // Ligne officielle ↔ recomptage : avec le direct (cas football-data.org) ou sans (cas ESPN).
  const consistent = new Set()
  // Rang actuel = ordre des lignes (pas row.position : deux équipes ex aequo peuvent avoir la même
  // position officielle, ce qui décalait une flèche — 19/11, Ligue des champions, 29e ex aequo).
  const prevRows = rows.map((r, idx) => {
    const id = idOf.get(r.team.id)
    const withLive = now.get(id) ?? teamStats()
    const finishedOnly = nowFinished.get(id) ?? teamStats()
    const ref = r.playedGames === withLive.played ? withLive
      : r.playedGames === finishedOnly.played ? finishedOnly : null
    const p = prev.get(id) ?? teamStats()
    if (id != null && ref) consistent.add(r.team.id)
    const adj = ref && typeof r.points === 'number' ? r.points - ref.points : 0
    return { key: r.team.id, pos: idx + 1, played: p.played, points: p.points + adj, gd: p.gf - p.ga, gf: p.gf }
  })
  // Aucune journée avant celle-ci (1re journée) : pas de flèches.
  if (!prevRows.some(r => r.played > 0)) return out
  // Toutes les équipes doivent être recomptées correctement, sinon le classement « d'avant » serait faux.
  if (consistent.size !== rows.length) return out

  prevRows.sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.pos - y.pos)
  prevRows.forEach((r, i) => out.set(r.key, (i + 1) - r.pos))
  return out
}
