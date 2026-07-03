import { useNavigate } from 'react-router-dom'
import { useLiveData } from '../context/LiveProvider'
import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod, mergeScore } from '../utils/matchUtils'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'
import { useState, useRef, useEffect } from 'react'
import '../live.css'

// ── Helpers (copie depuis LiveWidget) ────────────────────────────────────────
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
  return `${words[0][0]}. ${words.slice(1).join(' ')}`
}

function CompBadge({ match }) {
  const comp   = COMPETITIONS.find(c => c.id === match.competition?.code)
  const emblem = comp?.emblem ?? match.competition?.emblem
  const name   = match.competition?.name ?? comp?.name ?? ''
  if (!emblem && !name) return null
  return (
    <div className="live__compBadge">
      {emblem && <img src={emblem} alt="" className="live__compLogo" />}
      <span className="live__compName">{name}</span>
    </div>
  )
}

function PeriodBadge({ match }) {
  const period = getMatchPeriod(match)
  if (!period) return null
  return <span className="live__period">{period}</span>
}

function ScoreDisplay({ homeScore, awayScore, minute, isTermine, repriseImminente, repriseDans, goalSide }) {
  const h = homeScore ?? '-'
  const a = awayScore ?? '-'
  const label = isTermine ? 'Terminé' : (minute ?? '–')
  const pillCls = `live__pill${isTermine ? ' live__pill--ft' : ''}`
  return (
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
        <div className={`${pillCls}${goalSide === 'home' ? ' live__pill--scored' : ''}`} key={`h${h}`}>{h}</div>
        <div className="live__pillBar" />
        <div className={`${pillCls}${goalSide === 'away' ? ' live__pill--scored' : ''}`} key={`a${a}`}>{a}</div>
      </div>
    </div>
  )
}

function ScorerColumns({ scorers = [] }) {
  const homeGoals = scorers.filter(s => s.team === 'home')
  const awayGoals = scorers.filter(s => s.team === 'away')
  if (!homeGoals.length && !awayGoals.length) return null
  const suffix = s => s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''
  return (
    <div className="live__scorers">
      <div className="live__scorersHome">
        {homeGoals.map((s, i) => (
          <div key={i} className="live__scorerItem">
            <span className="live__scorerName">{s.name}{suffix(s)}</span>
            {s.minute && <span className="live__scorerMin">{s.minute}</span>}
          </div>
        ))}
      </div>
      <div className="live__scorersGap" />
      <div className="live__scorersAway">
        {awayGoals.map((s, i) => (
          <div key={i} className="live__scorerItem">
            <span className="live__scorerName">{s.name}{suffix(s)}</span>
            {s.minute && <span className="live__scorerMin">{s.minute}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatsBar({ stats }) {
  if (!stats) return null
  const { home, away } = stats
  const fmtShots = (s, sot) => s == null ? null : sot != null ? `${s} (${sot})` : `${s}`
  const rows = []
  if (home.poss != null) {
    const hp = Math.round(home.poss), ap = Math.round(away.poss ?? (100 - home.poss))
    rows.push({ h: `${hp}%`, label: 'Possession', a: `${ap}%`, hNum: hp, aNum: ap })
  }
  const hs = fmtShots(home.shots, home.shotsOnTarget)
  const as_ = fmtShots(away.shots, away.shotsOnTarget)
  if (hs != null) rows.push({ h: hs, label: 'Tirs', a: as_, hNum: home.shots ?? 0, aNum: away.shots ?? 0 })
  if (home.corners != null) rows.push({ h: `${home.corners}`, label: 'Corners', a: `${away.corners}`, hNum: home.corners, aNum: away.corners })
  if (!rows.length) return null
  return (
    <div className="live__stats">
      {rows.map((row, i) => {
        const total = (row.hNum + row.aNum) || 1
        const homePct = (row.hNum / total) * 100
        return (
          <div key={i} className="live__statRow">
            <div className="live__statHeader">
              <span className="live__statNum">{row.h}</span>
              <span className="live__statLabel">{row.label}</span>
              <span className="live__statNum live__statNum--right">{row.a}</span>
            </div>
            <div className="live__statTrack">
              <div className="live__statFill" style={{ width: `${homePct}%` }} />
              <div className="live__statFill live__statFill--away" style={{ width: `${100 - homePct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Animation BUT ────────────────────────────────────────────────────────────
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

// ── Card match individuelle ───────────────────────────────────────────────────
function LiveCard({ match, espn, onClick }) {
  const matchSt = getMatchState(match.id)
  const isTermine = matchSt.ft === true

  // Ticker : force un re-render toutes les 5s pour que calcMinute() avance
  // en temps réel entre les polls ESPN (interpolation sans limite après background)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (isTermine) return
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [isTermine])

  const minute = isTermine ? null : calcMinute(match)
  // Reprise : match en pause selon FD.org OU ESPN → déclenche le compte à rebours
  const isHalftime = match.status === 'PAUSED' || matchSt.espnStatus === 'STATUS_HALFTIME'
  const pauseElapsed = (isHalftime && matchSt.pausedAt && !matchSt.half2Start)
    ? Date.now() - matchSt.pausedAt : null
  const repriseImminente = pauseElapsed != null && pauseElapsed >= 15 * 60_000
  const repriseDans = pauseElapsed != null && pauseElapsed < 15 * 60_000
    ? Math.max(1, Math.ceil((15 * 60_000 - pauseElapsed) / 60_000)) : null
  const hs = mergeScore(espn?.home, match.score?.fullTime?.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, match.score?.fullTime?.away ?? match.score?.halfTime?.away)
  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))

  // ── Détection de but ──
  const scoreKey = `foot_lv_score_${match.id}` // clé séparée de MatchCard et LiveWidget
  const prevHs   = useRef(null)
  const prevAs   = useRef(null)
  const timerRef = useRef(null)
  const [goal, setGoal] = useState(null)

  const initDone = useRef(false)
  if (!initDone.current) {
    initDone.current = true
    try {
      const s = JSON.parse(localStorage.getItem(scoreKey) || 'null')
      if (s?.home != null) prevHs.current = s.home
      if (s?.away != null) prevAs.current = s.away
    } catch {}
  }

  const isLive = !isTermine && (match.status === 'IN_PLAY' || match.status === 'PAUSED' || minute !== null)

  useEffect(() => {
    if (!isLive) { prevHs.current = null; prevAs.current = null; return }
    // But annulé (VAR/hors-jeu) → score redescend → effacer immédiatement
    if (
      (prevHs.current !== null && hs != null && hs < prevHs.current) ||
      (prevAs.current !== null && as_ != null && as_ < prevAs.current)
    ) {
      clearTimeout(timerRef.current)
      setGoal(null)
      if (hs  != null) prevHs.current = hs
      if (as_ != null) prevAs.current = as_
      return
    }

    const homeGoals = (prevHs.current != null && hs != null) ? hs - prevHs.current : 0
    const awayGoals = (prevAs.current != null && as_ != null) ? as_ - prevAs.current : 0

    const fireGoal = (side, scoreStr, delay = 0) => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const team = side === 'home'
          ? translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '')
          : translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '')
        setGoal({ team, scoreStr, side })
        timerRef.current = setTimeout(() => setGoal(null), 5200)
      }, delay)
    }

    if (homeGoals > 0 && prevHs.current != null) {
      const firstScore = homeGoals >= 2
        ? `${prevHs.current + 1} – ${as_ ?? prevAs.current ?? 0}`
        : `${hs} – ${as_ ?? 0}`
      fireGoal('home', firstScore)
      if (homeGoals >= 2) fireGoal('home', `${hs} – ${as_ ?? 0}`, 5400)
    } else if (awayGoals > 0 && prevAs.current != null) {
      const firstScore = awayGoals >= 2
        ? `${hs ?? prevHs.current ?? 0} – ${prevAs.current + 1}`
        : `${hs ?? 0} – ${as_}`
      fireGoal('away', firstScore)
      if (awayGoals >= 2) fireGoal('away', `${hs ?? 0} – ${as_}`, 5400)
    }

    if (hs  != null) prevHs.current = hs
    if (as_ != null) prevAs.current = as_
    if (hs != null && as_ != null) {
      try { localStorage.setItem(scoreKey, JSON.stringify({ home: hs, away: as_ })) } catch {}
    }
  }, [hs, as_, isLive])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <div
      className={`live__card${goal ? ' live__card--goal' : ''}`}
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      {goal && <GoalCelebration teamName={goal.team} scoreStr={goal.scoreStr} />}

      {/* Header : compétition + période */}
      <div className="live__cardHeader">
        <CompBadge match={match} />
        <PeriodBadge match={match} />
      </div>

      {/* Score principal — 3 colonnes: home | score | away */}
      <div className="live__matchRow">
        <div className="live__team">
          {match.homeTeam?.crest
            ? <div className="live__crestWrap"><img src={match.homeTeam.crest} alt="" className="live__crest" data-team={match.homeTeam?.name} /></div>
            : <div className="live__crestFallback">{homeName?.[0] ?? ''}</div>}
          <span className="live__teamName">{homeName}</span>
          {espn?.stats?.home?.xg != null && (
            <span className="live__teamXg">{espn.stats.home.xg.toFixed(2)} xG</span>
          )}
        </div>

        <ScoreDisplay
          homeScore={hs} awayScore={as_}
          minute={minute} isTermine={isTermine}
          repriseImminente={repriseImminente}
          repriseDans={repriseDans}
          goalSide={goal?.side ?? null}
        />

        <div className="live__team live__team--away">
          {match.awayTeam?.crest
            ? <div className="live__crestWrap"><img src={match.awayTeam.crest} alt="" className="live__crest" data-team={match.awayTeam?.name} /></div>
            : <div className="live__crestFallback">{awayName?.[0] ?? ''}</div>}
          <span className="live__teamName">{awayName}</span>
          {espn?.stats?.away?.xg != null && (
            <span className="live__teamXg">{espn.stats.away.xg.toFixed(2)} xG</span>
          )}
        </div>
      </div>

      {/* Buteurs */}
      {(espn?.scorers?.length > 0) && <div className="live__divider" />}
      <ScorerColumns scorers={espn?.scorers ?? []} />

      {/* Stats */}
      <StatsBar stats={espn?.stats ?? null} />
    </div>
  )
}

// ── Page Live ─────────────────────────────────────────────────────────────────
export default function Live() {
  const navigate = useNavigate()
  const { liveMatches, espnScores } = useLiveData()

  const live = liveMatches.filter(m =>
    m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'SCHEDULED' || getMatchState(m.id).ft === true
  )

  return (
    <section className="live__page">
      <div className="live__pageInner">

        {/* Header */}
        <div className="live__pageHeader">
          <button className="live__backBtn" onClick={() => navigate(-1)}>
            ‹ Retour
          </button>
          <div className="live__pageTitleWrap">
            <span className="live__pageDot" />
            <h1 className="live__pageTitle">En Direct</h1>
            <span className="live__pageCount">{live.length}</span>
          </div>
        </div>

        {/* Grille */}
        {live.length === 0 ? (
          <div className="live__empty">Aucun match en direct pour le moment.</div>
        ) : (
          <div className="live__grid">
            {live.map(match => (
              <LiveCard
                key={match.id}
                match={match}
                espn={espnScores[match.id] ?? null}
                onClick={() => navigate(`/live/${match.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
