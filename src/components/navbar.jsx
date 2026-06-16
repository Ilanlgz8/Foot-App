import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import Accueil from './Accueil.jsx'
import MatchAVenir from './Match.jsx'
import Resultat from './Resultat.jsx'
import Classement from './Classement.jsx'
import logo from '../assets/logo.svg'
import '../../navbar.css'

function Navbar() {

  const navigation = [
    { name: 'Accueil', href: '/' },
    { name: 'Match à venir', href: '/matchs' },
    { name: 'Résultats', href: '/resultats' },
    { name: 'Classement', href: '/classement' },
  ]

  return (
    <nav className="navbar">
      <div className="navbar__overlay" />
      <div className="navbar__glow" />
      <div className="navbar__container">
        <div className="navbar__inner">

          <div className="navbar__main">
            <a href="/" className="navbar__brand">
              <span className="navbar__brandText">
                <span className="navbar__brandName">
                  <span className="navbar__brandStat">Stat</span>Footix
                </span>
              </span>
            </a>

            <div className="navbar__navWrap">
              <div className="navbar__nav">
                {navigation.map((item) => (
                  <NavLink
                  key={item.href}
                  to={item.href}
                  className={({ isActive }) =>
                    isActive ? 'navbar__navLink navbar__navLink--active' : 'navbar__navLink'
                  }
                >
                  {item.name}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </nav>
  )
}

export default Navbar