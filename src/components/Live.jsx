import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useLiveData } from '../context/LiveProvider'
import { isCardLive } from '../utils/matchUtils'
import { COMPETITIONS } from '../data/competitions'
import { LiveCard } from './LiveCardWidget'
import '../live.css'

// Regroupe les matchs live par championnat — un seul badge compétition par
// section au lieu d'un par card (redondant).
// Ordre (retour utilisateur) : Coupe du Monde toujours en tête (pas un
// "championnat" club à proprement parler), puis Ligue 1 en premier parmi les
// championnats club, puis le reste par ordre alphabétique.
const SECTION_PRIORITY = { WC: 0, FL1: 1 }
function groupByCompetition(matches) {
  const map = new Map()
  for (const m of matches) {
    const code   = m.competition?.code ?? 'AUTRE'
    const comp   = COMPETITIONS.find(c => c.id === code)
    const name   = comp?.name ?? m.competition?.name ?? 'Autre compétition'
    const emblem = comp?.emblem ?? m.competition?.emblem ?? null
    if (!map.has(code)) map.set(code, { code, name, emblem, matches: [] })
    map.get(code).matches.push(m)
  }
  return [...map.values()].sort((a, b) => {
    const pa = SECTION_PRIORITY[a.code] ?? 2
    const pb = SECTION_PRIORITY[b.code] ?? 2
    if (pa !== pb) return pa - pb
    return a.name.localeCompare(b.name, 'fr')
  })
}

// ── Page Live ─────────────────────────────────────────────────────────────────
export default function Live() {
  const navigate = useNavigate()
  const { liveMatches, espnScores } = useLiveData()

  // ⚠️ REVU EN PROFONDEUR (constat utilisateur, 20/08 : "quand le match est
  // terminé, la card du match dans Accueil a le bon comportement [même si
  // l'app était en arrière-plan à ce moment-là] — fait en sorte que le
  // widget dans la page live ait le même comportement") : l'ancienne version
  // utilisait `shouldShowLiveWidget` (matchStateTracker.js) — une fenêtre de
  // grâce de 8s avec mémoire anti-réapparition (`_dismissedFt`), pensée pour
  // afficher "Terminé" un court instant avant de disparaître. Complexité
  // avec état PARTAGÉ entre plusieurs pages + dépendante du bon minutage
  // d'un ticker dédié sur CHAQUE page qui l'utilise — plusieurs correctifs
  // successifs sur cette même zone n'ont jamais éliminé le flicker
  // "continue / Terminé mais reste / disparaît puis revient" que
  // l'utilisateur continuait de constater précisément ici.
  // La card classique de l'Accueil (MatchCard.jsx/MatchPoster.jsx), elle,
  // n'a jamais ce problème — parce qu'elle utilise `isCardLive` (matchUtils.js),
  // un simple dérivé STATELESS de l'état courant (`ft === true` → plus live,
  // point final), sans fenêtre de temps ni mémoire à synchroniser entre
  // plusieurs pages.
  //
  // ⚠️ AJUSTEMENT (constat utilisateur, même jour : "affiche 'Terminé' si on
  // est sur la page au moment où le match se termine, et une seconde après
  // ça disparaît — comme ça l'utilisateur comprend bien que le match est
  // fini") : le stateless pur ci-dessus (isCardLive seul) fait disparaître le
  // widget instantanément, sans transition visible, même quand on regarde la
  // page en direct au moment précis où ça se termine — moins clair pour
  // l'utilisateur que "Terminé" un court instant. Différence clé avec l'ancien
  // `shouldShowLiveWidget` (qui causait le flicker) : cette mémoire est
  // 100% LOCALE à ce montage de page (useState/useRef, jamais partagée avec
  // navbar.jsx/Accueil.jsx, jamais lue au premier rendu) — un match déjà
  // terminé AVANT l'ouverture de cette page n'y entre jamais (justEndedIds
  // démarre vide, prevLiveIds aussi), donc aucun risque de rejouer une
  // transition déjà vue ailleurs ni de resynchroniser un état entre pages —
  // exactement la source du bug précédent. Seule une transition VUE EN DIRECT
  // pendant que cette page reste montée (live → plus dans isCardLive d'un
  // render à l'autre) déclenche le délai d'1s avant retrait.
  const [justEndedIds, setJustEndedIds] = useState(() => new Set())
  const prevLiveIdsRef = useRef(new Set())
  // Map id → handle setTimeout, dans un ref pour survivre aux re-renders SANS
  // être annulée à chaque nouveau poll ESPN (voir 2e effet plus bas — un
  // cleanup ici, à chaque ré-exécution de CET effet, annulerait le timer d'un
  // match déjà "justEnded" si un poll arrive dans la même seconde, le
  // laissant bloqué sur "Terminé" pour toujours, plus aucun code pour le
  // retirer).
  const timersRef = useRef(new Map())
  useEffect(() => {
    const currentlyLiveIds = new Set(liveMatches.filter(isCardLive).map(m => m.id))
    const justEnded = [...prevLiveIdsRef.current].filter(id => !currentlyLiveIds.has(id))
    prevLiveIdsRef.current = currentlyLiveIds
    if (justEnded.length === 0) return
    setJustEndedIds(prev => new Set([...prev, ...justEnded]))
    justEnded.forEach(id => {
      const handle = setTimeout(() => {
        timersRef.current.delete(id)
        setJustEndedIds(prev => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 1_000)
      timersRef.current.set(id, handle)
    })
  }, [liveMatches])
  // Cleanup uniquement au démontage de la page (deps vides) — pas à chaque
  // poll, voir le commentaire ci-dessus.
  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  const live = liveMatches.filter(m => isCardLive(m) || justEndedIds.has(m.id))

  return (
    <section className="live__page">
      <div className="live__pageInner">

        {/* Header */}
        <div className="live__pageHeader">
          <button className="live__backBtn" onClick={() => navigate(-1)}>
            ‹ Retour
          </button>
          <div className="live__pageTitleWrap">
            <span className="live__pageDot" />
            <h1 className="live__pageTitle">En Direct</h1>
            <span className="live__pageCount">{live.length}</span>
          </div>
        </div>

        {/* Grille */}
        {live.length === 0 ? (
          <div className="live__empty">
            <span className="live__emptyIcon" aria-hidden="true">⚽</span>
            <p className="live__emptyTitle">Aucun match en direct</p>
            <p className="live__emptyHint">Reviens à l'heure du coup d'envoi pour suivre les scores en temps réel.</p>
            <button className="live__emptyCta" onClick={() => navigate('/matchs')}>
              Voir le programme →
            </button>
          </div>
        ) : (
          groupByCompetition(live).map(group => (
            <div key={group.code} className="live__section">
              <div className="live__sectionHeader">
                {group.emblem && <img src={group.emblem} alt="" className="live__sectionLogo" />}
                <span className="live__sectionName">{group.name}</span>
                <span className="live__sectionCount">{group.matches.length} en direct</span>
              </div>
              <div className="live__grid">
                {group.matches.map(match => (
                  <LiveCard
                    key={match.id}
                    match={match}
                    espn={espnScores[match.id] ?? null}
                    onClick={() => navigate(`/live/${match.id}`)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
