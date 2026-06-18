import { useState } from 'react'
import './../resultats.css'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useMatches }    from '../hooks/useMatchs'
import MatchModal        from './MatchModal'

function Resultats() {
  const [selectedComp, setSelectedComp] = useState('WC')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedMatch, setSelected]    = useState(null)

  const { matches, loading, error, grouped } = useMatches(selectedComp, 'FINISHED', 'desc')

  const currentComp     = COMPETITIONS.find(c => c.id === selectedComp)
  const currentGroup    = grouped[currentIndex]
  const currentMatchday = currentGroup?.[0]
  const currentMatches  = currentGroup?.[1] ?? []
  const total           = grouped.length

  const fmtHour = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const fmtDate = (d) => {
    const today    = new Date(); today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
    const date     = new Date(d); date.setHours(0,0,0,0)
    if (date.getTime() === today.getTime())    return `Aujourd'hui`
    if (date.getTime() === tomorrow.getTime()) return `Demain`
    return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })
  }

  const tName = (t) => translateTeam(t?.shortName || t?.name || '?')

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
                onClick={() => { setSelectedComp(comp.id); setCurrentIndex(0) }}
                className={`resultats__sidebarItem ${selectedComp === comp.id ? 'resultats__sidebarItem--active' : ''}`}
              >
                <img src={comp.emblem} alt=""
                  className="resultats__competitionLogo resultats__competitionLogo--sidebar"
                  onError={e => e.currentTarget.style.display = 'none'} />
                <span className="resultats__sidebarName">{comp.name}</span>
                {selectedComp === comp.id && <span className="resultats__sidebarDot" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Contenu */}
        <main className="resultats__main">

          <div className="resultats__header">
            <p className="resultats__kicker">Résultats</p>
            <h1 className="resultats__title">
              {currentComp?.emblem && (
                <img src={currentComp.emblem} alt=""
                  className="resultats__competitionLogo resultats__competitionLogo--title"
                  onError={e => e.currentTarget.style.display = 'none'} />
              )}
              {currentComp?.name}
            </h1>
          </div>

          {loading && (
            <div className="resultats__list">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="resultats__card" style={{ pointerEvents: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', justifyContent: 'flex-end' }}>
                    <div className="sk" style={{ width: '5rem', height: '0.85rem' }} />
                    <div className="sk" style={{ width: '2.6rem', height: '2.6rem', borderRadius: '50%' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' }}>
                    <div className="sk" style={{ width: '1rem', height: '0.6rem' }} />
                    <div className="sk" style={{ width: '3.5rem', height: '1.4rem' }} />
                    <div className="sk" style={{ width: '1.2rem', height: '0.5rem' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                    <div className="sk" style={{ width: '2.6rem', height: '2.6rem', borderRadius: '50%' }} />
                    <div className="sk" style={{ width: '5rem', height: '0.85rem' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="resultats__state resultats__state--error">{error}</p>}

          {!loading && !error && grouped.length > 0 && (
            <>
              <div className="resultats__nav">
                <button className="resultats__navBtn"
                  onClick={() => setCurrentIndex(i => i + 1)}
                  disabled={currentIndex >= total - 1}>←</button>
                <span className="resultats__navLabel">Journée {currentMatchday}</span>
                <button className="resultats__navBtn"
                  onClick={() => setCurrentIndex(i => i - 1)}
                  disabled={currentIndex <= 0}>→</button>
              </div>

              <div className="resultats__list">
                {currentMatches.map((match) => {
                  const hs   = match.score?.fullTime?.home ?? 0
                  const as_  = match.score?.fullTime?.away ?? 0
                  const hWin = hs > as_
                  const aWin = as_ > hs
                  const draw = hs === as_

                  return (
                    <div key={match.id} className="resultats__card"
                      onClick={() => setSelected(match)}
                      style={{ cursor: 'pointer' }}
                    >

                      {/* Équipe domicile */}
                      <div className={`resultats__team resultats__team--home ${aWin ? 'resultats__team--loser' : ''}`}>
                        <div className="resultats__crestWrap">
                          {match.homeTeam?.crest
                            ? <img src={match.homeTeam.crest} alt="" className="resultats__crest"
                                onError={e => e.target.style.display = 'none'} />
                            : <span className="resultats__crestFb">{tName(match.homeTeam)[0]}</span>
                          }
                        </div>
                        <span className="resultats__teamName">{tName(match.homeTeam)}</span>
                      </div>

                      {/* Score */}
                      <div className="resultats__scoreCenter">
                        <span className="resultats__cardDate">{fmtDate(match.utcDate)}</span>
                        <div className="resultats__scoreRow">
                          <span className={`resultats__scoreNum ${hWin ? 'resultats__scoreNum--win' : ''} ${draw ? 'resultats__scoreNum--draw' : ''}`}>{hs}</span>
                          <span className="resultats__scoreDash">–</span>
                          <span className={`resultats__scoreNum ${aWin ? 'resultats__scoreNum--win' : ''} ${draw ? 'resultats__scoreNum--draw' : ''}`}>{as_}</span>
                        </div>
                        <span className="resultats__ftBadge">FT</span>
                      </div>

                      {/* Équipe extérieure */}
                      <div className={`resultats__team resultats__team--away ${hWin ? 'resultats__team--loser' : ''}`}>
                        <div className="resultats__crestWrap">
                          {match.awayTeam?.crest
                            ? <img src={match.awayTeam.crest} alt="" className="resultats__crest"
                                onError={e => e.target.style.display = 'none'} />
                            : <span className="resultats__crestFb">{tName(match.awayTeam)[0]}</span>
                          }
                        </div>
                        <span className="resultats__teamName">{tName(match.awayTeam)}</span>
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

      {selectedMatch && (
        <MatchModal
          match={selectedMatch}
          compId={selectedMatch.competition?.id}
          onClose={() => setSelected(null)}
        />
      )}

    </section>
  )
}

export default Resultats
