import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import './../classement.css'
import './../compHeader.css'
import { COMPETITIONS as competitions } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useStandings } from '../hooks/useStandings'
import { useTeamForm } from '../hooks/useTeamForm'
import { useScorers } from '../hooks/useScorers'
import { useMatches } from '../hooks/useMatchs'
import { finalScore } from '../utils/matchUtils'
import { StandingsTable } from './StandingsTable'
import { PanelSkeleton } from '../accueil/MatchCard'
// Étoile de favori RETIRÉE de cette page (retour utilisateur : pas concluant
// ici) — ne reste que dans FavoritesPage.jsx (page /favoris, ouverte depuis
// la cloche). StandingsTable garde le prop favoritable pour cet usage-là.
// TendancesView mis de côté (voir commentaire plus bas) — import retiré,
// fichier conservé pour être retravaillé plus tard.


function Classement() {
  const location = useLocation()
  const initCompId  = location.state?.compId  ?? 'WC'
  const initGroup   = location.state?.group   ?? null   // ex: "GROUP_A"

  const [selectedComp, setSelectedComp] = useState(initCompId)
  const [view, setView] = useState('classement') // 'classement' | 'buteurs'
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [search, setSearch] = useState('')
  const searchNorm = search.trim().toLowerCase()
  const SCORERS_PER_PAGE = 20
  const [scorerPage, setScorerPage] = useState(0)
  const [compOpen, setCompOpen] = useState(false)
  const didAutoOpen = useRef(false)

  // ── Dropdown "Changer" — même technique que le panneau de la cloche notifs :
  // rendu via portail dans <body> (échappe à l'overflow:hidden de .compHeader)
  // et positionné en `fixed` à partir des coordonnées réelles du bouton.
  const compHeroRef = useRef(null)
  const [compAnchor, setCompAnchor] = useState(null)
  useLayoutEffect(() => {
    if (!compOpen || !compHeroRef.current) return
    const r = compHeroRef.current.getBoundingClientRect()
    setCompAnchor({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 220) })
  }, [compOpen])

  useEffect(() => {
    if (!compOpen) return
    const onClick = (e) => {
      if (compHeroRef.current?.contains(e.target)) return
      if (e.target.closest?.('.compHeader__pickerWrap')) return
      setCompOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [compOpen])

  const { standings, groups, loading, error } = useStandings(selectedComp)
  const { formMap } = useTeamForm(selectedComp)
  const { scorers, loading: scorersLoading, error: scorersError } = useScorers(selectedComp)
  // Classement des passes décisives retiré : aucune source fiable trouvée
  // (api-football → plan gratuit ne couvre pas la saison en cours ; scraping
  // ESPN tenté ensuite → ne fonctionnait pas non plus). On garde uniquement
  // Buteurs, avec le nombre de passes décisives affiché en info secondaire
  // quand disponible via football-data.org.

  // Recherche — filtre côté client, ne nécessite aucune donnée supplémentaire.
  function matchesTeamSearch(team) {
    if (!searchNorm) return true
    const translated = translateTeam(team?.shortName || team?.name || '').toLowerCase()
    const raw         = (team?.name ?? '').toLowerCase()
    return translated.includes(searchNorm) || raw.includes(searchNorm)
  }
  function matchesScorerSearch(s) {
    if (!searchNorm) return true
    const player = (s.player?.name ?? '').toLowerCase()
    return player.includes(searchNorm) || matchesTeamSearch(s.team)
  }
  const filteredStandings = standings.filter(row => matchesTeamSearch(row.team))

  const scorerBase = scorers

  // _rank = position dans la liste des buteurs NON filtrée, pour que
  // le badge affiché reste le vrai rang même quand la recherche réduit la liste
  // (sinon un joueur classé 15e chercherait à s'afficher "#1" une fois seul
  // dans la liste filtrée).
  const filteredScorers = scorerBase
    .map((s, i) => ({ ...s, _rank: i }))
    .filter(matchesScorerSearch)

  // Par défaut (pas de recherche) : top 25 uniquement. En recherche : on
  // cherche dans la liste complète déjà récupérée par useScorers (limit=500,
  // voir useScorers.js) — pas de second appel réseau, pas de reconstruction
  // match par match (tenté puis abandonné : trop d'incertitude sur l'accès
  // aux données détaillées de but via l'API gratuite, deux endpoints
  // différents testés sans succès). Cette liste plus large couvre déjà la
  // quasi-totalité des cas réels de recherche par équipe.
  const displayScorers = searchNorm ? filteredScorers : filteredScorers.slice(0, 25)
  const scorersBusy = scorersLoading
  const scorersErrorMsg = scorersError

  // Pagination (20 par page) — UNIQUEMENT en recherche (liste potentiellement
  // longue, ex: tous les buteurs d'une équipe). Le top 25 par défaut s'affiche
  // toujours en une seule fois, sans pagination.
  // Reset à la page 1 si la recherche ou la compétition change, sinon on peut
  // se retrouver sur une page vide/hors limites après un filtrage qui réduit
  // le nombre total de pages.
  useEffect(() => { setScorerPage(0) }, [searchNorm, selectedComp, view])
  const paginationEnabled = !!searchNorm
  const scorerPageCount = Math.max(1, Math.ceil(displayScorers.length / SCORERS_PER_PAGE))
  const pagedScorers = paginationEnabled
    ? displayScorers.slice(scorerPage * SCORERS_PER_PAGE, scorerPage * SCORERS_PER_PAGE + SCORERS_PER_PAGE)
    : displayScorers

  // Pré-chargé au niveau Classement pour éviter le problème de hooks dans composant imbriqué
  // (hooks ne peuvent pas être dans des sous-composants définis dans le même scope)
  const { matches: wcSched, loading: wcSchedLoading } = useMatches('WC', 'SCHEDULED')
  const { matches: wcFin,   loading: wcFinLoading   } = useMatches('WC', 'FINISHED')
  // Fetch dédié à l'onglet Tendances retiré avec l'onglet lui-même (mis de
  // côté, voir TendancesView.jsx) — évite un appel réseau pour rien.

  const selectedCompetition = competitions.find((c) => c.id === selectedComp)

  // Auto-ouvre le groupe si on vient d'une modal match (ex: GROUP_A depuis WC)
  useEffect(() => {
    if (didAutoOpen.current || !initGroup || groups.length === 0) return
    const normG = g => (g ?? '').toUpperCase().replace(/\s+/g, '_')
    const found = groups.find(g => normG(g.name) === initGroup)
    if (found) {
      setSelectedGroup(found)
      didAutoOpen.current = true
    }
  }, [groups, initGroup])

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

  /* Formate "GROUP_A" → "Groupe A" */
  const formatGroupName = (raw = '') =>
    raw.replace('GROUP_', 'Groupe ')

  const qualificationRules = competitionRules[selectedComp] ?? competitionRules.default

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
      const fsGroupRow = finalScore(m.score)
      const sh  = fsGroupRow.home ?? m.score?.halfTime?.home
      const sa  = fsGroupRow.away ?? m.score?.halfTime?.away
      const live = ['IN_PLAY','PAUSED'].includes(m.status)
      const isFinished = m.status === 'FINISHED'
      // Score 120min (finalScore) : à égalité par définition si le match est allé aux tab.
      const wentToPens = m.score?.duration === 'PENALTY_SHOOTOUT'
      const pH = m.score?.penalties?.home ?? null
      const pA = m.score?.penalties?.away ?? null
      const homeWin = isFinished && (wentToPens
        ? (pH != null && pA != null && pH > pA)
        : (sh != null && sh > sa))
      const awayWin = isFinished && (wentToPens
        ? (pH != null && pA != null && pA > pH)
        : (sa != null && sa > sh))

      const label = live ? (m.minute ? `${m.minute}'` : 'LIVE')
                  : isFinished ? 'Terminé'
                  : formatDate(m.utcDate)

      const value = (showScore || live) && sh != null
        ? `${sh} – ${sa}`
        : formatTime(m.utcDate)

      return (
        <div className={`accueil__matchCard${live ? ' accueil__matchCard--live' : ''}`}>
          {/* Équipe domicile */}
          <div className="accueil__matchCardTeam">
            <div className="accueil__matchCardCrestWrap" data-crest="country">
              {m.homeTeam?.crest
                ? <img src={m.homeTeam.crest} alt="" loading="lazy" className="accueil__matchCardCrest" data-team={m.homeTeam?.name} />
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
            <div className="accueil__matchCardCrestWrap" data-crest="country">
              {m.awayTeam?.crest
                ? <img src={m.awayTeam.crest} alt="" loading="lazy" className="accueil__matchCardCrest" data-team={m.awayTeam?.name} />
                : <div className="accueil__matchCardCrestEmpty" />}
            </div>
            <span className="accueil__matchCardName">{an}</span>
          </div>
        </div>
      )
    }

    function MatchList({ list, showScore, empty }) {
      if (loadingM) return <PanelSkeleton />
      if (!list.length) return (
        <div className="gm__empty">
          <span className="gm__emptyIcon" aria-hidden="true">⚽</span>
          <p className="gm__emptyTitle">{empty}</p>
        </div>
      )
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
            {tab === 'classement' && (
              <StandingsTable
                rows={group.table}
                compact={false}
                formMap={formMap}
                qualificationRules={qualificationRules}
                snapshotKey={`standings_prev_${selectedComp}_${group.name}`}
                isCountry={selectedComp === 'WC'}
              />
            )}

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
    // Recherche : ne garder que les groupes contenant une équipe correspondante,
    // et filtrer leurs lignes — sinon chercher "Brésil" affiche quand même les
    // 7 autres groupes vides de sens pour cette recherche.
    const visibleGroups = groups
      .map(group => ({ ...group, table: group.table.filter(row => matchesTeamSearch(row.team)) }))
      .filter(group => !searchNorm || group.table.length > 0)

    return (
      <>
        {searchNorm && visibleGroups.length === 0 && (
          <p className="classement__state">Aucune équipe ne correspond à « {search} ».</p>
        )}
        <div className="classement__groups">
          {visibleGroups.map(group => (
            <div
              key={group.name}
              className="classement__groupBlock classement__groupBlock--clickable"
              onClick={() => setSelectedGroup(groups.find(g => g.name === group.name) ?? group)}
              title="Voir le groupe en détail"
            >
              <div className="classement__groupHeader">
                <h3 className="classement__groupTitle">{formatGroupName(group.name)}</h3>
                <span className="classement__groupExpandHint">↗</span>
              </div>
              <StandingsTable
                rows={group.table}
                compact
                formMap={formMap}
                qualificationRules={qualificationRules}
                snapshotKey={`standings_prev_${selectedComp}_${group.name}`}
                snapshotRows={groups.find(g => g.name === group.name)?.table ?? group.table}
                isCountry={selectedComp === 'WC'}
              />
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

        {/* ── Mobile : header compétition vedette (Option B) ── */}
        <div className={`compHeader${compOpen ? ' compHeader--open' : ''}`}>
          <div className="compHeader__hero" ref={compHeroRef} onClick={() => setCompOpen(o => !o)}>
            {selectedCompetition?.emblem && (
              <img src={selectedCompetition.emblem} alt="" className="compHeader__logo"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <div className="compHeader__info">
              <span className="compHeader__name">{selectedCompetition?.name}</span>
            </div>
            <button className="compHeader__btn" aria-label={compOpen ? 'Fermer la liste des compétitions' : 'Changer de compétition'}>
              {compOpen ? 'Fermer' : 'Changer'}
              <svg
                className={`compHeader__btnChevron${compOpen ? ' compHeader__btnChevron--open' : ''}`}
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          <div className="compHeader__dots">
            {competitions.map(c => (
              <span key={c.id} className={`compHeader__dot${c.id === selectedComp ? ' compHeader__dot--active' : ''}`} />
            ))}
          </div>
          {compAnchor && createPortal(
            <div
              className={`compHeader__pickerWrap${compOpen ? ' compHeader__pickerWrap--open' : ''}`}
              style={{ top: compAnchor.top, left: compAnchor.left, width: compAnchor.width }}
            >
              <div className="compHeader__picker">
                {competitions.map(comp => (
                  <button
                    key={comp.id}
                    className={`compHeader__item${comp.id === selectedComp ? ' compHeader__item--active' : ''}`}
                    onClick={() => { setSelectedComp(comp.id); setCompOpen(false) }}
                  >
                    <img src={comp.emblem} alt="" className="compHeader__itemLogo"
                      onError={e => e.currentTarget.style.display = 'none'} />
                    <span className="compHeader__itemName">{comp.shortName ?? comp.name}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )}
        </div>

        {/* ── Desktop : sidebar liste ── */}
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
            <h1 className="classement__panelTitle">Classement</h1>
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
            {/* Onglet "Tendances" mis de côté pour être retravaillé plus tard —
                voir TendancesView.jsx / tendances.css (conservés, pas supprimés). */}
          </div>
        </div>

        {/* Recherche équipe/buteur — filtre côté client */}
        <div className="classement__searchWrap">
          <input
            type="text"
            className="classement__searchInput"
            placeholder={
              view === 'buteurs' ? 'Rechercher un buteur ou une équipe…' : 'Rechercher une équipe…'
            }
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="classement__searchClear" onClick={() => setSearch('')} aria-label="Effacer la recherche">✕</button>
          )}
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
            {scorersBusy && (
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
            {!scorersBusy && scorersErrorMsg && (
              <p className="classement__state">Données non disponibles.</p>
            )}
            {!scorersBusy && !scorersErrorMsg && scorerBase.length === 0 && (
              <p className="classement__state">Aucun buteur disponible.</p>
            )}
            {!scorersBusy && !scorersErrorMsg && scorerBase.length > 0 && displayScorers.length === 0 && (
              <p className="classement__state">Aucun buteur ne correspond à « {search} ».</p>
            )}
            {!scorersBusy && displayScorers.length > 0 && (
              <div className="classement__scorersList">
                {pagedScorers.map((s) => {
                  const i = s._rank
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
                            <div className="classement__scorerCrestWrap" data-crest={selectedComp === 'WC' ? 'country' : 'club'}><img src={s.team.crest} alt="" loading="lazy" className="classement__scorerCrest" data-team={s.team?.name}
                              onError={e => e.currentTarget.style.display = 'none'} /></div>
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
            {!scorersBusy && paginationEnabled && displayScorers.length > SCORERS_PER_PAGE && (
              <div className="classement__scorersPageNav">
                <button
                  className="classement__scorersPageBtn"
                  onClick={() => setScorerPage(p => Math.max(0, p - 1))}
                  disabled={scorerPage <= 0}
                >‹</button>
                <span className="classement__scorersPageLabel">
                  Page {scorerPage + 1} / {scorerPageCount}
                </span>
                <button
                  className="classement__scorersPageBtn"
                  onClick={() => setScorerPage(p => Math.min(scorerPageCount - 1, p + 1))}
                  disabled={scorerPage >= scorerPageCount - 1}
                >›</button>
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
                  <th>Pos</th><th>Équipe</th><th>MJ</th><th>Pts</th>
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
          isMultiGroup
            ? <MultiGroupView />
            : filteredStandings.length > 0
              ? <StandingsTable
                  rows={filteredStandings}
                  formMap={formMap}
                  qualificationRules={qualificationRules}
                  snapshotKey={`standings_prev_${selectedComp}`}
                  snapshotRows={standings}
                  isCountry={selectedComp === 'WC'}
                />
              : <p className="classement__state">Aucune équipe ne correspond à « {search} ».</p>
        )}

        {view === 'classement' && !loading && !error && standings.length === 0 && (
          <p className="classement__state">Aucune donnée disponible.</p>
        )}

        {/* Vue Tendances mise de côté — voir TendancesView.jsx (conservé, pas branché) */}

      </div>
        </main>
      </div>
    </section>
  )
}

export default Classement
