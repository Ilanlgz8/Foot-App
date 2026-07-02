import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MatchCard, PanelSkeleton } from './MatchCard'

function groupByDay(matches) {
  const groups = {}
  matches.forEach(m => {
    const day = m.utcDate.slice(0, 10)
    if (!groups[day]) groups[day] = []
    groups[day].push(m)
  })
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, ms]) => [day, ms.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))])
}

function groupByComp(matches) {
  const groups = {}
  matches.forEach(m => {
    const key  = m.competition?.id ?? 'other'
    const name = m.competition?.name ?? 'Autre'
    if (!groups[key]) groups[key] = { name, matches: [] }
    groups[key].matches.push(m)
  })
  return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
}

function formatDayLabel(dateStr) {
  const today     = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  if (dateStr === today)     return "Aujourd'hui"
  if (dateStr === yesterday) return 'Hier'
  return new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function ResultPanel({ results, loading, view = 'chrono', formMap = null }) {
  const grouped  = groupByDay(results)
  const navigate = useNavigate()
  const [dayIndex, setDayIndex] = useState(0)

  const currentDay     = grouped[dayIndex]
  const dayLabel       = currentDay ? formatDayLabel(currentDay[0]) : null
  const currentMatches = currentDay ? currentDay[1] : []
  const canGoBack      = dayIndex < grouped.length - 1
  const canGoForward   = dayIndex > 0

  const compGroups = groupByComp(currentMatches)

  return (
    <>
      <div className="accueil__resultNav">
        <button className="accueil__dayArrow" onClick={() => setDayIndex(i => i + 1)} disabled={!canGoBack} aria-label="Jour précédent">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="accueil__resultNavLabel">{dayLabel ?? '—'}</span>
        <button className="accueil__dayArrow" onClick={() => setDayIndex(i => i - 1)} disabled={!canGoForward} aria-label="Jour suivant">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <div className="accueil__dashPanelDivider" />
      <div className="accueil__dashPanelBody">
        {loading && <PanelSkeleton />}
        {!loading && results.length === 0 && (
          <p className="accueil__tickerEmpty">Aucun résultat disponible.</p>
        )}

        {/* Chronologique */}
        {!loading && view === 'chrono' && currentMatches.length > 0 && (
          <div className="accueil__matchCards">
            {currentMatches.map((match, i) => (
              <div key={match.id ?? i} onClick={() => navigate(`/match/${match.id}`, { state: { match } })} style={{ cursor: 'pointer' }}>
                <MatchCard match={match} noWinnerLoser noGradient formMap={formMap} />
              </div>
            ))}
          </div>
        )}

        {/* Par compétition */}
        {!loading && view === 'comp' && currentMatches.length > 0 && (
          <div className="accueil__compGroups">
            {compGroups.map(({ name, matches }) => (
              <div key={name} className="accueil__compGroup">
                <p className="accueil__compGroupTitle">{name}</p>
                <div className="accueil__matchCards">
                  {matches.map((match, i) => (
                    <div key={match.id ?? i} onClick={() => navigate(`/match/${match.id}`, { state: { match } })} style={{ cursor: 'pointer' }}>
                      <MatchCard match={match} noWinnerLoser noGradient formMap={formMap} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </>
  )
}
