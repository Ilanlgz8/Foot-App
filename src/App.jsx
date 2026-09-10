import { Suspense, lazy, useEffect } from 'react'
import './App.css'
import './theme-v2.css'
import Navbar from './components/navbar.jsx'
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
  // Signal "réseau faible" (voir useNetworkQuality.js) — inutile de l'afficher
  // en plus de OfflineBanner quand on est carrément hors ligne, ce dernier
  // couvre déjà et plus clairement ce cas.
  const weakNetwork = useWeakNetwork()

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
  useEffect(() => {
    const onScroll = () => scrollPositions.set(location.key, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
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
    if (navType === 'POP') {
      const saved = scrollPositions.get(location.key)
      if (saved != null) {
        // Double rAF : laisse le temps au contenu (souvent déjà en cache,
        // mais pas garanti) de se poser avant de scroller, sinon la page
        // n'est parfois pas encore assez haute pour atteindre `saved`.
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, saved)))
        return
      }
    }
    window.scrollTo(0, 0)
  }, [location.pathname, location.key, navType])

  // Demander la permission notifications au premier lancement (après 3s pour ne pas surprendre)
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      const t = setTimeout(() => requestNotificationPermission(), 3_000)
      return () => clearTimeout(t)
    }
  }, [])

  // ⚠️ AJOUT (10/09, retour utilisateur : "quand je quitte et reviens
  // d'arrière-plan et que je scroll vers le bas, la barre du bas se
  // détache"). Plusieurs endroits de l'app (Match.jsx, Footer.jsx,
  // GroupModal.jsx, Resultat.jsx, Classement.jsx) verrouillent le scroll
  // d'un modal/dropdown en posant `body.style.position = 'fixed'` +
  // `overflow = 'hidden'` pendant qu'il est ouvert, et le retirent au
  // nettoyage React (fermeture/démontage — un `useEffect` classique).
  // Si l'app est mise en arrière-plan PENDANT que l'un de ces verrous est
  // actif, iOS peut geler l'exécution JS à tout moment sans prévenir : le
  // nettoyage ne s'exécute alors jamais au bon moment, le body reste
  // bloqué en `position: fixed` — ce qui casse l'ancrage au viewport des
  // autres éléments fixes (dont `.sfTabbar`, la barre du bas) au prochain
  // scroll. Même classe de bug que celle déjà documentée dans index.css
  // (overflow-x/swipe), cause différente (overflow-y/background). Filet de
  // sécurité : à chaque retour au premier plan, si le body est resté
  // verrouillé, on le libère de force. Un modal réellement encore ouvert à
  // ce moment perdrait son verrou de scroll (désagrément mineur, rare) —
  // largement préférable à une barre du bas décrochée durablement.
  useEffect(() => {
    const unstickBody = () => {
      if (document.visibilityState !== 'visible') return
      if (document.body.style.position === 'fixed') {
        document.body.style.position = ''
        document.body.style.overflow = ''
        document.body.style.top = ''
        document.body.style.left = ''
        document.body.style.right = ''
      }
    }
    document.addEventListener('visibilitychange', unstickBody)
    window.addEventListener('pageshow', unstickBody)
    return () => {
      document.removeEventListener('visibilitychange', unstickBody)
      window.removeEventListener('pageshow', unstickBody)
    }
  }, [])

  // ⚠️ 3e TENTATIVE (10/09, "ça le fait encore" — signalé À NOUVEAU après le
  // passage de `.sfTabbar` en portail React direct dans `<body>`, voir
  // navbar.jsx). Ce dernier changement écarte pourtant avec certitude toute
  // cause liée à un ANCÊTRE transformé/filtré (vérifié en production : le
  // parent DOM réel de `.sfTabbar` est bien `<body>`, sans aucun intermédiaire
  // possible) — 2 hypothèses ciblées de suite (verrou body figé, puis couche
  // GPU dédiée + nudge sur un événement précis) n'ont donc pas identifié la
  // vraie cause avec certitude. Plutôt que deviner un 3e déclencheur précis,
  // changement d'approche : un watchdog qui vérifie l'état RÉEL et OBSERVABLE
  // de la barre en continu (toutes les secondes + à chaque scroll/retour au
  // premier plan) au lieu d'anticiper QUAND ça casse — même logique que le
  // filet de sécurité déjà utilisé ailleurs dans l'app pour la fraîcheur ESPN
  // (voir `useLiveMinute.js`, le setInterval qui détecte une suspension JS
  // par l'écart RÉEL entre deux tops, indépendant de tout event navigateur).
  // Un `position: fixed` correctement rendu colle TOUJOURS son bord bas
  // exactement au bord bas du viewport VISUEL courant (`rect.bottom ===
  // window.innerHeight`) — vrai quel que soit l'état de la barre d'adresse
  // (masquée/affichée), donc un test fiable indépendamment des fluctuations
  // normales de `window.innerHeight` sur mobile. Un écart détecté force un
  // recalcul en retirant puis réappliquant `position` elle-même (le levier le
  // plus direct sur la propriété en cause — pas un simple `transform`, déjà
  // tenté sans succès durable) : corrige le symptôme quelle que soit sa cause
  // exacte, generalement en moins d'1s, sans dépendre d'avoir deviné le bon
  // déclencheur.
  useEffect(() => {
    let rafId = null
    const check = () => {
      const el = document.querySelector('.sfTabbar')
      if (!el) return
      if (getComputedStyle(el).display === 'none') return   // desktop : masquée exprès
      const rect  = el.getBoundingClientRect()
      const drift = Math.abs(rect.bottom - window.innerHeight)
      if (drift > 2) {
        el.style.position = 'static'
        void el.offsetHeight   // force un reflow synchrone avant de réappliquer
        el.style.position = ''
      }
    }
    const scheduleCheck = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => { rafId = null; check() })
    }
    const intervalId = setInterval(check, 1000)
    window.addEventListener('scroll', scheduleCheck, { passive: true })
    document.addEventListener('visibilitychange', scheduleCheck)
    window.addEventListener('pageshow', scheduleCheck)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('scroll', scheduleCheck)
      document.removeEventListener('visibilitychange', scheduleCheck)
      window.removeEventListener('pageshow', scheduleCheck)
    }
  }, [])

  return (
    // LiveProvider monté ici → hooks live survivent aux changements de route
    // + Web Worker ESPN continue de tourner même si l'utilisateur est sur Classement etc.
    //
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
        <Navbar />
        {!online && <OfflineBanner />}
        {online && weakNetwork && <WeakNetworkBanner />}
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
      </LiveProvider>
    </ErrorBoundary>
  )
}

export default App
