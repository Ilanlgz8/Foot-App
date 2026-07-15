// Tests de src/utils/liveDetection.js — logique de détection live partagée
// entre api/cron-goals.js (Vercel) et cf-worker/src/index.js (Cloudflare
// Worker). Couvre en priorité les bugs déjà rencontrés en PRODUCTION cette
// saison (voir les commentaires ⚠️ dans liveDetection.js) : l'objectif est de
// ne jamais les réintroduire silencieusement lors d'un futur changement,
// dans AUCUN des deux fichiers qui importent ce module.
import { describe, it, expect } from 'vitest'
import {
  LIVE_ESPN, FINAL_ESPN, normalizeEspnStatus,
  fuzzyTeamFifa, fifaEffectiveStatus, fifaConfirmsShootoutOver,
  extractEspnScorers, extractEspnCards, generateRecap,
  minuteLabel, dateStr, parseMin,
} from './liveDetection'

describe('normalizeEspnStatus', () => {
  it('laisse passer les statuts connus tels quels', () => {
    expect(normalizeEspnStatus({ type: { name: 'STATUS_IN_PROGRESS' } })).toBe('STATUS_IN_PROGRESS')
    expect(normalizeEspnStatus({ type: { name: 'STATUS_FINAL_PEN' } })).toBe('STATUS_FINAL_PEN')
  })

  // Bug réel constaté en direct sur France-Maroc (quart CM 2026) : ESPN
  // renvoie STATUS_SECOND_HALF, absent de la doc publique et de LIVE_ESPN —
  // sans ce mapping, le match "disparaissait" de la détection live pendant
  // toute la 2e mi-temps (plus aucune notif but/carton/fin).
  it('mappe STATUS_FIRST_HALF/STATUS_SECOND_HALF vers STATUS_IN_PROGRESS', () => {
    expect(normalizeEspnStatus({ type: { name: 'STATUS_FIRST_HALF' } })).toBe('STATUS_IN_PROGRESS')
    expect(normalizeEspnStatus({ type: { name: 'STATUS_SECOND_HALF' } })).toBe('STATUS_IN_PROGRESS')
  })

  it('retombe sur type.state pour un statut totalement inconnu', () => {
    expect(normalizeEspnStatus({ type: { name: 'STATUS_MYSTERE', state: 'in' } })).toBe('STATUS_IN_PROGRESS')
    expect(normalizeEspnStatus({ type: { name: 'STATUS_MYSTERE', state: 'post' } })).toBe('STATUS_FINAL')
    expect(normalizeEspnStatus({ type: { name: 'STATUS_MYSTERE', state: 'pre' } })).toBe('STATUS_MYSTERE')
  })

  it('retombe sur STATUS_SCHEDULED si rien n\'est exploitable', () => {
    expect(normalizeEspnStatus(undefined)).toBe('STATUS_SCHEDULED')
    expect(normalizeEspnStatus({})).toBe('STATUS_SCHEDULED')
  })
})

describe('LIVE_ESPN / FINAL_ESPN', () => {
  // Bug réel : un match décidé en prolongation/tab ne renvoie JAMAIS
  // STATUS_FINAL côté ESPN — sans STATUS_FINAL_AET/STATUS_FINAL_PEN dans
  // FINAL_ESPN, la notif "fin de match" ne partait jamais pour ces matchs,
  // et la notif "coup d'envoi" se redéclenchait des heures après la fin
  // réelle (root cause du bug "carton reçu à 3h du mat'").
  it('reconnaît les fins de match en prolongation/tab comme réellement finales', () => {
    expect(FINAL_ESPN.has('STATUS_FINAL_AET')).toBe(true)
    expect(FINAL_ESPN.has('STATUS_FINAL_PEN')).toBe(true)
  })

  it('ne considère jamais un statut FINAL comme LIVE', () => {
    for (const s of FINAL_ESPN) expect(LIVE_ESPN.has(s)).toBe(false)
  })
})

describe('fuzzyTeamFifa', () => {
  it('matche un nom identique', () => {
    expect(fuzzyTeamFifa('France', 'France')).toBe(true)
  })
  it('matche via préfixe (accents/variantes ESPN vs FIFA)', () => {
    expect(fuzzyTeamFifa('Corée du Sud', 'Coree du Sud')).toBe(true)
  })
  it('ne matche pas 2 équipes différentes', () => {
    expect(fuzzyTeamFifa('France', 'Argentine')).toBe(false)
  })
  it('renvoie false si un des deux noms est vide', () => {
    expect(fuzzyTeamFifa('', 'France')).toBe(false)
    expect(fuzzyTeamFifa('France', undefined)).toBe(false)
  })
})

describe('fifaEffectiveStatus', () => {
  it('renvoie null avant le coup d\'envoi (Period 0)', () => {
    expect(fifaEffectiveStatus({ MatchStatus: 1, Period: 0 })).toBeNull()
  })
  it('renvoie null si le match n\'est pas en cours (MatchStatus != 1)', () => {
    expect(fifaEffectiveStatus({ MatchStatus: 0, Period: 1 })).toBeNull()
    expect(fifaEffectiveStatus({ MatchStatus: 3, Period: 1 })).toBeNull()
  })
  it('détecte la mi-temps (Period 3 ou 5)', () => {
    expect(fifaEffectiveStatus({ MatchStatus: 1, Period: 3 })).toBe('STATUS_HALFTIME')
    expect(fifaEffectiveStatus({ MatchStatus: 1, Period: 5 })).toBe('STATUS_HALFTIME')
  })
  it('renvoie IN_PROGRESS pour toute autre période en cours', () => {
    expect(fifaEffectiveStatus({ MatchStatus: 1, Period: 1 })).toBe('STATUS_IN_PROGRESS')
    expect(fifaEffectiveStatus({ MatchStatus: 1, Period: 7 })).toBe('STATUS_IN_PROGRESS')
  })
})

describe('fifaConfirmsShootoutOver', () => {
  it('confirme uniquement MatchStatus=3 ET Period=8', () => {
    expect(fifaConfirmsShootoutOver({ MatchStatus: 3, Period: 8 })).toBe(true)
    expect(fifaConfirmsShootoutOver({ MatchStatus: 3, Period: 7 })).toBe(false)
    expect(fifaConfirmsShootoutOver({ MatchStatus: 1, Period: 8 })).toBe(false)
  })
})

describe('extractEspnScorers', () => {
  const homeId = 'h1'

  // Bug réel constaté : "les buts marqués sur penalty, le buteur ne
  // s'affiche pas" — causé par une égalité stricte `txt === 'penaltykick'`
  // alors qu'ESPN libelle ce type d'événement avec un espace/tiret réel
  // ("Penalty - Scored").
  it('détecte un but sur penalty malgré le libellé avec espace/tiret', () => {
    const comp = { details: [{
      type: { text: 'Penalty - Scored', id: '' },
      clock: { displayValue: '45:00' },
      team: { id: homeId },
      athletesInvolved: [{ shortName: 'Mbappé' }],
    }] }
    const scorers = extractEspnScorers(comp, homeId)
    expect(scorers).toHaveLength(1)
    expect(scorers[0]).toMatchObject({ name: 'Mbappé', team: 'home', penaltyKick: true })
  })

  it('exclut un penalty raté', () => {
    const comp = { details: [{
      type: { text: 'Penalty - Missed', id: '' },
      team: { id: homeId },
    }] }
    expect(extractEspnScorers(comp, homeId)).toHaveLength(0)
  })

  it('affecte le bon camp (home/away)', () => {
    const comp = { details: [
      { type: { text: 'Goal', id: '' }, team: { id: homeId }, clock: { displayValue: '10:00' }, athletesInvolved: [{ shortName: 'A' }] },
      { type: { text: 'Goal', id: '' }, team: { id: 'away1' }, clock: { displayValue: '20:00' }, athletesInvolved: [{ shortName: 'B' }] },
    ] }
    const scorers = extractEspnScorers(comp, homeId)
    expect(scorers.map(s => s.team)).toEqual(['home', 'away'])
  })
})

describe('extractEspnCards', () => {
  it('détecte un carton rouge (id 93) et le distingue du jaune (id 94)', () => {
    const comp = { details: [
      { type: { id: '93' }, team: { id: 'h1' }, clock: { displayValue: '60:00' }, athletesInvolved: [{ shortName: 'X' }] },
      { type: { id: '94' }, team: { id: 'h1' }, clock: { displayValue: '61:00' }, athletesInvolved: [{ shortName: 'Y' }] },
    ] }
    const cards = extractEspnCards(comp, 'h1')
    expect(cards).toHaveLength(2)
    expect(cards.find(c => c.name === 'X').red).toBe(true)
    expect(cards.find(c => c.name === 'Y').red).toBe(false)
  })
})

describe('generateRecap', () => {
  const base = { homeTeam: 'France', awayTeam: 'Argentine', scorers: [], cards: [] }

  it('renvoie null si le score est incomplet (aucune approximation inventée)', () => {
    expect(generateRecap({ ...base, home: null, away: 2 })).toBeNull()
    expect(generateRecap({ ...base, home: 1, away: undefined })).toBeNull()
  })

  it('décrit un match nul 0-0 distinctement d\'un nul avec buts', () => {
    expect(generateRecap({ ...base, home: 0, away: 0 })).toContain('0-0')
    expect(generateRecap({ ...base, home: 2, away: 2 })).toContain('2-2')
  })

  it('mentionne une victoire large (écart >= 3)', () => {
    const recap = generateRecap({ ...base, home: 4, away: 0 })
    expect(recap).toContain('largement')
    expect(recap).toContain('France')
  })

  it('liste les buteurs triés par minute', () => {
    const recap = generateRecap({
      ...base, home: 2, away: 0,
      scorers: [
        { name: 'B', minute: '60\'', team: 'home' },
        { name: 'A', minute: '10\'', team: 'home' },
      ],
    })
    expect(recap.indexOf('A')).toBeLessThan(recap.indexOf('B'))
  })

  it('mentionne un carton rouge unique avec le nom du joueur', () => {
    const recap = generateRecap({
      ...base, home: 1, away: 0,
      cards: [{ name: 'Dupont', minute: '70\'', team: 'away', red: true }],
    })
    expect(recap).toContain('Dupont')
    expect(recap).toContain('carton rouge')
  })
})

describe('formatage', () => {
  it('minuteLabel extrait les minutes depuis le format MM:SS ESPN', () => {
    expect(minuteLabel('34:00')).toBe("34'")
    expect(minuteLabel('90:00')).toBe("90'")
    expect(minuteLabel(null)).toBe('')
  })

  it('dateStr formate en YYYYMMDD', () => {
    expect(dateStr(new Date(2026, 6, 15))).toBe('20260715') // mois JS 0-indexé (juillet=6)
  })

  it('parseMin extrait un nombre depuis un texte de minute', () => {
    expect(parseMin("45'")).toBe(45)
    // Implémentation existante (inchangée) : tous les chiffres du texte sont
    // concaténés, "90'+3'" donne donc 903, pas 90 — comportement de
    // production actuel, ce test fige juste ce qui existe déjà.
    expect(parseMin("90'+3'")).toBe(903)
    expect(parseMin(null)).toBe(0)
  })
})
