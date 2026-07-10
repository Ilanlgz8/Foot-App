/**
 * Navbar v2 — refonte navigation
 *
 * Mobile  (<640px) : header [date | StatFootix centré | cloche]
 *                    + bottom tab bar fixe (zone du pouce) avec orb Live central
 * Desktop (≥640px) : header [brand | liens | DIRECT + cloche]
 *
 * Le lien Live (orb mobile + pill DIRECT desktop) est TOUJOURS visible
 * (fini le layout shift ET la disparition totale du point d'accès /live
 * en desktop quand rien n'est en cours) : badge + pulsation/rouge
 * uniquement quand des matchs sont en cours.
 */
import { NavLink } from 'react-router-dom'
import { useLiveData } from '../context/LiveProvider'
import NotificationBell from './NotificationBell'
import '../../navbar.css'

const NAV = [
  { name: 'Accueil',    href: '/' },
  { name: 'Programme',  href: '/matchs' },
  { name: 'Résultats',  href: '/resultats' },
  { name: 'Classement', href: '/classement' },
]

/* Icônes tab bar — variante outline (inactif) + variante pleine (actif).
   Les deux sont rendues, le CSS affiche la bonne selon l'état. */
const ICONS = {
  '/': (
    <>
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 10.5L12 3l9 7.5" />
        <path d="M5 9.5V20a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9.5" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.5l9.5 7.9a1 1 0 01-.64 1.77H20V20a2 2 0 01-2 2h-3.5v-6.5h-5V22H6a2 2 0 01-2-2v-7.83H3.14a1 1 0 01-.64-1.77L12 2.5z" />
      </svg>
    </>
  ),
  '/matchs': (
    <>
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4.5" width="18" height="17" rx="3" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7 2.5a1 1 0 012 0V4h6V2.5a1 1 0 012 0V4h1a3 3 0 013 3v1.5H3V7a3 3 0 013-3h1V2.5zM3 10.5h18V19a3 3 0 01-3 3H6a3 3 0 01-3-3v-8.5zm5 3.5a1.2 1.2 0 100 2.4A1.2 1.2 0 008 14zm4 0a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zm4 0a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z" />
      </svg>
    </>
  ),
  '/resultats': (
    <>
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 12.2l2.4 2.4 4.8-5" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm4.5 7.3l-5.2 5.5a1 1 0 01-1.44.02L7.5 12.4a1 1 0 111.42-1.4l1.63 1.65 4.5-4.76a1 1 0 111.45 1.38z" />
      </svg>
    </>
  ),
  '/classement': (
    <>
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 01-10 0V4z" />
        <path d="M7 6H4.5a1 1 0 00-1 1c0 2.2 1.6 4 3.7 4.4M17 6h2.5a1 1 0 011 1c0 2.2-1.6 4-3.7 4.4" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7 3h10a1 1 0 011 1v1h2a1 1 0 011 1c0 2.9-2 5.4-4.8 6.1A6 6 0 0114.5 15v2.5H17a1 1 0 011 1V21H6v-2.5a1 1 0 011-1h2.5V15a6 6 0 01-2.7-2.9C4 11.4 2 8.9 2 6a1 1 0 011-1h3V4a1 1 0 011-1zm-1 4H4.1c.3 1.5 1.3 2.7 2.6 3.3A6 6 0 016 8V7zm14 0h-2v1c0 .8-.2 1.6-.6 2.3 1.4-.6 2.3-1.8 2.6-3.3z" />
      </svg>
    </>
  ),
}

/* Ballon de foot — orb Live central */
const BallIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7l3.4 2.5-1.3 4h-4.2l-1.3-4L12 7z" fill="currentColor" stroke="none" />
    <path d="M12 7V3.2M15.4 9.5l3.6-1.3M14.1 13.5l2.3 3.2M9.9 13.5l-2.3 3.2M8.6 9.5L5 8.2" />
  </svg>
)

/* Date du jour compacte, ex. "Mer. 8 juil." — calculée une fois par montage */
function todayLabel() {
  const s = new Date().toLocaleDateString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function Navbar() {
  const { liveMatches } = useLiveData()
  const liveCount = liveMatches.length

  return (
    <>
      {/* ── Header ── */}
      <header className="sfHeader">
        <div className="sfHeader__inner">
          <span className="sfHeader__date">{todayLabel()}</span>

          <NavLink to="/" className="sfHeader__brand">
            <span>Stat</span>Footix
          </NavLink>

          {/* Liens — desktop uniquement */}
          <nav className="sfHeader__nav" aria-label="Navigation principale">
            {NAV.map(item => (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === '/'}
                className={({ isActive }) =>
                  isActive ? 'sfNavLink sfNavLink--active' : 'sfNavLink'
                }
              >
                {item.name}
              </NavLink>
            ))}
          </nav>

          <div className="sfHeader__right">
            {/* DIRECT — desktop uniquement, toujours présent (comme l'orb
                mobile) : pill neutre par défaut, rouge/pulse + badge
                uniquement si des matchs sont en cours. */}
            <NavLink
              to="/live"
              className={({ isActive }) =>
                [
                  'sfLiveBtn',
                  liveCount > 0 ? 'sfLiveBtn--live' : '',
                  isActive ? 'sfLiveBtn--active' : '',
                ].filter(Boolean).join(' ')
              }
            >
              {liveCount > 0 && <span className="sfLiveBtn__dot" />}
              DIRECT
              {liveCount > 0 && <span className="sfLiveBtn__count">{liveCount}</span>}
            </NavLink>
            <NotificationBell />
          </div>
        </div>
      </header>

      {/* ── Bottom tab bar — mobile uniquement ── */}
      <nav className="sfTabbar" aria-label="Navigation">
        {NAV.slice(0, 2).map(item => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.href === '/'}
            className={({ isActive }) =>
              isActive ? 'sfTab sfTab--active' : 'sfTab'
            }
          >
            {ICONS[item.href]}
            <span className="sfTab__label">{item.name}</span>
          </NavLink>
        ))}

        {/* Orb Live central — toujours présent, pulse seulement si live */}
        <NavLink
          to="/live"
          className={({ isActive }) =>
            [
              'sfTabLive',
              liveCount > 0 ? 'sfTabLive--hasLive' : '',
              isActive ? 'sfTabLive--active' : '',
            ].filter(Boolean).join(' ')
          }
        >
          <span className="sfTabLive__orb">
            <BallIcon />
            {liveCount > 0 && <span className="sfTabLive__count">{liveCount}</span>}
          </span>
          <span className="sfTab__label">Live</span>
        </NavLink>

        {NAV.slice(2).map(item => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.href === '/'}
            className={({ isActive }) =>
              isActive ? 'sfTab sfTab--active' : 'sfTab'
            }
          >
            {ICONS[item.href]}
            <span className="sfTab__label">{item.name}</span>
          </NavLink>
        ))}
      </nav>
    </>
  )
}

export default Navbar
