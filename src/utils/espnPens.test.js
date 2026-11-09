import { describe, it, expect } from 'vitest'
import { normalizeEspnCupEvents } from './espnAdapter'
import { finalScore, matchOutcome } from './matchUtils'

const ev = (status, h, a, hs, as) => ({
  id: '1', date: '2026-11-08T12:15Z', season: { year: 2026, slug: 'fourth-round' },
  competitions: [{
    status: { type: { name: status, state: 'post', completed: true } },
    competitors: [
      { homeAway: 'home', score: h, shootoutScore: hs, winner: hs != null ? hs > as : Number(h) > Number(a), team: { id: '10', displayName: 'Stafford Rangers', name: 'Stafford' } },
      { homeAway: 'away', score: a, shootoutScore: as, winner: as != null ? as > hs : Number(a) > Number(h), team: { id: '20', displayName: 'Grimsby Town', name: 'Grimsby' } },
    ],
  }],
})

describe('ESPN : tirs au but séparés du score', () => {
  it('STATUS_FINAL_PEN : score 120 min + tab à part, vainqueur aux tab', () => {
    const [m] = normalizeEspnCupEvents('PL', [ev('STATUS_FINAL_PEN', '3', '3', 2, 3)])
    expect(m.score.duration).toBe('PENALTY_SHOOTOUT')
    expect(m.score.penalties).toEqual({ home: 2, away: 3 })
    expect(finalScore(m.score)).toEqual({ home: 3, away: 3 })
    expect(matchOutcome(m)).toBe('away')
  })
  it('après prolongation sans tab : EXTRA_TIME', () => {
    const [m] = normalizeEspnCupEvents('PL', [ev('STATUS_FINAL_AET', '2', '3')])
    expect(m.score.duration).toBe('EXTRA_TIME')
    expect(m.score.penalties).toEqual({ home: null, away: null })
  })
  it('temps réglementaire : inchangé', () => {
    const [m] = normalizeEspnCupEvents('PL', [ev('STATUS_FINAL', '1', '0')])
    expect(m.score.duration).toBe('REGULAR')
  })
})
