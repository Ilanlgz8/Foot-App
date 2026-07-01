/**
 * LiveMatchPage — page dédiée à un match en direct
 * Route : /live/:matchId
 *
 * Style : même visuel que MatchPage (hero gradient plein-écran + onglets)
 * Contenu live préservé : minute, score temps réel, buteurs, xG, stats live
 */
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useLiveData }      from '../context/LiveProvider'
import { getMatchState }    from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod, mergeScore } from '../utils/matchUtils'
import { COMPETITIONS }     from '../data/competitions'
import { translateTeam }    from '../data/teamNames'
import { getMatchGradient } from '../data/teamPhotos'
import { calcProno }        from '../utils/calcProno'
import { useTeamForm }      from '../hooks/useTeamForm'
import { useSwipe }         from '../hooks/useSwipe'
import {
  LiveStatsTab,
  ComposTab,
  ClassementTab,
} from '../components/MatchModal'
import './LiveMatchPage.css'
import './MatchPage.css'
import '../live.css'
import '../matchModal.css'

// ── Raccourcis noms ───────────────────────────────────────────────────────────
const TEAM_SHORT = {
  'Union Saint-Gilloise': 'Union SG', 'Paris Saint-Germain': 'Paris SG',
  'Paris Saint-Germain FC': 'Paris SG', 'Crystal Palace': 'C. Palace',
  'Wolverhampton': 'Wolves', 'Wolverhampton Wanderers': 'Wolves',
  'Nottingham Forest': 'Nott. Forest', 'Brighton & Hove Albion': 'Brighton',
  'Brighton Hove Albion': 'Brighton', 'Newcastle United': 'Newcastle',
  'Tottenham Hotspur': 'Tottenham', 'West Ham United': 'West Ham',
  'Manchester City': 'Man. City', 'Manchester United': 'Man. United',
  'Leeds United': 'Leeds', 'Atlético Madrid': 'Atl. Madrid',
  'Athletic Bilbao': 'Ath. Bilbao', 'Real Sociedad': 'R. Sociedad',
  'Deportivo Alavés': 'Alavés', 'Rayo Vallecano': 'Rayo',
  'Bayern Munich': 'Bayern', 'Eintracht Frankfurt': 'Frankfurt',
  'Werder Brême': 'Werder', 'Werder Bremen': 'Werder',
  'Borussia Dortmund': 'Dortmund', 'Inter Milan': 'Inter',
  'Milan AC': 'Milan', 'Hellas Verona': 'Verona',
  'PSV Eindhoven': 'PSV', 'Club Brugge': 'Bruges', 'Slavia Prague': 'Slavia',
}
function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 13) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0].toUpperCase()}. ${words.slice(1).join(' ')}`
}

// ── Hero live (style MatchPage + éléments live) ───────────────────────────────
function MatchHeader({ match, espn, onBack }) {
  const matchSt   = getMatchState(match.id)
  const isTermine = matchSt.ft === true

  // Ticker 5s pour interpolation de minute en temps réel
  const [, setTick] = useState(0)
  useEffect(() => {
    if (isTermine) return
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [isTermine])

  const minute  = isTermine ? null : calcMinute(match)
  const period  = getMatchPeriod(match)
  const comp    = COMPETITIONS.find(c => c.id === match.competition?.code)
  const emblem  = comp?.emblem ?? match.competition?.emblem
  const compName = match.competition?.name ?? comp?.name ?? ''

  const isHalftime = match.status === 'PAUSED' || matchSt.espnStatus === 'STATUS_HALFTIME'
  const pauseElapsed = (isHalftime && matchSt.pausedAt && !matchSt.half2Start)
    ? Date.now() - matchSt.pausedAt : null
  const repriseImminente = pauseElapsed != null && pauseElapsed >= 15 * 60_000
  const repriseDans = pauseElapsed != null && pauseElapsed < 15 * 60_000
    ? Math.max(1, Math.ceil((15 * 60_000 - pauseElapsed) / 60_000)) : null

  const hs  = mergeScore(espn?.home, match.score?.fullTime?.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, match.score?.fullTime?.away ?? match.score?.halfTime?.away)

  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))
  const xgHome   = espn?.stats?.home?.xg ?? null
  const xgAway   = espn?.stats?.away?.xg ?? null

  const h = hs ?? '–', a = as_ ?? '–'

  // Label minute (badge rouge au-dessus du score)
  const minuteLabel = isTermine ? 'Terminé'
    : period === 'HT'  ? 'MT'
    : period === 'ET1' ? 'Prol. 1'
    : period === 'ET2' ? 'Prol. 2'
    : period === 'PEN' ? 'TAB'
    : minute != null   ? `${minute}'` : '–'

  // Badge période (MI-TEMPS, TERMINÉ…)
  const periodBadge = period === 'HT' ? 'MI-TEMPS'
    : period === 'FT'              ? 'TERMINÉ'
    : (period === 'ET1' || period === 'ET2') ? 'PROLONGATIONS'
    : period === 'PEN'             ? 'T.A.B.'
    : null

  // Score localStorage (partagé avec Live.jsx)
  const scoreKey = `foot_lv_score_${match.id}`
  const prevHs   = useRef(null)
  const prevAs   = useRef(null)
  const initDone = useRef(false)
  if (!initDone.current) {
    initDone.current = true
    try {
      const s = JSON.parse(localStorage.getItem(scoreKey) || 'null')
      if (s?.home != null) prevHs.current = s.home
      if (s?.away != null) prevAs.current = s.away
    } catch {}
  }
  useEffect(() => {
    if (hs  != null) prevHs.current = hs
    if (as_ != null) prevAs.current = as_
    if (hs != null && as_ != null) {
      try { localStorage.setItem(scoreKey, JSON.stringify({ home: hs, away: as_ })) } catch {}
    }
  }, [hs, as_])

  const gradient = getMatchGradient(
    match.homeTeam?.name || match.homeTeam?.shortName || '',
    match.awayTeam?.name || match.awayTeam?.shortName || ''
  )

  return (
    <div className="mp__hero lmp__hero" style={{ background: gradient }}>
      <div className="mp__hero__overlay" />

      {/* Top bar : retour + badge compétition */}
      <div className="mp__hero__top">
        <button className="mp__hero__back" onClick={onBack}>‹ En Direct</button>
        <div className="mp__hero__comp">
          {emblem && <img src={emblem} alt="" className="mp__hero__compLogo" />}
          <span className="mp__hero__compName">{compName}</span>
        </div>
      </div>

      {/* Badge minute live + reprise */}
      <div className="lmp__heroBadgeRow">
        <span className={`lmp__heroMinute${isTermine ? ' lmp__heroMinute--ft' : ''}`}>
          {minuteLabel}
        </span>
        {(repriseImminente || repriseDans != null) && (
          <span className="lmp__heroReprise">
            {repriseImminente ? 'Reprise imm.' : `Reprise ${repriseDans}min`}
          </span>
        )}
      </div>

      {/* Centre : crests + score */}
      <div className="mp__hero__mid">
        <div className="mp__hero__team">
          {match.homeTeam?.crest
            ? <img src={match.homeTeam.crest} alt="" className="mp__hero__crest" />
            : <div className="mp__hero__crestFb" />}
          <span className="mp__hero__name">{homeName}</span>
          {xgHome != null && <span className="lmp__heroXg">{xgHome.toFixed(2)} xG</span>}
        </div>

        <div className="mp__hero__center">
          <span className="mp__hero__score">{h} – {a}</span>
          {periodBadge && <span className="lmp__heroPeriodBadge">{periodBadge}</span>}
        </div>

        <div className="mp__hero__team mp__hero__team--away">
          {match.awayTeam?.crest
            ? <img src={match.awayTeam.crest} alt="" className="mp__hero__crest" />
            : <div className="mp__hero__crestFb" />}
          <span className="mp__hero__name">{awayName}</span>
          {xgAway != null && <span className="lmp__heroXg">{xgAway.toFixed(2)} xG</span>}
        </div>
      </div>

      {/* Buteurs */}
      {espn?.scorers?.length > 0 && (
        <div className="lmp__heroScorers">
          <div className="lmp__heroScorersHome">
            {espn.scorers.filter(s => s.team === 'home').map((s, i) => (
              <span key={i} className="lmp__heroScorerItem">
                {s.name}{s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''}
                {s.minute && <span className="lmp__heroScorerMin"> {s.minute}</span>}
              </span>
            ))}
          </div>
          <div className="lmp__heroScorersDiv" />
          <div className="lmp__heroScorersAway">
            {espn.scorers.filter(s => s.team === 'away').map((s, i) => (
              <span key={i} className="lmp__heroScorerItem">
                {s.name}{s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''}
                {s.minute && <span className="lmp__heroScorerMin"> {s.minute}</span>}
              </span>
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

  const { formMap, compMatches } = useTeamForm(compId)
  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]
  const prono = (hForm || aForm) ? calcProno(hForm, aForm) : null

  const [activeTab, setActiveTab] = useState('stats')
  const [tabDir, setTabDir]       = useState(null)

  const goTab = (t, dir) => { setTabDir(dir); setActiveTab(t) }

  const swipe = useSwipe(
    () => { const i = TABS.indexOf(activeTab); if (i < TABS.length - 1) goTab(TABS[i + 1], 'left') },
    () => { const i = TABS.indexOf(activeTab); if (i > 0) goTab(TABS[i - 1], 'right') }
  )

  if (!match) {
    return (
      <div className="mp__page">
        <div className="mp__loading">
          <div className="modal__spinner" />
          <p>Chargement du match…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mp__page">

      {/* Hero gradient avec score live */}
      <MatchHeader match={match} espn={espn} onBack={() => {
        if (window.history.length > 1) navigate(-1)
        else navigate('/live')
      }} />

      <div className="mp__wrap">
        <div className="mp__body" ref={swipe.ref}>

          {/* Onglets */}
          <div className="mp__tabs">
            {TABS.map(t => (
              <button
                key={t}
                className={`mp__tab${activeTab === t ? ' mp__tab--active' : ''}`}
                onClick={() => goTab(t, null)}
              >
                {t === 'stats'       ? 'Stats Live'
               : t === 'compos'     ? 'Compos'
               :                      'Classement'}
              </button>
            ))}
          </div>

          {/* Contenu */}
          <div
            key={activeTab}
            className={`mp__tabContent${
              !swipe.isDragging && tabDir === 'left'  ? ' mp__tabContent--fromRight' :
              !swipe.isDragging && tabDir === 'right' ? ' mp__tabContent--fromLeft'  : ''
            }`}
            style={{
              transform:  swipe.isDragging ? `translateX(${swipe.dragOffset}px)` : undefined,
              transition: swipe.isDragging ? 'none' : undefined,
            }}
          >
            {activeTab === 'stats' && (
              <LiveStatsTab
                match={match}
                espnScore={espn}
                prono={prono}
                homeShort={match.homeTeam?.shortName || match.homeTeam?.name}
                awayShort={match.awayTeam?.shortName || match.awayTeam?.name}
                compMatches={compMatches}
              />
            )}
            {activeTab === 'compos'     && <ComposTab match={match} compMatches={compMatches} />}
            {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
          </div>
        </div>
      </div>
    </div>
  )
}
