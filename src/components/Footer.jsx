import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import '../footer.css'

function AProposModal({ onClose }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return createPortal(
    <div className="footer__modalOverlay" onClick={onClose}>
      <div className="footer__modalBox" onClick={e => e.stopPropagation()}>
        <div className="footer__modalHeader">
          <h2 className="footer__modalTitle">À propos</h2>
          <button className="footer__modalClose" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="footer__modalBody">
          <h3>Le projet</h3>
          <p>StatFootix est une application web de statistiques et d'actualités footballistiques, conçue pour suivre les scores, résultats et classements des plus grandes compétitions. L'objectif : avoir toutes les infos foot au même endroit, avec un design propre et une expérience fluide — <em>le foot comme tu veux le voir</em>.</p>

          <h3>Pourquoi ce projet</h3>
          <p>L'idée est née d'un constat simple : les applications foot existantes sont soit trop chargées, soit trop lentes, soit derrière un paywall. StatFootix se veut léger, rapide et entièrement gratuit, sans pub ni inscription.</p>

          <h3>Compétitions couvertes</h3>
          <p>StatFootix couvre actuellement la <strong>Coupe du Monde FIFA</strong> avec les phases de groupes, le tableau à élimination directe, les classements et les résultats en temps réel. D'autres compétitions (Champions League, Ligue 1, Premier League…) sont prévues.</p>

          <h3>Fonctionnalités</h3>
          <p>Scores en direct avec minutes calculées en temps réel, matchs à venir avec navigation jour par jour, résultats récents, classements de groupes interactifs, widget live dans l'accueil, actualités football et modal de détail par match.</p>

          <h3>Roadmap</h3>
          <p>Prochainement : support multi-compétitions (Champions League, Ligue 1, Premier League), notifications de buts, historique des confrontations, statistiques joueurs et recherche d'équipes.</p>

          <h3>Données & fraîcheur</h3>
          <p>Les données sont fournies par l'API <strong>football-data.org</strong> et mises en cache localement (30 min pour les résultats, rafraîchissement automatique en direct). Les scores live sont mis à jour toutes les 30 secondes.</p>

          <h3>Technologies</h3>
          <p>Développé avec <strong>React</strong> + <strong>TanStack Query</strong> pour la gestion du cache. Déployé sur <strong>Netlify</strong> avec des fonctions serverless pour sécuriser les appels API. Zéro dépendance inutile, code 100% open.</p>

          <h3>Contact</h3>
          <p>Une suggestion, un bug ou une idée ? Contacte-nous à <strong>korityx.pro@gmail.com</strong>.</p>
        </div>
      </div>
    </div>,
    document.body
  )
}

function Footer() {
  const year = new Date().getFullYear()
  const [showAPropos, setShowAPropos] = useState(false)

  return (
    <>
      <footer className="footer">
        <div className="footer__container">
          <span className="footer__brand">
            <span className="footer__brandStat">Stat</span>Footix
            <span className="footer__copy"> © {year} — Tous droits réservés</span>
          </span>
          <div className="footer__links">
            <Link to="/" className="footer__link">
              Accueil
            </Link>
            <button className="footer__link" onClick={() => setShowAPropos(true)}>
              À propos
            </button>
            <span className="footer__sep">·</span>
            <Link to="/mentions-legales" className="footer__link">
              Mentions légales
            </Link>
          </div>
        </div>
      </footer>
      {showAPropos && <AProposModal onClose={() => setShowAPropos(false)} />}
    </>
  )
}

export default Footer
