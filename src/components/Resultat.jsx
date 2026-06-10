import { useEffect, useState } from 'react'
import './../resultats.css'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useMatches } from '../hooks/useMatchs'

function Resultats() {
  const [selectedComp, setSelectedComp] = useState('FL1')
  const [currentIndex, setCurrentIndex] = useState(0)

  const { matches, loading, error, grouped } = useMatches(selectedComp, 'FINISHED', 'desc')

  const currentComp = COMPETITIONS.find(c => c.id === selectedComp)

  // Journée actuellement affichée
  const currentGroup    = grouped[currentIndex]
  const currentMatchday = currentGroup?.[0]
  const currentMatches  = currentGroup?.[1] ?? []
  const total           = grouped.length

  const formatDate = (dateStr) =>
    new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short'
    })

  return (
    <section className="resultats">
      <div className="resultats__backdrop resultats__backdrop--one" />
      <div className="resultats__backdrop resultats__backdrop--two" />

      <div className="resultats__layout">

        {/* Sidebar */}
        <aside className="resultats__sidebar">
          <p className="resultats__sidebarLabel">Championnats</p>
          <nav className="resultats__sidebarNav">
            {COMPETITIONS.map(comp => (
              <button
                key={comp.id}
                onClick={() => setSelectedComp(comp.id)}
                className={`resultats__sidebarItem ${selectedComp === comp.id ? 'resultats__sidebarItem--active' : ''}`}
              >
                <img
                  src={comp.emblem}
                  alt=""
                  className="resultats__competitionLogo resultats__competitionLogo--sidebar"
                  onError={(e) => e.currentTarget.style.display = 'none'}
                />
                <span className="resultats__sidebarName">{comp.name}</span>
                {selectedComp === comp.id && <span className="resultats__sidebarDot" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Contenu */}
        <main className="resultats__main">

          {/* Header */}
          <div className="resultats__header">
            <p className="resultats__kicker">Résultats</p>
            <h1 className="resultats__title">
              {currentComp?.emblem && (
                <img
                  src={currentComp.emblem}
                  alt=""
                  className="resultats__competitionLogo resultats__competitionLogo--title"
                  onError={(e) => e.currentTarget.style.display = 'none'}
                />
              )}
              {currentComp?.name}
            </h1>
          </div>

          {loading && (
            <div className="resultats__state">
              <div className="resultats__spinner" />
              <p>Chargement des résultats...</p>
            </div>
          )}

          {error && (
            <p className="resultats__state resultats__state--error">{error}</p>
          )}

          {!loading && !error && grouped.length > 0 && (
            <>
              {/* Navigation journées */}
              <div className="resultats__nav">
                <button
                  className="resultats__navBtn"
                  onClick={() => setCurrentIndex(i => i + 1)}
                  disabled={currentIndex >= total - 1}
                >
                  ←
                </button>

                <span className="resultats__navLabel">
                  Journée {currentMatchday}
                </span>

                <button
                  className="resultats__navBtn"
                  onClick={() => setCurrentIndex(i => i - 1)}
                  disabled={currentIndex <= 0}
                >
                  →
                </button>
              </div>

              {/* Matchs de la journée */}
              <div className="resultats__panel">
                {currentMatches.map((match, index) => {
                  const homeScore = match.score.fullTime.home
                  const awayScore = match.score.fullTime.away
                  const homeWin   = homeScore > awayScore
                  const awayWin   = awayScore > homeScore

                  return (
                    <div
                      key={match.id}
                      className="resultats__match"
                      style={{ borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)' }}
                    >
                      {/* Équipe domicile */}
                      <div className="resultats__team resultats__team--home">
                        {match.homeTeam.crest && (
                          <img
                            src={match.homeTeam.crest}
                            alt=""
                            className="resultats__crest"
                            onError={e => e.target.style.display = 'none'}
                          />
                        )}
                        <span className={`resultats__teamName ${homeWin ? 'resultats__teamName--winner' : ''}`}>
                          {match.homeTeam.shortName || match.homeTeam.name}
                        </span>
                      </div>

                      {/* Score */}
                      <div className="resultats__score">
                        <span className="resultats__scoreDate">{formatDate(match.utcDate)}</span>
                        <div className="resultats__scoreNums">
                          <span className={`resultats__scoreNum ${homeWin ? 'resultats__scoreNum--win' : ''}`}>
                            {homeScore ?? '-'}
                          </span>
                          <span className="resultats__scoreSep">—</span>
                          <span className={`resultats__scoreNum ${awayWin ? 'resultats__scoreNum--win' : ''}`}>
                            {awayScore ?? '-'}
                          </span>
                        </div>
                      </div>

                      {/* Équipe extérieur */}
                      <div className="resultats__team resultats__team--away">
                        <span className={`resultats__teamName ${awayWin ? 'resultats__teamName--winner' : ''}`}>
                          {match.awayTeam.shortName || match.awayTeam.name}
                        </span>
                        {match.awayTeam.crest && (
                          <img
                            src={match.awayTeam.crest}
                            alt=""
                            className="resultats__crest"
                            onError={e => e.target.style.display = 'none'}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {!loading && !error && matches.length === 0 && (
            <p className="resultats__state">Aucun résultat disponible.</p>
          )}

        </main>
      </div>
    </section>
  )
}

export default Resultats
