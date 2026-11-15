import { describe, it, expect, beforeEach } from 'vitest'
import { setEspnData, espnSaysFinal, onMatchStateChange } from './matchStateTracker'

describe('compteur « en direct » : fin sifflée par ESPN (15/11)', () => {
  beforeEach(() => { localStorage.clear() })

  it('sort un match du compte dès le statut final ESPN', () => {
    setEspnData('m1', { espnClock: "90'+4'", espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: 2 })
    expect(espnSaysFinal('m1')).toBe(false)
    setEspnData('m1', { espnClock: 'FT', espnStatus: 'STATUS_FULL_TIME', espnPeriod: 2 })
    expect(espnSaysFinal('m1')).toBe(true)
  })

  it('ignore la mi-temps et une donnée trop vieille', () => {
    setEspnData('m2', { espnClock: 'HT', espnStatus: 'STATUS_HALFTIME', espnPeriod: 1 })
    expect(espnSaysFinal('m2')).toBe(false)
    setEspnData('m3', { espnClock: 'FT', espnStatus: 'STATUS_FINAL', espnPeriod: 2 })
    expect(espnSaysFinal('m3', Date.now() + 31 * 60_000)).toBe(false)
  })

  it('prévient les abonnés à chaque donnée ESPN', () => {
    let n = 0
    const off = onMatchStateChange(() => { n++ })
    setEspnData('m4', { espnClock: "10'", espnStatus: 'STATUS_IN_PROGRESS' })
    off()
    setEspnData('m4', { espnClock: "11'", espnStatus: 'STATUS_IN_PROGRESS' })
    expect(n).toBe(1)
  })
})
