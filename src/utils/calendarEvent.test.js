import { describe, it, expect } from 'vitest'
import { matchEventInfo, buildIcs, googleCalendarUrl } from './calendarEvent'

const ev = matchEventInfo({ id: 42, homeName: 'PSG', awayName: 'OM', utcDate: '2026-11-29T20:00:00Z', compLabel: 'Ligue 1 · Journée 14', channel: 'Ligue 1+', venue: 'Parc des Princes, Paris' })
describe('calendrier', () => {
  it('ics valide : heure UTC, 2 h, rappel 1 h avant, caractères échappés', () => {
    const ics = buildIcs(ev)
    expect(ics).toContain('DTSTART:20261129T200000Z')
    expect(ics).toContain('DTEND:20261129T220000Z')
    expect(ics).toContain('TRIGGER:-PT1H')
    expect(ics).toContain('UID:match-42@statfootix.vercel.app')
    expect(ics).toContain('LOCATION:Parc des Princes\\, Paris')
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR')
  })
  it('lien Google Agenda', () => {
    const u = new URL(googleCalendarUrl(ev))
    expect(u.searchParams.get('dates')).toBe('20261129T200000Z/20261129T220000Z')
    expect(u.searchParams.get('text')).toBe('PSG – OM')
  })
  it('date invalide → null', () => { expect(matchEventInfo({ utcDate: 'x' })).toBeNull() })
})
