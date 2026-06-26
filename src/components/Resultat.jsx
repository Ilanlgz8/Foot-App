import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import './../resultats.css'
import './../compHeader.css'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useMatches }    from '../hooks/useMatchs'

const formatGroupName = (raw = '') => raw.replace('GROUP_', 'Groupe ').replace(/_/g, ' ')

function Resultats() {
  const navigate = useNavigate()
  const [selectedComp, setSelectedComp] = useState('WC')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [viewMode, setViewMode]         = useState('journee') // 'journee' | 'poule'
  const [openedGroup, setOpenedGroup]   = useState(null)
  const [compOpen, setCompOpen]         = useState(false)

  const { matches, loading, error, grouped } = useMatches(selectedComp, 'FINISHED', 'desc')

  const currentComp = COMPETITIONS.find(c => c.id === selectedComp)
  const isWC        = selectedComp === 'WC'

  // Groupes WC détectés
  const wcGroups = useMemo(() => {
    if (!isWC) return []
    const seen = new Set(); const groups = []
    for (const m of matches) {
      const g = m.group ?? null
      if (g && g.startsWith('GROUP_') && !seen.has(g)) { seen.add(g); groups.push(g) }
    }
    return groups.sort()
  }, [matches, isWC])

  // Map groupe → matchs
  const matchesByGroup = useMemo(() => {
    const map = new Map()
    for (const g of wcGroups) map.set(g, [])
    for (const m of matches) {
      const g = m.group ?? null
      if (g && map.has(g)) map.get(g).push(m)
    }
    return map
  }, [matches, wcGroups])

  // Équipes d'un groupe
  const groupTeams = (gMatches) => {
    const seen = new Set(); const teams = []
    for (const m of gMatches) {
      if (!seen.has(m.homeTeam.id)) { seen.add(m.homeTeam.id); teams.push(m.homeTeam) }
      if (!seen.has(m.awayTeam.id)) { seen.add(m.awayTeam.id); teams.push(m.awayTeam) }
    }
    return teams
  }

  const currentGroup    = grouped[currentIndex]
  const currentMatchday = currentGroup?.[0]
  const currentMatches  = currentGroup?.[1] ?? []
  const total           = grouped.length

  const fmtDate = (d) => {
    const today = new Date(); today.setHours(0,0,0,0)
    const date  = new Date(d); date.setHours(0,0,0,0)
    if (date.getTime() === today.getTime()) return `Aujourd'hui`
    return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })
  }
  const tName = (t) => translateTeam(t?.shortName || t?.name || '?')

  // Carte de match réutilisable
  function MatchCard({ match }) {
    const hs   = match.score?.fullTime?.home ?? 0
    const as_  = match.score?.fullTime?.away ?? 0
    const hWin = hs > as_; const aWin = as_ > hs; const draw = hs === as_
    return (
      <div className="resultats__card" onClick={() => navigate(`/match/${match.id}`, { state: { match } })} style={{ cursor: 'pointer' }}>
        <div className={`resultats__team resultats__team--home ${aWin ? 'resultats__team--loser' : ''}`}>
          <div className="resultats__crestWrap">
            {match.homeTeam?.crest
              ? <img src={match.homeTeam.crest} alt="" className="resultats__crest" onError={e => e.target.style.display='none'} />
              : <span className="resultats__crestFb">{tName(match.homeTeam)[0]}</span>}
          </div>
          <span className="resultats__teamName">{tName(match.homeTeam)}</span>
        </div>
        <div className="resultats__scoreCenter">
          <span className="resultats__cardDate">{fmtDate(match.utcDate)}</span>
          <div className="resultats__scoreRow">
            <span className={`resultats__scoreNum ${hWin ? 'resultats__scoreNum--win' : ''} ${draw ? 'resultats__scoreNum--draw' : ''}`}>{hs}</span>
            <span className="resultats__scoreDash">–</span>
            <span className={`resultats__scoreNum ${aWin ? 'resultats__scoreNum--win' : ''} ${draw ? 'resultats__scoreNum--draw' : ''}`}>{as_}</span>
          </div>
          <span className="resultats__ftBadge">FT</span>
        </div>
        <div className={`resultats__team resultats__team--away ${hWin ? 'resultats__team--loser' : ''}`}>
          <div className="resultats__crestWrap">
            {match.awayTeam?.crest
              ? <img src={match.awayTeam.crest} alt="" className="resultats__crest" onError={e => e.target.style.display='none'} />
              : <span className="resultats__crestFb">{tName(match.awayTeam)[0]}</span>}
          </div>
          <span className="resultats__teamName">{tName(match.awayTeam)}</span>
        </div>
      </div>
    )
  }

  // Modal résultats d'un groupe (réutilise les classes wcModal de match.css)
  function GroupModal({ groupKey, onClose }) {
    const gMatches = (matchesByGroup.get(groupKey) ?? [])
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))

    useEffect(() => {
      const handler = e => { if (e.key === 'Escape') onClose() }
      window.addEventListener('keydown', handler)
      const scrollY = window.scrollY
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY}px`
      document.body.style.left = '0'; document.body.style.right = '0'
      return () => {
        window.removeEventListener('keydown', handler)
        document.body.style.overflow = ''; document.body.style.position = ''
        document.body.style.top = ''; document.body.style.left = ''; document.body.style.right = ''
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
              <span className="wcModal__count">{gMatches.length} match{gMatches.length !== 1 ? 's' : ''}</span>
            </div>
            <button className="wcModal__close" onClick={onClose}>✕</button>
          </div>
          <div className="wcModal__body">
            {gMatches.length === 0
              ? <p style={{ textAlign: 'center', color: '#475569', padding: '2rem 0' }}>Aucun résultat.</p>
              : gMatches.map(m => <MatchCard key={m.id} match={m} />)
            }
          </div>
        </div>
      </div>,
      document.body
    )
  }

  return (
    <section className="resultats">
      <div className="resultats__backdrop resultats__backdrop--one" />
      <div className="resultats__backdrop resultats__backdrop--two" />

      <div className="resultats__layout">

        {/* ── Mobile : header compétition vedette (Option B) ── */}
        <div className={`compHeader${compOpen ? ' compHeader--open' : ''}`}>
          <div className="compHeader__hero" onClick={() => setCompOpen(o => !o)}>
            {currentComp?.emblem && (
              <img src={currentComp.emblem} alt="" className="compHeader__logo"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <div className="compHeader__info">
              <span className="compHeader__name">{currentComp?.name ?? 'Compétition'}</span>
              <span className="compHeader__sub">Saison 2025–26</span>
            </div>
            <button className="compHeader__btn" aria-label="Changer de compétition">
              {compOpen ? 'Fermer ✕' : 'Changer ›'}
            </button>
          </div>
          <div className="compHeader__dots">
            {COMPETITIONS.map(c => (
              <span key={c.id} className={`compHeader__dot${c.id === selectedComp ? ' compHeader__dot--active' : ''}`} />
            ))}
          </div>
          <div className={`compHeader__pickerWrap${compOpen ? ' compHeader__pickerWrap--open' : ''}`}>
            <div className="compHeader__picker">
              {COMPETITIONS.map(comp => (
                <button
                  key={comp.id}
                  className={`compHeader__item${comp.id === selectedComp ? ' compHeader__item--active' : ''}`}
                  onClick={() => { setSelectedComp(comp.id); setCurrentIndex(0); setViewMode('journee'); setOpenedGroup(null); setCompOpen(false) }}
                >
                  <img src={comp.emblem} alt="" className="compHeader__itemLogo"
                    onError={e => e.currentTarget.style.display = 'none'} />
                  <span className="compHeader__itemName">{comp.shortName ?? comp.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Desktop : sidebar liste ── */}
        <aside className="resultats__sidebar">
          <p className="resultats__sidebarLabel">Championnats</p>
          <nav className="resultats__sidebarNav">
            {COMPETITIONS.map(comp => (
              <button key={comp.id}
                onClick={() => { setSelectedComp(comp.id); setCurrentIndex(0); setViewMode('journee'); setOpenedGroup(null) }}
                className={`resultats__sidebarItem ${selectedComp === comp.id ? 'resultats__sidebarItem--active' : ''}`}
              >
                <img src={comp.emblem} alt=""
                  className="resultats__competitionLogo resultats__competitionLogo--sidebar"
                  onError={e => e.currentTarget.style.display = 'none'} />
                <span className="resultats__sidebarName resultats__sidebarName--full">{comp.name}</span>
                <span className="resultats__sidebarName resultats__sidebarName--short">{comp.shortName ?? comp.name}</span>
                {selectedComp === comp.id && <span className="resultats__sidebarDot" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Contenu */}
        <main className="resultats__main">

          <div className="resultats__header">
            <h1 className="resultats__kicker">Résultats</h1>
            <div className="resultats__titleRow">
              {isWC && wcGroups.length > 0 && (
                <div className="resultats__viewTabs">
                  <button className={'resultats__viewTab' + (viewMode === 'journee' ? ' resultats__viewTab--active' : '')} onClick={() => setViewMode('journee')}>Par journée</button>
                  <button className={'resultats__viewTab' + (viewMode === 'poule' ? ' resultats__viewTab--active' : '')} onClick={() => setViewMode('poule')}>Par poule</button>
                </div>
              )}
            </div>
          </div>

          {loading && (
            <div className="resultats__list">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="resultats__card" style={{ pointerEvents: 'none' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.7rem', justifyContent:'flex-end' }}>
                    <div className="sk" style={{ width:'5rem', height:'0.85rem' }} />
                    <div className="sk" style={{ width:'2.6rem', height:'2.6rem', borderRadius:'50%' }} />
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'0.35rem' }}>
                    <div className="sk" style={{ width:'1rem', height:'0.6rem' }} />
                    <div className="sk" style={{ width:'3.5rem', height:'1.4rem' }} />
                    <div className="sk" style={{ width:'1.2rem', height:'0.5rem' }} />
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.7rem' }}>
                    <div className="sk" style={{ width:'2.6rem', height:'2.6rem', borderRadius:'50%' }} />
                    <div className="sk" style={{ width:'5rem', height:'0.85rem' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="resultats__state resultats__state--error">{error}</p>}

          {/* Vue par journée */}
          {!loading && !error && viewMode === 'journee' && grouped.length > 0 && (
            <>
              <div className="resultats__nav">
                <button className="resultats__navBtn" onClick={() => setCurrentIndex(i => i + 1)} disabled={currentIndex >= total - 1}>←</button>
                <span className="resultats__navLabel">Journée {currentMatchday}</span>
                <button className="resultats__navBtn" onClick={() => setCurrentIndex(i => i - 1)} disabled={currentIndex <= 0}>→</button>
              </div>
              <div className="resultats__list">
                {currentMatches.map(match => <MatchCard key={match.id} match={match} />)}
              </div>
            </>
          )}

          {/* Vue par poule — board de cartes comme dans Programme */}
          {!loading && !error && viewMode === 'poule' && wcGroups.length > 0 && (
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
                            ? <img src={t.crest} alt="" className="matchs__wcGroupCard__crest" onError={e => e.currentTarget.style.display='none'} />
                            : <span className="matchs__wcGroupCard__crestFallback">{(t.shortName || t.name)?.[0]}</span>}
                          <span className="matchs__wcGroupCard__teamName">{translateTeam(t.shortName || t.name)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="matchs__wcGroupCard__footer">
                      <span>{gMatches.length} résultat{gMatches.length !== 1 ? 's' : ''}</span>
                      <span className="matchs__wcGroupCard__cta">Voir →</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {!loading && !error && matches.length === 0 && (
            <p className="resultats__state">Aucun résultat disponible.</p>
          )}
        </main>
      </div>

      {/* Modal résultats d'un groupe */}
      {openedGroup && <GroupModal groupKey={openedGroup} onClose={() => setOpenedGroup(null)} />}

    </section>
  )
}

export default Resultats
