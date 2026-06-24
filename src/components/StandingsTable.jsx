// Composant partagé — utilisé dans Classement.jsx et MatchModal.jsx (onglet Classement)
import { translateTeam } from '../data/teamNames'

const RESULT_LABEL = { W: 'V', D: 'N', L: 'D' }

function Forme({ results }) {
  if (!results || results.length === 0)
    return <span style={{ color: '#3d4d60', fontSize: '0.75rem' }}>—</span>
  return (
    <div className="classement__forme">
      {results.map((result, i) => (
        <span key={i} className={`classement__formeBadge classement__formeBadge--${result}`}>
          {RESULT_LABEL[result] ?? result}
        </span>
      ))}
    </div>
  )
}

/**
 * @param {object[]} rows             — lignes du classement (FD.org)
 * @param {boolean}  compact          — vue condensée (multi-groupes WC)
 * @param {object}   formMap          — { [teamId]: ['W','D','L',...] } (optionnel)
 * @param {object[]} qualificationRules — règles de zones colorées (optionnel)
 *   Format : [{ start, end, dotClassName }]
 */
export function StandingsTable({ rows, compact = false, formMap = {}, qualificationRules = [] }) {
  const getZone = (position) =>
    qualificationRules.find(r => position >= r.start && position <= r.end) ?? null

  return (
    <div className={`classement__tableWrap${compact ? ' classement__tableWrap--compact' : ''}`}>
      <table className={`classement__table${compact ? ' classement__table--compact' : ''}`}>
        <thead>
          <tr>
            <th>Pos</th>
            <th>Équipe</th>
            <th>Pts</th>
            <th>MJ</th>
            <th>V</th>
            <th>N</th>
            <th>D</th>
            <th>Diff</th>
            {!compact && <th>BM</th>}
            <th>Forme</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((team) => {
            const topRank = team.position <= 3
            const zone    = getZone(team.position)
            const forme   = formMap[team.team.id]
            const formeSlice = compact && forme ? forme.slice(-3) : forme

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
                      {zone
                        ? <span className={zone.dotClassName} aria-hidden="true" />
                        : <span className="classement__zoneDot classement__zoneDot--spacer" aria-hidden="true" />
                      }
                      {team.team.crest && (
                        <img src={team.team.crest} alt="" className="classement__teamCrest"
                          onError={e => e.currentTarget.style.display = 'none'} />
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
                <td>{team.goalDifference > 0 ? `+${team.goalDifference}` : team.goalDifference}</td>
                {!compact && <td>{team.goalsFor}</td>}
                <td><Forme results={formeSlice} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
