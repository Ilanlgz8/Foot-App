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
}))

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '')
function res() {
  const r = { code: 200, headers: {}, body: null }
  r.status = c => { r.code = c; return r }
  r.setHeader = (k, v) => { r.headers[k] = v; return r }
  r.json = b => { r.body = b; return r }
  r.send = b => { r.body = b; return r }
  r.end = () => r
  return r
}

describe('fenêtre ESPN avec jours expirés', () => {
  beforeEach(() => { rows.clear(); vi.restoreAllMocks() })

  it("sert les jours expirés sans tous les retélécharger", async () => {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0)
    const start = new Date(today.getTime() + 3 * 86400000)
    const days = []
    for (let i = 0; i < 40; i++) days.push(ymd(new Date(start.getTime() + i * 86400000)))
    days.forEach((d, i) => rows.set(`espn:sb:fra.1:${d}`, { value: JSON.stringify({ events: [{ id: `e${i}` }] }), expired: true }))
    const fetchMock = vi.fn(async url => ({ ok: true, json: async () => ({ events: [{ id: 'fresh-' + url.match(/dates=(\d+)/)[1] }] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { default: handler } = await import('../../api/espn.js')
    const r = res()
    await handler({ method: 'GET', headers: {}, query: { slug: 'fra.1', dates: `${days[0]}-${days[39]}` } }, r)
    expect(r.code).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(6)          // seuls les 6 jours les plus proches sont rafraîchis
    const ids = (r.body.events ?? []).map(e => e.id)
    expect(ids.length).toBe(40)                          // tous les jours sont servis
    expect(ids.filter(id => id.startsWith('fresh-')).length).toBe(6)
  })
})
