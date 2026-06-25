import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useNews } from '../hooks/useNews'
import { useTodayMatches, prefetchMatchesForDate } from '../hooks/useTodayMatches'
import { useLiveData } from '../context/LiveProvider'
import { getTrackedMatches, toggleTrackedMatch, getMatchState } from '../utils/matchStateTracker'
import { COMPETITIONS } from '../data/competitions'
import { LiveWidget } from '../accueil/LiveWidget'
import { MatchPanel } from '../accueil/MatchCard'
import { ResultPanel } from '../accueil/ResultPanel'
import { NewsCarousel } from '../accueil/NewsCarousel'
import '../accueil.css'

/** Chips de filtre par compétition */
function CompFilter({ competitions, active, onChange }) {
  if (competitions.length <= 1) return null
  return (
    <div className="accueil__compFilter">
      <button
        className={`accueil__compChip${active === null ? ' accueil__compChip--active' : ''}`}
        onClick={() => onChange(null)}
      >
        Tous
      </button>
      {competitions.map(c => (
        <button
          key={c.id}
          className={`accueil__compChip${active === c.id ? ' accueil__compChip--active' : ''}`}
          onClick={() => onChange(c.id)}
        >
          {c.emblem && <img src={c.emblem} alt="" />}
          {c.shortName}
        </button>
      ))}
    </div>
  )
}

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

  // ── Filtres compétition ──
  const [compFilterMatch,  setCompFilterMatch]  = useState(null)
  const [compFilterResult, setCompFilterResult] = useState(null)
  const [resultView, setResultView] = useState('chrono') // 'chrono' | 'comp'
  const queryClient  = useQueryClient()

  // Sync les valeurs dans les variables module à chaque changement
  useEffect(() => { _savedDayOffset = dayOffset; _savedDate = getTargetDate(0) }, [dayOffset])
  useEffect(() => { _savedMinDayOffset = minDayOffset }, [minDayOffset])

  // Détecter le passage de minuit → réinitialiser dayOffset au nouveau "aujourd'hui"
  // (le module-level check ne suffit pas car useState ignore les changements de sa valeur initiale)
  useEffect(() => {
    let lastDate = getTargetDate(0)
    const id = setInterval(() => {
      const newDate = getTargetDate(0)
      if (newDate !== lastDate) {
        lastDate = newDate
        _savedDayOffset    = 0
        _savedMinDayOffset = 0
        _savedDate         = newDate
        setDayOffset(0)
        setMinDayOffset(0)
      }
    }, 30_000) // vérifie toutes les 30s — suffisant pour ne pas rater minuit
    return () => clearInterval(id)
  }, [])

  // ── Données ──
  const { news, loading: newsLoading, error: newsError } = useNews()
  const { matches, loading: matchesLoading }             = useTodayMatches(targetDate)

  // Résultats récents : toujours basés sur aujourd'hui (absolu) + hier.
  // Indépendant de dayOffset — le panneau résultats affiche toujours les matchs
  // terminés du jour courant et de la veille, même quand on consulte un jour futur.
  const absoluteToday = todayDateStr
  const absoluteYesterday = useMemo(() => {
    const d = new Date(absoluteToday + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [absoluteToday])
  // React Query déduplique : si dayOffset=0, absoluteToday === targetDate → pas de double fetch
  const { matches: todayMatchesForResults }     = useTodayMatches(absoluteToday)
  const { matches: yesterdayMatchesForResults } = useTodayMatches(absoluteYesterday)

  const results = useMemo(() => {
    const seen = new Set()
    return [...todayMatchesForResults, ...yesterdayMatchesForResults]
      .filter(m => {
        if (m.status !== 'FINISHED') return false
        if (seen.has(m.id)) return false
        seen.add(m.id)
        return true
      })
  }, [todayMatchesForResults, yesterdayMatchesForResults])
  const resultsLoading = matchesLoading

  // ── Données live (depuis LiveProvider — polling continu même hors de cette page) ──
  const { liveMatches, espnScores, recalibrate } = useLiveData()
  const navigate = useNavigate()

  // ── Modal live (clic sur carte LiveWidget) ──
  // live → navigate('/live/:matchId'), pas de modal

  // pré-match → navigation vers /match/:matchId (plus de modal)

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

  // ── Ticker 10s pour faire avancer calcMinute() et détecter pending kickoffs ──
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000)
    return () => clearInterval(id)
  }, [])

  // ── Compétitions disponibles dans les données actuelles ──
  const matchCompetitions = useMemo(() => {
    const seen = new Set()
    const out  = []
    for (const m of matches) {
      const id = m.competition?.id
      if (id && !seen.has(id)) {
        seen.add(id)
        const meta = COMPETITIONS.find(c => c.id === id)
        out.push({ id, shortName: meta?.shortName ?? m.competition?.name ?? id, emblem: meta?.emblem ?? null })
      }
    }
    return out
  }, [matches])

  const resultCompetitions = useMemo(() => {
    const seen = new Set()
    const out  = []
    for (const m of results) {
      const id = m.competition?.id
      if (id && !seen.has(id)) {
        seen.add(id)
        const meta = COMPETITIONS.find(c => c.id === id)
        out.push({ id, shortName: meta?.shortName ?? m.competition?.name ?? id, emblem: meta?.emblem ?? null })
      }
    }
    return out
  }, [results])

  // Réinitialiser le filtre matchs si la compétition disparaît des données (changement de jour)
  useEffect(() => {
    if (compFilterMatch && !matchCompetitions.some(c => c.id === compFilterMatch)) {
      setCompFilterMatch(null)
    }
  }, [matchCompetitions, compFilterMatch])

  // Matchs + résultats filtrés
  const filteredMatches = compFilterMatch  ? matches.filter(m => m.competition?.id === compFilterMatch)  : matches
  const filteredResults = compFilterResult ? results.filter(r => r.competition?.id === compFilterResult) : results

  const wcComp   = COMPETITIONS.find(c => c.id === 'WC')
  const todayStr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  // ── Pending kickoffs : matchs dont l'heure est atteinte mais ESPN pas encore confirmé ──
  // Détection directe depuis todayMatches (ne dépend pas du liveTracker).
  // Le widget s'affiche dès l'heure H avec "Débute" — max 10s de délai (ticker).
  const nowMs = Date.now()
  const pendingMatches = dayOffset === 0
    ? matches.filter(m => {
        // FD.org utilise 'TIMED' pour les matchs à venir (WC inclus), pas seulement 'SCHEDULED'
        if (m.status !== 'SCHEDULED' && m.status !== 'TIMED') return false
        if (liveMatches.some(l => l.id === m.id)) return false
        const utcMs = new Date(m.utcDate).getTime()
        return nowMs >= utcMs && nowMs - utcMs < 30 * 60_000
      })
    : []

  // widgetMatches = live confirmés + pending kickoffs
  const widgetMatches = pendingMatches.length > 0
    ? [...liveMatches, ...pendingMatches]
    : liveMatches

  // Résultats récents partagés (utilisés dans le panneau résultats)
  const resultPanel = (() => {
    const now4h = Date.now() - 4 * 60 * 60_000
    const todayFt = matches.filter(m => {
      if (liveMatches.some(l => l.id === m.id)) return false
      const st = getMatchState(m.id)
      if (st.ft) return true
      if (st.liveState === 'ended' && st.endedAt > now4h) return true
      return false
    })
    const todayFtIds = new Set(todayFt.map(m => m.id))
    const todayFtMapped = todayFt.map(m => {
      let lsHome = null, lsAway = null
      try {
        const lsScore = JSON.parse(localStorage.getItem(`foot_espn_${m.id}`) ?? 'null')
        if (lsScore && lsScore.home != null) { lsHome = lsScore.home; lsAway = lsScore.away }
      } catch {}
      return {
        ...m,
        score: { fullTime: { home: espnScores[m.id]?.home ?? lsHome ?? m.score?.fullTime?.home, away: espnScores[m.id]?.away ?? lsAway ?? m.score?.fullTime?.away } },
        status: 'FINISHED',
      }
    })
    return [...todayFtMapped, ...filteredResults.filter(r => !todayFtIds.has(r.id))]
  })()

  return (
    <section className="accueil">
      <div className="accueil__backdrop accueil__backdrop--one" />
      <div className="accueil__backdrop accueil__backdrop--two" />

      <div className="accueil__inner">

        {/* ── Mini header ── */}
        <div className="accueil__miniHeader">
          <h1 className="accueil__miniTitle">
            <span className="accueil__heroStat">Stat</span>Footix
          </h1>
          <span className="accueil__miniDate">{todayStr}</span>
        </div>

        {/* ── Live — pleine largeur, priorité absolue ── */}
        {widgetMatches.length > 0 && (
          <div className="accueil__liveSection">
            <div className="accueil__liveSectionHeader">
              <span className="accueil__liveDot" />
              <span className="accueil__liveSectionTitle">EN DIRECT</span>
              <button className="accueil__liveDirectBtn" onClick={() => navigate('/live')}>
                Voir tout <span className="accueil__livePageBtnArrow">›</span>
              </button>
            </div>
            <LiveWidget
              liveMatches={widgetMatches}
              espnScores={espnScores}
              trackedIds={trackedIds}
              onRecalibrate={recalibrate}
              onMatchClick={(m) => navigate(`/live/${m.id}`)}
            />
          </div>
        )}

        {/* ── Grille matchs / résultats — toujours 2 colonnes sur desktop ── */}
        <div className="accueil__mainGrid">

          {/* Matchs à venir */}
          <div className="accueil__dashPanel accueil__dashPanel--matchPanel">
            <div className="accueil__dashPanelHeader">
              <button className="accueil__dayArrow" onClick={() => setDayOffset(o => Math.max(minDayOffset, o - 1))} disabled={dayOffset <= minDayOffset} aria-label="Jour précédent">‹</button>
              <h2 className="accueil__dashPanelTitle accueil__dashPanelTitle--center">{getDayLabel(dayOffset)}</h2>
              <button className="accueil__dayArrow" onClick={() => setDayOffset(o => o + 1)} aria-label="Jour suivant">›</button>
            </div>
            <CompFilter competitions={matchCompetitions} active={compFilterMatch} onChange={setCompFilterMatch} />
            <div className="accueil__dashPanelDivider" />
            <MatchPanel
              matches={dayOffset === 0
                ? filteredMatches.filter(m => {
                    if (widgetMatches.some(l => l.id === m.id)) return false
                    if (m.status === 'IN_PLAY' || m.status === 'PAUSED') return false
                    if (m.status === 'FINISHED' || getMatchState(m.id).ft) return false
                    return true
                  })
                : filteredMatches}
              loading={matchesLoading}
              espnScores={espnScores}
              onMatchClick={m => navigate(`/match/${m.id}`, { state: { match: m } })}
            />
          </div>

          {/* Résultats récents */}
          <div className="accueil__dashPanel">
            <div className="accueil__dashPanelHeader accueil__dashPanelHeader--withFilter">
              <h2 className="accueil__dashPanelTitle">Résultats récents</h2>
              <div className="accueil__resultHeaderRight">
                <CompFilter competitions={resultCompetitions} active={compFilterResult} onChange={setCompFilterResult} />
                <div className="accueil__resultTabs accueil__resultTabs--header">
                  <button className={'accueil__resultTab' + (resultView === 'chrono' ? ' accueil__resultTab--active' : '')} onClick={() => setResultView('chrono')}>Tous</button>
                  <button className={'accueil__resultTab' + (resultView === 'comp' ? ' accueil__resultTab--active' : '')} onClick={() => setResultView('comp')}>Par compétition</button>
                </div>
              </div>
            </div>
            <div className="accueil__dashPanelDivider" />
            <ResultPanel results={resultPanel} loading={resultsLoading} view={resultView} />
          </div>

        </div>

        {/* ── Actualités — inchangé ── */}
        <NewsCarousel news={news} loading={newsLoading} error={newsError} />

      </div>
    </section>
  )
}

export default Accueil
