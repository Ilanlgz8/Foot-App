/**
 * AnimatedOdd.jsx — cote qui « vit » quand elle change (19/11, maquette validée par l'utilisateur).
 * Les chiffres DÉFILENT vers la nouvelle valeur (compteur de stade), le chiffre passe en vert si la
 * cote monte / en rouge si elle baisse le temps du changement, et une petite flèche ▲ / ▼ apparaît
 * ~1,5 s. Aucune animation au premier affichage ni si la valeur ne change pas. Respecte
 * « réduire les animations » (CSS). Virgule française.
 */
import { useEffect, useRef, useState } from 'react'
import { frOdd } from '../utils/frNum'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

export function AnimatedOdd({ value }) {
  const text = frOdd(value)
  const prev = useRef(value)
  const [dir, setDir] = useState(null) // 'up' | 'down' | null

  useEffect(() => {
    const before = prev.current
    prev.current = value
    if (before == null || value == null || frOdd(before) === frOdd(value)) return
    setDir(value > before ? 'up' : 'down')
    const t = setTimeout(() => setDir(null), 1500)
    return () => clearTimeout(t)
  }, [value])

  const chars = [...text]
  return (
    <span className={`oddAnim${dir ? ` oddAnim--${dir}` : ''}`} aria-label={text}>
      <span className="oddAnim__num" aria-hidden="true">
        {chars.map((ch, i) => {
          const key = `c${chars.length - i}` // clé depuis la droite : les colonnes restent stables
          if (!/\d/.test(ch)) return <span key={key} className="oddAnim__sep">{ch}</span>
          return (
            <span key={key} className="oddAnim__col">
              <span className="oddAnim__strip" style={{ transform: `translateY(${-Number(ch)}em)` }}>
                {DIGITS.map(d => <span key={d}>{d}</span>)}
              </span>
            </span>
          )
        })}
      </span>
      <span className={`oddAnim__arrow${dir ? ' oddAnim__arrow--show' : ''}`} aria-hidden="true">
        {dir === 'down' ? '▼' : '▲'}
      </span>
    </span>
  )
}
