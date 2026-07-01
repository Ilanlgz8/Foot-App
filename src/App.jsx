import { Suspense, lazy, useEffect } from 'react'
import './App.css'
import Navbar from './components/navbar.jsx'
import Footer from './components/Footer.jsx'
import Accueil from './components/Accueil.jsx'
import { LiveProvider } from './context/LiveProvider.jsx'
import { Routes, Route, useLocation } from 'react-router-dom'
import { requestNotificationPermission } from './utils/notify'
import { useOnline } from './hooks/useOnline'
import { OfflineBanner } from './components/OfflineBanner'
import { unlockAudio } from './utils/sounds'

const MatchAVenir = lazy(() => import('./components/Match.jsx'))
const Resultat = lazy(() => import('./components/Resultat.jsx'))
const Classement = lazy(() => import('./components/Classement.jsx'))
const MentionsLegales = lazy(() => import('./components/MentionsLegales.jsx'))
const Live = lazy(() => import('./components/Live.jsx'))
const LiveMatchPage = lazy(() => import('./pages/LiveMatchPage.jsx'))
const MatchPage = lazy(() => import('./pages/MatchPage.jsx'))

function App() {
  const location = useLocation()
  const online   = useOnline()

  // Débloquer l'AudioContext au premier geste (requis par Chrome/Safari)
  useEffect(() => { unlockAudio() }, [])

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
            <Route path="/mentions-legales" element={<MentionsLegales />} />
          </Routes>
        </Suspense>
      </div>
      <Footer />
    </LiveProvider>
  )
}

export default App
