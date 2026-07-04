// Composant partagé — utilisé dans Classement.jsx et MatchModal.jsx (onglet Classement)
import { useEffect, useMemo } from 'react'
import { translateTeam } from '../data/teamNames'
// Le CSS (classement__*, y compris les tableaux de poules CdM) doit être chargé ici,
// pas seulement dans Classement.jsx : sinon, tant que la page /classement n'a pas été
// visitée au moins une fois (chunk lazy pas encore chargé), l'onglet Classement de
// MatchPage/LiveMatchPage/ResultatPage (via MatchModal → StandingsTable) s'affiche
// sans style — d'où le besoin de "d'abord aller sur Classement" pour "activer" le CSS.
import '../classement.css'

const RESULT_LABEL = { W: 'V', D: 'N', L: 'D' }

// Flèche verte (monté), rouge (descendu) ou barre grise (stable / pas de donnée
// de comparaison) par rapport à la dernière visite — comparaison faite via un
// instantané localStorage (voir useStandingsSnapshot ci-dessous).
function RankChange({ delta }) {
  if (delta > 0) return <span className="classement__rankChange classement__rankChange--up" title={`+${delta}`}>▲</span>
  if (delta < 0) return <span className="classement__rankChange classement__rankChange--down" title={delta}>▼</span>
  return <span className="classement__rankChange classement__rankChange--flat" aria-hidden="true" />
}

// Lit l'instantané des positions (par équipe) enregistré lors de la dernière
// visite sous `snapshotKey`, puis écrit le nouvel instantané (`snapshotRows`,
// toujours la liste COMPLÈTE non filtrée par la recherche — sinon une
// recherche active écraserait le snapshot avec seulement les équipes visibles).
// La lecture (useMemo) ne se relance que si `snapshotKey` change, donc la
// comparaison reste stable face à la donnée "avant cette session".
function useStandingsSnapshot(snapshotKey, snapshotRows) {
  const prevSnapshot = useMemo(() => {
    if (!snapshotKey) return {}
    try {
      const raw = localStorage.getItem(snapshotKey)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }, [snapshotKey])

  useEffect(() => {
    if (!snapshotKey || !snapshotRows?.length) return
    const snap = {}
    snapshotRows.forEach(r => { snap[r.team.id] = r.position })
    try { localStorage.setItem(snapshotKey, JSON.stringify(snap)) } catch {}
  }, [snapshotKey, snapshotRows])

  return prevSnapshot
}

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
 * @param {boolean}  isCountry        — true si équipes NATIONALES (drapeaux,
 *   cercle) plutôt que clubs (écussons, pas de cercle forcé) — voir index.css
 */
export function StandingsTable({ rows, compact = false, formMap = {}, qualificationRules = [], snapshotKey = null, snapshotRows = null, isCountry = false }) {
  const getZone = (position) =>
    qualificationRules.find(r => position >= r.start && position <= r.end) ?? null

  const prevSnapshot = useStandingsSnapshot(snapshotKey, snapshotRows ?? rows)

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
            const prevPos = prevSnapshot[team.team.id]
            const delta   = (snapshotKey && prevPos != null) ? prevPos - team.position : 0

            return (
              <tr
                key={team.team.id}
                className={topRank ? `classement__row classement__row--top${team.position}` : 'classement__row'}
              >
                <td>
                  <div className="classement__positionWrap">
                    <span className="classement__position">{team.position}</span>
                    {snapshotKey && <RankChange delta={delta} />}
                  </div>
                </td>
                <td>
                  <div className="classement__teamCell">
                    <div className="classement__teamTopLine">
                      {zone
                        ? <span className={zone.dotClassName} aria-hidden="true" />
                        : <span className="classement__zoneDot classement__zoneDot--spacer" aria-hidden="true" />
                      }
                      {team.team.crest && (
                        <div className="classement__teamCrestWrap" data-crest={isCountry ? 'country' : 'club'}><img src={team.team.crest} alt="" loading="lazy" className="classement__teamCrest" data-team={team.team.name}
                          onError={e => e.currentTarget.style.display = 'none'} /></div>
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
