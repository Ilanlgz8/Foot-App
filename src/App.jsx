import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import './App.css'
import './theme-v2.css'
import Navbar, { BottomTabBar } from './components/navbar.jsx'
import Footer from './components/Footer.jsx'
import Accueil from './components/Accueil.jsx'
import { LiveProvider } from './context/LiveProvider.jsx'
import { Routes, Route, useLocation, useNavigationType } from 'react-router-dom'
import { requestNotificationPermission } from './utils/notify'
import { useOnline } from './hooks/useOnline'
import { OfflineBanner } from './components/OfflineBanner'
import { useWeakNetwork } from './hooks/useNetworkQuality'
import { WeakNetworkBanner } from './components/WeakNetworkBanner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SplashScreen } from './components/SplashScreen'

const MatchAVenir = lazy(() => import('./components/Match.jsx'))
const Resultat = lazy(() => import('./components/Resultat.jsx'))
const Classement = lazy(() => import('./components/Classement.jsx'))
const MentionsLegales = lazy(() => import('./components/MentionsLegales.jsx'))
const Live = lazy(() => import('./components/Live.jsx'))
const LiveMatchPage = lazy(() => import('./pages/LiveMatchPage.jsx'))
const MatchPage = lazy(() => import('./pages/MatchPage.jsx'))
const FavoritesPage = lazy(() => import('./pages/FavoritesPage.jsx'))
const Pronos = lazy(() => import('./pages/Pronos.jsx'))
// DebugEspn : route désactivée (audit sécurité — page de diagnostic accessible
// publiquement sans auth). Fichier gardé tel quel dans src/pages/DebugEspn.jsx
// pour la remonter facilement si un bug ESPN similaire réapparaît : il suffit
// de redécommenter cette ligne + le <Route> correspondant ci-dessous.
// const DebugEspn = lazy(() => import('./pages/DebugEspn.jsx'))

// ⚠️ AJOUT (constat utilisateur : "cliquer sur un bouton pour changer de page
// c'est pas fluide") : chaque page est en lazy() — au tout premier clic vers
// une page jamais visitée dans la session, le navigateur doit encore
// télécharger + exécuter son chunk JS avant que Suspense puisse l'afficher,
// ce qui se voit comme un petit à-coup/flash (fallback vide) avant que le
// contenu apparaisse. En précachant tous les chunks en arrière-plan une fois
// l'app au repos (idle), le clic sur n'importe quel onglet devient instantané
// dès la 1ère fois — le module est déjà en mémoire, plus de Suspense visible.
// requestIdleCallback (avec repli setTimeout sur Safari, qui ne le supporte
// pas) : ne vole aucun temps CPU au chargement initial de l'Accueil.
function preloadRoutes() {
  import('./components/Match.jsx')
  import('./components/Resultat.jsx')
  import('./components/Classement.jsx')
  import('./components/Live.jsx')
  import('./pages/LiveMatchPage.jsx')
  import('./pages/MatchPage.jsx')
  import('./pages/FavoritesPage.jsx')
  import('./pages/Pronos.jsx')
  import('./components/MentionsLegales.jsx')
}

// Positions de scroll par entrée d'historique (location.key) — niveau module
// pour survivre aux remounts (voir useNavigationType ci-dessous).
const scrollPositions = new Map()

function App() {
  const location = useLocation()
  const navType  = useNavigationType() // 'PUSH' | 'POP' | 'REPLACE'
  const online   = useOnline()
  // ⚠️ AJOUTÉ (14/09, refonte structurelle — voir le commentaire détaillé
  // juste avant le JSX retourné, tout en bas de ce fichier) : depuis le
  // passage à une mise en page en colonne flex pleine hauteur, TOUT l'app
  // scrolle DANS ce conteneur (`.appScroll`) au lieu du document/`window` —
  // toute la logique de scroll de ce fichier (sauvegarde/restauration de
  // position, verrou de scroll des modals) doit donc viser cette référence
  // plutôt que `window.scrollY`/`window.scrollTo`.
  const appScrollRef = useRef(null)
  // Signal "réseau faible" (voir useNetworkQuality.js) — inutile de l'afficher
  // en plus de OfflineBanner quand on est carrément hors ligne, ce dernier
  // couvre déjà et plus clairement ce cas.
  const weakNetwork = useWeakNetwork()

  // ⚠️ AJOUT (21/09, demande explicite : "quand on scroll vers le bas ou le
  // haut la navbar disparait et reapparait quand on arrete de scroll") —
  // `navHidden` pilote une simple classe CSS (`.sfTabbar--hidden`, voir
  // navbar.css) qui applique un `transform: translateY(...)` + `opacity` à
  // `.sfTabbar`. Volontairement PAS de nouveau mécanisme de positionnement :
  // `.sfTabbar` reste exactement ce qu'elle est depuis le 21/09 (`position:
  // absolute` ancrée sur `.appShell`, voir navbar.css/App.css) — un
  // `transform` purement visuel appliqué par-dessus ne change rien à cet
  // ancrage, donc aucun risque de réintroduire une des 15 variantes du bug de
  // barre décollée déjà documentées dans CLAUDE.md.
  const [navHidden, setNavHidden] = useState(false)

  useEffect(() => {
    const el = appScrollRef.current
    if (!el) return
    let hideTimer = null
    const IDLE_DELAY = 200 // ms sans scroll avant réapparition

    const onScroll = () => {
      // Toujours visible tout en haut de la page (évite un flicker sur le
      // léger rebond élastique iOS au sommet) — pas demandé explicitement,
      // mais un défaut sûr et courant sur ce genre de comportement.
      if (el.scrollTop <= 8) {
        setNavHidden(false)
      } else {
        setNavHidden(true)
      }
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(() => setNavHidden(false), IDLE_DELAY)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [])
  // ⚠️ Pas besoin d'un effet séparé pour réinitialiser `navHidden` au
  // changement de page : `el.scrollTop = 0` (PUSH/REPLACE) ou `= saved`
  // (POP, voir l'effet juste en dessous) déclenchent tous les deux un vrai
  // événement `scroll` natif — le handler `onScroll` ci-dessus s'en charge
  // déjà lui-même (scrollTop ≤ 8 → visible). Un effet dédié aurait en plus
  // appelé `setState` de façon synchrone dans un effet (règle react-hooks/
  // set-state-in-effect, lint) sans rien apporter de plus.

  useEffect(() => {
    if (typeof window === 'undefined') return
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preloadRoutes, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(preloadRoutes, 2000)
    return () => clearTimeout(t)
  }, [])

  // Mémorise la position de scroll en continu, par entrée d'historique
  // (location.key — unique même pour 2 visites de la même URL), pour pouvoir
  // la restaurer si on revient dessus via "retour arrière". Écoute en continu
  // (pas juste au démontage) : plus fiable, aucune dépendance à l'ordre exact
  // des effets React au moment du changement de route.
  // ⚠️ CIBLE CHANGÉE (14/09, refonte structurelle) : `window.scrollY`/
  // `window.scrollTo` → `appScrollRef.current.scrollTop` — c'est désormais
  // `.appScroll` qui défile, plus jamais le document/`window` (voir le JSX
  // retourné en bas de ce fichier).
  useEffect(() => {
    const el = appScrollRef.current
    if (!el) return
    const onScroll = () => scrollPositions.set(location.key, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [location.key])

  // ⚠️ BUG CORRIGÉ (constat utilisateur : scroller dans "Résultats récents"
  // jusqu'à un résultat vieux de 2 jours, cliquer dessus, puis "retour"
  // ramenait tout en haut de l'Accueil au lieu de laisser le scroll où il
  // était) : ce useEffect forçait TOUJOURS window.scrollTo(0,0) à chaque
  // changement de route, y compris au retour arrière. Utile pour une
  // navigation "en avant" (nouvelle page = démarrer en haut, la raison
  // d'être initiale de cet effet), mais faux pour un retour (l'ancienne page
  // doit reprendre exactement où on l'avait laissée). useNavigationType()
  // distingue les deux : 'POP' = bouton retour (ou navigate(-1)) → restaure
  // la position sauvegardée pour cette page si on en a une ; sinon
  // (PUSH/REPLACE, nouvelle page) → comportement inchangé, on repart en haut.
  useEffect(() => {
    const el = appScrollRef.current
    if (!el) return
    if (navType === 'POP') {
      const saved = scrollPositions.get(location.key)
      if (saved != null) {
        // Double rAF : laisse le temps au contenu (souvent déjà en cache,
        // mais pas garanti) de se poser avant de scroller, sinon la page
        // n'est parfois pas encore assez haute pour atteindre `saved`.
        requestAnimationFrame(() => requestAnimationFrame(() => { el.scrollTop = saved }))
        return
      }
    }
    el.scrollTop = 0
  }, [location.pathname, location.key, navType])

  // Demander la permission notifications au premier lancement (après 3s pour ne pas surprendre)
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      const t = setTimeout(() => requestNotificationPermission(), 3_000)
      return () => clearTimeout(t)
    }
  }, [])

  // ⚠️ REMPLACÉ (14/09, refonte structurelle — voir le commentaire complet
  // au-dessus du JSX retourné, tout en bas de ce fichier) : ce fichier
  // portait auparavant ~220 lignes cumulées sur 9 tentatives successives
  // (portail body, couches GPU ajoutées/retirées, watchdogs géométriques à
  // intervalle, réparation au retour d'arrière-plan en 1 puis 2 passes...)
  // pour maintenir `.sfTabbar` (`position: fixed`) ancrée au viewport malgré
  // divers comportements WebKit. Tout ce mécanisme est devenu OBSOLÈTE :
  // `.sfTabbar` n'est plus `position: fixed` sur le VIEWPORT (voir
  // navbar.css) — elle est `position: absolute` ancrée sur `.appShell`, un
  // conteneur DOM stable qui ne scrolle jamais lui-même, structurellement
  // incapable de se "décoller" puisqu'il n'y a plus de notion de viewport
  // séparée à désynchroniser. Aucun de ces watchdogs ne peut plus
  // s'appliquer, ils sont retirés en entier plutôt que laissés comme code
  // mort.
  //
  // Reste un seul filet de sécurité, plus simple et sans risque WebKit,
  // pour un problème DIFFÉRENT : `lockBodyScroll()` (scrollLock.js) bloque
  // désormais le scroll en posant `overflow: hidden` sur `.appScroll`
  // pendant qu'un modal/dropdown est ouvert (voir son propre historique) —
  // si l'app est mise en arrière-plan PENDANT que ce verrou est actif, iOS
  // peut geler l'exécution JS à tout moment, et le nettoyage React
  // (`unlock()`) ne s'exécute alors jamais : `.appScroll` resterait bloqué
  // en `overflow: hidden` pour de bon, l'app semblerait figée/impossible à
  // scroller. À chaque retour au premier plan, si `.appScroll` est encore
  // verrouillé, on le libère de force — même filet que l'ancien `unstickBody`
  // (10/09), juste adapté à la nouvelle cible et à un mécanisme de verrou
  // bien plus simple (`overflow`, pas de `position: fixed`/`top` à défaire).
  useEffect(() => {
    const unstickScroll = () => {
      if (document.visibilityState !== 'visible') return
      const el = appScrollRef.current
      if (el && el.style.overflow === 'hidden') {
        el.style.overflow = ''
      }
    }
    document.addEventListener('visibilitychange', unstickScroll)
    window.addEventListener('pageshow', unstickScroll)
    return () => {
      document.removeEventListener('visibilitychange', unstickScroll)
      window.removeEventListener('pageshow', unstickScroll)
    }
  }, [])

  // ⚠️ REFONTE STRUCTURELLE (14/09, 14e signalement de la barre du bas
  // décollée — voir CLAUDE.md pour l'historique complet des 13 tentatives
  // précédentes, toutes centrées sur `.sfTabbar` en `position: fixed`). La
  // dernière tentative (restaurer `transform: translateZ(0)`) a été vérifiée
  // déployée en production ET confirmée insuffisante par l'utilisateur (test
  // refait après fermeture complète de l'app — pas un souci de cache). Plutôt
  // qu'une 15e théorie CSS sur `.sfTabbar` elle-même, changement structurel :
  // `.appShell` (voir App.css) est une colonne flex de hauteur EXACTEMENT
  // égale au viewport (`100dvh`) — header (`Navbar`) est un élément de flux
  // `flex: 0 0 auto` en haut de cette colonne, JAMAIS `position: fixed`.
  // `.appScroll` (`flex: 1 1 auto; overflow-y: auto`) est le SEUL conteneur
  // qui défile — tout le reste de l'app (bannières, routes, footer) vit
  // dedans, et remplit désormais TOUTE la hauteur restante sous le header.
  // ⚠️ MàJ (21/09, demande explicite : "je devrais voir derriere la navbar
  // les cards des matchs [...] pas un rectangle noir") — `BottomTabBar` n'est
  // plus un 3e élément de flux qui réserve sa propre place : elle est
  // `position: absolute` (voir navbar.css, `.sfTabbar`), ANCRÉE SUR
  // `.appShell` (qui a `position: relative`) et non sur le viewport — donc
  // toujours immunisée contre les 14 bugs `position: fixed` documentés dans
  // CLAUDE.md (compositing, glissement au scroll, écart viewport visuel/
  // layout, ancêtre transformé...), tout en flottant PAR-DESSUS `.appScroll`
  // (via son fond semi-transparent + `backdrop-filter`) pour que le contenu
  // qui défile reste visible derrière/autour d'elle, comme demandé.
  return (
    // 2 niveaux d'ErrorBoundary (voir ErrorBoundary.jsx pour le contexte
    // complet) : l'extérieur protège tout le shell (Navbar/Footer compris —
    // filet de dernier recours si l'un d'eux plante) ; celui autour des
    // Routes, KEYÉ par location.pathname, isole une page cassée SANS faire
    // disparaître la navbar — et se réinitialise tout seul dès qu'on change
    // de page (nouvelle clé = nouvelle instance = l'erreur précédente est
    // oubliée), donc pas besoin d'un rechargement complet pour s'en sortir.
    <ErrorBoundary>
      {/* Monté une seule fois (App() ne se démonte pas en naviguant) — voir
          SplashScreen.jsx pour le détail du déclencheur (lancement à froid
          uniquement) et de la durée (variable, liée aux requêtes en cours). */}
      <SplashScreen />
      <LiveProvider>
        <div className="appShell">
          {/* Header — hors de la zone qui défile, toujours visible, jamais
              positionné par-dessus le contenu (simple élément de flux). */}
          <Navbar />
          {!online && <OfflineBanner />}
          {online && weakNetwork && <WeakNetworkBanner />}

          {/* Seul conteneur qui défile dans toute l'app (voir le commentaire
              juste au-dessus du `return`) — la sauvegarde/restauration de
              position de scroll et le verrou de scroll des modals
              (scrollLock.js) ciblent tous les deux cette réf. */}
          <div className="appScroll" ref={appScrollRef}>
            <div key={location.pathname} className="page-transition">
              <ErrorBoundary key={location.pathname}>
                <Suspense fallback={<div className="routeFallback" />}>
                  <Routes location={location}>
                    <Route path="/" element={<Accueil />} />
                    <Route path="/matchs" element={<MatchAVenir />} />
                    <Route path="/resultats" element={<Resultat />} />
                    <Route path="/classement" element={<Classement />} />
                    <Route path="/live" element={<Live />} />
                    <Route path="/live/:matchId" element={<LiveMatchPage />} />
                    <Route path="/match/:matchId" element={<MatchPage />} />
                    <Route path="/favoris" element={<FavoritesPage />} />
                    <Route path="/pronos" element={<Pronos />} />
                    <Route path="/mentions-legales" element={<MentionsLegales />} />
                    {/* <Route path="/debug-espn" element={<DebugEspn />} /> — voir commentaire import ci-dessus */}
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
            <Footer />
          </div>

          {/* Barre du bas — `position: absolute` ancrée sur `.appShell`
              (voir navbar.css/App.css), flotte par-dessus `.appScroll` plutôt
              que de réserver sa propre place dans le flux (mobile uniquement,
              voir navbar.css). `hidden` : se cache pendant le scroll,
              réapparaît à l'arrêt (voir le useEffect `navHidden` plus haut). */}
          <BottomTabBar hidden={navHidden} />
        </div>
      </LiveProvider>
    </ErrorBoundary>
  )
}

export default App
