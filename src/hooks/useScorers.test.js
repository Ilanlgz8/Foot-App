// scorersUpdateDue : un seul appel quand TOUS les matchs du dernier jour d'une compétition sont finis.
import { describe, it, expect, vi, beforeEach } from 'vitest'

let savedAt = null
vi.mock('./localCache', () => ({
  readCacheStale: () => null,
  getCacheSavedAt: () => savedAt,
  writeCache: () => {},
}))
vi.mock('../utils/fdFetch', () => ({ fdFetch: vi.fn(), fdUrl: vi.fn() }))
vi.mock('../utils/fdSpacingTracker', () => ({ registerFdCallAttempt: vi.fn(), waitForFdSpacing: vi.fn() }))

import { scorersUpdateDue } from './useScorers'

const NOW = new Date('2026-11-04T23:30:00Z').getTime()
const at = (iso, extra = {}) => ({ utcDate: iso, status: 'FINISHED', ...extra })

describe('scorersUpdateDue', () => {
  beforeEach(() => { savedAt = null })

  it('faux sans aucun match terminé récent', () => {
    expect(scorersUpdateDue([], 'CL', [], NOW)).toBe(false)
    expect(scorersUpdateDue([at('2026-10-20T20:00:00Z')], 'CL', [], NOW)).toBe(false)
  })

  it('vrai : tous les matchs du jour finis et copie locale antérieure à la fin', () => {
    savedAt = new Date('2026-11-04T19:00:00Z').getTime()
    expect(scorersUpdateDue([at('2026-11-04T20:00:00Z')], 'CL', [], NOW)).toBe(true)
  })

  it("faux une fois la copie récupérée APRÈS la fin (lastUpdated FD.org)", () => {
    savedAt = new Date('2026-11-04T22:10:00Z').getTime()
    const m = at('2026-11-04T20:00:00Z', { lastUpdated: '2026-11-04T22:00:00Z' })
    expect(scorersUpdateDue([m], 'CL', [], NOW)).toBe(false)
  })

  it('faux tant qu’un match du même jour reste programmé ou vient de commencer', () => {
    savedAt = new Date('2026-11-04T19:00:00Z').getTime()
    const fin = [at('2026-11-04T17:45:00Z')]
    expect(scorersUpdateDue(fin, 'CL', [{ utcDate: '2026-11-04T23:55:00Z', status: 'SCHEDULED' }], NOW)).toBe(false)
    expect(scorersUpdateDue(fin, 'CL', [{ utcDate: '2026-11-04T22:00:00Z', status: 'TIMED' }], NOW)).toBe(false) // commencé il y a 90min
  })

  it('un match reporté ne bloque pas la mise à jour', () => {
    savedAt = new Date('2026-11-04T19:00:00Z').getTime()
    expect(scorersUpdateDue([at('2026-11-04T20:00:00Z')], 'CL', [{ utcDate: '2026-11-04T20:00:00Z', status: 'POSTPONED' }], NOW)).toBe(true)
  })

  it('sans copie locale : vrai seulement si le jour s’est fini il y a moins de 8h', () => {
    expect(scorersUpdateDue([at('2026-11-04T20:00:00Z')], 'CL', [], NOW)).toBe(true)
    expect(scorersUpdateDue([at('2026-11-03T20:00:00Z')], 'CL', [], NOW)).toBe(false)
  })
})
