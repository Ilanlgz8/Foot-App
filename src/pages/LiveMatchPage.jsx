/**
 * LiveMatchPage — page dédiée à un match en direct
 * Route : /live/:matchId
 *
 * Affiche le widget match en grand + onglets (Stats, Compos, Classement, Prono)
 */
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useLiveData }   from '../context/LiveProvider'
import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod } from '../utils/matchUtils'
import { COMPETITIONS }  from '../data/competitions'
import { translateTeam } from '../data/teamNames'
import { calcProno }     from '../utils/calcProno'
import { useTeamForm }   from '../hooks/useTeamForm'
import { useSwipe }      from '../hooks/useSwipe'
import {
  LiveStatsTab,
  ComposTab,
  ClassementTab,
  PronoSection,
} from '../components/MatchModal'
import './LiveMatchPage.css'

// ── Animation BUT ─────────────────────────────────────────────────────────────
function GoalCelebration({ teamName, scoreStr }) {
  return (
    <div className="goal__overlay" aria-hidden="true">
      <span className="goal__text">BUT !</span>
      <div className="goal__line" />
      {teamName && <span className="goal__team">{teamName}</span>}
      {scoreStr  && <span className="goal__score">{scoreStr}</span>}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const RESULT_LABEL = { W: 'V', D: 'N', L: 'D' }

// Formate une minute de buteur : "67:00" → "67'" | "67'" → "67'" | "67" → "67'"
const fmtMin = m => {
  if (!m) return ''
  const clean = String(m).replace(/'$/, '').split(':')[0]
  return clean ? `${clean}'` : ''
}

function MatchHeader({ match, espn, onBack }) {
  const matchSt  = getMatchState(match.id)
  const isTermine = matchSt.ft === true
  const minute   = isTermine ? null : calcMinute(match)
  const period   = getMatchPeriod(match)
  const comp     = COMPETITIONS.find(c => c.id === match.competition?.code)
  // xG depuis les stats ESPN (FotMob bloqué sur Vercel)
  const xgHome   = espn?.stats?.home?.xg ?? null
  const xgAway   = espn?.stats?.away?.xg ?? null

  const isHalftime = match.status === 'PAUSED' || matchSt.espnStatus === 'STATUS_HALFTIME'
  const pauseElapsed = (isHalftime && matchSt.pausedAt && !matchSt.half2Start)
    ? Date.now() - matchSt.pausedAt : null
  const repriseImminente = pauseElapsed != null && pauseElapsed >= 15 * 60_000
  const repriseDans = pauseElapsed != null && pauseElapsed < 15 * 60_000
    ? Math.max(1, Math.ceil((15 * 60_000 - pauseElapsed) / 60_000)) : null

  const hs  = espn?.home ?? match.score?.fullTime?.home ?? match.score?.halfTime?.home
  const as_ = espn?.away ?? match.score?.fullTime?.away ?? match.score?.halfTime?.away

  // Détection but → flash score
  const prevHs   = useRef(null)
  const prevAs   = useRef(null)
  const timerRef = useRef(null)
  const [goalSide, setGoalSide] = useState(null)
  const [goal, setGoal] = useState(null)

  useEffect(() => {
    // But annulé (VAR/hors-jeu) → score redescend → effacer immédiatement
    if (
      (prevHs.current !== null && hs != null && hs < prevHs.current) ||
      (prevAs.current !== null && as_ != null && as_ < prevAs.current)
    ) {
      clearTimeout(timerRef.current)
      setGoalSide(null); setGoal(null)
      if (hs  != null) prevHs.current = hs
      if (as_ != null) prevAs.current = as_
      return
    }
    if (hs != null && prevHs.current != null && hs > prevHs.current) {
      setGoalSide('home'); setGoal({ team: homeName, scoreStr: `${hs} – ${as_ ?? 0}` })
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => { setGoalSide(null); setGoal(null) }, 5200)
    } else if (as_ != null && prevAs.current != null && as_ > prevAs.current) {
      setGoalSide('away'); setGoal({ team: awayName, scoreStr: `${hs ?? 0} – ${as_}` })
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => { setGoalSide(null); setGoal(null) }, 5200)
    }
    if (hs  != null) prevHs.current = hs
    if (as_ != null) prevAs.current = as_
  }, [hs, as_])
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  // calcMinute() retourne déjà des strings avec apostrophe ("67'", "45+2'")
  // → ne pas en rajouter une deuxième
  const periodLabel = isTermine ? 'FT'
    : period === 'HT'   ? 'MT'
    : period === 'ET1'  ? 'Prol. 1'
    : period === 'ET2'  ? 'Prol. 2'
    : period === 'PEN'  ? 'Tirs au but'
    : minute != null    ? String(minute) : '–'

  return (
    <div className="lmp__header">
      {goal && <GoalCelebration teamName={goal.team} scoreStr={goal.scoreStr} />}

      {/* ── Top bar : backBtn gauche + score compact droite ── */}
      <div className="lmp__topBar">
        <button className="lmp__backBtn" onClick={onBack}>‹ En Direct</button>

        <div className="lmp__topRight">
          {/* Compétition (icône seule) */}
          {comp?.emblem && <img src={comp.emblem} alt="" className="lmp__compEmb" />}

          {/* Score inline compact */}
          <div className="lmp__scoreRow">
            {/* Domicile */}
            <div className="lmp__team">
              {match.homeTeam?.crest
                ? <img src={match.homeTeam.crest} alt="" className="lmp__crest" />
                : <div className="lmp__crestFallback" />}
              <span className="lmp__teamName">{homeName}</span>
              {xgHome != null && <span className="lmp__teamXg">{xgHome.toFixed(2)} xG</span>}
            </div>

            {/* Score + minute */}
            <div className="lmp__scoreCenter">
              <div className="lmp__minute">
                {repriseImminente
                  ? <span className="lmp__repriseLabel">Reprise imm.</span>
                  : repriseDans != null
                  ? <span className="lmp__repriseLabel">Reprise {repriseDans}min</span>
                  : <span className={isTermine ? 'lmp__minuteFt' : 'lmp__minuteLive'}>{periodLabel}</span>
                }
              </div>
              <div className="lmp__pills">
                <div className={`lmp__pill${goalSide === 'home' ? ' lmp__pill--scored' : ''}`} key={`h${hs}`}>
                  {hs ?? '–'}
                </div>
                <div className="lmp__pillBar" />
                <div className={`lmp__pill${goalSide === 'away' ? ' lmp__pill--scored' : ''}`} key={`a${as_}`}>
                  {as_ ?? '–'}
                </div>
              </div>
            </div>

            {/* Extérieur */}
            <div className="lmp__team lmp__team--away">
              {match.awayTeam?.crest
                ? <img src={match.awayTeam.crest} alt="" className="lmp__crest" />
                : <div className="lmp__crestFallback" />}
              <span className="lmp__teamName">{awayName}</span>
              {xgAway != null && <span className="lmp__teamXg">{xgAway.toFixed(2)} xG</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Buteurs */}
      {espn?.scorers?.length > 0 && (
        <div className="lmp__scorers">
          <div className="lmp__scorersHome">
            {espn.scorers.filter(s => s.team === 'home').map((s, i) => (
              <div key={i} className="lmp__scorer lmp__scorer--home">
                <span>{s.name}</span>
                {s.minute && <span className="lmp__scorerMin">{fmtMin(s.minute)}</span>}
              </div>
            ))}
          </div>
          <div className="lmp__scorersGap" />
          <div className="lmp__scorersAway">
            {espn.scorers.filter(s => s.team === 'away').map((s, i) => (
              <div key={i} className="lmp__scorer lmp__scorer--away">
                {s.minute && <span className="lmp__scorerMin">{fmtMin(s.minute)}</span>}
                <span>{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
const TABS = ['stats', 'compos', 'classement']

export default function LiveMatchPage() {
  const { matchId }            = useParams()
  const navigate               = useNavigate()
  const { liveMatches, espnScores } = useLiveData()

  const match   = liveMatches.find(m => String(m.id) === String(matchId))
  const espn    = match ? (espnScores[match.id] ?? null) : null
  const compId  = match?.competition?.code ?? null

  // Prono
  const { formMap } = useTeamForm(compId)
  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]
  const prono = (hForm || aForm) ? calcProno(hForm, aForm) : null

  const visibleTabs = TABS

  const [activeTab, setActiveTab] = useState('stats')
  const [tabDir, setTabDir]       = useState(null)

  const goTab = (t, dir) => { setTabDir(dir); setActiveTab(t) }

  const swipe = useSwipe(
    () => { const i = visibleTabs.indexOf(activeTab); if (i < visibleTabs.length - 1) goTab(visibleTabs[i + 1], 'left') },
    () => { const i = visibleTabs.indexOf(activeTab); if (i > 0) goTab(visibleTabs[i - 1], 'right') }
  )

  // Match introuvable (rechargement de page, pas encore chargé)
  if (!match) {
    return (
      <div className="lmp__page">
        <div className="lmp__loading">
          <div className="modal__spinner" />
          <p>Chargement du match…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="lmp__page">
      {/* Header compact : backBtn + score intégrés */}
      <MatchHeader match={match} espn={espn} onBack={() => navigate('/live')} />

      {/* Onglets */}
      <div ref={swipe.ref}>
        <div className="lmp__tabs">
          {visibleTabs.map(t => (
            <button
              key={t}
              className={`lmp__tab${activeTab === t ? ' lmp__tab--active' : ''}`}
              onClick={() => goTab(t, null)}
            >
              {t === 'stats'      ? 'Stats Live'
             : t === 'compos'    ? 'Compos'
             : t === 'classement'? 'Classement'
             :                     'Prono'}
            </button>
          ))}
        </div>

        <div
          key={activeTab}
          className={`lmp__tabContent${!swipe.isDragging && tabDir === 'left' ? ' lmp__tabContent--fromRight' : !swipe.isDragging && tabDir === 'right' ? ' lmp__tabContent--fromLeft' : ''}`}
          style={{
            transform: swipe.isDragging ? `translateX(${swipe.dragOffset}px)` : undefined,
            transition: swipe.isDragging ? 'none' : undefined,
          }}
        >
          {activeTab === 'stats'      && <LiveStatsTab match={match} espnScore={espn} prono={prono} homeShort={match.homeTeam?.shortName || match.homeTeam?.name} awayShort={match.awayTeam?.shortName || match.awayTeam?.name} />}
          {activeTab === 'compos'     && <ComposTab match={match} />}
          {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
        </div>
      </div>
    </div>
  )
}
