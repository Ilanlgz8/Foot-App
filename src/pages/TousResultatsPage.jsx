/**
 * TousResultatsPage.jsx — « Tous les résultats » (/tous-les-resultats), 17/11.
 * Ouverte par « Voir tous les résultats » sous le panneau « Résultats récents » de l'Accueil.
 * Mêmes données et même logique que ce panneau (useRecentDaysMatches + buildRecentResults) —
 * aucun appel réseau en plus : les jours sont déjà en cache. Même navigation par flèches
 * (jour précédent / suivant), même jour affiché que sur l'Accueil, mais tout en plein écran,
 * groupé par compétition.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRecentDaysMatches } from '../hooks/useTodayMatches'
import { useLiveData } from '../context/LiveProvider'
import { buildRecentResults } from '../utils/recentResults'
import { ResultPanel } from '../accueil/ResultPanel'
import '../accueil.css'
import '../tousResultats.css'

const RESULTS_DAYS_BACK = 7 // même valeur qu'Accueil.jsx (même cache React Query)

export default function TousResultatsPage() {
  const navigate = useNavigate()
  const { liveMatches, espnScores } = useLiveData()
  const { matches: resultsSourceMatches, loading } = useRecentDaysMatches(RESULTS_DAYS_BACK)
  const [view, setView] = useState('comp')

  const filteredResults = resultsSourceMatches.filter(m => m.status === 'FINISHED')
  const results = buildRecentResults({ resultsSourceMatches, filteredResults, espnScores, liveMatches })

  return (
    <section className="tousRes">
      <div className="tousRes__inner">
        <div className="tousRes__head">
          <button
            type="button"
            className="tousRes__back"
            aria-label="Retour"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
          </button>
          <h1 className="tousRes__title">Tous les résultats</h1>
        </div>

        <div className="accueil__resultTabs tousRes__tabs">
          <button className={'accueil__resultTab' + (view === 'comp' ? ' accueil__resultTab--active' : '')} onClick={() => setView('comp')}>Par compétition</button>
          <button className={'accueil__resultTab' + (view === 'chrono' ? ' accueil__resultTab--active' : '')} onClick={() => setView('chrono')}>Tous</button>
        </div>

        <div className="accueil__dashPanel tousRes__panel">
          <ResultPanel results={results} loading={loading} view={view} />
        </div>
      </div>
    </section>
  )
}
