import { useEffect } from 'react'
import './App.css'
import Navbar from './components/navbar.jsx'
import Footer from './components/Footer.jsx'
import Accueil from './components/Accueil.jsx'
import MatchAVenir from './components/Match.jsx'
import Resultat from './components/Resultat.jsx'
import Classement from './components/Classement.jsx'
import MentionsLegales from './components/MentionsLegales.jsx'
import { LiveProvider } from './context/LiveProvider.jsx'
import { Routes, Route, useLocation } from 'react-router-dom'
import { requestNotificationPermission } from './utils/notify'

function App() {
  const location = useLocation()

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
      <div key={location.pathname} className="page-transition">
        <Routes location={location}>
          <Route path="/" element={<Accueil />} />
          <Route path="/matchs" element={<MatchAVenir />} />
          <Route path="/resultats" element={<Resultat />} />
          <Route path="/classement" element={<Classement />} />
          <Route path="/mentions-legales" element={<MentionsLegales />} />
        </Routes>
      </div>
      <Footer />
    </LiveProvider>
  )
}

export default App
