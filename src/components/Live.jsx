import { useNavigate } from 'react-router-dom'
import { useLiveData } from '../context/LiveProvider'
import { isRecentlyFinished } from '../utils/matchStateTracker'
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

  const live = liveMatches.filter(m =>
    m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'SCHEDULED' || isRecentlyFinished(m.id)
  )

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
