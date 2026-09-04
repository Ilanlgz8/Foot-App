import { describe, it, expect } from 'vitest'
import { liveOutcomeFor, reconcileRow, reconcileStandings } from './standingsLive'

const PSG = 524, MON = 548
const enCours = (h, a) => ({
  homeTeam: { id: PSG }, awayTeam: { id: MON },
  score: { fullTime: { home: h, away: a } },
})
// PSG : 2 nuls réels + le match en cours. Ligne saine si le match en cours est
// compté comme une victoire : V1 N2 -> 3 + 2 = 5 pts.
const ligne = (won, draw, lost, points) => ({ team: { id: PSG }, won, draw, lost, points })

describe('liveOutcomeFor', () => {
  it('lit l’issue du point de vue de chaque équipe', () => {
    expect(liveOutcomeFor(enCours(1, 0), PSG)).toBe('W')
    expect(liveOutcomeFor(enCours(1, 0), MON)).toBe('L')
    expect(liveOutcomeFor(enCours(2, 2), PSG)).toBe('D')
    expect(liveOutcomeFor(enCours(2, 2), MON)).toBe('D')
  })
  it('renvoie null si le score ou l’équipe manquent', () => {
    expect(liveOutcomeFor(enCours(null, null), PSG)).toBeNull()
    expect(liveOutcomeFor(enCours(1, 0), 999)).toBeNull()
    expect(liveOutcomeFor(null, PSG)).toBeNull()
  })
})

describe('reconcileRow — ne touche pas à une ligne saine', () => {
  it('laisse la ligne telle quelle, à l’identique (même référence)', () => {
    const r = ligne(1, 2, 0, 5)          // 3x1 + 2 = 5 : cohérent
    expect(reconcileRow(r, 'W')).toBe(r)
  })
  it('ne fait rien sans match en cours', () => {
    const r = ligne(0, 3, 0, 5)
    expect(reconcileRow(r, null)).toBe(r)
  })
  it('ne fait rien sur des données non numériques', () => {
    const r = { team: { id: PSG }, won: null, draw: 2, lost: 0, points: 5 }
    expect(reconcileRow(r, 'W')).toBe(r)
  })
})

describe('reconcileRow — le cas décrit par l’utilisateur', () => {
  it('victoire en cours comptée comme un nul : -1 nul, +1 victoire', () => {
    // 5 pts affichés (donc la victoire est comptée), mais V0 N3 -> 3 pts.
    const r = reconcileRow(ligne(0, 3, 0, 5), 'W')
    expect([r.won, r.draw, r.lost]).toEqual([1, 2, 0])
    expect(r.points).toBe(5)                       // les points ne bougent pas
    expect(3 * r.won + r.draw).toBe(r.points)      // ligne redevenue cohérente
  })

  it('score revenu au nul alors qu’une victoire était comptée : -1 victoire, +1 nul', () => {
    // C'est le second cas qu'il décrit explicitement.
    const r = reconcileRow(ligne(1, 2, 0, 3), 'D')
    expect([r.won, r.draw, r.lost]).toEqual([0, 3, 0])
    expect(3 * r.won + r.draw).toBe(r.points)
  })

  it('victoire en cours comptée comme une défaite', () => {
    const r = reconcileRow(ligne(0, 2, 1, 5), 'W')
    expect([r.won, r.draw, r.lost]).toEqual([1, 2, 0])
  })

  it('nul en cours compté comme une défaite', () => {
    const r = reconcileRow(ligne(1, 1, 1, 5), 'D')
    expect([r.won, r.draw, r.lost]).toEqual([1, 2, 0])
  })

  it('défaite en cours comptée comme une victoire', () => {
    const r = reconcileRow(ligne(2, 1, 0, 4), 'L')
    expect([r.won, r.draw, r.lost]).toEqual([1, 1, 1])
  })

  it('défaite en cours comptée comme un nul', () => {
    const r = reconcileRow(ligne(1, 2, 0, 4), 'L')
    expect([r.won, r.draw, r.lost]).toEqual([1, 1, 1])
  })
})

describe('reconcileRow — s’abstient quand la déduction n’est pas sûre', () => {
  it('écart inexplicable par un seul match mal rangé (pénalité de points)', () => {
    const r = ligne(2, 0, 1, 1)   // écart -5 : aucune issue ne l'explique
    expect(reconcileRow(r, 'W')).toBe(r)
  })
  it('la case supposée erronée est vide : on ne décrémente pas en négatif', () => {
    const r = ligne(0, 0, 0, 2)   // écart +2 -> il faudrait retirer un nul, il n'y en a pas
    expect(reconcileRow(r, 'W')).toBe(r)
  })
})

describe('reconcileStandings', () => {
  it('ne corrige que les équipes qui jouent', () => {
    const rows = [ligne(0, 3, 0, 5), { team: { id: 999 }, won: 0, draw: 3, lost: 0, points: 5 }]
    const out = reconcileStandings(rows, [enCours(1, 0)])
    expect(out[0].won).toBe(1)
    expect(out[1]).toBe(rows[1])        // intacte, aucune copie
  })
  it('renvoie le tableau tel quel sans match en cours', () => {
    const rows = [ligne(0, 3, 0, 5)]
    expect(reconcileStandings(rows, [])).toBe(rows)
    expect(reconcileStandings(rows, null)).toBe(rows)
  })
  it('tolère un tableau vide ou absent', () => {
    expect(reconcileStandings([], [enCours(1, 0)])).toEqual([])
    expect(reconcileStandings(null, [enCours(1, 0)])).toBeNull()
  })
})
