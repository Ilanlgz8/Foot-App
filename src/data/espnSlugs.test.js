import { describe, it, expect } from 'vitest'
import { espnNativeSlug } from './espnSlugs'

// ⚠️ Tests ajoutés (27/10) suite au bug Copa del Rey : 2 matchs restés
// bloqués "en direct" (score figé, aucune stat live) car liveTracker.js
// (markLive/markPendingKickoff) ne persistait pas `isCup` — une fois le
// match reconstruit depuis localStorage sans ce champ, espnNativeSlug ne
// retrouvait plus jamais le bon slug ESPN (`esp.copa_del_rey`), retombant
// sur `null`. Voir le commentaire détaillé dans espnSlugs.js/espnNativeSlug.
describe('espnNativeSlug', () => {
  it('résout une coupe nationale quand isCup est présent (cas normal)', () => {
    const match = {
      id: 'espn-PD-cup-401874123',
      isCup: true,
      competition: { id: -102, code: 'PD' },
    }
    expect(espnNativeSlug(match)).toBe('esp.copa_del_rey')
  })

  it("résout quand même une coupe nationale si `isCup` a été perdu (reconstruit depuis liveTracker AVANT le fix), grâce au format de l'id", () => {
    const match = {
      id: 'espn-PD-cup-401874123',
      // isCup absent — simule l'ancienne entrée liveTracker corrompue
      competition: { id: -102, code: 'PD' },
    }
    expect(espnNativeSlug(match)).toBe('esp.copa_del_rey')
  })

  it('fait de même pour la Coupe de France (FL1) et la FA Cup (PL)', () => {
    expect(espnNativeSlug({ id: 'espn-FL1-cup-1', competition: { id: -101, code: 'FL1' } })).toBe('fra.coupe_de_france')
    expect(espnNativeSlug({ id: 'espn-PL-cup-1', competition: { id: -103, code: 'PL' } })).toBe('eng.fa')
  })

  it('résout une compétition de sélection nationale (NL) normalement, sans fausse détection "cup"', () => {
    const match = { id: 'espn-NL-401900000', isCup: false, competition: { id: -1, code: 'NL' } }
    expect(espnNativeSlug(match)).toBe('uefa.nations')
  })

  it('résout un grand championnat club via ESPN_SLUG_BY_COMP_ID (fallback id réel)', () => {
    const match = { id: 'espn-esp.1-401900001', isCup: false, competition: { id: 2014, code: 'PD' } }
    expect(espnNativeSlug(match)).toBe('esp.1')
  })

  it('renvoie null pour un id qui ne commence pas par "espn-"', () => {
    expect(espnNativeSlug({ id: '12345', competition: { code: 'PD' } })).toBeNull()
  })

  it('renvoie null si aucune table ne matche (compétition inconnue)', () => {
    expect(espnNativeSlug({ id: 'espn-XX-1', competition: { id: -999, code: 'XX' } })).toBeNull()
  })
})
