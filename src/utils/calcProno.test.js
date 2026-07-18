// Tests du modèle de pronostic — calcProno (forme récente, modèle de base),
// calcPronoAdvanced (buts saison/Poisson + confrontations directes, ajouté
// cette saison) et calcLiveProno (réévaluation en direct). Vérifie surtout
// des PROPRIÉTÉS attendues (somme à 100%, équipe plus forte favorisée,
// repli automatique sur le modèle de base si pas assez de données) plutôt
// que des valeurs exactes calculées à la main — le modèle avancé combine
// plusieurs facteurs (Poisson + H2H), une valeur exacte serait fragile au
// moindre ajustement de pondération sans rien prouver de plus utile.
import { describe, it, expect } from 'vitest'
import { calcProno, calcPronoAdvanced, calcLiveProno, pronoToOdds, pronoIntensity, pronoGlowShadow, pronoFavoriteKey } from './calcProno'

function sumsTo100(p) {
  return p.home + p.draw + p.away === 100
}

const finished = (homeId, awayId, home, away) => ({
  status: 'FINISHED',
  homeTeam: { id: homeId },
  awayTeam: { id: awayId },
  score: { fullTime: { home, away } },
})

describe('calcProno (forme récente)', () => {
  it('somme toujours à 100%', () => {
    expect(sumsTo100(calcProno(['W', 'W', 'W'], ['L', 'L', 'L']))).toBe(true)
    expect(sumsTo100(calcProno([], []))).toBe(true)
  })

  it('avantage domicile : à forme strictement égale, domicile > extérieur', () => {
    const p = calcProno(['W', 'D', 'L', 'W', 'D'], ['W', 'D', 'L', 'W', 'D'])
    expect(p.home).toBeGreaterThan(p.away)
  })

  it('ne descend jamais sous le plancher de 5%', () => {
    const p = calcProno(['W', 'W', 'W', 'W', 'W'], ['L', 'L', 'L', 'L', 'L'])
    expect(p.away).toBeGreaterThanOrEqual(5)
  })

  it('le nul ne s\'écrase pas quand les deux équipes sont en grande forme (constat utilisateur : cote extérieur plus basse que le nul alors que cette équipe perdait)', () => {
    // Avec une constante fixe pour le nul, deux équipes en pleine forme
    // faisaient chuter sa part relative (elle ne suit pas leur niveau), ce
    // qui pouvait laisser le nul en dessous de la victoire extérieure même
    // pré-match — le nul doit rester comparable au cas neutre.
    const neutral = calcProno([], [])
    const bothStrong = calcProno(['W', 'W', 'W', 'W', 'W'], ['W', 'W', 'W', 'W', 'W'])
    expect(bothStrong.draw).toBeGreaterThanOrEqual(neutral.draw - 3)
  })

  it('le nul est plus probable entre deux équipes de niveau proche qu\'entre deux équipes très inégales', () => {
    const close      = calcProno(['W', 'D', 'L', 'W', 'D'], ['W', 'D', 'L', 'D', 'W'])
    const mismatched = calcProno(['W', 'W', 'W', 'W', 'W'], ['L', 'L', 'L', 'L', 'L'])
    expect(close.draw).toBeGreaterThan(mismatched.draw)
  })

  it('opts.neutralVenue désactive l\'avantage domicile (constat utilisateur : Coupe du Monde/Euro/CAN/Copa America se jouent sur terrain neutre pour les 2 équipes, sauf pays hôte)', () => {
    const sameForm = ['W', 'D', 'L', 'W', 'D']
    const normal  = calcProno(sameForm, sameForm)
    const neutral = calcProno(sameForm, sameForm, { neutralVenue: true })
    expect(normal.home).toBeGreaterThan(normal.away)    // comportement normal inchangé
    expect(neutral.home).toBe(neutral.away)              // terrain neutre : aucune des 2 équipes favorisée
  })
})

describe('calcPronoAdvanced — repli sur calcProno si données insuffisantes', () => {
  it('retombe sur calcProno si homeId/awayId manquants', () => {
    const advanced = calcPronoAdvanced(null, null, [], ['W'], ['L'])
    const base     = calcProno(['W'], ['L'])
    expect(advanced).toEqual(base)
  })

  it('retombe sur calcProno si compMatches a moins de 10 matchs terminés', () => {
    const compMatches = [finished('h', 'a', 1, 0), finished('a', 'h', 0, 1)]
    const advanced = calcPronoAdvanced('h', 'a', compMatches, ['W'], ['L'])
    const base     = calcProno(['W'], ['L'])
    expect(advanced).toEqual(base)
  })
})

describe('calcPronoAdvanced — modèle buts/Poisson', () => {
  // Fixture : une "équipe forte" qui marque beaucoup et n'encaisse rien face
  // à des équipes intermédiaires, une "équipe faible" qui encaisse beaucoup
  // et ne marque jamais — de quoi dépasser largement les seuils minimums
  // (MIN_LEAGUE_GAMES=10, MIN_TEAM_SPLITS=2 dom/ext par équipe) et obtenir un
  // écart de force sans ambiguïté.
  const compMatches = [
    finished('t1', 't2', 1, 1), finished('t2', 't1', 1, 1),
    finished('t3', 't4', 1, 1), finished('t4', 't3', 1, 1),
    finished('t1', 't3', 1, 1), finished('t3', 't1', 1, 1),
    finished('strong', 't1', 3, 0), finished('strong', 't2', 3, 0),
    finished('t3', 'strong', 0, 3), finished('t4', 'strong', 0, 3),
    finished('weak', 't1', 0, 3), finished('weak', 't2', 0, 3),
    finished('t3', 'weak', 3, 0), finished('t4', 'weak', 3, 0),
  ]

  it('favorise nettement l\'équipe la plus forte statistiquement', () => {
    const p = calcPronoAdvanced('strong', 'weak', compMatches, [], [])
    expect(sumsTo100(p)).toBe(true)
    expect(p.home).toBeGreaterThan(p.away)
    expect(p.home).toBeGreaterThan(60)
  })

  it('reste raisonnable (< 95%) même pour un écart de force extrême — correction de surconfiance (backtest utilisateur : les pronostics >80% se réalisaient beaucoup moins souvent que prédit)', () => {
    const p = calcPronoAdvanced('strong', 'weak', compMatches, [], [])
    expect(p.home).toBeLessThan(95)
  })

  it('reste équilibré entre deux équipes de force comparable', () => {
    const p = calcPronoAdvanced('t1', 't2', compMatches, [], [])
    expect(sumsTo100(p)).toBe(true)
    // Pas d'écart extrême attendu entre 2 équipes aux stats quasi identiques.
    expect(Math.abs(p.home - p.away)).toBeLessThan(40)
  })

  it('opts.neutralVenue supprime le résidu d\'avantage domicile même dans le modèle buts/Poisson (constat utilisateur : WC/EC/CAN/COPA se jouent sur terrain neutre)', () => {
    const normal  = calcPronoAdvanced('t1', 't2', compMatches, [], [])
    const neutral = calcPronoAdvanced('t1', 't2', compMatches, [], [], { neutralVenue: true })
    // t1/t2 ont des stats quasi identiques : l'écart home/away restant en
    // mode normal vient presque entièrement de l'avantage domicile — il doit
    // se réduire (ou disparaître) une fois neutralVenue activé.
    expect(Math.abs(neutral.home - neutral.away)).toBeLessThanOrEqual(Math.abs(normal.home - normal.away))
  })

  it('neutralVenue continue de favoriser la vraie équipe la plus forte (n\'écrase pas le signal, juste le biais domicile)', () => {
    const p = calcPronoAdvanced('strong', 'weak', compMatches, [], [], { neutralVenue: true })
    expect(p.home).toBeGreaterThan(p.away)
    expect(p.home).toBeGreaterThan(55)
  })
})

describe('calcPronoAdvanced — shrinkage des ratios attaque/défense (petit échantillon)', () => {
  // Diagnostic backtest (PL/PD/FL1 saison 2025/26, scripts/backtest-prono.mjs
  // mode debug) : cote "extérieur gagne" 50%+ trop confiante, biais déjà présent
  // dans le Poisson brut à un échantillon ~9 matchs/équipe — PAS un problème de
  // H2H (qui ne bouge quasi rien) ni d'échantillon anormalement petit (9 est
  // bien au-dessus de MIN_TEAM_SPLITS=2). Cause : les ratios attaque/défense
  // (buts observés / moyenne ligue) sont multipliés entre eux sans être
  // eux-mêmes ramenés vers la moyenne selon la taille de l'échantillon — le
  // bruit de chaque ratio se compose au lieu de se lisser. Ces tests vérifient
  // que le correctif (shrinkRatio, calcProno.js) fait bien ce qui est attendu :
  // moins confiant à échantillon minimal, de plus en plus confiant à mesure que
  // l'échantillon grandit, sans jamais inverser le sens du favori.
  function buildFixture(splitsPerTeam) {
    const compMatches = []
    for (let i = 0; i < splitsPerTeam; i++) {
      compMatches.push(finished('t1', 't2', 1, 1), finished('t2', 't1', 1, 1))
      compMatches.push(finished('t3', 't4', 1, 1), finished('t4', 't3', 1, 1))
      compMatches.push(finished('strong', 't1', 3, 0))
      compMatches.push(finished('t3', 'strong', 0, 3))
      compMatches.push(finished('weak', 't1', 0, 3))
      compMatches.push(finished('t3', 'weak', 3, 0))
    }
    return compMatches
  }

  it('reste favorable à l\'équipe forte mais de façon plus mesurée à échantillon minimal (2 matchs, plancher MIN_TEAM_SPLITS)', () => {
    const p = calcPronoAdvanced('strong', 'weak', buildFixture(2), [], [])
    expect(sumsTo100(p)).toBe(true)
    expect(p.home).toBeGreaterThan(p.away)
    // Toujours favori, mais nettement moins tranché qu'avec un échantillon
    // confortable (voir test suivant) — la confiance doit rester mesurée.
    expect(p.home).toBeGreaterThan(50)
    expect(p.home).toBeLessThan(75)
  })

  it('devient de plus en plus confiant à mesure que l\'échantillon grandit, à écart de force identique', () => {
    const small = calcPronoAdvanced('strong', 'weak', buildFixture(2), [], [])
    const medium = calcPronoAdvanced('strong', 'weak', buildFixture(4), [], [])
    const large = calcPronoAdvanced('strong', 'weak', buildFixture(8), [], [])
    expect(small.home).toBeLessThan(medium.home)
    expect(medium.home).toBeLessThan(large.home)
  })
})

describe('calcPronoAdvanced — confrontations directes (H2H)', () => {
  it('penche vers l\'équipe qui domine historiquement leurs confrontations directes', () => {
    // Mêmes stats offensives/défensives globales pour t1/t2 (via les matchs
    // contre t3/t4), mais t1 a systématiquement battu t2 en confrontation
    // directe — le H2H doit pousser le curseur vers t1 par rapport à une
    // situation sans historique direct.
    const base = [
      finished('t1', 't3', 1, 1), finished('t3', 't1', 1, 1),
      finished('t2', 't3', 1, 1), finished('t3', 't2', 1, 1),
      finished('t1', 't4', 1, 1), finished('t4', 't1', 1, 1),
      finished('t2', 't4', 1, 1), finished('t4', 't2', 1, 1),
      finished('t3', 't4', 1, 1), finished('t4', 't3', 1, 1),
    ]
    const withH2H = [
      ...base,
      finished('t1', 't2', 2, 0),
      finished('t2', 't1', 0, 2),
      finished('t1', 't2', 3, 1),
    ]

    const withoutH2H = calcPronoAdvanced('t1', 't2', base, [], [])
    const withHistory = calcPronoAdvanced('t1', 't2', withH2H, [], [])
    expect(withHistory.home).toBeGreaterThan(withoutH2H.home)
  })
})

describe('calcPronoAdvanced — repli fullH2H (historique complet, ex. début de saison)', () => {
  it('sans fullH2H, ignore toujours le H2H quand compMatches est insuffisant (comportement inchangé)', () => {
    const advanced = calcPronoAdvanced('h', 'a', [], ['W'], ['L'])
    const base     = calcProno(['W'], ['L'])
    expect(advanced).toEqual(base)
  })

  it('avec fullH2H mais compMatches vide (tout début de saison), penche vers l\'équipe qui a dominé leurs confrontations passées plutôt que de rester neutre', () => {
    const fullH2H = [
      finished('h', 'a', 2, 0),
      finished('a', 'h', 0, 2),
      finished('h', 'a', 3, 1),
    ]
    const withH2H  = calcPronoAdvanced('h', 'a', [], [], [], { fullH2H })
    const withoutH2H = calcPronoAdvanced('h', 'a', [], [], [])
    expect(sumsTo100(withH2H)).toBe(true)
    expect(withH2H.home).toBeGreaterThan(withoutH2H.home)
  })

  it('fullH2H sans aucune confrontation entre CES deux équipes retombe sur calcProno (pas de faux signal)', () => {
    const fullH2H = [finished('x', 'y', 3, 0)] // aucune des 2 équipes concernées
    const advanced = calcPronoAdvanced('h', 'a', [], ['W'], ['L'], { fullH2H })
    const base      = calcProno(['W'], ['L'])
    expect(advanced).toEqual(base)
  })

  it('fullH2H est préféré au H2H limité à compMatches (saison en cours) quand les deux sont fournis et divergent', () => {
    // Reprend la fixture buts/Poisson ci-dessus (t1/t2 statistiquement égaux)
    // : aucune confrontation directe dans compMatches, mais un historique
    // complet où t1 a toujours dominé t2 — le résultat doit refléter
    // fullH2H, pas juste le Poisson neutre de compMatches seul.
    const compMatches = [
      finished('t1', 't2', 1, 1), finished('t2', 't1', 1, 1),
      finished('t3', 't4', 1, 1), finished('t4', 't3', 1, 1),
      finished('t1', 't3', 1, 1), finished('t3', 't1', 1, 1),
      finished('strong', 't1', 3, 0), finished('strong', 't2', 3, 0),
      finished('t3', 'strong', 0, 3), finished('t4', 'strong', 0, 3),
      finished('weak', 't1', 0, 3), finished('weak', 't2', 0, 3),
      finished('t3', 'weak', 3, 0), finished('t4', 'weak', 3, 0),
    ]
    const fullH2H = [
      finished('t1', 't2', 3, 0),
      finished('t2', 't1', 0, 3),
      finished('t1', 't2', 2, 0),
    ]
    const withFullH2H = calcPronoAdvanced('t1', 't2', compMatches, [], [], { fullH2H })
    const withCompOnly = calcPronoAdvanced('t1', 't2', compMatches, [], [])
    expect(withFullH2H.home).toBeGreaterThan(withCompOnly.home)
  })
})

describe('calcLiveProno', () => {
  const homeForm = ['W', 'W', 'D', 'L', 'W']
  const awayForm = ['L', 'D', 'L', 'W', 'L']

  it('au coup d\'envoi (minute 0, 0-0), équivaut au pronostic pré-match', () => {
    const pre  = calcProno(homeForm, awayForm)
    const live = calcLiveProno(homeForm, awayForm, 0, 0, 'Débute')
    expect(live).toEqual(pre)
  })

  it('transmet bien fullH2H au prior pré-match (repli début de saison, compMatches vide)', () => {
    const fullH2H = [
      finished('h', 'a', 2, 0),
      finished('a', 'h', 0, 2),
      finished('h', 'a', 3, 1),
    ]
    const preWithH2H = calcPronoAdvanced('h', 'a', [], homeForm, awayForm, { fullH2H })
    const live = calcLiveProno(homeForm, awayForm, 0, 0, 'Débute', { homeId: 'h', awayId: 'a', compMatches: [], fullH2H })
    expect(live).toEqual(preWithH2H)
  })

  it('en toute fin de match, l\'équipe qui mène est massivement favorisée', () => {
    const live = calcLiveProno(homeForm, awayForm, 2, 0, "89'")
    expect(live.home).toBeGreaterThan(80)
    expect(sumsTo100(live)).toBe(true)
  })

  it('à égalité en fin de match, penche vers le favori pré-match plutôt qu\'un 50/50', () => {
    const pre = calcProno(homeForm, awayForm) // domicile favori (forme meilleure + bonus domicile)
    // 75e plutôt que 89e (avant le passage à la projection Poisson en
    // direct) : à 1 minute de la fin, une vraie projection Poisson écrase
    // à juste titre home ET away à des valeurs infimes et quasi identiques
    // (le nul domine alors très largement, statistiquement correct — si peu
    // de temps ne laisse quasiment aucune chance de marquer) — le plancher
    // d'affichage à 5% les rend alors indiscernables. Le favori pré-match
    // reste bien visible à une minute plus raisonnable.
    const live = calcLiveProno(homeForm, awayForm, 1, 1, "75'")
    expect(pre.home).toBeGreaterThan(pre.away)
    expect(live.home).toBeGreaterThan(live.away)
  })

  it('même à 1 minute de la fin, à égalité, le nul écrase largement home et away (projection Poisson : quasi plus de temps pour marquer)', () => {
    const live = calcLiveProno(homeForm, awayForm, 1, 1, "89'")
    expect(sumsTo100(live)).toBe(true)
    expect(live.draw).toBeGreaterThan(live.home)
    expect(live.draw).toBeGreaterThan(live.away)
  })

  it('un écart de buts plus large verrouille davantage la tête (à minute égale) qu\'un écart d\'1 seul but', () => {
    const oneGoal   = calcLiveProno(homeForm, awayForm, 1, 0, "60'")
    const fourGoals = calcLiveProno(homeForm, awayForm, 4, 0, "60'")
    expect(sumsTo100(oneGoal)).toBe(true)
    expect(sumsTo100(fourGoals)).toBe(true)
    expect(fourGoals.home).toBeGreaterThan(oneGoal.home)
  })

  it('une équipe menée de plusieurs buts ne peut jamais avoir une victoire plus probable qu\'un nul (bug réel signalé : France favorite pré-match, menée 0-3 par l\'Angleterre — cote nul 6,74 mais cote victoire France 3,37)', () => {
    const live = calcLiveProno(homeForm, awayForm, 0, 3, "30'")
    expect(sumsTo100(live)).toBe(true)
    // homeForm est favori pré-match (voir test ci-dessus) : sans la
    // contrainte, le prior pré-match pouvait faire remonter home au-dessus
    // de draw malgré les 3 buts de retard à combler EN PLUS pour gagner.
    expect(live.home).toBeLessThanOrEqual(live.draw)
  })

  it('une équipe menée de 3 buts à mi-match ne produit jamais de pourcentage négatif (bug réel de distribute() : deux issues quasi nulles en même temps pouvaient faire ressortir home négatif)', () => {
    const live = calcLiveProno(homeForm, awayForm, 0, 3, "60'")
    expect(sumsTo100(live)).toBe(true)
    expect(live.home).toBeGreaterThanOrEqual(0)
    expect(live.draw).toBeGreaterThanOrEqual(0)
    expect(live.away).toBeGreaterThanOrEqual(0)
  })

  it('symétrique : l\'équipe qui mène de plusieurs buts garde bien une victoire au moins aussi probable qu\'un nul', () => {
    const live = calcLiveProno(homeForm, awayForm, 3, 0, "30'")
    expect(sumsTo100(live)).toBe(true)
    expect(live.home).toBeGreaterThanOrEqual(live.draw)
  })

  it('menée au score, la cote de victoire de l\'équipe qui perd n\'est jamais affichée identique à la cote du nul (bug réel signalé : arrondi du plancher à 5% pouvait faire ressortir home:5/draw:5 malgré une réalité statistique différente)', () => {
    // Sur toute la 2ème mi-temps, le floor à 5% de distribute() ne doit
    // jamais faire remonter l'équipe menée au niveau du nul — l'inégalité
    // stricte (perdre est structurellement moins probable qu'un nul quand
    // on est mené) doit survivre à l'arrondi affiché, pas seulement au
    // calcul flottant interne.
    for (const minute of ["45'", "60'", "75'", "89'"]) {
      const live = calcLiveProno(homeForm, awayForm, 0, 3, minute)
      expect(sumsTo100(live)).toBe(true)
      expect(live.home).toBeLessThan(live.draw)
    }
  })

  it('un but qui ramène un écart de 4 buts à 3 buts fait bien baisser visiblement la cote du favori en début/milieu de match (bug réel signalé : 4-0 puis 4-1 affichaient exactement la même cote)', () => {
    // Plancher d'affichage désormais CONTINU (voir liveFloorFor) plutôt qu'un
    // simple seuil ON/OFF — le favori peut légitimement RE-converger avec un
    // scénario voisin en toute fin de match si les deux sont déjà >99.9%
    // quasi certains (différence réelle mais invisible à l'échelle du %
    // entier affiché, ce qui est honnête, pas un bug) : on teste donc tôt/
    // milieu de match, où l'écart doit rester visible.
    for (const minute of ["5'", "15'"]) {
      const quatreZero = calcLiveProno(homeForm, awayForm, 4, 0, minute)
      const quatreUn    = calcLiveProno(homeForm, awayForm, 4, 1, minute)
      expect(sumsTo100(quatreZero)).toBe(true)
      expect(sumsTo100(quatreUn)).toBe(true)
      expect(quatreUn.home).toBeLessThan(quatreZero.home)
    }
  })

  it('à écart de buts FIXE (2 ou 3), la cote du favori continue de grimper tout au long du match, pas seulement en tout début (retour utilisateur : "ça prend bien en compte quand ça s\'approche de la fin du match... l\'outsider mené 3-0 ou 2-0 à la fin, ou 3-0 en milieu de jeu")', () => {
    // Avant le plancher continu (liveFloorFor), un écart de 2-3 buts saturait
    // le plancher fixe à 5% dès la 15-45e minute — la cote restait ensuite
    // identique jusqu'à la fin du match, alors que la vraie probabilité
    // Poisson continue de grimper tout du long (moins de temps restant pour
    // l'outsider = comeback de plus en plus improbable). Vérifié sur toute
    // la durée : la cote du favori (jamais l'inverse) doit être NON
    // DÉCROISSANTE à mesure que le temps passe, et strictement supérieure
    // entre le tout début et la fin.
    for (const goals of [2, 3]) {
      const minutes = ["5'", "15'", "30'", "45'", "60'", "70'", "80'", "88'"]
      let prev = 0
      for (const minute of minutes) {
        const live = calcLiveProno(homeForm, awayForm, goals, 0, minute)
        expect(sumsTo100(live)).toBe(true)
        expect(live.home).toBeGreaterThanOrEqual(prev)
        prev = live.home
      }
      const early = calcLiveProno(homeForm, awayForm, goals, 0, "5'")
      const late  = calcLiveProno(homeForm, awayForm, goals, 0, "88'")
      expect(late.home).toBeGreaterThan(early.home)
    }
  })

  it('un carton rouge adverse favorise nettement l\'équipe en supériorité numérique, à score égal', () => {
    const neutral  = calcLiveProno(homeForm, awayForm, 0, 0, "60'")
    const withRed  = calcLiveProno(homeForm, awayForm, 0, 0, "60'", { awayRedCards: 1 })
    expect(sumsTo100(withRed)).toBe(true)
    expect(withRed.home).toBeGreaterThan(neutral.home)
  })

  it('un carton rouge à domicile favorise l\'extérieur, à score égal', () => {
    const neutral  = calcLiveProno(homeForm, awayForm, 0, 0, "60'")
    const withRed  = calcLiveProno(homeForm, awayForm, 0, 0, "60'", { homeRedCards: 1 })
    expect(sumsTo100(withRed)).toBe(true)
    expect(withRed.away).toBeGreaterThan(neutral.away)
  })

  it('une possession/tirs cadrés nettement supérieurs penchent légèrement en faveur de l\'équipe qui domine', () => {
    const neutral   = calcLiveProno(homeForm, awayForm, 0, 0, "60'")
    const dominant  = calcLiveProno(homeForm, awayForm, 0, 0, "60'", {
      homePoss: 70, awayPoss: 30, homeShotsOnTarget: 8, awayShotsOnTarget: 1,
    })
    expect(sumsTo100(dominant)).toBe(true)
    expect(dominant.home).toBeGreaterThan(neutral.home)
  })

  it('un carton rouge ne peut jamais, à lui seul, écraser complètement une issue (plancher 5%)', () => {
    // 60' plutôt que 89' (choix d'origine) : le plancher continu (liveFloorFor,
    // voir plus haut) réagit désormais à la vraie certitude Poisson, pas
    // seulement à la cause — à 89' sur un score encore vierge, le nul devient
    // légitimement quasi certain (très peu de temps pour marquer) INDÉPENDAMMENT
    // des cartons, ce qui réduit le plancher pour cette toute autre raison. Le
    // test isole donc l'effet "cartons seuls" à un moment où cette 2e cause ne
    // s'ajoute pas encore (voir aussi le test 89'-nul-domine plus haut).
    const live = calcLiveProno(homeForm, awayForm, 0, 0, "60'", { awayRedCards: 2 })
    expect(sumsTo100(live)).toBe(true)
    expect(live.away).toBeGreaterThanOrEqual(5)
  })

  it('plus de corners penche légèrement en faveur de l\'équipe qui domine, avec un poids plus faible que les tirs cadrés', () => {
    const neutral       = calcLiveProno(homeForm, awayForm, 0, 0, "60'")
    const moreCorners   = calcLiveProno(homeForm, awayForm, 0, 0, "60'", { homeCorners: 9, awayCorners: 1 })
    const moreShotsOnTgt = calcLiveProno(homeForm, awayForm, 0, 0, "60'", { homeShotsOnTarget: 9, awayShotsOnTarget: 1 })
    expect(sumsTo100(moreCorners)).toBe(true)
    expect(moreCorners.home).toBeGreaterThan(neutral.home)
    expect(moreCorners.home).toBeLessThan(moreShotsOnTgt.home)
  })
})

describe('pronoToOdds', () => {
  it('applique une marge bookmaker (~106% overround) plutôt que des cotes "justes"', () => {
    expect(pronoToOdds(50)).toBeCloseTo(1.89, 2)
    expect(pronoToOdds(25)).toBeCloseTo(3.77, 2)
  })

  it('ne descend jamais sous 1.01, même pour un % très élevé', () => {
    expect(pronoToOdds(100)).toBeGreaterThanOrEqual(1.01)
  })

  it('reste une valeur finie et raisonnable pour un % nul ou manquant', () => {
    expect(Number.isFinite(pronoToOdds(0))).toBe(true)
    expect(Number.isFinite(pronoToOdds(null))).toBe(true)
  })

  it('une issue plus probable a toujours une cote plus basse', () => {
    expect(pronoToOdds(52)).toBeLessThan(pronoToOdds(26))
    expect(pronoToOdds(26)).toBeLessThan(pronoToOdds(22))
  })

  it('la somme des probabilités implicites (1/cote) dépasse 100%, comme un vrai bookmaker', () => {
    const home = pronoToOdds(52), draw = pronoToOdds(26), away = pronoToOdds(22)
    const impliedSum = 1 / home + 1 / draw + 1 / away
    expect(impliedSum).toBeGreaterThan(1)
  })
})

describe('pronoIntensity', () => {
  it('reste toujours entre 0.35 et 1', () => {
    expect(pronoIntensity(0)).toBeGreaterThanOrEqual(0.35)
    expect(pronoIntensity(100)).toBeLessThanOrEqual(1)
  })

  it('croît avec le %', () => {
    expect(pronoIntensity(52)).toBeGreaterThan(pronoIntensity(26))
    expect(pronoIntensity(26)).toBeGreaterThan(pronoIntensity(22))
  })
})

describe('pronoGlowShadow', () => {
  it('renvoie une valeur box-shadow CSS valide (3 halos rgba, ton bordeaux)', () => {
    const shadow = pronoGlowShadow(52)
    expect(shadow).toContain('rgba(159,30,52,')
    expect(shadow.split(',').filter(s => s.includes('rgba')).length).toBe(3)
  })

  it('un favori net a un glow plus marqué qu\'un outsider', () => {
    const strong = pronoGlowShadow(70)
    const weak   = pronoGlowShadow(10)
    expect(strong).not.toBe(weak)
  })
})

describe('pronoFavoriteKey', () => {
  it('identifie le domicile comme favori quand son % est le plus haut', () => {
    expect(pronoFavoriteKey({ home: 52, draw: 26, away: 22 })).toBe('home')
  })

  it('identifie l\'extérieur comme favori quand son % est le plus haut', () => {
    expect(pronoFavoriteKey({ home: 20, draw: 25, away: 55 })).toBe('away')
  })

  it('identifie le nul comme favori quand son % est le plus haut', () => {
    expect(pronoFavoriteKey({ home: 30, draw: 40, away: 30 })).toBe('draw')
  })
})
