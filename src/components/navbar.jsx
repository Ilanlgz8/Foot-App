import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useLiveData } from '../context/LiveProvider'
import NotificationBell from './NotificationBell'
import '../../navbar.css'
import '../accueil.css'

const navigation = [
  { name: 'Accueil',    href: '/' },
  { name: 'Programme',  href: '/matchs' },
  { name: 'Résultats',  href: '/resultats' },
  { name: 'Classement', href: '/classement' },
]

// Icônes SVG pour la barre de nav mobile
const QN_ICONS = {
  '/': (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12L12 2l10 10"/>
      <path d="M4 10v10a1 1 0 001 1h5v-6h4v6h5a1 1 0 001-1V10"/>
    </svg>
  ),
  '/matchs': (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2.5"/>
      <path d="M3 9h18"/>
      <path d="M8 2v4M16 2v4"/>
      <circle cx="8" cy="14" r="0.9" fill="currentColor"/>
      <circle cx="12" cy="14" r="0.9" fill="currentColor"/>
      <circle cx="16" cy="14" r="0.9" fill="currentColor"/>
      <circle cx="8" cy="18" r="0.9" fill="currentColor"/>
      <circle cx="12" cy="18" r="0.9" fill="currentColor"/>
    </svg>
  ),
  '/resultats': (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
    </svg>
  ),
  '/classement': (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="14" width="5" height="7" rx="1"/>
      <rect x="9.5" y="9" width="5" height="12" rx="1"/>
      <rect x="17" y="4" width="5" height="17" rx="1"/>
    </svg>
  ),
}

function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const close = () => setMobileOpen(false)

  const { liveMatches } = useLiveData()
  const navigate        = useNavigate()

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

          {/* ── Groupe droit : cloche ── */}
          <div className="navbar__mobileRight">
            {/* Cloche notifications — desktop + mobile */}
            <NotificationBell />
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
      {/* Live inséré entre Programme et Résultats (au lieu d'être ajouté à la
          fin) → demande explicite de l'utilisateur pour qu'il tombe pile au
          centre de la barre (2 onglets de chaque côté) et se remarque plus. */}
      <div className="navbar__quickNav">
        {navigation.slice(0, 2).map(item => (
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
        {navigation.slice(2).map(item => (
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
      </div>
    </nav>
  )
}

export default Navbar
