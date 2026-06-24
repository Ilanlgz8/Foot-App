/**
 * useSwipe — détecte un swipe horizontal et appelle onSwipeLeft / onSwipeRight
 * @param {function} onSwipeLeft  — appelé quand l'utilisateur swipe vers la gauche (→ onglet suivant)
 * @param {function} onSwipeRight — appelé quand l'utilisateur swipe vers la droite (→ onglet précédent)
 * @param {number}   threshold    — distance min en px pour déclencher (défaut 60px)
 */
import { useRef, useCallback } from 'react'

export function useSwipe(onSwipeLeft, onSwipeRight, threshold = 60) {
  const startX = useRef(null)
  const startY = useRef(null)

  const onTouchStart = useCallback((e) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
  }, [])

  const onTouchEnd = useCallback((e) => {
    if (startX.current === null) return
    const dx = e.changedTouches[0].clientX - startX.current
    const dy = e.changedTouches[0].clientY - startY.current
    // Ignorer si le geste est plus vertical qu'horizontal (scroll)
    if (Math.abs(dy) > Math.abs(dx)) return
    if (dx < -threshold) onSwipeLeft?.()
    else if (dx > threshold) onSwipeRight?.()
    startX.current = null
    startY.current = null
  }, [onSwipeLeft, onSwipeRight, threshold])

  return { onTouchStart, onTouchEnd }
}
