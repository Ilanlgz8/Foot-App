import React from 'react'
import reactLogo from './assets/react.svg'
import './App.css'
import Navbar from './components/navbar.jsx'
import Accueil from './components/Accueil.jsx'
import MatchAVenir from './components/Match.jsx'
import Resultat from './components/Resultat.jsx'
import Classement from './components/Classement.jsx'
import { Routes, Route } from 'react-router-dom'


function App() {
  return (
    <>
   
      <Navbar />
      <Routes>
        <Route path="/" element={<Accueil />} />
        <Route path="/matchs" element={<MatchAVenir />} />
        <Route path="/resultats" element={<Resultat />} />
        <Route path="/classement" element={<Classement />} />
      </Routes>
    
    </>
  )
}

export default App
