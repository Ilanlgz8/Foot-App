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

// Étoile de favori — même principe visuel simple qu'ailleurs dans l'app
// (icône outline, remplie quand active). stopPropagation() : la ligne entière
// n'a pas de onClick actuellement, mais StandingsTable est aussi rendue dans
// des contextes cliquables (GroupModal notamment) — mieux vaut être sûr que
// le clic sur l'étoile ne se propage jamais à un parent.
function FavStar({ active, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`classement__favStar${active ? ' classement__favStar--active' : ''}`}
      onClick={e => { e.stopPropagation(); onClick() }}
      disabled={disabled && !active}
      aria-label={active ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      aria-pressed={active}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
      </svg>
    </button>
  )
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
 * @param {boolean}  favoritable      — affiche une étoile de favori par ligne (optionnel)
 * @param {function} isFavorite       — (teamId) => bool, requis si favoritable
 * @param {function} onToggleFavorite — (team) => void, requis si favoritable
 * @param {boolean}  favLimitReached  — désactive l'ajout (pas le retrait) si le plafond est atteint
 * @param {string}   compCode         — code compétition transmis à onToggleFavorite (contexte du favori)
 */
export function StandingsTable({
  rows, compact = false, formMap = {}, qualificationRules = [], snapshotKey = null, snapshotRows = null, isCountry = false,
  favoritable = false, isFavorite = null, onToggleFavorite = null, favLimitReached = false, compCode = null,
}) {
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
            <th>MJ</th>
            <th>Pts</th>
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
            const isFav   = favoritable && isFavorite ? isFavorite(team.team.id) : false

            return (
              <tr
                key={team.team.id}
                className={[
                  'classement__row',
                  topRank ? `classement__row--top${team.position}` : '',
                  isFav ? 'classement__row--favorite' : '',
                ].filter(Boolean).join(' ')}
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
                      {favoritable && (
                        <FavStar
                          active={isFav}
                          disabled={favLimitReached}
                          onClick={() => onToggleFavorite?.({
                            id:        team.team.id,
                            name:      team.team.name,
                            shortName: team.team.shortName,
                            crest:     team.team.crest,
                            compCode,
                          })}
                        />
                      )}
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
                <td>{team.playedGames}</td>
                <td><strong>{team.points}</strong></td>
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
