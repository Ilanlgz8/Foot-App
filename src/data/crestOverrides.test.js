import { describe, it, expect } from 'vitest'
import { espnCrestFor, overrideCrestUrls } from './crestOverrides'

describe('espnCrestFor', () => {
  it('renvoie un écusson ESPN 500px pour les 8 clubs basse résolution', () => {
    // Les 8 ids football-data.org mesurés à 70×70 (les seuls de l'élite).
    const fdIds = [548, 519, 351, 10, 15, 16, 18, 7]
    for (const id of fdIds) {
      expect(espnCrestFor(id)).toMatch(/^https:\/\/a\.espncdn\.com\/i\/teamlogos\/soccer\/500\/\d+\.png$/)
    }
  })

  it('ne fabrique pas de correspondance pour un club non concerné', () => {
    expect(espnCrestFor(524)).toBeNull()   // PSG, déjà en 200×200
    expect(espnCrestFor(99999)).toBeNull()
  })

  it('associe deux ids football-data distincts à deux ids ESPN distincts', () => {
    // Garde-fou contre un copier-coller malheureux dans la table.
    const fdIds = [548, 519, 351, 10, 15, 16, 18, 7]
    const urls  = fdIds.map(espnCrestFor)
    expect(new Set(urls).size).toBe(fdIds.length)
  })
})

describe('overrideCrestUrls', () => {
  it("remplace l'écusson d'un club concerné dans un corps JSON", () => {
    const body = JSON.stringify({
      homeTeam: { id: 548, name: 'AS Monaco', crest: 'https://crests.football-data.org/548.png' },
    })
    const out = JSON.parse(overrideCrestUrls(body))
    expect(out.homeTeam.crest).toBe('https://a.espncdn.com/i/teamlogos/soccer/500/174.png')
    expect(out.homeTeam.name).toBe('AS Monaco')   // le reste est intact
  })

  it("laisse intact l'écusson d'un club non concerné", () => {
    const url  = 'https://crests.football-data.org/524.png'
    const body = JSON.stringify({ crest: url })
    expect(JSON.parse(overrideCrestUrls(body)).crest).toBe(url)
  })

  it('ne confond pas un id ESPN avec un id football-data', () => {
    // 174 est l'id ESPN de Monaco ; côté football-data c'est un AUTRE club,
    // qui ne doit surtout pas hériter de l'écusson de Monaco.
    const url = 'https://crests.football-data.org/174.png'
    expect(JSON.parse(overrideCrestUrls(JSON.stringify({ crest: url }))).crest).toBe(url)
  })

  it('ne touche pas à un id qui contient un id concerné (10 vs 100, 7 vs 719)', () => {
    const body = JSON.stringify({
      a: 'https://crests.football-data.org/100.png',
      b: 'https://crests.football-data.org/719.png',
      c: 'https://crests.football-data.org/1548.png',
    })
    const out = JSON.parse(overrideCrestUrls(body))
    expect(out.a).toBe('https://crests.football-data.org/100.png')
    expect(out.b).toBe('https://crests.football-data.org/719.png')
    expect(out.c).toBe('https://crests.football-data.org/1548.png')
  })

  it('remplace toutes les occurrences, pas seulement la première', () => {
    const body = JSON.stringify([
      { crest: 'https://crests.football-data.org/548.png' },
      { crest: 'https://crests.football-data.org/519.png' },
      { crest: 'https://crests.football-data.org/548.png' },
    ])
    expect(overrideCrestUrls(body)).not.toContain('crests.football-data.org')
  })

  it('laisse passer un corps sans écusson, ou une entrée invalide', () => {
    expect(overrideCrestUrls('{"count":3}')).toBe('{"count":3}')
    expect(overrideCrestUrls('')).toBe('')
    expect(overrideCrestUrls(null)).toBeNull()
    expect(overrideCrestUrls(undefined)).toBeUndefined()
  })

  it('ne casse pas un JSON valide (le résultat reste parsable)', () => {
    const body = JSON.stringify({ matches: [{ homeTeam: { crest: 'https://crests.football-data.org/10.png' } }] })
    expect(() => JSON.parse(overrideCrestUrls(body))).not.toThrow()
  })
})
