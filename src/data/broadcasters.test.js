import { describe, it, expect } from 'vitest'
import { getBroadcaster } from './broadcasters'

const m = (code, extra = {}) => ({ competition: { code }, homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, utcDate: '2026-11-22T20:00:00Z', ...extra })

describe('getBroadcaster', () => {
  it('championnats', () => {
    expect(getBroadcaster(m('FL1')).name).toBe('Ligue 1+')
    expect(getBroadcaster(m('FL2')).name).toBe('beIN Sports')
    expect(getBroadcaster(m('L3')).name).toBe('Ligue 1+')
  })
  it('coupe nationale : plus le diffuseur du championnat', () => {
    expect(getBroadcaster(m('FL1', { isCup: true }))).toBeNull()                       // tours de novembre
    expect(getBroadcaster(m('FL1', { isCup: true, utcDate: '2026-12-20T18:00:00Z' })).name).toBe('beIN Sports')
    expect(getBroadcaster(m('PD', { isCup: true })).name).toBe('DAZN')
    expect(getBroadcaster(m('BL1', { isCup: true })).name).toBe('beIN Sports')
  })
  it('équipe de France sur TF1, autres matchs de Ligue des nations : rien', () => {
    expect(getBroadcaster(m('NL', { homeTeam: { name: 'France' } }))).toMatchObject({ name: 'TF1', free: true })
    expect(getBroadcaster(m('NL'))).toBeNull()
  })
  it('éliminatoires CAN : beIN pour les sélections annoncées seulement', () => {
    expect(getBroadcaster(m('CANQ', { awayTeam: { name: 'Morocco' } })).name).toBe('beIN Sports')
    expect(getBroadcaster(m('CANQ'))).toBeNull()
  })
})
