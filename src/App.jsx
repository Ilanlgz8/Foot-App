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
import { ErrorBoundary } from './components/ErrorBoundary'

const MatchAVenir = lazy(() => import('./components/Match.jsx'))
const Resultat = lazy(() => import('./components/Resultat.jsx'))
const Classement = lazy(() => import('./components/Classement.jsx'))
const MentionsLegales = lazy(() => import('./components/MentionsLegales.jsx'))
const Live = lazy(() => import('./components/Live.jsx'))
const LiveMatchPage = lazy(() => import('./pages/LiveMatchPage.jsx'))
const MatchPage = lazy(() => import('./pages/MatchPage.jsx'))
const FavoritesPage = lazy(() => import('./pages/FavoritesPage.jsx'))
const DebugEspn = lazy(() => import('./pages/DebugEspn.jsx'))
const Pronos = lazy(() => import('./pages/Pronos.jsx'))

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
      <LiveProvider>
        <Navbar />
        {!online && <OfflineBanner />}
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
                <Route path="/debug-espn" element={<DebugEspn />} />

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
