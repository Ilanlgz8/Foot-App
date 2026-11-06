import { describe, it, expect } from 'vitest'
import { serverStateVerdict } from './serverLiveState'

describe('serverStateVerdict', () => {
  const now = 1_000_000_000
  it('rien sans donnée', () => expect(serverStateVerdict(null, now)).toEqual({ final: false, live: false, seenAt: 0 }))
  it('fin confirmée récente', () => expect(serverStateVerdict({ final: true, state: 'post', seenAt: now - 60_000 }, now).final).toBe(true))
  it('en cours récent', () => expect(serverStateVerdict({ final: false, state: 'in', seenAt: now - 60_000 }, now).live).toBe(true))
  it('en cours trop vieux → ignoré', () => expect(serverStateVerdict({ final: false, state: 'in', seenAt: now - 5 * 60_000 }, now).live).toBe(false))
  it('fin trop vieille → ignorée', () => expect(serverStateVerdict({ final: true, seenAt: now - 11 * 60_000 }, now).final).toBe(false))
  it('final prime sur en cours', () => {
    const v = serverStateVerdict({ final: true, state: 'in', seenAt: now }, now)
    expect(v.final).toBe(true); expect(v.live).toBe(false)
  })
  it('horloge dans le futur → ignoré', () => expect(serverStateVerdict({ final: true, seenAt: now + 60_000 }, now).final).toBe(false))
})
