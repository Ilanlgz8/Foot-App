import { describe, it, expect } from 'vitest'
import { hasLiveMatchFor } from './useStandings'

const match = (code) => ({ id: 1, competition: { code } })

describe('hasLiveMatchFor — gel du classement pendant un match', () => {
  it('détecte un match en cours de la compétition affichée', () => {
    expect(hasLiveMatchFor([match('FL1')], 'FL1')).toBe(true)
  })

  it('ignore un match en cours d’une AUTRE compétition', () => {
    // Un match de Premier League ne doit pas geler le classement de Ligue 1.
    expect(hasLiveMatchFor([match('PL')], 'FL1')).toBe(false)
  })

  it('gèle dès qu’UN match de la compétition est en cours parmi d’autres', () => {
    expect(hasLiveMatchFor([match('PL'), match('SA'), match('FL1')], 'FL1')).toBe(true)
  })

  it('ne gèle rien quand aucun match n’est en cours', () => {
    expect(hasLiveMatchFor([], 'FL1')).toBe(false)
  })

  it('tolère les entrées incomplètes sans planter', () => {
    expect(hasLiveMatchFor(null, 'FL1')).toBe(false)
    expect(hasLiveMatchFor(undefined, 'FL1')).toBe(false)
    expect(hasLiveMatchFor([null, {}, { competition: null }], 'FL1')).toBe(false)
  })

  it('ne gèle jamais sans compétition sélectionnée', () => {
    expect(hasLiveMatchFor([match('FL1')], null)).toBe(false)
    expect(hasLiveMatchFor([match('FL1')], '')).toBe(false)
  })
})
