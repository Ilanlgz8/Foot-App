import { describe, it, expect } from 'vitest'
import { buildMorningMessage, isClassico } from './morningMessage.js'

const T = (name, names, extra = {}) => ({ name, names, ...extra })
const base = { utcDate: '2026-11-28T20:00:00Z', hhmm: '21:00' }

describe('buildMorningMessage', () => {
  it('classico : PSG-OM, avec le classement', () => {
    const m = buildMorningMessage({ ...base, slug: 'fra.1', home: T('Paris SG', ['PSG', 'Paris Saint-Germain'], { rank: 1, points: 26 }), away: T('Marseille', ['Marseille'], { rank: 5, points: 18 }) })
    expect(m.kind).toBe('classico')
    expect(m.home.title).toBe("C'est le classico ce soir")
    expect(m.home.body).toBe('Paris SG  21:00  Marseille\n1er contre 5e en Ligue 1.')
  })
  it('pas de classico pour Liverpool-Everton', () => {
    expect(isClassico(T('Liverpool', ['Liverpool']), T('Everton', ['Everton']))).toBe(false)
    expect(isClassico(T('Man City', ['Manchester City']), T('Arsenal', ['Arsenal']))).toBe(true)
    expect(isClassico(T('Real Madrid', ['Real Madrid']), T('Barcelone', ['Barcelona']))).toBe(true)
    expect(isClassico(T('Inter', ['Internazionale']), T('Milan', ['AC Milan']))).toBe(true)
    expect(isClassico(T('Bayern', ['Bayern Munich']), T('Dortmund', ['Borussia Dortmund']))).toBe(true)
    // seulement les 5 classicos choisis : pas de croisement entre grands clubs, pas de sélections
    expect(isClassico(T('Real Madrid', ['Real Madrid']), T('Paris SG', ['Paris Saint-Germain']))).toBe(false)
    expect(isClassico(T('Liverpool', ['Liverpool']), T('Man City', ['Manchester City']))).toBe(false)
    expect(isClassico(T('Lyon', ['Lyon']), T('Marseille', ['Marseille']))).toBe(false)
    expect(isClassico(T('France', ['France']), T('Brésil', ['Brazil']))).toBe(false)
  })
  it('coupe : titre selon l’équipe suivie', () => {
    const m = buildMorningMessage({ ...base, slug: 'fra.coupe_de_france', utcDate: '2026-12-20T20:00:00Z', home: T('Lens', ['Lens']), away: T('Lille', ['Lille']) })
    expect(m.kind).toBe('cup')
    expect(m.home.title).toBe('Lens joue sa qualification ce soir')
    expect(m.away.title).toBe('Lille joue sa qualification ce soir')
    expect(m.home.body).toContain('Coupe de France. Le vainqueur passe au tour suivant.')
  })
  it('choc au sommet : top 4 et 3 points max', () => {
    const m = buildMorningMessage({ ...base, slug: 'fra.1', home: T('Paris FC', ['Paris FC'], { rank: 2, points: 23 }), away: T('Lille', ['Lille'], { rank: 3, points: 21 }) })
    expect(m.kind).toBe('top')
    expect(m.home.body).toBe("Paris FC  21:00  Lille\n2e contre 3e en Ligue 1, 2 points d'écart.")
  })
  it('série de 5 victoires pour l’équipe suivie seulement', () => {
    const m = buildMorningMessage({ ...base, slug: 'fra.1', home: T('Lorient', ['Lorient'], { rank: 10, points: 16, form: 'LDWDW' }), away: T('Brest', ['Brest'], { rank: 6, points: 18, form: 'WWWWW' }) })
    expect(m.kind).toBe('default')
    expect(m.away.title).toBe('Brest reste sur 5 victoires')
    expect(m.home.title).toBe('Jour de match pour Lorient')
    expect(m.home.body).toBe('Lorient  21:00  Brest\nLigue 1 · À regarder sur Ligue 1+')
  })
  it('repli sans données : jamais de ligne vide ni d’emoji', () => {
    const m = buildMorningMessage({ ...base, slug: 'xxx.unknown', home: T('A', ['A']), away: T('B', ['B']) })
    expect(m.home).toEqual({ title: 'Jour de match pour A', body: 'A  21:00  B' })
    expect(JSON.stringify(m)).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
