import { describe, it, expect } from 'vitest'
import { buildMatchSummary } from './matchSummary'

const base = { homeName: 'Troyes', awayName: 'Le Havre' }
describe('buildMatchSummary', () => {
  it('remontada + doublé (vrai Troyes-Le Havre du 20/11)', () => {
    const goals = [
      { side: 'away', name: 'J. Maja', minute: "3'" },
      { side: 'home', name: 'A. Mille', minute: "19'" },
      { side: 'home', name: 'A. Mille', minute: "69'" },
      { side: 'home', name: 'R. Ripart', minute: "90'+8'", penaltyKick: true },
    ]
    expect(buildMatchSummary({ ...base, hs: 3, as: 1, goals })).toBe('Mené dès la 3e, Troyes renverse Le Havre. Doublé de Mille.')
  })
  it('victoire simple', () => {
    expect(buildMatchSummary({ ...base, hs: 2, as: 0, goals: [{ side: 'home', name: 'A', minute: "10'" }, { side: 'home', name: 'B', minute: "50'" }] }))
      .toBe('Victoire 2-0 de Troyes face à Le Havre.')
  })
  it('victoire à l\'extérieur en fin de match', () => {
    expect(buildMatchSummary({ ...base, hs: 1, as: 2, goals: [
      { side: 'away', name: 'X', minute: "20'" }, { side: 'home', name: 'Y', minute: "60'" }, { side: 'away', name: 'Z', minute: "90'+2'" },
    ] })).toBe('Le Havre arrache la victoire face à Troyes en fin de match (2-1).')
  })
  it('nul et 0-0', () => {
    expect(buildMatchSummary({ ...base, hs: 0, as: 0 })).toBe('Pas de but entre Troyes et Le Havre.')
    expect(buildMatchSummary({ ...base, hs: 1, as: 1, goals: [{ side: 'home', name: 'A', minute: "1'" }, { side: 'away', name: 'B', minute: "2'" }] }))
      .toBe('Troyes et Le Havre se quittent sur un nul (1-1).')
  })
  it('large victoire, triplé, csc jamais compté comme buteur', () => {
    const goals = [1, 2, 3].map(i => ({ side: 'home', name: 'K. Mbappé', minute: `${i * 10}'` })).concat([{ side: 'home', name: 'Def', minute: "80'", ownGoal: true }])
    expect(buildMatchSummary({ ...base, hs: 4, as: 0, goals })).toBe("Troyes s'impose largement face à Le Havre (4-0). Triplé de Mbappé.")
  })
  it('en direct', () => {
    expect(buildMatchSummary({ ...base, hs: 1, as: 0, isFinished: false, goals: [{ side: 'home', name: 'A', minute: "5'" }] })).toBe('Troyes mène 1-0.')
  })
})
