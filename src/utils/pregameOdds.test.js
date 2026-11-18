import { describe, it, expect } from 'vitest'
import { rememberPregameOdds, rememberServerPregameOdds, recallPregame } from './pregameOdds'

describe('pregameOdds — priorité des sources (19/11)', () => {
  it('la cote du Worker remplace un repli, jamais la cote affichée sur ce téléphone', () => {
    rememberPregameOdds('m1', { pct: { home: 50, draw: 25, away: 25 } }, 'fallback')
    rememberServerPregameOdds('m1', [2.3, 3.4, 3.1])
    expect(recallPregame('m1').source).toBe('server')
    expect(recallPregame('m1').decimal.home).toBe(2.3)

    rememberPregameOdds('m2', { pct: { home: 40, draw: 30, away: 30 }, decimal: { home: 2.4, draw: 3.2, away: 3.2 } }, 'display')
    rememberServerPregameOdds('m2', [2.0, 3.5, 3.9])
    expect(recallPregame('m2').source).toBe('display')
    expect(recallPregame('m2').decimal.home).toBe(2.4)
  })
  it('ignore une publication invalide', () => {
    rememberServerPregameOdds('m3', [2.3, null, 3.1])
    expect(recallPregame('m3')).toBe(null)
  })
  it('les % déduits des cotes du Worker somment à 100', () => {
    rememberServerPregameOdds('m4', [1.8, 3.6, 4.5])
    const p = recallPregame('m4').pct
    expect(Math.round(p.home + p.draw + p.away)).toBe(100)
  })
})
