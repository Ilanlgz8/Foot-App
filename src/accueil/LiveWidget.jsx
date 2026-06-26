import { useState, useRef, useCallback, useEffect } from 'react'
import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod } from '../utils/matchUtils'
import { translateTeam } from '../data/teamNames'
import { COMPETITIONS } from '../data/competitions'
import { getMatchGradient } from '../data/teamPhotos'

// Map abréviations — clés = sortie de translateTeam (ou nom brut API si pas traduit)
const TEAM_SHORT = {
  // ── Ligue 1 ──
  'Union Saint-Gilloise':    'Union SG',
  'Paris Saint-Germain':     'Paris SG',
  'Paris Saint-Germain FC':  'Paris SG',

  // ── Premier League ──
  'Crystal Palace':          'C. Palace',
  'Wolverhampton':           'Wolves',
  'Wolverhampton Wanderers': 'Wolves',
  'Nottingham Forest':       'Nott. Forest',
  'Brighton & Hove Albion':  'Brighton',
  'Brighton Hove Albion':    'Brighton',
  'Newcastle United':        'Newcastle',
  'Tottenham Hotspur':       'Tottenham',
  'West Ham United':         'West Ham',
  'Manchester City':         'Man. City',
  'Manchester United':       'Man. United',
  'Leeds United':            'Leeds',

  // ── La Liga ──
  'Atlético Madrid':         'Atl. Madrid',
  'Athletic Bilbao':         'Ath. Bilbao',
  'Real Sociedad':           'R. Sociedad',
  'Deportivo Alavés':        'Alavés',
  'Rayo Vallecano':          'Rayo',

  // ── Bundesliga ──
  'Bayern Munich':           'Bayern',
  'Eintracht Frankfurt':     'Frankfurt',
  'Werder Brême':            'Werder',
  'Werder Bremen':           'Werder',
  'Borussia Dortmund':       'Dortmund',

  // ── Serie A ──
  'Inter Milan':             'Inter',
  'Milan AC':                'Milan',
  'Hellas Verona':           'Verona',

  // ── Ligue des Champions ──
  'PSV Eindhoven':           'PSV',
  'Club Brugge':             'Bruges',
  'Slavia Prague':           'Slavia',
  'Slavia Praha':            'Slavia',

  // ── Coupe du Monde / Nations ──
  'Bosnie-Herzégovine':      'Bosnie-H.',
  'Arabie Saoudite':         'Arabie S.',
  'Nouvelle-Zélande':        'N.-Zélande',
  "Côte d'Ivoire":           'Côte d\'Ivoire',
  'Corée du Sud':            'Corée du Sud',
  'États-Unis':              'États-Unis',
  'Afrique du Sud':          'Afrique S.',
}

function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 13) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0]}. ${words.slice(1).join(' ')}`
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

// ── Badge compétition ────────────────────────────────────────────────────────
function CompBadge({ match }) {
  const comp   = COMPETITIONS.find(c => c.id === match.competition?.code)
  const emblem = comp?.emblem ?? match.competition?.emblem
  const name   = match.competition?.name ?? comp?.name ?? ''
  if (!emblem && !name) return null
  return (
    <div className="accueil__liveWidgetCompBadge">
      {emblem && <img src={emblem} alt="" className="accueil__liveWidgetCompLogo" />}
      <span className="accueil__liveWidgetCompName">{name}</span>
    </div>
  )
}

// ── Badge période ────────────────────────────────────────────────────────────
function PeriodBadge({ match }) {
  const period = getMatchPeriod(match)
  if (!period) return null
  return (
    <span className="accueil__liveWidgetPeriod">{period}</span>
  )
}

// ── Score display ────────────────────────────────────────────────────────────
function ScoreDisplay({ homeScore, awayScore, minute, isTermine, repriseImminente, repriseDans }) {
  const h = homeScore ?? '-'
  const a = awayScore ?? '-'
  const label = isTermine ? 'FT' : (minute ?? '–')

  let homeCls = 'accueil__liveWidgetPill'
  let awayCls = 'accueil__liveWidgetPill'
  if (isTermine) {
    homeCls += ' accueil__liveWidgetPill--ft'
    awayCls += ' accueil__liveWidgetPill--ft'
  }

  return (
    <div className="accueil__liveWidgetScoreWrap">
      <div className="accueil__liveWidgetMinuteWrap">
        <span className="accueil__liveWidgetMinute">{label}</span>
      </div>
      <div className="accueil__liveWidgetPills">
        <div className={homeCls}>{h}</div>
        <div className="accueil__liveWidgetPillBar" />
        <div className={awayCls}>{a}</div>
      </div>
      {repriseImminente && (
        <span className="accueil__liveWidgetReprise">reprise imminente</span>
      )}
      {repriseDans != null && !repriseImminente && (
        <span className="accueil__liveWidgetReprise">reprise dans {repriseDans} min</span>
      )}
    </div>
  )
}

// ── Buteurs alignés sous chaque équipe ──────────────────────────────────────
function ScorerColumns({ scorers = [] }) {
  const homeGoals = scorers.filter(s => s.team === 'home')
  const awayGoals = scorers.filter(s => s.team === 'away')
  if (homeGoals.length === 0 && awayGoals.length === 0) return null

  const suffix = s => (s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : '')

  return (
    <div className="accueil__liveWidgetScorers">
      <div className="accueil__liveWidgetScorersHome">
        {homeGoals.map((s, i) => (
          <div key={i} className="accueil__liveWidgetScorerItem">
            <span className="accueil__liveWidgetScorerName">{s.name}{suffix(s)}</span>
            {s.minute && <span className="accueil__liveWidgetScorerMin">{s.minute}</span>}
          </div>
        ))}
      </div>
      <div className="accueil__liveWidgetScorersGap" />
      <div className="accueil__liveWidgetScorersAway">
        {awayGoals.map((s, i) => (
          <div key={i} className="accueil__liveWidgetScorerItem">
            <span className="accueil__liveWidgetScorerName">{s.name}{suffix(s)}</span>
            {s.minute && <span className="accueil__liveWidgetScorerMin">{s.minute}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Stats grille ─────────────────────────────────────────────────────────────
function StatsBar({ stats }) {
  if (!stats) return null
  const { home, away } = stats

  const fmtShots = (shots, sot) =>
    shots == null ? null : sot != null ? `${shots} (${sot})` : `${shots}`

  const rows = []

  if (home.poss != null) {
    const hp = Math.round(home.poss)
    const ap = Math.round(away.poss ?? (100 - home.poss))
    rows.push({ h: `${hp}%`, label: 'poss', a: `${ap}%`, hNum: hp, aNum: ap })
  }

  const hs = fmtShots(home.shots, home.shotsOnTarget)
  const as_ = fmtShots(away.shots, away.shotsOnTarget)
  if (hs != null)
    rows.push({ h: hs, label: 'tirs', a: as_, hNum: home.shots ?? 0, aNum: away.shots ?? 0 })

  if (home.corners != null)
    rows.push({ h: `${home.corners}`, label: 'crs', a: `${away.corners ?? 0}`, hNum: home.corners, aNum: away.corners ?? 0 })

  if (home.fouls != null)
    rows.push({ h: `${home.fouls}`, label: 'fautes', a: `${away.fouls ?? 0}`, hNum: home.fouls, aNum: away.fouls ?? 0 })

  if (home.offsides != null)
    rows.push({ h: `${home.offsides}`, label: 'hors-jeu', a: `${away.offsides ?? 0}`, hNum: home.offsides, aNum: away.offsides ?? 0 })

  if (home.yellow != null)
    rows.push({ h: `${home.yellow}`, label: '🟨', a: `${away.yellow ?? 0}`, hNum: home.yellow, aNum: away.yellow ?? 0 })

  if (rows.length === 0) return null

  return (
    <div className="accueil__liveWidgetStats">
      {rows.map((row, i) => {
        const total = row.hNum + row.aNum
        const homePct = total === 0 ? 50 : (row.hNum / total) * 100
        return (
          <div key={i} className="accueil__liveWidgetStatRow">
            <div className="accueil__liveWidgetStatHeader">
              <span className="accueil__liveWidgetStatNum">{row.h}</span>
              <span className="accueil__liveWidgetStatLabel">{row.label}</span>
              <span className="accueil__liveWidgetStatNum">{row.a}</span>
            </div>
            <div className="accueil__liveWidgetStatTrack">
              <div className="accueil__liveWidgetStatFill" style={{ width: `${homePct}%` }} />
              <div className="accueil__liveWidgetStatFill accueil__liveWidgetStatFill--away" style={{ width: `${100 - homePct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Carte de match individuelle avec détection de but ────────────────────────
// Composant séparé pour pouvoir utiliser useRef/useState par match
function LiveMatchBlock({ match, espn, onMatchClick }) {
  const matchSt    = getMatchState(match.id)
  const isTermine  = matchSt.ft === true

  const nowPending   = Date.now()
  const utcMsPending = new Date(match.utcDate).getTime()
  const isPendingKO  = !isTermine
    && (match.status === 'SCHEDULED' || match.status === 'TIMED')
    && nowPending >= utcMsPending
    && nowPending - utcMsPending < 30 * 60_000

  const minute = isTermine ? null : isPendingKO ? 'Débute' : calcMinute(match)

  const isHalftime       = matchSt.espnStatus === 'STATUS_HALFTIME' || match.status === 'PAUSED'
  const pauseElapsed     = isHalftime && matchSt.pausedAt && !matchSt.half2Start
    ? Date.now() - matchSt.pausedAt : null
  const repriseImminente = pauseElapsed != null && pauseElapsed >= 15 * 60_000
  const repriseDans      = pauseElapsed != null && pauseElapsed < 15 * 60_000
    ? Math.max(1, Math.ceil((15 * 60_000 - pauseElapsed) / 60_000)) : null

  const hs       = espn?.home ?? match.score?.fullTime?.home ?? match.score?.halfTime?.home
  const as_      = espn?.away ?? match.score?.fullTime?.away ?? match.score?.halfTime?.away
  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))
  const clickable = !!onMatchClick

  // ── Détection de but ──
  // Clé séparée de MatchCard pour éviter que MatchCard écrase le score
  // avant que LiveMatchBlock détecte le changement → fausse init → pas d'anim
  const scoreKey = `foot_lw_score_${match.id}`
  const prevHs   = useRef(null)
  const prevAs   = useRef(null)
  const timerRef = useRef(null)
  const [goal, setGoal] = useState(null) // { team: string, scoreStr: string } | null

  // Init one-shot depuis localStorage pour éviter les fausses animations au reload
  const initDone = useRef(false)
  if (!initDone.current) {
    initDone.current = true
    try {
      const s = JSON.parse(localStorage.getItem(scoreKey) || 'null')
      if (s?.home != null) prevHs.current = s.home
      if (s?.away != null) prevAs.current = s.away
    } catch {}
  }

  const isLive = !isTermine && (
    match.status === 'IN_PLAY' ||
    match.status === 'PAUSED'  ||
    isPendingKO ||
    minute !== null
  )

  useEffect(() => {
    if (!isLive) {
      prevHs.current = null
      prevAs.current = null
      try { localStorage.removeItem(scoreKey) } catch {}
      return
    }
    if (prevHs.current !== null && hs != null && hs > prevHs.current) {
      const team  = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '')
      const score = `${hs} – ${as_ ?? 0}`
      setGoal({ team, scoreStr: score })
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setGoal(null), 5200)
    } else if (prevAs.current !== null && as_ != null && as_ > prevAs.current) {
      const team  = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '')
      const score = `${hs ?? 0} – ${as_}`
      setGoal({ team, scoreStr: score })
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setGoal(null), 5200)
    }
    if (hs  != null) prevHs.current = hs
    if (as_ != null) prevAs.current = as_
    if (hs != null && as_ != null) {
      try { localStorage.setItem(scoreKey, JSON.stringify({ home: hs, away: as_ })) } catch {}
    }
  }, [hs, as_, isLive])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const blockCls = [
    'accueil__liveWidgetMatchBlock',
    clickable ? 'accueil__liveWidgetMatchBlock--clickable' : '',
    goal      ? 'accueil__liveWidgetMatchBlock--goal'      : '',
  ].filter(Boolean).join(' ')
  const blockGradient = getMatchGradient(
    match.homeTeam?.name || match.homeTeam?.shortName || '',
    match.awayTeam?.name || match.awayTeam?.shortName || ''
  )

  return (
    <div
      className={blockCls}
      style={{ '--match-card-gradient': blockGradient }}
      onClick={clickable ? () => onMatchClick(match) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? e => e.key === 'Enter' && onMatchClick(match) : undefined}
    >
      {goal && <GoalCelebration teamName={goal.team} scoreStr={goal.scoreStr} />}

      <div className="accueil__liveWidgetMeta">
        <PeriodBadge match={match} />
      </div>

      <div className="accueil__liveWidgetMatchRow">
        {/* Équipe domicile */}
        <div className="accueil__liveWidgetTeam">
          {match.homeTeam?.crest
            ? <img src={match.homeTeam.crest} alt="" className="accueil__liveWidgetCrest" />
            : <div className="accueil__liveWidgetCrestFallback" />}
          <span className="accueil__liveWidgetTeamName">{homeName}</span>
        </div>

        <ScoreDisplay
          homeScore={hs}
          awayScore={as_}
          minute={minute}
          isTermine={isTermine}
          repriseImminente={repriseImminente}
          repriseDans={repriseDans}
        />

        {/* Équipe extérieur */}
        <div className="accueil__liveWidgetTeam accueil__liveWidgetTeam--away">
          {match.awayTeam?.crest
            ? <img src={match.awayTeam.crest} alt="" className="accueil__liveWidgetCrest" />
            : <div className="accueil__liveWidgetCrestFallback" />}
          <span className="accueil__liveWidgetTeamName">{awayName}</span>
        </div>
      </div>

      {(espn?.scorers?.length > 0) && <div className="accueil__liveWidgetDivider" />}
      <ScorerColumns scorers={espn?.scorers ?? []} />
      <StatsBar stats={espn?.stats ?? null} />
    </div>
  )
}

// ── Widget principal ─────────────────────────────────────────────────────────
export function LiveWidget({ liveMatches = [], espnScores = {}, trackedIds, onRecalibrate, onMatchClick }) {
  const now = Date.now()
  const live = liveMatches.filter(m => {
    const state = getMatchState(m.id)
    if (state.ft === true) return true
    if (m.status === 'IN_PLAY' || m.status === 'PAUSED') return true
    if (m.status === 'SCHEDULED' || m.status === 'TIMED') {
      const utcMs = new Date(m.utcDate).getTime()
      if (now >= utcMs && now - utcMs < 30 * 60_000) return true
    }
    return false
  })

  const [activeIdx, setActiveIdx] = useState(0)
  const matchesRef = useRef(null)

  // Re-render toutes les 30s pour que le décompte mi-temps tick
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceUpdate(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const onScroll = useCallback(() => {
    const el = matchesRef.current
    if (!el) return
    const idx = Math.round(el.scrollLeft / el.offsetWidth)
    setActiveIdx(idx)
  }, [])

  if (live.length === 0) return null

  const sliced = live.slice(0, 5)

  return (
    <div className="accueil__liveWidget">
      <div className="accueil__liveWidgetHeader">
        <CompBadge match={sliced[activeIdx] ?? sliced[0]} />
        <div className="accueil__liveWidgetHeaderRight">
          <span className="accueil__liveWidgetDot" />
          <span className="accueil__liveWidgetTitle">EN DIRECT</span>
          {sliced.length > 1 && <span className="accueil__liveWidgetCount">{sliced.length}</span>}
          {onRecalibrate && (
            <button className="accueil__liveWidgetRecal" onClick={onRecalibrate} title="Recalibrer les minutes">⟳</button>
          )}
        </div>
      </div>

      <div className="accueil__liveWidgetMatches" ref={matchesRef} onScroll={onScroll}>
        {sliced.map(match => (
          <LiveMatchBlock
            key={match.id}
            match={match}
            espn={espnScores[match.id] ?? null}
            onMatchClick={onMatchClick}
          />
        ))}
      </div>

      {sliced.length > 1 && (
        <div className="accueil__liveWidgetDots">
          {sliced.map((_, i) => (
            <button
              key={i}
              className={`accueil__liveWidgetDotBtn${i === activeIdx ? ' accueil__liveWidgetDotBtn--active' : ''}`}
              onClick={() => {
                const el = matchesRef.current
                if (el) el.scrollTo({ left: i * el.offsetWidth, behavior: 'smooth' })
              }}
              aria-label={`Match ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
