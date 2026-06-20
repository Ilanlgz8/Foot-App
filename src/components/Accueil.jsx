import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useNews } from '../hooks/useNews'
import { useTodayMatches, prefetchMatchesForDate } from '../hooks/useTodayMatches'
import { useMatches } from '../hooks/useMatchs'
import { useLiveData } from '../context/LiveProvider'
import { getTrackedMatches, toggleTrackedMatch, getMatchState } from '../utils/matchStateTracker'
import { COMPETITIONS } from '../data/competitions'
import { LiveWidget } from '../accueil/LiveWidget'
import { MatchPanel } from '../accueil/MatchCard'
import { ResultPanel } from '../accueil/ResultPanel'
import { NewsCarousel } from '../accueil/NewsCarousel'
import MatchModal from './MatchModal'
import '../accueil.css'

const MAX_TRACKED = 5

function getDayLabel(offset) {
  if (offset === 0) return "Aujourd'hui"
  if (offset === 1) return 'Demain'
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

function getTargetDate(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  // Utiliser la date locale (pas UTC) pour éviter le décalage après minuit
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Persisté au niveau module pour survivre aux navigations (remounts)
// On sauvegarde aussi la date du jour pour détecter le passage de minuit
let _savedDayOffset = 0
let _savedMinDayOffset = 0
let _savedDate = getTargetDate(0)  // date locale au moment de la dernière sauvegarde

function Accueil() {
  // Si la date a changé depuis la dernière sauvegarde (passage de minuit),
  // on repart de 0 pour que l'offset corresponde à la nouvelle "aujourd'hui"
  const todayDateStr = getTargetDate(0)
  if (_savedDate !== todayDateStr) {
    _savedDayOffset = 0
    _savedMinDayOffset = 0
    _savedDate = todayDateStr
  }

  const [dayOffset, setDayOffset] = useState(_savedDayOffset)
  const [minDayOffset, setMinDayOffset] = useState(_savedMinDayOffset)
  const targetDate   = getTargetDate(dayOffset)
  const queryClient  = useQueryClient()

  // Sync les valeurs dans les variables module à chaque changement
  useEffect(() => { _savedDayOffset = dayOffset; _savedDate = getTargetDate(0) }, [dayOffset])
  useEffect(() => { _savedMinDayOffset = minDayOffset }, [minDayOffset])

  // ── Données ──
  const { news, loading: newsLoading, error: newsError } = useNews()
  const { matches, loading: matchesLoading }             = useTodayMatches(targetDate)
  // Même hook + même clé cache que la page Résultats (WC FINISHED) → requête partagée, synchro instantanée
  const { matches: results, loading: resultsLoading }    = useMatches('WC', 'FINISHED', 'desc')

  // ── Données live (depuis LiveProvider — polling continu même hors de cette page) ──
  const { liveMatches, espnScores, recalibrate } = useLiveData()
  const navigate = useNavigate()

  // ── Modal live (clic sur carte LiveWidget) ──
  // liveModal = { match, espnScore } | null
  const [liveModal, setLiveModal] = useState(null)

  // ── Suivi précis ──
  const [trackedIds, setTrackedIds] = useState(() => getTrackedMatches())

  useEffect(() => {
    if (matches.length > 0 && matches.length <= MAX_TRACKED) {
      let changed = false
      const ids = getTrackedMatches()
      matches.filter(m => m.status !== 'FINISHED').forEach(m => {
        if (!ids.has(String(m.id))) { toggleTrackedMatch(m.id); changed = true }
      })
      if (changed) setTrackedIds(getTrackedMatches())
    }
  }, [matches.length])

  // Auto-avance au jour suivant si aujourd'hui n'a plus de match à venir
  // (tous terminés ou aucun match ce jour-là)
  useEffect(() => {
    if (matchesLoading) return
    if (dayOffset !== 0) return  // seulement si on est sur "aujourd'hui"
    const hasUpcoming = matches.some(m => m.status !== 'FINISHED')
    if (!hasUpcoming) {
      // Petit délai pour éviter un flash si les données arrivent en deux temps
      const id = setTimeout(() => { setDayOffset(1); setMinDayOffset(1) }, 800)
      return () => clearTimeout(id)
    }
  }, [matches, matchesLoading, dayOffset])

  const handleToggleTrack = (matchId) => {
    const ids = getTrackedMatches()
    if (!ids.has(String(matchId)) && ids.size >= MAX_TRACKED) return
    toggleTrackedMatch(matchId)
    setTrackedIds(getTrackedMatches())
  }
  const trackHandler = matches.length > MAX_TRACKED ? handleToggleTrack : null

  // ── Préchargement des jours adjacents ──
  useEffect(() => {
    if (matchesLoading) return
    let cancelled = false
    const run = async () => {
      await new Promise(r => setTimeout(r, 2000))
      if (cancelled) return
      await prefetchMatchesForDate(queryClient, getTargetDate(dayOffset + 1))
      if (dayOffset > 0 && !cancelled) {
        await prefetchMatchesForDate(queryClient, getTargetDate(dayOffset - 1))
      }
    }
    run()
    return () => { cancelled = true }
  }, [dayOffset, matchesLoading, queryClient])

  // ── Ticker 30s pour faire avancer calcMinute() ──
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const wcComp   = COMPETITIONS.find(c => c.id === 'WC')
  const todayStr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
    <section className="accueil">
      <div className="accueil__backdrop accueil__backdrop--one" />
      <div className="accueil__backdrop accueil__backdrop--two" />

      <div className="accueil__inner">

        {/* ── Hero ── */}
        <div className="accueil__hero accueil__hero--inline">
          <div className="accueil__heroLeft">
            <div className="accueil__kickerRow">
              <p className="accueil__kicker">
                <span className="accueil__kickerDot" />
                Le foot comme tu veux le voir
              </p>
              {liveMatches.length > 0 && (
                <button className="accueil__livePageBtn accueil__livePageBtn--mobile" onClick={() => navigate('/live')}>
                  <span className="accueil__livePageBtnDot" />
                  DIRECT
                  <span className="accueil__livePageBtnArrow">›</span>
                </button>
              )}
            </div>
          </div>
          <div className="accueil__heroRight">
            <p className="accueil__heroDate">{todayStr}</p>
            <LiveWidget
              liveMatches={liveMatches}
              espnScores={espnScores}
              trackedIds={trackedIds}
              onRecalibrate={recalibrate}
              onMatchClick={(m) => setLiveModal({ match: m, espnScore: espnScores?.[m.id] })}
            />
          </div>
        </div>

        {/* ── Dashboard : 2 colonnes ── */}
        <div className="accueil__dashboard">

          {/* Panel gauche : Matchs du jour */}
          <div className="accueil__dashPanel">
            <div className="accueil__dashPanelHeader">
              <button className="accueil__dayArrow" onClick={() => setDayOffset(o => Math.max(minDayOffset, o - 1))} disabled={dayOffset <= minDayOffset} aria-label="Jour précédent">‹</button>
              <h2 className="accueil__dashPanelTitle accueil__dashPanelTitle--center">{getDayLabel(dayOffset)}</h2>
              <button className="accueil__dayArrow" onClick={() => setDayOffset(o => o + 1)} aria-label="Jour suivant">›</button>
            </div>
            <div className="accueil__dashPanelDivider" />
            <MatchPanel
              matches={dayOffset === 0
                ? matches.filter(m =>
                    m.status !== 'FINISHED' &&
                    !liveMatches.some(l => l.id === m.id) &&
                    !getMatchState(m.id).ft
                  )
                : matches}
              loading={matchesLoading}
              espnScores={espnScores}
              trackedIds={trackedIds}
              onTrack={trackHandler}
              totalMatchCount={matches.length}
            />
          </div>

          {/* Panel droit : Résultats récents */}
          <div className="accueil__dashPanel">
            <div className="accueil__dashPanelHeader">
              <h2 className="accueil__dashPanelTitle">Résultats récents</h2>
              {wcComp?.emblem && (
                <span className="accueil__dashPanelSub accueil__dashPanelSub--comp">
                  <img src={wcComp.emblem} alt="" className="accueil__dashPanelCompLogo" />
                  Coupe du monde
                </span>
              )}
            </div>
            <div className="accueil__dashPanelDivider" />
            <ResultPanel
              results={[
                // Matchs du jour terminés via ESPN (ft flag) — en tête
                ...matches
                  .filter(m => getMatchState(m.id).ft && !liveMatches.some(l => l.id === m.id))
                  .map(m => ({
                    ...m,
                    score: {
                      fullTime: {
                        home: espnScores[m.id]?.home ?? m.score?.fullTime?.home,
                        away: espnScores[m.id]?.away ?? m.score?.fullTime?.away,
                      }
                    },
                    status: 'FINISHED',
                  })),
                ...results,
              ]}
              loading={resultsLoading}
            />
          </div>

        </div>

        {/* ── Actualités ── */}
        <NewsCarousel news={news} loading={newsLoading} error={newsError} />

      </div>
    </section>

    {/* ── Modal stats live (clic sur carte LiveWidget) ── */}
    {liveModal && (
      <MatchModal
        match={liveModal.match}
        espnScore={liveModal.espnScore}
        onClose={() => setLiveModal(null)}
        defaultTab="livestats"
      />
    )}
    </>
  )
}

export default Accueil
