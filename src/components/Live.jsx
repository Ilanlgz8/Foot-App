// Page Match (route /live) — remplace l'ancienne page "En Direct" (04/11, demande
// utilisateur). Deux onglets :
//   • En direct       : les matchs en cours, regroupés par compétition
//   • Tous les matchs : le programme du jour (flèches de jour comme sur l'Accueil)
// Chaque compétition est enveloppée dans son cocon coloré ; chaque match est
// affiché en "Ligne" (fine) ou en "Card" (les vraies cards de l'Accueil), au choix.
// Un match terminé n'apparaît plus ici : son résultat est dans Résultats.
import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { isCardLive, isUnfollowedCupMatch } from '../utils/matchUtils'
import { getMatchState, isRecentlyFinished } from '../utils/matchStateTracker'
import { useMatchDay } from '../hooks/useMatchDay'
import { getDayLabel } from '../utils/dayUtils'
import { groupMatchesByCompetition } from '../utils/competitionGroups'
import { Cocoon } from '../hub/Cocoon'
import { MatchRow } from '../hub/MatchRow'
import { LazyPoster } from '../accueil/MatchCard'
import '../accueil.css'
import '../live.css'
import '../hub/hub.css'

const VIEW_KEY = 'foot_matchView'
const readView = () => {
  try { return localStorage.getItem(VIEW_KEY) === 'card' ? 'card' : 'row' } catch { return 'row' }
}
const nbMatchs = n => `${n} match${n > 1 ? 's' : ''}`

// Un match terminé quitte la liste quelques secondes après son coup de sifflet
// (même règle que `stillVisibleToday` de l'Accueil).
const stillVisible = m =>
  m != null && m.status !== 'FINISHED' && !isUnfollowedCupMatch(m) &&
  (getMatchState(m.id).ft ? isRecentlyFinished(m.id) : true)

function dayDateLabel(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ── Page Match ────────────────────────────────────────────────────────────────
export default function Live() {
  const navigate = useNavigate()
  const location = useLocation()
  const initial = location.state ?? {}

  const [dayOffset, setDayOffset] = useState(() => Number.isInteger(initial.dayOffset) ? initial.dayOffset : 0)
  const [view, setView] = useState(readView)
  const [closed, setClosed] = useState(() => new Set())

  // Données : "En direct" ne dépend pas du jour affiché, on charge alors celles d'aujourd'hui.
  const [tab, setTab] = useState(initial.tab ?? null)
  const {
    matches: dayMatches, loading, espnScores, liveMatches,
    formMapByComp, matchesByComp, nextMatchDayOffset, prevMatchDayOffset,
  } = useMatchDay(tab === 'prog' ? dayOffset : 0)

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
  // ⚠️ AJOUT (retour utilisateur direct : ça clignote ENCORE — disparaît/
  // réapparaît plusieurs fois sur ~2min après la vraie fin, malgré isCardLive
  // stateless) : isCardLive dépend de `ms.ft` (matchStateTracker, écrit par
  // confirmFt côté useLiveMinute.js) — confirmFt peut être ré-invoqué
  // plusieurs fois pour LA MÊME fin réelle par différents garde-fous
  // (pendingFt timeout, durée max live, FD.org FINISHED, disparu du
  // scoreboard...), avec une fenêtre de latence entre chacun où l'état
  // sous-jacent peut transitoirement redevenir ambigu. isCardLive seul n'a
  // aucune mémoire : chaque poll (10-30s) le réévalue à zéro, donc un aller-
  // retour même bref dans la donnée source se répercute directement à
  // l'écran. permanentlyEndedIds mémorise, pour la durée du montage de CETTE
  // page (même principe déjà appliqué à justEndedIds/timersRef juste
  // au-dessus — état 100% local, aucun risque de resynchronisation entre
  // pages), tout match déjà vu transitionner live→fini au moins une fois :
  // une fois dedans, il n'est plus jamais réintégré à l'affichage pour ce
  // montage de page, quoi que rapporte isCardLive ensuite.
  // État (pas un ref) : sa valeur conditionne directement ce qui s'affiche
  // (currentlyLiveIds/live plus bas) — un ref ne déclenche aucun re-render à
  // sa mutation et ne doit de toute façon pas être lu pendant le rendu
  // (react-hooks/refs).
  const [permanentlyEndedIds, setPermanentlyEndedIds] = useState(() => new Set())
  // Battement 1s tant qu'il y a du direct : `isCardLive` (stateless) est réévalué même si aucun poll
  // n'a modifié le contexte entre-temps — un match qui vient de finir part donc tout de suite.
  const [liveBeat, setLiveBeat] = useState(0)
  const hasTracked = liveMatches.length > 0
  useEffect(() => {
    if (!hasTracked) return
    const id = setInterval(() => setLiveBeat(b => b + 1), 1000)
    return () => clearInterval(id)
  }, [hasTracked])
  useEffect(() => {
    const currentlyLiveIds = new Set(
      liveMatches.filter(m => isCardLive(m) && !permanentlyEndedIds.has(m.id)).map(m => m.id)
    )
    const justEnded = [...prevLiveIdsRef.current].filter(id => !currentlyLiveIds.has(id))
    prevLiveIdsRef.current = currentlyLiveIds
    if (justEnded.length === 0) return
    setPermanentlyEndedIds(prev => new Set([...prev, ...justEnded]))
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
  }, [liveMatches, permanentlyEndedIds, liveBeat])
  // Cleanup uniquement au démontage de la page (deps vides) — pas à chaque
  // poll, voir le commentaire ci-dessus.
  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  const live = liveMatches.filter(m =>
    (isCardLive(m) && !permanentlyEndedIds.has(m.id)) || justEndedIds.has(m.id)
  )


  // Onglet par défaut : "En direct" s'il y a du direct, sinon le programme.
  const hasLive = live.length > 0
  const activeTab = tab ?? (hasLive ? 'live' : 'prog')

  // Seconde de grâce : tant qu'un match vient de finir, on rafraîchit chaque seconde
  // pour qu'il disparaisse de la liste sans attendre le prochain poll.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!dayMatches.some(m => isRecentlyFinished(m.id))) return
    const id = setInterval(() => {
      setTick(t => t + 1)
      if (!dayMatches.some(m => isRecentlyFinished(m.id))) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [dayMatches])

  const progMatches = dayOffset === 0
    ? dayMatches.filter(stillVisible)
    : dayMatches.filter(m => m.status !== 'FINISHED')

  const onMatchClick = useCallback(m => navigate(`/match/${m.id}`, { state: { match: m } }), [navigate])
  const onLiveClick  = useCallback(m => navigate(`/live/${m.id}`), [navigate])

  const changeView = v => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* stockage indisponible : le choix vaut pour cette visite */ }
  }
  const toggleGroup = key => setClosed(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const renderMatches = list => view === 'card' ? (
    <div className="hubPosters">
      {list.map(m => (
        <LazyPoster
          key={m.id}
          match={m}
          espnScore={espnScores[m.id] ?? null}
          live={isCardLive(m)}
          onMatchClick={onMatchClick}
          onLiveClick={onLiveClick}
          formMap={formMapByComp?.[m.competition?.code] ?? null}
          compMatches={matchesByComp?.[m.competition?.code] ?? null}
        />
      ))}
    </div>
  ) : list.map(m => (
    <MatchRow
      key={m.id}
      match={m}
      espnScore={espnScores[m.id] ?? null}
      live={isCardLive(m)}
      onMatchClick={onMatchClick}
      onLiveClick={onLiveClick}
      compMatches={matchesByComp?.[m.competition?.code] ?? null}
    />
  ))

  const viewSwitch = (
    <div className="hubSeg hubSeg--mini" role="group" aria-label="Affichage">
      <button type="button" className={view === 'row' ? 'is-on' : ''} onClick={() => changeView('row')}>Ligne</button>
      <button type="button" className={view === 'card' ? 'is-on' : ''} onClick={() => changeView('card')}>Card</button>
    </div>
  )

  return (
    <section className="live__page">
      <div className="mh">
        <h1 className="mh__title">Match</h1>

        <div className="hubSeg" role="tablist">
          <button type="button" role="tab" aria-selected={activeTab === 'live'} className={activeTab === 'live' ? 'is-on' : ''} onClick={() => setTab('live')}>
            En direct{hasLive && <span className="hubSeg__cnt">{live.length}</span>}
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'prog'} className={activeTab === 'prog' ? 'is-on' : ''} onClick={() => setTab('prog')}>
            Tous les matchs
          </button>
        </div>

        {activeTab === 'live' && (
          !hasLive ? (
            <div className="hubEmpty">
              <b>Aucun match en direct</b>
              Reviens à l'heure du coup d'envoi pour suivre les scores en temps réel.
              <br />
              <button type="button" onClick={() => setTab('prog')}>Voir tous les matchs →</button>
            </div>
          ) : (
            <>
              <div className="hubTools hubTools--end">{viewSwitch}</div>
              {groupMatchesByCompetition(live).map(g => (
                <Cocoon key={g.key} group={g} count={`${g.matches.length} en direct`}>
                  {renderMatches(g.matches)}
                </Cocoon>
              ))}
            </>
          )
        )}

        {activeTab === 'prog' && (
          <>
            <div className="hubTools">
              <div className="hubDay">
                <button type="button" className="hubDay__arrow" aria-label="Jour précédent"
                  disabled={prevMatchDayOffset == null}
                  onClick={() => { if (prevMatchDayOffset != null) setDayOffset(prevMatchDayOffset) }}>‹</button>
                <div className="hubDay__label">
                  {getDayLabel(dayOffset)}
                  <small>{dayDateLabel(dayOffset)}</small>
                </div>
                <button type="button" className="hubDay__arrow" aria-label="Jour suivant"
                  disabled={nextMatchDayOffset == null}
                  onClick={() => { if (nextMatchDayOffset != null) setDayOffset(nextMatchDayOffset) }}>›</button>
              </div>
              {viewSwitch}
            </div>

            {loading && progMatches.length === 0 ? (
              <div className="hubEmpty">Chargement des matchs…</div>
            ) : progMatches.length === 0 ? (
              <div className="hubEmpty">
                <b>{dayOffset === 0 ? "Plus de match à suivre aujourd'hui" : 'Aucun match ce jour-là'}</b>
                Les matchs terminés sont dans « Résultats ».
                {nextMatchDayOffset != null && (
                  <>
                    <br />
                    <button type="button" onClick={() => setDayOffset(nextMatchDayOffset)}>Prochain jour de matchs →</button>
                  </>
                )}
              </div>
            ) : (
              groupMatchesByCompetition(progMatches).map(g => (
                <Cocoon
                  key={g.key}
                  group={g}
                  count={nbMatchs(g.matches.length)}
                  open={!closed.has(g.key)}
                  onToggle={() => toggleGroup(g.key)}
                >
                  {renderMatches(g.matches)}
                </Cocoon>
              ))
            )}
          </>
        )}
      </div>
    </section>
  )
}
