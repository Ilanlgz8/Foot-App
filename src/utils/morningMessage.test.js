import { describe, it, expect } from 'vitest'
import { buildMorningMessage, isClassico, stakeIfWin, roundFromCalendar } from './morningMessage.js'

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

  // classement Ligue 1 réel du 24/11 (extrait)
  const L1 = [[160, 1, 26], [6851, 2, 23], [166, 3, 21], [167, 4, 20], [176, 5, 18], [6997, 6, 18], [2502, 7, 17], [170, 14, 11], [180, 16, 10], [7868, 17, 8], [3236, 18, 2]]
    .map(([id, position, points]) => ({ id, position, points }))
  it('enjeu : passer en tête / podium / sortir de la zone rouge, jamais sur une égalité', () => {
    expect(stakeIfWin(L1, 6851)).toBe(null)        // Paris FC 23+3 = 26 = PSG → égalité, rien
    expect(stakeIfWin(L1, 167)).toBe(null)         // Lyon 20+3 = 23 = Paris FC → égalité
    expect(stakeIfWin(L1, 176)).toBe(null)         // OM 18+3 = 21 = Lille → égalité
    expect(stakeIfWin(L1, 7868)).toBe(null)        // Angers 8+3 = 11 = Troyes (14e) → égalité
    const t2 = L1.map(r => (r.id === 166 ? { ...r, points: 24 } : r))
    expect(stakeIfWin(t2, 166)).toBe('lead')        // Lille 24+3 = 27 > 26
    const t3 = L1.map(r => (r.id === 166 ? { ...r, points: 20 } : r))
    expect(stakeIfWin(t3, 176)).toBe('podium')      // OM 18+3 = 21 > Lille 20 et Lyon 20 → 3e
    // zone rouge (classement complet de 18) : le 16e à 10 pts passe à 13 > 12 du 15e
    const full = Array.from({ length: 18 }, (_, i) => ({ id: i + 1, position: i + 1, points: 40 - i * 2 }))
    full[14].points = 12; full[15].points = 10; full[16].points = 8; full[17].points = 2
    expect(stakeIfWin(full, 16)).toBe('safe')
    expect(stakeIfWin(full, 18)).toBe(null)        // 2+3 = 5 : toujours dans la zone
  })
  it('enjeu dans le message, avec la place actuelle', () => {
    const t = L1.map(r => (r.id === 166 ? { ...r, points: 24 } : r))
    const m = buildMorningMessage({ ...base, slug: 'fra.1', table: t,
      home: T('Lille', ['Lille'], { id: 166, rank: 3, points: 24 }), away: T('Nice', ['Nice'], { id: 2502, rank: 7, points: 17 }) })
    expect(m.home.title).toBe('Une victoire et Lille passe en tête')
    expect(m.home.body).toBe('Lille  21:00  Nice\n3e de Ligue 1 · À regarder sur Ligue 1+')
    expect(m.away.title).toBe('Jour de match pour Nice')
  })
  it('tour de coupe d’après le calendrier ESPN', () => {
    const cal = [{ entries: [{ label: 'Rd of 16', startDate: '2027-02-03T08:00Z', endDate: '2027-03-03T07:59Z' }, { label: 'Final', startDate: '2027-05-15T07:00Z', endDate: '2027-08-01T06:59Z' }] }]
    expect(roundFromCalendar(cal, '2027-02-10T20:00:00Z')).toBe('Rd of 16')
    const m = buildMorningMessage({ ...base, slug: 'fra.coupe_de_france', utcDate: '2027-02-10T20:00:00Z', roundLabel: 'Rd of 16', home: T('Lens', ['Lens']), away: T('Lille', ['Lille']) })
    expect(m.home.title).toBe('Lens joue sa place en quarts ce soir')
    expect(m.home.body).toBe('Lens  21:00  Lille\nCoupe de France, 8es de finale · À regarder sur beIN Sports')
    const f = buildMorningMessage({ ...base, slug: 'fra.coupe_de_france', utcDate: '2027-05-22T19:00:00Z', roundLabel: 'Final', home: T('Lens', ['Lens']), away: T('Lille', ['Lille']) })
    expect(f.away.title).toBe('Lille joue la finale ce soir')
  })
})
