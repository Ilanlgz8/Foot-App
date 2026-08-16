import { useNavigate } from 'react-router-dom'
import { useLiveData } from '../context/LiveProvider'
import { isRecentlyFinished, getMatchState } from '../utils/matchStateTracker'
import { COMPETITIONS } from '../data/competitions'
import { useState, useEffect } from 'react'
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

// ⚠️ AJOUT (constat utilisateur : un match disparu normalement — minute →
// "Terminé" → disparition après la fenêtre de grâce — RÉAPPARAISSAIT en
// revenant sur cette page après être passé par l'Accueil) : `isRecentlyFinished`
// (8s, voir matchStateTracker.js) est une fenêtre de temps GLISSANTE, recalculée
// à chaque rendu — rien ne mémorisait qu'un match donné avait déjà fini de
// s'afficher et de disparaître une première fois. Si `liveMatches` (voir
// liveTracker.js) contient encore l'entrée (elle survit 5min après confirmFt,
// volontairement, pour laisser le temps à FD.org de rattraper classement/forme
// — voir le commentaire dans useLiveMinute.js) et que N'IMPORTE QUEL chemin la
// re-touche entre-temps (ex. un repli FD.org qui rappelle markLive() sur une
// donnée obsolète, plusieurs existent dans useLiveMinute.js), Live.jsx n'avait
// aucun moyen de savoir qu'il avait déjà tranché "disparu" pour CE match — la
// fenêtre de 8s pouvait retomber "vraie" à un remount, ou la re-render suivante
// recalculait tout depuis zéro sans mémoire du passé. Correctif : mémoriser en
// dehors du composant (donc survit aux montages/démontages de cette page —
// contrairement à un useState/useRef, recréé à chaque retour ici) le
// termineAt déjà "vu disparaître" par match — un match ne réapparaît alors plus
// pour CE MÊME événement de fin, quoi qu'il se passe ailleurs entre-temps.
// N'empêche PAS une vraie résurrection légitime (faux FT corrigé, voir
// isFalseEndedReversal dans useLiveMinute.js) : dans ce cas `ft` repasse à
// false, on nettoie alors l'entrée mémorisée et le match redevient visible
// normalement via le statut IN_PLAY/PAUSED, sans attendre un nouveau
// événement de fin. Remis à zéro au rechargement complet de l'app (state
// module-level, pas persisté) — comportement acceptable, un reload repart
// sur des bases saines de toute façon.
const _dismissedFt = new Map() // matchId → termineAt déjà affiché "disparu"

// ── Page Live ─────────────────────────────────────────────────────────────────
export default function Live() {
  const navigate = useNavigate()
  const { liveMatches, espnScores } = useLiveData()

  // Ticker dédié : force un re-render toutes les secondes tant qu'un match
  // vient de passer "Terminé" (fenêtre de grâce, voir isRecentlyFinished) —
  // sans ça, rien ne déclenche le retrait de la card une fois la fenêtre
  // passée (le ticker interne de LiveCard s'arrête lui-même dès isTermine).
  // S'arrête tout seul dès qu'il n'y a plus aucun match dans la fenêtre.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!liveMatches.some(m => isRecentlyFinished(m.id))) return
    const id = setInterval(() => {
      forceTick(n => n + 1)
      if (!liveMatches.some(m => isRecentlyFinished(m.id))) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [liveMatches])

  // ⚠️ BUG CORRIGÉ (constat utilisateur : le widget reste affiché ~5min après
  // la fin du match au lieu de disparaître direct, comme la card de
  // l'Accueil) : `m.status` vient de liveTracker.js, qui le fige à 'IN_PLAY'
  // dès markLive() et ne le change JAMAIS ensuite (voir markLive) — seule la
  // suppression de l'entrée (markEnded, appelé 5min après confirmFt dans
  // useLiveMinute.js, délai volontaire pour laisser une 2e chance à FD.org
  // de rattraper classement/forme/buteurs, pas lié à l'affichage) fait sortir
  // le match de `liveMatches`. Tant que l'entrée existe, `m.status ===
  // 'IN_PLAY'` est TOUJOURS vrai, donc le filtre gardait le match jusqu'à ces
  // 5min quoi qu'il arrive — `isRecentlyFinished(m.id)` (8s) n'avait jamais
  // vraiment d'effet, le 1er terme du OR était déjà toujours vrai. Fix : dès
  // que `ft` est confirmé, on ne se fie plus à `m.status` — seul
  // isRecentlyFinished (8s, même repère que la sortie auto de LiveMatchPage)
  // décide si le widget reste encore un instant ou disparaît.
  const live = liveMatches.filter(m => {
    const state = getMatchState(m.id)
    if (state.ft === true) {
      // Déjà affiché "disparu" pour CE MÊME événement de fin (voir
      // _dismissedFt ci-dessus) → ne jamais revenir, peu importe ce qui a pu
      // re-toucher liveMatches entre-temps.
      if (_dismissedFt.get(m.id) === state.termineAt) return false
      const recent = isRecentlyFinished(m.id)
      if (!recent) _dismissedFt.set(m.id, state.termineAt)
      return recent
    }
    // ft redevenu false (résurrection légitime, faux FT corrigé) → oublier
    // un éventuel dismiss précédent, sinon un match qui reprend vraiment
    // resterait bloqué invisible.
    if (_dismissedFt.has(m.id)) _dismissedFt.delete(m.id)
    return m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'SCHEDULED'
  })

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
