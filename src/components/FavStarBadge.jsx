// Petit badge étoile — signale qu'une équipe favorite (useFavoriteClubs) joue
// dans ce match. Composant partagé (comme WatchBadge) pour éviter de dupliquer
// le path SVG à chaque page qui en a besoin (Programme, Résultats...).
import './favStarBadge.css'

// color : couleur curée de l'équipe favorite concernée (getTeamColor) —
// optionnelle, repli sur l'ambre CSS par défaut si non fournie.
export function FavStarBadge({ variant = 'row', color }) {
  return (
    <span
      className={`favStarBadge favStarBadge--${variant}`}
      style={color ? { color } : undefined}
      aria-label="Équipe favorite"
      title="Équipe favorite"
    >
      <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
        <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
      </svg>
    </span>
  )
}
