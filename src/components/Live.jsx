import { useNavigate } from 'react-router-dom'
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
  // plusieurs pages. Repris ici à l'identique : ce widget disparaît
  // maintenant instantanément dès que `ft` passe à `true` (perd le court
  // affichage "Terminé" avant disparition, un compromis assumé pour ne plus
  // jamais revoir ce flicker) — plus besoin de ticker dédié non plus, un
  // nouveau statut arrive de toute façon au rythme normal du poll ESPN/FD.org
  // (LiveProvider), exactement comme pour la card Accueil.
  const live = liveMatches.filter(isCardLive)

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
