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
import { isCardLive } from '../utils/matchUtils'
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
/* ⚠️ ICÔNES REVUES (21/09, demande explicite : "propose moi de meilleur
   icones [...] plus pro") — l'utilisateur a comparé plusieurs styles via un
   aperçu visuel (Tabler icons : home / calendar-event / clipboard-check pour
   Accueil/Programme/Résultats, chart-bar pour Classement) et a choisi ces 4
   formes précises. Pas de dépendance à une webfont externe ajoutée (pas
   cohérent avec le reste de l'app, 100 % offline-first PWA, voir CLAUDE.md) :
   redessinées à la main en SVG, même gabarit que les icônes existantes
   (viewBox 24x24, stroke 1.8 arrondi pour la variante ligne, fill plein pour
   la variante active) pour rester visuellement cohérentes avec le reste du
   fichier plutôt que d'importer les tracés Tabler tels quels. */
const ICONS = {
  '/': (
    <>
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 11.5L12 4l8 7.5" />
        <path d="M6 10.5V19a1.5 1.5 0 001.5 1.5H10v-5h4v5h2.5A1.5 1.5 0 0018 19v-8.5" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.8l9 7.9a1 1 0 01-.66 1.75H19V19a2 2 0 01-2 2h-2.5v-6h-5v6H7a2 2 0 01-2-2v-6.55H3.66A1 1 0 013 10.7l9-7.9z" />
      </svg>
    </>
  ),
  '/matchs': (
    <>
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 9.5h17M8 3v4M16 3v4" />
        <circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7 2.5a1 1 0 012 0V4h6V2.5a1 1 0 012 0V4h1a3 3 0 013 3v1.5H3V7a3 3 0 013-3h1V2.5zM3 10.5h18V19a3 3 0 01-3 3H6a3 3 0 01-3-3v-8.5zm9 3a1.7 1.7 0 100 3.4 1.7 1.7 0 000-3.4z" />
      </svg>
    </>
  ),
  '/resultats': (
    <>
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="4.5" width="14" height="17" rx="2.5" />
        <rect x="9" y="2.5" width="6" height="3.5" rx="1.2" />
        <path d="M8.5 13.2l2.4 2.4 4.4-4.9" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M9 2a1 1 0 00-1 1v.5H6.5A2.5 2.5 0 004 6v13a2.5 2.5 0 002.5 2.5h11A2.5 2.5 0 0020 19V6a2.5 2.5 0 00-2.5-2.5H16V3a1 1 0 00-1-1H9zm-.7 10.4a1 1 0 011.4.08l1.75 1.95 3.65-4.05a1 1 0 111.48 1.34l-4.4 4.9a1 1 0 01-1.47.02l-2.5-2.77a1 1 0 01.09-1.47z" />
      </svg>
    </>
  ),
  '/classement': (
    <>
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4.5 20V11M12 20V4.5M19.5 20v-7.5M3.5 20h17" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3.5 11a1.3 1.3 0 011.3-1.3h1.4A1.3 1.3 0 017.5 11v9h-4v-9zm7.2-7.3a1.3 1.3 0 011.3-1.2h1.3a1.3 1.3 0 011.3 1.3V20h-4V3.7zm7.2 8.5a1.3 1.3 0 011.3-1.3h1.3a1.3 1.3 0 011.3 1.3V20h-4v-7.8z" />
      </svg>
    </>
  ),
}

/* Ballon de foot — emoji système, net à toutes les tailles.
   Le style/anim (fond sombre, néon, rotation) est porté par .sfTabLive__orb. */
const BallIcon = () => (
  <span className="sfTabLive__ball" aria-hidden="true">⚽</span>
)

// ⚠️ SÉPARÉ EN 2 COMPOSANTS (14/09, 14e signalement de la barre du bas
// décollée — voir l'historique complet dans navbar.css/App.jsx) : après 13
// tentatives de patcher `.sfTabbar` en `position: fixed` (portail body,
// couches GPU, watchdogs, scroll-lock #root...), la dernière (restaurer
// `transform: translateZ(0)`) a été confirmée déployée en production ET
// confirmée insuffisante par l'utilisateur (test refait après fermeture
// complète de l'app). Plutôt qu'une 15e théorie sur `.sfTabbar` elle-même,
// changement structurel : `position: fixed` est abandonné entièrement pour
// la barre du bas, au profit d'une mise en page en colonne flex pleine
// hauteur (voir `.appShell`/`.appScroll` dans `App.css` et leur usage dans
// `App.jsx`) où la barre est un simple élément de flux, toujours exactement
// au bas de l'écran par construction — plus aucune classe de bug WebKit liée
// à `position: fixed` (compositing, glissement au scroll, écart viewport
// visuel, ancêtre transformé...) ne peut plus l'affecter, puisqu'elle n'est
// plus jamais positionnée "par-dessus" quoi que ce soit. `Navbar` (header,
// toujours visible en haut, hors de la zone qui défile) et `BottomTabBar`
// (barre du bas, hors de la zone qui défile elle aussi, mais tout en bas de
// la colonne) sont désormais 2 exports distincts pour être placés aux 2
// extrémités de `.appShell` dans `App.jsx`, avec `.appScroll` (contenu
// routé + footer) seul à défiler entre les deux. Le portail direct dans
// `<body>` (10/09) est retiré : il n'a plus lieu d'être, la barre n'a plus
// besoin d'être immunisée contre un ancêtre transformé puisqu'elle n'est
// plus `position: fixed` du tout.
function Navbar() {
  const { liveMatches } = useLiveData()
  // ⚠️ REVU EN PROFONDEUR (constat utilisateur, 20/08 — voir le commentaire
  // détaillé dans Live.jsx, même fix) : `shouldShowLiveWidget` (fenêtre de
  // grâce 8s + mémoire anti-réapparition partagée entre pages) restait
  // instable malgré plusieurs correctifs successifs sur cette même zone
  // (flicker "continue / Terminé mais reste / disparaît puis revient",
  // surtout après une fenêtre où l'app était en arrière-plan). `isCardLive`
  // (matchUtils.js) — le même dérivé STATELESS déjà utilisé par la card
  // classique de l'Accueil, qui elle n'a jamais eu ce problème — remplace la
  // décision ici : `liveCount` reflète l'état courant à chaque render, sans
  // fenêtre de temps ni état à synchroniser entre navbar/Live.jsx/Accueil.jsx.
  // Perd le court affichage "Terminé" avant disparition (l'orb disparaît
  // instantanément dès `ft: true`) — compromis assumé pour ne plus jamais
  // revoir ce flicker. Plus besoin de ticker dédié : `liveCount` se
  // recalcule déjà naturellement au rythme du polling ESPN/FD.org
  // (LiveProvider), exactement comme la card Accueil.
  const liveCount = liveMatches.filter(isCardLive).length

  return (
    <header className="sfHeader">
        <div className="sfHeader__inner">
          {/* Pronos — mobile uniquement, à la place de la date (voir
              sfHeader__pronosBtn). Le wrapper flex date de l'époque où
              "Mes Paris" l'accompagnait ici (fonctionnalité entièrement
              retirée le 02/09, décision produit : simulation de paris hors
              du périmètre stats/live/notifs de l'app, et sujet sensible
              — classement 18+ des stores, cadre ANJ en France) ; il est
              conservé tel quel pour ne pas toucher au grid-template-columns
              existant du header. */}
          <div className="sfHeader__leftGroup">
            <NavLink
              to="/pronos"
              className={({ isActive }) =>
                isActive ? 'sfHeader__pronosBtn sfHeader__pronosBtn--active' : 'sfHeader__pronosBtn'
              }
            >
              <svg className="sfHeader__pronosIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4.5" />
                <circle cx="12" cy="12" r="0.6" fill="currentColor" />
              </svg>
              <span>Pronos</span>
            </NavLink>
          </div>

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
  )
}

// ── Barre du bas — mobile uniquement ──
// Composant séparé (voir commentaire au-dessus de Navbar) : plus de portail,
// plus de position:fixed — rendue normalement dans `.appShell` (App.jsx),
// en flux, toujours au bas de l'écran par construction.
export function BottomTabBar() {
  const { liveMatches } = useLiveData()
  const liveCount = liveMatches.filter(isCardLive).length

  return (
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
  )
}

export default Navbar
