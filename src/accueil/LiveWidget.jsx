import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod } from '../utils/matchUtils'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'

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

// ── Rang score custom : pills Chakra Petch + barre verticale ────────────────
function ScoreDisplay({ homeScore, awayScore, minute, isTermine }) {
  const h = homeScore ?? '-'
  const a = awayScore ?? '-'
  const label = isTermine ? 'FT' : (minute ?? '–')

  let homeCls = 'accueil__liveWidgetPill'
  let awayCls = 'accueil__liveWidgetPill'
  if (isTermine && homeScore != null && awayScore != null) {
    if (homeScore > awayScore) {
      homeCls += ' accueil__liveWidgetPill--winner'
      awayCls += ' accueil__liveWidgetPill--loser'
    } else if (awayScore > homeScore) {
      homeCls += ' accueil__liveWidgetPill--loser'
      awayCls += ' accueil__liveWidgetPill--winner'
    } else {
      // nul — les deux légèrement atténués
      homeCls += ' accueil__liveWidgetPill--loser'
      awayCls += ' accueil__liveWidgetPill--loser'
    }
  }

  return (
    <div className="accueil__liveWidgetScoreWrap">
      <span className="accueil__liveWidgetMinute">{label}</span>
      <div className="accueil__liveWidgetPills">
        <div className={homeCls}>{h}</div>
        <div className="accueil__liveWidgetPillBar" />
        <div className={awayCls}>{a}</div>
      </div>
    </div>
  )
}

// ── Buteurs en deux colonnes ─────────────────────────────────────────────────
function ScorerColumns({ scorers = [] }) {
  const homeGoals = scorers.filter(s => s.team === 'home')
  const awayGoals = scorers.filter(s => s.team === 'away')
  if (homeGoals.length === 0 && awayGoals.length === 0) return null

  const label = s =>
    `⚽ ${s.name}${s.minute ? ' ' + s.minute : ''}${s.ownGoal ? ' (csc)' : ''}${s.penaltyKick ? ' (pen)' : ''}`

  return (
    <div className="accueil__liveWidgetScorers">
      <div className="accueil__liveWidgetScorersHome">
        {homeGoals.map((s, i) => <span key={i} className="accueil__liveWidgetScorer">{label(s)}</span>)}
      </div>
      <div className="accueil__liveWidgetScorersAway">
        {awayGoals.map((s, i) => <span key={i} className="accueil__liveWidgetScorer">{label(s)}</span>)}
      </div>
    </div>
  )
}

// ── Stats grille : home val | barre | label | barre | away val ───────────────
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
    rows.push({ h: `${home.corners}`, label: 'crs', a: `${away.corners}`, hNum: home.corners, aNum: away.corners })

  if (rows.length === 0) return null

  return (
    <div className="accueil__liveWidgetStats">
      {rows.map((row, i) => {
        const total = (row.hNum + row.aNum) || 1
        const homePct = (row.hNum / total) * 100
        return (
          <div key={i} className="accueil__liveWidgetStatRow">
            <span className="accueil__liveWidgetStatNum accueil__liveWidgetStatNum--home">{row.h}</span>
            <div className="accueil__liveWidgetStatTrack">
              <div className="accueil__liveWidgetStatFill" style={{ width: `${homePct}%` }} />
            </div>
            <span className="accueil__liveWidgetStatLabel">{row.label}</span>
            <div className="accueil__liveWidgetStatTrack">
              <div className="accueil__liveWidgetStatFill accueil__liveWidgetStatFill--away" style={{ width: `${100 - homePct}%` }} />
            </div>
            <span className="accueil__liveWidgetStatNum">{row.a}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Widget principal ─────────────────────────────────────────────────────────
export function LiveWidget({ liveMatches = [], espnScores = {}, trackedIds, onRecalibrate, onMatchClick }) {
  const live = liveMatches.filter(m =>
    m.status === 'IN_PLAY' || m.status === 'PAUSED' || getMatchState(m.id).ft === true
  )

  if (live.length === 0) return null

  return (
    <div className="accueil__liveWidget">
      <div className="accueil__liveWidgetHeader">
        <span className="accueil__liveWidgetDot" />
        <span className="accueil__liveWidgetTitle">EN DIRECT</span>
        {live.length > 1 && <span className="accueil__liveWidgetCount">{live.length}</span>}
        {onRecalibrate && (
          <button className="accueil__liveWidgetRecal" onClick={onRecalibrate} title="Recalibrer les minutes">⟳</button>
        )}
      </div>

      <div className="accueil__liveWidgetMatches">
        {live.slice(0, 5).map(match => {
          const espn      = espnScores[match.id] ?? null
          const isTermine = getMatchState(match.id).ft === true
          const minute    = isTermine ? null : calcMinute(match)
          const hs        = espn?.home ?? match.score?.fullTime?.home ?? match.score?.halfTime?.home
          const as_       = espn?.away ?? match.score?.fullTime?.away ?? match.score?.halfTime?.away
          const homeName  = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
          const awayName  = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
          const clickable = !!onMatchClick

          return (
            <div
              key={match.id}
              className={`accueil__liveWidgetMatchBlock${clickable ? ' accueil__liveWidgetMatchBlock--clickable' : ''}`}
              onClick={clickable ? () => onMatchClick(match) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? e => e.key === 'Enter' && onMatchClick(match) : undefined}
            >
              <div className="accueil__liveWidgetMeta">
                <CompBadge match={match} />
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
                />

                {/* Équipe extérieur */}
                <div className="accueil__liveWidgetTeam accueil__liveWidgetTeam--away">
                  {match.awayTeam?.crest
                    ? <img src={match.awayTeam.crest} alt="" className="accueil__liveWidgetCrest" />
                    : <div className="accueil__liveWidgetCrestFallback" />}
                  <span className="accueil__liveWidgetTeamName">{awayName}</span>
                </div>
              </div>

              <ScorerColumns scorers={espn?.scorers ?? []} />
              <StatsBar stats={espn?.stats ?? null} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
