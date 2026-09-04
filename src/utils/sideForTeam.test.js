import { describe, it, expect } from 'vitest'
import { sideForTeam, extractMatchDetails, fuzzyTeam, clubNameMatch } from './espnSummaryParse'

// Le cas signalé par l'utilisateur : Real Madrid reçoit, Real Betis se déplace.
const MADRID = { team: { id: '86',  displayName: 'Real Madrid' }, homeAway: 'home' }
const BETIS  = { team: { id: '244', displayName: 'Real Betis' },  homeAway: 'away' }

describe('la cause du bug', () => {
  it('fuzzyTeam CONFOND Real Madrid et Real Betis (préfixe de 5 caractères)', () => {
    expect(fuzzyTeam('Real Madrid', 'Real Betis')).toBe(true)   // <- le bug
  })
  it('clubNameMatch, lui, les distingue', () => {
    expect(clubNameMatch('Real Madrid', 'Real Betis')).toBe(false)
    expect(clubNameMatch('Real Madrid', 'Real Madrid CF')).toBe(true)  // vraie variante
  })
})

describe('sideForTeam', () => {
  it('attribue par identifiant, le seul critère fiable', () => {
    expect(sideForTeam(MADRID, BETIS, { id: '86' })).toBe('home')
    expect(sideForTeam(MADRID, BETIS, { id: '244' })).toBe('away')
  })

  it('tolère un identifiant numérique face à une chaîne', () => {
    expect(sideForTeam(MADRID, BETIS, { id: 244 })).toBe('away')
  })

  it('sans identifiant, distingue quand même les deux "Real"', () => {
    expect(sideForTeam(MADRID, BETIS, { displayName: 'Real Betis' })).toBe('away')
    expect(sideForTeam(MADRID, BETIS, { displayName: 'Real Madrid' })).toBe('home')
  })

  it('accepte les variantes de nom (suffixe en plus)', () => {
    expect(sideForTeam(MADRID, BETIS, { displayName: 'Real Betis Balompié' })).toBe('away')
  })

  it('renvoie null plutôt que de deviner — c’était la 2e cause du bug', () => {
    expect(sideForTeam(MADRID, BETIS, undefined)).toBeNull()
    expect(sideForTeam(MADRID, BETIS, {})).toBeNull()
    expect(sideForTeam(MADRID, BETIS, { id: '999', displayName: 'Séville' })).toBeNull()
  })
})

describe('extractMatchDetails — bout en bout', () => {
  const comp = (details, commentary) => ({ competitors: [MADRID, BETIS], details, ...(commentary ? {} : {}) })

  it('un carton du Real Madrid reste au Real Madrid', () => {
    const { cards } = extractMatchDetails(
      comp([{ team: { id: '86' }, redCard: false, clock: { displayValue: "23'" },
              participants: [{ athlete: { shortName: 'Camavinga' } }] }]), '86')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ name: 'Camavinga', team: 'home', red: false })
  })

  it('un carton du Real Betis reste au Real Betis', () => {
    const { cards } = extractMatchDetails(
      comp([{ team: { id: '244' }, redCard: false, clock: { displayValue: "40'" },
              participants: [{ athlete: { shortName: 'Fekir' } }] }]), '86')
    expect(cards[0].team).toBe('away')
  })

  it('un événement SANS équipe est ignoré, plus attribué d’office à l’extérieur', () => {
    const { cards, scorers } = extractMatchDetails(
      comp([{ redCard: false, clock: { displayValue: "12'" },
              participants: [{ athlete: { shortName: 'Inconnu' } }] }]), '86')
    expect(cards).toHaveLength(0)
    expect(scorers).toHaveLength(0)
  })

  it('les buts suivent la même attribution', () => {
    const { scorers } = extractMatchDetails(
      comp([{ team: { id: '244' }, scoringPlay: true, clock: { displayValue: "55'" },
              participants: [{ athlete: { shortName: 'Isco' } }] }]), '86')
    expect(scorers[0]).toMatchObject({ name: 'Isco', team: 'away' })
  })

  it('repli commentary : un carton du Betis ne bascule plus chez Madrid', () => {
    const c = { competitors: [MADRID, BETIS], details: [] }
    const commentary = [{
      play: { type: { id: '94' }, team: { displayName: 'Real Betis' },
              clock: { displayValue: "67'" },
              participants: [{ athlete: { shortName: 'Ruibal' } }] },
    }]
    const { cards } = extractMatchDetails(c, '86', commentary)
    expect(cards).toHaveLength(1)
    expect(cards[0].team).toBe('away')     // avant ce correctif : 'home'
  })
})
