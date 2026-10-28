import { describe, it, expect } from 'vitest'
import {
  normalizeTeamQuery,
  teamMatchesQuery,
  teamDisplayName,
  teamIdentityKey,
} from './teamSearch'

describe('normalizeTeamQuery', () => {
  it('retire les accents, met en minuscule et réduit la ponctuation à des espaces', () => {
    expect(normalizeTeamQuery('Séville')).toBe('seville')
    expect(normalizeTeamQuery('Saint-Germain')).toBe('saint germain')
    expect(normalizeTeamQuery('  Málaga  ')).toBe('malaga')
  })

  it('renvoie une chaîne vide pour une entrée vide/undefined', () => {
    expect(normalizeTeamQuery('')).toBe('')
    expect(normalizeTeamQuery(undefined)).toBe('')
  })
})

describe('teamMatchesQuery', () => {
  // Cas FD.org-like : name complet + shortName + tla (PSG).
  const psgFd = { name: 'Paris Saint-Germain FC', shortName: 'Paris SG', tla: 'PSG' }
  // Cas ESPN-like : pas de tla, name/shortName au format ESPN brut (clé de
  // TEAM_NAMES_FR), traduit en "Paris SG" par translateTeam.
  const psgEspn = { name: 'Paris Saint-Germain', shortName: 'PSG', id: '160' }

  it('trouve PSG via le tla FD.org, insensible à la casse', () => {
    expect(teamMatchesQuery(psgFd, normalizeTeamQuery('psg'))).toBe(true)
    expect(teamMatchesQuery(psgFd, normalizeTeamQuery('PSG'))).toBe(true)
  })

  it('trouve PSG via la variante ESPN (shortName "PSG", traduit par teamNames.js)', () => {
    expect(teamMatchesQuery(psgEspn, normalizeTeamQuery('psg'))).toBe(true)
  })

  it('trouve une équipe par un nom complet tapé en partie ("paris" matche Paris Saint-Germain)', () => {
    expect(teamMatchesQuery(psgFd, normalizeTeamQuery('paris'))).toBe(true)
  })

  it('distingue 2 homonymes par mot entier ("madrid" matche les deux, "real" ne matche que le bon")', () => {
    const realMadrid = { name: 'Real Madrid CF', shortName: 'Real Madrid' }
    const atletico   = { name: 'Club Atlético de Madrid', shortName: 'Atlético Madrid' }
    expect(teamMatchesQuery(realMadrid, normalizeTeamQuery('madrid'))).toBe(true)
    expect(teamMatchesQuery(atletico, normalizeTeamQuery('madrid'))).toBe(true)
    expect(teamMatchesQuery(realMadrid, normalizeTeamQuery('real'))).toBe(true)
    expect(teamMatchesQuery(atletico, normalizeTeamQuery('real'))).toBe(false)
  })

  it('ignore les accents de la requête comme du nom ("barca" matche "Barça")', () => {
    const barca = { name: 'FC Barcelona', shortName: 'Barça' }
    expect(teamMatchesQuery(barca, normalizeTeamQuery('barca'))).toBe(true)
  })

  it('ne matche rien pour une requête trop courte (< 2 caractères)', () => {
    expect(teamMatchesQuery(psgFd, normalizeTeamQuery('p'))).toBe(false)
    expect(teamMatchesQuery(psgFd, '')).toBe(false)
  })

  it('renvoie false pour une équipe absente/vide', () => {
    expect(teamMatchesQuery(null, 'psg')).toBe(false)
    expect(teamMatchesQuery({}, 'psg')).toBe(false)
  })
})

describe('teamDisplayName / teamIdentityKey', () => {
  it('donne le même nom affiché et la même clé d\'identité pour PSG, qu\'il vienne de FD.org ou d\'ESPN', () => {
    const psgFd   = { name: 'Paris Saint-Germain FC', shortName: 'Paris SG', tla: 'PSG' }
    const psgEspn = { name: 'Paris Saint-Germain', shortName: 'PSG', id: '160' }
    expect(teamDisplayName(psgFd)).toBe('Paris SG')
    expect(teamDisplayName(psgEspn)).toBe('Paris SG')
    expect(teamIdentityKey(psgFd)).toBe(teamIdentityKey(psgEspn))
  })

  it('distingue bien 2 équipes différentes (Real Madrid vs Atlético Madrid)', () => {
    const realMadrid = { name: 'Real Madrid CF', shortName: 'Real Madrid' }
    const atletico   = { name: 'Club Atlético de Madrid', shortName: 'Atlético Madrid' }
    expect(teamIdentityKey(realMadrid)).not.toBe(teamIdentityKey(atletico))
  })

  it('renvoie une chaîne vide pour une équipe absente', () => {
    expect(teamDisplayName(null)).toBe('')
    expect(teamIdentityKey(null)).toBe('')
  })
})
