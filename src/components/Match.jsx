import { useEffect, useState } from 'react'
import './../match.css'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useMatches } from '../hooks/useMatchs'




function Matchs() {
  const [selectedComp, setSelectedComp] = useState('FL1')
  const [currentIndex, setCurrentIndex] = useState(0)
  const { matches, loading, error, grouped } = useMatches(selectedComp, 'SCHEDULED', 'asc')
// ou 'FINISHED' + 'desc' pour Resultats
  
  const currentComp = COMPETITIONS.find(c => c.id === selectedComp)

  const currentGroup    = grouped[currentIndex]
  const currentMatchday = currentGroup?.[0]
  const currentMatches  = currentGroup?.[1] ?? []
  const total           = grouped.length

  const formatDate = (dateStr) =>
    new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short'
    })

  const formatHour = (dateStr) =>
    new Date(dateStr).toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit'
    })

  return (
    <section className="matchs">
      <div className="matchs__backdrop matchs__backdrop--one" />
      <div className="matchs__backdrop matchs__backdrop--two" />

      <div className="matchs__layout">

        {/* Sidebar */}
        <aside className="matchs__sidebar">
          <p className="matchs__sidebarLabel">Championnats</p>
          <nav className="matchs__sidebarNav">
            {COMPETITIONS.map(comp => (
              <button
                key={comp.id}
                onClick={() => setSelectedComp(comp.id)}
                className={`matchs__sidebarItem ${selectedComp === comp.id ? 'matchs__sidebarItem--active' : ''}`}
              >
                <img
                  src={comp.emblem}
                  alt=""
                  className="matchs__competitionLogo matchs__competitionLogo--sidebar"
                  onError={e => console.log('Logo failed:', e.currentTarget.src)}
                />
                <span className="matchs__sidebarName">{comp.name}</span>
                {selectedComp === comp.id && <span className="matchs__sidebarDot" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Contenu */}
        <main className="matchs__main">

          {/* Header */}
          <div className="matchs__header">
            <p className="matchs__kicker">Matchs à venir</p>
            <h1 className="matchs__title">
              {currentComp?.emblem && (
                <img
                  src={currentComp.emblem}
                  alt=""
                  className="matchs__competitionLogo matchs__competitionLogo--title"
                  onError={e => e.currentTarget.style.display = 'none'}
                />
              )}
              {currentComp?.name}
            </h1>
          </div>

          {loading && (
            <div className="matchs__state">
              <div className="matchs__spinner" />
              <p>Chargement des matchs...</p>
            </div>
          )}

          {error && (
            <p className="matchs__state matchs__state--error">{error}</p>
          )}

          {!loading && !error && grouped.length > 0 && (
            <>
              {/* Navigation journées */}
              <div className="matchs__nav">
                <button
                  className="matchs__navBtn"
                  onClick={() => setCurrentIndex(i => i - 1)}
                  disabled={currentIndex <= 0}
                >
                  ←
                </button>
                <span className="matchs__navLabel">Journée {currentMatchday}</span>
                <button
                  className="matchs__navBtn"
                  onClick={() => setCurrentIndex(i => i + 1)}
                  disabled={currentIndex >= total - 1}
                >
                  →
                </button>
              </div>

              {/* Matchs de la journée */}
              <div className="matchs__panel">
                {currentMatches.map((match, index) => (
                  <div
                    key={match.id}
                    className="matchs__match"
                    style={{ borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)' }}
                  >
                    {/* Équipe domicile */}
                    <div className="matchs__team matchs__team--home">
                      {match.homeTeam.crest && (
                        <img
                          src={match.homeTeam.crest}
                          alt=""
                          className="matchs__crest"
                          onError={e => e.target.style.display = 'none'}
                        />
                      )}
                      <span className="matchs__teamName">
                        {translateTeam(match.homeTeam.shortName || match.homeTeam.name)}
                      </span>
                    </div>

                    {/* Heure + date */}
                    <div className="matchs__score">
                      <div className="matchs__scoreNums">
                        <span className="matchs__scoreDate">{formatDate(match.utcDate)}</span>
                        <span className="matchs__scoreHour">{formatHour(match.utcDate)}</span>
                      </div>
                    </div>

                    {/* Équipe extérieure */}
                    <div className="matchs__team matchs__team--away">
                      <span className="matchs__teamName">
                        {translateTeam(match.awayTeam.shortName || match.awayTeam.name)}
                      </span>
                      {match.awayTeam.crest && (
                        <img
                          src={match.awayTeam.crest}
                          alt=""
                          className="matchs__crest"
                          onError={e => e.target.style.display = 'none'}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!loading && !error && matches.length === 0 && (
            <p className="matchs__state">Aucun match à venir pour le moment.</p>
          )}

        </main>
      </div>
    </section>
  )
}

export default Matchs