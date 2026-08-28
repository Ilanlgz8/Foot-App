import { getBroadcaster } from '../data/broadcasters'
import './watchBadge.css'

/**
 * Petit badge diffuseur — affiché UNIQUEMENT quand on a une info vérifiée
 * (voir src/data/broadcasters.js). Ne rend rien sinon, volontairement :
 * mieux vaut ne rien afficher que d'inventer/deviner un diffuseur.
 *
 * ⚠️ REDESIGN (28/08, demande utilisateur : "j'aime pas le style... l'icône
 * de Ligue 1+ ou Disney... texte en blanc... sans bordure arrondie") : plus
 * de pastille colorée. Icône : un pictogramme "écran" générique, PAS le vrai
 * logo de chaque diffuseur — vérifié que seul DAZN a un logo officiel
 * disponible de façon fiable depuis cet environnement (les 5 autres
 * diffuseurs concernés n'ont aucune source fiable accessible ici), donc pour
 * ne pas avoir 1 vrai logo à côté de 5 juste devinés/approximatifs,
 * pictogramme neutre partout — honnête plutôt qu'à moitié inventé.
 *
 * variant: 'hero' (bandeau LiveMatchPage/MatchPage) ou 'row' (ligne de
 * Match.jsx). Non cliquable quand aucune URL n'est connue (diffuseurs
 * payants : juste une info pratique, pas une offre "regarder maintenant").
 */
export function WatchBadge({ match, variant = 'hero' }) {
  const b = getBroadcaster(match)
  if (!b) return null
  const className = `watchBadge watchBadge--${variant}`
  const content = (
    <>
      <svg className="watchBadge__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 18v3" />
      </svg>
      {b.free ? <span className="watchBadge__free">Gratuit</span> : 'Sur'}
      {' '}{b.name}
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
