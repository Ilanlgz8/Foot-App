import { describe, it, expect } from 'vitest'
import { computeStandingsMovement } from './standingsMovement'

const t = id => ({ id, name: 'T' + id })
const m = (id, md, date, h, a, hg, ag, status = 'FINISHED') => ({
  id, matchday: md, utcDate: date, status, homeTeam: t(h), awayTeam: t(a),
  score: { fullTime: { home: hg, away: ag } },
})
// 4 équipes, 2 journées
const matches = [
  m(1, 1, '2026-08-10T15:00:00Z', 1, 2, 2, 0), m(2, 1, '2026-08-10T18:00:00Z', 3, 4, 1, 0),
  m(3, 2, '2026-08-17T15:00:00Z', 4, 1, 3, 0), m(4, 2, '2026-08-17T18:00:00Z', 2, 3, 2, 0),
]
// Après J2 : T1 3 pts (+2-3=-1), T2 3 (2-2=0), T3 3 (1-2=-1), T4 3 (3-1=+2)
const row = (pos, id, played, points, gd, gf) => ({ position: pos, team: t(id), playedGames: played, points, goalDifference: gd, goalsFor: gf })
const rows = [row(1, 4, 2, 3, 2, 3), row(2, 2, 2, 3, 0, 2), row(3, 1, 2, 3, -1, 2), row(4, 3, 2, 3, -1, 1)]
const resolve = team => team.id

describe('computeStandingsMovement', () => {
  it('compare avec le classement d\'avant la dernière journée', () => {
    // Avant J2 : T1 (3, +2) 1er, T3 (3, +1) 2e, T4 (0, -1, 0 bp) / T2 (0, -2) → T4 3e, T2 4e
    const mv = computeStandingsMovement(rows, matches, resolve)
    expect(mv.get(4)).toBe(2)   // 3e → 1er
    expect(mv.get(2)).toBe(2)   // 4e → 2e
    expect(mv.get(1)).toBe(-2)  // 1er → 3e
    expect(mv.get(3)).toBe(-2)  // 2e → 4e
  })
  it('match en direct compté si le classement officiel l\'inclut déjà', () => {
    const live = [...matches, m(5, 3, '2026-08-24T15:00:00Z', 3, 1, 1, 0, 'IN_PLAY')]
    const r = [row(1, 4, 2, 3, 2, 3), row(2, 3, 3, 6, 0, 2), row(3, 2, 2, 3, 0, 2), row(4, 1, 3, 3, -2, 2)]
    const mv = computeStandingsMovement(r, live, resolve)
    expect(mv.get(3)).toBe(2)  // 4e avant J3 → 2e
  })
  it('données incomplètes (matchs joués différents) → aucune flèche plutôt qu\'une fausse', () => {
    const mv = computeStandingsMovement(rows, matches.slice(1), resolve)
    expect(mv.size).toBe(0)
  })
  it('1re journée → pas de flèches', () => {
    const r = [row(1, 1, 1, 3, 2, 2), row(2, 3, 1, 3, 1, 1), row(3, 4, 1, 0, -1, 0), row(4, 2, 1, 0, -2, 0)]
    expect(computeStandingsMovement(r, matches.slice(0, 2), resolve).size).toBe(0)
  })
  it('pénalité de points conservée', () => {
    const r = rows.map(x => x.team.id === 4 ? { ...x, points: 0, position: 4 } : x)
    const mv = computeStandingsMovement(r, matches, resolve)
    expect(mv.get(4)).toBe(0)  // était 4e (−3 pts), reste 4e
  })
  it('sans numéro de journée : regroupement par dates', () => {
    const noMd = matches.map(x => ({ ...x, matchday: undefined }))
    expect(computeStandingsMovement(rows, noMd, resolve).get(4)).toBe(2)
  })
})
