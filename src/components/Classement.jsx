import { useEffect, useState } from 'react'
import './../classement.css'
import { COMPETITIONS as competitions } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useStandings } from '../hooks/useStandings'
import { useTeamForm } from '../hooks/useTeamForm'

function Classement() {

  const [selectedComp, setSelectedComp] = useState('FL1')

  const { standings, loading, error } = useStandings(selectedComp)

  const { formMap } = useTeamForm(selectedComp)

  const selectedCompetition = competitions.find((c) => c.id === selectedComp)

  const competitionRules = {
    FL1: [
      { label: 'Ligue des champions',     start: 1, end: 3, dotClassName: 'classement__zoneDot classement__zoneDot--ucl',    cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Barrage', start: 4, end: 4, dotClassName: 'classement__zoneDot classement__L1__zoneDot--barrage', cardClassName: 'classement__zoneCard--barrage' },
      { label: 'Europa League',  start: 5, end: 6, dotClassName: 'classement__zoneDot classement__zoneDot--uel',    cardClassName: 'classement__zoneCard--uel' },
      { label: 'Conférence League',   start: 7, end: 7, dotClassName: 'classement__zoneDot classement__zoneDot--uecl',   cardClassName: 'classement__zoneCard--uecl' },
    ],
    SA: [
      { label: 'Ligue des champions',    start: 1, end: 4, dotClassName: 'classement__zoneDot classement__zoneDot--ucl',  cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Europa League', start: 5, end: 6, dotClassName: 'classement__zoneDot classement__zoneDot--uel',  cardClassName: 'classement__zoneCard--uel' },
      { label: 'Conférence League',  start: 7, end: 7, dotClassName: 'classement__zoneDot classement__zoneDot--uecl', cardClassName: 'classement__zoneCard--uecl' },
    ],
    BL1: [
      { label: 'Ligue des champions',    start: 1, end: 4, dotClassName: 'classement__zoneDot classement__zoneDot--ucl',  cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Europa League', start: 5, end: 6, dotClassName: 'classement__zoneDot classement__zoneDot--uel',  cardClassName: 'classement__zoneCard--uel' },
      { label: 'Conférence League',  start: 7, end: 7, dotClassName: 'classement__zoneDot classement__zoneDot--uecl', cardClassName: 'classement__zoneCard--uecl' },
    ],
    CL: [
      { label: 'Qualifié', start: 1, end: 8, dotClassName: 'classement__zoneDot classement__zoneDot--ucl', cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Barrage', start: 9, end: 24, dotClassName: 'classement__zoneDot classement__zoneDot--barrage', cardClassName: 'classement__zoneCard--barrage' },
      { label: 'Éliminé', start: 25, end: 36, dotClassName: 'classement__zoneDot classement__zoneDot--elimine', cardClassName: 'classement__zoneCard--elimine' },
    ],
    default: [
      { label: 'Ligue des champions',    start: 1, end: 5, dotClassName: 'classement__zoneDot classement__zoneDot--ucl',  cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Europa League', start: 6, end: 7, dotClassName: 'classement__zoneDot classement__zoneDot--uel',  cardClassName: 'classement__zoneCard--uel' },
      { label: 'Conférence League',  start: 8, end: 8, dotClassName: 'classement__zoneDot classement__zoneDot--uecl', cardClassName: 'classement__zoneCard--uecl' },
    ],
  }

  function Forme({ results }) {
  if (!results || results.length === 0) return <span style={{ color: '#4b5563', fontSize: '0.75rem' }}>—</span>
  return (
    <div className="classement__forme">
      {results.map((result, i) => (
        <span key={i} className={`classement__formeBadge classement__formeBadge--${result}`}>
          {result === 'W' ? 'V' : result === 'D' ? 'N' : 'D'}
        </span>
      ))}
    </div>
  )
}

  const qualificationRules = competitionRules[selectedComp] ?? competitionRules.default

  const getQualificationZone = (position) =>
    qualificationRules.find((rule) => position >= rule.start && position <= rule.end) ?? null

 
  return (
    <section className="classement">
      <div className="classement__backdrop classement__backdrop--one" />
      <div className="classement__backdrop classement__backdrop--two" />

      <div className="classement__panel">

        {/* Header avec titre + dropdown */}
        <div className="classement__panelHeader">
          <div>
            <p className="classement__panelKicker">Championnat sélectionné</p>
            <h2 className="classement__panelTitle">
              {selectedCompetition?.emblem && (
                <img
                  src={selectedCompetition.emblem}
                  alt=""
                  className="classement__competitionLogo"
                  onError={(e) => e.currentTarget.style.display = 'none'}
                />
              )}
              {selectedCompetition?.name ?? 'Championnat'}
            </h2>
          </div>

          <div className="classement__selectShell">
            <select
              id="competition-select"
              className="classement__select"
              value={selectedComp}
              onChange={(e) => setSelectedComp(e.target.value)}
            >
              {competitions.map((competition) => (
                <option key={competition.id} value={competition.id}>
                  {competition.name}
                </option>
              ))}
            </select>
            <span className="classement__selectIcon" aria-hidden="true" />
          </div>
        </div>

        {/* Légende zones */}
        <div className="classement__zoneStrip">
          {qualificationRules.map((rule) => (
            <div key={rule.label} className={`classement__zoneCard ${rule.cardClassName}`}>
              <span className={rule.dotClassName} />
              <div>
                <strong>{rule.label}</strong>
              </div>
            </div>
          ))}
        </div>

        {/* États */}
        {loading && <p className="classement__state">Chargement du classement...</p>}
        {error && (
                  <p className="classement__state">
                    Classement non disponible pour cette compétition.
                  </p>
        )}

        {/* Tableau */}
        {!loading && !error && standings.length > 0 && (
          <div className="classement__tableWrap">
            <table className="classement__table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>Équipe</th>
                  <th>Points</th>
                  <th>MJ</th>
                  <th>V</th>
                  <th>N</th>
                  <th>D</th>
                  <th>Diff</th>
                  <th>BM</th>
                  <th>Forme</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((team) => {
                  
                  const topRank = team.position <= 3
                  
                  const qualificationZone = getQualificationZone(team.position)

                  return (
                    <tr
                      key={team.team.id}
                      className={topRank ? `classement__row classement__row--top${team.position}` : 'classement__row'}
                    >
                      <td>
                        <span className="classement__position">{team.position}</span>
                      </td>
                      <td>
                        <div className="classement__teamCell">
                          <div className="classement__teamTopLine">
                            {qualificationZone ? (
                              <span className={qualificationZone.dotClassName} aria-hidden="true" />
                            ) : (
                              <span className="classement__zoneDot classement__zoneDot--spacer" aria-hidden="true" />
                            )}
                            <span className="classement__teamName">
                              {translateTeam(team.team.shortName || team.team.name)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td><strong>{team.points}</strong></td>
                      <td>{team.playedGames}</td>
                      <td>{team.won}</td>
                      <td>{team.draw}</td>
                      <td>{team.lost}</td>
                      <td>{team.goalDifference}</td>
                      <td>{team.goalsFor}</td>
                      <td><Forme results={formMap[team.team.id]} /></td>
                    </tr>
                    
                  )
                })}
                
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && standings.length === 0 && (
          <p className="classement__state">Aucune donnée disponible.</p>
        )}

      </div>
    </section>
  )
}

export default Classement
