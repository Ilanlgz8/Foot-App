import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useNews } from '../hooks/useNews'
import { useTodayMatches, prefetchMatchesForDate, useRecentDaysMatches } from '../hooks/useTodayMatches'
import { useUpcomingMatchesAllComps } from '../hooks/useMatchs'
import { useTeamFormMulti } from '../hooks/useTeamForm'
import { useLiveData } from '../context/LiveProvider'
import { getMatchState, isRecentlyFinished } from '../utils/matchStateTracker'
import { mergeScore } from '../utils/matchUtils'
import { COMPETITIONS } from '../data/competitions'
import { MatchDuJourCard } from '../accueil/MatchDuJourCard'
import { MyTeamBanner } from '../accueil/MyTeamBanner'
import { useFavoriteClubs } from '../hooks/useFavoriteClubs'
import { pickMatchDuJour } from '../utils/matchDuJour'
import { MatchPanel } from '../accueil/MatchCard'
import { ResultPanel } from '../accueil/ResultPanel'
import { NewsCarousel } from '../accueil/NewsCarousel'
import '../accueil.css'

// Même logique de priorité que pickMatchDuJour (Mondial > Ligue des Champions
// > les 5 grands championnats à égalité) — réutilisée ici pour choisir quelle
// compétition montrer dans le mini widget classement de l'Accueil.

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

// Toutes les compétitions suivies — pour la recherche du prochain jour avec
// un match (voir useUpcomingMatchesAllComps plus bas).
const ACCUEIL_COMP_IDS = COMPETITIONS.map(c => c.id)

// Persisté au niveau module pour survivre aux navigations (remounts)
// On sauvegarde aussi la date du jour pour détecter le passage de minuit
let _savedDayOffset = 0
let _savedDate = getTargetDate(0)  // date locale au moment de la dernière sauvegarde

function Accueil() {
  // Si la date a changé depuis la dernière sauvegarde (passage de minuit),
  // on repart de 0 pour que l'offset corresponde à la nouvelle "aujourd'hui"
  const todayDateStr = getTargetDate(0)
  if (_savedDate !== todayDateStr) {
    _savedDayOffset = 0
    _savedDate = todayDateStr
  }

  const [dayOffset, setDayOffset] = useState(_savedDayOffset)
  const targetDate   = getTargetDate(dayOffset)

  // ── Filtres compétition ──
  const [compFilterMatch,  setCompFilterMatch]  = useState(null)
  const [compFilterResult, setCompFilterResult] = useState(null)
  const [resultView, setResultView] = useState('chrono') // 'chrono' | 'comp'
  const queryClient  = useQueryClient()

  // Sync les valeurs dans les variables module à chaque changement
  useEffect(() => { _savedDayOffset = dayOffset; _savedDate = getTargetDate(0) }, [dayOffset])

  // Détecter le passage de minuit → réinitialiser dayOffset au nouveau "aujourd'hui"
  // (le module-level check ne suffit pas car useState ignore les changements de sa valeur initiale)
  useEffect(() => {
    let lastDate = getTargetDate(0)
    const id = setInterval(() => {
      const newDate = getTargetDate(0)
      if (newDate !== lastDate) {
        lastDate = newDate
        _savedDayOffset    = 0
        _savedDate         = newDate
        setDayOffset(0)
      }
    }, 30_000) // vérifie toutes les 30s — suffisant pour ne pas rater minuit
    return () => clearInterval(id)
  }, [])

  // ── Données ──
  const { news, loading: newsLoading, error: newsError } = useNews()
  const { matches, loading: matchesLoading }             = useTodayMatches(targetDate)

  // Résultats récents : jusqu'à 7 jours en arrière (était limité à
  // aujourd'hui + hier — retour utilisateur : impossible de consulter plus
  // loin). Indépendant de dayOffset — le panneau résultats affiche toujours
  // les matchs terminés des derniers jours, même quand on consulte un jour
  // futur dans "Matchs". Coût réseau marginal grâce au cache (voir
  // useRecentDaysMatches) : chaque jour PASSÉ est mis en cache 6h dès son
  // premier fetch (un résultat FINISHED ne change plus), seul "aujourd'hui"
  // est vraiment rafraîchi souvent.
  const RESULTS_DAYS_BACK = 7
  const absoluteToday = todayDateStr
  // React Query déduplique : si dayOffset=0, absoluteToday === targetDate → pas de double fetch
  const { matches: todayMatchesForResults } = useTodayMatches(absoluteToday)
  const { matches: resultsSourceMatches, loading: recentDaysLoading } = useRecentDaysMatches(RESULTS_DAYS_BACK)

  // Match du jour : toujours basé sur aujourd'hui (absolu), indépendant de
  // dayOffset — comme le panneau résultats juste au-dessus, pour ne pas
  // changer quand l'utilisateur navigue vers un autre jour dans "Matchs".
  // Le garde-fou "un seul match = pas de carte" est dans pickMatchDuJour lui-
  // même, basé sur le nombre de matchs À VENIR (pas le total de la journée,
  // qui inclurait des matchs déjà terminés/live et fausserait le décompte).
  const matchDuJour = useMemo(() => pickMatchDuJour(todayMatchesForResults), [todayMatchesForResults])

  const results = useMemo(
    () => resultsSourceMatches.filter(m => m.status === 'FINISHED'),
    [resultsSourceMatches]
  )
  const resultsLoading = recentDaysLoading

  // Forme (5 derniers résultats) pour les losanges sous chaque nom d'équipe —
  // fusion de toutes les compétitions présentes dans les 2 panneaux (matchs
  // + résultats), puisqu'ils mélangent plusieurs championnats à la fois.
  const formCompCodes = useMemo(() => {
    const codes = new Set()
    for (const m of matches) if (m.competition?.code) codes.add(m.competition.code)
    for (const m of results) if (m.competition?.code) codes.add(m.competition.code)
    return [...codes]
  }, [matches, results])
  const { formMap } = useTeamFormMulti(formCompCodes)

  // ── Données live (depuis LiveProvider — polling continu même hors de cette page) ──
  const { liveMatches, espnScores, recalibrate } = useLiveData()
  const navigate = useNavigate()

  // ── Bandeau "Mon équipe" ──
  // Cherche un match d'une équipe favorite UNIQUEMENT parmi les données déjà
  // chargées par cette page (live en cours, matchs d'aujourd'hui, matchs du
  // jour actuellement affiché dans le panneau "à venir") — pas de fetch dédié,
  // pour rester cohérent avec le principe "aucun coût réseau supplémentaire".
  // Priorité : live maintenant > encore à jouer aujourd'hui > prochain jour
  // avec matchs déjà chargé. Si rien ne correspond, le bandeau ne s'affiche
  // simplement pas (pas de recherche plus large délibérément).
  const { favorites: favClubs } = useFavoriteClubs()
  const favMatch = useMemo(() => {
    if (favClubs.length === 0) return null
    const favIds = new Set(favClubs.map(t => t.id))
    const involvesFav = (m) => favIds.has(m.homeTeam?.id) || favIds.has(m.awayTeam?.id)

    const live = liveMatches.find(involvesFav)
    if (live) return { match: live, isLive: true }

    const todayUpcoming = todayMatchesForResults.find(m => involvesFav(m) && m.status !== 'FINISHED')
    if (todayUpcoming) return { match: todayUpcoming, isLive: false }

    const nextLoaded = matches.find(m => involvesFav(m) && (m.status === 'TIMED' || m.status === 'SCHEDULED'))
    if (nextLoaded) return { match: nextLoaded, isLive: false }

    return null
  }, [favClubs, liveMatches, todayMatchesForResults, matches])

  // ── Navigation cartes ──
  // live (card en mode live, voir MatchPanel/onLiveClick) → /live/:matchId
  // pré-match → /match/:matchId (pas de modal)

  // Matchs à venir toutes compétitions, fenêtre large (30j) — sert UNIQUEMENT
  // à savoir où sauter quand le jour affiché est vide (voir effet ci-dessous).
  // Fenêtre distincte de celle de Pronos (7j, volontairement plus courte) :
  // paramètre windowDays dédié dans useUpcomingMatchesAllComps, cache séparé,
  // aucun impact sur Pronos.
  const { matches: upcomingAllComps } = useUpcomingMatchesAllComps(ACCUEIL_COMP_IDS, 30)

  // ⚠️ AMÉLIORÉ (constat utilisateur : si aujourd'hui ET demain n'ont aucun
  // match, l'app restait bloquée sur "Demain" vide — l'ancien mécanisme ne
  // gérait qu'UN SEUL jour vide, et uniquement en partant d'aujourd'hui). Va
  // maintenant chercher, dans les matchs à venir des 30 prochains jours (tous
  // compétitions confondues), le PROCHAIN jour qui a réellement un match, et y
  // saute directement — peu importe qu'il soit demain, dans 3 jours ou dans 10.
  // S'applique à n'importe quel jour vide affiché (pas seulement "aujourd'hui").
  //
  // ⚠️ BUG CORRIGÉ (retour utilisateur : navigation manuelle vers un jour de
  // demi-finale avec des cards "équipe à déterminer" (pas encore de vainqueur
  // de quart) rendait le bouton "jour précédent" bloqué pour de bon) :
  // `setMinDayOffset(diffDays)` verrouillait le bouton "jour précédent" en
  // permanence dès qu'un saut avait eu lieu, même vers un jour éloigné —
  // impossible de revenir à un jour antérieur pourtant valide (aujourd'hui,
  // quarts de finale...). minDayOffset supprimé : le saut auto avance
  // seulement `dayOffset`, plus aucune restriction sur le retour manuel —
  // la logique de déclenchement elle-même (hasUpcoming, ci-dessous) est
  // INCHANGÉE : elle doit continuer à sauter dès que le jour affiché n'a plus
  // AUCUN match à venir (jour vide OU tous les matchs déjà terminés), y
  // compris au lancement de l'app à chaque fois.
  useEffect(() => {
    if (matchesLoading) return
    const hasUpcoming = matches.some(m => m.status !== 'FINISHED')
    if (hasUpcoming) return

    const endOfTargetDay = new Date(`${targetDate}T23:59:59`).getTime()
    const next = upcomingAllComps.find(m => new Date(m.utcDate).getTime() > endOfTargetDay)
    if (!next) return  // rien de connu dans les 30j — on reste où on est

    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const next0  = new Date(next.utcDate); next0.setHours(0, 0, 0, 0)
    const diffDays = Math.round((next0 - today0) / 86_400_000)
    if (diffDays <= dayOffset) return  // ne recule jamais

    // Petit délai pour éviter un flash si les données arrivent en deux temps
    const id = setTimeout(() => { setDayOffset(diffDays) }, 800)
    return () => clearTimeout(id)
  }, [matches, matchesLoading, dayOffset, targetDate, upcomingAllComps])

  // ── Flèche "jour suivant" : saut DIRECT au prochain jour qui a un match ──
  // (retour utilisateur : cliquer avançait d'un seul jour à la fois, et sur
  // un jour vide ne se corrigeait qu'après coup via l'effet passif ci-dessus
  // — délai visible + "ça revient au jour d'aujourd'hui" ressenti comme un
  // bug. Même logique de recherche que l'effet passif (prochain match dans
  // les 30j, toutes compétitions), mais déclenchée immédiatement au clic au
  // lieu d'attendre un re-render + 800ms.) Vaut `null` si aucun match à venir
  // n'est connu dans la fenêtre → sert aussi à désactiver la flèche.
  const nextMatchDayOffset = useMemo(() => {
    const endOfTargetDay = new Date(`${targetDate}T23:59:59`).getTime()
    const next = upcomingAllComps.find(m => new Date(m.utcDate).getTime() > endOfTargetDay)
    if (!next) return null
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const next0  = new Date(next.utcDate); next0.setHours(0, 0, 0, 0)
    return Math.round((next0 - today0) / 86_400_000)
  }, [targetDate, upcomingAllComps])

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

  // ── Ticker rapide (1s) tant qu'une card vient de passer "Terminé" ──
  // Sans lui, la card resterait affichée en mode live jusqu'au prochain
  // tick du ticker 10s ci-dessus (ou plus) une fois la fenêtre de grâce
  // passée — voir isRecentlyFinished (matchStateTracker.js) et le même
  // pattern dans Live.jsx/LiveSidebar.jsx. S'arrête tout seul.
  useEffect(() => {
    if (!matches.some(m => isRecentlyFinished(m.id))) return
    const id = setInterval(() => {
      setTick(t => t + 1)
      if (!matches.some(m => isRecentlyFinished(m.id))) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [matches])

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

  // Résultats récents partagés (utilisés dans le panneau résultats)
  const resultPanel = (() => {
    const now4h = Date.now() - 4 * 60 * 60_000
    // resultsSourceMatches (aujourd'hui absolu + hier) — PAS `matches`, qui dépend
    // de dayOffset : sinon ce panneau se vide/réapparaît selon le jour affiché
    // dans "Matchs" (bug signalé : le match disparaît quand on va sur "Demain").
    const todayFt = resultsSourceMatches.filter(m => {
      const st = getMatchState(m.id)
      // ft (confirmé par ESPN) prime toujours, même si liveTracker garde encore
      // le match dans liveMatches (grâce period de 5min avant éviction) — sinon
      // le match reste invisible en Résultats pendant tout ce délai alors qu'il
      // est déjà terminé (signalé par l'utilisateur : "ça met du temps à se mettre").
      if (st.ft) return true
      if (liveMatches.some(l => l.id === m.id)) return false
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
      const es = espnScores[m.id]
      // Tirs au but : voir même fix dans Resultat.jsx — sans ça, score.duration/
      // penalties étaient écrasés par le fullTime reconstruit ci-dessous, et le
      // badge "(x-y tab)" de MatchCard restait vide pour un match qu'ESPN
      // détecte fini avant que football-data.org ne le confirme.
      const wentToPens = es?.homeShootout != null && es?.awayShootout != null
      return {
        ...m,
        score: {
          ...m.score,
          fullTime: {
            home: mergeScore(es?.home, lsHome ?? m.score?.fullTime?.home),
            away: mergeScore(es?.away, lsAway ?? m.score?.fullTime?.away),
          },
          ...(wentToPens ? {
            duration: 'PENALTY_SHOOTOUT',
            penalties: { home: es.homeShootout, away: es.awayShootout },
          } : {}),
        },
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

        {/* ── Mon équipe — au-dessus de tout, mise en avant personnelle ── */}
        {favMatch && (
          <MyTeamBanner
            match={favMatch.match}
            isLive={favMatch.isLive}
            espnScore={espnScores[favMatch.match.id]}
            onClick={() => favMatch.isLive
              ? navigate(`/live/${favMatch.match.id}`)
              : navigate(`/match/${favMatch.match.id}`, { state: { match: favMatch.match } })}
          />
        )}

        {/* ── Match du jour — devant tout le reste, y compris le live ── */}
        {matchDuJour && (
          <MatchDuJourCard
            match={matchDuJour}
            onClick={() => navigate(`/match/${matchDuJour.id}`, { state: { match: matchDuJour } })}
          />
        )}

        {/* ── Grille matchs / résultats — toujours 2 colonnes sur desktop ── */}
        <div className="accueil__mainGrid">

          {/* Matchs à venir — une card qui démarre reste à sa place et passe
              en mode live (score/minute/statut) au lieu de disparaître au
              profit d'un widget séparé ailleurs (demande utilisateur) : plus
              de section "EN DIRECT" dédiée sur l'Accueil, voir isCardLive
              dans accueil/MatchCard.jsx. Un match reste visible ici quelques
              secondes après son "Terminé" (isRecentlyFinished) le temps que
              la transition soit visible, avant de passer définitivement dans
              "Résultats récents". */}
          <div className="accueil__dashPanel accueil__dashPanel--matchPanel">
            <div className="accueil__dashPanelHeader">
              {/* BUG CORRIGÉ (retour utilisateur : "on peut retourner en
                  arrière... alors que les matchs sont finis") : plancher à
                  dayOffset 0 ("aujourd'hui") — ce panneau affiche les matchs
                  À VENIR, revenir avant aujourd'hui n'a pas de sens ici (ces
                  jours-là sont déjà couverts par le panneau "Résultats
                  récents" juste en dessous). Contrairement à l'ancien
                  minDayOffset (supprimé plus haut car il se verrouillait
                  dynamiquement sur un saut auto lointain), ce plancher est
                  FIXE à 0 : jamais de blocage sur un jour autre que le vrai
                  "aujourd'hui". */}
              <button
                className="accueil__dayArrow"
                onClick={() => setDayOffset(o => Math.max(0, o - 1))}
                disabled={dayOffset <= 0}
                aria-label="Jour précédent"
              >‹</button>
              <h2 className="accueil__dashPanelTitle accueil__dashPanelTitle--center">{getDayLabel(dayOffset)}</h2>
              {/* Saut direct au prochain jour avec un match (voir
                  nextMatchDayOffset ci-dessus) — désactivée si aucun match à
                  venir n'est connu dans les 30 prochains jours. */}
              <button
                className="accueil__dayArrow"
                onClick={() => { if (nextMatchDayOffset != null) setDayOffset(nextMatchDayOffset) }}
                disabled={nextMatchDayOffset == null}
                aria-label="Jour suivant"
              >›</button>
            </div>
            <CompFilter competitions={matchCompetitions} active={compFilterMatch} onChange={setCompFilterMatch} />
            <div className="accueil__dashPanelDivider" />
            <MatchPanel
              matches={dayOffset === 0
                ? filteredMatches.filter(m => {
                    if (m.status === 'FINISHED') return false
                    if (getMatchState(m.id).ft) return isRecentlyFinished(m.id)
                    return true
                  })
                : filteredMatches}
              loading={matchesLoading}
              espnScores={espnScores}
              onMatchClick={m => navigate(`/match/${m.id}`, { state: { match: m } })}
              onLiveClick={m => navigate(`/live/${m.id}`)}
              formMap={formMap}
            />
          </div>

          {/* Résultats récents */}
          <div className="accueil__dashPanel accueil__dashPanel--result">
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
            <ResultPanel results={resultPanel} loading={resultsLoading} view={resultView} formMap={formMap} />
          </div>

        </div>

        {/* ── Actualités — inchangé ── */}
        <NewsCarousel news={news} loading={newsLoading} error={newsError} />

      </div>
    </section>
  )
}

export default Accueil
