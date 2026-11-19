import { describe, it, expect } from 'vitest'
import { buildEloTable, eloProbs, blendWithElo, previousSeasonOf, matchEloProbs, eloTableCached } from './elo'

const team = id => ({ id, name: 'T' + id })
const m = (id, date, h, a, hg, ag, status = 'FINISHED') => ({
  id, utcDate: date, status, homeTeam: team(h), awayTeam: team(a),
  score: { winner: hg > ag ? 'HOME_TEAM' : hg < ag ? 'AWAY_TEAM' : 'DRAW', duration: 'REGULAR', fullTime: { home: hg, away: ag } },
})

describe('elo', () => {
  it('une équipe qui gagne monte, celle qui perd descend', () => {
    const R = buildEloTable([], [m(1, '2025-08-10T15:00:00Z', 1, 2, 3, 0)])
    expect(R.get(1)).toBeGreaterThan(1500)
    expect(R.get(2)).toBeLessThan(1500)
  })
  it('ne compte que les matchs joués avant la date demandée', () => {
    const cur = [m(1, '2025-08-10T15:00:00Z', 1, 2, 3, 0), m(2, '2025-08-20T15:00:00Z', 2, 1, 4, 0)]
    const R = buildEloTable([], cur, '2025-08-15T00:00:00Z')
    expect(R.get(1)).toBeGreaterThan(1500)
  })
  it('promu : niveau des plus faibles de la saison précédente', () => {
    const prev = [m(1, '2024-09-01T15:00:00Z', 1, 2, 2, 0), m(2, '2024-09-08T15:00:00Z', 3, 4, 2, 0)]
    const cur = [m(3, '2025-08-10T15:00:00Z', 1, 9, 0, 0, 'SCHEDULED')]
    const R = buildEloTable(prev, cur)
    expect(R.get(9)).toBeLessThan(1500)
  })
  it('probabilités : somme ≈ 1, domicile favori à niveau égal', () => {
    const p = eloProbs(1500, 1500)
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 5)
    expect(p.home).toBeGreaterThan(p.away)
    const n = eloProbs(1500, 1500, true)
    expect(n.home).toBeCloseTo(n.away, 5)
  })
  it('mélange : % entiers, somme 100', () => {
    const out = blendWithElo({ home: 50, draw: 25, away: 25 }, { home: 0.3, draw: 0.3, away: 0.4 })
    expect(out.home + out.draw + out.away).toBe(100)
    expect(out.away).toBeGreaterThan(25)
    expect(blendWithElo({ home: 50, draw: 25, away: 25 }, null)).toEqual({ home: 50, draw: 25, away: 25 })
  })
  it('saison précédente extraite de l\'historique (juillet → juin)', () => {
    const cur = [m(10, '2025-08-10T15:00:00Z', 1, 2, 1, 0)]
    const hist = [m(1, '2024-09-01T15:00:00Z', 1, 2, 1, 0), m(2, '2023-09-01T15:00:00Z', 1, 2, 1, 0)]
    expect(previousSeasonOf(cur, hist).map(x => x.id)).toEqual([1])
  })
  it('équipe inconnue → pas d\'Elo (modèle maison seul)', () => {
    const cur = [m(1, '2025-08-10T15:00:00Z', 1, 2, 1, 0)]
    expect(matchEloProbs(eloTableCached(cur, []), 1, 99)).toBeNull()
    expect(matchEloProbs(eloTableCached(cur, []), 1, 2)).not.toBeNull()
  })
})
