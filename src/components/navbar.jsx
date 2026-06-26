import { useState, useEffect, useCallback } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useLiveData } from '../context/LiveProvider'
import NotificationBell from './NotificationBell'
import '../../navbar.css'

const navigation = [
  { name: 'Accueil',    href: '/' },
  { name: 'Programme',  href: '/matchs' },
  { name: 'Résultats',  href: '/resultats' },
  { name: 'Classement', href: '/classement' },
]

// Icônes SVG pour la barre de nav mobile
const QN_ICONS = {
  '/': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5"/>
      <path d="M5.5 9.5V20h13V9.5"/>
      <path d="M9.5 20v-6h5v6"/>
    </svg>
  ),
  '/matchs': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="15" rx="2.5"/>
      <path d="M8 3v4M16 3v4M4 10h16"/>
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>
    </svg>
  ),
  '/resultats': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="14" rx="2.5"/>
      <path d="M8 9h3M13 9h3M8 15h3M13 15h3"/>
      <path d="M11 12h2"/>
    </svg>
  ),
  '/classement': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 20h14"/>
      <path d="M7 20v-7h4v7"/>
      <path d="M13 20V8h4v12"/>
      <path d="M9 9l3-5 3 5"/>
    </svg>
  ),
}

function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isStale, setIsStale]       = useState(false)
  const [spinning, setSpinning]     = useState(false)
  const close = () => setMobileOpen(false)

  const { liveMatches, recalibrate } = useLiveData()
  const queryClient = useQueryClient()
  const navigate    = useNavigate()

  // Détection données gelées : si ESPN n'a pas été pollé depuis > 45s
  useEffect(() => {
    const check = () => {
      const last = parseInt(localStorage.getItem('foot_espn_last_poll') ?? '0', 10)
      // Ne considérer comme gelé que si on a déjà pollé au moins une fois ET > 45s
      setIsStale(last > 0 && Date.now() - last > 45_000)
    }
    check()
    const id = setInterval(check, 10_000)
    return () => clearInterval(id)
  }, [])

  // Hard refresh : recalibrer ESPN + vider tous les caches gelés
  const handleHardRefresh = useCallback(async () => {
    if (spinning) return
    setSpinning(true)
    try {
      await recalibrate()
      // Invalider toutes les requêtes pour forcer un re-fetch propre
      queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
      queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
      queryClient.invalidateQueries({
        predicate: q =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === 'matches' &&
          q.queryKey[2] === 'FINISHED',
      })
      setIsStale(false)
    } finally {
      setTimeout(() => setSpinning(false), 1_500)
    }
  }, [recalibrate, queryClient, spinning])

  return (
    <nav className="navbar">
      {/* Bordure animée conic-gradient */}
      <div className="navbar__border" aria-hidden="true" />
      <div className="navbar__overlay" />
      <div className="navbar__glow" />
      <div className="navbar__container">
        <div className="navbar__inner">

          {/* Hamburger — visible sur mobile uniquement, tout à gauche */}
          <button
            className="navbar__menuButton"
            onClick={() => setMobileOpen(o => !o)}
            aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <svg className="navbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            ) : (
              <svg className="navbar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            )}
          </button>

           {/* ── Mini header ── */}

          {/* Brand — centré sur mobile, à gauche sur desktop */}
          <NavLink to="/" className="navbar__brand" onClick={close}>
            <div className="accueil__miniHeader">
              <h1 className="accueil__miniTitle">
                <span className="accueil__heroStat">Stat</span>Footix
              </h1>
                <span className="accueil__miniDate">{todayStr}</span>
            </div>
          </NavLink>

          {/* Desktop nav — caché sur mobile via CSS */}
          <div className="navbar__navWrap">
            <div className="navbar__nav">
              {navigation.map(item => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  end={item.href === '/'}
                  className={({ isActive }) =>
                    isActive ? 'navbar__navLink navbar__navLink--active' : 'navbar__navLink'
                  }
                >
                  {item.name}
                </NavLink>
              ))}
            </div>
          </div>

          {/* Bouton DIRECT — desktop uniquement, visible si matchs en cours */}
          {liveMatches.length > 0 && (
            <button className="navbar__liveBtn" onClick={() => navigate('/live')}>
              <span className="navbar__liveBtnDot" />
              DIRECT
              <span className="navbar__liveBtnArrow">›</span>
            </button>
          )}

          {/* ── Groupe droit : cloche + refresh ── */}
          <div className="navbar__mobileRight">
            {/* Cloche notifications — desktop + mobile */}
            <NotificationBell />

            {/* Bouton hard refresh — mobile uniquement, visible si données gelées > 45s */}
            {isStale && <button
              className={`navbar__refreshBtn${spinning ? ' navbar__refreshBtn--spinning' : ''}`}
              onClick={handleHardRefresh}
              aria-label="Rafraîchir les données"
            >
              {spinning ? (
                <svg className="navbar__refreshIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              ) : 'Recharger'}
            </button>}
          </div>

        </div>
      </div>

      {/* Menu mobile déroulant */}
      {mobileOpen && (
        <div className="navbar__mobileMenu">
          <ul className="navbar__mobileList">
            {navigation.map(item => (
              <li key={item.href}>
                <NavLink
                  to={item.href}
                  end={item.href === '/'}
                  className={({ isActive }) =>
                    isActive
                      ? 'navbar__mobileLink navbar__mobileLink--active'
                      : 'navbar__mobileLink'
                  }
                  onClick={close}
                >
                  {item.name}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Barre de nav permanente mobile ── */}
      <div className="navbar__quickNav">
        {navigation.map(item => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.href === '/'}
            className={({ isActive }) =>
              isActive ? 'navbar__qnLink navbar__qnLink--active' : 'navbar__qnLink'
            }
          >
            {QN_ICONS[item.href]}
            <span className="navbar__qnLabel">{item.name}</span>
          </NavLink>
        ))}
        {liveMatches.length > 0 && (
          <button className="navbar__qnLive" onClick={() => navigate('/live')}>
            <span className="navbar__qnLiveDot" />
            <span className="navbar__qnLabel">Live</span>
          </button>
        )}
      </div>
    </nav>
  )
}

export default Navbar
