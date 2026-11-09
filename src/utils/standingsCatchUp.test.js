import { describe, it, expect } from 'vitest'
import { catchUpStandings } from './standingsLive'

const season = { startDate: '2026-08-15' }
const fin = (d, h, a, hs, as) => ({ status: 'FINISHED', utcDate: `2026-${d}T15:00:00Z`, season, homeTeam: { id: h }, awayTeam: { id: a }, score: { fullTime: { home: hs, away: as } } })
const row = (pos, id, pg, w, d, l, gf, ga) => ({ position: pos, team: { id, name: `T${id}` }, playedGames: pg, won: w, draw: d, lost: l, points: 3 * w + d, goalsFor: gf, goalsAgainst: ga, goalDifference: gf - ga })
const byId = (team) => team.id

describe('catchUpStandings', () => {
  it('ajoute le match manquant et reclasse (cas Málaga)', () => {
    const matches = [fin('11-01', 1, 2, 1, 0), fin('11-08', 3, 2, 0, 2)]
    const rows = [row(1, 1, 1, 1, 0, 0, 1, 0), row(2, 3, 1, 0, 1, 0, 0, 0), row(3, 2, 1, 0, 0, 1, 0, 1)]
    // l'équipe 3 n'a qu'un match terminé connu via ce lot (0-2) → son classement l'en compte 1 : rien à faire ;
    // l'équipe 2 a 2 matchs terminés mais 1 seul compté → victoire 2-0 ajoutée
    const out = catchUpStandings(rows, matches, byId)
    const t2 = out.find(r => r.team.id === 2)
    expect(t2).toMatchObject({ playedGames: 2, won: 1, lost: 1, points: 3, goalsFor: 2, goalsAgainst: 1, position: 1 })
    expect(out.map(r => r.position)).toEqual([1, 2, 3])
  })

  it('classement à jour : renvoyé tel quel', () => {
    const matches = [fin('11-01', 1, 2, 1, 0)]
    const rows = [row(1, 1, 1, 1, 0, 0, 1, 0), row(2, 2, 1, 0, 0, 1, 0, 1)]
    expect(catchUpStandings(rows, matches, byId)).toBe(rows)
  })

  it('plus de 3 matchs d\'écart : on ne touche à rien', () => {
    const matches = ['10-01', '10-08', '10-15', '10-22'].map(d => fin(d, 1, 2, 1, 0))
    const rows = [row(1, 1, 0, 0, 0, 0, 0, 0), row(2, 2, 0, 0, 0, 0, 0, 0)]
    expect(catchUpStandings(rows, matches, byId)).toBe(rows)
  })

  it('égalité entre lignes non modifiées : ordre d\'origine conservé', () => {
    const matches = [fin('11-01', 5, 6, 0, 1)]
    const rows = [row(1, 3, 1, 1, 0, 0, 1, 0), row(2, 4, 1, 1, 0, 0, 5, 0), row(3, 5, 0, 0, 0, 0, 0, 0), row(4, 6, 0, 0, 0, 0, 0, 0)]
    const out = catchUpStandings(rows, matches, byId)
    expect(out.map(r => r.team.id)).toEqual([3, 4, 6, 5])
  })
})
