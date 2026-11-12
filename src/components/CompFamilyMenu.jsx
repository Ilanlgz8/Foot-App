// Menu déroulant sur le NOM de la compétition (12/11, demande utilisateur) : « Ligue 1 ▾ » →
// Ligue 1 / Ligue 2 / Ligue 3 / Coupe de France (voir getCompFamily, competitions.js). Remplace
// les onglets « Coupe de France / Ligue 3 » qui encombraient Programme, Résultats et Classement.
// Liste rendue dans <body> (portail) pour échapper à l'overflow:hidden de .compHeader — même
// technique que le sélecteur « Changer ».
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './compFamilyMenu.css'

export default function CompFamilyMenu({ family, active, onPick, fallbackName, variant = 'mobile' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: Math.max(8, r.left), minWidth: Math.max(200, r.width) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, { passive: true })
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
    }
  }, [open])

  if (!family.length) {
    return <span className={`compFamily__label compFamily__label--${variant}`}>{fallbackName}</span>
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`compFamily__btn compFamily__btn--${variant}${open ? ' compFamily__btn--open' : ''}`}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="compFamily__btnName">{active?.name ?? fallbackName}</span>
        <svg className="compFamily__chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && createPortal(
        // Le portail remonte quand même les clics dans l'arbre React (jusqu'au bandeau, qui ouvre
        // « Changer ») → on les arrête ici.
        <div onClick={e => e.stopPropagation()}>
          <div className="compFamily__backdrop" onClick={() => setOpen(false)} />
          {pos && (
            <div className="compFamily__menu" role="listbox" style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}>
              {family.map(f => (
                <button
                  key={f.key}
                  type="button"
                  role="option"
                  aria-selected={f.key === active?.key}
                  className={`compFamily__item${f.key === active?.key ? ' compFamily__item--active' : ''}`}
                  onClick={() => { onPick(f.key); setOpen(false) }}
                >
                  {f.emblem
                    ? <img src={f.emblem} alt="" className="compFamily__itemLogo" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                    : <span className="compFamily__itemCup" aria-hidden="true">🏆</span>}
                  <span className="compFamily__itemName">{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
