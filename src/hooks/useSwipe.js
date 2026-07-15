/**
 * useSwipe — suivi du doigt en temps réel + snap au lift
 *
 * Retourne { ref, dragOffset, isDragging }
 * → Attacher `ref` au conteneur swipable
 * → Appliquer `transform: translateX(${dragOffset}px)` sur le contenu
 * → `isDragging` pour désactiver la transition CSS pendant le drag
 *
 * Gestion scroll horizontal :
 *   Si le doigt démarre sur un élément scrollable en X (ex. table classement),
 *   le drag ne change d'onglet que quand l'élément est en butée de scroll.
 */
import { useRef, useState, useEffect, useCallback } from 'react'

function findHScrollParent(el) {
  while (el && el !== document.body) {
    const ox = window.getComputedStyle(el).overflowX
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2) return el
    el = el.parentElement
  }
  return null
}

export function useSwipe(onSwipeLeft, onSwipeRight, threshold = 50) {
  const startX      = useRef(null)
  const startY      = useRef(null)
  const scrollEl    = useRef(null)
  const lockedAxis  = useRef(null)   // 'h' | 'v' | null — verrouillé dès qu'on sait

  // BUG CORRIGÉ : certains consommateurs (ex. NewsCarousel) mettent un
  // `key={page}` sur le conteneur swipable pour forcer un remount à chaque
  // changement de page/onglet. Avec un simple useRef, l'élément DOM change
  // sous nos pieds à chaque remount mais l'effet qui attache les listeners
  // ne se redéclenche jamais (ses deps — les callbacks memoïsés — ne
  // changent pas) : les listeners restent accrochés à l'ANCIEN nœud, déjà
  // retiré du DOM. Résultat : le tout premier swipe (ou la 1ère rotation
  // auto) fonctionne, puis plus aucun swipe ne répond — jusqu'à recharger
  // l'app. On passe donc par un état (callback ref) : à chaque nouveau
  // nœud DOM, `node` change, ce qui refait tourner l'effet d'attachement.
  const [node, setNode] = useState(null)
  const containerRef = useCallback(el => setNode(el), [])

  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  // Refs pour les callbacks (évite les stale closures dans les listeners)
  const onLeftRef  = useRef(onSwipeLeft)
  const onRightRef = useRef(onSwipeRight)
  useEffect(() => { onLeftRef.current  = onSwipeLeft  }, [onSwipeLeft])
  useEffect(() => { onRightRef.current = onSwipeRight }, [onSwipeRight])

  const handleTouchStart = useCallback((e) => {
    startX.current    = e.touches[0].clientX
    startY.current    = e.touches[0].clientY
    lockedAxis.current = null
    scrollEl.current   = findHScrollParent(e.target)
    setDragOffset(0)
  }, [])

  const handleTouchMove = useCallback((e) => {
    if (startX.current === null) return
    const dx = e.touches[0].clientX - startX.current
    const dy = e.touches[0].clientY - startY.current

    // Attendre un minimum de mouvement avant de verrouiller l'axe
    if (lockedAxis.current === null) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
      lockedAxis.current = Math.abs(dx) >= Math.abs(dy) * 0.8 ? 'h' : 'v'
    }

    if (lockedAxis.current === 'v') return  // scroll vertical → on ne fait rien

    // Vérification butée scroll horizontal
    if (scrollEl.current) {
      const el     = scrollEl.current
      const atLeft  = el.scrollLeft <= 2
      const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
      if (dx < 0 && !atRight) return
      if (dx > 0 && !atLeft)  return
    }

    // Bloquer le scroll de la page pendant le swipe horizontal
    e.preventDefault()

    // Résistance légère aux bords (si on est au premier ou dernier onglet)
    setIsDragging(true)
    setDragOffset(dx * 0.82)  // légère résistance
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (startX.current === null) return
    const dx = dragOffset / 0.82

    setIsDragging(false)

    if (lockedAxis.current === 'h') {
      if (dx < -threshold) {
        setDragOffset(0)
        onLeftRef.current?.()
      } else if (dx > threshold) {
        setDragOffset(0)
        onRightRef.current?.()
      } else {
        // Pas assez de distance → spring back
        setDragOffset(0)
      }
    }

    startX.current     = null
    startY.current     = null
    scrollEl.current   = null
    lockedAxis.current = null
  }, [dragOffset, threshold])

  // Attacher les listeners sur le conteneur avec passive:false sur touchmove
  // — dépend de `node` (pas d'un ref muet) pour se ré-attacher à chaque
  // remount du conteneur (voir commentaire plus haut).
  useEffect(() => {
    const el = node
    if (!el) return
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove',  handleTouchMove,  { passive: false })
    el.addEventListener('touchend',   handleTouchEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove',  handleTouchMove)
      el.removeEventListener('touchend',   handleTouchEnd)
    }
  }, [node, handleTouchStart, handleTouchMove, handleTouchEnd])

  return { ref: containerRef, dragOffset, isDragging }
}
