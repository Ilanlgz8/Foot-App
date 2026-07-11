/**
 * Pronos.jsx — Pronos entre amis (groupe par code, pas de compte).
 *
 * Deux onglets séparés (demandé par l'utilisateur) :
 *   - "Pronos"     : matchs à venir (toutes compétitions confondues, triés
 *                    par date) avec une case de score par équipe.
 *   - "Classement" : points de chaque joueur du groupe, calculés CÔTÉ CLIENT
 *                    (3 pts score exact, 1 pt bon résultat, 0 sinon) à partir
 *                    des matchs FINISHED déjà exposés par football-data.org —
 *                    aucun calcul ni cron ajouté côté serveur.
 *
 * Identité : deviceId + pseudo persistés en localStorage (usePronosGroup),
 * aucune donnée sensible, groupe rejoint via un code à 6 caractères.
 */
import { useState, useEffect, useMemo } from 'react'
import { usePronosGroup, usePronosGroupData } from '../hooks/usePronosGroup'
import { useUpcomingMatchesAllComps, useFinishedMatchesAllComps } from '../hooks/useMatchs'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'
import { useSwipe } from '../hooks/useSwipe'
import '../../pronos.css'

const COMP_IDS = COMPETITIONS.map(c => c.id)

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
        <span>{match.competition?.name ?? ''}</span>
        <span>{_fmtH(match.utcDate)}</span>
      </div>
      <div className="pronos__matchTeams">
        <span className="pronos__teamName">{teamName(match.homeTeam)}</span>
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
        <span className="pronos__teamName pronos__teamName--away">{teamName(match.awayTeam)}</span>
      </div>
    </div>
  )
}

function Pronos() {
  const { deviceId, groupCode, pseudo, hasGroup, createGroup, joinGroup, leaveGroup, predict } = usePronosGroup()
  const [activeTab, setActiveTab] = useState('pronos')

  const { matches: upcoming, loading: loadingUpcoming } = useUpcomingMatchesAllComps(COMP_IDS)
  const { matches: finished } = useFinishedMatchesAllComps(COMP_IDS, hasGroup && activeTab === 'classement')
  const { players, predictions, refresh } = usePronosGroupData(groupCode, hasGroup)

  const goTab = (t) => setActiveTab(t)
  const swipe = useSwipe(
    () => goTab(activeTab === 'pronos' ? 'classement' : activeTab),
    () => goTab(activeTab === 'classement' ? 'pronos' : activeTab)
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
          <button className="pronos__leaveBtn" onClick={leaveGroup}>Quitter</button>
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
