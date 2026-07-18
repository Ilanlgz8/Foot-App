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
    const live = calcLiveProno(homeForm, awayForm, 1, 1, "89'")
    expect(pre.home).toBeGreaterThan(pre.away)
    expect(live.home).toBeGreaterThan(live.away)
  })

  it('un écart de buts plus large verrouille davantage la tête (à minute égale) qu\'un écart d\'1 seul but', () => {
    const oneGoal   = calcLiveProno(homeForm, awayForm, 1, 0, "60'")
    const fourGoals = calcLiveProno(homeForm, awayForm, 4, 0, "60'")
    expect(sumsTo100(oneGoal)).toBe(true)
    expect(sumsTo100(fourGoals)).toBe(true)
    expect(fourGoals.home).toBeGreaterThan(oneGoal.home)
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
    const live = calcLiveProno(homeForm, awayForm, 0, 0, "89'", { awayRedCards: 2 })
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
