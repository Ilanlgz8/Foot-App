import { describe, it, expect } from 'vitest'
import { buildMorningMessage, isClassico, safeStake, roundFromCalendar, phraseName } from './morningMessage.js'

const T = (name, names, extra = {}) => ({ name, names, ...extra })
const base = { utcDate: '2026-11-25T20:00:00Z', hhmm: '21:00' }

// Classement réel de Ligue des champions du 25/11 (extrait fidèle des 36 : id, pos, pts, joués, diff, V, D)
const CL = [
  [86, 1, 15, 5, 10, 5, 0], [160, 2, 12, 4, 15, 4, 0], [2572, 3, 12, 5, 14, 4, 1], [244, 4, 12, 5, 4, 4, 1], [359, 5, 11, 5, 5, 3, 0],
  [382, 6, 10, 5, 5, 3, 1], [124, 7, 10, 5, 2, 3, 1], [83, 8, 9, 4, 8, 3, 1], [362, 9, 9, 5, 5, 3, 2], [364, 10, 9, 4, 4, 3, 1],
  [570, 11, 9, 4, 4, 3, 1], [2250, 12, 9, 4, 4, 3, 1], [432, 13, 9, 5, 0, 3, 2], [132, 14, 8, 4, 7, 2, 0], [134, 15, 7, 4, 3, 2, 1],
  [2980, 16, 7, 5, -4, 2, 2], [110, 17, 6, 4, 2, 2, 2], [4411, 18, 6, 5, 0, 2, 3], [360, 19, 6, 4, 0, 2, 2], [437, 20, 6, 5, 0, 2, 3],
  [11420, 21, 6, 5, -4, 2, 3], [436, 22, 5, 4, -5, 1, 1], [104, 23, 4, 4, 2, 1, 2], [493, 24, 4, 4, 0, 1, 2], [510, 25, 4, 4, -1, 1, 2],
  [1068, 26, 4, 4, -1, 1, 2], [114, 27, 4, 5, -5, 1, 3], [148, 28, 4, 5, -5, 1, 3], [102, 29, 3, 4, -6, 1, 3], [21922, 30, 3, 4, -6, 1, 3],
  [887, 31, 3, 5, -7, 1, 4], [142, 32, 3, 5, -8, 1, 4], [175, 33, 3, 5, -14, 1, 4], [494, 34, 1, 4, -4, 0, 3], [166, 35, 1, 4, -6, 0, 3],
  [521, 36, 0, 5, -18, 0, 5],
].map(([id, position, points, played, gd, won, lost]) => ({ id: String(id), position, points, played, gd, won, lost, name: String(id) }))
CL.find(r => r.id === '86').name = 'Real Madrid'; CL.find(r => r.id === '2980').name = 'Bodo/Glimt'
// équipes qui jouent le 25/11 (le Real a joué le 24)
const TODAY_CL = new Set(['21922', '83', '494', '102', '1068', '510', '570', '364', '110', '134', '166', '132', '160', '104', '493', '436', '2250', '360'])

describe('buildMorningMessage', () => {
  it('PSG – Rome (réel) : titre, chaîne, et « prend la tête » sûr (Real ne joue pas, diff. de buts)', () => {
    const m = buildMorningMessage({ ...base, slug: 'uefa.champions', table: CL, playingToday: TODAY_CL,
      home: T('Paris SG', ['Paris Saint-Germain', 'PSG'], { id: '160' }), away: T('Rome', ['AS Roma'], { id: '104' }) })
    expect(m.home.title).toBe('Le PSG reçoit l\'AS Rome en Ligue des champions')
    expect(m.home.body).toBe('Ce soir à 21:00 · À regarder sur CANAL+\nUne victoire et le PSG prend la tête.')
    expect(m.away.title).toBe('L\'AS Rome défie le PSG en Ligue des champions')
    // Rome (23e, 4 pts) qui gagne → 7 pts : passe devant Bodo/Glimt (16e, 7 pts, diff. -4, a joué hier)
    expect(m.away.body).toBe('Ce soir à 21:00 · À regarder sur CANAL+\nUne victoire et l\'AS Rome passe devant Bodo/Glimt.')
  })
  it('jamais « passe devant » une équipe qui joue encore aujourd’hui', () => {
    // Barça (8e, 9 pts) joue aujourd'hui → Bayern (14e, 8 pts) qui gagne ne peut pas annoncer le dépasser
    const st = safeStake('uefa.champions', CL, '132', '166', TODAY_CL)
    expect(st?.target?.id).not.toBe('83')
  })
  it('égalité de points sans départage sûr = pas d’annonce (Liga : confrontations directes)', () => {
    const t = [[1, 1, 30, 12, 10], [2, 2, 27, 12, 20], [3, 3, 20, 12, 0], [4, 4, 10, 12, 0]].map(([id, position, points, played, gd]) => ({ id: String(id), position, points, played, gd }))
    expect(safeStake('esp.1', t, '2', '3', new Set(['2', '3']))).toBe(null)
    expect(safeStake('eng.1', t, '2', '3', new Set(['2', '3']))?.type).toBe('lead')
  })
  it('qualification / élimination seulement quand c’est mathématiquement sûr', () => {
    // fin de phase de ligue : 7 matchs joués sur 8 ; l'équipe 1 (19 pts) : une victoire → 22, personne d'autre ne peut l'atteindre au-delà du top 7
    const t = Array.from({ length: 36 }, (_, i) => ({ id: String(i + 1), position: i + 1, points: 21 - Math.floor(i / 2), played: 7, gd: 0 }))
    const me = t[8]                      // 9e, 17 pts
    me.points = 17
    expect(safeStake('uefa.champions', t, me.id, '36', new Set()))?.not?.toEqual?.({ type: 'top8' })
    // élimination : 30e à 6 pts, 1 match restant → max 6 ; 24 équipes ont déjà plus de 6 pts → éliminé en cas de défaite
    const elim = Array.from({ length: 36 }, (_, i) => ({ id: String(i + 1), position: i + 1, points: i < 24 ? 10 : 6, played: 7, gd: 0 }))
    expect(safeStake('uefa.champions', elim, '30', '36', new Set())).toEqual({ type: 'out' })
  })
  it('championnat : champion sûr avec une victoire', () => {
    const t = [[1, 1, 80, 37, 40], [2, 2, 76, 37, 30], [3, 3, 60, 37, 0], [4, 4, 40, 37, 0], [5, 5, 30, 37, 0]].map(([id, position, points, played, gd]) => ({ id: String(id), position, points, played, gd }))
    // n=5 → 8 matchs au total... on se place sur une vraie Premier League (20 équipes)
    const pl = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), position: i + 1, points: i === 0 ? 85 : 82 - i * 3, played: 37, gd: 0 }))
    const m = buildMorningMessage({ ...base, slug: 'eng.1', table: pl, playingToday: new Set(['1', '20']),
      home: T('Arsenal', ['Arsenal'], { id: '1' }), away: T('Burnley', ['Burnley'], { id: '20' }) })
    expect(m.home.body).toContain('Une victoire et Arsenal est champion.')
    void t
  })
  it('coupe à match unique : le tour suivant / le trophée', () => {
    const m = buildMorningMessage({ ...base, slug: 'fra.coupe_de_france', utcDate: '2027-02-10T20:00:00Z', roundLabel: 'Rd of 16', home: T('Lens', ['Lens']), away: T('Lille', ['Lille']) })
    expect(m.home.title).toBe('Lens reçoit Lille en 8es de finale de Coupe de France')
    expect(m.home.body).toBe('Ce soir à 21:00 · À regarder sur beIN Sports\nUne victoire et Lens file en quarts.')
    const f = buildMorningMessage({ ...base, slug: 'fra.coupe_de_france', utcDate: '2027-05-22T19:00:00Z', hhmm: '21:00', roundLabel: 'Final', home: T('Lens', ['Lens']), away: T('Lille', ['Lille']) })
    expect(f.away.body).toContain('Une victoire et Lille remporte la Coupe de France.')
  })
  it('classico, fait marquant, et repli sans emoji', () => {
    expect(isClassico(T('Liverpool', ['Liverpool']), T('Everton', ['Everton']))).toBe(false)
    expect(isClassico(T('Inter', ['Internazionale']), T('Milan', ['AC Milan']))).toBe(true)
    const c = buildMorningMessage({ ...base, slug: 'fra.1', home: T('Paris SG', ['Paris Saint-Germain']), away: T('Marseille', ['Marseille']) })
    expect(c.home.title).toBe("C'est le classico : le PSG reçoit l'OM")
    const r = buildMorningMessage({ ...base, slug: 'xxx', hhmm: '15:00', home: T('A', ['A']), away: T('B', ['B']) })
    expect(r.home).toEqual({ title: 'A reçoit B', body: 'Cet après-midi à 15:00' })
    expect(JSON.stringify([c, r])).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(phraseName(T('Rome', ['AS Roma']))).toBe("l'AS Rome")
  })
  it('tour d’après le calendrier ESPN', () => {
    const cal = [{ entries: [{ label: 'Rd of 16', startDate: '2027-02-03T08:00Z', endDate: '2027-03-03T07:59Z' }] }]
    expect(roundFromCalendar(cal, '2027-02-10T20:00:00Z')).toBe('Rd of 16')
  })
})
