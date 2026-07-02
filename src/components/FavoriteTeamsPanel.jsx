/**
 * FavoriteTeamsPanel.jsx
 *
 * Popover ouvert depuis la cloche de notifications : choix des CHAMPIONNATS
 * suivis (filtre des notifs push) + accès à l'activation/désactivation.
 * Les favoris sont stockés en local (useFavoriteTeams, valeur = slug ESPN de
 * la compétition) et renvoyés au serveur (resyncFavoriteTeams) à chaque
 * changement, pour que le filtre de cron-goals.js prenne effet tout de suite.
 */
import { forwardRef } from 'react'
import { useFavoriteTeams } from '../hooks/useFavoriteTeams'
import { resyncFavoriteTeams } from '../hooks/usePushNotifications'
import { COMPETITIONS, COMPETITION_ESPN_SLUG } from '../data/competitions'
import '../favoriteTeamsPanel.css'

const FavoriteTeamsPanel = forwardRef(function FavoriteTeamsPanel(
  { status, subscribe, unsubscribe, onClose, anchor }, ref
) {
  const { favorites, toggle } = useFavoriteTeams()
  const isSubscribed = status === 'subscribed'
  const isLoading    = status === 'loading'

  const handleToggle = (key) => {
    toggle(key)
    if (isSubscribed) resyncFavoriteTeams()
  }

  // Positionné en `fixed` (portail dans <body>) à partir des coordonnées
  // réelles de la cloche — voir commentaire dans NotificationBell.jsx.
  const style = anchor ? { top: anchor.top, right: anchor.right } : undefined

  return (
    <div ref={ref} className="fav-panel" style={style} onClick={e => e.stopPropagation()}>
      <div className="fav-panel__header">
        <span>Championnats suivis</span>
        <button className="fav-panel__close" onClick={onClose} aria-label="Fermer" type="button">×</button>
      </div>

      <p className="fav-panel__hint">
        {favorites.length === 0
          ? "Aucune sélection = tu reçois les notifs de tous les championnats."
          : `Tu ne recevras les notifs que pour ces ${favorites.length} championnat${favorites.length > 1 ? 's' : ''}.`}
      </p>

      <div className="fav-panel__list">
        {COMPETITIONS.map((comp) => {
          const slug = COMPETITION_ESPN_SLUG[comp.id]
          if (!slug) return null
          return (
            <label key={comp.id} className="fav-panel__item">
              <input
                type="checkbox"
                checked={favorites.includes(slug)}
                onChange={() => handleToggle(slug)}
              />
              {comp.emblem && <img src={comp.emblem} alt="" className="fav-panel__emblem" />}
              <span>{comp.shortName}</span>
            </label>
          )
        })}
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
})

export default FavoriteTeamsPanel
