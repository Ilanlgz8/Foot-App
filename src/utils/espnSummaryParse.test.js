// Tests de src/utils/espnSummaryParse.js — logique de compaction du summary
// ESPN partagée entre le SERVEUR (api/espn.js, ce qui est mis en cache Redis
// et renvoyé au client) et le CLIENT (repli scoreboard brut dans
// useEspnMatchDetail.js/useMatchDetail.js quand le mapping rapide échoue).
// Les payloads de test reprennent la forme réelle vérifiée en direct sur la
// finale CM 2026 (eventId=760517, Espagne 1-0 Argentine ap.) et la petite
// finale (eventId=760516, France 4-6 Angleterre) — voir les commentaires
// ⚠️ BUG CORRIGÉ dans espnSummaryParse.js pour le détail des bugs réels que
// ces tests figent.
import { describe, it, expect } from 'vitest'
import { extractMatchDetails, parseEspnRoster, compactEspnSummary, normalize, fuzzyTeam } from './espnSummaryParse'

// ⚠️ Tests ajoutés (audit période creuse) pour figer le comportement de
// normalize()/fuzzyTeam() — cette paire existait en 3 copies dont une avait
// divergé silencieusement (api/fifa-live.js, corrigé en important celle-ci) :
// elle supprimait les espaces AVANT de découper en mots, transformant un nom
// en 2 mots comme "Ivory Coast" en un seul bloc "ivorycoast" au lieu de deux
// mots "ivory"/"coast" comparés séparément — cassait le rapprochement pour
// tout nom d'équipe composé de plusieurs mots. Ces tests couvrent
// spécifiquement ce cas pour qu'une future modification ne puisse plus
// réintroduire cette régression sans faire échouer la suite.
describe('normalize', () => {
  it('met en minuscule et retire les accents français courants', () => {
    expect(normalize('RÉPUBLIQUE Tchèque')).toBe('republique tcheque')
  })

  it('conserve les espaces (nécessaire pour le découpage en mots de fuzzyTeam)', () => {
    expect(normalize('Ivory Coast')).toBe('ivory coast')
  })
})

describe('fuzzyTeam', () => {
  it('matche un nom en 2 mots identique de part et d\'autre', () => {
    expect(fuzzyTeam('Ivory Coast', 'Ivory Coast')).toBe(true)
  })

  it('matche via le préfixe direct (nom court vs nom complet)', () => {
    expect(fuzzyTeam('Argentina', 'Argentine')).toBe(true)
  })

  it('matche via un mot commun de 4+ lettres même si le reste diffère', () => {
    // Cas réel qui distingue les 2 implémentations : sans le découpage par
    // mot (espaces conservés avant split), "South Korea" vs "Korea Republic"
    // ne partagerait aucun préfixe direct de 5 caractères, mais partage bien
    // le mot "korea" — doit matcher via la comparaison mot à mot.
    expect(fuzzyTeam('South Korea', 'Korea Republic')).toBe(true)
  })

  it('ne matche pas 2 équipes réellement différentes', () => {
    expect(fuzzyTeam('France', 'Germany')).toBe(false)
  })

  it('renvoie false si un des deux noms est vide/absent', () => {
    expect(fuzzyTeam('', 'Norway')).toBe(false)
    expect(fuzzyTeam('Norway', undefined)).toBe(false)
  })
})

const homeTeam = { id: '11', displayName: 'Spain', color: '1e40af', alternateColor: 'ffffff' }
const awayTeam = { id: '22', displayName: 'Argentina' }

function makeComp({ details = [], statsHome = [], statsAway = [] } = {}) {
  return {
    competitors: [
      { homeAway: 'home', team: homeTeam, statistics: statsHome },
      { homeAway: 'away', team: awayTeam, statistics: statsAway },
    ],
    details,
  }
}

describe('extractMatchDetails — buts et cartons', () => {
  it('extrait un but avec athletesInvolved (pas participants.athlete, absent en pratique)', () => {
    const comp = makeComp({
      details: [
        { scoringPlay: true, team: { id: '11' }, clock: { displayValue: "106'" }, athletesInvolved: [{ shortName: 'F. Torres' }] },
      ],
    })
    const { scorers, cards } = extractMatchDetails(comp, '11')
    expect(scorers).toEqual([{ name: 'F. Torres', minute: "106'", team: 'home', ownGoal: false, penaltyKick: false }])
    expect(cards).toEqual([])
  })

  it('déduit un carton (jaune ou rouge) de scoringPlay:false, via le flag redCard', () => {
    const comp = makeComp({
      details: [
        { scoringPlay: false, redCard: true, team: { id: '22' }, clock: { displayValue: "90+3'" }, athletesInvolved: [{ shortName: 'E. Fernández' }] },
        { scoringPlay: false, redCard: false, team: { id: '22' }, clock: { displayValue: "41'" }, athletesInvolved: [{ shortName: 'L. Martínez' }] },
      ],
    })
    const { cards } = extractMatchDetails(comp, '11')
    expect(cards).toEqual([
      { name: 'E. Fernández', minute: "90+3'", team: 'away', red: true },
      { name: 'L. Martínez', minute: "41'", team: 'away', red: false },
    ])
  })

  // Bug réel corrigé cette session (constat utilisateur : noms "?" dans la
  // timeline) : le champ réel est athletesInvolved[0], jamais
  // participants[0].athlete pour ce payload.
  it('retombe sur "?" si ni athletesInvolved ni participants ne sont présents', () => {
    const comp = makeComp({ details: [{ scoringPlay: true, team: { id: '11' }, clock: { displayValue: "1'" } }] })
    expect(extractMatchDetails(comp, '11').scorers[0].name).toBe('?')
  })

  it('ajoute les jaunes manquants depuis commentary sans dupliquer ceux déjà dans details', () => {
    const comp = makeComp({
      details: [
        { scoringPlay: false, redCard: false, team: { id: '22' }, clock: { displayValue: "41'" }, athletesInvolved: [{ shortName: 'L. Martínez' }] },
      ],
    })
    const commentary = [
      // Déjà présent dans details (même minute/nom) → ne doit pas être dupliqué
      { play: { type: { id: '94' }, clock: { displayValue: "41'" }, team: { displayName: 'Argentina' }, participants: [{ athlete: { shortName: 'L. Martínez' } }] } },
      // Absent de details → doit être ajouté
      { play: { type: { id: '94' }, clock: { displayValue: "44'" }, team: { displayName: 'Spain' }, participants: [{ athlete: { displayName: 'Breel Embolo' } }] } },
    ]
    const { cards } = extractMatchDetails(comp, '11', commentary)
    expect(cards).toHaveLength(2)
    expect(cards[1]).toEqual({ name: 'B. Embolo', minute: "44'", team: 'home', red: false })
  })
})

describe('extractMatchDetails — stats', () => {
  it('accepte les deux noms de champ possibles pour les corners (wonCorners scoreboard vs corners summary)', () => {
    const withWonCorners = makeComp({ statsHome: [{ name: 'wonCorners', displayValue: '7' }], statsAway: [] })
    const withCorners    = makeComp({ statsHome: [{ name: 'corners', displayValue: '7' }], statsAway: [] })
    expect(extractMatchDetails(withWonCorners, '11').stats.home.corners).toBe(7)
    expect(extractMatchDetails(withCorners, '11').stats.home.corners).toBe(7)
  })

  it('calcule passPct/tacklePct/etc à partir des compteurs bruts (pas depuis un champ *Pct ESPN)', () => {
    const comp = makeComp({
      statsHome: [
        { name: 'totalPasses', displayValue: '853' },
        { name: 'accuratePasses', displayValue: '768' },
      ],
    })
    expect(extractMatchDetails(comp, '11').stats.home.passPct).toBe(Math.round((768 / 853) * 100))
  })

  // Bug réel corrigé (fifaStatsToRows lit `offsides`, pluriel) — un champ
  // singulier serait silencieusement ignoré à l'affichage.
  it('renvoie offsides (pluriel), pas offside', () => {
    const comp = makeComp({ statsHome: [{ name: 'offsides', displayValue: '2' }] })
    const stats = extractMatchDetails(comp, '11').stats
    expect(stats.home.offsides).toBe(2)
    expect(stats.home).not.toHaveProperty('offside')
  })

  it('renvoie stats: null si aucune statistique exploitable des deux côtés', () => {
    const comp = makeComp({ statsHome: [], statsAway: [] })
    expect(extractMatchDetails(comp, '11').stats).toBeNull()
  })
})

describe('parseEspnRoster', () => {
  it('sépare titulaires/remplaçants via le flag starter explicite', () => {
    const roster = {
      team: { displayName: 'Spain', abbreviation: 'ESP', color: '1e40af', alternateColor: 'ffffff' },
      formation: '4-3-3',
      athletes: [
        { starter: true, order: 1, athlete: { displayName: 'Unai Simón', shortName: 'U. Simón', jersey: '1', position: { abbreviation: 'G', name: 'Goalkeeper' } } },
        { starter: false, order: 12, athlete: { displayName: 'Ferran Torres', shortName: 'F. Torres', jersey: '11', position: { abbreviation: 'F', name: 'Forward' } } },
      ],
    }
    const parsed = parseEspnRoster(roster)
    expect(parsed.starters).toHaveLength(1)
    expect(parsed.subs).toHaveLength(1)
    expect(parsed.starters[0].shortName).toBe('U. Simón')
    expect(parsed.color).toBe('#1e40af')
  })

  it('retombe sur les 11 premiers par order si aucun starter explicite (tournoi sans ce flag)', () => {
    const athletes = Array.from({ length: 14 }, (_, i) => ({ order: i, athlete: { displayName: `Joueur ${i}`, shortName: `J${i}` } }))
    const roster = { team: { displayName: 'X' }, athletes }
    const parsed = parseEspnRoster(roster)
    expect(parsed.starters).toHaveLength(11)
    expect(parsed.subs).toHaveLength(3)
  })

  it('renvoie null si le roster est absent', () => {
    expect(parseEspnRoster(null)).toBeNull()
  })
})

describe('compactEspnSummary', () => {
  it('compacte un summary complet (header.competitions) en { scorers, cards, stats, lineups }', () => {
    const json = {
      header: { competitions: [makeComp({
        details: [{ scoringPlay: true, team: { id: '11' }, clock: { displayValue: "106'" }, athletesInvolved: [{ shortName: 'F. Torres' }] }],
        statsHome: [{ name: 'possessionPct', displayValue: '64' }],
        statsAway: [{ name: 'possessionPct', displayValue: '36' }],
      })] },
      rosters: [
        { team: homeTeam, formation: '4-3-3', athletes: [{ starter: true, order: 1, athlete: { displayName: 'Unai Simón', shortName: 'U. Simón' } }] },
        { team: awayTeam, formation: '4-4-2', athletes: [{ starter: true, order: 1, athlete: { displayName: 'E. Martínez', shortName: 'E. Martínez' } }] },
      ],
    }
    const result = compactEspnSummary(json)
    expect(result.scorers).toHaveLength(1)
    expect(result.stats.home.poss).toBe(64)
    // home résolu par ID (homeTeamId='11'), pas par position dans le tableau
    expect(result.lineups.home.name).toBe('Spain')
    expect(result.lineups.away.name).toBe('Argentina')
  })

  // Bug réel CM 2026 : summary.rosters absent, rosters dans
  // header.competitions[0].competitors[].roster à la place.
  it('retombe sur competitors[].roster quand summary.rosters est vide (cas CM)', () => {
    const comp = {
      competitors: [
        { homeAway: 'home', team: homeTeam, statistics: [], roster: [{ starter: true, order: 1, athlete: { displayName: 'Unai Simón', shortName: 'U. Simón' } }] },
        { homeAway: 'away', team: awayTeam, statistics: [], roster: [{ starter: true, order: 1, athlete: { displayName: 'E. Martínez', shortName: 'E. Martínez' } }] },
      ],
      details: [],
    }
    const result = compactEspnSummary({ header: { competitions: [comp] } })
    expect(result.lineups.home.starters[0].shortName).toBe('U. Simón')
    expect(result.lineups.away.starters[0].shortName).toBe('E. Martínez')
  })

  it('renvoie une structure vide sûre si competitions est absent', () => {
    expect(compactEspnSummary({})).toEqual({ scorers: [], cards: [], stats: null, lineups: null })
    expect(compactEspnSummary(null)).toEqual({ scorers: [], cards: [], stats: null, lineups: null })
  })

  // ⚠️ Régression corrigée juste après le déploiement de la compaction
  // (constat utilisateur : "pas toutes les stats en live") : json.boxscore.
  // teams est la source PRINCIPALE historique pour les stats live club
  // (ancien useEspnSummaryStats dans MatchModal.jsx la lisait exclusivement,
  // sans jamais regarder header.competitions) — compactEspnSummary doit la
  // préférer à header.competitions[].competitors[].statistics quand les
  // deux existent, et retomber sur header seulement si boxscore est vide
  // (cas CM, voir extractMatchDetails).
  it('préfère json.boxscore.teams à header.competitors quand les deux ont des stats', () => {
    const json = {
      header: { competitions: [makeComp({ statsHome: [{ name: 'possessionPct', displayValue: '40' }] })] },
      boxscore: { teams: [
        { homeAway: 'home', team: homeTeam, statistics: [{ name: 'possessionPct', displayValue: '64' }] },
        { homeAway: 'away', team: awayTeam, statistics: [{ name: 'possessionPct', displayValue: '36' }] },
      ] },
    }
    expect(compactEspnSummary(json).stats.home.poss).toBe(64)
  })

  it('retombe sur header.competitors si boxscore.teams est vide/absent', () => {
    const json = {
      header: { competitions: [makeComp({ statsHome: [{ name: 'possessionPct', displayValue: '64' }] })] },
    }
    expect(compactEspnSummary(json).stats.home.poss).toBe(64)
  })
})
