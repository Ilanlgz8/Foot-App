import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { lockBodyScroll } from '../utils/scrollLock'

// Modal générique "détail d'un groupe" — partagée par Match.jsx (matchs à
// venir) et Resultat.jsx (résultats), qui avaient chacun leur propre copie
// quasi identique du shell (overlay, scroll-lock du body, touche Echap,
// header titre/compteur/fermer). Le rendu de chaque ligne de match reste
// propre à l'appelant (renderMatch) car les deux pages utilisent des styles
// de card différents (matchs__match vs resultats__card).
export function GroupModal({ title, matches, renderMatch, emptyMessage, onClose }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    // Verrou de scroll partagé (11/09, voir scrollLock.js — remplace le
    // pattern position:fixed direct sur body, qui décalait .sfTabbar depuis
    // son passage en portail direct dans body).
    const unlock = lockBodyScroll()
    return () => {
      window.removeEventListener('keydown', handler)
      unlock()
    }
    // `onClose` est une arrow function recréée à chaque render du parent →
    // la mettre en dépendance démonte/remonte cet effect à chaque re-render
    // (ex: polling périodique), ce qui déverrouille puis reverrouille le
    // scroll du body en boucle. Voir Match.jsx / Resultat.jsx (bug déjà
    // rencontré et corrigé avant la factorisation de ce composant).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(
    <div className="wcModal__overlay" onClick={onClose}>
      <div className="wcModal__panel" onClick={e => e.stopPropagation()}>
        <div className="wcModal__topBar" />
        <div className="wcModal__header">
          <div className="wcModal__titleRow">
            <h2 className="wcModal__title">{title}</h2>
            <span className="wcModal__count">{matches.length} match{matches.length !== 1 ? 's' : ''}</span>
          </div>
          <button className="wcModal__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="wcModal__body">
          {matches.length === 0
            ? <p className="matchs__noMatch">{emptyMessage}</p>
            : matches.map(renderMatch)
          }
        </div>
      </div>
    </div>,
    document.body
  )
}
