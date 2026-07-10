import { getFreeBroadcaster } from '../data/broadcasters'
import './watchBadge.css'

/**
 * Petit badge "Gratuit · {chaîne}" — affiché UNIQUEMENT quand on a une info
 * vérifiée (voir src/data/broadcasters.js). Ne rend rien sinon, volontairement :
 * mieux vaut ne rien afficher que d'inventer/deviner un diffuseur.
 *
 * variant: 'hero' (coin haut-droit du bandeau LiveMatchPage/MatchPage) ou
 * 'row' (coin haut-droit d'une ligne de Match.jsx).
 */
export function WatchBadge({ match, variant = 'hero' }) {
  const b = getFreeBroadcaster(match)
  if (!b) return null
  return (
    <a
      href={b.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`watchBadge watchBadge--${variant}`}
      onClick={e => e.stopPropagation()}
      title={`Regarder gratuitement sur ${b.name}`}
    >
      <span className="watchBadge__dot" />
      Gratuit · {b.name}
    </a>
  )
}
