// Calendriers ESPN (api/espn.js, mode plage) : mémoire des mois (19/11). ESPN simulé.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = []
vi.mock('../../api/_espnHttp.js', () => ({
  espnGetText: vi.fn(async () => ({ ok: true, status: 200, text: '{"events":[]}' })),
  espnGetJson: vi.fn(async (url) => {
    calls.push(url)
    const ym = /dates=(\d{6})&/.exec(url)?.[1]
    const day = `${ym.slice(0, 4)}-${ym.slice(4, 6)}-10T19:00Z`
    return { ok: true, status: 200, json: { events: [{ id: `e${ym}`, date: day, name: 'A at B', competitions: [{ id: `c${ym}`, status: { type: { state: 'post' } }, competitors: [] }] }] } }
  }),
}))
vi.mock('@upstash/redis', () => ({ Redis: class { incr() { return Promise.resolve(1) } expire() { return Promise.resolve(1) } get() { return Promise.resolve(null) } set() { return Promise.resolve('OK') } pipeline() { return { hincrbyfloat() {}, hincrby() {}, expire() {}, exec: () => Promise.resolve([]) } } } }))

const { default: handler } = await import('../../api/espn.js')
function call(query) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200,
      status(c) { this.statusCode = c; return this }, setHeader(k, v) { this.headers[k] = v; return this },
      json(b) { resolve({ code: this.statusCode, body: b, headers: this.headers }); return this },
      send(b) { resolve({ code: this.statusCode, body: b, headers: this.headers }); return this } }
    handler({ query, headers: {}, method: 'GET' }, res)
  })
}

describe('calendrier ESPN par mois', () => {
  beforeEach(() => { calls.length = 0 })
  it('1er appel : un appel ESPN par mois ; 2e appel : plus rien (mois en mémoire)', async () => {
    const q = { slug: 'fra.1', dates: '20250801-20251130' }
    const r1 = await call(q)
    expect(r1.code).toBe(200)
    expect(r1.body.events.map(e => e.id)).toEqual(['e202508', 'e202509', 'e202510', 'e202511'])
    expect(calls.length).toBe(4)
    calls.length = 0
    const r2 = await call(q)
    expect(r2.body.events.length).toBe(4)
    expect(calls.length).toBe(0)
  })
  it('forceFresh relit ESPN', async () => {
    await call({ slug: 'fra.1', dates: '20250801-20250930', forceFresh: '1' })
    expect(calls.length).toBe(2)
  })
})
