import { describe, it, expect } from 'vitest'
import { getStandingsRules } from './standingsRules'

const zone = (rules, pos) => rules.find(r => pos >= r.start && pos <= r.end)?.label ?? null

describe('getStandingsRules', () => {
  it('Ligue 1 (18) : 3 LdC + qualif, barrage 16e, 17-18 relégués', () => {
    const r = getStandingsRules('FL1', { teamCount: 18 })
    expect(zone(r, 3)).toBe('Ligue des champions')
    expect(zone(r, 4)).toBe('Qualif. Ligue des champions')
    expect(zone(r, 16)).toBe('Barrage relégation')
    expect(zone(r, 17)).toBe('Relégation')
  })
  it('Premier League (20) : 4 LdC, 18-20 relégués', () => {
    const r = getStandingsRules('PL', { teamCount: 20 })
    expect(zone(r, 4)).toBe('Ligue des champions')
    expect(zone(r, 5)).toBe('Europa League')
    expect(zone(r, 17)).toBe(null)
    expect(zone(r, 18)).toBe('Relégation')
  })
  it('Ligue 2 : montée, play-offs, barrage, relégation', () => {
    const r = getStandingsRules('FL2', { teamCount: 18 })
    expect(zone(r, 2)).toBe('Montée en Ligue 1')
    expect(zone(r, 5)).toBe('Play-offs')
    expect(zone(r, 16)).toBe('Barrage relégation')
    expect(zone(r, 18)).toBe('Relégation')
  })
  it('Europa League : phase de ligue', () => {
    const r = getStandingsRules('UEL', { teamCount: 36 })
    expect(zone(r, 8)).toBe('Huitièmes de finale')
    expect(zone(r, 24)).toBe('Barrages')
    expect(zone(r, 25)).toBe('Éliminé')
  })
  it('Ligue des nations : selon la ligue du groupe', () => {
    expect(zone(getStandingsRules('NL', { groupName: 'GROUP_A1' }), 2)).toBe('Quarts de finale')
    expect(zone(getStandingsRules('NL', { groupName: 'GROUP_B3' }), 1)).toBe('Montée en Ligue A')
    expect(getStandingsRules('NL', { groupName: 'X' })).toEqual([])
  })
  it('Éliminatoires CAN : pas de zone dans les groupes des pays hôtes', () => {
    expect(zone(getStandingsRules('CANQ', { groupName: 'Group A' }), 2)).toBe('Qualifié')
    expect(getStandingsRules('CANQ', { groupName: 'Group H' })).toEqual([])
  })
  it('compétition inconnue : aucune zone', () => {
    expect(getStandingsRules('XYZ', { teamCount: 20 })).toEqual([])
  })
})
