import { describe, it, expect } from 'vitest'
import { parisToUtc, normalizeFffMatch, normalizeFffStandings, prettyName, L3_TEAM_ID_OFFSET } from './ligue3Parse'
import { l3Status, buildLigue3FormMap } from './ligue3'

describe('Ligue 3 (API FFF)', () => {
  it('convertit l’heure de Paris en UTC (hiver et été)', () => {
    expect(parisToUtc('2026-11-07T00:00:00+00:00', '14H45')).toBe('2026-11-07T13:45:00.000Z')
    expect(parisToUtc('2026-08-07T00:00:00+00:00', '20H45')).toBe('2026-08-07T18:45:00.000Z')
  })

  it('normalise un match terminé et un match à venir', () => {
    const base = {
      ma_no: 1, date: '2026-11-07T00:00:00+00:00', time: '14H45', poule_journee: { number: 12 },
      home: { short_name: 'FC ROUEN 1899', club: { cl_no: 184, logo: 'x.jpg' } },
      away: { short_name: 'SC BASTIA', club: { cl_no: 3225 } },
    }
    const fin = normalizeFffMatch({ ...base, home_score: 2, away_score: 0 })
    expect(fin.status).toBe('FINISHED')
    expect(fin.homeTeam.name).toBe('FC Rouen')
    expect(fin.awayTeam.id).toBe(L3_TEAM_ID_OFFSET + 3225)
    expect(fin.score.fullTime).toEqual({ home: 2, away: 0 })
    const todo = normalizeFffMatch({ ...base, home_score: null, away_score: null })
    expect(todo.status).toBe('TIMED')
    expect(l3Status(todo, Date.parse('2026-11-07T12:00:00Z'))).toBe('TIMED')
    expect(l3Status(todo, Date.parse('2026-11-07T15:00:00Z'))).toBe('AWAITING_RESULT')
  })

  it('classement et forme', () => {
    const t = normalizeFffStandings([{ rank: 2, equipe: { short_name: 'SC BASTIA', club: { cl_no: 3225 } }, point_count: 15 },
      { rank: 1, equipe: { short_name: 'NOUVEAU CLUB FC', club: { cl_no: 1 } }, point_count: 27 }])
    expect(t.map(r => r.team.name)).toEqual(['Nouveau Club FC', 'SC Bastia'])
    expect(prettyName('LE PUY EN VELAY FC')).toBe('Le Puy En Velay FC')
    const f = buildLigue3FormMap([
      { status: 'FINISHED', utcDate: '2026-11-01T00:00:00Z', homeTeam: { id: 1 }, awayTeam: { id: 2 }, score: { fullTime: { home: 1, away: 0 } } },
      { status: 'FINISHED', utcDate: '2026-11-08T00:00:00Z', homeTeam: { id: 2 }, awayTeam: { id: 1 }, score: { fullTime: { home: 1, away: 1 } } },
    ])
    expect(f[1]).toEqual(['W', 'D'])
    expect(f[2]).toEqual(['L', 'D'])
  })
})
