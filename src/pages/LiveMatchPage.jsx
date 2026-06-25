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
import '../live.css'

// ── Raccourcis noms (même logique que Live.jsx) ───────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
const RESULT_LABEL = { W: 'V', D: 'N', L: 'D' }

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

  const hs  = espn?.home ?? match.score?.fullTime?.home ?? match.score?.halfTime?.home
  const as_ = espn?.away ?? match.score?.fullTime?.away ?? match.score?.halfTime?.away

  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))
  const xgHome   = espn?.stats?.home?.xg ?? null
  const xgAway   = espn?.stats?.away?.xg ?? null

  const h = hs ?? '–', a = as_ ?? '–'
  const label = isTermine ? 'FT'
    : period === 'HT'  ? 'MT'
    : period === 'ET1' ? 'Prol. 1'
    : period === 'ET2' ? 'Prol. 2'
    : period === 'PEN' ? 'TAB'
    : minute != null   ? String(minute) : '–'
  const pillCls = `live__pill${isTermine ? ' live__pill--ft' : ''}`

  const periodBadge = period === 'HT' ? 'MI-TEMPS'
    : period === 'FT'            ? 'TERMINÉ'
    : (period === 'ET1' || period === 'ET2') ? 'PROLONG.'
    : period === 'PEN'           ? 'T.A.B.'
    : period ?? ''

  // ── Tracking score (localStorage partagé avec Live.jsx) ─────────────────────
  // Pas d'animation ici — l'animation BUT est réservée aux widgets Live.jsx
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

  return (
    <>
      <button className="lmp__backBtn" onClick={onBack}>‹ En Direct</button>
      <div className="live__card lmp__headerCard">

        {/* Header : comp + badge période */}
        <div className="live__cardHeader">
          <div className="live__compBadge">
            {emblem && <img src={emblem} alt="" className="live__compLogo" />}
            <span className="live__compName">{compName}</span>
          </div>
          {periodBadge && <span className="live__period">{periodBadge}</span>}
        </div>

        {/* Score — même structure 3 colonnes que Live.jsx */}
        <div className="live__matchRow">
          <div className="live__team">
            {match.homeTeam?.crest
              ? <img src={match.homeTeam.crest} alt="" className="live__crest" />
              : <div className="live__crestFallback" />}
            <span className="live__teamName">{homeName}</span>
            {xgHome != null && <span className="live__teamXg">{xgHome.toFixed(2)} xG</span>}
          </div>

          <div className="live__scoreWrap">
            <div className="live__minuteWrap">
              <span className="live__minute">{label}</span>
            </div>
            {(repriseImminente || repriseDans != null) && (
              <span className="live__reprise">
                {repriseImminente ? 'Reprise imm.' : `Reprise ${repriseDans}min`}
              </span>
            )}
            <div className="live__pills">
              <div className={pillCls} key={`h${h}`}>{h}</div>
              <div className="live__pillBar" />
              <div className={pillCls} key={`a${a}`}>{a}</div>
            </div>
          </div>

          <div className="live__team live__team--away">
            {match.awayTeam?.crest
              ? <img src={match.awayTeam.crest} alt="" className="live__crest" />
              : <div className="live__crestFallback" />}
            <span className="live__teamName">{awayName}</span>
            {xgAway != null && <span className="live__teamXg">{xgAway.toFixed(2)} xG</span>}
          </div>
        </div>

        {/* Buteurs */}
        {espn?.scorers?.length > 0 && (
          <>
            <div className="live__divider" />
            <div className="live__scorers">
              <div className="live__scorersHome">
                {espn.scorers.filter(s => s.team === 'home').map((s, i) => (
                  <div key={i} className="live__scorerItem">
                    <span className="live__scorerName">{s.name}{s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''}</span>
                    {s.minute && <span className="live__scorerMin">{s.minute}</span>}
                  </div>
                ))}
              </div>
              <div className="live__scorersGap" />
              <div className="live__scorersAway">
                {espn.scorers.filter(s => s.team === 'away').map((s, i) => (
                  <div key={i} className="live__scorerItem">
                    <span className="live__scorerName">{s.name}{s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''}</span>
                    {s.minute && <span className="live__scorerMin">{s.minute}</span>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
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
