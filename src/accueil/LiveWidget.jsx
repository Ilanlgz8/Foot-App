import { MatchCard } from './MatchCard'
import { getMatchState } from '../utils/matchStateTracker'

// Affiche les buteurs en deux colonnes : domicile à gauche, extérieur à droite
// Aligné avec le layout du MatchCard (home | score | away)
function ScorerColumns({ scorers = [] }) {
  if (scorers.length === 0) return null

  const homeGoals = scorers.filter(s => s.team === 'home')
  const awayGoals = scorers.filter(s => s.team === 'away')
  if (homeGoals.length === 0 && awayGoals.length === 0) return null

  const label = (s) =>
    `⚽ ${s.name}${s.minute ? ' ' + s.minute : ''}${s.ownGoal ? ' (csc)' : ''}${s.penaltyKick ? ' (pen)' : ''}`

  return (
    <div className="accueil__liveWidgetScorers">
      <div className="accueil__liveWidgetScorersHome">
        {homeGoals.map((s, i) => (
          <span key={i} className="accueil__liveWidgetScorer">{label(s)}</span>
        ))}
      </div>
      <div className="accueil__liveWidgetScorersAway">
        {awayGoals.map((s, i) => (
          <span key={i} className="accueil__liveWidgetScorer">{label(s)}</span>
        ))}
      </div>
    </div>
  )
}

// Barre de possession + tirs + corners
// Ex : "56%  ▬▬▬▬▬▬▬▬▬▬▬▬●▬▬▬▬▬▬▬▬  44%   |   8 tirs · 4  ·  3 tirs"
function StatsBar({ stats }) {
  if (!stats) return null
  const { home, away } = stats
  const homePoss = home.poss ?? 50
  const awayPoss = away.poss ?? 50

  return (
    <div className="accueil__liveWidgetStats">
      <span className="accueil__liveWidgetStatVal">{Math.round(homePoss)}%</span>
      <div className="accueil__liveWidgetPossBar">
        <div className="accueil__liveWidgetPossFill" style={{ width: `${homePoss}%` }} />
      </div>
      <span className="accueil__liveWidgetStatVal">{Math.round(awayPoss)}%</span>
      {home.shots != null && (
        <>
          <span className="accueil__liveWidgetStatSep">|</span>
          <span className="accueil__liveWidgetStatVal">{home.shots}</span>
          <span className="accueil__liveWidgetStatLabel">tirs</span>
          <span className="accueil__liveWidgetStatVal">{away.shots}</span>
        </>
      )}
      {home.corners != null && (
        <>
          <span className="accueil__liveWidgetStatSep">|</span>
          <span className="accueil__liveWidgetStatVal">{home.corners}</span>
          <span className="accueil__liveWidgetStatLabel">corners</span>
          <span className="accueil__liveWidgetStatVal">{away.corners}</span>
        </>
      )}
    </div>
  )
}

export function LiveWidget({ liveMatches = [], espnScores = {}, trackedIds, onRecalibrate }) {
  // Inclure aussi les matchs en fenêtre de grâce post-FT (state.ft === true)
  // Leur status dans stickyLive est toujours 'IN_PLAY' (injectLiveMatch), donc ce filtre
  // les capte déjà — mais le check ft explicite sécurise le cas où FD.org passe FINISHED.
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
          <button
            className="accueil__liveWidgetRecal"
            onClick={onRecalibrate}
            title="Recalibrer les minutes"
          >⟳</button>
        )}
      </div>
      <div className="accueil__liveWidgetMatches">
        {live.slice(0, 5).map(match => {
          const espn = espnScores[match.id] ?? null
          const isTermine = getMatchState(match.id).ft === true
          return (
            <div key={match.id} className="accueil__liveWidgetMatchBlock">
              <MatchCard
                match={match}
                noWinnerLoser
                tracked={trackedIds?.has(String(match.id)) ?? false}
                espnScore={espn}
                isTermine={isTermine}
              />
              <ScorerColumns scorers={espn?.scorers ?? []} />
              <StatsBar stats={espn?.stats ?? null} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
