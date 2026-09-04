import { describe, it, expect } from 'vitest'
import { repairMatchStatus, bodyHasBrokenStatus, repairFdBody } from './fdRepair'

const KICKOFF = '2026-08-28T18:45:00Z'
const T_KICK  = Date.parse(KICKOFF)
// La forme exacte observée en production : une date, pas un statut.
const CASSE   = '2026-08-28 17:45:00Z'

const match = (over = {}) => ({
  id: 559702,
  utcDate: KICKOFF,
  status: CASSE,
  matchday: 2,
  score: { fullTime: { home: 2, away: 2 } },
  ...over,
})

describe('repairMatchStatus — ne touche pas à ce qui va bien', () => {
  it('laisse un statut valide strictement intact (même référence)', () => {
    for (const s of ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'FINISHED',
                     'POSTPONED', 'SUSPENDED', 'CANCELLED', 'AWARDED']) {
      const m = match({ status: s })
      expect(repairMatchStatus(m, T_KICK)).toBe(m)   // toBe : aucune copie
    }
  })

  it('supporte null / undefined', () => {
    expect(repairMatchStatus(null)).toBeNull()
    expect(repairMatchStatus(undefined)).toBeUndefined()
  })
})

describe('repairMatchStatus — reconstruit un statut invalide', () => {
  it('match joué et scoré → FINISHED (cas de la forme récente)', () => {
    const r = repairMatchStatus(match(), T_KICK + 4 * 3600_000)
    expect(r.status).toBe('FINISHED')
    expect(r._statusRepaired).toBe(true)
  })

  it('match pas encore commencé → TIMED (cas de Programme)', () => {
    const r = repairMatchStatus(match({ score: { fullTime: { home: null, away: null } } }),
                                T_KICK - 48 * 3600_000)
    expect(r.status).toBe('TIMED')
  })

  it('match commencé il y a 30 min → IN_PLAY, pas FINISHED', () => {
    const r = repairMatchStatus(match({ score: { fullTime: { home: 1, away: 0 } } }),
                                T_KICK + 30 * 60_000)
    expect(r.status).toBe('IN_PLAY')
  })

  it('commencé depuis longtemps mais SANS score → TIMED, on n’invente pas un résultat', () => {
    const r = repairMatchStatus(match({ score: { fullTime: { home: null, away: null } } }),
                                T_KICK + 10 * 3600_000)
    expect(r.status).toBe('TIMED')
  })

  it('un score à 0-0 compte comme un vrai score', () => {
    const r = repairMatchStatus(match({ score: { fullTime: { home: 0, away: 0 } } }),
                                T_KICK + 4 * 3600_000)
    expect(r.status).toBe('FINISHED')
  })

  it('utcDate illisible → TIMED, jamais de crash', () => {
    const r = repairMatchStatus(match({ utcDate: 'n’importe quoi' }), T_KICK)
    expect(r.status).toBe('TIMED')
  })

  it('ne modifie aucun autre champ, et ne mute pas l’original', () => {
    const m = match()
    const r = repairMatchStatus(m, T_KICK + 4 * 3600_000)
    expect(m.status).toBe(CASSE)                 // l'entrée reste intacte
    expect(r.id).toBe(559702)
    expect(r.matchday).toBe(2)
    expect(r.score.fullTime).toEqual({ home: 2, away: 2 })
  })
})

describe('bodyHasBrokenStatus — détection bon marché', () => {
  it('repère un statut commençant par un chiffre', () => {
    expect(bodyHasBrokenStatus(JSON.stringify({ status: CASSE }))).toBe(true)
  })
  it('ne se déclenche sur aucun statut valide', () => {
    expect(bodyHasBrokenStatus(JSON.stringify({ status: 'FINISHED' }))).toBe(false)
    expect(bodyHasBrokenStatus(JSON.stringify({ status: 'IN_PLAY' }))).toBe(false)
  })
  it('tolère une entrée non textuelle', () => {
    expect(bodyHasBrokenStatus(null)).toBe(false)
    expect(bodyHasBrokenStatus(42)).toBe(false)
  })
})

describe('repairFdBody', () => {
  it('renvoie le texte À L’IDENTIQUE quand rien n’est cassé', () => {
    const body = JSON.stringify({ matches: [match({ status: 'FINISHED' })] })
    expect(repairFdBody(body)).toBe(body)        // toBe : pas même re-sérialisé
  })

  it('répare une liste de matchs', () => {
    const body = JSON.stringify({ matches: [match(), match({ id: 2 })] })
    const out  = JSON.parse(repairFdBody(body, T_KICK + 4 * 3600_000))
    expect(out.matches.map(m => m.status)).toEqual(['FINISHED', 'FINISHED'])
  })

  it('répare un match seul (/v4/matches/{id})', () => {
    const out = JSON.parse(repairFdBody(JSON.stringify(match()), T_KICK + 4 * 3600_000))
    expect(out.status).toBe('FINISHED')
  })

  it('ne réécrit que les matchs cassés d’une liste mixte', () => {
    const body = JSON.stringify({ matches: [match({ status: 'FINISHED' }), match({ id: 2 })] })
    const out  = JSON.parse(repairFdBody(body, T_KICK + 4 * 3600_000))
    expect(out.matches[0]._statusRepaired).toBeUndefined()
    expect(out.matches[1]._statusRepaired).toBe(true)
  })

  it('préserve le reste de la réponse (compétition, saison…)', () => {
    const body = JSON.stringify({
      competition: { code: 'FL1' },
      season: { currentMatchday: 3 },
      matches: [match()],
    })
    const out = JSON.parse(repairFdBody(body, T_KICK + 4 * 3600_000))
    expect(out.competition.code).toBe('FL1')
    expect(out.season.currentMatchday).toBe(3)
  })

  it('rend le texte tel quel si le JSON est illisible', () => {
    const casse = '{"status":"2026-01-01 00:00:00Z"'
    expect(repairFdBody(casse)).toBe(casse)
  })

  it('rend le texte tel quel sur une forme inattendue', () => {
    const body = JSON.stringify({ status: '2026-01-01 00:00:00Z' })  // pas d'utcDate
    expect(repairFdBody(body)).toBe(body)
  })
})
