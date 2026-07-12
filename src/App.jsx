import { Suspense, lazy, useEffect } from 'react'
import './App.css'
import './theme-v2.css'
import Navbar from './components/navbar.jsx'
import Footer from './components/Footer.jsx'
import Accueil from './components/Accueil.jsx'
import { LiveProvider } from './context/LiveProvider.jsx'
import { Routes, Route, useLocation } from 'react-router-dom'
import { requestNotificationPermission } from './utils/notify'
import { useOnline } from './hooks/useOnline'
import { OfflineBanner } from './components/OfflineBanner'

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

function App() {
  const location = useLocation()
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

  // Remonter en haut de page à chaque changement de route.
  // Sans ça, le navigateur conserve la position de scroll précédente : si on clique
  // sur une card (MatchPage/LiveMatchPage/Résultats) après avoir scrollé plus bas,
  // on atterrit au milieu/bas de la nouvelle page au lieu du haut.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

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
    <LiveProvider>
      <Navbar />
      {!online && <OfflineBanner />}
      <div key={location.pathname} className="page-transition">
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
      </div>
      <Footer />
    </LiveProvider>
  )
}

export default App
