/**
 * useSwipe — détecte un swipe horizontal et appelle onSwipeLeft / onSwipeRight
 *
 * Gestion scroll horizontal :
 *   Si le touch démarre sur un élément scrollable en X, on laisse le navigateur
 *   gérer le scroll natif SAUF si l'élément est déjà en butée dans la direction du swipe.
 *   → Le classement (table scrollable) défile normalement, et seulement quand l'utilisateur
 *     est au bout du scroll le swipe change d'onglet.
 *
 * @param {function} onSwipeLeft  — swipe vers la gauche (→ onglet suivant)
 * @param {function} onSwipeRight — swipe vers la droite (→ onglet précédent)
 * @param {number}   threshold    — distance min en px (défaut 55)
 */
import { useRef, useCallback } from 'react'

/** Remonte le DOM pour trouver un ancêtre scrollable horizontalement */
function findHScrollParent(el) {
  while (el && el !== document.body) {
    const style = window.getComputedStyle(el)
    const ox = style.overflowX
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2) {
      return el
    }
    el = el.parentElement
  }
  return null
}

export function useSwipe(onSwipeLeft, onSwipeRight, threshold = 55) {
  const startX   = useRef(null)
  const startY   = useRef(null)
  const scrollEl = useRef(null)   // ancêtre scrollable trouvé au touchstart

  const onTouchStart = useCallback((e) => {
    startX.current   = e.touches[0].clientX
    startY.current   = e.touches[0].clientY
    scrollEl.current = findHScrollParent(e.target)
  }, [])

  const onTouchEnd = useCallback((e) => {
    if (startX.current === null) return

    const dx = e.changedTouches[0].clientX - startX.current
    const dy = e.changedTouches[0].clientY - startY.current

    // Ignorer les gestes principalement verticaux
    if (Math.abs(dy) > Math.abs(dx) * 0.8) {
      startX.current = null; startY.current = null; scrollEl.current = null
      return
    }

    // Si un conteneur scrollable est sous le doigt, vérifier la butée
    if (scrollEl.current) {
      const el     = scrollEl.current
      const atLeft  = el.scrollLeft <= 2
      const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
      // Swipe gauche mais table pas encore au bout → laisser le scroll gérer
      if (dx < 0 && !atRight) { startX.current = null; scrollEl.current = null; return }
      // Swipe droite mais table pas encore revenue au début → laisser le scroll gérer
      if (dx > 0 && !atLeft)  { startX.current = null; scrollEl.current = null; return }
    }

    if (dx < -threshold) onSwipeLeft?.()
    else if (dx > threshold) onSwipeRight?.()

    startX.current   = null
    startY.current   = null
    scrollEl.current = null
  }, [onSwipeLeft, onSwipeRight, threshold])

  return { onTouchStart, onTouchEnd }
}
