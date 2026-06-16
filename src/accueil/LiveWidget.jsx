import { MatchCard } from './MatchCard'

export function LiveWidget({ liveMatches = [], espnScores = {}, trackedIds, onRecalibrate }) {
  const live = liveMatches.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')

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
        {live.slice(0, 5).map(match => (
          <MatchCard
            key={match.id}
            match={match}
            noWinnerLoser
            tracked={trackedIds?.has(String(match.id)) ?? false}
            espnScore={espnScores[match.id] ?? null}
          />
        ))}
      </div>
    </div>
  )
}
