import { PanelSkeleton } from './MatchCard'
import { ResultHeroCard } from './ResultHeroCard'

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

// Retour utilisateur : plus de navigation vers les jours passés dans ce
// panneau compact (l'historique complet existe déjà sur /resultats) — on
// affiche uniquement les résultats reçus via `results` (filtrés sur
// aujourd'hui côté Accueil.jsx), triés du plus récent au plus ancien.
export function ResultPanel({ results, loading, view = 'chrono' }) {
  const sorted = [...results].sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
  const compGroups = groupByComp(sorted)

  return (
    <div className="accueil__dashPanelBody">
      {loading && <PanelSkeleton />}
      {!loading && sorted.length === 0 && (
        <div className="accueil__tickerEmpty">
          <span className="accueil__tickerEmptyIcon" aria-hidden="true">⚽</span>
          <p className="accueil__tickerEmptyTitle">Aucun résultat aujourd'hui</p>
        </div>
      )}

      {/* Chronologique */}
      {!loading && view === 'chrono' && sorted.length > 0 && (
        <div className="accueil__matchCards">
          {sorted.map((match, i) => (
            <ResultHeroCard key={match.id ?? i} match={match} />
          ))}
        </div>
      )}

      {/* Par compétition */}
      {!loading && view === 'comp' && sorted.length > 0 && (
        <div className="accueil__compGroups">
          {compGroups.map(({ name, matches }) => (
            <div key={name} className="accueil__compGroup">
              <p className="accueil__compGroupTitle">{name}</p>
              <div className="accueil__matchCards">
                {matches.map((match, i) => (
                  <ResultHeroCard key={match.id ?? i} match={match} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
