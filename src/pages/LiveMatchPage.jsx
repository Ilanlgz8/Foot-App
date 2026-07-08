/**
 * LiveMatchPage — page dédiée à un match en direct
 * Route : /live/:matchId
 *
 * Style : même visuel que MatchPage (hero gradient plein-écran + onglets)
 * Contenu live préservé : minute, score temps réel, buteurs, xG, stats live
 */
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useLiveData }      from '../context/LiveProvider'
import { getMatchState }    from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, matchOutcome } from '../utils/matchUtils'
import { COMPETITIONS }     from '../data/competitions'
import { translateTeam }    from '../data/teamNames'
import { getMatchGradient, getMatchThemeVars } from '../data/teamPhotos'
import { calcLiveProno } from '../utils/calcProno'
import { useTeamForm }      from '../hooks/useTeamForm'
import { useSwipe }         from '../hooks/useSwipe'
import { FormDiamonds }     from '../accueil/FormDiamonds'
import {
  LiveStatsTab,
  SeasonStatsTab,
  StatsSubTabs,
  ComposTab,
  ClassementTab,
  TabDots,
} from '../components/MatchModal'
import './LiveMatchPage.css'
import './MatchPage.css'
import '../live.css'
import '../matchModal.css'

// ── Raccourcis noms ───────────────────────────────────────────────────────────
const TEAM_SHORT = {
  'Union Saint-Gilloise': 'Union SG', 'Paris Saint-Germain': 'Paris SG',
  'Paris Saint-Germain FC': 'Paris SG', 'Crystal Palace': 'C. Palace',
  'Wolverhampton': 'Wolves', 'Wolverhampton Wanderers': 'Wolves',
  'Nottingham Forest': 'Nott. Forest', 'Brighton & Hove Albion': 'Brighton',
  'Brighton Hove Albion': 'Brighton', 'Newcastle United': 'Newcastle',
  'Tottenham Hotspur': 'Tottenham', 'West Ham United': 'West Ham',
  'Manchester City': 'Man. City', 'Manchester United': 'Man. United',
  'Leeds United': 'Leeds', 'Atlético Madrid': 'Atl. Madrid',
  'Athletic Bilbao': 'Ath. Bilbao', 'Real Sociedad': 'R. Sociedad',
  'Deportivo Alavés': 'Alavés', 'Rayo Vallecano': 'Rayo',
  'Bayern Munich': 'Bayern', 'Eintracht Frankfurt': 'Frankfurt',
  'Werder Brême': 'Werder', 'Werder Bremen': 'Werder',
  'Borussia Dortmund': 'Dortmund', 'Inter Milan': 'Inter',
  'Milan AC': 'Milan', 'Hellas Verona': 'Verona',
  'PSV Eindhoven': 'PSV', 'Club Brugge': 'Bruges', 'Slavia Prague': 'Slavia',
}
// 5 pastilles par équipe pendant la séance de tab : gris = pas encore marqué,
// vert = but marqué. Basé sur le compteur ESPN `shootoutScore` (fiable, déjà
// utilisé pour le score "(x-y tab)") : les N premières pastilles passent au
// vert où N = nombre de buts marqués. Simplification assumée : un tir raté
// n'est pas distingué d'un tir pas encore tenté (les deux ne comptent pas dans
// le compteur) — distinguer précisément un raté demanderait de parser le détail
// tir-par-tir d'ESPN, jamais vérifié sur un vrai match en tab, donc pas fait.
function ShootoutDots({ scored }) {
  const n = scored ?? 0
  return (
    <div className="lmp__soDots">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`lmp__soDot${i < n ? ' lmp__soDot--scored' : ''}`} />
      ))}
    </div>
  )
}

function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 13) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0].toUpperCase()}. ${words.slice(1).join(' ')}`
}

// Skeleton pleine page — remplace le spinner générique affiché avant que le
// match soit reçu du LiveProvider. Même logique que MpPageSkeleton dans
// MatchPage.jsx (dupliqué ici, pas de composant partagé, cf. le pattern déjà
// utilisé pour les helpers stats "mêmes que MatchModal, dupliqués").
function LmpPageSkeleton() {
  return (
    <div className="mp__page">
      <div className="mp__hero lmp__hero">
        <div className="mp__hero__top">
          <div className="sk" style={{ width: '3.2rem', height: '0.85rem' }} />
          <div className="sk" style={{ width: '5rem', height: '0.7rem' }} />
        </div>
        <div className="mp__hero__mid">
          <div className="mp__hero__team">
            <div className="sk" style={{ width: '3.4rem', height: '3.4rem', borderRadius: '50%' }} />
            <div className="sk" style={{ width: '3.4rem', height: '0.75rem' }} />
          </div>
          <div className="mp__hero__center">
            <div className="sk" style={{ width: '3rem', height: '0.6rem' }} />
            <div className="sk" style={{ width: '4.5rem', height: '1.8rem', marginTop: '0.3rem' }} />
          </div>
          <div className="mp__hero__team mp__hero__team--away">
            <div className="sk" style={{ width: '3.4rem', height: '3.4rem', borderRadius: '50%' }} />
            <div className="sk" style={{ width: '3.4rem', height: '0.75rem' }} />
          </div>
        </div>
      </div>
      <div className="mp__wrap">
        <div className="mp__tabs">
          {[0, 1, 2].map(i => (
            <div key={i} style={{ flex: 1, padding: '0.75rem 0', display: 'flex', justifyContent: 'center' }}>
              <div className="sk" style={{ width: '4rem', height: '0.8rem' }} />
            </div>
          ))}
        </div>
        <div className="mp__tabContent">
          <div className="mp__statsList">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="mp__statRow">
                <div className="sk" style={{ width: '1.6rem', height: '0.9rem', marginLeft: 'auto' }} />
                <div className="sk" style={{ width: '4.4rem', height: '0.6rem' }} />
                <div className="sk" style={{ width: '1.6rem', height: '0.9rem' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Hero live (style MatchPage + éléments live) ───────────────────────────────
function MatchHeader({ match, espn, onBack, hForm, aForm }) {
  const matchSt   = getMatchState(match.id)
  const isTermine = matchSt.ft === true

  // Ticker 5s pour interpolation de minute en temps réel
  const [, setTick] = useState(0)
  useEffect(() => {
    if (isTermine) return
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [isTermine])

  const minute  = isTermine ? null : calcMinute(match)
  const period  = getMatchPeriod(match)
  const comp    = COMPETITIONS.find(c => c.id === match.competition?.code)
  const emblem  = comp?.emblem ?? match.competition?.emblem
  const compName = match.competition?.name ?? comp?.name ?? ''

  const isHalftime = match.status === 'PAUSED' || matchSt.espnStatus === 'STATUS_HALFTIME'
  const pauseElapsed = (isHalftime && matchSt.pausedAt && !matchSt.half2Start)
    ? Date.now() - matchSt.pausedAt : null
  const repriseImminente = pauseElapsed != null && pauseElapsed >= 15 * 60_000
  const repriseDans = pauseElapsed != null && pauseElapsed < 15 * 60_000
    ? Math.max(1, Math.ceil((15 * 60_000 - pauseElapsed) / 60_000)) : null

  const fsLive = finalScore(match.score)
  const hs  = mergeScore(espn?.home, fsLive.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, fsLive.away ?? match.score?.halfTime?.away)

  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))

  const h = hs ?? '–', a = as_ ?? '–'

  // Label minute (badge rouge au-dessus du score)
  // ⚠️ getMatchPeriod() renvoie 'Mi-temps'/'Prolongations'/'T.A.B.'/'2ème MT'/
  // '1ère MT'/null (pas 'HT'/'ET1'/'ET2'/'PEN'/'FT') — ces comparaisons ne
  // matchaient donc jamais, et calcMinute() inclut déjà l'apostrophe pour les
  // minutes chiffrées ("91'") + des libellés complets pour MT/Pause/TAB/Débute,
  // donc ${minute}' ajoutait une 2e apostrophe en trop dans tous les cas.
  const minuteLabel = isTermine ? 'Terminé' : (minute ?? '–')

  // Badge période (MI-TEMPS, PROLONGATIONS, T.A.B., 1ère/2ème MT…)
  // ⚠️ Avant, '1ère MT'/'2ème MT' (retournés par getMatchPeriod pendant le
  // temps réglementaire) ne matchaient aucune branche → pas de badge du tout
  // pendant la 1ère/2ème mi-temps, seulement pour Mi-temps/Prolongations/T.A.B.
  // (demande explicite : ajouter le même style de badge pour ces 2 cas).
  const periodBadge = period === 'Mi-temps'      ? 'MI-TEMPS'
    : period === 'Prolongations' ? 'PROLONGATIONS'
    : period === 'T.A.B.'        ? 'T.A.B.'
    : period === '1ère MT'       ? '1ÈRE MI-TEMPS'
    : period === '2ème MT'       ? '2ÈME MI-TEMPS'
    : null

  // Score des tab en direct (mêmes champs que MatchModal.jsx)
  const homeShootout = espn?.homeShootout ?? null
  const awayShootout = espn?.awayShootout ?? null
  const showLivePens = period === 'T.A.B.' && (homeShootout != null || awayShootout != null)

  // Score localStorage (partagé avec Live.jsx)
  const scoreKey = `foot_lv_score_${match.id}`
  const prevHs   = useRef(null)
  const prevAs   = useRef(null)
  const initDone = useRef(false)
  if (!initDone.current) {
    initDone.current = true
    try {
      const s = JSON.parse(localStorage.getItem(scoreKey) || 'null')
      if (s?.home != null) prevHs.current = s.home
      if (s?.away != null) prevAs.current = s.away
    } catch {}
  }
  useEffect(() => {
    if (hs  != null) prevHs.current = hs
    if (as_ != null) prevAs.current = as_
    if (hs != null && as_ != null) {
      try { localStorage.setItem(scoreKey, JSON.stringify({ home: hs, away: as_ })) } catch {}
    }
  }, [hs, as_])

  const gradient = getMatchGradient(
    match.homeTeam?.name || match.homeTeam?.shortName || '',
    match.awayTeam?.name || match.awayTeam?.shortName || ''
  )

  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = match.competition?.id === 2000 || match.competition?.code === 'WC'

  return (
    <div className="mp__hero lmp__hero" style={{ background: gradient }}>
      <div className="mp__hero__overlay" />

      {/* Top bar : retour + badge compétition */}
      <div className="mp__hero__top">
        <button className="mp__hero__back" onClick={onBack}>‹ En Direct</button>
        <div className="mp__hero__comp">
          {emblem && <img src={emblem} alt="" className="mp__hero__compLogo" />}
          <span className="mp__hero__compName">{compName}</span>
        </div>
      </div>

      {/* Badge minute live + reprise (reprise SOUS "MT", pas au-dessus) */}
      <div className="lmp__heroBadgeCol">
        <span className={`lmp__heroMinute${isTermine ? ' lmp__heroMinute--ft' : ''}`}>
          {/* Dot fantôme symétrique à droite : sans lui, le point live à
              gauche décale visuellement le texte de la minute par rapport
              au score en dessous (qui, lui, n'a pas cet élément asymétrique). */}
          {!isTermine && <span className="lmp__heroLiveDot" />}
          <span className="lmp__heroMinuteText">{minuteLabel}</span>
          {!isTermine && <span className="lmp__heroLiveDot lmp__heroLiveDot--ghost" aria-hidden="true" />}
        </span>
        {(repriseImminente || repriseDans != null) && (
          <span className="lmp__heroReprise">
            {repriseImminente ? 'Reprise imminente' : `Reprise dans ${repriseDans} min`}
          </span>
        )}
      </div>

      {/* Centre : crests + score */}
      <div className="mp__hero__mid">
        <div className="mp__hero__team">
          {showLivePens && <ShootoutDots scored={homeShootout} />}
          {match.homeTeam?.crest
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="mp__hero__crest" data-team={match.homeTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{homeName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{homeName}</span>
          <FormDiamonds form={hForm} />
        </div>

        <div className="mp__hero__center">
          <span className="mp__hero__score">{h} – {a}</span>
          {periodBadge && <span className="lmp__heroPeriodBadge">{periodBadge}</span>}
          {/* Score des tab en direct — ESPN expose un champ shootoutScore dédié
              par compétiteur (voir api/fifa-live.js), déjà tracké côté client
              dans espnScoresCache (useLiveMinute.js) mais pas encore affiché ici. */}
          {showLivePens && (
            <span className="lmp__heroPens">({homeShootout ?? 0}-{awayShootout ?? 0} tab)</span>
          )}
        </div>

        <div className="mp__hero__team mp__hero__team--away">
          {showLivePens && <ShootoutDots scored={awayShootout} />}
          {match.awayTeam?.crest
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="mp__hero__crest" data-team={match.awayTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{awayName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{awayName}</span>
          <FormDiamonds form={aForm} />
        </div>
      </div>

      {/* Buteurs */}
      {espn?.scorers?.length > 0 && (
        <div className="lmp__heroScorers">
          <div className="lmp__heroScorersHome">
            {espn.scorers.filter(s => s.team === 'home').map((s, i) => (
              <span key={i} className="lmp__heroScorerItem">
                {s.name}{s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''}
                {s.minute && <span className="lmp__heroScorerMin"> {s.minute}</span>}
              </span>
            ))}
          </div>
          <div className="lmp__heroScorersDiv" />
          <div className="lmp__heroScorersAway">
            {espn.scorers.filter(s => s.team === 'away').map((s, i) => (
              <span key={i} className="lmp__heroScorerItem">
                {s.name}{s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''}
                {s.minute && <span className="lmp__heroScorerMin"> {s.minute}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
const TABS = ['stats', 'compos', 'classement']

export default function LiveMatchPage() {
  const { matchId }            = useParams()
  const navigate               = useNavigate()
  const { liveMatches, espnScores } = useLiveData()

  const match   = liveMatches.find(m => String(m.id) === String(matchId))
  const espn    = match ? (espnScores[match.id] ?? null) : null
  const compId  = match?.competition?.code ?? null

  const { formMap, compMatches } = useTeamForm(compId)
  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]
  // Cette page n'existe que pour des matchs en direct (liveMatches) → toujours
  // la version live du prono, réévaluée selon le score réel + le temps restant.
  const liveMinute = match ? calcMinute(match) : null
  const fsProno = match ? finalScore(match.score) : { home: null, away: null }
  const prono = match && (hForm || aForm)
    ? calcLiveProno(
        hForm, aForm,
        mergeScore(espn?.home, fsProno.home ?? match.score?.halfTime?.home),
        mergeScore(espn?.away, fsProno.away ?? match.score?.halfTime?.away),
        liveMinute
      )
    : null

  // Échantillonnage pour la courbe de bascule post-match (voir <ProbaCurve>).
  const homeShort = translateTeam(match?.homeTeam?.shortName || match?.homeTeam?.name || '?')
  const awayShort = translateTeam(match?.awayTeam?.shortName || match?.awayTeam?.name || '?')
  // Thème dynamique — mêmes couleurs anti-collision que le hero (getMatchGradient).
  const themeVars = getMatchThemeVars(match?.homeTeam?.name || homeShort, match?.awayTeam?.name || awayShort)

  const [activeTab, setActiveTab] = useState('stats')
  const [tabDir, setTabDir]       = useState(null)
  // Sous-onglet dans "Stats Live" : Stats live (par défaut) / Stats saison
  const [statsView, setStatsView] = useState('live')

  const goTab = (t, dir) => { setTabDir(dir); setActiveTab(t) }

  const swipe = useSwipe(
    () => { const i = TABS.indexOf(activeTab); if (i < TABS.length - 1) goTab(TABS[i + 1], 'left') },
    () => { const i = TABS.indexOf(activeTab); if (i > 0) goTab(TABS[i - 1], 'right') }
  )

  if (!match) {
    return <LmpPageSkeleton />
  }

  return (
    <div className="mp__page" style={themeVars}>

      {/* Hero gradient avec score live */}
      <MatchHeader match={match} espn={espn} hForm={hForm} aForm={aForm} onBack={() => {
        if (window.history.length > 1) navigate(-1)
        else navigate('/live')
      }} />

      <div className="mp__wrap">
        <div className="mp__body" ref={swipe.ref}>

          {/* Onglets */}
          <div className="mp__tabs">
            {TABS.map(t => (
              <button
                key={t}
                className={`mp__tab${activeTab === t ? ' mp__tab--active' : ''}`}
                onClick={() => goTab(t, null)}
              >
                {t === 'stats'       ? 'Statistiques'
               : t === 'compos'     ? 'Compos'
               :                      'Classement'}
              </button>
            ))}
          </div>
          <TabDots count={TABS.length} active={TABS.indexOf(activeTab)} />

          {/* Contenu */}
          <div
            key={activeTab}
            className={`mp__tabContent${
              !swipe.isDragging && tabDir === 'left'  ? ' mp__tabContent--fromRight' :
              !swipe.isDragging && tabDir === 'right' ? ' mp__tabContent--fromLeft'  : ''
            }`}
            style={{
              transform:  swipe.isDragging ? `translateX(${swipe.dragOffset}px)` : undefined,
              transition: swipe.isDragging ? 'none' : undefined,
            }}
          >
            {activeTab === 'stats' && (
              <>
                <StatsSubTabs view={statsView} onChange={setStatsView} />
                {/* Pouls collectif — sous Stats Live/Stats Saison, au-dessus
                    du contenu des stats */}
                {statsView === 'live' ? (
                  <LiveStatsTab
                    match={match}
                    espnScore={espn}
                    homeShort={match.homeTeam?.shortName || match.homeTeam?.name}
                    awayShort={match.awayTeam?.shortName || match.awayTeam?.name}
                    compMatches={compMatches}
                  />
                ) : (
                  <SeasonStatsTab match={match} compMatches={compMatches} />
                )}
              </>
            )}
            {activeTab === 'compos'     && <ComposTab match={match} compMatches={compMatches} />}
            {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
          </div>
        </div>
      </div>
    </div>
  )
}
