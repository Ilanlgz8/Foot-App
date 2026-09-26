import { describe, it, expect } from 'vitest'
import { groupRounds } from './useMatchs'

function md(day, dateStr, id = `md${day}`) {
  return { id, matchday: day, stage: null, utcDate: dateStr }
}

function cupDay(dateStr, id) {
  // Match de coupe en tour préliminaire : ni matchday ni stage reconnu
  // (voir mapEspnStage/KNOCKOUT_ORDER) → tombe dans dayEntries.
  return { id, matchday: null, stage: null, utcDate: dateStr }
}

describe('groupRounds', () => {
  it('ordre inchangé sans dayEntries (aucune régression sur les compétitions sans coupe fusionnée)', () => {
    const matches = [
      md(2, '2026-09-20T18:00:00Z'),
      md(1, '2026-09-13T18:00:00Z'),
      md(3, '2026-09-27T18:00:00Z'),
    ]
    const groups = groupRounds(matches, 'asc')
    expect(groups.map(g => g.key)).toEqual(['md-1', 'md-2', 'md-3'])
  })

  it('insère un match de coupe (tour préliminaire) à sa vraie position chronologique, pas après toutes les journées', () => {
    const matches = [
      md(1, '2026-09-13T18:00:00Z'),
      md(2, '2026-09-20T18:00:00Z'),
      md(3, '2026-10-04T18:00:00Z'),
      // Match Copa del Rey préliminaire, joué ENTRE la journée 2 et la journée 3.
      cupDay('2026-09-26T20:00:00Z', 'cup1'),
    ]
    const groups = groupRounds(matches, 'asc')
    // Doit apparaître entre md-2 et md-3, pas en dernier.
    expect(groups.map(g => g.key)).toEqual(['md-1', 'md-2', 'day-2026-09-26', 'md-3'])
  })

  it('insère un match de coupe avant la 1ère journée si sa date est la plus ancienne', () => {
    const matches = [
      md(1, '2026-09-13T18:00:00Z'),
      md(2, '2026-09-20T18:00:00Z'),
      cupDay('2026-09-06T20:00:00Z', 'cup1'),
    ]
    const groups = groupRounds(matches, 'asc')
    expect(groups.map(g => g.key)).toEqual(['day-2026-09-06', 'md-1', 'md-2'])
  })

  it('reste correct en ordre desc (Résultats)', () => {
    const matches = [
      md(1, '2026-09-13T18:00:00Z'),
      md(2, '2026-09-20T18:00:00Z'),
      md(3, '2026-10-04T18:00:00Z'),
      cupDay('2026-09-26T20:00:00Z', 'cup1'),
    ]
    const groups = groupRounds(matches, 'desc')
    expect(groups.map(g => g.key)).toEqual(['md-3', 'day-2026-09-26', 'md-2', 'md-1'])
  })
})
