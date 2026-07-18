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
// somment à 100, avec un plancher (5% par défaut) par issue (jamais 0%
// affiché). `floor` réglable — voir BLOWOUT_GOAL_MARGIN plus bas
// (calcLiveProno) pour la raison d'être de ce paramètre.
//
// ⚠️ BUG CORRIGÉ (repéré en implémentant la projection Poisson en direct,
// calcLiveProno : celle-ci peut légitimement produire DEUX issues quasi
// nulles en même temps — ex. équipe menée de 3 buts à 15min de la fin, home
// ET draw proches de 0%, away proche de 100%) : l'ancien "cascade" séquentiel
// (chaque `if` relève l'issue sous le plancher SANS jamais redescendre celle
// qui était déjà au-dessus) ne gérait qu'UNE seule issue sous le plancher à
// la fois. Avec deux issues sous 5% simultanément, le dernier `if` (nul<5)
// forçait nul à 5 et recalculait home = 100 - 5 - away SANS que `away` (resté
// à ~99, jamais réajusté) n'ait cédé de terrain aux deux autres → home
// ressortait NÉGATIF (constaté : -4). Remplacé par une redistribution
// proportionnelle : les issues sous le plancher sont remontées à 5%, le
// déficit total est repris PROPORTIONNELLEMENT sur celle(s) au-dessus (au
// lieu d'une seule variable arbitrairement désignée par l'ordre des `if`) —
// avec 3 issues seulement, au plus 2 peuvent être sous le plancher en même
// temps (sinon leur somme+la 3e ne pourrait pas faire 100), donc une seule
// passe de redistribution suffit toujours mathématiquement.
function distribute(h, a, draw, floor = 5) {
  const total = h + a + draw || 1
  const vals = { home: (h / total) * 100, away: (a / total) * 100, nul: (draw / total) * 100 }
  const FLOOR = floor
  const keys  = Object.keys(vals)
  const below = keys.filter(k => vals[k] < FLOOR)
  if (below.length > 0) {
    const above   = keys.filter(k => !below.includes(k))
    const deficit = below.reduce((s, k) => s + (FLOOR - vals[k]), 0)
    below.forEach(k => { vals[k] = FLOOR })
    const aboveSum = above.reduce((s, k) => s + vals[k], 0)
    above.forEach(k => {
      vals[k] = aboveSum > 0 ? vals[k] - deficit * (vals[k] / aboveSum) : vals[k] - deficit / above.length
    })
  }

  let home = Math.round(vals.home)
  let away = Math.round(vals.away)
  let nul  = 100 - home - away   // absorbe l'arrondi, comme avant

  return { home, draw: nul, away }
}

// ── Correction de surconfiance (backtest utilisateur, PL saison 2024-25,
// 380 matchs) ────────────────────────────────────────────────────────────
// Table de calibration observée (% prédit vs % réel de victoire domicile,
// modèle calcPronoAdvanced) : bien calibré dans la zone médiane (20-50%,
// écarts de 1 à 5 points sur des échantillons de 50-65 matchs — du bruit
// normal), mais biais SYSTÉMATIQUE et cohérent sur plusieurs tranches à
// effectif correct aux extrêmes :
//   10-20% prédit (n=37) → 24.3% réel  (sous-estimé de 10 points)
//   60-70% prédit (n=37) → 51.4% réel  (surestimé de 13 points)
//   70-80% prédit (n=34) → 67.6% réel  (surestimé de 6 points)
// → le modèle pousse ses pronostics trop loin vers les extrêmes (pas assez
// d'incertitude gardée). Correctif standard pour ce type de biais :
// "shrinkage" — ramener chaque pronostic PRÉ-MATCH un peu vers une
// répartition neutre représentative du foot en général, sans supprimer le
// signal, juste moins extrémiste. Appliqué à calcProno/calcPronoAdvanced
// (le prior pré-match) mais PAS à calcLiveProno (son ajustement en direct
// reflète de vraies infos du match en cours — score, cartons... — qui
// justifient légitimement plus de confiance en fin de match, contrairement
// à un pronostic pré-match).
// BASE_RATE = répartition moyenne approximative dom/nul/ext toutes ligues
// confondues, avantage domicile inclus (ordre de grandeur connu, pas une
// valeur mesurée sur CE backtest précis).
// ⚠️ SHRINK choisi par raisonnement à partir de l'ampleur des écarts
// observés ci-dessus, PAS re-testé empiriquement après coup — à vérifier en
// relançant scripts/backtest-prono.mjs après ce changement.
const BASE_RATE = { home: 45, draw: 27, away: 28 }
const SHRINK = 0.18

// ⚠️ BUG CORRIGÉ (repéré en corrigeant le bonus avantage domicile ci-dessous
// dans rawFormProno — un premier test avec neutralVenue montrait encore
// home > away malgré la désactivation du bonus d'entrée) : BASE_RATE
// lui-même encode un avantage domicile général (45% dom. vs 28% ext., moyenne
// tous championnats confondus) — le shrink final tirait donc TOUJOURS vers un
// résultat favorable au domicile, même à input parfaitement symétrique, pour
// TOUTE compétition (y compris WC/EC/CAN/COPA à terrain neutre). NEUTRAL_
// BASE_RATE retire cet avantage en répartissant également la masse domicile/
// extérieur (45+28)/2, en gardant le nul identique — utilisé à la place pour
// les compétitions à terrain neutre (voir isNeutralVenueComp, matchUtils.js).
const NEUTRAL_BASE_RATE = {
  home: (BASE_RATE.home + BASE_RATE.away) / 2,
  draw: BASE_RATE.draw,
  away: (BASE_RATE.home + BASE_RATE.away) / 2,
}

function shrinkTowardBase(p, neutralVenue = false) {
  const base = neutralVenue ? NEUTRAL_BASE_RATE : BASE_RATE
  const home = p.home * (1 - SHRINK) + base.home * SHRINK
  const draw = p.draw * (1 - SHRINK) + base.draw * SHRINK
  const away = p.away * (1 - SHRINK) + base.away * SHRINK
  return distribute(home, away, draw)
}

// Version NON shrunk (avant rapprochement vers BASE_RATE) du modèle "forme
// récente" — extraite de calcProno() pour être réutilisable telle quelle
// dans le repli H2H complet ci-dessous (calcPronoAdvanced), qui a besoin de
// mélanger ce prior AVANT le shrink final (le shrink ne doit s'appliquer
// qu'UNE FOIS, sur le résultat déjà mélangé — sinon la base rate serait
// appliquée deux fois et le pronostic s'aplatirait trop vers le neutre).
// Comportement de calcProno() lui-même strictement inchangé pour tout
// appelant qui ne passe pas neutralVenue.
//
// ⚠️ BUG CORRIGÉ (constat utilisateur : "es-tu sûr que c'est la bonne logique
// pour vraiment TOUS les matchs ?") : le bonus "avantage domicile" (+0.4)
// s'appliquait aveuglément, y compris pour Coupe du Monde/Euro/CAN/Copa
// America — des compétitions à hôte UNIQUE où l'immense majorité des matchs
// se jouent sur terrain neutre pour LES DEUX équipes (aucun vrai avantage
// domicile entre, par ex., l'Argentine et la France à un quart de finale au
// Mexique — seul le·s pays hôte·s bénéficie·nt d'un vrai avantage sur SES
// propres matchs, cas non géré ici faute de donnée fiable de lieu de match
// dans l'app). La Ligue des Nations (NL) n'est PAS concernée : sa phase de
// groupes se joue en vrai domicile/extérieur classique, seule la finale à 4
// est à hôte neutre — voir isNeutralVenueComp() dans matchUtils.js.
function rawFormProno(homeForm, awayForm, opts = {}) {
  const { neutralVenue = false } = opts
  const h = strength(homeForm) + (neutralVenue ? 0 : 0.4)   // avantage domicile ~+0.4 pt, nul sur terrain neutre
  const a = strength(awayForm)

  // Poids du nul — retour utilisateur (match en direct 1-0, l'équipe qui perd
  // avait une cote de victoire PLUS BASSE que le nul, jugé pas logique) :
  // avec une constante fixe (1.5), le nul s'écrasait mécaniquement dès que les
  // DEUX équipes étaient en bonne forme (h et a élevés), alors que rien dans
  // la réalité du foot ne justifie ça — deux équipes fortes et globalement
  // proches en niveau (cas Argentine/Angleterre, toutes deux en grande forme)
  // font AU MOINS aussi souvent match nul que deux équipes moyennes, sinon
  // plus (stat foot connue : plus deux équipes sont proches, plus le nul est
  // probable, indépendamment de leur niveau absolu). Le nul doit donc suivre
  // le niveau moyen des deux équipes (avg), pas rester figé, et rester
  // pénalisé seulement quand l'écart entre elles (gap) se creuse.
  // Calibré pour retomber quasiment sur l'ancienne constante (1.5) dans le cas
  // neutre (h=1.9, a=1.5, aucune forme connue) — seul le comportement aux
  // extrêmes (deux équipes fortes et proches) change réellement.
  // ⚠️ Coefficients choisis par raisonnement, PAS backtestés empiriquement —
  // voir scripts/backtest-prono.mjs pour vérifier/affiner sur de vrais résultats.
  const avg = (h + a) / 2
  const gap = Math.abs(h - a)
  const drawWeight = Math.max(0.6, 1.5 * (avg / 1.7) - gap * 0.4)

  return distribute(h, a, drawWeight)
}

/**
 * calcProno — modèle DE BASE (forme récente V/N/D uniquement), gardé tel
 * quel comme filet de sécurité : utilisé quand on n'a pas assez de données
 * saison pour le modèle avancé (calcPronoAdvanced, plus bas) — ex. tout
 * début de phase de groupes d'un Mondial, championnat qui débute.
 *
 * @param {string[]} homeForm  ex: ['W','D','L','W','W']
 * @param {string[]} awayForm  ex: ['L','W','W','D','L']
 * @param {{ neutralVenue?: boolean }} [opts]
 *   neutralVenue : désactive le bonus avantage domicile (+0.4, ET le biais
 *   domicile de BASE_RATE au shrink final) — à passer pour WC/EC/CAN/COPA
 *   (voir isNeutralVenueComp, matchUtils.js).
 * @returns {{ home: number, draw: number, away: number }}  entiers %, somme = 100
 */
export function calcProno(homeForm, awayForm, opts = {}) {
  return shrinkTowardBase(rawFormProno(homeForm, awayForm, opts), opts.neutralVenue)
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
// Exporté : réutilisé par useTeamForm.js pour déclencher le repli saison
// précédente (source unique du seuil, pas de duplication du chiffre 10).
export const MIN_LEAGUE_GAMES = 10  // matchs mini dispo pour une moyenne de championnat fiable
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

// ⚠️ Shrinkage des ratios attaque/défense vers 1.0 (équipe moyenne du
// championnat), proportionnel à l'échantillon dispo — DIAGNOSTIQUÉ via
// scripts/backtest-prono.mjs (mode debug) sur PL/PD/FL1 saison 2025/26
// (constat utilisateur : cote "extérieur gagne" 50%+ trop confiante) :
//   - le biais est DÉJÀ présent dans le Poisson brut, avant tout mélange H2H
//     (H2H ne bouge quasi rien : 67.7%→68.5% sur PL) → pas la cause.
//   - l'échantillon moyen (~9 matchs dom./ext. par équipe à ce stade de
//     saison) n'est PAS anormalement petit (bien au-dessus du plancher
//     MIN_TEAM_SPLITS=2) → un simple relèvement de ce plancher n'aurait rien
//     corrigé, vérifié avant d'y toucher plutôt que deviné.
// Cause réelle : attackHome/defenseHome/attackAway/defenseAway sont des
// ratios "buts observés / moyenne ligue" pris tels quels, puis MULTIPLIÉS
// entre eux dans lambda — sur un échantillon de quelques matchs, le bruit
// d'échantillonnage sur chaque ratio (les buts sont des événements Poisson
// rares, la variance reste élevée même à 9 matchs) se compose au lieu de se
// moyenner, ce qui produit un lambda final bien plus extrême que ce que les
// vraies forces des équipes justifient. Le shrink de sortie existant
// (SHRINK=0.18, voir shrinkTowardBase) intervient trop tard dans le pipeline
// pour corriger ça : il aplatit UNIFORMÉMENT la distribution finale, sans
// rapport avec la fiabilité de CHAQUE ratio individuel qui a produit lambda.
// Correctif : ramener chaque ratio vers 1.0 (équipe moyenne) à hauteur de
// n/(n+RATIO_SHRINK_K) — avec n matchs réels, seul n/(n+K) du signal brut est
// gardé, le reste retombe sur le neutre. K=8 : ~53% de confiance à 9 matchs
// (notre échantillon moyen observé), ~65% à 15, quasi 100% à 40+ (fin de
// saison, l'estimation redevient fiable). Appliqué symétriquement aux 4
// ratios (pas seulement "extérieur") : le biais n'a aucune raison structurelle
// de se limiter à l'issue extérieure, juste plus visible sur cette tranche
// dans notre échantillon de diagnostic.
// ⚠️ K=8 choisi par raisonnement (même ordre de grandeur que
// MIN_LEAGUE_GAMES=10), PAS encore re-testé empiriquement après ce
// changement — à vérifier en relançant scripts/backtest-prono.mjs.
const RATIO_SHRINK_K = 8
function shrinkRatio(ratio, n) {
  const w = n / (n + RATIO_SHRINK_K)
  return 1 + (ratio - 1) * w
}

// Buts attendus (λ) pour chaque équipe à partir de sa force d'attaque/
// défense relative à la moyenne du championnat (modèle attaque×défense
// classique, ex. Dixon-Coles simplifié).
function computeLambdas(goalModel, homeId, awayId) {
  const home = goalModel.per[homeId]
  const away = goalModel.per[awayId]
  if (!home || !away || home.hCount < MIN_TEAM_SPLITS || away.aCount < MIN_TEAM_SPLITS) return null

  const { leagueAvgHome, leagueAvgAway } = goalModel
  const attackHome  = shrinkRatio((home.hFor     / home.hCount) / leagueAvgHome, home.hCount)
  const defenseHome = shrinkRatio((home.hAgainst / home.hCount) / leagueAvgAway, home.hCount)
  const attackAway  = shrinkRatio((away.aFor     / away.aCount) / leagueAvgAway, away.aCount)
  const defenseAway = shrinkRatio((away.aAgainst / away.aCount) / leagueAvgHome, away.aCount)

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
 * @param {{ fullH2H?: object[], debug?: boolean }} [opts]
 *   fullH2H : confrontations directes TOUTES compétitions/saisons confondues
 *   (voir useH2H/useH2HRows, déjà chargées sur la fiche d'un match précis
 *   pour l'onglet Historique — aucun appel réseau en plus ici). Plus riche
 *   que le H2H "gratuit" tiré de compMatches (limité à la saison en cours de
 *   CETTE compétition) : utilisée à la place quand fournie et non vide, y
 *   compris comme repli en tout début de saison quand compMatches n'a pas
 *   encore assez de matchs pour le modèle buts marqués/encaissés (voir plus
 *   bas). Volontairement PAS utilisée dans les listes de plusieurs matchs à
 *   la fois (Pronos.jsx, cards Accueil) : useH2H appelle un endpoint FD.org
 *   PAR match — un appel par carte affichée dépasserait vite le budget
 *   partagé (7 req/min, voir api/football.js).
 *   debug : si true, ajoute une clé _debug au résultat avec le détail
 *   couche par couche (Poisson brut → après H2H → après shrink) — UNIQUEMENT
 *   pour scripts/backtest-prono.mjs (diagnostiquer LAQUELLE des 3 couches
 *   cause un biais de calibration observé, plutôt que deviner). Aucun
 *   appelant de l'app ne passe ce flag → comportement de production
 *   strictement inchangé (la clé _debug est juste ignorée par les
 *   appelants qui ne la lisent pas).
 *   neutralVenue : désactive le bonus avantage domicile dans le REPLI forme
 *   récente (voir rawFormProno) — pour WC/EC/CAN/COPA (isNeutralVenueComp,
 *   matchUtils.js). Le modèle buts marqués/encaissés (Poisson, ci-dessous)
 *   n'a volontairement PAS besoin du même traitement : il calcule déjà
 *   leagueAvgHome/leagueAvgAway à partir des VRAIS matchs de CETTE
 *   compétition (compMatches) — sur un tournoi à hôte neutre, ces deux
 *   moyennes se rejoignent naturellement d'elles-mêmes (aucun avantage
 *   domicile réel dans les données), rien à corriger artificiellement là.
 *   Seul le repli (utilisé tôt dans un tournoi, avant assez de matchs pour
 *   le modèle buts) applique un bonus FIXE non dérivé des données — c'est
 *   uniquement CE bonus-là qu'il faut neutraliser.
 */
export function calcPronoAdvanced(homeId, awayId, compMatches, homeForm, awayForm, opts = {}) {
  const { fullH2H, debug, neutralVenue } = opts

  // Repli enrichi : pas (encore) assez de données saison pour le modèle buts
  // marqués/encaissés (ex. tout début de saison, compMatches quasi vide) —
  // si un historique de confrontations complet est fourni, mieux vaut s'en
  // servir qu'un neutre plat identique pour tous les matchs. Même barème de
  // poids que le correctif H2H du modèle avancé plus bas (H2H_WEIGHT_*),
  // mélangé au prior "forme récente" (rawFormProno, PAS encore shrunk — le
  // shrink final s'applique une seule fois, sur le résultat déjà mélangé).
  const fallback = () => {
    if (homeId != null && awayId != null && fullH2H?.length) {
      const h2h = directMeetings(fullH2H, homeId, awayId)
      if (h2h.count > 0) {
        const raw = rawFormProno(homeForm, awayForm, { neutralVenue })
        const w = Math.min(H2H_WEIGHT_MAX, h2h.count * H2H_WEIGHT_PER_MATCH)
        const home = raw.home * (1 - w) + (h2h.hWins / h2h.count) * 100 * w
        const draw = raw.draw * (1 - w) + (h2h.draws / h2h.count) * 100 * w
        const away = raw.away * (1 - w) + (h2h.aWins / h2h.count) * 100 * w
        const result = shrinkTowardBase(distribute(home, away, draw), neutralVenue)
        if (debug) result._debug = { path: 'fallback-h2h', h2hCount: h2h.count }
        return result
      }
    }
    const result = calcProno(homeForm, awayForm, { neutralVenue })
    if (debug) result._debug = { path: 'fallback-base' }
    return result
  }
  if (homeId == null || awayId == null) return fallback()

  const goalModel = buildGoalModel(compMatches)
  if (!goalModel) return fallback()

  const lambdas = computeLambdas(goalModel, homeId, awayId)
  if (!lambdas) return fallback()

  const poisson = poissonOutcomes(lambdas.lambdaHome, lambdas.lambdaAway)
  // H2H complet (fullH2H) préféré s'il est fourni et non vide — sinon repli
  // sur compMatches (comportement identique à avant pour tout appelant qui
  // ne passe pas fullH2H, ex. Pronos.jsx/Accueil).
  const h2h = directMeetings(fullH2H?.length ? fullH2H : compMatches, homeId, awayId)

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

  const result = shrinkTowardBase(distribute(home * 100, away * 100, draw * 100), neutralVenue)
  if (debug) {
    result._debug = {
      path: 'poisson',
      poisson: { home: poisson.home * 100, draw: poisson.draw * 100, away: poisson.away * 100 },
      afterH2H: { home: home * 100, draw: draw * 100, away: away * 100 },
      h2hCount: h2h.count,
      homeAwaySplits: { hCount: goalModel.per[homeId]?.hCount, aCount: goalModel.per[awayId]?.aCount },
    }
  }
  return result
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

// ── Projection Poisson en direct ────────────────────────────────────────
// Retour utilisateur (bug réel : France favorite pré-match, menée 0-3 par
// l'Angleterre — cote nul 6,74 MAIS cote victoire France 3,37, la victoire
// ressortait plus probable que le nul, ce qui est structurellement
// impossible) : l'ancien "now" de calcLiveProno (formule de verrouillage
// ad-hoc, +3pts par but d'écart au-delà du 1er) mélangée linéairement avec
// le pronostic pré-match ne respectait aucune contrainte réelle. Remplacé
// par une vraie projection Poisson : mêmes buts espérés (λ) que le modèle
// pré-match, mis à l'échelle du temps restant, combinés au score actuel —
// un calcul de probabilité, pas une formule inventée. Une projection Poisson
// ne peut par nature pas produire une victoire plus probable qu'un nul pour
// l'équipe menée sur des λ réalistes (gagner demande de combler l'écart ET
// de le dépasser d'un but, toujours au moins aussi rare) — le bug signalé
// disparaît par construction, pas par un correctif appliqué après coup.

// P(victoire dom./nul/victoire ext.) à partir d'un écart de buts déjà
// acquis (diff = buts dom. - buts ext. au moment T) et des buts encore
// espérés de chaque équipe jusqu'à la fin (lambdaHome/lambdaAway, DÉJÀ mis à
// l'échelle du temps restant par l'appelant) — même grille Poisson que
// poissonOutcomes(), décalée de `diff` plutôt que comparée à 0.
function poissonOutcomesFromDiff(lambdaHome, lambdaAway, diff) {
  let home = 0, draw = 0, away = 0
  for (let i = 0; i <= MAX_GOALS_GRID; i++) {
    const pi = poissonPmf(lambdaHome, i)
    for (let j = 0; j <= MAX_GOALS_GRID; j++) {
      const p = pi * poissonPmf(lambdaAway, j)
      const finalDiff = diff + i - j
      if (finalDiff > 0) home += p
      else if (finalDiff < 0) away += p
      else draw += p
    }
  }
  const total = home + draw + away || 1
  return { home: home / total, draw: draw / total, away: away / total }
}

// Buts totaux/match plausibles (plage large, pas une valeur unique
// "correcte") — bornes de recherche pour fitLambdasToPreMatch ci-dessous,
// pas une moyenne appliquée aveuglément à tous les matchs.
const FIT_TOTAL_GOALS_MIN = 1.2
const FIT_TOTAL_GOALS_MAX = 4.5

// Retrouve une paire (λh, λa) de Poisson qui reproduit fidèlement un
// pronostic pré-match déjà calculé (`pre`, home/draw/away en %) — PAS une
// nouvelle prédiction : la même, juste reformulée en taux de buts espérés
// pour pouvoir être projetée dans le temps restant (poissonOutcomesFromDiff
// ci-dessus a besoin de λ, pas de %). Utilisée uniquement quand on n'a pas
// de VRAIES stats buts marqués/encaissés saison (goalModel indisponible,
// voir calcLiveProno) — sinon on utilise directement les λ mesurés.
// Recherche à 2 paramètres par bissections imbriquées :
//  - le total de buts (λh+λa) pilote surtout la proba de nul (plus de buts
//    espérés = plus de variance = statistiquement moins de nuls) ;
//  - pour un total donné, la répartition λh/λa pilote le rapport dom/ext.
// ~350 évaluations de poissonOutcomes (grille 9×9) au total — largement
// négligeable en coût (pas d'appel réseau, calcul pur), même appelé à
// chaque re-render live.
function fitLambdasToPreMatch(pre) {
  const targetHome = pre.home / 100
  const targetDraw = pre.draw / 100

  function splitForTotal(total) {
    let lo = 0.05, hi = total - 0.05
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2
      const out = poissonOutcomes(mid, total - mid)
      // Plus de λ domicile (à total fixé, donc moins de λ extérieur) → plus
      // de victoires domicile — relation monotone, la bissection converge.
      if (out.home < targetHome) lo = mid
      else hi = mid
    }
    const lambdaHome = (lo + hi) / 2
    return { lambdaHome, lambdaAway: total - lambdaHome }
  }

  let loT = FIT_TOTAL_GOALS_MIN, hiT = FIT_TOTAL_GOALS_MAX
  let best = splitForTotal((loT + hiT) / 2)
  for (let i = 0; i < 16; i++) {
    const midT = (loT + hiT) / 2
    best = splitForTotal(midT)
    const out = poissonOutcomes(best.lambdaHome, best.lambdaAway)
    // Nul obtenu trop élevé → il faut PLUS de buts totaux (plus de variance,
    // moins de nuls), et inversement.
    if (out.draw > targetDraw) loT = midT
    else hiT = midT
  }
  return best
}

// ── Plancher d'affichage CONTINU pour le direct ─────────────────────────
// Retour utilisateur en 2 temps :
//  1. "à 4-0 la France marque, ça devient 4-1, et les cotes bougent pas" —
//     un 1er correctif (plancher fixe 5%→2% déclenché à partir de 4 buts
//     d'écart) réglait ce cas précis.
//  2. "ça prend bien en compte aussi quand ça s'approche de la fin du
//     match... l'outsider mené 3-0 ou 2-0 à la fin, ou 3-0 en milieu de
//     jeu" — en vérifiant NUMÉRIQUEMENT (voir historique de session), un
//     déficit de seulement 3 buts fait DÉJÀ chuter la vraie proba Poisson de
//     l'outsider sous 5% dès la 15-30e minute, et un déficit de 2 buts
//     plafonne dès la 45e — alors que la proba RÉELLE continue de baisser
//     tout du long jusqu'à la fin du match (vérifié : déficit de 2 buts,
//     proba du favori passant de 89.0% à la 5e à 99.98% à la 88e, en hausse
//     continue — seul l'AFFICHAGE plafonnait trop tôt). Le seuil fixe "4
//     buts d'écart" du 1er correctif, testé à nouveau sur ce cas, ne faisait
//     que déplacer le plafond un cran plus loin (nouveau plateau plat dès
//     que la proba brute dépassait 90%) : ENCORE un plancher fixe, donc
//     ENCORE un plafond artificiel quelque part.
// Un plancher fixe, quel qu'il soit, plafonne TOUJOURS le favori à
// (100 - 2×plancher) : le seul moyen d'éviter un plateau plat est de faire
// DÉCROÎTRE le plancher lui-même à mesure que la proba brute grimpe, au lieu
// d'un simple interrupteur à 2 valeurs. Décroissance linéaire de 5% à 2%
// entre 80% et 100% de proba brute du favori. En dessous de 80%,
// comportement strictement inchangé (plancher standard à 5%, celui calibré
// par le backtest pour le pré-match).
// ⚠️ Plancher dur à 2%, PAS 1% (bug réel repéré en testant ce changement) :
// l'enforcement anti-égalité nul/victoire de l'équipe menée (plus bas dans
// calcLiveProno, "target = Math.max(1, result.draw - 1)") a lui-même besoin
// qu'il reste au moins 1 point EN DESSOUS du nul pour repousser la victoire
// — si le nul lui-même tombe déjà à 1% (plancher à 1%), il n'y a plus de
// place pour descendre la victoire en dessous sans afficher 0% (interdit) :
// les deux se retrouvaient identiques à 1%, ré-introduisant exactement le
// bug d'égalité déjà corrigé. Avec un plancher dur à 2%, le nul ne descend
// jamais sous 2%, laissant toujours au moins 1% de marge pour l'enforcement.
function liveFloorFor(rawFavoritePct) {
  if (rawFavoritePct <= 80) return 5
  const t = Math.min(1, (rawFavoritePct - 80) / 20)  // 0 à 80%, 1 à 100%
  return Math.max(2, 5 - t * 3)
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
 * @param {{homeId?: string|number, awayId?: string|number, compMatches?: object[], fullH2H?: object[], neutralVenue?: boolean}} [opts]
 *   si homeId/awayId fournis, utilise calcPronoAdvanced() pour le prior
 *   pré-match au lieu de la simple forme récente — fullH2H (optionnel,
 *   confrontations toutes compétitions, voir calcPronoAdvanced) transite
 *   telle quelle, y compris quand compMatches est vide/insuffisant.
 *   neutralVenue transite aussi telle quelle (voir calcPronoAdvanced).
 */
export function calcLiveProno(homeForm, awayForm, homeGoals, awayGoals, minute, opts = {}) {
  const {
    homeId, awayId, compMatches, fullH2H, neutralVenue,
    homeRedCards = 0, awayRedCards = 0,
    homePoss = null, awayPoss = null,
    homeShotsOnTarget = null, awayShotsOnTarget = null,
    homeCorners = null, awayCorners = null,
  } = opts
  // Condition élargie (avant : exigeait compMatches?.length) — calcPronoAdvanced
  // gère déjà tout seul le cas compMatches vide (repli sur fullH2H puis sur
  // calcProno), donc plus besoin de filtrer ici : ça permet à fullH2H de
  // servir de repli même quand compMatches est vide (tout début de saison).
  // Comportement strictement inchangé pour tout appelant qui ne passe pas
  // fullH2H (retombe exactement sur calcProno comme avant).
  const pre = (homeId != null && awayId != null)
    ? calcPronoAdvanced(homeId, awayId, compMatches, homeForm, awayForm, { fullH2H, neutralVenue })
    : calcProno(homeForm, awayForm, { neutralVenue })
  const diff = (homeGoals ?? 0) - (awayGoals ?? 0)

  const min           = parseMinuteValue(minute)
  const totalDuration = min > 90 ? 120 : 90
  const remaining     = Math.min(1, Math.max(0, (totalDuration - min) / totalDuration))

  // Coup d'envoi exact (0-0, minute 0) : rien à projeter, le direct EST le
  // pré-match — évite aussi toute imprécision numérique de la projection
  // Poisson ci-dessous (bissections, voir fitLambdasToPreMatch) à cet
  // instant précis.
  if (diff === 0 && remaining === 1) return pre

  // ── Projection Poisson : buts espérés (λ) mis à l'échelle du temps
  // restant, combinés au score actuel — voir le commentaire détaillé au-
  // dessus de poissonOutcomesFromDiff/fitLambdasToPreMatch. λ RÉELS (mesurés
  // sur la saison) quand dispo, sinon la MÊME info que `pre` juste
  // reformulée en taux de buts.
  const goalModel = (homeId != null && awayId != null) ? buildGoalModel(compMatches) : null
  const measuredLambdas = goalModel ? computeLambdas(goalModel, homeId, awayId) : null
  const { lambdaHome: rawLambdaHome, lambdaAway: rawLambdaAway } = measuredLambdas ?? fitLambdasToPreMatch(pre)

  // ── Correctif surconfiance EN DIRECT (retour utilisateur : "pour l'équipe
  // favorite à la base... je trouve qu'on est un peu trop sévère sur les
  // côtes quand elle perd, même si le match se rapproche de la fin") ──
  // Le backtest PL 2024-25 (voir BASE_RATE/SHRINK plus haut) a mesuré que le
  // moteur buts marqués/encaissés (calcPronoAdvanced, celui qui calcule
  // lambdaHome/lambdaAway ci-dessus) surestime sa confiance aux extrêmes
  // (un pronostic annoncé 60-70% ne se vérifiait en réalité qu'à 51,4%).
  // Cette correction (shrinkTowardBase/SHRINK) n'est appliquée QU'au
  // pré-match — jamais ici en direct, sous prétexte que le score réel
  // justifie plus de confiance. C'est vrai POUR LE SCORE lui-même (une
  // vraie donnée, pas une prédiction), mais le moteur qui projette le TEMPS
  // RESTANT reste exactement le même moteur dont le biais a été mesuré — le
  // direct hérite donc probablement du même biais, sans jamais le corriger.
  // Fix ciblé : on resserre l'ÉCART entre lambdaHome et lambdaAway (pas leur
  // somme — le total de buts attendus, qui pilote la vraisemblance d'un nul
  // en fin de match avec peu de temps restant, reste intact et légitime,
  // voir poissonOutcomesFromDiff) vers leur moyenne. Ne touche donc QUE la
  // partie du calcul liée à l'écart de force entre équipes (exactement ce
  // que le backtest a trouvé trop confiant), sans affaiblir la certitude
  // légitime d'un nul quand il ne reste presque plus de temps.
  // ⚠️ LIVE_LAMBDA_SHRINK choisi par raisonnement (un peu plus léger que le
  // SHRINK=0.18 du pré-match : une partie du signal a déjà été atténuée en
  // amont — RATIO_SHRINK_K pour les λ mesurés sur la saison, le shrink du
  // pré-match lui-même pour les λ reconstruits via fitLambdasToPreMatch),
  // PAS re-testé sur un vrai backtest en direct (aucun n'existe à ce jour
  // pour calcLiveProno) — à vérifier si un backtest live devient possible.
  const LIVE_LAMBDA_SHRINK = 0.15
  const lambdaAvg = (rawLambdaHome + rawLambdaAway) / 2
  const baseLambdaHome = rawLambdaHome * (1 - LIVE_LAMBDA_SHRINK) + lambdaAvg * LIVE_LAMBDA_SHRINK
  const baseLambdaAway = rawLambdaAway * (1 - LIVE_LAMBDA_SHRINK) + lambdaAvg * LIVE_LAMBDA_SHRINK

  // Rythme RÉEL de CE match (retour utilisateur : "4-3 à la 70e, la cote de
  // l'équipe menée d'1 seul but est à 18, pas cohérent, l'équipe est
  // favorite" — vérifié : le modèle donnait EXACTEMENT la même cote pour
  // 4-3 que pour 1-0 à la même minute, parce que seul l'écart de buts (1
  // dans les 2 cas) comptait, jamais le nombre total de buts déjà marqués.
  // Un 4-3 est pourtant la preuve que CE match précis est très ouvert
  // (défenses qui craquent) — bien plus propice à encore marquer dans les
  // 20 dernières minutes qu'un match resté 1-0, alors que les λ pré-match/
  // saison (mêmes dans les 2 cas) ne peuvent PAS le savoir à l'avance.
  // Corrigé : le rythme de buts déjà observé DANS ce match (buts marqués /
  // minutes jouées, projeté sur un match complet) est mélangé au rythme
  // attendu pré-match — avec un poids qui grandit avec le nombre de minutes
  // déjà jouées (plus de buts observés = plus fiable, même logique de
  // shrinkage que shrinkRatio/RATIO_SHRINK_K plus haut, échantillon encore
  // trop petit à la 5e pour en tirer grand-chose). Le ratio obtenu (rythme
  // réel / rythme attendu) remet à l'échelle λh ET λa ENSEMBLE (préserve
  // leur répartition dom/ext, seul le total de buts espérés change).
  // ⚠️ Échantillon minimum avant d'en tirer une conclusion (même logique que
  // MIN_LEAGUE_GAMES/MIN_TEAM_SPLITS plus haut) : sur les 20 premières
  // minutes, l'extrapolation "buts marqués / minutes jouées" est bien trop
  // bruitée pour être exploitable (1-2 buts précoces → un rythme extrapolé
  // délirant, ex. 2 buts en 5min → "36 buts sur le match" avant même la
  // moindre pondération) — testé : même fortement amorti par le shrinkage,
  // ce bruit initial faisait parfois ressortir des inversions absurdes
  // (4-1 affiché plus favori que 4-0 à la 5e minute). Ce n'est de toute
  // façon pas le cas d'usage visé (le retour utilisateur portait sur la
  // 70e minute) — en dessous de 20min, comportement inchangé (paceFactor=1).
  // Au-delà, le poids donné au rythme observé grandit en continu (même
  // logique de shrinkage que shrinkRatio/RATIO_SHRINK_K plus haut).
  const MIN_PACE_MINUTES = 20
  const PACE_SHRINK_K = 45  // minutes pour arriver à 50% de confiance dans le rythme observé
  const MAX_PACE_FACTOR = 2.5  // borné : un coup de chaud dans le match ne doit pas non plus devenir délirant
  const totalGoalsSoFar   = (homeGoals ?? 0) + (awayGoals ?? 0)
  const baselinePace      = baseLambdaHome + baseLambdaAway
  let paceFactor = 1
  if (min >= MIN_PACE_MINUTES && totalGoalsSoFar > 0 && baselinePace > 0) {
    const observedFullMatchPace = (totalGoalsSoFar / min) * totalDuration
    const w = min / (min + PACE_SHRINK_K)
    const blendedPace = baselinePace * (1 - w) + observedFullMatchPace * w
    paceFactor = Math.max(1 / MAX_PACE_FACTOR, Math.min(MAX_PACE_FACTOR, blendedPace / baselinePace))
  }
  const lambdaHome = baseLambdaHome * paceFactor
  const lambdaAway = baseLambdaAway * paceFactor

  const proj = poissonOutcomesFromDiff(lambdaHome * remaining, lambdaAway * remaining, diff)
  let home = proj.home * 100
  let draw = proj.draw * 100
  let away = proj.away * 100

  // ── Ajustements "pression" (retour utilisateur : prendre en compte les
  // cartons rouges/la possession/les tirs cadrés, pas juste le score brut)
  // — un carton rouge est un facteur de jeu majeur (supériorité numérique),
  // pondéré nettement plus fort que possession/tirs cadrés (simples
  // indicateurs de "qui domine" à l'instant T, pas de finalité). Toujours
  // borné pour ne jamais, à eux seuls, écraser complètement une issue —
  // distribute() (plus bas) garde de toute façon un plancher de 5% par
  // issue. Ces signaux (cartons/possession/tirs/corners) n'ont pas
  // d'équivalent dans le modèle Poisson buts marqués/encaissés pré-match —
  // appliqués ici en ajustement direct sur le résultat de la projection,
  // logique de pondération inchangée (déjà éprouvée, testée ci-dessous).
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
    home = Math.max(1, home + swing)
    away = Math.max(1, away - swing)
  }

  // Garde-fou mathématique (belt and suspenders) : une projection Poisson
  // sur des λ réalistes ne peut normalement pas produire une victoire plus
  // probable qu'un nul pour l'équipe menée (voir commentaire au-dessus de
  // poissonOutcomesFromDiff) — gardé quand même en dernier recours après les
  // ajustements "pression" ci-dessus (eux ne sont PAS contraints par la
  // même logique Poisson, un gros swing pourrait en théorie repousser home
  // au-dessus de draw même en étant mené).
  if (diff < 0 && home > draw) {
    away += home - draw
    home = draw
  } else if (diff > 0 && away > draw) {
    home += away - draw
    away = draw
  }

  // ⚠️ Le plancher continu se base sur la proba de la SEULE projection
  // Poisson (`proj`, avant les ajustements "pression" ci-dessus), PAS sur
  // `home/draw/away` après swing — les cartons/possession/tirs/corners sont
  // des signaux bien plus faibles/circonstanciels qu'un écart de buts déjà
  // acquis (voir commentaire au-dessus de `swing`, "jamais, à eux seuls,
  // écraser complètement une issue") : un carton rouge à score vierge ne
  // doit PAS pouvoir, à lui seul, faire descendre le plancher sous 5% —
  // seule une vraie certitude Poisson (issue d'un écart de buts réel projeté
  // dans le temps restant) le justifie.
  const projFavoritePct = Math.max(proj.home, proj.draw, proj.away) * 100
  const result = distribute(home, away, draw, liveFloorFor(projFavoritePct))

  // Retour utilisateur (à raison) : "tu peux pas mettre la même cote pour
  // match nul et victoire de l'équipe qui perd, ça a aucun sens" — le
  // garde-fou ci-dessus égalise déjà home/draw (ou away/draw) sur les
  // valeurs BRUTES (float), mais le plancher d'affichage à 5% de
  // distribute() peut ensuite arrondir DEUX valeurs distinctes (ex. 0.6%
  // et 1.8%) au MÊME entier (5%), effaçant leur différence — victoire et
  // nul ressortent identiques à l'écran alors que gagner reste
  // structurellement plus dur que faire nul. Corrigé après coup, sur le
  // résultat déjà arrondi : si l'égalité survit, un point est repris sur la
  // victoire (jamais sous 1%) et rendu à l'équipe qui mène — la cote de
  // victoire de l'équipe menée reste ainsi TOUJOURS strictement plus haute
  // (moins probable) que celle du nul, jamais identique.
  if (diff < 0 && result.home >= result.draw) {
    const target = Math.max(1, result.draw - 1)
    const shift  = result.home - target
    result.home = target
    result.away += shift
  } else if (diff > 0 && result.away >= result.draw) {
    const target = Math.max(1, result.draw - 1)
    const shift  = result.away - target
    result.away = target
    result.home += shift
  }

  return result
}
