import { describe, it, expect } from 'vitest'
import { extractPregameOddsFromComp } from './espnOdds'

// Échantillon réel (scoreboard ESPN, Angers–Paris FC, 22/11, DraftKings) réduit aux champs utiles.
const comp = {
  odds: [{
    provider: { name: 'DraftKings' },
    moneyline: {
      home: { open: { odds: '-290' }, close: { odds: '-295' } },
      away: { open: { odds: '+700' }, close: { odds: '+750' } },
      draw: { open: { odds: '+400' }, close: { odds: '+425' } },
    },
    drawOdds: { moneyLine: 425 },
    overUnder: 2.5,
  }],
}

describe('extractPregameOddsFromComp (partagé app / Worker, 19/11)', () => {
  it('convertit la ligne DraftKings en cotes décimales et en %', () => {
    const o = extractPregameOddsFromComp(comp)
    expect(o.decimal.home).toBeCloseTo(1 + 100 / 295, 5)
    expect(o.decimal.away).toBeCloseTo(8.5, 5)
    expect(o.decimal.draw).toBeCloseTo(5.25, 5)
    expect(Math.round(o.pct.home + o.pct.draw + o.pct.away)).toBe(100)
  })
  it('ignore une ligne « Live Odds »', () => {
    const live = { odds: [{ ...comp.odds[0], provider: { name: 'DraftKings Live Odds' } }] }
    expect(extractPregameOddsFromComp(live)).toBe(null)
  })
})
