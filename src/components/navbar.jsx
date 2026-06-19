import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import '../../navbar.css'

const navigation = [
  { name: 'Accueil',    href: '/' },
  { name: 'Matchs',     href: '/matchs' },
  { name: 'Résultats',  href: '/resultats' },
  { name: 'Classement', href: '/classement' },
]

function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const close = () => setMobileOpen(false)

  return (
    <nav className="navbar">
      <div className="navbar__overlay" />
      <div className="navbar__glow" />
      <div className="navbar__container">
        <div className="navbar__inner">

          {/* Brand */}
          <NavLink to="/" className="navbar__brand" onClick={close}>
            <span className="navbar__brandText">
              <span className="navbar__brandKicker">stats & live</span>
              <span className="navbar__brandName">
                <span className="navbar__brandStat">Stat</span>Footix
              </span>
            </span>
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

          {/* Hamburger — visible sur mobile uniquement */}
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
    </nav>
  )
}

export default Navbar
