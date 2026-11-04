import { describe, it, expect } from 'vitest'
import { groupMatchesByCompetition, pickBestMatch, accentFor } from './competitionGroups'

const mk = (id, code, home, away, utcDate, extra = {}) => ({
  id, utcDate,
  competition: { code, name: code },
  homeTeam: { name: home, shortName: home },
  awayTeam: { name: away, shortName: away },
  ...extra,
})

describe('groupMatchesByCompetition', () => {
  it('regroupe par compétition, trie les matchs par coup d\'envoi', () => {
    const g = groupMatchesByCompetition([
      mk(1, 'CL', 'A', 'B', '2026-11-04T21:00:00Z'),
      mk(2, 'CL', 'C', 'D', '2026-11-04T18:45:00Z'),
      mk(3, 'UEL', 'E', 'F', '2026-11-04T21:00:00Z'),
    ])
    expect(g.map(x => x.code)).toEqual(['CL', 'UEL'])
    expect(g[0].matches.map(m => m.id)).toEqual([2, 1])
  })

  it('ordre des sections : Coupe du monde, Ligue 1, Ligue des champions, puis le reste', () => {
    const g = groupMatchesByCompetition([
      mk(1, 'PL', 'A', 'B', '2026-11-04T21:00:00Z'),
      mk(2, 'CL', 'C', 'D', '2026-11-04T21:00:00Z'),
      mk(3, 'FL1', 'E', 'F', '2026-11-04T21:00:00Z'),
      mk(4, 'WC', 'G', 'H', '2026-11-04T21:00:00Z'),
    ])
    expect(g.map(x => x.code)).toEqual(['WC', 'FL1', 'CL', 'PL'])
  })

  it('une coupe nationale a son propre cocon, juste après son championnat', () => {
    const g = groupMatchesByCompetition([
      mk(1, 'FL1', 'A', 'B', '2026-11-04T21:00:00Z'),
      mk(2, 'FL1', 'C', 'D', '2026-11-04T18:00:00Z', { isCup: true, competition: { code: 'FL1', name: 'Coupe de France' } }),
    ])
    expect(g).toHaveLength(2)
    expect(g[0].isCup).toBe(false)
    expect(g[1].name).toBe('Coupe de France')
    expect(g[1].accent).toBe(accentFor('FL1'))
  })
})

describe('pickBestMatch', () => {
  it('prend la plus grosse affiche', () => {
    const small = mk(1, 'CL', 'Lens', 'Côme', '2026-11-04T18:45:00Z')
    const big   = mk(2, 'CL', 'Real Madrid', 'Liverpool', '2026-11-04T21:00:00Z')
    expect(pickBestMatch([small, big]).id).toBe(2)
  })
  it('à égalité, prend le premier coup d\'envoi', () => {
    const a = mk(1, 'CL', 'X', 'Y', '2026-11-04T21:00:00Z')
    const b = mk(2, 'CL', 'Z', 'W', '2026-11-04T18:45:00Z')
    expect(pickBestMatch([a, b]).id).toBe(2)
  })
  it('un match en direct passe devant', () => {
    const live = mk(1, 'CL', 'X', 'Y', '2026-11-04T21:00:00Z')
    const big  = mk(2, 'CL', 'Real Madrid', 'Liverpool', '2026-11-04T18:45:00Z')
    expect(pickBestMatch([big, live], m => m.id === 1).id).toBe(1)
  })
  it('liste vide → null', () => {
    expect(pickBestMatch([])).toBeNull()
  })
})
