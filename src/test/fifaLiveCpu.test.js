// fifa-live (19/11, CPU) : scoreboards ESPN gardés en mémoire de l'instance, veille seulement si utile.
import { describe, it, expect, vi } from 'vitest'

const urls = []
vi.mock('../../api/_espnHttp.js', () => ({
  espnGetText: vi.fn(),
  espnGetJson: vi.fn(async url => {
    urls.push(url)
    if (url.includes('/summary')) return { ok: true, status: 200, json: { boxscore: { teams: [] } } }
    return { ok: true, status: 200, json: { events: [{ id: '777', date: '2026-11-19T19:00Z', competitions: [{ status: { type: { name: 'STATUS_FIRST_HALF', state: 'in' }, period: 1, displayClock: "12'" }, competitors: [
      { homeAway: 'home', score: '1', team: { displayName: 'Paris Saint-Germain', shortDisplayName: 'PSG', name: 'Paris Saint-Germain' } },
      { homeAway: 'away', score: '0', team: { displayName: 'Marseille', shortDisplayName: 'Marseille', name: 'Marseille' } }] }] }] } }
  }),
}))
vi.mock('ably', () => ({ default: { Rest: class { constructor() { this.channels = { get: () => ({ publish: async () => {} }) } } } } }))
vi.mock('../utils/tursoCache.js', () => ({ workerKvGet: async () => null }))
vi.mock('@upstash/redis', () => ({ Redis: class {
  incr() { return Promise.resolve(1) } expire() { return Promise.resolve(1) } get() { return Promise.resolve(null) }
  set() { return Promise.resolve('OK') } mget(...k) { return Promise.resolve(k.map(() => null)) } del() { return Promise.resolve(1) }
  pipeline() { return { hincrbyfloat() {}, hincrby() {}, expire() {}, set() {}, exec: () => Promise.resolve([]) } } } }))

const { default: handler } = await import('../../api/fifa-live.js')
const call = body => new Promise(resolve => {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; return this }, status(c) { this.statusCode = c; return this },
    json(b) { resolve({ code: this.statusCode, body: b }); return this }, end() { resolve({ code: this.statusCode }); return this } }
  handler({ method: 'POST', headers: {}, body }, res)
})

describe('fifa-live : moins de CPU', () => {
  it('2 appels rapprochés : ESPN interrogé une seule fois (mémoire), pas de veille en soirée', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-19T19:20:00Z'))
    const m = { id: 1, utcDate: '2026-11-19T19:00:00Z', status: 'IN_PLAY', competition: { id: 2015, code: 'FL1' }, homeTeam: { name: 'Paris Saint-Germain FC', shortName: 'PSG' }, awayTeam: { name: 'Olympique de Marseille', shortName: 'Marseille' } }
    const r1 = await call({ matches: [m] })
    expect(r1.code).toBe(200)
    const scoreboards1 = urls.filter(u => u.includes('/scoreboard'))
    expect(scoreboards1.length).toBe(1)            // aujourd'hui seulement
    urls.length = 0
    await call({ matches: [m] })
    expect(urls.filter(u => u.includes('/scoreboard')).length).toBe(0)
    vi.useRealTimers()
  })
})
