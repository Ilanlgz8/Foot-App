/**
 * Pronos.jsx — Pronos entre amis (groupe par code, pas de compte).
 *
 * Trois onglets séparés (demandé par l'utilisateur) :
 *   - "Pronos"     : matchs à venir (toutes compétitions confondues, triés
 *                    par date) avec une case de score par équipe. Un match
 *                    disparaît d'ici dès qu'il n'est plus SCHEDULED côté
 *                    football-data.org (dès le coup d'envoi).
 *   - "Résultat"   : matchs actuellement EN COURS (branché sur useLiveData(),
 *                    zéro requête réseau en plus, minute + score seulement,
 *                    pas de stats) + matchs TERMINÉS depuis moins de 24h
 *                    (score final, pas de minute). Sert de pont entre le
 *                    moment où un match quitte "Pronos" (coup d'envoi) et le
 *                    moment où il n'est plus affiché nulle part ailleurs que
 *                    dans "Classement" (qui ne montre QUE le classement, pas
 *                    les matchs).
 *   - "Classement" : uniquement le classement des joueurs, calculés CÔTÉ
 *                    CLIENT (3 pts score exact, 1 pt bon résultat, 0 sinon)
 *                    à partir des matchs FINISHED déjà exposés par
 *                    football-data.org — aucun calcul ni cron ajouté côté
 *                    serveur.
 *
 * Identité : deviceId + pseudo persistés en localStorage (usePronosGroup),
 * aucune donnée sensible, groupe rejoint via un code à 6 caractères.
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { usePronosGroup, usePronosGroupData } from '../hooks/usePronosGroup'
import { useUpcomingMatchesAllComps, useFinishedMatchesAllComps, useLowerDivisionStatsMulti } from '../hooks/useMatchs'
import { useTeamFormMulti } from '../hooks/useTeamForm'
import { useLiveData } from '../context/LiveProvider'
import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, isNationalTeamComp, isNeutralVenueComp, resolveFdTeamId } from '../utils/matchUtils'
import { calcPronoAdvanced } from '../utils/calcProno'
import { COMPETITIONS, SINGLE_MATCH_COMPS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'
import { useSwipe } from '../hooks/useSwipe'
import { PronosSimulateur } from './PronosSimulateur'
import '../../pronos.css'

const TABS = ['pronos', 'resultat', 'classement']

const COMP_IDS = COMPETITIONS.map(c => c.id)

// Un match terminé reste visible dans "Résultat" 24h après (demande
// utilisateur), + une marge couvrant la durée du match lui-même : on ne
// connaît que l'heure de coup d'envoi (utcDate) côté football-data.org, pas
// l'heure exacte de fin — 3h de marge couvre large (prolongations + tirs
// au but compris).
const FINISHED_DISPLAY_MS = 27 * 60 * 60 * 1000

const _fmtH = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const _fmtD = (d) => {
  const today    = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const date     = new Date(d); date.setHours(0, 0, 0, 0)
  if (date.getTime() === today.getTime())    return `Aujourd'hui`
  if (date.getTime() === tomorrow.getTime()) return `Demain`
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })
}
const teamName = (team) => team?.name ? translateTeam(team.shortName || team.name) : 'À déterminer'
const isWCMatch = (match) => isNationalTeamComp(match)
// Nom FR + logo de la compétition (ex: "FIFA World Cup" → "Coupe du Monde"
// + emblème), même mapping que COMPETITIONS (data/competitions.js) utilisé
// partout ailleurs (Live.jsx, etc.).
const compInfo = (match) => {
  const comp = COMPETITIONS.find(c => c.id === match.competition?.code)
  return { name: comp?.name ?? match.competition?.name ?? '', emblem: comp?.emblem ?? null }
}

// Logo + nom de la compétition, aligné à droite de la card.
function CompLabel({ match }) {
  const { name, emblem } = compInfo(match)
  return (
    <span className="pronos__metaComp">
      {emblem && <img src={emblem} alt="" className="pronos__compLogo" />}
      {name}
    </span>
  )
}

// ── Filtre championnat (demande utilisateur, 21/08 : "possible de trier les
// matchs par championnat, un filtre simple et moderne") — même pattern que
// CompFilter (Accueil.jsx : rangée de pastilles logo+nom, "Tous" en premier,
// pastille active surlignée en rouge), repris ici en local pour ne pas
// coupler Pronos.jsx à Accueil.jsx. Un seul filtre partagé entre l'onglet
// "Pronos" et "Résultat" (pas un par onglet) — plus simple à comprendre :
// "je ne veux voir que la Ligue 1" reste vrai en changeant d'onglet.
function CompFilterBar({ competitions, active, onChange }) {
  if (competitions.length <= 1) return null
  return (
    <div className="pronos__compFilter">
      <button
        className={`pronos__compChip${active === null ? ' pronos__compChip--active' : ''}`}
        onClick={() => onChange(null)}
      >
        Tous
      </button>
      {competitions.map(c => (
        <button
          key={c.id}
          className={`pronos__compChip${active === c.id ? ' pronos__compChip--active' : ''}`}
          onClick={() => onChange(c.id)}
        >
          {c.emblem && <img src={c.emblem} alt="" />}
          {c.shortName}
        </button>
      ))}
    </div>
  )
}

// Drapeau (pays, WC) ou blason (club) — même traitement partagé que le reste
// de l'app via l'attribut data-crest (voir index.css : [data-crest="country"]
// / [data-crest="club"], appliqué globalement, pas de CSS dupliqué ici).
function TeamCrest({ team, isWC }) {
  if (!team?.crest) return null
  return (
    <div className="pronos__crestWrap" data-crest={isWC ? 'country' : 'club'}>
      <img
        src={team.crest} alt="" className="pronos__crest" data-team={team?.name}
        onError={e => { e.currentTarget.style.display = 'none' }}
      />
    </div>
  )
}

function groupByDay(matches) {
  const map = {}
  matches.forEach(m => {
    const dayKey = new Date(m.utcDate).toDateString()
    ;(map[dayKey] ??= []).push(m)
  })
  return Object.keys(map).map(dayKey => ({
    key: dayKey,
    label: _fmtD(map[dayKey][0].utcDate),
    matches: map[dayKey],
  }))
}

// ── Points variables selon le pourcentage de victoire/nul de l'app ──
// Même calcul que la barre de pronostic affichée sur l'Accueil/MatchPoster
// (calcProno, basé sur la forme récente des 2 équipes) : plus le résultat
// pronostiqué est PROBABLE (gros %), moins il rapporte de points ; plus il
// est risqué (petit %, l'outsider), plus il en rapporte — jusqu'à 5 pts.
// +2 pts de bonus fixe, EN PLUS, si le score est exactement le bon (pas
// juste le bon résultat).
// Limite assumée (choix simple plutôt que sur-ingénierie) : le % utilisé
// pour scorer est celui calculé au moment où le match est terminé (forme la
// plus à jour), pas figé au moment précis où le prono a été saisi — dans les
// faits la forme ne bouge quasi jamais entre la saisie (généralement la
// semaine du match) et le coup d'envoi, donc l'écart est négligeable, mais
// ce n'est pas un vrai "gel des cotes" à la seconde près.
const EXACT_SCORE_BONUS = 2
function pronoPointsForProb(prob) {
  if (!prob || prob <= 0) return 5
  return Math.min(5, Math.max(1, Math.round(100 / prob)))
}
function outcomeOf(h, a) {
  if (h > a) return 'home'
  if (h < a) return 'away'
  return 'draw'
}
// % 1/N/2 pour un match donné — buts marqués/encaissés saison (Poisson) +
// confrontations directes si assez de données, sinon repli sur la forme
// récente (formMap/matchesByComp, voir useTeamFormMulti) — même source et
// même modèle que MatchPoster (Accueil).
// ⚠️ BUG CORRIGÉ (même fix que MatchPoster.jsx/MatchDuJourCard.jsx) : id ESPN
// vs id FD.org pour les 6 grands championnats — sans résolution, calcPronoAdvanced
// ne retrouve jamais la vraie donnée saison de l'équipe.
function matchProno(match, formMap, matchesByComp, lowerDivByComp) {
  const compMatches = matchesByComp?.[match?.competition?.code] ?? []
  // ⚠️ BUG CORRIGÉ (16/08, même fix que MatchCard.jsx/MatchPoster.jsx : id
  // ESPN coïncidant par hasard avec l'id FD.org d'un club différent, forme/
  // stats saison d'une AUTRE équipe utilisées dans le calcul de prono) :
  // `strict:true` + suppression du repli `?? match.xxx.id` — calcPronoAdvanced
  // traite déjà homeId/awayId null comme "pas de H2H disponible" (voir
  // calcProno.js), aucune régression.
  const resolvedHomeId = resolveFdTeamId(match?.homeTeam, compMatches, { loose: true, strict: true })
  const resolvedAwayId = resolveFdTeamId(match?.awayTeam, compMatches, { loose: true, strict: true })
  const hForm = formMap?.[resolvedHomeId] ?? []
  const aForm = formMap?.[resolvedAwayId] ?? []
  // Repli "club promu" (03/08, cohérence demandée avec Accueil — voir
  // calcProno.js computeLambdasWithPromotion) : lowerDivByComp fourni par
  // useLowerDivisionStatsMulti, absent/vide pour toute compétition sans
  // repli connu → aucun changement dans ce cas (comportement identique à
  // avant).
  const lowerDivMatches = lowerDivByComp?.[match?.competition?.code] ?? []
  return calcPronoAdvanced(resolvedHomeId, resolvedAwayId, compMatches, hForm, aForm, {
    lowerDivMatches,
    neutralVenue: isNeutralVenueComp(match),
  })
}

function computePoints(pred, actualHome, actualAway, prono) {
  if (!pred || actualHome == null || actualAway == null) return 0
  const predOutcome   = outcomeOf(pred.home, pred.away)
  const actualOutcome = outcomeOf(actualHome, actualAway)
  if (predOutcome !== actualOutcome) return 0
  const base  = pronoPointsForProb(prono?.[predOutcome])
  const exact = pred.home === actualHome && pred.away === actualAway
  return exact ? base + EXACT_SCORE_BONUS : base
}

function JoinCreateScreen({ onCreate, onJoin }) {
  const [mode, setMode] = useState('choice') // 'choice' | 'create' | 'join'
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submitCreate = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true); setErr(null)
    try {
      await onCreate(name.trim())
    } catch (e2) {
      setErr(e2.message || 'Erreur, réessayez')
    } finally {
      setBusy(false)
    }
  }

  const submitJoin = async (e) => {
    e.preventDefault()
    if (!name.trim() || code.trim().length !== 6) return
    setBusy(true); setErr(null)
    try {
      await onJoin(code.trim(), name.trim())
    } catch (e2) {
      setErr(e2.message || 'Erreur, réessayez')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'choice') {
    return (
      <div className="pronos__intro">
        <span className="pronos__introIcon">⚽</span>
        <h1 className="pronos__introTitle">Pronos entre amis</h1>
        <p className="pronos__introText">
          Crée un groupe et partage le code, ou rejoins celui d'un ami.
          Pronostiquez les matchs à venir et comparez vos points.
        </p>
        <button className="pronos__introBtn pronos__introBtn--primary" onClick={() => setMode('create')}>
          Créer un groupe
        </button>
        <button className="pronos__introBtn" onClick={() => setMode('join')}>
          Rejoindre avec un code
        </button>
      </div>
    )
  }

  if (mode === 'create') {
    return (
      <form className="pronos__intro" onSubmit={submitCreate}>
        <h1 className="pronos__introTitle">Créer un groupe</h1>
        <input
          className="pronos__input"
          placeholder="Ton pseudo"
          maxLength={24}
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
        {err && <p className="pronos__error">{err}</p>}
        <button className="pronos__introBtn pronos__introBtn--primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Création…' : 'Créer'}
        </button>
        <button className="pronos__introBtn" type="button" onClick={() => setMode('choice')}>Retour</button>
      </form>
    )
  }

  return (
    <form className="pronos__intro" onSubmit={submitJoin}>
      <h1 className="pronos__introTitle">Rejoindre un groupe</h1>
      <input
        className="pronos__input pronos__input--code"
        placeholder="Code à 6 caractères"
        maxLength={6}
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
        autoFocus
      />
      <input
        className="pronos__input"
        placeholder="Ton pseudo"
        maxLength={24}
        value={name}
        onChange={e => setName(e.target.value)}
      />
      {err && <p className="pronos__error">{err}</p>}
      <button className="pronos__introBtn pronos__introBtn--primary" type="submit" disabled={busy || !name.trim() || code.trim().length !== 6}>
        {busy ? 'Connexion…' : 'Rejoindre'}
      </button>
      <button className="pronos__introBtn" type="button" onClick={() => setMode('choice')}>Retour</button>
    </form>
  )
}

// ⚠️ AJOUT auto-avance (21/08, demande explicite utilisateur : "quand
// l'utilisateur remplit une case avec un chiffre ça switch direct à la case
// suivante ... et si les cases A et B sont remplies ça passe au match en
// dessous sur la case A") : dès qu'UN chiffre est tapé (pas un effacement —
// `value.length === 1` exclut le backspace, qui vide le champ à 0 caractère,
// donc jamais de saut arrière indésirable pendant une correction), le focus
// saute directement Domicile → Extérieur, puis Extérieur (match courant) →
// Domicile (match SUIVANT dans la liste affichée). `registerInputRef`/
// `focusInput`/`nextMatchId` viennent de Pronos() (une seule Map de refs
// pour toute la liste, pas un état local par ligne).
function MatchPredictRow({ match, myPred, onSave, formMap, matchesByComp, lowerDivByComp, nextMatchId, registerInputRef, focusInput }) {
  const [home, setHome] = useState(myPred?.home ?? '')
  const [away, setAway] = useState(myPred?.away ?? '')

  useEffect(() => {
    setHome(myPred?.home ?? '')
    setAway(myPred?.away ?? '')
  }, [myPred?.home, myPred?.away, match.id])

  const commitScore = (h, a) => {
    if (Number.isInteger(h) && Number.isInteger(a) && h >= 0 && h <= 20 && a >= 0 && a <= 20) {
      onSave(match.id, h, a)
    }
  }
  const commit = () => commitScore(parseInt(home, 10), parseInt(away, 10))

  const isFreshDigit = (v) => v.length === 1 && /^[0-9]$/.test(v)

  const handleHomeChange = (e) => {
    const v = e.target.value
    setHome(v)
    if (isFreshDigit(v)) focusInput(match.id, 'away')
  }
  const handleAwayChange = (e) => {
    const v = e.target.value
    setAway(v)
    if (isFreshDigit(v)) {
      commitScore(parseInt(home, 10), parseInt(v, 10))
      if (nextMatchId) focusInput(nextMatchId, 'home')
    }
  }

  // Points potentiels en direct, selon le score en cours de saisie — recalculé
  // à chaque frappe : change de camp/valeur dès que le résultat pronostiqué
  // (victoire dom./nul/victoire ext.) change. Basé sur le même % que la barre
  // de pronostic de l'Accueil (calcProno) — voir computePoints plus haut.
  const h = parseInt(home, 10)
  const a = parseInt(away, 10)
  const hasValidPred = Number.isInteger(h) && Number.isInteger(a) && h >= 0 && h <= 20 && a >= 0 && a <= 20
  const prono = useMemo(() => matchProno(match, formMap, matchesByComp, lowerDivByComp), [match, formMap, matchesByComp, lowerDivByComp])
  const potentialPoints = hasValidPred ? pronoPointsForProb(prono[outcomeOf(h, a)]) : null

  return (
    <div className="pronos__matchRow">
      <div className="pronos__matchMeta">
        <CompLabel match={match} />
        <span className="pronos__metaTime">{_fmtH(match.utcDate)}</span>
      </div>
      <div className="pronos__matchTeams">
        <div className="pronos__team">
          <TeamCrest team={match.homeTeam} isWC={isWCMatch(match)} />
          <span className="pronos__teamName">{teamName(match.homeTeam)}</span>
        </div>
        <div className="pronos__scoreCol">
          <div className="pronos__scoreGroup">
            <input
              type="number" inputMode="numeric" min="0" max="20"
              className="pronos__scoreInput"
              value={home}
              onChange={handleHomeChange}
              onBlur={commit}
              ref={el => registerInputRef(match.id, 'home', el)}
            />
            <span className="pronos__scoreSep">-</span>
            <input
              type="number" inputMode="numeric" min="0" max="20"
              className="pronos__scoreInput"
              value={away}
              onChange={handleAwayChange}
              onBlur={commit}
              ref={el => registerInputRef(match.id, 'away', el)}
            />
          </div>
          {potentialPoints != null && (
            <div className="pronos__pointsHint">
              <span className="pronos__pointsHintValue">+{potentialPoints}</span> pt{potentialPoints > 1 ? 's' : ''} si bon résultat
              <span className="pronos__pointsHintBonus">+{EXACT_SCORE_BONUS} bonus si exact</span>
            </div>
          )}
        </div>
        <div className="pronos__team">
          <TeamCrest team={match.awayTeam} isWC={isWCMatch(match)} />
          <span className="pronos__teamName">{teamName(match.awayTeam)}</span>
        </div>
      </div>
    </div>
  )
}

// Liste des pronos du groupe pour un match donné (déplié au clic sur "Voir
// les pronos") — la donnée (predictions[matchId] = { deviceId: {home,away} })
// est DÉJÀ chargée pour tous les joueurs du groupe via usePronosGroupData,
// pas besoin d'appel réseau supplémentaire ni de nouvel endpoint. `actual` +
// `prono` non nuls → affiche aussi les points gagnés par chacun (même calcul
// que le classement, computePoints). Visible uniquement à partir du moment où
// le match a débuté (onglet Résultat) : les pronos ne sont plus modifiables
// dès le coup d'envoi (un match disparaît de l'onglet Pronos dès qu'il n'est
// plus SCHEDULED), donc les révéler ici ne permet à personne de copier qui
// que ce soit.
function PredictionsPanel({ matchId, players, predictions, deviceId, actual, prono }) {
  const preds = predictions[String(matchId)] ?? {}
  const entries = Object.entries(preds)
  if (entries.length === 0) {
    return <p className="pronos__predictEmpty">Personne n'a pronostiqué ce match.</p>
  }
  return (
    <div className="pronos__predictList">
      {entries.map(([pid, pred]) => {
        const pts = actual ? computePoints(pred, actual.home, actual.away, prono) : null
        const exact = !!actual && pred.home === actual.home && pred.away === actual.away
        return (
          <div key={pid} className={`pronos__predictRow${pid === deviceId ? ' pronos__predictRow--me' : ''}`}>
            <span className="pronos__predictName">{players[pid] ?? '?'}{pid === deviceId ? ' (toi)' : ''}</span>
            <span className="pronos__predictScore">{pred.home}-{pred.away}</span>
            {pts != null && (
              <span className={`pronos__predictPts${exact ? ' pronos__predictPts--exact' : pts > 0 ? ' pronos__predictPts--ok' : ''}`}>
                {pts > 0 ? `+${pts}` : '0'} pt{pts > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Ligne "match en cours" — minute + score seulement (pas de stats, pas de
// buteurs) : juste de quoi suivre un match qu'on a pronostiqué le temps qu'il
// se joue, entre l'onglet Pronos (avant coup d'envoi) et Classement (une fois
// terminé). Ticker 5s pour faire avancer calcMinute() entre deux polls ESPN,
// même logique que LiveCard (Live.jsx).
function LiveResultRow({ match, espn, players, predictions, deviceId }) {
  const [, setTick] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [])

  const period = getMatchPeriod(match)
  const minute = calcMinute(match)
  const fs = finalScore(match.score)
  const hs = mergeScore(espn?.home, fs.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, fs.away ?? match.score?.halfTime?.away)
  const predCount = Object.keys(predictions[String(match.id)] ?? {}).length

  return (
    <div className="pronos__matchRow">
      <div className="pronos__matchMeta">
        <CompLabel match={match} />
        <span className="pronos__metaTime pronos__liveMinute">{period ?? (minute ?? 'En direct')}</span>
      </div>
      <div className="pronos__matchTeams">
        <div className="pronos__team">
          <TeamCrest team={match.homeTeam} isWC={isWCMatch(match)} />
          <span className="pronos__teamName">{teamName(match.homeTeam)}</span>
        </div>
        <div className="pronos__scoreGroup">
          <span className="pronos__liveScore">{hs ?? '-'}</span>
          <span className="pronos__scoreSep">-</span>
          <span className="pronos__liveScore">{as_ ?? '-'}</span>
        </div>
        <div className="pronos__team">
          <TeamCrest team={match.awayTeam} isWC={isWCMatch(match)} />
          <span className="pronos__teamName">{teamName(match.awayTeam)}</span>
        </div>
      </div>
      {predCount > 0 && (
        <div className="pronos__resultFooter pronos__resultFooter--end">
          <button className="pronos__toggleBtn" onClick={() => setOpen(o => !o)}>
            {open ? 'Masquer' : `Voir les pronos (${predCount})`}
          </button>
        </div>
      )}
      {open && (
        <PredictionsPanel matchId={match.id} players={players} predictions={predictions} deviceId={deviceId} actual={null} prono={null} />
      )}
    </div>
  )
}

// Ligne "match terminé récemment" (< 24h) — score final, pas de minute.
// Sous le score : le prono qu'on avait mis + les points gagnés pour CE match
// (même formule variable que computePoints, cf. classement), et un bouton
// pour déplier les pronos de tout le groupe (voir PredictionsPanel).
function FinishedResultRow({ match, players, predictions, deviceId, prono }) {
  const [open, setOpen] = useState(false)
  const fs = finalScore(match.score)
  const actual = (fs.home != null && fs.away != null) ? { home: fs.home, away: fs.away } : null
  const myPred = predictions[String(match.id)]?.[deviceId] ?? null
  const myPoints = (myPred && actual) ? computePoints(myPred, actual.home, actual.away, prono) : null
  const exactMatch = !!myPred && !!actual && myPred.home === actual.home && myPred.away === actual.away
  const predCount = Object.keys(predictions[String(match.id)] ?? {}).length
  const predClass = myPoints == null ? '' : exactMatch ? ' pronos__myPredict--exact' : myPoints > 0 ? ' pronos__myPredict--ok' : ''

  return (
    <div className="pronos__matchRow">
      <div className="pronos__matchMeta">
        <CompLabel match={match} />
        <span className="pronos__metaTime">Terminé</span>
      </div>
      <div className="pronos__matchTeams">
        <div className="pronos__team">
          <TeamCrest team={match.homeTeam} isWC={isWCMatch(match)} />
          <span className="pronos__teamName">{teamName(match.homeTeam)}</span>
        </div>
        <div className="pronos__scoreGroup">
          <span className="pronos__liveScore">{fs.home ?? '-'}</span>
          <span className="pronos__scoreSep">-</span>
          <span className="pronos__liveScore">{fs.away ?? '-'}</span>
        </div>
        <div className="pronos__team">
          <TeamCrest team={match.awayTeam} isWC={isWCMatch(match)} />
          <span className="pronos__teamName">{teamName(match.awayTeam)}</span>
        </div>
      </div>
      {(myPred || predCount > 0) && (
        <div className="pronos__resultFooter">
          {myPred ? (
            <span className={`pronos__myPredict${predClass}`}>
              Ton prono : {myPred.home}-{myPred.away}
              {myPoints != null && <strong> · {myPoints > 0 ? `+${myPoints}` : '0'} pt{myPoints > 1 ? 's' : ''}</strong>}
            </span>
          ) : <span />}
          {predCount > 0 && (
            <button className="pronos__toggleBtn" onClick={() => setOpen(o => !o)}>
              {open ? 'Masquer' : `Voir les pronos (${predCount})`}
            </button>
          )}
        </div>
      )}
      {open && (
        <PredictionsPanel matchId={match.id} players={players} predictions={predictions} deviceId={deviceId} actual={actual} prono={prono} />
      )}
    </div>
  )
}

function Pronos() {
  const { deviceId, groupCode, hasGroup, createGroup, joinGroup, leaveGroup, predict } = usePronosGroup()
  // Switcher tout en haut de page (demande utilisateur, 28/08 : "faudrait que
  // tout en haut de la page on puisse switch entre la page actuel prono et
  // une page simulateur") — PAS un 4e onglet mélangé à Pronos/Résultat/
  // Classement (1er essai, corrigé) : le Simulateur est une page à part
  // entière, avec son propre switcher au-dessus des onglets historiques.
  const [mode, setMode] = useState('pronos')
  const [activeTab, setActiveTab] = useState('pronos')
  // Filtre championnat (demande utilisateur, 21/08) — partagé entre les
  // onglets Pronos et Résultat, voir CompFilterBar plus haut.
  const [compFilter, setCompFilter] = useState(null)

  const { matches: upcoming, loading: loadingUpcoming } = useUpcomingMatchesAllComps(COMP_IDS)
  // Requis par Résultat (matchs finis <24h à afficher) ET Classement (calcul des points).
  // ⚠️ BUG CORRIGÉ (constat utilisateur : en arrivant sur l'onglet Résultat, le
  // dernier match terminé n'apparaissait qu'1-2s après, "comme un appel réseau"
  // — parce que s'en était un : cette requête était gardée derrière
  // activeTab==='resultat'/'classement', donc jamais lancée tant qu'on n'avait
  // pas cliqué sur l'onglet, contrairement à `upcoming` ci-dessus (toujours
  // active dès l'arrivée sur la page). Désormais lancée dès qu'on a un groupe,
  // comme upcoming — la donnée est déjà chaude quand on clique sur l'onglet.
  const { matches: finished } = useFinishedMatchesAllComps(COMP_IDS, hasGroup)
  const { players, predictions, refresh } = usePronosGroupData(groupCode, hasGroup)
  const { liveMatches, espnScores } = useLiveData()

  // Forme récente (pour calcProno → système de points variable, voir plus
  // haut) — uniquement pour les compétitions réellement présentes dans les
  // matchs à venir/terminés affichés ici (même pattern que Accueil.jsx),
  // pas tout COMP_IDS à l'aveugle.
  const formCompCodes = useMemo(() => {
    const codes = new Set()
    for (const m of upcoming) if (m.competition?.code) codes.add(m.competition.code)
    for (const m of finished) if (m.competition?.code) codes.add(m.competition.code)
    for (const m of liveMatches) if (m.competition?.code) codes.add(m.competition.code)
    return [...codes]
  }, [upcoming, finished, liveMatches])
  const { formMap, matchesByComp } = useTeamFormMulti(formCompCodes)
  // Repli "club promu" (03/08, cohérence demandée avec Accueil) — voir
  // useLowerDivisionStatsMulti (useMatchs.js) et son commentaire détaillé.
  const lowerDivByComp = useLowerDivisionStatsMulti(formCompCodes, matchesByComp)

  // ⚠️ BUG CORRIGÉ (constat utilisateur : un match venait de se terminer —
  // bon prono, score exact — mais restait affiché "En direct" dans l'onglet
  // Résultat au lieu de "Terminé", et n'apparaissait ensuite nulle part une
  // fois disparu de "En cours") : `inProgress` ne testait que match.status
  // (IN_PLAY/PAUSED, figé à IN_PLAY par liveTracker.markLive — jamais mis à
  // jour), sans jamais regarder le flag `ft` (confirmé par ESPN, voir
  // matchStateTracker). Résultat : LiveResultRow continuait de s'afficher
  // après la fin réelle du match, avec calcMinute()/getMatchPeriod() qui
  // renvoient null une fois ft===true → repli sur le texte littéral "En
  // direct" (bug visuel). Ensuite, une fois le match évincé du tracker,
  // aucune trace nulle part tant que football-data.org n'a pas confirmé
  // FINISHED de son côté (1-5min de retard connu, voir CLAUDE.md) : le match
  // devenait invisible dans "Résultat" pendant tout ce délai.
  const inProgress = useMemo(
    () => liveMatches.filter(m => getMatchState(m.id).ft !== true && (m.status === 'IN_PLAY' || m.status === 'PAUSED')),
    [liveMatches]
  )

  // Pont ft→FINISHED (même principe que resultPanel dans Accueil.jsx) : dès
  // qu'ESPN confirme la fin d'un match encore suivi par le tracker live, on
  // le fait apparaître immédiatement en "Terminé" avec son score final, sans
  // attendre la confirmation football-data.org (qui peut prendre plusieurs
  // minutes). Score : ESPN en mémoire (espnScores) ou, à défaut, la dernière
  // valeur persistée par confirmFt (foot_espn_${id}) — mêmes deux sources
  // que resultPanel.
  const justFinished = useMemo(() => {
    // ⚠️ Même bug réel que resultPanel dans Accueil.jsx (score figé 3-5 au lieu
    // de 4-6, buts marqués après un FT ESPN mal détecté) : tant qu'un match
    // reste dans liveMatches (grâce period 5min post-confirmFt), il passait ici
    // en priorité sur `finished` (FD.org) même une fois FD.org lui-même à jour
    // avec un score plus frais/exact — le snapshot localStorage foot_espn_ figé
    // au moment du FT local ne se rafraîchit jamais. On exclut donc tout match
    // déjà connu de `finished` : dans ce cas la version FD.org (fraîche, voir
    // finishedAll plus bas) prend le relais automatiquement.
    const finishedIds = new Set(finished.map(m => String(m.id)))
    return liveMatches
      .filter(m => getMatchState(m.id).ft === true && !finishedIds.has(String(m.id)))
      .map(m => {
        const es = espnScores[m.id]
        let lsHome = null, lsAway = null
        try {
          const lsScore = JSON.parse(localStorage.getItem(`foot_espn_${m.id}`) ?? 'null')
          if (lsScore && lsScore.home != null) { lsHome = lsScore.home; lsAway = lsScore.away }
        } catch {}
        const wentToPens = es?.homeShootout != null && es?.awayShootout != null
        return {
          ...m,
          score: {
            ...m.score,
            fullTime: {
              home: mergeScore(es?.home, lsHome ?? m.score?.fullTime?.home),
              away: mergeScore(es?.away, lsAway ?? m.score?.fullTime?.away),
            },
            ...(wentToPens ? {
              duration: 'PENALTY_SHOOTOUT',
              penalties: { home: es.homeShootout, away: es.awayShootout },
            } : {}),
          },
          status: 'FINISHED',
        }
      })
  }, [liveMatches, espnScores, finished])

  // Fusion : matchs "pontés" en priorité (score le plus frais), puis le
  // reste de `finished` (football-data.org) sans doublon.
  const finishedAll = useMemo(() => {
    const jfIds = new Set(justFinished.map(m => String(m.id)))
    return [...justFinished, ...finished.filter(m => !jfIds.has(String(m.id)))]
  }, [finished, justFinished])

  const recentFinished = useMemo(() => {
    // Fenêtre d'affichage très large (27h) : la "fraîcheur" de `now` n'a
    // d'importance qu'à la marge (borne re-testée à chaque refetch React
    // Query de `finished`/`justFinished`, qui fait varier `finishedAll` de
    // toute façon) — pas de ticker dédié nécessaire ici, contrairement au
    // countdown mi-temps (Live.jsx) qui a besoin de la seconde/minute près.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now()
    return finishedAll
      .filter(m => now - new Date(m.utcDate).getTime() < FINISHED_DISPLAY_MS)
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
  }, [finishedAll])

  // Championnats disponibles pour le filtre — union de tout ce qui est
  // réellement affichable (à venir + en cours + terminé récent), même
  // pattern que resultCompetitions/matchCompetitions (Accueil.jsx) : exclut
  // les compétitions à 1 seul match par an (USC/TDC/CS, voir
  // SINGLE_MATCH_COMPS) — rien d'utile à filtrer dessus.
  const filterableComps = useMemo(() => {
    const seen = new Set()
    const out  = []
    for (const m of [...upcoming, ...inProgress, ...recentFinished]) {
      const id = m.competition?.id
      if (id && !seen.has(id) && !SINGLE_MATCH_COMPS.has(m.competition?.code)) {
        seen.add(id)
        const meta = COMPETITIONS.find(c => c.id === id)
        out.push({ id, shortName: meta?.shortName ?? m.competition?.name ?? id, emblem: meta?.emblem ?? null })
      }
    }
    return out
  }, [upcoming, inProgress, recentFinished])

  // Filtre ignoré (sans jamais réinitialiser l'état) si la compétition
  // sélectionnée disparaît des données (ex: dernier match de cette
  // compétition vient de sortir de la fenêtre affichée) — dérivé directement
  // au rendu plutôt qu'un useEffect + setState (même résultat pour
  // l'utilisateur : plus bloqué sur une liste vide sans s'en rendre compte,
  // mais sans le rendu en cascade d'un setState dans un effet). Si la
  // compétition réapparaît plus tard (ex: nouveau match programmé), le choix
  // déjà fait par l'utilisateur redevient actif tout seul.
  const effectiveCompFilter = (compFilter && filterableComps.some(c => c.id === compFilter)) ? compFilter : null

  const filteredUpcoming       = effectiveCompFilter ? upcoming.filter(m => m.competition?.id === effectiveCompFilter)       : upcoming
  const filteredInProgress     = effectiveCompFilter ? inProgress.filter(m => m.competition?.id === effectiveCompFilter)     : inProgress
  const filteredRecentFinished = effectiveCompFilter ? recentFinished.filter(m => m.competition?.id === effectiveCompFilter) : recentFinished

  const goTab = (t) => setActiveTab(t)
  const swipe = useSwipe(
    () => { const i = TABS.indexOf(activeTab); if (i < TABS.length - 1) goTab(TABS[i + 1]) },
    () => { const i = TABS.indexOf(activeTab); if (i > 0) goTab(TABS[i - 1]) }
  )

  const grouped = useMemo(() => groupByDay(filteredUpcoming), [filteredUpcoming])

  // ── Auto-avance des cases de score (voir commentaire détaillé sur
  // MatchPredictRow) : une seule Map de refs DOM pour toute la liste
  // (useRef, jamais recréée), plutôt qu'un état React par ligne — un focus()
  // programmatique n'a pas besoin de déclencher de re-render. `nextIdByMatchId`
  // capture l'ordre RÉELLEMENT affiché (jours puis matchs, celui de `grouped`
  // ci-dessus) : dernier match d'un jour → 1er match du jour suivant, jamais
  // un id issu d'un ordre différent.
  const inputRefsMap = useRef(new Map())
  const registerInputRef = (matchId, field, el) => {
    if (!el) return
    if (!inputRefsMap.current.has(matchId)) inputRefsMap.current.set(matchId, {})
    inputRefsMap.current.get(matchId)[field] = el
  }
  const focusInput = (matchId, field) => {
    inputRefsMap.current.get(matchId)?.[field]?.focus()
  }
  const nextIdByMatchId = useMemo(() => {
    const flat = grouped.flatMap(g => g.matches.map(m => m.id))
    const map = {}
    for (let i = 0; i < flat.length - 1; i++) map[flat[i]] = flat[i + 1]
    return map
  }, [grouped])

  const finishedById = useMemo(() => {
    const map = {}
    finishedAll.forEach(m => { map[String(m.id)] = m.score?.fullTime ?? null })
    return map
  }, [finishedAll])

  // % 1/N/2 (calcProno) par match terminé, pour scorer avec le même barème
  // que celui affiché avant le match (voir computePoints).
  const pronoByMatchId = useMemo(() => {
    const map = {}
    finishedAll.forEach(m => { map[String(m.id)] = matchProno(m, formMap, matchesByComp, lowerDivByComp) })
    return map
  }, [finishedAll, formMap, matchesByComp, lowerDivByComp])

  const leaderboard = useMemo(() => {
    return Object.entries(players)
      .map(([id, pname]) => {
        let points = 0
        Object.entries(predictions).forEach(([matchId, preds]) => {
          const myPred = preds[id]
          const actual = finishedById[matchId]
          if (myPred && actual) points += computePoints(myPred, actual.home, actual.away, pronoByMatchId[matchId])
        })
        return { id, name: pname, points }
      })
      .sort((a, b) => b.points - a.points)
  }, [players, predictions, finishedById, pronoByMatchId])

  const handlePredict = async (matchId, home, away) => {
    try {
      await predict(matchId, home, away)
      refresh()
    } catch {
      // Échec silencieux (réseau) : la case garde la valeur saisie localement,
      // l'utilisateur peut réessayer en la modifiant à nouveau.
    }
  }

  const playerCount = Object.keys(players).length || 1

  return (
    <div className="pronos__page">
      <div className="pronos__modeSwitch">
        <button
          className={`pronos__modeBtn${mode === 'pronos' ? ' pronos__modeBtn--active' : ''}`}
          onClick={() => setMode('pronos')}
        >
          Pronos
        </button>
        <button
          className={`pronos__modeBtn${mode === 'simulateur' ? ' pronos__modeBtn--active' : ''}`}
          onClick={() => setMode('simulateur')}
        >
          Simulateur
        </button>
      </div>

      {mode === 'simulateur' ? (
        <PronosSimulateur />
      ) : !hasGroup ? (
        <JoinCreateScreen onCreate={createGroup} onJoin={joinGroup} />
      ) : (
        <>
          <div className="pronos__header">
            <div>
              <div className="pronos__headerLabel">Groupe</div>
              <div className="pronos__headerCode">{groupCode}</div>
            </div>
            <div className="pronos__headerRight">
              <span className="pronos__playerCount">{playerCount} joueur{playerCount > 1 ? 's' : ''}</span>
              <button
                className="pronos__leaveBtn"
                onClick={() => { if (window.confirm('Quitter ce groupe de pronos ?')) leaveGroup() }}
              >
                Quitter
              </button>
            </div>
          </div>

          <div className="pronos__tabs">
            <button
              className={`pronos__tab${activeTab === 'pronos' ? ' pronos__tab--active' : ''}`}
              onClick={() => goTab('pronos')}
            >
              Pronos
            </button>
            <button
              className={`pronos__tab${activeTab === 'resultat' ? ' pronos__tab--active' : ''}`}
              onClick={() => goTab('resultat')}
            >
              Résultat{filteredInProgress.length > 0 ? ` (${filteredInProgress.length})` : ''}
            </button>
            <button
              className={`pronos__tab${activeTab === 'classement' ? ' pronos__tab--active' : ''}`}
              onClick={() => goTab('classement')}
            >
              Classement
            </button>
          </div>

          {activeTab !== 'classement' && (
            <CompFilterBar competitions={filterableComps} active={effectiveCompFilter} onChange={setCompFilter} />
          )}

          <div ref={swipe.ref} className="pronos__tabContent">
            {activeTab === 'pronos' && (
              loadingUpcoming ? (
                <div className="pronos__empty">
                  <span className="pronos__emptyTitle">Chargement…</span>
                </div>
              ) : grouped.length === 0 ? (
                <div className="pronos__empty">
                  <span className="pronos__emptyIcon">⚽</span>
                  <span className="pronos__emptyTitle">Aucun match à venir pour le moment</span>
                </div>
              ) : (
                grouped.map(g => (
                  <div key={g.key} className="pronos__day">
                    <div className="pronos__dayLabel">{g.label}</div>
                    {g.matches.map(m => (
                      <MatchPredictRow
                        key={m.id}
                        match={m}
                        myPred={predictions[String(m.id)]?.[deviceId]}
                        onSave={handlePredict}
                        formMap={formMap}
                        matchesByComp={matchesByComp}
                        lowerDivByComp={lowerDivByComp}
                        nextMatchId={nextIdByMatchId[m.id] ?? null}
                        registerInputRef={registerInputRef}
                        focusInput={focusInput}
                      />
                    ))}
                  </div>
                ))
              )
            )}

            {activeTab === 'resultat' && (
              filteredInProgress.length === 0 && filteredRecentFinished.length === 0 ? (
                <div className="pronos__empty">
                  <span className="pronos__emptyIcon">⚽</span>
                  <span className="pronos__emptyTitle">Aucun match en cours ou terminé récemment</span>
                </div>
              ) : (
                <>
                  {filteredInProgress.length > 0 && (
                    <div className="pronos__day">
                      <div className="pronos__dayLabel">En cours</div>
                      {filteredInProgress.map(m => (
                        <LiveResultRow
                          key={m.id} match={m} espn={espnScores[m.id] ?? null}
                          players={players} predictions={predictions} deviceId={deviceId}
                        />
                      ))}
                    </div>
                  )}
                  {filteredRecentFinished.length > 0 && (
                    <div className="pronos__day">
                      <div className="pronos__dayLabel">Terminés (24h)</div>
                      {filteredRecentFinished.map(m => (
                        <FinishedResultRow
                          key={m.id} match={m}
                          players={players} predictions={predictions} deviceId={deviceId}
                          prono={pronoByMatchId[String(m.id)]}
                        />
                      ))}
                    </div>
                  )}
                </>
              )
            )}

            {activeTab === 'classement' && (
              leaderboard.length === 0 ? (
                <div className="pronos__empty">
                  <span className="pronos__emptyIcon">🏆</span>
                  <span className="pronos__emptyTitle">Personne n'a encore pronostiqué</span>
                </div>
              ) : (
                <div className="pronos__leaderboard">
                  {leaderboard.map((p, i) => (
                    <div key={p.id} className={`pronos__lbRow${p.id === deviceId ? ' pronos__lbRow--me' : ''}`}>
                      <span className="pronos__lbRank">{i + 1}</span>
                      <span className="pronos__lbName">{p.name}{p.id === deviceId ? ' (toi)' : ''}</span>
                      <span className="pronos__lbPoints">{p.points} pts</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default Pronos
