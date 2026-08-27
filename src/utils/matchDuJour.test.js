import { describe, it, expect } from 'vitest'
import { pickMatchDuJour } from './matchDuJour'

function makeMatch(compCode, homeName, awayName, hour) {
  return {
    status: 'SCHEDULED',
    utcDate: `2026-08-28T${String(hour).padStart(2, '0')}:00:00Z`,
    competition: { code: compCode },
    homeTeam: { name: homeName },
    awayTeam: { name: awayName },
  }
}

describe('pickMatchDuJour', () => {
  it('retourne null avec moins de 2 matchs à venir', () => {
    expect(pickMatchDuJour([makeMatch('FL1', 'Lens', 'Brest', 13)])).toBeNull()
  })

  it('priorise une affiche entre 2 grands clubs même à une heure plus tôt (constat utilisateur)', () => {
    const clasico = makeMatch('PD', 'Real Madrid', 'Barcelona', 13)
    const anonyme = makeMatch('PD', 'Girona', 'Alavés', 20)
    expect(pickMatchDuJour([clasico, anonyme])).toBe(clasico)
  })

  it('1 grand club bat 0 grand club, même à égalité de compétition', () => {
    const avecGrandClub = makeMatch('PL', 'Arsenal', 'Fulham', 13)
    const sansGrandClub = makeMatch('PL', 'Burnley', 'Bournemouth', 20)
    expect(pickMatchDuJour([avecGrandClub, sansGrandClub])).toBe(avecGrandClub)
  })

  it('la Ligue des Champions garde priorité sur un match de grands clubs en championnat', () => {
    const cl = makeMatch('CL', 'Monaco', 'Auxerre', 13)
    const clasico = makeMatch('PD', 'Real Madrid', 'Barcelona', 20)
    expect(pickMatchDuJour([cl, clasico])).toBe(cl)
  })

  it('à prestige égal, garde le départage par coup d\'envoi le plus tardif', () => {
    const tot = makeMatch('FL1', 'Lens', 'Brest', 13)
    const tard = makeMatch('FL1', 'Toulouse', 'Nantes', 20)
    expect(pickMatchDuJour([tot, tard])).toBe(tard)
  })
})
