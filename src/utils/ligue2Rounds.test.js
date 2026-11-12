import { describe, it, expect } from 'vitest'
import { nameSim, enrichLigue2 } from './ligue2Rounds'

const ESPN = ['St. Étienne', 'AS Nancy Lorraine', 'Montpellier', 'Reims', 'Pau', 'Dijon FCO', 'Metz', 'Red Star FC', 'Annecy', 'Dunkerque', 'Guingamp', 'Boulogne', 'Rodez Aveyron', 'Nantes', 'Clermont Foot', 'Sochaux', 'Grenoble', 'Stade Laval']
const FFF = ['AS ST ETIENNE', 'NANCY LORRAINE AS', 'MONTPELLIER HSC', 'STADE DE REIMS', 'PAU FC', 'DIJON FCO', 'FC METZ', 'RED STAR FC', "FC D'ANNECY", 'DUNKERQUE USL', 'EA GUINGAMP', 'BOULOGNE S/MER USCO', 'RODEZ AF', 'FC NANTES', 'CLERMONT FOOT 63', 'SOCHAUX MONTB. FC', 'GRENOBLE FOOT 38', 'STADE LAVALLOIS MFC']

describe('Ligue 2 — journées FFF', () => {
  it('chaque nom ESPN retrouve son club FFF', () => {
    ESPN.forEach((e, i) => {
      const s = FFF.map(f => nameSim(e, f))
      expect(s.indexOf(Math.max(...s))).toBe(i)
    })
  })

  it('recopie la journée et ajoute les matchs hors fenêtre', () => {
    const t = n => ({ id: n, name: ESPN[n], shortName: ESPN[n] })
    const f = n => ({ id: 90_000_000 + n, name: FFF[n] })
    const espn = [
      { id: 1, utcDate: '2026-11-07T13:00:00Z', homeTeam: t(14), awayTeam: t(12), status: 'FINISHED', competition: { code: 'FL2' } },
      { id: 2, utcDate: '2026-11-07T13:00:00Z', homeTeam: t(0), awayTeam: t(17), status: 'FINISHED', competition: { code: 'FL2' } },
    ]
    const fff = [
      { id: 10, utcDate: '2026-11-07T13:00:00.000Z', matchday: 12, homeTeam: f(0), awayTeam: f(17), status: 'FINISHED', score: {} },
      { id: 11, utcDate: '2026-11-07T13:00:00.000Z', matchday: 12, homeTeam: f(14), awayTeam: f(12), status: 'FINISHED', score: {} },
      { id: 12, utcDate: '2026-08-08T18:00:00.000Z', matchday: 1, homeTeam: f(0), awayTeam: f(14), status: 'FINISHED', score: {} },
    ]
    const out = enrichLigue2(espn, fff)
    expect(out.find(m => m.id === 1).matchday).toBe(12)
    expect(out.find(m => m.id === 2).matchday).toBe(12)
    const old = out.find(m => m.id === 'fff-12')
    expect(old.matchday).toBe(1)
    expect(old.homeTeam.name).toBe('St. Étienne')
    expect(old._noDetail).toBe(true)
  })
})
