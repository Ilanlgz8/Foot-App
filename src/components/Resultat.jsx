import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import './../resultats.css'
import './../compHeader.css'
// La vue "Par poule" réutilise les classes matchs__wc* définies dans match.css
// (celui de la page Programme). Comme Programme est chargée en lazy et que
// Resultat.jsx ne l'importait pas lui-même, ces classes restaient sans style
// tant qu'on n'avait pas visité Programme au moins une fois dans la session.
import './../match.css'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useMatches, groupRounds } from '../hooks/useMatchs'
import { GroupModal }    from './GroupModal'
import { useLiveData }   from '../context/LiveProvider'
import { getMatchState } from '../utils/matchStateTracker'
import { mergeScore, finalScore } from '../utils/matchUtils'
import { usePersistedState } from '../hooks/usePersistedState'
import { FavStarBadge } from './FavStarBadge'
import { useFavoriteClubs } from '../hooks/useFavoriteClubs'
import { getTeamColor } from '../data/teamPhotos'

const formatGroupName = (raw = '') => raw.replace('GROUP_', 'Groupe ').replace(/_/g, ' ')
const tName = (t) => translateTeam(t?.shortName || t?.name || '?')
const fmtDate = (d) => {
  const today = new Date(); today.setHours(0,0,0,0)
  const date  = new Date(d); date.setHours(0,0,0,0)
  if (date.getTime() === today.getTime()) return `Aujourd'hui`
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })
}

/* Carte de match — définie AU NIVEAU MODULE : sinon, recréée à chaque render
   de Resultats() (or celui-ci re-render toutes les ~15s via espnScores/
   useLiveData), React perd l'identité du composant et démonte/remonte tous
   les <img> crest → flicker/rechargement visible des drapeaux à intervalle
   régulier (constat utilisateur : "ça fait comme un refresh à chaque fois").
   Pas de loading="lazy" ici : cette page est de toute façon démontée/remontée
   en entier à chaque navigation vers /match/:id puis retour (comportement
   normal du routeur) — recrée les <img> à chaque fois. Avec "lazy", même une
   image déjà en cache navigateur repasse par l'IntersectionObserver avant de
   se charger, ce qui ajoute un flash "vide → image" perceptible à chaque
   retour (constat utilisateur). Les listes ici sont courtes (une journée/
   poule à la fois), le coût du chargement eager est négligeable. */
function MatchCard({ match }) {
  const navigate = useNavigate()
  const { isFavorite } = useFavoriteClubs()
  const homeIsFav = isFavorite(match.homeTeam?.id)
  const awayIsFav = isFavorite(match.awayTeam?.id)
  const isFav = homeIsFav || awayIsFav
  const favColor = isFav
    ? getTeamColor((homeIsFav ? match.homeTeam : match.awayTeam)?.shortName || (homeIsFav ? match.homeTeam : match.awayTeam)?.name)
    : null
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = match.competition?.id === 2000 || match.competition?.code === 'WC'
  // finalScore() = score 120min (prolongations incluses, tirs au but exclus).
  // ⚠️ NE PAS lire match.score.fullTime directement : pour un match décidé aux
  // tab, FD.org y met regularTime+extraTime+penalties CUMULÉS (bug confirmé en
  // prod), pas le score 120min — voir finalScore() dans matchUtils.js. Un match
  // décidé aux tab est TOUJOURS à égalité en score 120min → le vainqueur doit
  // se déterminer via le score des tab (score.penalties), pas via ce score.
  const fsRes = finalScore(match.score)
  const hs   = fsRes.home ?? 0
  const as_  = fsRes.away ?? 0
  const wentToPens = match.score?.duration === 'PENALTY_SHOOTOUT'
  // Décidé en prolongation SANS tirs au but (score.duration ne vaut
  // 'EXTRA_TIME' que dans ce cas précis — si ça s'est joué aux tab, duration
  // vaut déjà 'PENALTY_SHOOTOUT', donc les deux sont mutuellement exclusifs).
  const wentToAet = match.score?.duration === 'EXTRA_TIME'
  const hp   = match.score?.penalties?.home ?? null
  const ap   = match.score?.penalties?.away ?? null
  const hWin = wentToPens ? (hp != null && ap != null && hp > ap) : hs > as_
  const aWin = wentToPens ? (hp != null && ap != null && ap > hp) : as_ > hs
  const draw = !wentToPens && hs === as_

  return (
    <div className="resultats__card" onClick={() => navigate(`/match/${match.id}`, { state: { match } })} style={{ cursor: 'pointer' }}>
      {isFav && <FavStarBadge variant="row" color={favColor} />}
      <div className={`resultats__team resultats__team--home ${aWin ? 'resultats__team--loser' : ''}`}>
        <div className="resultats__crestWrap" data-crest={isWC ? 'country' : 'club'}>
          {match.homeTeam?.crest
            ? <img src={match.homeTeam.crest} alt="" className="resultats__crest" data-team={match.homeTeam?.name} onError={e => e.target.style.display='none'} />
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
        {wentToPens && hp != null && ap != null && (
          <div className="resultats__pensBlock">
            <span className="resultats__pensLabel">T.A.B</span>
            <span className="resultats__pensScore">({hp}-{ap})</span>
          </div>
        )}
        {wentToAet && (
          <span className="resultats__aet">Après prolong.</span>
        )}
        <span className="resultats__ftBadge">Terminé</span>
      </div>
      <div className={`resultats__team resultats__team--away ${hWin ? 'resultats__team--loser' : ''}`}>
        <div className="resultats__crestWrap" data-crest={isWC ? 'country' : 'club'}>
          {match.awayTeam?.crest
            ? <img src={match.awayTeam.crest} alt="" className="resultats__crest" data-team={match.awayTeam?.name} onError={e => e.target.style.display='none'} />
            : <span className="resultats__crestFb">{tName(match.awayTeam)[0]}</span>}
        </div>
        <span className="resultats__teamName">{tName(match.awayTeam)}</span>
      </div>
    </div>
  )
}

function Resultats() {
  const navigate = useNavigate()
  // Persistés dans sessionStorage : App.jsx remonte cette page à chaque
  // retour depuis /match/:id (voir usePersistedState) — sans ça, revenir
  // d'un match rebasculait toujours sur la 1ère journée au lieu de celle
  // consultée (ex: 8e journée → 6e).
  const [selectedComp, setSelectedComp] = usePersistedState('resultats_selectedComp', 'WC')
  const [currentIndex, setCurrentIndex] = usePersistedState('resultats_currentIndex', 0)
  const [viewMode, setViewMode]         = usePersistedState('resultats_viewMode', 'journee') // 'journee' | 'poule'
  const [openedGroup, setOpenedGroup]   = useState(null)
  const [compOpen, setCompOpen]         = useState(false)
  const [search, setSearch]             = useState('')
  const searchNorm = search.trim().toLowerCase()
  // Dropdown façon cloche notifs : rendu via portail dans <body> pour échapper
  // à l'overflow:hidden de .compHeader (voir NotificationBell.jsx / Match.jsx).
  const compHeroRef = useRef(null)
  const [compAnchor, setCompAnchor] = useState(null)
  useLayoutEffect(() => {
    if (compOpen && compHeroRef.current) {
      const r = compHeroRef.current.getBoundingClientRect()
      setCompAnchor({ top: r.bottom + 6, left: r.left, width: r.width })
    } else {
      setCompAnchor(null)
    }
  }, [compOpen])
  useEffect(() => {
    if (!compOpen) return
    const onDown = (e) => {
      if (compHeroRef.current?.contains(e.target)) return
      if (e.target.closest?.('.compHeader__pickerWrap')) return
      setCompOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [compOpen])

  const { matches: fdMatches, loading, error } = useMatches(selectedComp, 'FINISHED', 'desc')

  // ESPN détecte souvent la fin d'un match plusieurs minutes avant que
  // football-data.org ne mette à jour son statut à FINISHED (retard connu,
  // voir CLAUDE.md). Sans ça, un match terminé peut mettre du temps à
  // apparaître ici alors qu'il est déjà fini pour de vrai. On complète donc
  // la liste FD.org avec les matchs de CETTE compétition qu'ESPN (via
  // liveMatches/matchStateTracker, alimentés globalement par LiveProvider)
  // considère déjà terminés ("ft"), même si liveTracker les garde encore
  // quelques minutes dans liveMatches et que FD.org n'a pas encore basculé.
  const { liveMatches, espnScores } = useLiveData()
  const matches = useMemo(() => {
    const known = new Set(fdMatches.map(m => m.id))
    const extra = liveMatches
      .filter(m => m.competition?.code === selectedComp)
      .filter(m => !known.has(m.id))
      .filter(m => getMatchState(m.id).ft === true)
      .map(m => {
        let lsHome = null, lsAway = null
        try {
          const ls = JSON.parse(localStorage.getItem(`foot_espn_${m.id}`) ?? 'null')
          if (ls && ls.home != null) { lsHome = ls.home; lsAway = ls.away }
        } catch {}
        const es = espnScores[m.id]
        // Tirs au but : pour un match qu'ESPN détecte terminé AVANT que
        // football-data.org ne le confirme officiellement, FD.org n'a pas
        // encore rempli score.penalties (il ne le fait qu'à leur propre statut
        // FINISHED). La seule source dispo est alors le suivi ESPN
        // (homeShootout/awayShootout, alimenté par useLiveMinute). Sans ça, le
        // score.fullTime reconstruit ci-dessous écrasait score.duration/
        // penalties → le badge "(x-y tab)" restait vide pour ces matchs-là.
        const wentToPens = es?.homeShootout != null && es?.awayShootout != null
        return {
          ...m,
          score: {
            ...m.score,
            fullTime: {
              home: mergeScore(es?.home, lsHome ?? m.score?.fullTime?.home),
              away: mergeScore(es?.away, lsAway ?? m.score?.fullTime?.away),
            },
            ...(wentToPens ? {
              duration: 'PENALTY_SHOOTOUT',
              penalties: { home: es.homeShootout, away: es.awayShootout },
            } : {}),
          },
          status: 'FINISHED',
        }
      })
    return extra.length > 0 ? [...extra, ...fdMatches] : fdMatches
  }, [fdMatches, liveMatches, espnScores, selectedComp])

  const grouped = useMemo(() => groupRounds(matches, 'desc'), [matches])

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

  const total = grouped.length
  // currentIndex peut venir de sessionStorage (restauration après retour
  // arrière) : si la liste de journées a changé depuis, on retombe sur la
  // dernière valide plutôt que de rester bloqué sur un index vide.
  useEffect(() => {
    if (total > 0 && currentIndex >= total) setCurrentIndex(total - 1)
  }, [total, currentIndex])
  const currentGroup    = grouped[currentIndex]
  const currentRoundLabel = currentGroup?.label ?? ''
  const currentMatches  = currentGroup?.matches ?? []

  // Recherche — filtre côté client par nom d'équipe (traduit ou brut).
  function matchesTeamSearch(team) {
    if (!searchNorm) return true
    const translated = translateTeam(team?.shortName || team?.name || '').toLowerCase()
    const raw         = (team?.name ?? '').toLowerCase()
    return translated.includes(searchNorm) || raw.includes(searchNorm)
  }
  // En recherche, on ignore le découpage par journée : on cherche sur
  // TOUS les résultats de la compétition (sinon une équipe absente de la
  // journée affichée semblerait n'avoir aucun résultat).
  const filteredMatches = useMemo(
    () => matches.filter(m => matchesTeamSearch(m.homeTeam) || matchesTeamSearch(m.awayTeam)),
    [matches, searchNorm]
  )
  const filteredWcGroups = useMemo(() => {
    if (!searchNorm) return wcGroups
    return wcGroups.filter(g => groupTeams(matchesByGroup.get(g) ?? []).some(matchesTeamSearch))
  }, [wcGroups, searchNorm, matchesByGroup])

  return (
    <section className="resultats">
      <div className="resultats__backdrop resultats__backdrop--one" />
      <div className="resultats__backdrop resultats__backdrop--two" />

      <div className="resultats__layout">

        {/* ── Mobile : header compétition vedette (Option B) ── */}
        <div className={`compHeader${compOpen ? ' compHeader--open' : ''}`}>
          <div className="compHeader__hero" ref={compHeroRef} onClick={() => setCompOpen(o => !o)}>
            {currentComp?.emblem && (
              <img src={currentComp.emblem} alt="" className="compHeader__logo"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <div className="compHeader__info">
              <span className="compHeader__name">{currentComp?.name}</span>
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
          {compAnchor && createPortal(
            <div
              className={`compHeader__pickerWrap${compOpen ? ' compHeader__pickerWrap--open' : ''}`}
              style={{ top: compAnchor.top, left: compAnchor.left, width: compAnchor.width }}
            >
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
            </div>,
            document.body
          )}
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

          {/* Recherche équipe — filtre côté client */}
          <div className="resultats__searchWrap">
            <input
              type="text"
              className="resultats__searchInput"
              placeholder="Rechercher une équipe…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="resultats__searchClear" onClick={() => setSearch('')} aria-label="Effacer la recherche">✕</button>
            )}
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
            searchNorm ? (
              filteredMatches.length === 0 ? (
                <p className="resultats__state">Aucun résultat ne correspond à « {search} ».</p>
              ) : (
                <div className="resultats__list">
                  {filteredMatches.map(match => <MatchCard key={match.id} match={match} />)}
                </div>
              )
            ) : (
              <>
                <div className="resultats__nav">
                  <button className="resultats__navBtn" onClick={() => setCurrentIndex(i => i + 1)} disabled={currentIndex >= total - 1}>←</button>
                  <span className="resultats__navLabel">{currentRoundLabel}</span>
                  <button className="resultats__navBtn" onClick={() => setCurrentIndex(i => i - 1)} disabled={currentIndex <= 0}>→</button>
                </div>
                <div className="resultats__list">
                  {currentMatches.map(match => <MatchCard key={match.id} match={match} />)}
                </div>
              </>
            )
          )}

          {/* Vue par poule — board de cartes comme dans Programme */}
          {!loading && !error && viewMode === 'poule' && wcGroups.length > 0 && searchNorm && filteredWcGroups.length === 0 && (
            <p className="resultats__state">Aucune équipe ne correspond à « {search} ».</p>
          )}
          {!loading && !error && viewMode === 'poule' && wcGroups.length > 0 && (
            <div className="matchs__wcBoard">
              {filteredWcGroups.map(g => {
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
                            ? <div className="matchs__wcGroupCard__crestWrap" data-crest="country"><img src={t.crest} alt="" className="matchs__wcGroupCard__crest" data-team={t.name} onError={e => e.currentTarget.style.display='none'} /></div>
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
      {openedGroup && (
        <GroupModal
          title={formatGroupName(openedGroup)}
          matches={(matchesByGroup.get(openedGroup) ?? [])
            .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))}
          renderMatch={m => <MatchCard key={m.id} match={m} />}
          emptyMessage="Aucun résultat."
          onClose={() => setOpenedGroup(null)}
        />
      )}

    </section>
  )
}

export default Resultats
