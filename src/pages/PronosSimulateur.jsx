/**
 * PronosSimulateur — page "Simulateur" (switcher tout en haut de Pronos.jsx,
 * PAS un onglet parmi Pronos/Résultat/Classement).
 *
 * Confrontation hypothétique entre 2 équipes, MÊME si elles ne se jouent pas
 * cette saison (ex. Real Madrid vs Bayern Munich) — demande utilisateur
 * (28/08) : "personne ne fait ça", moteur déjà existant (calcProno.js),
 * juste appliqué à un choix libre plutôt qu'aux vrais matchs du calendrier.
 *
 * ⚠️ Portée volontairement limitée aux 6 grands championnats club (FL1, PL,
 * PD, BL1, SA, CL) — CE SONT LES SEULES compétitions de l'app avec un vrai
 * classement/liste d'équipes exploitable (useStandings) ET une vraie forme
 * récente comparable (useTeamForm). Les sélections nationales (WC/EC/NL/
 * CAN/COPA) et les compétitions 100% ESPN sans classement (UEL/UECL, voir
 * NO_STANDINGS_COMPS dans data/competitions.js) n'ont pas de liste
 * d'équipes exploitable ici — pas ajoutées plutôt que bricolées.
 *
 * ⚠️ Modèle RÉÉCRIT (28/08, constat utilisateur : "souvent le meme score...
 * ça monte rarement au dessu de 2 buts... enleve ça a moins que tu es une
 * alternative") — root cause de la platitude : l'ancien modèle passait par
 * calcPronoAdvanced(compMatches=[]) qui ne donne QUE 3 % (dom./nul/ext.),
 * puis fitLambdasToPreMatch reconstruisait des buts espérés (λ) en
 * cherchant, par bissection, N'IMPORTE QUELLE paire qui reproduit ces 3 %
 * (bornée à 1.2-4.5 buts TOTAL, voir FIT_TOTAL_GOALS_MIN/MAX dans
 * calcProno.js) — un aller-retour avec perte : 2 équipes qui marquent
 * beaucoup mais dont le % 1/N/2 final ressemble à n'importe quel autre match
 * "équilibré" retombaient sur les mêmes λ modérés que n'importe quelle autre
 * paire, quelle que soit leur vraie intensité offensive. Les vrais λ
 * n'étaient JAMAIS utilisés pour l'affichage, seulement en interne par
 * calcPronoAdvanced puis jetés.
 *
 * Nouveau modèle : buts marqués/encaissés RÉELS de chaque équipe (3 saisons
 * pooled, voir pooledForm/useH2HHistory plus bas), MAIS chaque équipe
 * normalisée contre SA PROPRE moyenne de championnat (buildGoalModel,
 * calcProno.js, exporté pour l'occasion — même fonction/mêmes constantes que
 * le modèle "réel" utilisé par Pronos/Mes Paris, aucune logique dupliquée) —
 * c'est précisément ce qui manquait pour ne pas comparer 2 équipes de
 * championnats différents à l'aveugle (l'objection d'origine, 28/08 plus
 * haut dans l'historique) : Bundesliga et Ligue 1 n'ont pas le même niveau
 * de scoring moyen, donc une équipe est mesurée par rapport AUX AUTRES
 * ÉQUIPES DE SON PROPRE CHAMPIONNAT (ratio attaque/défense, shrinkRatio),
 * puis ce ratio est appliqué à une base neutre commune = MOYENNE DES 2
 * CHAMPIONNATS (ni l'un ni l'autre favorisé) plutôt qu'à la moyenne d'un
 * seul — voir crossLeagueLambdas plus bas. Repli automatique sur l'ancien
 * chemin forme+H2H (fitLambdasToPreMatch) uniquement si les données sont
 * insuffisantes pour un championnat donné (buildGoalModel renvoie null,
 * <10 matchs même après pooling 3 saisons — cas rarissime).
 *
 * H2H (useCrossCompH2H) mélangé DIRECTEMENT dans les λ (blendH2HIntoLambdas,
 * moyenne réelle des buts marqués lors des vraies confrontations, pondérée
 * comme H2H_WEIGHT_MAX/H2H_WEIGHT_PER_MATCH — mêmes constantes que le reste
 * de l'app, exportées) plutôt qu'au niveau des %, pour ne plus jamais perdre
 * l'info "combien de buts" en cours de route.
 *
 * ⚠️ Affichage du résultat (28/08, demande utilisateur : "je demande de
 * simulé le score exact et tout... pas les côtes on s'en fou de ça") — PAS
 * de pilules de cotes 1/N/2 : scoreExactProbabilities (déjà utilisée dans
 * Mes Paris, grille Poisson) appliquée DIRECTEMENT aux λ réels ci-dessus.
 *
 * ⚠️ Design (28/08, demande utilisateur : "ça fait pas design du tout") —
 * vrais logos de club (row.team.crest, déjà exposé par football-data.org via
 * useStandings, même source que Classement.jsx/Match.jsx) plutôt que du
 * texte seul, card wrapper cohérent avec le reste de l'app (--bg-card/
 * --border), select stylé avec chevron custom (repris du pattern
 * .classement__selectShell/Icon déjà utilisé sur la page Classement).
 */
import { useState, useMemo } from 'react'
import { useStandings } from '../hooks/useStandings'
import { useTeamFormMulti, buildFormMap } from '../hooks/useTeamForm'
import { useH2HHistory } from '../hooks/useMatchs'
import { useCrossCompH2H } from '../hooks/useCrossCompH2H'
import {
  calcPronoAdvanced, fitLambdasToPreMatch, poissonPmf,
  buildGoalModel, clampLambda, shrinkRatio, MIN_TEAM_SPLITS,
  H2H_WEIGHT_MAX, H2H_WEIGHT_PER_MATCH,
} from '../utils/calcProno'
import { finalScore } from '../utils/matchUtils'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'

const SIM_COMP_IDS = ['FL1', 'PL', 'PD', 'BL1', 'SA', 'CL']
const SIM_COMPS = COMPETITIONS.filter(c => SIM_COMP_IDS.includes(c.id))

// ⚠️ AJOUT (28/08, constat utilisateur : "ça me donne a chaque fois le score
// 1-1") — root cause vérifiée (pas devinée) : on est à J1-J2 de la saison
// 2026-2027 (playedGames:1 sur la quasi-totalité des clubs PL au moment de
// cet ajout, confirmé via /api/football standings réel). useTeamForm.js ne
// construit JAMAIS formMap depuis la saison précédente (décision explicite
// du 25/07, "le mercato a pu tout changer entre-temps", voir son
// commentaire) — formMap est donc PRESQUE VIDE pour la quasi-totalité des
// clubs de TOUS les championnats en ce moment précis, pas juste ici. Avec 2
// équipes en forme neutre des 2 côtés, le modèle Poisson converge presque
// toujours sur 1-1 (score le plus probable pour 2 λ proches et modérés) —
// vérifié empiriquement (voir historique) : le H2H multi-années ci-dessus
// fonctionne bel et bien et déplace la prédiction dès qu'il y a un vrai
// signal (testé Arsenal-Chelsea, H2H dominant → 1-0 devient le score le
// plus probable), mais ne peut rien faire quand il n'y a NI H2H NI forme
// des 2 côtés.
//
// ⚠️ AFFINÉ (28/08, demande utilisateur : "fait un assemblage de la saison
// en cours et des 2 ou 3 saisons precedentes... regroupé ça en une requete
// pour pas embeter fTdata") — plutôt qu'un nouveau mécanisme, réutilise
// useH2HHistory (useMatchs.js), DÉJÀ existant et utilisé ailleurs (Historique
// H2H sur la fiche match) : 1 fetch PAR SAISON supplémentaire (2 max,
// EXTRA_H2H_SEASONS_BACK dans ce fichier), jamais par équipe/comparaison, et
// surtout caché 90 JOURS et PARTAGÉ avec tout le reste de l'app (si un autre
// utilisateur a déjà ouvert un match de ce championnat récemment, ces 2
// appels sont déjà en cache — aucun nouvel appel FD.org). Testé en direct
// (fetch réel PL, dateFrom=2024-07-01&dateTo=2026-06-30, en UN SEUL appel) :
// FD.org accepte bien ~2 saisons dans une même requête (760 matchs reçus,
// 2024-08-16 → 2026-05-24) mais renvoie VIDE au-delà (3 saisons pleines en 1
// seul appel testé, échoue) — d'où le choix de réutiliser useH2HHistory tel
// quel (2 appels séparés, déjà la bonne limite trouvée par le passé) plutôt
// que de retenter une fusion en 1 seule requête qui ne marche pas de toute
// façon au-delà de 2 saisons.
// Forme reconstruite en fusionnant saison en cours (déjà chargée par
// useTeamFormMulti, matchesByComp) + ces 2 saisons précédentes, triées
// chronologiquement, puis les 5 DERNIERS matchs (buildFormMap, comme
// partout ailleurs) — si la saison en cours a déjà 5 matchs joués, elle
// suffit seule (les plus anciens ne sont jamais pris) ; sinon on pioche
// naturellement dans les saisons d'avant jusqu'à en avoir 5. Scopé
// UNIQUEMENT au Simulateur (jamais useTeamForm.js/calcProno.js/Pronos réel —
// la décision du 25/07 reste intacte pour tout le reste de l'app) :
// compromis assumé, différent du reste de l'app — le Simulateur est un
// outil de curiosité (score hypothétique), pas un pronostic "argent réel"
// (Mes Paris) — accepter un léger risque mercato ici pour éviter un 1-1
// systématique et sans intérêt en tout début de saison est le bon arbitrage.
function pooledMatches(currentSeasonMatches, extraSeasonsMatches) {
  return [...(currentSeasonMatches ?? []), ...(extraSeasonsMatches ?? [])]
    .filter(m => m.status === 'FINISHED')
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
}

function pooledForm(currentSeasonMatches, extraSeasonsMatches, teamId) {
  if (teamId == null) return []
  return buildFormMap(pooledMatches(currentSeasonMatches, extraSeasonsMatches))[teamId] ?? []
}

// ⚠️ AJOUT (28/08, voir commentaire "Modèle RÉÉCRIT" en tête de fichier) —
// buildGoalModel(homeMatches)/buildGoalModel(awayMatches) donnent chacun
// leur PROPRE per-team stats + leur PROPRE moyenne de championnat
// (leagueAvgHome/Away) — jamais les mêmes 2 objets si homeComp≠awayComp
// (contrairement à computeLambdas, calcProno.js, qui suppose un seul
// goalModel partagé par les 2 équipes). Cette fonction fait le pont :
// chaque équipe normalisée contre SA PROPRE moyenne (shrinkRatio, comme
// calcProno.js), puis ancrée sur la MOYENNE DES 2 championnats plutôt que
// celle d'un seul — neutre, ne favorise ni l'un ni l'autre. Si
// homeComp===awayComp, homeModel et awayModel sont construits sur les MÊMES
// matchs (même moyenne des 2 côtés) → dégénère exactement vers le modèle
// "1 seul championnat" existant, aucun changement de comportement dans ce
// cas.
function crossLeagueLambdas(homeModel, awayModel, homeId, awayId) {
  if (!homeModel || !awayModel) return null
  const home = homeModel.per[homeId]
  const away = awayModel.per[awayId]
  if (!home || !away || home.hCount < MIN_TEAM_SPLITS || away.aCount < MIN_TEAM_SPLITS) return null

  const attackHome  = shrinkRatio((home.hFor     / home.hCount) / homeModel.leagueAvgHome, home.hCount)
  const defenseHome = shrinkRatio((home.hAgainst / home.hCount) / homeModel.leagueAvgAway, home.hCount)
  const attackAway  = shrinkRatio((away.aFor     / away.aCount) / awayModel.leagueAvgAway, away.aCount)
  const defenseAway = shrinkRatio((away.aAgainst / away.aCount) / awayModel.leagueAvgHome, away.aCount)

  const neutralHomeBase = (homeModel.leagueAvgHome + awayModel.leagueAvgHome) / 2
  const neutralAwayBase = (homeModel.leagueAvgAway + awayModel.leagueAvgAway) / 2

  return {
    lambdaHome: clampLambda(attackHome * defenseAway * neutralHomeBase),
    lambdaAway: clampLambda(attackAway * defenseHome * neutralAwayBase),
  }
}

// ⚠️ AJOUT (28/08, constat utilisateur : "ça monte rarement au dessus de 2
// buts pour une equipe") — 2e cause trouvée, indépendante du fitLambdas
// remplacé plus haut : scoreExactProbabilities (calcProno.js) est bornée à
// une grille FIXE de 9 scores usuels (SCORE_EXACT_GRID), dont AUCUN n'a plus
// de 2 buts pour une équipe (max présent : 2-2) — un plafond structurel qui
// s'appliquait même à de vrais λ élevés. Cette grille reste inchangée pour
// Mes Paris (convention "top scores bookmaker", jamais touchée) ; le
// Simulateur construit ici sa propre grille plus large (0 à 6 buts par
// équipe, 49 cases), pour ne jamais plafonner artificiellement une paire à
// forte intensité offensive.
const SIM_MAX_GOALS = 6
function fullScoreGrid(lambdaHome, lambdaAway) {
  const scores = []
  for (let h = 0; h <= SIM_MAX_GOALS; h++) {
    for (let a = 0; a <= SIM_MAX_GOALS; a++) {
      scores.push({ home: h, away: a, pct: poissonPmf(lambdaHome, h) * poissonPmf(lambdaAway, a) * 100 })
    }
  }
  return scores
}

// H2H mélangé DIRECTEMENT sur les λ (moyenne réelle des buts marqués lors
// des vraies confrontations, toutes compétitions/saisons — meetings vient de
// useCrossCompH2H) plutôt qu'au niveau des % — voir commentaire en tête de
// fichier ("l'info combien de buts ne doit plus jamais se perdre"). Même
// pondération que le reste de l'app (H2H_WEIGHT_MAX/H2H_WEIGHT_PER_MATCH,
// calcProno.js, exportées) : un léger correctif, jamais dominant (plafonné à
// 40% même avec beaucoup de confrontations).
function blendH2HIntoLambdas(lambdaHome, lambdaAway, meetings, homeId, awayId) {
  if (!meetings?.length || homeId == null || awayId == null) return { lambdaHome, lambdaAway }
  let homeGoalsSum = 0, awayGoalsSum = 0, n = 0
  meetings.forEach(m => {
    if (m.status !== 'FINISHED') return
    const fs = finalScore(m.score)
    if (fs.home == null || fs.away == null) return
    if (m.homeTeam?.id === homeId && m.awayTeam?.id === awayId) { homeGoalsSum += fs.home; awayGoalsSum += fs.away; n++ }
    else if (m.homeTeam?.id === awayId && m.awayTeam?.id === homeId) { homeGoalsSum += fs.away; awayGoalsSum += fs.home; n++ }
  })
  if (n === 0) return { lambdaHome, lambdaAway }
  const w = Math.min(H2H_WEIGHT_MAX, n * H2H_WEIGHT_PER_MATCH)
  return {
    lambdaHome: clampLambda(lambdaHome * (1 - w) + (homeGoalsSum / n) * w),
    lambdaAway: clampLambda(lambdaAway * (1 - w) + (awayGoalsSum / n) * w),
  }
}

// Cherche la ligne standings (nom + crest) d'une équipe déjà sélectionnée —
// un seul point de vérité pour TeamPicker (crest dans le cercle) ET le
// résultat final (crests + noms dans le scoreboard), React Query déduplique
// l'appel réseau (même queryKey partout).
function useTeamRow(compId, teamId) {
  const { standings, loading } = useStandings(compId, true)
  const row = standings.find(r => String(r.team.id) === String(teamId))
  return {
    loading,
    name:      row ? translateTeam(row.team.shortName || row.team.name) : null,
    crest:     row?.team?.crest ?? null,
    // shortName brut FD.org (pas traduit) — clé utilisée par TEAM_NAMES_FR
    // ET fdcoukTeamNames.js (voir useCrossCompH2H, extension multi-années).
    shortName: row?.team?.shortName ?? null,
  }
}

function CrestCircle({ crest, size = 'md' }) {
  return (
    <div className={`simulateur__crestWrap simulateur__crestWrap--${size}`}>
      {crest
        ? <img src={crest} alt="" className="simulateur__crest" />
        : (
          <svg className="simulateur__crestPlaceholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 4l4 2 4-2 3 3-2 3v9a1 1 0 01-1 1H8a1 1 0 01-1-1v-9L5 7l3-3z" />
          </svg>
        )}
    </div>
  )
}

function TeamPicker({ side, label, compId, teamId, onCompChange, onTeamChange }) {
  const { standings, loading } = useStandings(compId, true)
  const { crest } = useTeamRow(compId, teamId)
  // Trié par position au classement (déjà l'ordre renvoyé par FD.org) — plus
  // parlant qu'un tri alphabétique pour repérer une équipe (les cadors en
  // haut de liste, pas noyés au milieu d'un ordre A-Z).
  return (
    <div className={`simulateur__side simulateur__side--${side}`}>
      <span className="simulateur__sideLabel">{label}</span>
      <CrestCircle crest={crest} />
      <div className="simulateur__selectShell">
        <select
          className="simulateur__select"
          value={compId ?? ''}
          onChange={e => onCompChange(e.target.value || null)}
        >
          <option value="">Championnat…</option>
          {SIM_COMPS.map(c => (
            <option key={c.id} value={c.id}>{c.shortName}</option>
          ))}
        </select>
        <span className="simulateur__selectIcon" aria-hidden="true" />
      </div>
      <div className="simulateur__selectShell">
        <select
          className="simulateur__select"
          value={teamId ?? ''}
          onChange={e => onTeamChange(e.target.value || null)}
          disabled={!compId || loading}
        >
          <option value="">{loading ? 'Chargement…' : 'Équipe…'}</option>
          {standings.map(row => (
            <option key={row.team.id} value={row.team.id}>
              {translateTeam(row.team.shortName || row.team.name)}
            </option>
          ))}
        </select>
        <span className="simulateur__selectIcon" aria-hidden="true" />
      </div>
    </div>
  )
}

export function PronosSimulateur() {
  const [homeComp, setHomeComp] = useState(null)
  const [homeTeamId, setHomeTeamId] = useState(null)
  const [awayComp, setAwayComp] = useState(null)
  const [awayTeamId, setAwayTeamId] = useState(null)
  // Ne se déclenche qu'au clic sur "Comparer" (voir useCrossCompH2H — un
  // appel FD.org par comparaison explicite, jamais à chaque changement de
  // sélection dans les menus).
  const [compared, setCompared] = useState(null)

  const { matchesByComp } = useTeamFormMulti([homeComp, awayComp].filter(Boolean))

  // 2 saisons précédentes en plus de la saison en cours (matchesByComp
  // ci-dessus) — voir commentaire pooledForm en tête de fichier. Hook déjà
  // existant/partagé (useMatchs.js), toujours appelé (règle des Hooks),
  // `enabled: !!selectedComp` gère déjà en interne le cas compId absent.
  const homeExtraHistory = useH2HHistory(homeComp, matchesByComp?.[homeComp])
  const awayExtraHistory = useH2HHistory(awayComp, matchesByComp?.[awayComp])

  // Toujours appelés (règle des Hooks) — useStandings gère déjà en interne
  // le cas `compId` absent (enabled: !!selectedComp), retourne [] sans fetch.
  const home = useTeamRow(homeComp, homeTeamId)
  const away = useTeamRow(awayComp, awayTeamId)

  const canCompare = homeTeamId != null && awayTeamId != null && homeTeamId !== awayTeamId
  const isComparing = compared?.homeId === homeTeamId && compared?.awayId === awayTeamId

  // Extension multi-années (football-data.co.uk, voir api/h2h.js) — QUE si
  // les 2 équipes sont du même championnat (sinon aucun fichier ne peut les
  // contenir toutes les deux, voir commentaire FDCOUK_LEAGUE_FILE). Passé
  // en plus du H2H FD.org existant, jamais à sa place.
  const sameCompInfo = isComparing && homeComp && homeComp === awayComp
    ? { comp: homeComp, homeShortName: home.shortName, awayShortName: away.shortName }
    : null

  const { meetings, loading: h2hLoading } = useCrossCompH2H(
    isComparing ? homeTeamId : null,
    isComparing ? awayTeamId : null,
    isComparing,
    sameCompInfo
  )

  // λ (buts espérés dom./ext.) — voir "Modèle RÉÉCRIT" en tête de fichier.
  // Chemin principal : buts marqués/encaissés réels (3 saisons pooled),
  // chaque équipe normalisée contre SON PROPRE championnat, ancrée sur la
  // moyenne des 2 championnats (crossLeagueLambdas). Repli forme+H2H
  // (l'ancien modèle, fitLambdasToPreMatch) UNIQUEMENT si les données sont
  // insuffisantes pour un des 2 championnats (buildGoalModel renvoie null).
  const model = useMemo(() => {
    if (!isComparing) return null
    const homeMatches = pooledMatches(matchesByComp?.[homeComp], homeExtraHistory)
    const awayMatches = pooledMatches(matchesByComp?.[awayComp], awayExtraHistory)
    const homeModel = buildGoalModel(homeMatches)
    const awayModel = buildGoalModel(awayMatches)
    const goalBased = crossLeagueLambdas(homeModel, awayModel, homeTeamId, awayTeamId)

    if (goalBased) {
      return { ...blendH2HIntoLambdas(goalBased.lambdaHome, goalBased.lambdaAway, meetings, homeTeamId, awayTeamId), source: 'goals' }
    }

    // Repli forme+H2H — données saison insuffisantes même après pooling (cas
    // rare : promu tout juste monté, ou fetch des saisons précédentes en
    // échec). compMatches=[] force calcPronoAdvanced sur son propre repli
    // forme+H2H (chemin déjà existant, inchangé).
    const homeForm = pooledForm(matchesByComp?.[homeComp], homeExtraHistory, homeTeamId)
    const awayForm = pooledForm(matchesByComp?.[awayComp], awayExtraHistory, awayTeamId)
    const pre = calcPronoAdvanced(homeTeamId, awayTeamId, [], homeForm, awayForm, { fullH2H: meetings })
    return { ...fitLambdasToPreMatch(pre), source: 'form' }
  }, [isComparing, matchesByComp, homeComp, awayComp, homeExtraHistory, awayExtraHistory, homeTeamId, awayTeamId, meetings])

  // Scores les plus probables — dérivés directement des λ ci-dessus (grille
  // large, voir fullScoreGrid plus haut), triés par probabilité décroissante.
  const topScores = useMemo(() => {
    if (!model) return null
    return fullScoreGrid(model.lambdaHome, model.lambdaAway).sort((a, b) => b.pct - a.pct)
  }, [model])

  const sameTeamPicked = homeTeamId != null && homeTeamId === awayTeamId

  return (
    <div className="simulateur">
      <p className="simulateur__intro">
        Choisis 2 équipes, même de championnats différents, pour voir ce que
        donnerait un match entre elles aujourd'hui — basé sur leurs buts
        marqués/encaissés réels et leurs confrontations passées si elles
        existent.
      </p>

      <div className="simulateur__card">
        <div className="simulateur__picker">
          <TeamPicker
            side="home" label="Équipe 1"
            compId={homeComp} teamId={homeTeamId}
            onCompChange={c => { setHomeComp(c); setHomeTeamId(null); setCompared(null) }}
            onTeamChange={t => { setHomeTeamId(t); setCompared(null) }}
          />
          <span className="simulateur__vs">VS</span>
          <TeamPicker
            side="away" label="Équipe 2"
            compId={awayComp} teamId={awayTeamId}
            onCompChange={c => { setAwayComp(c); setAwayTeamId(null); setCompared(null) }}
            onTeamChange={t => { setAwayTeamId(t); setCompared(null) }}
          />
        </div>

        {sameTeamPicked && (
          <p className="simulateur__hint">Choisis 2 équipes différentes.</p>
        )}

        <button
          className="simulateur__compareBtn"
          disabled={!canCompare}
          onClick={() => setCompared({ homeId: homeTeamId, awayId: awayTeamId })}
        >
          Comparer
        </button>
      </div>

      {isComparing && model && topScores && (
        <div className="simulateur__result">
          <div className="simulateur__resultTeams">
            <div className="simulateur__resultTeam">
              <CrestCircle crest={home.crest} size="sm" />
              <span className="simulateur__resultTeamName">{home.name}</span>
            </div>
            <div className="simulateur__scoreHero">
              <span className="simulateur__scoreHeroVal">
                {topScores[0].home} - {topScores[0].away}
              </span>
              <span className="simulateur__scoreHeroLabel">Score le plus probable</span>
            </div>
            <div className="simulateur__resultTeam">
              <CrestCircle crest={away.crest} size="sm" />
              <span className="simulateur__resultTeamName">{away.name}</span>
            </div>
          </div>

          <div className="simulateur__scoreAlts">
            {topScores.slice(1, 4).map(s => (
              <div key={`${s.home}-${s.away}`} className="simulateur__scoreAlt">
                <span className="simulateur__scoreAltVal">{s.home}-{s.away}</span>
                <span className="simulateur__scoreAltPct">{Math.round(s.pct)}%</span>
              </div>
            ))}
          </div>

          <p className="simulateur__h2hNote">
            {model.source === 'goals'
              ? 'Basé sur les buts marqués/encaissés réels des 2 équipes (jusqu\'à 3 saisons)'
              : 'Basé sur la forme récente des 2 équipes (données buts insuffisantes)'}
            {h2hLoading
              ? ', recherche des confrontations passées…'
              : meetings.length > 0
                ? ` + ${meetings.length} confrontation${meetings.length > 1 ? 's' : ''} directe${meetings.length > 1 ? 's' : ''} trouvée${meetings.length > 1 ? 's' : ''}${sameCompInfo ? ' (plusieurs saisons)' : ' (toutes compétitions, saison en cours)'}.`
                : ' — aucune confrontation directe trouvée dans leur historique.'}
          </p>
        </div>
      )}
    </div>
  )
}
