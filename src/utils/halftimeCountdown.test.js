import { describe, it, expect, beforeEach } from 'vitest'
import { halftimeLabel } from './halftimeCountdown'
import { getMatchState, setHalf2Start, trackMatchState } from './matchStateTracker'

const KO = Date.parse('2026-11-08T15:00:00Z')
const match = { id: 777, utcDate: new Date(KO).toISOString(), status: 'IN_PLAY' }

beforeEach(() => { localStorage.clear() })

describe('halftimeLabel', () => {
  it('pause connue : compte à rebours', () => {
    trackMatchState({ ...match, status: 'PAUSED' }, KO + 47 * 60_000)
    expect(halftimeLabel(match, KO + 50 * 60_000)).toBe('Reprise dans 12 min')
  })

  it('pause inconnue (app ouverte pendant la mi-temps) : estimée, pas de « Mi-temps » figé', () => {
    expect(halftimeLabel(match, KO + 55 * 60_000)).toBe('Reprise dans 7 min')
  })

  it('half2Start posé à tort pendant la mi-temps : effacé, compte à rebours affiché', () => {
    trackMatchState({ ...match, status: 'PAUSED' }, KO + 47 * 60_000)
    setHalf2Start(match.id, KO + 57 * 60_000)
    expect(halftimeLabel(match, KO + 59 * 60_000)).toBe('Reprise dans 3 min')
    expect(getMatchState(match.id).half2Start).toBeNull()
  })

  it('half2Start ancien (pause avant prolongation) : gardé, pas de compte à rebours', () => {
    trackMatchState({ ...match, status: 'PAUSED' }, KO + 47 * 60_000)
    setHalf2Start(match.id, KO + 62 * 60_000)
    expect(halftimeLabel(match, KO + 110 * 60_000)).toBeNull()
    expect(getMatchState(match.id).half2Start).toBe(KO + 62 * 60_000)
  })

  it('pause dépassée : « Reprise imminente »', () => {
    trackMatchState({ ...match, status: 'PAUSED' }, KO + 47 * 60_000)
    expect(halftimeLabel(match, KO + 64 * 60_000)).toBe('Reprise imminente')
  })
})
