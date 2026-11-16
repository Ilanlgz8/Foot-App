// 06/11 — /api/espn, mode fenêtre (dates=AAAAMMJJ-AAAAMMJJ) : les jours expirés en cache sont servis
// tout de suite et seuls les plus proches sont rafraîchis (voir readCachedChunks, api/espn.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rows = new Map() // key -> { value, expired }
vi.mock('@upstash/redis', () => ({ Redis: class { incr() { return 1 } expire() {} get() { return null } set() {} mget() { return [] } } }))
vi.mock('../utils/tursoCache.js', () => ({
  isTursoConfigured: () => true,
  mgetWithStale: async keys => keys.map(k => rows.get(k) ?? null),
  set: async () => {},
  tryLock: async () => true,
  mget: async keys => keys.map(() => null),
  workerKvGet: async () => null,
  tursoStats: { timeouts: 0, byOp: {} },
}))

function res() {
  const r = { code: 200, headers: {}, body: null }
  r.status = c => { r.code = c; return r }
  r.setHeader = (k, v) => { r.headers[k] = v; return r }
  r.json = b => { r.body = b; return r }
  r.send = b => { r.body = b; return r }
  r.end = () => r
  return r
}

describe('fenêtre ESPN : un appel par mois (16/11)', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('découpe la plage en mois, fusionne et allège les matchs', async () => {
    const fetchMock = vi.fn(async url => {
      const ym = url.match(/dates=(\d{6})&/)[1]
      return { ok: true, json: async () => ({ events: [{ id: 'e' + ym, date: '2026-01-01T20:00Z', odds: [1, 2, 3], competitions: [{ competitors: [] }] }] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { default: handler } = await import('../../api/espn.js')
    const r = res()
    await handler({ method: 'GET', headers: {}, query: { slug: 'fra.1', dates: '20261017-20270115' } }, r)
    expect(r.code).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(4)            // oct, nov, déc, janv
    const ids = r.body.events.map(e => e.id).sort()
    expect(ids).toEqual(['e202610', 'e202611', 'e202612', 'e202701'])
    expect(r.body.events[0].odds).toBeUndefined()         // champs inutiles retirés
  })
})
