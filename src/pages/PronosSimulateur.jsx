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
 * ⚠️ Modèle utilisé, choix fait avec l'utilisateur (28/08) : PAS le modèle
 * "buts marqués/encaissés" (calcPronoAdvanced avec compMatches) — il compare
 * chaque équipe à la MOYENNE DE BUTS DE SON CHAMPIONNAT, ce qui n'a de sens
 * que si les 2 équipes sont dans LE MÊME championnat. Comparer 2 équipes de
 * championnats différents avec ce modèle demanderait d'inventer un facteur
 * de conversion entre championnats — aucune donnée fiable pour le justifier.
 * À la place : forme récente (V/N/D, pareil pour toutes les équipes, aucune
 * dépendance à un championnat) + confrontations directes toutes compétitions
 * confondues si elles existent (useCrossCompH2H, nouveau — voir son
 * commentaire). C'est exactement le chemin de repli déjà existant et testé
 * dans calcPronoAdvanced (`fallback()`, utilisé normalement en tout début de
 * saison) — réutilisé tel quel en passant compMatches=[] pour le forcer à
 * s'y engager systématiquement, aucune nouvelle logique de calcul écrite.
 *
 * ⚠️ Affichage du résultat (28/08, demande utilisateur : "je demande de
 * simulé le score exact et tout... pas les côtes on s'en fou de ça") — PAS
 * de pilules de cotes 1/N/2. Le pronostic forme+H2H ci-dessus donne 3 %
 * (victoire dom./nul/victoire ext.), pas un score : fitLambdasToPreMatch
 * (calcProno.js, déjà utilisée par calcLiveProno dans le même cas — pas de
 * vraies stats buts marqués/encaissés dispo) retrouve une paire de buts
 * espérés (λ) qui REPRODUIT fidèlement ces mêmes 3 %, puis
 * scoreExactProbabilities (déjà utilisée dans Mes Paris, grille Poisson) en
 * tire une probabilité par score. Ce n'est pas une nouvelle prédiction ni un
 * nombre inventé : c'est le même pronostic forme+H2H, juste reformulé en
 * scores plutôt qu'en 1/N/2.
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
import { useCrossCompH2H } from '../hooks/useCrossCompH2H'
import { calcPronoAdvanced, fitLambdasToPreMatch, scoreExactProbabilities } from '../utils/calcProno'
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
// Fix scopé UNIQUEMENT au Simulateur (jamais useTeamForm.js/calcProno.js/
// Pronos réel — la décision du 25/07 reste intacte pour tout le reste de
// l'app) : si la forme CETTE saison est trop courte pour être utile (<3
// matchs), on reconstruit une forme de repli depuis la saison précédente de
// CETTE compétition (déjà chargée par useTeamFormMulti dans matchesByComp,
// aucun appel réseau en plus — c'est exactement fallbackMatches que
// useTeamForm.js calcule déjà pour le modèle buts/H2H, juste jamais utilisé
// pour formMap jusqu'ici). Compromis assumé et différent du reste de
// l'app : le Simulateur est un outil de curiosité (score hypothétique),
// pas un pronostic "argent réel" (Mes Paris) — accepter un léger risque
// mercato ici pour éviter un 1-1 systématique et sans intérêt en tout début
// de saison est le bon arbitrage, mais PAS pour Mes Paris/Pronos.
const MIN_FORM_GAMES = 3
function effectiveForm(formMap, matchesByComp, comp, teamId) {
  const current = formMap?.[teamId] ?? []
  if (current.length >= MIN_FORM_GAMES) return current
  const fallback = buildFormMap(matchesByComp?.[comp] ?? [])[teamId] ?? []
  return fallback.length > current.length ? fallback : current
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

  const { formMap, matchesByComp } = useTeamFormMulti([homeComp, awayComp].filter(Boolean))

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

  const prono = useMemo(() => {
    if (!isComparing) return null
    // effectiveForm : repli saison précédente si la forme CETTE saison est
    // trop courte (début de saison, voir commentaire MIN_FORM_GAMES plus
    // haut) — scopé au Simulateur uniquement.
    const homeForm = effectiveForm(formMap, matchesByComp, homeComp, homeTeamId)
    const awayForm = effectiveForm(formMap, matchesByComp, awayComp, awayTeamId)
    // compMatches=[] force le repli forme+H2H (voir commentaire en tête de
    // fichier) — jamais le modèle "buts marqués/encaissés" (a besoin d'un
    // seul championnat de référence commun aux 2 équipes).
    return calcPronoAdvanced(homeTeamId, awayTeamId, [], homeForm, awayForm, { fullH2H: meetings })
  }, [isComparing, formMap, matchesByComp, homeComp, awayComp, homeTeamId, awayTeamId, meetings])

  // Juste pour la transparence de la note affichée plus bas (voir
  // MIN_FORM_GAMES) — pas utilisé dans le calcul lui-même.
  const usingFallbackForm = isComparing && (
    (formMap?.[homeTeamId]?.length ?? 0) < MIN_FORM_GAMES ||
    (formMap?.[awayTeamId]?.length ?? 0) < MIN_FORM_GAMES
  )

  // Scores les plus probables — dérivés du même pronostic forme+H2H
  // (voir commentaire en tête de fichier), triés par probabilité décroissante.
  const topScores = useMemo(() => {
    if (!prono) return null
    const { lambdaHome, lambdaAway } = fitLambdasToPreMatch(prono)
    const scores = scoreExactProbabilities(lambdaHome, lambdaAway)
    if (!scores) return null
    return [...scores].sort((a, b) => b.pct - a.pct)
  }, [prono])

  const sameTeamPicked = homeTeamId != null && homeTeamId === awayTeamId

  return (
    <div className="simulateur">
      <p className="simulateur__intro">
        Choisis 2 équipes, même de championnats différents, pour voir ce que
        donnerait un match entre elles aujourd'hui — basé sur leur forme
        récente et leurs confrontations passées si elles existent.
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

      {isComparing && prono && topScores && (
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
            {h2hLoading
              ? 'Recherche des confrontations passées…'
              : meetings.length > 0
                ? `Basé sur la forme récente des 2 équipes + ${meetings.length} confrontation${meetings.length > 1 ? 's' : ''} directe${meetings.length > 1 ? 's' : ''} trouvée${meetings.length > 1 ? 's' : ''}${sameCompInfo ? ' (plusieurs saisons)' : ' (toutes compétitions, saison en cours)'}.`
                : 'Basé sur la forme récente des 2 équipes — aucune confrontation directe trouvée dans leur historique.'}
            {usingFallbackForm && ' Championnat tout juste relancé : forme partiellement basée sur la saison précédente.'}
          </p>
        </div>
      )}
    </div>
  )
}
