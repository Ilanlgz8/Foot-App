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
/* ⚠️ ICÔNES REVUES PUIS PARTIELLEMENT REVERTÉES (21/09) — demande initiale
   ambiguë ("pour programme met le 1er [...] sinon le reste c bon [...] pour
   accueil et resultat") interprétée à tort comme "applique aussi la 1re
   option à Accueil/Résultats" ; l'utilisateur a clarifié juste après que
   "le reste c bon" voulait dire NE PAS LES TOUCHER. Accueil et Résultats
   remis à l'identique de leurs tracés d'origine (avant ce round). Seuls
   Programme (calendar-event) et Classement (chart-bar) restent changés —
   ce sont les seuls explicitement demandés/validés dans l'aperçu. */
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
      {/* ⚠️ CORRIGÉ (21/09, retour utilisateur : "les icones sont pas les
          memes que tu m'as montrer [...] des contrefacon de temu") — la
          1re version était une approximation dessinée à la main, pas le vrai
          tracé Tabler affiché dans l'aperçu. Remplacé par le VRAI path SVG
          `calendar-event` récupéré directement depuis le package
          @tabler/icons (mêmes coordonnées, viewBox 24x24 identique) —
          uniquement l'épaisseur de trait passe de 2 (défaut Tabler) à 1.8
          pour rester cohérente avec les 3 autres icônes de cette barre. */}
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M4 11h16" />
        <rect x="8" y="15" width="2" height="2" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="4" y="5" width="16" height="16" rx="2.5" />
        <rect x="6.8" y="2.2" width="2.4" height="4.6" rx="1.2" />
        <rect x="14.8" y="2.2" width="2.4" height="4.6" rx="1.2" />
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
      {/* ⚠️ CORRIGÉ UNE 2E FOIS (21/09, retour utilisateur : "les icones sont
          pas les memes que tu m'as montrer [...] des contrefacon de temu") —
          l'essai précédent (3 rects à la main) était une approximation, pas
          le vrai tracé. Remplacé par la VRAIE géométrie du path Tabler
          `chart-bar` récupéré depuis @tabler/icons (rects décodés depuis le
          path source : x/y/largeur/hauteur/rayon exacts) + la ligne de base
          que la vraie icône a réellement (contrairement à ce qui était
          supposé au 1er correctif). */}
      <svg className="sfTab__icLine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="12" width="6" height="8" rx="1.3" />
        <rect x="9" y="8" width="6" height="12" rx="1.3" />
        <rect x="15" y="4" width="6" height="16" rx="1.3" />
        <path d="M4 20h14" />
      </svg>
      <svg className="sfTab__icFill" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="3" y="12" width="6" height="8" rx="1.3" />
        <rect x="9" y="8" width="6" height="12" rx="1.3" />
        <rect x="15" y="4" width="6" height="16" rx="1.3" />
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
