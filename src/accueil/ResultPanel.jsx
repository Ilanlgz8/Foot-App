import { PanelSkeleton } from './MatchCard'
// ⚠️ REVU (retour utilisateur : "même style que les cards dans résultats")
// : ResultHeroCard.jsx (propre à ce panneau) remplacé par ResultCard.jsx —
// même card que la page Résultats (Resultat.jsx, navigation par championnat
// ET onglet "Tous"), extraite dans components/ pour être partagée par les
// deux. showComp passé partout ici : ce panneau mélange déjà plusieurs
// compétitions (comme l'onglet "Tous"), le badge championnat y a donc sa
// place — voir ResultCard.jsx pour le détail complet.
import { ResultCard } from '../components/ResultCard'
import { usePersistedState, NAV_POSITION_TTL } from '../hooks/usePersistedState'

// Rétabli (retour utilisateur : la navigation par jour — aujourd'hui ⇄ hier —
// avait été retirée par erreur suite à un malentendu ; l'utilisateur veut
// bien pouvoir consulter les résultats des jours précédents ici).
function groupByDay(matches) {
  const groups = {}
  matches.forEach(m => {
    const day = m.utcDate.slice(0, 10)
    if (!groups[day]) groups[day] = []
    groups[day].push(m)
  })
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, ms]) => [day, ms.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))])
}

function groupByComp(matches) {
  const groups = {}
  matches.forEach(m => {
    const key  = m.competition?.id ?? 'other'
    const name = m.competition?.name ?? 'Autre'
    if (!groups[key]) groups[key] = { name, matches: [] }
    groups[key].matches.push(m)
  })
  return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name))
}

function formatDayLabel(dateStr) {
  const today     = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
  if (dateStr === today)     return "Aujourd'hui"
  if (dateStr === yesterday) return 'Hier'
  return new Date(dateStr).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

// matchesByComp n'est plus utilisé ici : ResultCard résout les blasons
// directement depuis match.homeTeam/awayTeam (pas besoin de cross-matching
// FD.org comme ResultHeroCard avant). Accueil.jsx continue de le passer
// (encore utilisé par MatchPanel pour les matchs à venir) — prop simplement
// ignorée ici, rien à casser côté appelant.
export function ResultPanel({ results, loading, view = 'chrono' }) {
  const grouped  = groupByDay(results)
  // ⚠️ BUG CORRIGÉ (constat utilisateur : après avoir navigué jusqu'à un
  // jour précédent (ex: 8 juillet), cliqué sur un match, puis "retour",
  // ce panneau repartait à "Aujourd'hui" au lieu de rester sur le 8 juillet)
  // : `dayIndex` était un simple useState, jamais persisté. Accueil.jsx (le
  // parent) est entièrement démonté à chaque changement de route
  // (key={location.pathname} dans App.jsx), donc CE composant repart
  // toujours de zéro au retour, même avec le fix scroll (App.jsx) — deux
  // bugs différents, l'un sur la position de scroll, l'autre sur l'état
  // "quel jour est affiché ici". On persiste la DATE elle-même (pas
  // l'index : `grouped` peut changer de taille si un nouveau jour de
  // résultats apparaît, ce qui décalerait tous les index suivants — même
  // raison que le fix équivalent dans Resultat.jsx) et on retrouve l'index
  // correspondant à chaque render.
  // TTL : voir usePersistedState.js. C'est aussi la cause la plus probable du
  // "je n'ai que les résultats d'aujourd'hui" signalé après une réinstallation
  // de la PWA : le jour affiché restait figé sur celui de la dernière visite.
  const [currentDayStr, setCurrentDayStr] = usePersistedState('accueil_resultDay', null, NAV_POSITION_TTL)
  const foundIdx = currentDayStr != null ? grouped.findIndex(([day]) => day === currentDayStr) : -1
  const dayIndex = foundIdx >= 0 ? foundIdx : 0

  const currentDay     = grouped[dayIndex]
  const dayLabel       = currentDay ? formatDayLabel(currentDay[0]) : null
  const currentMatches = currentDay ? currentDay[1] : []
  const canGoBack      = dayIndex < grouped.length - 1
  const canGoForward   = dayIndex > 0

  const goToDayIndex = (i) => {
    const g = grouped[i]
    if (g) setCurrentDayStr(g[0])
  }

  const compGroups = groupByComp(currentMatches)

  return (
    <>
      <div className="accueil__resultNav">
        <button className="accueil__dayArrow" onClick={() => goToDayIndex(dayIndex + 1)} disabled={!canGoBack} aria-label="Jour précédent">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="accueil__resultNavLabel">{dayLabel ?? '—'}</span>
        <button className="accueil__dayArrow" onClick={() => goToDayIndex(dayIndex - 1)} disabled={!canGoForward} aria-label="Jour suivant">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <div className="accueil__dashPanelDivider" />
      <div className="accueil__dashPanelBody">
        {loading && <PanelSkeleton />}
        {!loading && results.length === 0 && (
          <div className="accueil__tickerEmpty">
            <span className="accueil__tickerEmptyIcon" aria-hidden="true">⚽</span>
            <p className="accueil__tickerEmptyTitle">Aucun résultat disponible</p>
          </div>
        )}

        {/* Chronologique */}
        {!loading && view === 'chrono' && currentMatches.length > 0 && (
          <div className="accueil__matchCards">
            {currentMatches.map((match, i) => (
              <ResultCard key={match.id ?? i} match={match} showComp />
            ))}
          </div>
        )}

        {/* Par compétition */}
        {!loading && view === 'comp' && currentMatches.length > 0 && (
          <div className="accueil__compGroups">
            {compGroups.map(({ name, matches }) => (
              <div key={name} className="accueil__compGroup">
                <p className="accueil__compGroupTitle">{name}</p>
                <div className="accueil__matchCards">
                  {matches.map((match, i) => (
                    <ResultCard key={match.id ?? i} match={match} showComp />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </>
  )
}
