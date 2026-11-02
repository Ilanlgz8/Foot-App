import { Component } from 'react'

// ── Error Boundary ────────────────────────────────────────────────────────
// ⚠️ AJOUT (retour utilisateur : "pour que l'app soit robuste, sans bug, sans
// problème") : avant, une erreur JS imprévue dans N'IMPORTE QUEL composant
// démontait TOUT l'arbre React — navbar comprise, écran noir/blanc complet,
// plus rien de cliquable. On l'a vu 2 fois dans cette même session (crash
// "Stats saison" dans LiveMatchPage, crash "Phase finale" Coupe de France
// dans Match.jsx) : dans les deux cas, un bug localisé à UN composant a fait
// planter toute l'application parce que rien n'interceptait l'erreur.
//
// Une Error Boundary React (uniquement possible via un composant CLASSE —
// pas encore de hook stable pour ça) intercepte les erreurs de rendu de ses
// enfants et affiche un fallback à la place, SANS démonter le reste de
// l'app. Utilisée dans App.jsx autour de chaque route (voir `key={pathname}`
// côté appelant : navigue vers une autre page = nouvelle instance = l'erreur
// précédente est oubliée automatiquement, pas besoin d'un bouton "réessayer"
// pour ça, mais on le garde quand même pour rester sur place).
//
// Limite volontairement documentée : une Error Boundary n'intercepte QUE les
// erreurs de RENDU (render/lifecycle) des composants enfants — pas les
// erreurs dans des handlers d'event (onClick...), pas dans du code async
// (setTimeout, promesses), pas dans le composant lui-même. C'est un filet de
// sécurité pour limiter les DÉGÂTS d'un bug, pas un moyen de l'empêcher —
// le vrai bug doit toujours être corrigé au cas par cas comme avant.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, retryCount: 0 }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Pas d'outil de tracking d'erreurs (Sentry etc.) branché sur ce projet —
    // console.error reste visible dans les logs Vercel côté SSR/build et dans
    // la console navigateur côté client, seule trace dispo pour l'instant.
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  // ⚠️ AJOUT (constat utilisateur, 02/11 : "quand y'a beaucoup de matchs [...]
  // ça me met le message d'erreur [...] et quand j'appuie sur réessayer ça
  // fait rien") : `handleRetry` se contentait de remettre `hasError` à false —
  // si le bug qui a causé le crash est DÉTERMINISTE pour les données
  // actuellement en mémoire (ex. une structure de données figée dans
  // espnScoresCache/liveTracker qui redéclenche le même crash au prochain
  // render), rien ne change entre le clic et le re-render suivant : l'erreur
  // revient instantanément, donnant l'impression exacte "ça fait rien". Un
  // simple reset de state ne peut PAS corriger ça — seul un VRAI rechargement
  // (nouveau contexte JS, aucune donnée en mémoire conservée) le peut. On
  // garde "Réessayer" (gratuit, suffit si la cause était transitoire — ex. un
  // poll ESPN en vol au moment du crash) mais on ajoute "Recharger la page"
  // juste en dessous, qui fait un vrai reload — recours garanti de fonctionner
  // quelle que soit la cause exacte, au prix de perdre l'état de navigation en
  // cours. Si un 2e "Réessayer" retombe sur la même erreur (retryCount > 0),
  // le reload devient visuellement la seule option proposée pour ne pas
  // laisser l'utilisateur recliquer sur un bouton qui ne peut déjà plus rien
  // faire pour cette session.
  handleRetry = () => {
    this.setState(prev => ({ hasError: false, error: null, retryCount: prev.retryCount + 1 }))
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    // Message d'erreur affiché en toutes lettres (pas juste "une erreur est
    // survenue") : aucun outil de tracking n'est branché sur ce projet (voir
    // componentDidCatch) — sur un téléphone, l'utilisateur n'a aucun accès
    // direct à la console pour savoir CE qui a planté. L'afficher ici est le
    // seul moyen de récupérer cette info pour pouvoir corriger la vraie
    // cause, plutôt que de deviner sans jamais pouvoir reproduire.
    const message = this.state.error?.message || String(this.state.error ?? '')

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '0.85rem', padding: '3rem 1.5rem',
        minHeight: '50vh', textAlign: 'center',
      }}>
        <div style={{ fontSize: '2.2rem' }}>⚠️</div>
        <h2 style={{ color: 'rgba(var(--white-rgb),0.92)', fontSize: '1.1rem', margin: 0 }}>
          Un problème est survenu
        </h2>
        <p style={{ color: 'rgba(var(--white-rgb),0.6)', fontSize: '0.9rem', maxWidth: '26rem', margin: 0 }}>
          Cette page a rencontré une erreur inattendue. Le reste de l'app reste
          utilisable — tu peux réessayer, recharger la page, ou changer de page
          depuis le menu.
        </p>
        {message && (
          <p style={{
            color: 'rgba(var(--white-rgb),0.4)', fontSize: '0.75rem', maxWidth: '26rem',
            margin: 0, fontFamily: 'monospace', wordBreak: 'break-word',
          }}>
            {message}
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {this.state.retryCount === 0 && (
            <button
              onClick={this.handleRetry}
              style={{
                padding: '0.6rem 1.4rem', borderRadius: '999px',
                border: 'none', background: '#ef4444', color: '#fff',
                fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Réessayer
            </button>
          )}
          <button
            onClick={this.handleReload}
            style={{
              padding: '0.6rem 1.4rem', borderRadius: '999px',
              border: '1px solid rgba(var(--white-rgb),0.25)', background: 'transparent',
              color: 'rgba(var(--white-rgb),0.92)',
              fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Recharger la page
          </button>
        </div>
      </div>
    )
  }
}
