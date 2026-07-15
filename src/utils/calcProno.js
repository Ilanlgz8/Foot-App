import { finalScore, outcomeForTeam } from './matchUtils'

// Force d'une équipe sur sa forme récente (0-3, comme des points/match).
function strength(form) {
  if (!form?.length) return 1.5   // neutre (sur 3 pts max/match)
  const pts = form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)
  return pts / form.length
}

// ── Affichage façon "côtes bookmaker" (LiveProno/MatchModal.jsx, poster
// footer/MatchPoster.jsx) — partagé pour ne pas dupliquer la conversion
// dans les deux composants qui l'affichent. ──────────────────────────────

// Marge bookmaker (overround) — retour utilisateur : la somme des 3 cotes
// "justes" (sans marge) semblait toujours tomber près de 10, ce qui ne
// ressemble à aucun vrai bookmaker (ils prennent tous une marge : la somme
// des probabilités implicites 1/cote dépasse 100%, jamais l'inverse). 1.06 =
// overround modéré (marché bas : Pinnacle ~102-104% ; grand public plutôt
// 106-110%) — volontairement discret plutôt que punitif. Appliqué en
// multipliant chaque % par ce facteur avant de convertir en cote : ça
// resserre les 3 cotes uniformément vers le bas, comme un vrai bookmaker.
const BOOKMAKER_MARGIN = 1.06

// % → cote décimale, avec la marge bookmaker ci-dessus. Arrondie à 2
// décimales, jamais sous 1.01 (cote minimale plausible, évite une division
// par une probabilité proche de 0 qui donnerait une cote absurde genre
// 500.00).
export function pronoToOdds(pct) {
  if (!pct || pct <= 0) return 99
  return Math.max(1.01, Math.round((100 / (pct * BOOKMAKER_MARGIN)) * 100) / 100)
}

// Intensité visuelle (0-1) pour le liseré coloré de chaque issue — le
// favori ressort nettement sans qu'aucune issue ne soit totalement
// "éteinte". Plancher relevé à 0.35 (retour utilisateur : "la bordure est
// trop faible") — même l'outsider garde un liseré bien visible, pas un
// filet à peine perceptible. Volontairement plus qu'une simple
// proportionnalité pct/100 : sépare mieux le favori net du reste sur les
// distributions courantes (ex. 52/26/22 → 1/0.47/0.38 plutôt que
// 0.52/0.26/0.22, à peine différenciable).
export function pronoIntensity(pct) {
  return Math.max(0.35, Math.min(1, (pct - 5) / 45))
}

// Glow PERMANENT (pas d'animation clignotante, retour utilisateur : "faut
// que ça trace le contour de la forme, pas que ça clignote") — 3 halos
// superposés (serré/saturé → large/diffus) dont l'opacité suit
// pronoIntensity. Ton "rouge bordeaux" (159,30,52 = #9f1e34), identique à la
// couleur des chiffres de cote — entre le bordeaux trop sombre d'origine
// (#7a1e2e) et le rouge trop clair du tour précédent (#c41e3a), retour
// utilisateur : "un peu trop clair, faut redescendre un peu".
export function pronoGlowShadow(pct) {
  const i = pronoIntensity(pct)
  return `0 0 3px rgba(159,30,52,${(i * 0.7).toFixed(2)}), `
    + `0 0 ${Math.round(6 + i * 12)}px rgba(159,30,52,${(i * 0.65).toFixed(2)}), `
    + `0 0 ${Math.round(14 + i * 20)}px rgba(159,30,52,${(i * 0.35).toFixed(2)})`
}

// Détermine l'issue favorite (% le plus haut = cote la plus basse) parmi
// les 3 — utilisé pour n'appliquer le liseré/glow qu'à CETTE pilule
// (retour utilisateur : "la bordure rouge mais que sur la côte la plus
// basse"), les 2 autres pilules restent neutres (pas de liseré coloré).
export function pronoFavoriteKey(prono) {
  if (prono.home >= prono.draw && prono.home >= prono.away) return 'home'
  if (prono.away >= prono.draw) return 'away'
  return 'draw'
}

// Convertit 3 poids bruts (home, away, draw) en pourcentages entiers qui
// somment à 100, avec un plancher de 5% par issue (jamais 0% affiché).
function distribute(h, a, draw) {
  const total = h + a + draw
  let home = Math.round((h    / total) * 100)
  let away = Math.round((a    / total) * 100)
  let nul  = 100 - home - away   // absorbe l'arrondi

  if (home < 5) { home = 5;  nul  = 100 - home - away }
  if (away < 5) { away = 5;  nul  = 100 - home - away }
  if (nul  < 5) { nul  = 5;  home = 100 - nul  - away }

  return { home, draw: nul, away }
}

/**
 * calcProno — modèle DE BASE (forme récente V/N/D uniquement), gardé tel
 * quel comme filet de sécurité : utilisé quand on n'a pas assez de données
 * saison pour le modèle avancé (calcPronoAdvanced, plus bas) — ex. tout
 * début de phase de groupes d'un Mondial, championnat qui débute.
 *
 * @param {string[]} homeForm  ex: ['W','D','L','W','W']
 * @param {string[]} awayForm  ex: ['L','W','W','D','L']
 * @returns {{ home: number, draw: number, away: number }}  entiers %, somme = 100
 */
export function calcProno(homeForm, awayForm) {
  const h = strength(homeForm) + 0.4   // avantage domicile ~+0.4 pt
  const a = strength(awayForm)
  return distribute(h, a, 1.5)         // poids match nul constant
}

// ── Modèle avancé : buts marqués/encaissés (Poisson) + confrontations
// directes ────────────────────────────────────────────────────────────────
// Retour utilisateur : le modèle "forme récente (V/N/D)" seul n'était pas
// assez précis. Deux améliorations, SANS aucun appel réseau supplémentaire
// (budget API déjà serré, voir CLAUDE.md) — tout est calculé à partir de
// compMatches, déjà chargé pour l'onglet "Forme récente" (useTeamForm) :
//
// 1. Force d'attaque/défense de chaque équipe (buts marqués/encaissés sur
//    toute la saison dispo, domicile/extérieur séparés) comparée à la
//    moyenne du championnat, puis distribution de Poisson sur les buts
//    probables de chaque équipe — modèle standard en analyse football,
//    nettement plus fiable qu'un simple comptage V/N/D des 5 derniers matchs
//    (qui ignore l'écart de buts ET la force de l'adversaire affronté).
// 2. Confrontations directes déjà présentes dans compMatches (même
//    compétition/saison) : léger bonus à l'équipe qui les a gagnées.
//    L'historique H2H complet (toutes saisons confondues) existe déjà pour
//    la fiche d'un match précis (useH2H, endpoint FD.org dédié) mais n'est
//    PAS rappelé ici : un appel API par card affichée sur l'Accueil (10-20
//    en même temps) dépasserait vite le budget global (7 req/min, voir
//    api/football.js) — seules les données déjà en mémoire sont utilisées.
//
// Retombe automatiquement sur calcProno() (forme récente) si l'une des deux
// équipes n'a pas assez de matchs joués cette saison pour un calcul fiable.

const MIN_TEAM_SPLITS  = 2   // matchs mini par équipe à domicile ET à l'extérieur
const MIN_LEAGUE_GAMES = 10  // matchs mini dispo pour une moyenne de championnat fiable
const MAX_GOALS_GRID   = 8   // buts max simulés par équipe (au-delà, probabilité négligeable)
const H2H_WEIGHT_PER_MATCH = 0.08  // poids d'une confrontation directe dans le mix final
const H2H_WEIGHT_MAX       = 0.3   // jamais plus de 30% du poids final (échantillon souvent petit)

function poissonPmf(lambda, k) {
  let fact = 1
  for (let i = 2; i <= k; i++) fact *= i
  return Math.exp(-lambda) * Math.pow(lambda, k) / fact
}

// Grille de Poisson (buts dom. × buts ext., indépendants) → fractions 1/N/2.
function poissonOutcomes(lambdaHome, lambdaAway) {
  let home = 0, draw = 0, away = 0
  for (let i = 0; i <= MAX_GOALS_GRID; i++) {
    const pi = poissonPmf(lambdaHome, i)
    for (let j = 0; j <= MAX_GOALS_GRID; j++) {
      const p = pi * poissonPmf(lambdaAway, j)
      if (i > j) home += p
      else if (i < j) away += p
      else draw += p
    }
  }
  const total = home + draw + away || 1  // normalise la queue tronquée au-delà de MAX_GOALS_GRID
  return { home: home / total, draw: draw / total, away: away / total }
}

// Buts marqués/encaissés par équipe (domicile/extérieur séparés) + moyennes
// du championnat, à partir des matchs FINISHED de compMatches.
function buildGoalModel(compMatches) {
  const per = {}
  let leagueHomeGoals = 0, leagueAwayGoals = 0, counted = 0

  ;(compMatches ?? []).forEach(m => {
    if (m.status !== 'FINISHED') return
    const fs = finalScore(m.score)
    if (fs.home == null || fs.away == null) return
    const hid = m.homeTeam?.id, aid = m.awayTeam?.id
    if (hid == null || aid == null) return

    per[hid] ??= { hFor: 0, hAgainst: 0, hCount: 0, aFor: 0, aAgainst: 0, aCount: 0 }
    per[aid] ??= { hFor: 0, hAgainst: 0, hCount: 0, aFor: 0, aAgainst: 0, aCount: 0 }

    per[hid].hFor += fs.home; per[hid].hAgainst += fs.away; per[hid].hCount++
    per[aid].aFor += fs.away; per[aid].aAgainst += fs.home; per[aid].aCount++

    leagueHomeGoals += fs.home
    leagueAwayGoals += fs.away
    counted++
  })

  if (counted < MIN_LEAGUE_GAMES) return null
  return { per, leagueAvgHome: leagueHomeGoals / counted, leagueAvgAway: leagueAwayGoals / counted }
}

function clampLambda(l) {
  if (!Number.isFinite(l) || l <= 0) return 1
  return Math.min(5, Math.max(0.15, l))  // évite les extrêmes irréalistes sur petit échantillon
}

// Buts attendus (λ) pour chaque équipe à partir de sa force d'attaque/
// défense relative à la moyenne du championnat (modèle attaque×défense
// classique, ex. Dixon-Coles simplifié).
function computeLambdas(goalModel, homeId, awayId) {
  const home = goalModel.per[homeId]
  const away = goalModel.per[awayId]
  if (!home || !away || home.hCount < MIN_TEAM_SPLITS || away.aCount < MIN_TEAM_SPLITS) return null

  const { leagueAvgHome, leagueAvgAway } = goalModel
  const attackHome  = (home.hFor     / home.hCount) / leagueAvgHome
  const defenseHome = (home.hAgainst / home.hCount) / leagueAvgAway
  const attackAway  = (away.aFor     / away.aCount) / leagueAvgAway
  const defenseAway = (away.aAgainst / away.aCount) / leagueAvgHome

  return {
    lambdaHome: clampLambda(attackHome * defenseAway * leagueAvgHome),
    lambdaAway: clampLambda(attackAway * defenseHome * leagueAvgAway),
  }
}

// Confrontations directes déjà présentes dans compMatches (gratuit, aucun
// appel réseau) — utilisées comme léger correctif, pas comme source
// principale (échantillon quasi toujours petit : 0 à quelques matchs).
function directMeetings(compMatches, homeId, awayId) {
  let hWins = 0, aWins = 0, draws = 0, count = 0
  ;(compMatches ?? []).forEach(m => {
    if (m.status !== 'FINISHED') return
    const ids = [m.homeTeam?.id, m.awayTeam?.id]
    if (!ids.includes(homeId) || !ids.includes(awayId)) return
    const outcome = outcomeForTeam(m, homeId)
    if (!outcome) return
    count++
    if (outcome === 'W') hWins++
    else if (outcome === 'L') aWins++
    else draws++
  })
  return { count, hWins, aWins, draws }
}

/**
 * calcPronoAdvanced — buts marqués/encaissés saison (Poisson) + léger
 * correctif confrontations directes. Retombe sur calcProno() (forme
 * récente) si les données saison sont insuffisantes pour être fiables.
 *
 * @param {string|number} homeId
 * @param {string|number} awayId
 * @param {object[]} compMatches   matchs de la compétition (useTeamForm)
 * @param {string[]} homeForm      fallback si pas assez de données saison
 * @param {string[]} awayForm      fallback si pas assez de données saison
 */
export function calcPronoAdvanced(homeId, awayId, compMatches, homeForm, awayForm) {
  const fallback = () => calcProno(homeForm, awayForm)
  if (homeId == null || awayId == null) return fallback()

  const goalModel = buildGoalModel(compMatches)
  if (!goalModel) return fallback()

  const lambdas = computeLambdas(goalModel, homeId, awayId)
  if (!lambdas) return fallback()

  const poisson = poissonOutcomes(lambdas.lambdaHome, lambdas.lambdaAway)
  const h2h = directMeetings(compMatches, homeId, awayId)

  let home = poisson.home, draw = poisson.draw, away = poisson.away
  if (h2h.count > 0) {
    const w = Math.min(H2H_WEIGHT_MAX, h2h.count * H2H_WEIGHT_PER_MATCH)
    const h2hHome = h2h.hWins / h2h.count
    const h2hDraw = h2h.draws / h2h.count
    const h2hAway = h2h.aWins / h2h.count
    home = home * (1 - w) + h2hHome * w
    draw = draw * (1 - w) + h2hDraw * w
    away = away * (1 - w) + h2hAway * w
  }

  return distribute(home * 100, away * 100, draw * 100)
}

// calcMinute() (matchUtils.js) ne renvoie jamais un nombre brut — toujours
// une string formatée ("45+2'") ou un des labels spéciaux documentés ici.
// On en extrait une minute approximative utilisable pour calcLiveProno.
function parseMinuteValue(minute) {
  if (minute == null)        return 0
  if (typeof minute === 'number') return minute
  if (minute === 'Débute')   return 0
  if (minute === 'MT')       return 45
  if (minute === 'Pause')    return 90   // pause avant prolongations
  if (minute === 'Prolongation') return 105
  if (minute === 'TAB')      return 120
  const m = /^(\d+)/.exec(minute)
  return m ? parseInt(m[1], 10) : 45     // fallback neutre si format inconnu
}

/**
 * calcLiveProno — même proba 1/X/2 que calcProno/calcPronoAdvanced, mais
 * réévaluée en direct selon le score réel et le temps restant. Ce n'est PAS
 * un modèle xG (aucune donnée de tir dispo côté free tier) : c'est une
 * pondération qui fait glisser le curseur du pronostic pré-match (le plus
 * précis dispo — avancé si assez de données saison, sinon forme récente)
 * vers "le résultat actuel tel quel" à mesure que le temps restant diminue.
 *
 * @param {string[]} homeForm
 * @param {string[]} awayForm
 * @param {number|null} homeGoals  score domicile en direct
 * @param {number|null} awayGoals  score extérieur en direct
 * @param {string|number|null} minute  retour brut de calcMinute(match)
 * @param {{homeId?: string|number, awayId?: string|number, compMatches?: object[]}} [opts]
 *   si fournis, utilise calcPronoAdvanced() pour le prior pré-match au lieu
 *   de la simple forme récente.
 */
export function calcLiveProno(homeForm, awayForm, homeGoals, awayGoals, minute, opts = {}) {
  const {
    homeId, awayId, compMatches,
    homeRedCards = 0, awayRedCards = 0,
    homePoss = null, awayPoss = null,
    homeShotsOnTarget = null, awayShotsOnTarget = null,
    homeCorners = null, awayCorners = null,
  } = opts
  const pre = (homeId != null && awayId != null && compMatches?.length)
    ? calcPronoAdvanced(homeId, awayId, compMatches, homeForm, awayForm)
    : calcProno(homeForm, awayForm)
  const diff = (homeGoals ?? 0) - (awayGoals ?? 0)

  const min           = parseMinuteValue(minute)
  const totalDuration = min > 90 ? 120 : 90
  const remaining     = Math.min(1, Math.max(0, (totalDuration - min) / totalDuration))

  // Distribution "si l'arbitre sifflait la fin maintenant" — jamais 100%
  // (un but égalisateur/renversant reste possible même en fin de match).
  // Cas d'égalité : biaisé selon qui était favori au pré-match plutôt qu'un
  // 50/50 arbitraire.
  let now
  if (diff > 0)      now = { home: 90, draw: 8,  away: 2  }
  else if (diff < 0) now = { home: 2,  draw: 8,  away: 90 }
  else {
    const favorHome = pre.home >= pre.away
    now = favorHome
      ? { home: 27, draw: 55, away: 18 }
      : { home: 18, draw: 55, away: 27 }
  }

  // ── Ajustements "pression" (retour utilisateur : prendre en compte les
  // cartons rouges/la possession/les tirs cadrés, pas juste le score brut)
  // ── un carton rouge est un facteur de jeu majeur (supériorité numérique),
  // pondéré nettement plus fort que possession/tirs cadrés (simples
  // indicateurs de "qui domine" à l'instant T, pas de finalité). Toujours
  // borné pour ne jamais, à eux seuls, écraser complètement une issue —
  // distribute() (plus bas) garde de toute façon un plancher de 5% par
  // issue. Appliqué sur `now` (le "si ça se terminait maintenant"), avant le
  // blend avec `pre` — remaining fait déjà décroître son poids en fin de
  // match comme le reste de `now`.
  let swing = 0
  const redDiff = (awayRedCards ?? 0) - (homeRedCards ?? 0)   // >0 = domicile en supériorité numérique
  swing += Math.max(-2, Math.min(2, redDiff)) * 14            // jusqu'à ±28 pts pour 2 cartons d'écart
  if (homePoss != null && awayPoss != null) {
    swing += Math.max(-8, Math.min(8, (homePoss - awayPoss) * 0.15))
  }
  if (homeShotsOnTarget != null && awayShotsOnTarget != null) {
    swing += Math.max(-10, Math.min(10, (homeShotsOnTarget - awayShotsOnTarget) * 1.5))
  }
  // Corners : indicateur de pression territoriale plus faible/bruyant que
  // les tirs cadrés (beaucoup de corners ne débouchent sur rien) — poids et
  // plafond volontairement plus bas. Donnée déjà récupérée sans coût
  // supplémentaire (extractBoxscoreStats, api/fifa-live.js), juste jamais
  // exploitée jusqu'ici.
  if (homeCorners != null && awayCorners != null) {
    swing += Math.max(-6, Math.min(6, (homeCorners - awayCorners) * 0.8))
  }
  if (swing !== 0) {
    now = {
      home: Math.max(1, now.home + swing),
      draw: now.draw,
      away: Math.max(1, now.away - swing),
    }
  }

  // Blend : à la mi-temps (remaining ~0.5) les deux comptent autant, en fin
  // de match "now" écrase le prior, au coup d'envoi (remaining=1) diff vaut
  // toujours 0 donc pre === now de toute façon.
  const home = pre.home * remaining + now.home * (1 - remaining)
  const draw = pre.draw * remaining + now.draw * (1 - remaining)
  const away = pre.away * remaining + now.away * (1 - remaining)

  return distribute(home, away, draw)
}
