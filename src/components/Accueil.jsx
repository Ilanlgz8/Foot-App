import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useNews } from '../hooks/useNews'
import { useTodayMatches, prefetchMatchesForDate, useRecentDaysMatches } from '../hooks/useTodayMatches'
import { useUpcomingMatchesAllComps } from '../hooks/useMatchs'
import { useWcKnockout, getKnockoutTeamOverrides, applyKnockoutTeamOverrides } from '../hooks/useWcKnockout'
import { useTeamFormMulti } from '../hooks/useTeamForm'
import { useLiveData } from '../context/LiveProvider'
import { getMatchState, isRecentlyFinished } from '../utils/matchStateTracker'
import { mergeScore, isCardLive, isNationalTeamComp } from '../utils/matchUtils'
import { COMPETITIONS, NO_STANDINGS_COMPS } from '../data/competitions'
import { MatchDuJourCard } from '../accueil/MatchDuJourCard'
import { MyTeamBanner } from '../accueil/MyTeamBanner'
import { useFavoriteClubs } from '../hooks/useFavoriteClubs'
import { pickMatchDuJour } from '../utils/matchDuJour'
import { MatchPanel, PanelSkeleton } from '../accueil/MatchCard'
import { ResultPanel } from '../accueil/ResultPanel'
import { NewsCarousel } from '../accueil/NewsCarousel'
import { LiveCard } from './LiveCardWidget'
import { useStandings } from '../hooks/useStandings'
import { StandingsTable } from './StandingsTable'
import '../accueil.css'
import '../live.css'
import '../classement.css'

// Même logique de priorité que pickMatchDuJour (Mondial > Ligue des Champions
// > les 5 grands championnats à égalité) — réutilisée ici pour choisir quelle
// compétition montrer dans le mini widget classement de l'Accueil.

/** Chips de filtre par compétition.
 *  layout='row' (défaut) → chips horizontales, usage existant (mobile +
 *  desktop, dans l'en-tête des panneaux).
 *  layout='col' → pile verticale, usage nouveau : sidebar compétitions
 *  desktop (voir accueil__sidebar plus bas). */
function CompFilter({ competitions, active, onChange, layout = 'row' }) {
  if (competitions.length <= 1) return null
  return (
    <div className={`accueil__compFilter${layout === 'col' ? ' accueil__compFilter--col' : ''}`}>
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
  const todayDateStr = getTargetDate(0)

  // Si la date a changé depuis la dernière sauvegarde (passage de minuit),
  // on repart de 0 pour que l'offset corresponde à la nouvelle "aujourd'hui".
  // Dans l'initialiseur paresseux de useState (pas dans le corps du composant) :
  // ne s'exécute qu'une fois, au montage — exactement le seul moment où ça
  // compte, puisque c'est la seule fois où _savedDayOffset nourrit l'état
  // initial. Évite de muter des variables module-level pendant le render
  // (ce que React ne garantit pas rejouer/committer de façon fiable en
  // rendu concurrent), sans changer le comportement : la détection en
  // continu (composant déjà monté) reste gérée par l'effet à intervalle
  // plus bas.
  const [dayOffset, setDayOffset] = useState(() => {
    if (_savedDate !== todayDateStr) {
      _savedDayOffset = 0
      _savedDate = todayDateStr
    }
    return _savedDayOffset
  })
  const targetDate   = getTargetDate(dayOffset)

  // ── Filtres compétition ──
  const [compFilterMatch,  setCompFilterMatch]  = useState(null)
  const [compFilterResult, setCompFilterResult] = useState(null)
  const [resultView, setResultView] = useState('chrono') // 'chrono' | 'comp'
  const queryClient  = useQueryClient()

  // ── Refonte layout desktop (demande utilisateur) ──────────────────────────
  // Détection desktop/mobile en JS (nécessaire ici : contrairement au
  // découpage poster/card existant dans MatchPanel — purement CSS, mêmes
  // données affichées différemment — cette refonte change quelles données
  // sont affichées où selon la largeur : ex. les matchs déjà en direct sont
  // exclus de la liste "à venir" seulement sur desktop, voir matchPanelMatches
  // plus bas). Même pattern déjà utilisé dans Match.jsx (isBracketDesktop).
  // Seuil 1025px (PAS le seuil mobile 640px existant) : la sidebar (220px) +
  // la colonne résultats/live (360px) ont besoin d'assez de place pour ne
  // pas écraser la colonne centrale — en dessous de ~1024px (tablette,
  // petite fenêtre desktop), la nouvelle disposition 3 zones dégraderait
  // visiblement (colonne centrale trop étroite). Cette tranche 641-1024px
  // garde donc le même comportement que le mobile pour cette refonte
  // (1 colonne, pas de sidebar, pas de grille live dédiée, résultats
  // toujours affichés — voir @media max-width:1024px dans accueil.css) tout
  // en gardant par ailleurs le style poster désormais commun à toutes les
  // largeurs (voir accueil__posterList).
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1025px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1025px)')
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

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
  const { matches: rawMatches, loading: matchesLoading } = useTodayMatches(targetDate)

  // Remonté ici (était plus bas, juste avant la nav cartes) pour être
  // disponible au moment de calculer `matches` — voir l'exception minuit
  // ci-dessous.
  const { liveMatches, espnScores } = useLiveData()

  // Matchs à venir toutes compétitions, fenêtre large (30j) — sert à savoir où
  // sauter quand le jour affiché est vide (voir effet plus bas) ET, depuis le
  // correctif ci-dessous, de filet de sécurité pour les cards elles-mêmes.
  // Remonté plus haut dans le fichier (était plus bas) pour être disponible
  // au moment de calculer `matches`.
  const { matches: upcomingAllComps } = useUpcomingMatchesAllComps(ACCUEIL_COMP_IDS, 30)

  // Correctif fraîcheur "à déterminer" (même logique que Match.jsx — voir
  // commentaire détaillé dans useWcKnockout.js) : le tableau à élimination
  // directe CdM (10min de cache) confirme les qualifiés (ex: petite finale/
  // finale) plus vite que les cards "à venir" ci-dessous, qui s'appuient sur
  // useTodayMatches (cache 30min-6h côté jours futurs, volontairement long —
  // voir CLAUDE.md, budget CPU Vercel). Plutôt que de raccourcir ce cache
  // (risque de re-déclencher le dépassement CPU pendant la CdM, la période de
  // + forte charge), on réutilise ici les rounds du bracket — 1 seule requête
  // légère en plus (10min de cache, souvent déjà en cache si Programme a été
  // visité dans la session) — pour corriger l'affichage des mêmes matchs.
  const { rounds: wcRounds } = useWcKnockout('WC')
  const knockoutOverrides = useMemo(() => getKnockoutTeamOverrides(wcRounds), [wcRounds])

  // ⚠️ AJOUT (constat utilisateur : la flèche "jour suivant" sautait au 16
  // août — un vrai match LaLiga ce jour-là — mais aucune card ne s'affichait
  // une fois arrivé dessus). Cause probable : useTodayMatches interroge FD.org
  // via l'endpoint MULTI-compétitions `/v4/matches?dateFrom&dateTo&competitions=`
  // (aucun ?season= précisé), alors que la recherche du jour à sauter
  // (upcomingAllComps ci-dessus, useUpcomingMatchesAllComps → fetchMatchesForComp
  // → endpoint PAR compétition `/v4/competitions/{id}/matches?status=SCHEDULED`)
  // trouve bien ce même match — les 2 endpoints FD.org semblent résoudre
  // différemment la "saison en cours" pour une date qui vient de basculer sur
  // la saison suivante (même classe de bug déjà rencontrée et documentée pour
  // WC/EC, voir getClubSeason()/season= dans useMatchs.js). Plutôt que de
  // deviner le bon paramètre season à ajouter à l'endpoint multi-compétitions
  // (risqué sans pouvoir le vérifier), on complète simplement `matches` avec
  // les matchs du jour affiché déjà présents dans upcomingAllComps (donnée
  // déjà chargée pour la recherche de saut, aucun coût réseau en plus,
  // garantit par construction que tout jour trouvé par la flèche affiche bien
  // ses cards).
  const matches = useMemo(() => {
    const seen = new Set(rawMatches.map(m => m.id))
    const extra = upcomingAllComps.filter(m => {
      if (seen.has(m.id)) return false
      if (!m.utcDate) return false
      const d = new Date(m.utcDate)
      const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return localStr === targetDate
    })
    let merged = [...rawMatches, ...extra]

    // ⚠️ EXCEPTION minuit (retour utilisateur : "il est 0h00 et le match en
    // live actuellement apparait plus dans accueil") : un match qui a démarré
    // avant minuit et qui est TOUJOURS en cours après minuit a un utcDate qui
    // correspond au jour PRÉCÉDENT — il disparaissait donc entièrement de la
    // card "Aujourd'hui" dès que targetDate basculait sur le nouveau jour,
    // alors qu'il est toujours en train de se jouer. liveMatches
    // (LiveProvider/liveTracker) est indépendant de la date affichée
    // (localStorage, pas un fetch par date) : on l'utilise comme filet de
    // sécurité, uniquement pour dayOffset===0 (seule vue concernée par un
    // passage de minuit en cours de match — un jour futur/passé ne peut pas
    // avoir de match "en live" par définition).
    if (dayOffset === 0 && liveMatches.length > 0) {
      const mergedIds = new Set(merged.map(m => m.id))
      const stillLive = liveMatches.filter(m => !mergedIds.has(m.id))
      if (stillLive.length > 0) merged = [...merged, ...stillLive]
    }

    return applyKnockoutTeamOverrides(merged, knockoutOverrides)
  }, [rawMatches, upcomingAllComps, targetDate, knockoutOverrides, dayOffset, liveMatches])

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
  const { matches: rawTodayMatchesForResults } = useTodayMatches(absoluteToday)
  // Pas besoin d'override ici pour resultsSourceMatches/results (FINISHED
  // uniquement, un match déjà joué a forcément ses vraies équipes) — seul
  // todayMatchesForResults sert aussi à afficher un match PAS ENCORE joué
  // (matchDuJour, favMatch), donc lui en a besoin comme `matches` ci-dessus.
  // Même filet de sécurité upcomingAllComps que `matches`, pour le jour
  // "aujourd'hui absolu" spécifiquement (peut différer de targetDate).
  const todayMatchesForResults = useMemo(() => {
    const seen = new Set(rawTodayMatchesForResults.map(m => m.id))
    const extra = upcomingAllComps.filter(m => {
      if (seen.has(m.id)) return false
      if (!m.utcDate) return false
      const d = new Date(m.utcDate)
      const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return localStr === absoluteToday
    })
    return applyKnockoutTeamOverrides([...rawTodayMatchesForResults, ...extra], knockoutOverrides)
  }, [rawTodayMatchesForResults, upcomingAllComps, absoluteToday, knockoutOverrides])
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
  // liveMatches/espnScores remontés plus haut (voir exception minuit dans `matches`)
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

  // upcomingAllComps : voir déclaration plus haut (remontée pour servir aussi
  // de filet de sécurité à `matches`/`todayMatchesForResults`). Sert ici à
  // savoir où sauter quand le jour affiché est vide (voir effet ci-dessous).
  // Fenêtre distincte de celle de Pronos (7j, volontairement plus courte) :
  // paramètre windowDays dédié dans useUpcomingMatchesAllComps, cache séparé,
  // aucun impact sur Pronos.

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

  // ── Flèche "jour précédent" : même saut direct, mais vers le jour AVEC
  // match le plus proche en revenant vers aujourd'hui (retour utilisateur :
  // "quand je retourne en arrière... ça ne saute pas le jour où y'a pas de
  // match" — ne décrémentait qu'un jour à la fois). On ne considère que les
  // matchs strictement avant le jour affiché : upcomingAllComps ne contient
  // de toute façon que des matchs à venir (>= maintenant), donc tout candidat
  // trouvé est automatiquement >= aujourd'hui — le plancher à 0 reste
  // garanti sans logique supplémentaire. S'il n'y a AUCUN match connu entre
  // aujourd'hui et le jour affiché, on retombe directement sur aujourd'hui
  // (0) plutôt que de décrémenter un par un.
  const prevMatchDayOffset = useMemo(() => {
    if (dayOffset <= 0) return null
    const startOfTargetDay = new Date(`${targetDate}T00:00:00`).getTime()
    const before = upcomingAllComps.filter(m => new Date(m.utcDate).getTime() < startOfTargetDay)
    if (before.length === 0) return 0  // rien entre aujourd'hui et ici → aujourd'hui directement
    const prev = before[before.length - 1]  // trié croissant → le plus proche du jour affiché
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const prev0  = new Date(prev.utcDate); prev0.setHours(0, 0, 0, 0)
    return Math.max(0, Math.round((prev0 - today0) / 86_400_000))
  }, [targetDate, upcomingAllComps, dayOffset])

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

  // ── Compétitions "actives" pour la sidebar desktop (demande utilisateur) ──
  // Contrairement à matchCompetitions ci-dessus (scopé au SEUL jour affiché),
  // dérivée de upcomingAllComps (fenêtre 30j, toutes compétitions suivies,
  // déjà chargée) : une compétition apparaît ici dès qu'elle a AU MOINS UN
  // match à venir, peu importe le jour actuellement parcouru dans le panneau
  // central. upcomingAllComps ne contient que des matchs SCHEDULED à venir
  // (filterUpcomingWindow, voir useMatchs.js) — une compétition tout juste
  // terminée (ex: Coupe du Monde, plus aucun match programmé) en sort donc
  // naturellement, exactement l'exemple donné par l'utilisateur.
  const activeCompetitions = useMemo(() => {
    const seen = new Set()
    const out  = []
    for (const m of upcomingAllComps) {
      const id = m.competition?.id
      if (id && !seen.has(id)) {
        seen.add(id)
        const meta = COMPETITIONS.find(c => c.id === id)
        out.push({ id, shortName: meta?.shortName ?? m.competition?.name ?? id, emblem: meta?.emblem ?? null })
      }
    }
    return out
  }, [upcomingAllComps])

  // Réinitialiser le filtre matchs si la compétition disparaît des données (changement de jour)
  // — sauf si elle reste sélectionnable via la sidebar desktop (activeCompetitions,
  // fenêtre plus large que matchCompetitions) : sinon un choix fait dans la
  // sidebar serait immédiatement effacé dès qu'il ne matche aucun match du
  // jour actuellement affiché dans le panneau central.
  useEffect(() => {
    if (
      compFilterMatch &&
      !matchCompetitions.some(c => c.id === compFilterMatch) &&
      !activeCompetitions.some(c => c.id === compFilterMatch)
    ) {
      setCompFilterMatch(null)
    }
  }, [matchCompetitions, activeCompetitions, compFilterMatch])

  // Matchs + résultats filtrés
  const filteredMatches = compFilterMatch  ? matches.filter(m => m.competition?.id === compFilterMatch)  : matches
  const filteredResults = compFilterResult ? results.filter(r => r.competition?.id === compFilterResult) : results

  // ── Live desktop : mêmes critères que Live.jsx (page /live) — IN_PLAY,
  // PAUSED, SCHEDULED (coup d'envoi imminent/détecté) ou encore dans la
  // fenêtre de grâce post-FT (isRecentlyFinished) — pour rester cohérent
  // avec ce qui compte comme "en direct" partout ailleurs dans l'app.
  const desktopLiveMatches = liveMatches.filter(m =>
    m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'SCHEDULED' || isRecentlyFinished(m.id)
  )
  const desktopHasLive = isDesktop && desktopLiveMatches.length > 0

  // ── Mini classement (design 4★, sous "Résultats récents") — visible
  // uniquement quand une compétition précise est sélectionnée dans le filtre
  // du panneau résultats (compFilterResult), pas sur "Tous" (demande
  // utilisateur : "pour le classement en dessous du result panel met le
  // uniquement quand on selectionne un championnat... quand on met tous
  // n'affiche pas de classement"). NL/CAN/COPA exclues (pas de classement
  // FD.org, voir NO_STANDINGS_COMPS/Classement.jsx). Hook appelé
  // inconditionnellement (règle des Hooks) : useStandings est déjà no-op
  // (enabled: !!selectedComp) quand compFilterResult est null.
  const showResultClassement = isDesktop && !!compFilterResult && !NO_STANDINGS_COMPS.has(compFilterResult)
  const { standings: resultStandings, loading: resultStandingsLoading } = useStandings(showResultClassement ? compFilterResult : null)
  const resultClassementComp = COMPETITIONS.find(c => c.id === compFilterResult)

  // ── Liste "à venir" du panneau central ──
  // Desktop + matchs en direct : ces matchs sont déjà affichés dans la
  // grille de widgets live dédiée (à droite/au-dessus) — on les exclut d'ici
  // pour ne pas les montrer deux fois (demande utilisateur : la grille live
  // remplace l'affichage "en place" existant, uniquement sur desktop).
  // Mobile (desktopHasLive toujours faux ici, gardé par isDesktop) :
  // comportement 100% inchangé, un match qui démarre reste visible à sa
  // place dans cette même liste (isCardLive dans MatchCard.jsx).
  const matchPanelMatches = useMemo(() => {
    const base = dayOffset === 0
      ? filteredMatches.filter(m => {
          if (m.status === 'FINISHED') return false
          if (getMatchState(m.id).ft) return isRecentlyFinished(m.id)
          return true
        })
      : filteredMatches
    return desktopHasLive ? base.filter(m => !isCardLive(m)) : base
  }, [dayOffset, filteredMatches, desktopHasLive])

  // Résultats récents partagés (utilisés dans le panneau résultats)
  const resultPanel = (() => {
    // IIFE appelée directement dans le corps du render (pas mémoïsée) : cette
    // valeur est donc fraîche à chaque render, contrairement au cas Pronos.jsx
    // (mémoïsé avec des deps étroites) — aucun risque de péremption ici.
    // eslint-disable-next-line react-hooks/purity
    const now4h = Date.now() - 4 * 60 * 60_000
    // resultsSourceMatches (aujourd'hui absolu + hier) — PAS `matches`, qui dépend
    // de dayOffset : sinon ce panneau se vide/réapparaît selon le jour affiché
    // dans "Matchs" (bug signalé : le match disparaît quand on va sur "Demain").
    // Ids déjà couverts par filteredResults (FD.org, EN TENANT COMPTE du filtre
    // compétition compFilterResult) — voir le bug ci-dessous.
    const filteredResultIds = new Set(filteredResults.map(r => r.id))
    const todayFt = resultsSourceMatches.filter(m => {
      // ⚠️ Bug réel signalé : score figé (3-5 au lieu de 4-6, buts marqués après
      // le FT ESPN mal détecté) alors que la page Résultat (Resultat.jsx) affichait
      // le bon score. Root cause : une fois FD.org a lui-même confirmé le match
      // FINISHED (score officiel, forcément à jour), ce panneau continuait quand
      // même à écraser le score avec le snapshot localStorage foot_espn_ figé au
      // moment précis de la confirmation FT locale (lsHome/lsAway ci-dessous,
      // jamais rafraîchi ensuite) — cet override prioritaire (`lsHome ?? m.score...`)
      // ignorait purement et simplement toute mise à jour FD.org ultérieure, même
      // plus fraîche/exacte. Resultat.jsx n'a pas ce bug car il exclut de son
      // override tout match déjà connu de fdMatches (voir `known` là-bas) — même
      // logique reproduite ici.
      //
      // ⚠️ RÉGRESSION CORRIGÉE (retour utilisateur : "un match terminé n'a jamais
      // disparu au bout de 4h avant, je comprends pas") : la 1ère version de ce
      // fix excluait tout match FINISHED en supposant qu'il retomberait forcément
      // sur filteredResults plus bas — FAUX quand un filtre compétition
      // (compFilterResult) est actif sur le panneau résultats : todayFtMapped
      // n'était PAS filtré par compétition (donc affichait le match quel que soit
      // le filtre), alors que filteredResults, LUI, applique ce filtre. Un match
      // exclu ici sur la seule base de son statut FINISHED, sans être dans la
      // compétition actuellement filtrée, disparaissait purement et simplement au
      // lieu de retomber sur filteredResults comme supposé. Fix : ne l'exclure
      // que si on a VÉRIFIÉ qu'il est bien dans filteredResults (donc qu'il va
      // vraiment s'afficher par cet autre chemin) — sinon on garde l'ancien
      // comportement (affichage via l'override ci-dessous, score potentiellement
      // pas 100% frais mais au moins visible, comme avant).
      if (m.status === 'FINISHED' && filteredResultIds.has(m.id)) return false
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

        {/* ── Match du jour — devant tout le reste, y compris le live ──
            espnScore transmis (design 4★ : la grosse card doit elle aussi
            passer en mode live — statut/minute/score — au lieu de rester
            figée sur l'heure du coup d'envoi). */}
        {matchDuJour && (
          <MatchDuJourCard
            match={matchDuJour}
            espnScore={espnScores[matchDuJour.id]}
            onClick={() => navigate(`/match/${matchDuJour.id}`, { state: { match: matchDuJour } })}
          />
        )}

        {/* ── Grille matchs / résultats ──
            Mobile ET tablette/petite fenêtre (<1025px, voir isDesktop) :
            inchangé — 1 colonne, panneau matchs puis résultats, barre de
            filtres et grille live ci-dessous simplement masquées en CSS
            (display:none, voir accueil.css @media max-width:1024px).
            Desktop ≥1025px (design 4★, validé par l'utilisateur après
            plusieurs itérations de maquette) :
              - pas de live      → [matchs à venir | résultats récents + classement]
              - 1+ match en live → [grille "En direct" pleine largeur] [matchs à venir | bandeau "résultats masqués"]
            Positionnement réel via CSS grid-area (accueil__mainGrid /
            accueil__mainGrid--live). accueil__mainGrid--noFilters toujours
            appliqué : plus de barre de filtres horizontale (retirée, demande
            utilisateur 23/07 — bug d'affichage sur mobile + jugée inutile),
            la grille ne réserve donc plus jamais de ligne "filtres". */}
        <div className={`accueil__mainGrid accueil__mainGrid--noFilters${desktopHasLive ? ' accueil__mainGrid--live' : ''}`}>

          {/* Grille "En direct" — desktop uniquement, uniquement s'il y a au
              moins un match en direct (demande utilisateur : "reprendre la
              logique des widget dans la page des widget live"). Réutilise
              EXACTEMENT LiveCard (Live.jsx), aucune réimplémentation. */}
          {desktopHasLive && (
            <div className="accueil__dashPanel accueil__liveWidgets">
              <div className="accueil__dashPanelHeader">
                <span className="accueil__liveWidgetsDot" aria-hidden="true" />
                <h2 className="accueil__dashPanelTitle">En direct</h2>
                <span className="accueil__liveWidgetsCount">{desktopLiveMatches.length}</span>
              </div>
              <div className="accueil__dashPanelDivider" />
              <div className="accueil__dashPanelBody accueil__liveWidgetsBody">
                <div className="accueil__liveWidgetsGrid">
                  {desktopLiveMatches.map(m => (
                    <LiveCard
                      key={m.id}
                      match={m}
                      espn={espnScores[m.id]}
                      onClick={() => navigate(`/live/${m.id}`)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Matchs à venir — une card qui démarre reste à sa place et passe
              en mode live (score/minute/statut) au lieu de disparaître, SAUF
              sur desktop quand la grille "En direct" ci-dessus est affichée
              (le match y est déjà représenté, voir matchPanelMatches plus
              haut — évite le doublon). Un match reste visible ici quelques
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
                onClick={() => { if (prevMatchDayOffset != null) setDayOffset(prevMatchDayOffset) }}
                disabled={prevMatchDayOffset == null}
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
            {/* ⚠️ RETIRÉ (demande utilisateur, 23/07 : "enlève la barre où
                y'a tous/[compétition]... au-dessus dans accueil sur mobile
                et desktop aussi") : ancienne barre de filtre inline
                (matchCompetitions, scopée au jour affiché) — redondante
                avec la barre topFilters ci-dessus (déjà seule visible sur
                desktop, activeCompetitions) et non désirée sur mobile non
                plus. compFilterMatch reste utilisé par topFilters (desktop)
                et par filteredMatches/filteredResults plus haut — retrait
                purement visuel de ce point d'entrée mobile, pas de la
                logique de filtrage elle-même. */}
            <div className="accueil__dashPanelDivider" />
            <MatchPanel
              matches={matchPanelMatches}
              loading={matchesLoading}
              espnScores={espnScores}
              onMatchClick={m => navigate(`/match/${m.id}`, { state: { match: m } })}
              onLiveClick={m => navigate(`/live/${m.id}`)}
              formMap={formMap}
            />
          </div>

          {/* Résultats récents — masqué sur desktop tant qu'il y a du live
              (demande utilisateur : "quand y'a un match en live... on
              affiche le result panel que quand y'a aucun match en live").
              Mobile : desktopHasLive toujours faux ici (gardé par isDesktop)
              → toujours affiché, comportement 100% inchangé. */}
          {!desktopHasLive && (
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

              {/* Mini classement — desktop uniquement, visible seulement
                  quand une compétition précise est sélectionnée dans le
                  filtre ci-dessus (demande utilisateur : "pour le classement
                  en dessous du result panel met le uniquement quand on
                  selectionne un championnat... quand on met tous n'affiche
                  pas de classement"). */}
              {isDesktop && !compFilterResult && (
                <p className="accueil__resultClassementHint">Choisis un championnat ci-dessus pour voir le classement.</p>
              )}
              {showResultClassement && (
                <div className="accueil__resultClassement">
                  <div className="accueil__dashPanelDivider" />
                  {resultStandingsLoading
                    ? <PanelSkeleton />
                    : <StandingsTable rows={resultStandings} compact isCountry={resultClassementComp ? isNationalTeamComp({ competition: resultClassementComp }) : false} />}
                </div>
              )}
            </div>
          )}

          {/* Bandeau "résultats masqués" — desktop + live uniquement,
              remplace le panneau Résultats récents ci-dessus (design 4★). */}
          {desktopHasLive && (
            <div className="accueil__liveCaption">
              Résultats masqués pendant les matchs en direct.
            </div>
          )}

        </div>

        {/* ── Actualités — 3/ligne sur desktop (demande utilisateur), 1/page
            inchangé sur mobile ── */}
        <NewsCarousel news={news} loading={newsLoading} error={newsError} perPage={isDesktop ? 3 : 1} />

      </div>
    </section>
  )
}

export default Accueil
