// "À ne pas manquer" (Accueil) : 1 match par compétition — le plus intéressant —
// dans le cocon de sa compétition, + un accès à la page Match pour tout voir.
import { isCardLive } from '../utils/matchUtils'
import { groupMatchesByCompetition, pickBestMatch } from '../utils/competitionGroups'
import { Cocoon } from './Cocoon'
import { PanelSkeleton, PosterSkeleton, LazyPoster } from '../accueil/MatchCard'

const nbMatchs = n => `${n} match${n > 1 ? 's' : ''}`

export function Highlights({ matches, loading, espnScores = {}, onMatchClick, onLiveClick, matchesByComp = null, formMapByComp = null, onSeeAll, emptyText }) {
  const groups = groupMatchesByCompetition(matches)

  return (
    <div className="accueil__dashPanelBody">
      {loading && <PosterSkeleton />}
      {loading && <PanelSkeleton />}
      {!loading && groups.length === 0 && <p className="accueil__tickerEmpty">{emptyText}</p>}
      {!loading && groups.length > 0 && (
        <>
          {groups.map(g => {
            const best = pickBestMatch(g.matches, isCardLive)
            const others = g.matches.length - 1
            return (
              <Cocoon
                key={g.key}
                group={g}
                count={nbMatchs(g.matches.length)}
                footer={others > 0 ? (
                  <div className="hubCocoon__foot">
                    <span>+ {others} autre{others > 1 ? 's' : ''} match{others > 1 ? 's' : ''}</span>
                    <button type="button" onClick={onSeeAll}>Voir tout ›</button>
                  </div>
                ) : null}
              >
                <div className="hubPosters">
                  <LazyPoster
                    match={best}
                    espnScore={espnScores[best.id] ?? null}
                    live={isCardLive(best)}
                    onMatchClick={onMatchClick}
                    onLiveClick={onLiveClick}
                    formMap={formMapByComp?.[best.competition?.code] ?? null}
                    compMatches={matchesByComp?.[best.competition?.code] ?? null}
                  />
                </div>
              </Cocoon>
            )
          })}
          {matches.length > groups.length && (
            <button type="button" className="hubCta" onClick={onSeeAll}>
              Voir les {matches.length} matchs →
            </button>
          )}
        </>
      )}
    </div>
  )
}
