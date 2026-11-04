// Accueil : 1 match par compétition — le plus intéressant — dans le cocon de sa compétition.
// « + N autres matchs » déplie la liste de CETTE compétition sur place (et la replie), le bouton du
// bas mène à la page Match pour tout voir.
import { useState } from 'react'
import { isCardLive } from '../utils/matchUtils'
import { groupMatchesByCompetition, pickBestMatch } from '../utils/competitionGroups'
import { Cocoon } from './Cocoon'
import { PanelSkeleton, PosterSkeleton, LazyPoster } from '../accueil/MatchCard'

const nbMatchs = n => `${n} match${n > 1 ? 's' : ''}`

export function Highlights({ matches, loading, espnScores = {}, onMatchClick, onLiveClick, matchesByComp = null, formMapByComp = null, onSeeAll, emptyText }) {
  const groups = groupMatchesByCompetition(matches)
  const [openKeys, setOpenKeys] = useState(() => new Set())
  const toggle = key => setOpenKeys(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

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
            const isOpen = openKeys.has(g.key)
            const shown = isOpen ? g.matches : [best]
            return (
              <Cocoon
                key={g.key}
                group={g}
                count={nbMatchs(g.matches.length)}
                footer={others > 0 ? (
                  <div className="hubCocoon__foot hubCocoon__foot--center">
                    <button type="button" onClick={() => toggle(g.key)} aria-expanded={isOpen}>
                      {isOpen ? 'Réduire ▴' : `+ ${others} autre${others > 1 ? 's' : ''} match${others > 1 ? 's' : ''} ▾`}
                    </button>
                  </div>
                ) : null}
              >
                <div className="hubPosters">
                  {shown.map(m => (
                    <LazyPoster
                      key={m.id}
                      match={m}
                      espnScore={espnScores[m.id] ?? null}
                      live={isCardLive(m)}
                      onMatchClick={onMatchClick}
                      onLiveClick={onLiveClick}
                      formMap={formMapByComp?.[m.competition?.code] ?? null}
                      compMatches={matchesByComp?.[m.competition?.code] ?? null}
                    />
                  ))}
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
