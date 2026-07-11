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
import { useState, useEffect, useMemo } from 'react'
import { usePronosGroup, usePronosGroupData } from '../hooks/usePronosGroup'
import { useUpcomingMatchesAllComps, useFinishedMatchesAllComps } from '../hooks/useMatchs'
import { useLiveData } from '../context/LiveProvider'
import { calcMinute, getMatchPeriod, mergeScore, finalScore } from '../utils/matchUtils'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'
import { useSwipe } from '../hooks/useSwipe'
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
const isWCMatch = (match) => match.competition?.id === 2000 || match.competition?.code === 'WC'
// Nom FR de la compétition (ex: "FIFA World Cup" → "Coupe du Monde"), même
// mapping que COMPETITIONS (data/competitions.js) utilisé partout ailleurs.
const compName = (match) => {
  const comp = COMPETITIONS.find(c => c.id === match.competition?.code)
  return comp?.name ?? match.competition?.name ?? ''
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

// Points : 3 = score exact, 1 = bon résultat (victoire/nul/défaite), 0 sinon.
function computePoints(pred, actualHome, actualAway) {
  if (!pred || actualHome == null || actualAway == null) return 0
  if (pred.home === actualHome && pred.away === actualAway) return 3
  const predDiff   = Math.sign(pred.home - pred.away)
  const actualDiff = Math.sign(actualHome - actualAway)
  return predDiff === actualDiff ? 1 : 0
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

function MatchPredictRow({ match, myPred, onSave }) {
  const [home, setHome] = useState(myPred?.home ?? '')
  const [away, setAway] = useState(myPred?.away ?? '')

  useEffect(() => {
    setHome(myPred?.home ?? '')
    setAway(myPred?.away ?? '')
  }, [myPred?.home, myPred?.away, match.id])

  const commit = () => {
    const h = parseInt(home, 10)
    const a = parseInt(away, 10)
    if (Number.isInteger(h) && Number.isInteger(a) && h >= 0 && h <= 20 && a >= 0 && a <= 20) {
      onSave(match.id, h, a)
    }
  }

  return (
    <div className="pronos__matchRow">
      <div className="pronos__matchMeta">
        <span>{compName(match)}</span>
        <span>{_fmtH(match.utcDate)}</span>
      </div>
      <div className="pronos__matchTeams">
        <div className="pronos__team">
          <TeamCrest team={match.homeTeam} isWC={isWCMatch(match)} />
          <span className="pronos__teamName">{teamName(match.homeTeam)}</span>
        </div>
        <div className="pronos__scoreGroup">
          <input
            type="number" inputMode="numeric" min="0" max="20"
            className="pronos__scoreInput"
            value={home}
            onChange={e => setHome(e.target.value)}
            onBlur={commit}
          />
          <span className="pronos__scoreSep">-</span>
          <input
            type="number" inputMode="numeric" min="0" max="20"
            className="pronos__scoreInput"
            value={away}
            onChange={e => setAway(e.target.value)}
            onBlur={commit}
          />
        </div>
        <div className="pronos__team">
          <TeamCrest team={match.awayTeam} isWC={isWCMatch(match)} />
          <span className="pronos__teamName">{teamName(match.awayTeam)}</span>
        </div>
      </div>
    </div>
  )
}

// Ligne "match en cours" — minute + score seulement (pas de stats, pas de
// buteurs) : juste de quoi suivre un match qu'on a pronostiqué le temps qu'il
// se joue, entre l'onglet Pronos (avant coup d'envoi) et Classement (une fois
// terminé). Ticker 5s pour faire avancer calcMinute() entre deux polls ESPN,
// même logique que LiveCard (Live.jsx).
function LiveResultRow({ match, espn }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [])

  const period = getMatchPeriod(match)
  const minute = calcMinute(match)
  const fs = finalScore(match.score)
  const hs = mergeScore(espn?.home, fs.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, fs.away ?? match.score?.halfTime?.away)

  return (
    <div className="pronos__matchRow">
      <div className="pronos__matchMeta">
        <span>{compName(match)}</span>
        <span className="pronos__liveMinute">{period ?? (minute ?? 'En direct')}</span>
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
    </div>
  )
}

// Ligne "match terminé récemment" (< 24h) — score final, pas de minute.
function FinishedResultRow({ match }) {
  const fs = finalScore(match.score)
  return (
    <div className="pronos__matchRow">
      <div className="pronos__matchMeta">
        <span>{compName(match)}</span>
        <span>Terminé</span>
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
    </div>
  )
}

function Pronos() {
  const { deviceId, groupCode, pseudo, hasGroup, createGroup, joinGroup, leaveGroup, predict } = usePronosGroup()
  const [activeTab, setActiveTab] = useState('pronos')

  const { matches: upcoming, loading: loadingUpcoming } = useUpcomingMatchesAllComps(COMP_IDS)
  // Requis par Résultat (matchs finis <24h à afficher) ET Classement (calcul des points)
  const { matches: finished } = useFinishedMatchesAllComps(
    COMP_IDS, hasGroup && (activeTab === 'resultat' || activeTab === 'classement')
  )
  const { players, predictions, refresh } = usePronosGroupData(groupCode, hasGroup)
  const { liveMatches, espnScores } = useLiveData()

  const inProgress = useMemo(
    () => liveMatches.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED'),
    [liveMatches]
  )

  const recentFinished = useMemo(() => {
    const now = Date.now()
    return finished
      .filter(m => now - new Date(m.utcDate).getTime() < FINISHED_DISPLAY_MS)
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
  }, [finished])

  const goTab = (t) => setActiveTab(t)
  const swipe = useSwipe(
    () => { const i = TABS.indexOf(activeTab); if (i < TABS.length - 1) goTab(TABS[i + 1]) },
    () => { const i = TABS.indexOf(activeTab); if (i > 0) goTab(TABS[i - 1]) }
  )

  const grouped = useMemo(() => groupByDay(upcoming), [upcoming])

  const finishedById = useMemo(() => {
    const map = {}
    finished.forEach(m => { map[String(m.id)] = m.score?.fullTime ?? null })
    return map
  }, [finished])

  const leaderboard = useMemo(() => {
    return Object.entries(players)
      .map(([id, pname]) => {
        let points = 0
        Object.entries(predictions).forEach(([matchId, preds]) => {
          const myPred = preds[id]
          const actual = finishedById[matchId]
          if (myPred && actual) points += computePoints(myPred, actual.home, actual.away)
        })
        return { id, name: pname, points }
      })
      .sort((a, b) => b.points - a.points)
  }, [players, predictions, finishedById])

  const handlePredict = async (matchId, home, away) => {
    try {
      await predict(matchId, home, away)
      refresh()
    } catch {
      // Échec silencieux (réseau) : la case garde la valeur saisie localement,
      // l'utilisateur peut réessayer en la modifiant à nouveau.
    }
  }

  if (!hasGroup) {
    return (
      <div className="pronos__page">
        <JoinCreateScreen onCreate={createGroup} onJoin={joinGroup} />
      </div>
    )
  }

  const playerCount = Object.keys(players).length || 1

  return (
    <div className="pronos__page">
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
          Résultat{inProgress.length > 0 ? ` (${inProgress.length})` : ''}
        </button>
        <button
          className={`pronos__tab${activeTab === 'classement' ? ' pronos__tab--active' : ''}`}
          onClick={() => goTab('classement')}
        >
          Classement
        </button>
      </div>

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
                  />
                ))}
              </div>
            ))
          )
        )}

        {activeTab === 'resultat' && (
          inProgress.length === 0 && recentFinished.length === 0 ? (
            <div className="pronos__empty">
              <span className="pronos__emptyIcon">⚽</span>
              <span className="pronos__emptyTitle">Aucun match en cours ou terminé récemment</span>
            </div>
          ) : (
            <>
              {inProgress.length > 0 && (
                <div className="pronos__day">
                  <div className="pronos__dayLabel">En cours</div>
                  {inProgress.map(m => (
                    <LiveResultRow key={m.id} match={m} espn={espnScores[m.id] ?? null} />
                  ))}
                </div>
              )}
              {recentFinished.length > 0 && (
                <div className="pronos__day">
                  <div className="pronos__dayLabel">Terminés (24h)</div>
                  {recentFinished.map(m => (
                    <FinishedResultRow key={m.id} match={m} />
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
    </div>
  )
}

export default Pronos
