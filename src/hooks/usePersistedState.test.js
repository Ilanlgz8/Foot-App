import { describe, it, expect } from 'vitest'
import { readPersisted, serializePersisted, NAV_POSITION_TTL } from './usePersistedState'

const T0 = 1_700_000_000_000

describe('sans TTL — comportement historique, inchangé', () => {
  it('restitue la valeur mémorisée quel que soit son âge', () => {
    expect(readPersisted(JSON.stringify(7), 0, null, T0)).toBe(7)
  })
  it('écrit la valeur brute, sans enrobage', () => {
    expect(serializePersisted(5, null, T0)).toBe('5')
  })
  it('retombe sur le défaut si rien n’est mémorisé', () => {
    expect(readPersisted(null, 'defaut', null, T0)).toBe('defaut')
  })
})

describe('avec TTL — correctif de la journée figée', () => {
  const fresh = serializePersisted(7, NAV_POSITION_TTL, T0)

  it('restitue une valeur récente (retour depuis une fiche match)', () => {
    expect(readPersisted(fresh, 0, NAV_POSITION_TTL, T0 + 60_000)).toBe(7)
  })

  it('IGNORE une valeur périmée — c’est exactement le bug corrigé', () => {
    expect(readPersisted(fresh, 0, NAV_POSITION_TTL, T0 + NAV_POSITION_TTL + 1)).toBe(0)
  })

  it('restitue encore juste avant l’expiration', () => {
    expect(readPersisted(fresh, 0, NAV_POSITION_TTL, T0 + NAV_POSITION_TTL)).toBe(7)
  })

  it('ignore une valeur écrite AVANT l’ajout du TTL (non horodatée)', () => {
    expect(readPersisted(JSON.stringify(7), 0, NAV_POSITION_TTL, T0)).toBe(0)
  })

  it('horodate ce qu’il écrit', () => {
    expect(JSON.parse(serializePersisted(5, NAV_POSITION_TTL, T0))).toEqual({ __v: 5, __t: T0 })
  })

  it('repousse l’expiration à chaque réécriture', () => {
    const rewritten = serializePersisted(4, NAV_POSITION_TTL, T0 + NAV_POSITION_TTL - 1000)
    expect(readPersisted(rewritten, 0, NAV_POSITION_TTL, T0 + NAV_POSITION_TTL + 1000)).toBe(4)
  })

  it('supporte null comme valeur (clé de tour non encore choisie)', () => {
    const s = serializePersisted(null, NAV_POSITION_TTL, T0)
    expect(readPersisted(s, 'defaut', NAV_POSITION_TTL, T0)).toBeNull()
  })

  it('retombe sur le défaut si le contenu mémorisé est illisible', () => {
    expect(readPersisted('{pas du json', 42, NAV_POSITION_TTL, T0)).toBe(42)
  })

  it('30 min : large pour un aller-retour, court devant une session de PWA', () => {
    expect(NAV_POSITION_TTL).toBe(30 * 60 * 1000)
  })
})
