/**
 * FavoriteTeamsPanel.jsx
 *
 * Popover ouvert depuis la cloche de notifications : choix des équipes
 * suivies (filtre des notifs push) + accès à l'activation/désactivation.
 * Les favoris sont stockés en local (useFavoriteTeams) et renvoyés au
 * serveur (resyncFavoriteTeams) à chaque changement, pour que le filtre
 * de cron-goals.js prenne effet tout de suite.
 */
import { useFavoriteTeams } from '../hooks/useFavoriteTeams'
import { resyncFavoriteTeams } from '../hooks/usePushNotifications'
import { NATIONAL_TEAMS_SORTED } from '../data/nationalTeams'
import '../favoriteTeamsPanel.css'

export default function FavoriteTeamsPanel({ status, subscribe, unsubscribe, onClose }) {
  const { favorites, toggle } = useFavoriteTeams()
  const isSubscribed = status === 'subscribed'
  const isLoading    = status === 'loading'

  const handleToggle = (key) => {
    toggle(key)
    if (isSubscribed) resyncFavoriteTeams()
  }

  return (
    <div className="fav-panel" onClick={e => e.stopPropagation()}>
      <div className="fav-panel__header">
        <span>Équipes suivies</span>
        <button className="fav-panel__close" onClick={onClose} aria-label="Fermer" type="button">×</button>
      </div>

      <p className="fav-panel__hint">
        {favorites.length === 0
          ? "Aucune sélection = tu reçois les notifs de tous les matchs."
          : `Tu ne recevras les notifs que pour ces ${favorites.length} équipe${favorites.length > 1 ? 's' : ''}.`}
      </p>

      <div className="fav-panel__list">
        {NATIONAL_TEAMS_SORTED.map(({ key, label }) => (
          <label key={key} className="fav-panel__item">
            <input
              type="checkbox"
              checked={favorites.includes(key)}
              onChange={() => handleToggle(key)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div className="fav-panel__footer">
        {isSubscribed
          ? <button className="fav-panel__unsub" onClick={unsubscribe} disabled={isLoading} type="button">
              Désactiver les notifications
            </button>
          : <button className="fav-panel__sub" onClick={subscribe} disabled={isLoading} type="button">
              {isLoading ? 'Activation…' : 'Activer les notifications'}
            </button>}
      </div>
    </div>
  )
}
