import { getBroadcaster } from '../data/broadcasters'
import './watchBadge.css'

/**
 * Petit badge diffuseur — affiché UNIQUEMENT quand on a une info vérifiée
 * (voir src/data/broadcasters.js). Ne rend rien sinon, volontairement :
 * mieux vaut ne rien afficher que d'inventer/deviner un diffuseur.
 *
 * ⚠️ ÉTENDU (28/08, demande utilisateur) : getFreeBroadcaster → getBroadcaster
 * (couvre aussi les diffuseurs payants, pas seulement le cas gratuit M6/WC).
 * Style différent selon `free` : vert "Gratuit · X" pour le seul cas gratuit
 * confirmé, neutre "Sur X" pour un abonnement payant — jamais la même
 * couleur, pour ne pas laisser croire à tort qu'un match payant est gratuit.
 *
 * variant: 'hero' (bandeau LiveMatchPage/MatchPage) ou 'row' (ligne de
 * Match.jsx). Non cliquable quand aucune URL n'est connue (diffuseurs
 * payants : juste une info pratique, pas une offre "regarder maintenant").
 */
export function WatchBadge({ match, variant = 'hero' }) {
  const b = getBroadcaster(match)
  if (!b) return null
  const className = `watchBadge watchBadge--${variant}${b.free ? '' : ' watchBadge--paid'}`
  const label = b.free ? `Gratuit · ${b.name}` : `Sur ${b.name}`
  const content = (
    <>
      <span className="watchBadge__dot" />
      {label}
    </>
  )
  if (!b.url) {
    return <span className={className}>{content}</span>
  }
  return (
    <a
      href={b.url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={e => e.stopPropagation()}
      title={`Regarder gratuitement sur ${b.name}`}
    >
      {content}
    </a>
  )
}
