import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import './../match.css'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useMatches } from '../hooks/useMatchs'
import { useWcKnockout } from '../hooks/useWcKnockout'
import { useTeamForm } from '../hooks/useTeamForm'
import { calcMinute } from '../utils/matchUtils'
import { calcProno } from '../utils/calcProno'
import MatchModal from './MatchModal'

/* ═══════════════════════════════════════════════════════════════
   BRACKET SVG VIEW — layout mathématique pur, zéro DOM query
   Les positions sont calculées depuis des constantes fixes.
   Défini AU NIVEAU MODULE pour éviter tout remount inutile.
   ═══════════════════════════════════════════════════════════════ */
const BK_CARD_W = 200   // largeur d'une card (px)
const BK_CARD_H = 110   // hauteur fixe d'une card (px)
const BK_SLOT_H = 138   // hauteur de slot = card + marge verticale
const BK_CONN_W = 56    // largeur de la zone connecteur entre rounds
const BK_HDR_H  = 40    // hauteur de l'en-tête de round (titre)

const _fmtH = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })
const _fmtD = (d) => {
  const today    = new Date(); today.setHours(0,0,0,0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const date     = new Date(d); date.setHours(0,0,0,0)
  if (date.getTime() === today.getTime())    return `Aujourd'hui`
  if (date.getTime() === tomorrow.getTime()) return `Demain`
  return new Date(d).toLocaleDateString('fr-FR', { weekday:'short', day:'2-digit', month:'short' })
}
const _name = (t) => t?.name ? translateTeam(t.shortName || t.name) : 'À venir'

function BkCard({ m, style, onSelect }) {
  const fin  = m.status === 'FINISHED'
  const live = m.status === 'IN_PLAY' || m.status === 'PAUSED'
  const tbd  = !m.homeTeam?.name && !m.awayTeam?.name
  const hs   = m.score?.fullTime?.home
  const as_  = m.score?.fullTime?.away
  const hW   = fin && hs > as_
  const aW   = fin && as_ > hs

  return (
    <div
      className={`bracket__card ${live ? 'bracket__card--live' : ''}`}
      style={{ ...style, height: BK_CARD_H, display:'flex', flexDirection:'column' }}
      onClick={() => !tbd && onSelect(m)}
    >
      <div className={`bracket__team ${hW?'bracket__team--winner':''} ${aW?'bracket__team--loser':''}`}>
        <div className="bracket__teamInfo">
          {m.homeTeam?.crest
            ? <img src={m.homeTeam.crest} alt="" className="bracket__crest" onError={e=>{e.currentTarget.style.display='none'}}/>
            : <span className="bracket__crestTbd">?</span>}
          <span className="bracket__teamName">{_name(m.homeTeam)}</span>
        </div>
        {(fin||live) && <span className={`bracket__score ${hW?'bracket__score--win':''}`}>{hs??0}</span>}
      </div>

      <div className="bracket__sep" style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
        {live && <span className="bracket__live">● {calcMinute(m) ?? 'Live'}</span>}
        {!fin && !live && !tbd && (
          <span className="bracket__time">
            <span className="bracket__timeDate">{_fmtD(m.utcDate)}</span>
            <span className="bracket__timeHour">{_fmtH(m.utcDate)}</span>
          </span>
        )}
        {tbd && <span className="bracket__vs">vs</span>}
      </div>

      <div className={`bracket__team ${aW?'bracket__team--winner':''} ${hW?'bracket__team--loser':''}`}>
        <div className="bracket__teamInfo">
          {m.awayTeam?.crest
            ? <img src={m.awayTeam.crest} alt="" className="bracket__crest" onError={e=>{e.currentTarget.style.display='none'}}/>
            : <span className="bracket__crestTbd">?</span>}
          <span className="bracket__teamName">{_name(m.awayTeam)}</span>
        </div>
        {(fin||live) && <span className={`bracket__score ${aW?'bracket__score--win':''}`}>{as_??0}</span>}
      </div>
    </div>
  )
}

function BracketSvgView({ rounds, onSelect }) {
  if (!rounds?.length) return null

  // THIRD_PLACE casse l'alignement → on le sépare du bracket principal
  const main  = rounds.filter(r => r.stage !== 'THIRD_PLACE')
  const third = rounds.find(r => r.stage === 'THIRD_PLACE')

  if (!main.length) return null

  const firstN  = main[0].matches.length
  const GRID_H  = firstN * BK_SLOT_H
  const TOTAL_H = BK_HDR_H + GRID_H
  const TOTAL_W = main.length * BK_CARD_W + Math.max(0, main.length - 1) * BK_CONN_W

  // X gauche d'un round
  const rX = (ri) => ri * (BK_CARD_W + BK_CONN_W)

  // Centre Y d'un match dans sa grille (y absolu depuis le haut du conteneur)
  const mCY = (ri, mi) => {
    const n = main[ri].matches.length
    return BK_HDR_H + GRID_H / n * (mi + 0.5)
  }

  // ── Chemins SVG ──
  // Pour chaque paire (mi, mi+1) du round ri, on trace :
  //   stub droit M1 → midX, trait vertical M1cy→M2cy, stub droit M2 → midX,
  //   puis trait horizontal midX → card suivante (midpoint vertical)
  const svgPaths = []
  for (let ri = 0; ri < main.length - 1; ri++) {
    const curr = main[ri]
    for (let mi = 0; mi + 1 < curr.matches.length; mi += 2) {
      const y1   = mCY(ri, mi)
      const y2   = mCY(ri, mi + 1)
      const yN   = mCY(ri + 1, Math.floor(mi / 2))
      const x1   = rX(ri) + BK_CARD_W          // bord droit du round courant
      const x2   = rX(ri + 1)                   // bord gauche du round suivant
      const xMid = (x1 + x2) / 2
      const yMid = (y1 + y2) / 2

      svgPaths.push(
        /* stub M1 → midX + vertical M1→M2 */ `M ${x1} ${y1} H ${xMid} V ${y2} ` +
        /* stub M2 → midX                  */ `M ${x1} ${y2} H ${xMid} ` +
        /* sortie midpoint → card suivante */ `M ${xMid} ${yMid} H ${x2}`
      )
    }
  }

  return (
    <div className="bracket__svgWrap">
      {/* ── Tableau principal ── */}
      <div style={{ position:'relative', width:TOTAL_W, height:TOTAL_H, minWidth:TOTAL_W }}>

        {/* Traits SVG */}
        <svg
          style={{ position:'absolute', top:0, left:0, width:TOTAL_W, height:TOTAL_H,
                   overflow:'visible', pointerEvents:'none', zIndex:0 }}
        >
          {svgPaths.map((d, i) => (
            <path key={i} d={d} fill="none"
              stroke="rgba(239,68,68,0.45)" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"
            />
          ))}
        </svg>

        {/* Titres des rounds */}
        {main.map((round, ri) => (
          <div key={`hdr-${round.stage}`} style={{
            position:'absolute', left:rX(ri), top:0,
            width:BK_CARD_W, height:BK_HDR_H,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <span className="bracket__roundTitle">{round.label}</span>
          </div>
        ))}

        {/* Cards absolument positionnées */}
        {main.map((round, ri) =>
          round.matches.map((m, mi) => {
            const n       = round.matches.length
            const slotH   = GRID_H / n
            const cardTop = BK_HDR_H + slotH * mi + (slotH - BK_CARD_H) / 2
            return (
              <BkCard key={m.id} m={m} onSelect={onSelect}
                style={{ position:'absolute', left:rX(ri), top:cardTop, width:BK_CARD_W, zIndex:1 }}
              />
            )
          })
        )}
      </div>

    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════ */

function Matchs() {
  /* ── State ── */
  const [selectedComp,  setSelectedComp]  = useState('WC')
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [currentIndex,  setCurrentIndex]  = useState(0)
  const [wcView,        setWcView]        = useState('poules') // 'poules' | 'bracket' | 'matchs'
  const [openedGroup,   setOpenedGroup]   = useState(null)

  /* ── Data ── */
  const { matches, loading, error, grouped } = useMatches(selectedComp, 'SCHEDULED', 'asc')
  const { formMap } = useTeamForm(selectedComp)
  const { rounds, loading: bracketLoading, error: bracketError } = useWcKnockout()

  const currentComp = COMPETITIONS.find(c => c.id === selectedComp)
  const isWC        = selectedComp === 'WC'

  /* ── Ticker pour calcMinute() — bracket live ── */
  const [, setTick] = useState(0)
  const hasLiveRound = (rounds ?? []).some(r =>
    r.matches?.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')
  )
  useEffect(() => {
    if (!hasLiveRound) return
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [hasLiveRound])

  /* ── Groupes CdM (uniquement GROUP_X, pas les stades) ── */
  const wcGroups = useMemo(() => {
    if (!isWC) return []

    const seen = new Set()
    const groups = []

    for (const m of matches) {
      const g = m.group ?? null  // on n'utilise PAS m.stage ici
      if (g && g.startsWith('GROUP_') && !seen.has(g)) {
        seen.add(g)
        groups.push(g)
      }
    }

    return groups.sort()
  }, [matches, isWC])

  const matchesByGroup = useMemo(() => {
    const map = new Map()
    for (const g of wcGroups) map.set(g, [])
    for (const m of matches) {
      const g = m.group ?? null
      if (g && map.has(g)) map.get(g).push(m)
    }
    return map
  }, [matches, wcGroups])

  const groupTeams = (groupMatches) => {
    const seen = new Set()
    const teams = []

    for (const m of groupMatches) {
      if (!seen.has(m.homeTeam.id)) {
        seen.add(m.homeTeam.id)
        teams.push(m.homeTeam)
      }
      if (!seen.has(m.awayTeam.id)) {
        seen.add(m.awayTeam.id)
        teams.push(m.awayTeam)
      }
    }

    return teams
  }

  /* Auto-switch : si des matchs existent mais aucun groupe détecté → vue par journée */
  useEffect(() => {
    if (isWC && wcView === 'poules' && !loading && matches.length > 0 && wcGroups.length === 0) {
      setWcView('matchs')
      setCurrentIndex(0)
    }
  }, [isWC, wcView, loading, matches.length, wcGroups.length])

  /* Pour "matchs à venir" WC en vue par journée : on ne montre que les TIMED/SCHEDULED/live */
  const filteredGrouped = useMemo(() => {
    if (!isWC || wcView !== 'matchs') return grouped
    return grouped.map(([day, dayMatches]) => [
      day,
      dayMatches.filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED' || m.status === 'IN_PLAY' || m.status === 'PAUSED')
    ]).filter(([, ms]) => ms.length > 0)
  }, [isWC, wcView, grouped])

  /* Navigation journées */
  const currentGroup    = filteredGrouped[currentIndex]
  const currentMatchday = currentGroup?.[0]
  const currentMatches  = currentGroup?.[1] ?? []
  const total           = filteredGrouped.length

  /* ── Helpers ── */
  const handleSelectComp = (id) => {
    setSelectedComp(id); setCurrentIndex(0); setWcView('poules'); setOpenedGroup(null)
  }

  const formatGroupName = (raw = '') => raw.replace('GROUP_', 'Groupe ').replace(/_/g, ' ')

  const teamName = (team) =>
    team?.name ? translateTeam(team.shortName || team.name) : 'À déterminer'

  /* ── Ligne de match (poules + journée) ── */
  function MatchRow({ match, index, inModal = false }) {
    const isUpcoming = match.status === 'SCHEDULED' || match.status === 'TIMED'
    const hForm = formMap[match.homeTeam?.id]
    const aForm = formMap[match.awayTeam?.id]
    const prono = isUpcoming && (hForm || aForm) ? calcProno(hForm, aForm) : null

    return (
      <div
        className={`matchs__match ${inModal ? 'matchs__match--modal' : ''}`}
        style={{ borderTop: index === 0 ? 'none' : undefined }}
        onClick={() => { if (!isUpcoming) setSelectedMatch(match) }}
      >
        <span className="matchs__scoreDate">{_fmtD(match.utcDate)}</span>
        <div className="matchs__team matchs__team--home">
          {match.homeTeam.crest && (
            <img src={match.homeTeam.crest} alt="" className="matchs__crest"
              onError={e => e.target.style.display = 'none'} />
          )}
          <span className="matchs__teamName">{teamName(match.homeTeam)}</span>
        </div>
        <div className="matchs__score">
          <span className="matchs__scoreHour">{_fmtH(match.utcDate)}</span>
          {prono && (
            <div className="matchs__pronoBar">
              <div className="matchs__pronoSeg matchs__pronoSeg--home" style={{ width: `${prono.home}%` }}>
                {prono.home >= 18 && <span>{prono.home}%</span>}
              </div>
              <div className="matchs__pronoSeg matchs__pronoSeg--draw" style={{ width: `${prono.draw}%` }}>
                {prono.draw >= 14 && <span>{prono.draw}%</span>}
              </div>
              <div className="matchs__pronoSeg matchs__pronoSeg--away" style={{ width: `${prono.away}%` }}>
                {prono.away >= 18 && <span>{prono.away}%</span>}
              </div>
            </div>
          )}
        </div>
        <div className="matchs__team matchs__team--away">
          {match.awayTeam.crest && (
            <img src={match.awayTeam.crest} alt="" className="matchs__crest"
              onError={e => e.target.style.display = 'none'} />
          )}
          <span className="matchs__teamName">{teamName(match.awayTeam)}</span>
        </div>
      </div>
    )
  }

  /* ── Modal poule ── */
  function GroupModal({ groupKey, onClose }) {
    const allGroupMatches = matchesByGroup.get(groupKey) ?? []
    // Dans "matchs à venir" : seulement les matchs pas encore joués
    const groupMatches = allGroupMatches.filter(m =>
      m.status === 'TIMED' || m.status === 'SCHEDULED' ||
      m.status === 'IN_PLAY' || m.status === 'PAUSED'
    )

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

    return createPortal(
      <div className="wcModal__overlay" onClick={onClose}>
        <div className="wcModal__panel" onClick={e => e.stopPropagation()}>
          <div className="wcModal__topBar" />
          <div className="wcModal__header">
            <div className="wcModal__titleRow">
              <h2 className="wcModal__title">{formatGroupName(groupKey)}</h2>
              <span className="wcModal__count">{groupMatches.length} match{groupMatches.length > 1 ? 's' : ''}</span>
            </div>
            <button className="wcModal__close" onClick={onClose}>✕</button>
          </div>
          <div className="wcModal__body">
            {groupMatches.length === 0
              ? <p className="matchs__noMatch">Aucun match à venir dans ce groupe.</p>
              : groupMatches.map((m, i) => <MatchRow key={m.id} match={m} index={i} inModal />)
            }
          </div>
        </div>
      </div>,
      document.body
    )
  }

  /* ── Rendu ── */
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
              <button key={comp.id}
                onClick={() => handleSelectComp(comp.id)}
                className={`matchs__sidebarItem ${selectedComp === comp.id ? 'matchs__sidebarItem--active' : ''}`}
              >
                <img src={comp.emblem} alt=""
                  className="matchs__competitionLogo matchs__competitionLogo--sidebar"
                  onError={e => e.currentTarget.style.display = 'none'} />
                <span className="matchs__sidebarName matchs__sidebarName--full">{comp.name}</span>
                <span className="matchs__sidebarName matchs__sidebarName--short">{comp.shortName ?? comp.name}</span>
                {selectedComp === comp.id && <span className="matchs__sidebarDot" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Contenu principal */}
        <main className="matchs__main">

          {/* Header */}
          <div className="matchs__header">
            <p className="matchs__kicker">Matchs à venir</p>
            <div className="matchs__headerRow">
              <h1 className="matchs__title">
                {currentComp?.emblem && (
                  <img src={currentComp.emblem} alt=""
                    className="matchs__competitionLogo matchs__competitionLogo--title"
                    onError={e => e.currentTarget.style.display = 'none'} />
                )}
                {currentComp?.name}
              </h1>

              {/* Toggle vues CdM */}
              {isWC && (
                <div className="matchs__wcToggle">
                  {/* ── Poules : terrain de foot vu du dessus ── */}
                  <button
                    className={`matchs__wcToggleBtn ${wcView === 'poules' ? 'matchs__wcToggleBtn--active' : ''}`}
                    onClick={() => setWcView('poules')}
                  >
                    <svg className="matchs__wcToggleIcon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Terrain */}
                      <rect x="1.5" y="3" width="21" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity=".07"/>
                      {/* Ligne mi-terrain */}
                      <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1.5 1"/>
                      {/* Cercle central */}
                      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                      {/* Point central */}
                      <circle cx="12" cy="12" r="0.8" fill="currentColor"/>
                      {/* Surface de réparation gauche */}
                      <rect x="1.5" y="7.5" width="4.5" height="9" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                      {/* Surface de réparation droite */}
                      <rect x="18" y="7.5" width="4.5" height="9" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                    </svg>
                    Poules
                  </button>

                  {/* ── Par journée : liste de matchs ── */}
                  <button
                    className={`matchs__wcToggleBtn ${wcView === 'matchs' ? 'matchs__wcToggleBtn--active' : ''}`}
                    onClick={() => { setWcView('matchs'); setCurrentIndex(0) }}
                  >
                    <svg className="matchs__wcToggleIcon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Fond carte */}
                      <rect x="2" y="3" width="20" height="18" rx="2.5" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="1.5"/>
                      {/* Header coloré */}
                      <rect x="2" y="3" width="20" height="5" rx="2.5" fill="currentColor" fillOpacity=".3"/>
                      {/* Lignes de match */}
                      <rect x="5" y="11.5" width="14" height="2" rx="1" fill="currentColor" opacity=".7"/>
                      <rect x="5" y="15.5" width="10" height="2" rx="1" fill="currentColor" opacity=".45"/>
                      {/* Numéro journée */}
                      <text x="12" y="7.2" textAnchor="middle" fontSize="3.5" fontWeight="bold" fill="currentColor" opacity=".9">J·12</text>
                    </svg>
                    Par journée
                  </button>

                  {/* ── Phase finale : arbre de tournoi ── */}
                  <button
                    className={`matchs__wcToggleBtn ${wcView === 'bracket' ? 'matchs__wcToggleBtn--active' : ''}`}
                    onClick={() => setWcView('bracket')}
                  >
                    <svg className="matchs__wcToggleIcon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Matchs 1er tour */}
                      <rect x="1" y="2.5" width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".9"/>
                      <rect x="1" y="7"   width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".9"/>
                      <rect x="1" y="14"  width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".9"/>
                      <rect x="1" y="18.5" width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".9"/>
                      {/* Connecteurs gauche */}
                      <path d="M6.5 3.75 H8.5 V8.25 H6.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
                      <path d="M6.5 15.25 H8.5 V19.75 H6.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
                      {/* Demi-finales */}
                      <rect x="9" y="5.25" width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".75"/>
                      <rect x="9" y="16.25" width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".75"/>
                      {/* Connecteur centre */}
                      <path d="M14.5 6.5 H16.5 V17.5 H14.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
                      {/* Finale */}
                      <rect x="17" y="10.75" width="6" height="2.5" rx="0.8" fill="currentColor" opacity=".6"/>
                    </svg>
                    Phase finale
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ═══ Vue Poules ═══ */}
          {!loading && !error && isWC && wcView === 'poules' && (
            <>
              {loading && (
                <div className="matchs__state"><div className="matchs__spinner" /><p>Chargement...</p></div>
              )}
              {wcGroups.length > 0 && (
                <div className="matchs__wcBoard">
                  {wcGroups.map(g => {
                    const gMatches = matchesByGroup.get(g) ?? []
                    const teams    = groupTeams(gMatches)
                    const letter   = g.replace('GROUP_', '')
                    return (
                      <button key={g} className="matchs__wcGroupCard" onClick={() => setOpenedGroup(g)}>
                        <div className="matchs__wcGroupCard__top">
                          <span className="matchs__wcGroupCard__label">Groupe</span>
                          <span className="matchs__wcGroupCard__name">{letter}</span>
                        </div>
                        <ul className="matchs__wcGroupCard__teams">
                          {teams.map(t => (
                            <li key={t.id} className="matchs__wcGroupCard__team">
                              {t.crest
                                ? <img src={t.crest} alt="" className="matchs__wcGroupCard__crest"
                                    onError={e => e.currentTarget.style.display = 'none'} />
                                : <span className="matchs__wcGroupCard__crestFallback">{(t.shortName || t.name)?.[0]}</span>
                              }
                              <span className="matchs__wcGroupCard__teamName">
                                {translateTeam(t.shortName || t.name)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="matchs__wcGroupCard__footer">
                          <span>{gMatches.length} match{gMatches.length > 1 ? 's' : ''}</span>
                          <span className="matchs__wcGroupCard__cta">Voir →</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
              {!loading && wcGroups.length === 0 && (
                <p className="matchs__state">Aucune poule disponible.</p>
              )}
            </>
          )}

          {/* États chargement pour les autres vues */}
          {loading && (!isWC || wcView !== 'poules') && (
            <div className="matchs__state"><div className="matchs__spinner" /><p>Chargement des matchs...</p></div>
          )}
          {error && <p className="matchs__state matchs__state--error">{error}</p>}

          {/* ═══ Vue Phase finale (bracket) ═══ */}
          {isWC && wcView === 'bracket' && (
            <>
              {bracketLoading && (
                <div className="matchs__state"><div className="matchs__spinner" /><p>Chargement du tableau...</p></div>
              )}
              {bracketError && (
                <p className="matchs__state matchs__state--error">{bracketError}</p>
              )}
              {!bracketLoading && !bracketError && rounds.length === 0 && (
                <div className="bracket__empty">
                  <span className="bracket__emptyIcon">🏆</span>
                  <p className="bracket__emptyTitle">Phase finale à venir</p>
                  <p className="bracket__emptyText">
                    Le tableau des phases finales sera disponible dès la fin de la phase de groupes.
                  </p>
                </div>
              )}
              {!bracketLoading && !bracketError && rounds.length > 0 && (
                <div className="bracket__container">
                  <BracketSvgView rounds={rounds} onSelect={setSelectedMatch} />
                </div>
              )}
            </>
          )}

          {/* ═══ Vue Par journée ═══ */}
          {!loading && !error && (!isWC || wcView === 'matchs') && total > 0 && (
            <>
              <div className="matchs__nav">
                <button className="matchs__navBtn"
                  onClick={() => setCurrentIndex(i => i - 1)}
                  disabled={currentIndex <= 0}>←</button>
                <span className="matchs__navLabel">Journée {currentMatchday}</span>
                <button className="matchs__navBtn"
                  onClick={() => setCurrentIndex(i => i + 1)}
                  disabled={currentIndex >= total - 1}>→</button>
              </div>
              <div className="matchs__panel">
                {currentMatches.map((m, i) => <MatchRow key={m.id} match={m} index={i} />)}
              </div>
            </>
          )}

          {!loading && !error && !isWC && matches.length === 0 && (
            <p className="matchs__state">Aucun match à venir pour le moment.</p>
          )}

        </main>
      </div>

      {openedGroup && (
        <GroupModal groupKey={openedGroup} onClose={() => setOpenedGroup(null)} />
      )}
      {selectedMatch && (
        <MatchModal match={selectedMatch} compId={selectedComp}
          onClose={() => setSelectedMatch(null)} formMap={formMap} />
      )}
    </section>
  )
}

export default Matchs
