import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import './../classement.css'
import { COMPETITIONS as competitions } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useStandings } from '../hooks/useStandings'
import { useTeamForm } from '../hooks/useTeamForm'
import { useScorers } from '../hooks/useScorers'
import { useMatches } from '../hooks/useMatchs'


function Classement() {
  const [selectedComp, setSelectedComp] = useState('WC')
  const [view, setView] = useState('classement') // 'classement' | 'buteurs'

  const { standings, groups, loading, error } = useStandings(selectedComp)
  const { formMap } = useTeamForm(selectedComp)
  const { scorers, loading: scorersLoading, error: scorersError } = useScorers(selectedComp)

  // Pré-chargé au niveau Classement pour éviter le problème de hooks dans composant imbriqué
  // (hooks ne peuvent pas être dans des sous-composants définis dans le même scope)
  const { matches: wcSched, loading: wcSchedLoading } = useMatches('WC', 'SCHEDULED')
  const { matches: wcFin,   loading: wcFinLoading   } = useMatches('WC', 'FINISHED')

  const selectedCompetition = competitions.find((c) => c.id === selectedComp)

  const competitionRules = {
    FL1: [
      { label: 'Ligue des champions', start: 1, end: 3, dotClassName: 'classement__zoneDot classement__zoneDot--ucl',    cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Barrage',             start: 4, end: 4, dotClassName: 'classement__zoneDot classement__L1__zoneDot--barrage', cardClassName: 'classement__zoneCard--barrage' },
      { label: 'Europa League',       start: 5, end: 6, dotClassName: 'classement__zoneDot classement__zoneDot--uel',    cardClassName: 'classement__zoneCard--uel' },
      { label: 'Conférence League',   start: 7, end: 7, dotClassName: 'classement__zoneDot classement__zoneDot--uecl',   cardClassName: 'classement__zoneCard--uecl' },
    ],
    SA: [
      { label: 'Ligue des champions', start: 1, end: 4, dotClassName: 'classement__zoneDot classement__zoneDot--ucl',  cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Europa League',       start: 5, end: 6, dotClassName: 'classement__zoneDot classement__zoneDot--uel',  cardClassName: 'classement__zoneCard--uel' },
      { label: 'Conférence League',   start: 7, end: 7, dotClassName: 'classement__zoneDot classement__zoneDot--uecl', cardClassName: 'classement__zoneCard--uecl' },
    ],
    BL1: [
      { label: 'Ligue des champions', start: 1, end: 4, dotClassName: 'classement__zoneDot classement__zoneDot--ucl',  cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Europa League',       start: 5, end: 6, dotClassName: 'classement__zoneDot classement__zoneDot--uel',  cardClassName: 'classement__zoneCard--uel' },
      { label: 'Conférence League',   start: 7, end: 7, dotClassName: 'classement__zoneDot classement__zoneDot--uecl', cardClassName: 'classement__zoneCard--uecl' },
    ],
    CL: [
      { label: 'Qualifié', start: 1, end: 8,  dotClassName: 'classement__zoneDot classement__zoneDot--ucl',     cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Barrage',  start: 9, end: 24, dotClassName: 'classement__zoneDot classement__zoneDot--barrage', cardClassName: 'classement__zoneCard--barrage' },
      { label: 'Éliminé',  start: 25,end: 36, dotClassName: 'classement__zoneDot classement__zoneDot--elimine', cardClassName: 'classement__zoneCard--elimine' },
    ],
    WC: [
      { label: 'Qualifié (2 premières)', start: 1, end: 2, dotClassName: 'classement__zoneDot classement__zoneDot--ucl',    cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Éliminé',                start: 3, end: 4, dotClassName: 'classement__zoneDot classement__zoneDot--elimine', cardClassName: 'classement__zoneCard--elimine' },
    ],
    default: [
      { label: 'Ligue des champions', start: 1, end: 5, dotClassName: 'classement__zoneDot classement__zoneDot--ucl',  cardClassName: 'classement__zoneCard--ucl' },
      { label: 'Europa League',       start: 6, end: 7, dotClassName: 'classement__zoneDot classement__zoneDot--uel',  cardClassName: 'classement__zoneCard--uel' },
      { label: 'Conférence League',   start: 8, end: 8, dotClassName: 'classement__zoneDot classement__zoneDot--uecl', cardClassName: 'classement__zoneCard--uecl' },
    ],
  }

  // Traduction des codes API (W/D/L) vers le français (V/N/D)
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

  /* Formate "GROUP_A" → "Groupe A" */
  const formatGroupName = (raw = '') =>
    raw.replace('GROUP_', 'Groupe ')

  const qualificationRules = competitionRules[selectedComp] ?? competitionRules.default
  const getQualificationZone = (position) =>
    qualificationRules.find(r => position >= r.start && position <= r.end) ?? null

  /* Tableau générique — compact=true pour la vue multi-groupes WC */
  function StandingsTable({ rows, compact = false }) {
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
              const topRank           = team.position <= 3
              const qualificationZone = getQualificationZone(team.position)
              const forme             = formMap[team.team.id]
              // En compact : garder seulement les 3 derniers matchs
              const formeSlice        = compact && forme ? forme.slice(-3) : forme

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
                        {qualificationZone
                          ? <span className={qualificationZone.dotClassName} aria-hidden="true" />
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

  /* Modal groupe — rendue via createPortal pour échapper au overflow:hidden */
  function GroupModal({ group, onClose, schedMatches, finMatches, loadingM }) {
    const [tab, setTab] = useState('classement') // 'classement' | 'programme' | 'resultats'

    useEffect(() => {
      const handler = e => { if (e.key === 'Escape') onClose() }
      window.addEventListener('keydown', handler)
      const scrollY = window.scrollY
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY}px`
      document.body.style.left = '0'
      document.body.style.right = '0'
      return () => {
        window.removeEventListener('keydown', handler)
        document.body.style.overflow = ''
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.left = ''
        document.body.style.right = ''
        window.scrollTo(0, scrollY)
      }
    }, [onClose])

    // standings: "Group A" / matches: "GROUP_A" → normaliser pour comparer
    const normGroup = g => (g ?? '').toUpperCase().replace(/\s+/g, '_')
    const gn = normGroup(group.name)
    const upcoming = schedMatches.filter(m => normGroup(m.group) === gn && ['SCHEDULED','TIMED','IN_PLAY','PAUSED'].includes(m.status))
    const finished = finMatches.filter(m => normGroup(m.group) === gn)

    function formatDate(utcDate) {
      if (!utcDate) return ''
      const d = new Date(utcDate)
      return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
    }
    function formatTime(utcDate) {
      if (!utcDate) return ''
      return new Date(utcDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    }

    function MatchRow({ m, showScore }) {
      const hn  = translateTeam(m.homeTeam?.shortName || m.homeTeam?.name || '?')
      const an  = translateTeam(m.awayTeam?.shortName || m.awayTeam?.name || '?')
      const sh  = m.score?.fullTime?.home ?? m.score?.halfTime?.home
      const sa  = m.score?.fullTime?.away ?? m.score?.halfTime?.away
      const live = ['IN_PLAY','PAUSED'].includes(m.status)
      const isFinished = m.status === 'FINISHED'
      const homeWin = isFinished && sh != null && sh > sa
      const awayWin = isFinished && sa != null && sa > sh

      const label = live ? (m.minute ? `${m.minute}'` : 'LIVE')
                  : isFinished ? 'FT'
                  : formatDate(m.utcDate)

      const value = (showScore || live) && sh != null
        ? `${sh} – ${sa}`
        : formatTime(m.utcDate)

      return (
        <div className={`accueil__matchCard${live ? ' accueil__matchCard--live' : ''}`}>
          {/* Équipe domicile */}
          <div className="accueil__matchCardTeam">
            <div className="accueil__matchCardCrestWrap">
              {m.homeTeam?.crest
                ? <img src={m.homeTeam.crest} alt="" className="accueil__matchCardCrest" />
                : <div className="accueil__matchCardCrestEmpty" />}
            </div>
            <span className="accueil__matchCardName">{hn}</span>
          </div>

          {/* Centre */}
          <div className="accueil__matchCardCenter">
            <div className="accueil__matchCardLabelRow">
              {live && <span className="accueil__matchCardLiveDot" />}
              <span className={`accueil__matchCardLabel${live ? ' accueil__matchCardLabel--live' : ''}`}>{label}</span>
            </div>
            <span className={`accueil__matchCardValue${live ? ' accueil__matchCardValue--live' : ''}`}>{value}</span>
          </div>

          {/* Équipe extérieur */}
          <div className="accueil__matchCardTeam accueil__matchCardTeam--away">
            <div className="accueil__matchCardCrestWrap">
              {m.awayTeam?.crest
                ? <img src={m.awayTeam.crest} alt="" className="accueil__matchCardCrest" />
                : <div className="accueil__matchCardCrestEmpty" />}
            </div>
            <span className="accueil__matchCardName">{an}</span>
          </div>
        </div>
      )
    }

    function MatchList({ list, showScore, empty }) {
      if (loadingM) return <div className="gm__loading">Chargement…</div>
      if (!list.length) return <div className="gm__empty">{empty}</div>
      return <div className="accueil__matchCards">{list.map(m => <MatchRow key={m.id} m={m} showScore={showScore} />)}</div>
    }

    return createPortal(
      <div className="classement__modalOverlay" onClick={onClose}>
        <div className="classement__modalBox classement__modalBox--tabs" onClick={e => e.stopPropagation()}>
          <div className="classement__modalHeader">
            <h3 className="classement__modalTitle">{formatGroupName(group.name)}</h3>
            <button className="classement__modalClose" onClick={onClose} aria-label="Fermer">✕</button>
          </div>

          {/* Onglets */}
          <div className="gm__tabs">
            {[['classement','Classement'],['programme','Programme'],['resultats','Résultats']].map(([id, label]) => (
              <button
                key={id}
                className={`gm__tab${tab === id ? ' gm__tab--active' : ''}`}
                onClick={() => setTab(id)}
              >{label}</button>
            ))}
          </div>

          {/* Contenu */}
          <div className="gm__body">
            {tab === 'classement' && <StandingsTable rows={group.table} compact={false} />}

            {tab === 'programme'  && (
              <MatchList
                list={upcoming}
                showScore={false}
                empty="Aucun match à venir dans ce groupe."
              />
            )}
            {tab === 'resultats'  && (
              <MatchList
                list={[...finished].reverse()}
                showScore={true}
                empty="Aucun résultat disponible pour ce groupe."
              />
            )}
          </div>
        </div>
      </div>,
      document.body
    )
  }

  /* Affichage multi-groupes (CdM, etc.) */
  function MultiGroupView() {
    const [selectedGroup, setSelectedGroup] = useState(null)

    return (
      <>
        <div className="classement__groups">
          {groups.map(group => (
            <div
              key={group.name}
              className="classement__groupBlock classement__groupBlock--clickable"
              onClick={() => setSelectedGroup(group)}
              title="Voir le groupe en détail"
            >
              <div className="classement__groupHeader">
                <h3 className="classement__groupTitle">{formatGroupName(group.name)}</h3>
                <span className="classement__groupExpandHint">↗</span>
              </div>
              <StandingsTable rows={group.table} compact />
            </div>
          ))}
        </div>
        {selectedGroup && (
          <GroupModal
            group={selectedGroup}
            onClose={() => setSelectedGroup(null)}
            schedMatches={wcSched}
            finMatches={wcFin}
            loadingM={wcSchedLoading || wcFinLoading}
          />
        )}
      </>
    )
  }

  const isMultiGroup = groups.length > 1

  return (
    <section className="classement">
      <div className="classement__backdrop classement__backdrop--one" />
      <div className="classement__backdrop classement__backdrop--two" />

      <div className="classement__layout">

        {/* Sidebar */}
        <aside className="classement__sidebar">
          <p className="classement__sidebarLabel">Championnats</p>
          <nav className="classement__sidebarNav">
            {competitions.map(comp => (
              <button
                key={comp.id}
                onClick={() => setSelectedComp(comp.id)}
                className={`classement__sidebarItem ${selectedComp === comp.id ? 'classement__sidebarItem--active' : ''}`}
              >
                <img src={comp.emblem} alt=""
                  className="classement__sidebarLogo"
                  onError={e => e.currentTarget.style.display = 'none'} />
                <span className="classement__sidebarName classement__sidebarName--full">{comp.name}</span>
                <span className="classement__sidebarName classement__sidebarName--short">{comp.shortName ?? comp.name}</span>
                {selectedComp === comp.id && <span className="classement__sidebarDot" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Contenu principal */}
        <main className="classement__main">
      <div className="classement__panel">

        {/* Header */}
        <div className="classement__panelHeader">
          <div>
            <p className="classement__panelKicker">Compétition sélectionnée</p>
            <h2 className="classement__panelTitle">
              {selectedCompetition?.emblem && (
                <img
                  src={selectedCompetition.emblem}
                  alt=""
                  className="classement__competitionLogo"
                  onError={e => e.currentTarget.style.display = 'none'}
                />
              )}
              {selectedCompetition?.name ?? 'Championnat'}
            </h2>
          </div>

          {/* Toggle classement / buteurs */}
          <div className="classement__viewToggle">
            <button
              className={`classement__viewBtn ${view === 'classement' ? 'classement__viewBtn--active' : ''}`}
              onClick={() => setView('classement')}
            >
              Classement
            </button>
            <button
              className={`classement__viewBtn ${view === 'buteurs' ? 'classement__viewBtn--active' : ''}`}
              onClick={() => setView('buteurs')}
            >
              Buteurs
            </button>
          </div>
        </div>

        {/* Légende zones */}
        {view === 'classement' && (
          <div className="classement__zoneStrip">
            {qualificationRules.map(rule => (
              <div key={rule.label} className={`classement__zoneCard ${rule.cardClassName}`}>
                <span className={rule.dotClassName} />
                <strong>{rule.label}</strong>
              </div>
            ))}
          </div>
        )}

        {/* ── Vue Buteurs ── */}
        {view === 'buteurs' && (
          <>
            {scorersLoading && (
              <div className="classement__scorersList">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="classement__scorerRow" style={{ pointerEvents: 'none' }}>
                    <div className="sk" style={{ width: '1.1rem', height: '1.1rem', margin: '0 auto' }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: 1 }}>
                      <div className="sk" style={{ width: `${6 + (i % 3)}rem`, height: '0.85rem' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <div className="sk" style={{ width: '1.1rem', height: '1.1rem', borderRadius: '50%' }} />
                        <div className="sk" style={{ width: '4rem', height: '0.65rem' }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <div className="sk" style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.5rem' }} />
                      <div className="sk" style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.5rem' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {scorersError && <p className="classement__state">Données non disponibles.</p>}
            {!scorersLoading && !scorersError && scorers.length === 0 && (
              <p className="classement__state">Aucun buteur disponible.</p>
            )}
            {!scorersLoading && !scorersError && scorers.length > 0 && (
              <div className="classement__scorersList">
                {scorers.map((s, i) => {
                  const playerName = s.player?.name ?? '?'
                  const initials   = playerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
                  const hue        = (playerName.charCodeAt(0) * 37 + (playerName.charCodeAt(1) || 0) * 13) % 360
                  const isTop3     = i < 3

                  return (
                    <div
                      key={s.player?.id ?? i}
                      className={`classement__scorerRow ${isTop3 ? `classement__scorerRow--top${i + 1}` : ''}`}
                    >
                      {/* Rang */}
                      <div className="classement__scorerRankWrap">
                        <span className="classement__scorerRank">{i + 1}</span>
                      </div>

                      {/* Avatar initiales */}
                      <div className="classement__scorerAvatar" style={{ '--av-hue': hue }}>
                        {initials}
                      </div>

                      {/* Nom + équipe */}
                      <div className="classement__scorerInfo">
                        <span className="classement__scorerName">{playerName}</span>
                        <div className="classement__scorerTeamRow">
                          {s.team?.crest && (
                            <img src={s.team.crest} alt="" className="classement__scorerCrest"
                              onError={e => e.currentTarget.style.display = 'none'} />
                          )}
                          <span className="classement__scorerTeam">
                            {translateTeam(s.team?.shortName || s.team?.name || '')}
                          </span>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="classement__scorerStats">
                        <div className="classement__scorerStatItem classement__scorerStatItem--goals">
                          <span className="classement__scorerGoals">{s.goals ?? 0}</span>
                          <span className="classement__scorerStatLabel">G</span>
                        </div>
                        <div className="classement__scorerStatItem classement__scorerStatItem--assists">
                          <span className="classement__scorerAssists">{s.assists ?? '—'}</span>
                          <span className="classement__scorerStatLabel">A</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Skeleton classement */}
        {view === 'classement' && loading && (
          <div className="classement__tableWrap">
            <table className="classement__table">
              <thead>
                <tr>
                  <th>Pos</th><th>Équipe</th><th>Pts</th><th>MJ</th>
                  <th>V</th><th>N</th><th>D</th><th>Diff</th><th>BM</th><th>Forme</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="classement__row">
                    <td><div className="sk" style={{ width: '1.2rem', height: '0.8rem' }} /></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div className="sk" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%', flexShrink: 0 }} />
                        <div className="sk" style={{ width: `${5 + (i % 3)}rem`, height: '0.8rem' }} />
                      </div>
                    </td>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j}><div className="sk" style={{ width: '1.5rem', height: '0.8rem', margin: '0 auto' }} /></td>
                    ))}
                    <td>
                      <div style={{ display: 'flex', gap: '0.2rem' }}>
                        {Array.from({ length: 5 }).map((_, k) => (
                          <div key={k} className="sk" style={{ width: '1.35rem', height: '1.35rem', borderRadius: '0.3rem' }} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === 'classement' && error && (
          <p className="classement__state">Classement non disponible pour cette compétition.</p>
        )}

        {/* Tableau(x) */}
        {view === 'classement' && !loading && !error && standings.length > 0 && (
          isMultiGroup ? <MultiGroupView /> : <StandingsTable rows={standings} />
        )}

        {view === 'classement' && !loading && !error && standings.length === 0 && (
          <p className="classement__state">Aucune donnée disponible.</p>
        )}

      </div>
        </main>
      </div>
    </section>
  )
}

export default Classement
