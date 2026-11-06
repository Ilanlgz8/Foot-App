// 06/11 : force un nouveau rendu de la page dès qu'un match se termine (« Terminé » affiché), puis
// juste après la fenêtre de grâce TERMINE_GRACE_MS (la card disparaît alors, ~8 s après la fin) — sans
// attendre de nouvelles données ni un changement de page. Renvoie un compteur à mettre dans les
// dépendances des useMemo qui filtrent les matchs encore visibles.
import { useEffect, useState } from 'react'
import { MATCH_ENDED_EVENT, TERMINE_GRACE_MS } from '../utils/matchStateTracker'

export function useMatchEndedRefresh() {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const timers = new Set()
    const onEnded = () => {
      setVersion(v => v + 1)
      const t = setTimeout(() => { timers.delete(t); setVersion(v => v + 1) }, TERMINE_GRACE_MS + 400)
      timers.add(t)
    }
    window.addEventListener(MATCH_ENDED_EVENT, onEnded)
    return () => {
      window.removeEventListener(MATCH_ENDED_EVENT, onEnded)
      timers.forEach(clearTimeout)
    }
  }, [])
  return version
}
