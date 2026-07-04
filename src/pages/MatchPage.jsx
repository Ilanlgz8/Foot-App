/**
 * MatchPage — page dédiée à un match à venir / terminé
 * Route : /match/:matchId
 */
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useState }                from 'react'
import { useQuery }                from '@tanstack/react-query'
import { translateTeam }           from '../data/teamNames'
import { COMPETITIONS }            from '../data/competitions'
import { calcProno }               from '../utils/calcProno'
import { useTeamForm }             from '../hooks/useTeamForm'
import { useSwipe }                from '../hooks/useSwipe'
import { getMatchGradient }        from '../data/teamPhotos'
import { FormDiamonds }            from '../accueil/FormDiamonds'
import {
  useEspnMatchStats,
  useFifaStats,
  useMatchDetail,
  useMatchRecap,
} from '../hooks/useMatchDetail'
import { useEspnMatchDetail } from '../hooks/useEspnMatchDetail'
import { useAflMatchStats } from '../hooks/useApiFootball'
import {
  PreMatchSection,
  PmPronoSection,
  ComposTab,
  ClassementTab,
  MatchTimeline,
  StatsSubTabs,
  getEspnData,
  TabDots,
  TeamFormTable,
  buildMatchEvents,
} from '../components/MatchModal'
import './MatchPage.css'
import '../matchModal.css'
import '../live.css'
// Réutilisé pour les classes .lmp__heroScorers* (buteurs sous les noms
// d'équipe dans le hero) — même style qu'en direct, demande explicite de
// l'utilisateur ("exactement pareil"). Import de la CSS de la page live
// plutôt que dupliquer les règles, pour garantir un rendu identique sans
// risque de dérive entre les deux (même pattern déjà utilisé ailleurs dans
// l'app, ex: Resultat.jsx qui importe match.css).
import './LiveMatchPage.css'

// ── Fetch fallback si accès direct par URL ────────────────────────────────────
function useMatchData(matchId, initialMatch) {
  return useQuery({
    queryKey:  ['match', matchId],
    queryFn:   async () => {
      const res = await fetch(`/api/football?apiPath=/v4/matches/${matchId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled:   !initialMatch && !!matchId,
    staleTime: 5 * 60_000,
  })
}

// ── Formatage date / heure ────────────────────────────────────────────────────
function isSameDay(a, b) {
  return a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
}
function formatDate(utcDate) {
  if (!utcDate) return '–'
  const d = new Date(utcDate)
  const today    = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (isSameDay(d, today))    return "Aujourd'hui"
  if (isSameDay(d, tomorrow)) return 'Demain'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}
function formatTime(utcDate) {
  if (!utcDate) return '–'
  return new Date(utcDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Hero gradient plein-écran ─────────────────────────────────────────────────
function MatchPageHero({ match, navigate, hForm, aForm }) {
  const comp       = COMPETITIONS.find(c => c.id === match.competition?.code)
  const homeName   = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName   = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const isFinished = match.status === 'FINISHED'
  const hs         = match.score?.fullTime?.home ?? match.score?.halfTime?.home
  const as_        = match.score?.fullTime?.away ?? match.score?.halfTime?.away
  // Tirs au but / prolongation — même logique que Resultat.jsx et
  // accueil/MatchCard.jsx (mutuellement exclusifs : un match aux tab a
  // duration='PENALTY_SHOOTOUT', pas 'EXTRA_TIME'). Manquait ici : cette page
  // affichait juste "Terminé" sans jamais préciser tab/prolongation.
  const wentToPens = match.score?.duration === 'PENALTY_SHOOTOUT'
  const wentToAet  = match.score?.duration === 'EXTRA_TIME'
  const hPens      = match.score?.penalties?.home ?? null
  const aPens      = match.score?.penalties?.away ?? null
  const emblem     = comp?.emblem ?? match.competition?.emblem
  const compName   = match.competition?.name ?? comp?.name ?? ''
  const gradient   = getMatchGradient(
    match.homeTeam?.name || homeName,
    match.awayTeam?.name || awayName
  )

  // Buteurs + cartons — même source/logique que MpMatchStats (cache
  // localStorage persistant si le match a été suivi en live, sinon fetch ESPN
  // à la demande). queryKey partagée avec MpMatchStats → pas de double fetch,
  // React Query dédup les deux appels automatiquement.
  const cachedEspn = isFinished ? getEspnData(match?.id) : null
  const { espnData: fetchedEspn } = useEspnMatchDetail(
    isFinished && !cachedEspn ? match : null,
    match?.competition?.id,
    isFinished && !cachedEspn
  )
  const espnScorers = (cachedEspn ?? fetchedEspn)?.scorers ?? []
  const espnCards   = (cachedEspn ?? fetchedEspn)?.cards   ?? []
  // Buts + cartons fusionnés et triés par minute (même logique que le Fil du
  // match dans l'onglet Statistiques, sans les remplacements — le hero reste
  // compact). Uniquement ici (page Résultat) : demande explicite de
  // l'utilisateur, LiveMatchPage garde son affichage buts-seuls actuel.
  const { home: homeEvents, away: awayEvents } = buildMatchEvents({
    espnScorers, espnCards, homeId: match.homeTeam?.id,
  })

  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = match.competition?.id === 2000 || match.competition?.code === 'WC'

  return (
    <div className="mp__hero" style={{ background: gradient }}>
      <div className="mp__hero__overlay" />

      {/* Top bar : retour + badge compét */}
      <div className="mp__hero__top">
        <button className="mp__hero__back" onClick={() => navigate(-1)}>‹ Retour</button>
        <div className="mp__hero__comp">
          {emblem && <img src={emblem} alt="" className="mp__hero__compLogo" />}
          <span className="mp__hero__compName">{compName}</span>
        </div>
      </div>

      {/* Centre : crests + score/heure */}
      <div className="mp__hero__mid">
        <div className="mp__hero__team">
          {match.homeTeam?.crest
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="mp__hero__crest" data-team={match.homeTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{homeName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{homeName}</span>
          <FormDiamonds form={hForm} />
        </div>

        <div className="mp__hero__center">
          {isFinished ? (
            <>
              <span className="mp__hero__label">Terminé</span>
              <span className="mp__hero__score">{hs} – {as_}</span>
              {wentToPens && hPens != null && aPens != null && (
                <div className="mp__hero__pensBlock">
                  <span className="mp__hero__pensLabel">T.A.B</span>
                  <span className="mp__hero__pensScore">({hPens}-{aPens})</span>
                </div>
              )}
              {wentToAet && (
                <span className="mp__hero__aet">Après prolong.</span>
              )}
            </>
          ) : (
            <>
              <span className="mp__hero__label">{formatDate(match.utcDate)}</span>
              <span className="mp__hero__time">{formatTime(match.utcDate)}</span>
            </>
          )}
        </div>

        <div className="mp__hero__team mp__hero__team--away">
          {match.awayTeam?.crest
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="mp__hero__crest" data-team={match.awayTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{awayName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{awayName}</span>
          <FormDiamonds form={aForm} />
        </div>
      </div>

      {/* Buts + cartons — sous les noms d'équipe, triés par minute. Avant : ne
          montrait que les buts ici, et l'onglet Statistiques répétait les
          mêmes buts en y ajoutant les cartons dans le Fil du match → les buts
          apparaissaient deux fois sur la page (signalé par l'utilisateur).
          Le hero montre maintenant la même liste fusionnée (buts+cartons),
          au bon endroit selon la minute. */}
      {(homeEvents.length > 0 || awayEvents.length > 0) && (
        <div className="lmp__heroScorers">
          <div className="lmp__heroScorersHome">
            {homeEvents.map(e => (
              <span key={e.key} className="lmp__heroScorerItem">
                <span className="lmp__heroScorerIcon" aria-hidden="true">{e.icon}</span>
                {e.name}
                {e.minute && <span className="lmp__heroScorerMin"> {e.minute}</span>}
              </span>
            ))}
          </div>
          <div className="lmp__heroScorersDiv" />
          <div className="lmp__heroScorersAway">
            {awayEvents.map(e => (
              <span key={e.key} className="lmp__heroScorerItem">
                <span className="lmp__heroScorerIcon" aria-hidden="true">{e.icon}</span>
                {e.name}
                {e.minute && <span className="lmp__heroScorerMin"> {e.minute}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Table minimaliste stats (variante D) ──────────────────────────────────────
// Une ligne par stat : valeur dom. | libellé | valeur ext., la valeur la plus
// haute (au sens "higher"/"lower is better" déjà calculé par l'appelant via
// homeBetter/awayBetter) mise en avant. Remplace l'ancienne barre symétrique.
function MpStatRow({ label, homeVal, awayVal, homeBetter, awayBetter }) {
  return (
    <div className="mp__statRow">
      <span className={`mp__statVal${homeBetter ? ' mp__statVal--home' : ''}`}>
        {homeVal ?? '–'}
      </span>
      <span className="mp__statLabel">{label}</span>
      <span className={`mp__statVal mp__statVal--r${awayBetter ? ' mp__statVal--away' : ''}`}>
        {awayVal ?? '–'}
      </span>
    </div>
  )
}

// ── Helpers stats match terminé (mêmes que MatchModal, dupliqués) ─────────────
const MATCH_STAT_KEYS = [
  { key: 'Ball possession',  label: 'Possession',     higher: true  },
  { key: 'Total shots',      label: 'Tirs',           higher: true  },
  { key: 'Shots on target',  label: 'Tirs cadrés',    higher: true  },
  { key: 'Corner kicks',     label: 'Corners',        higher: true  },
  { key: 'Fouls',            label: 'Fautes',         higher: false },
  { key: 'Offsides',         label: 'Hors-jeux',      higher: false },
  { key: 'Yellow Cards',     label: 'Cartons jaunes', higher: false },
]

function makeStatRow(label, hv, av, higher) {
  if (hv == null && av == null) return null
  const hvStr = hv != null ? String(hv) : '–'
  const avStr = av != null ? String(av) : '–'
  const hNum  = parseFloat(hvStr.replace('%', ''))
  const aNum  = parseFloat(avStr.replace('%', ''))
  const hBetter = !isNaN(hNum) && !isNaN(aNum) && (higher ? hNum > aNum : hNum < aNum)
  const aBetter = !isNaN(hNum) && !isNaN(aNum) && (higher ? aNum > hNum : aNum < hNum)
  return { label, hv: hvStr, av: avStr, hBetter, aBetter }
}

function fifaStatsToRows(data) {
  if (!data?.home && !data?.away) return []
  const h = data.home ?? {}
  const a = data.away ?? {}
  return [
    makeStatRow('Possession',   h.poss  != null ? `${h.poss}%` : null,  a.poss  != null ? `${a.poss}%` : null,  true),
    makeStatRow('Tirs',         h.shots,         a.shots,         true),
    makeStatRow('Tirs cadrés',  h.shotsOnTarget, a.shotsOnTarget, true),
    makeStatRow('Corners',      h.corners,       a.corners,       true),
    makeStatRow('Fautes',       h.fouls,         a.fouls,         false),
    makeStatRow('Hors-jeux',    h.offside,       a.offside,       false),
  ].filter(Boolean)
}

function aflStatsToRows(statsData) {
  if (!statsData) return []
  const allPeriod = statsData.statistics?.find(s => s.period === 'ALL')
  const items     = allPeriod?.groups?.flatMap(g => g.statisticsItems ?? []) ?? []
  return MATCH_STAT_KEYS.map(({ key, label, higher }) => {
    const item = items.find(i => i.name === key)
    if (!item) return null
    return makeStatRow(label, item.home ?? null, item.away ?? null, higher)
  }).filter(Boolean)
}

// ── Stats match terminé ───────────────────────────────────────────────────────
function MpMatchStats({ match }) {
  const isWC = match?.competition?.code === 'WC' || match?.competition?.id === 2000
  const { data: fifaData,  isLoading: fifaLoading  } = useFifaStats(isWC ? match : null, isWC, false)
  const { data: espnStatsData, isLoading: espnLoading } = useEspnMatchStats(match)
  const { data: aflStats,  isLoading: aflLoading   } = useAflMatchStats(match)
  const { data: recap } = useMatchRecap(match)

  // ── Fil du match : remplacements uniquement ────────────────────────────────
  // Buts ET cartons sont désormais affichés dans le hero (MatchPageHero, qui
  // les fusionne triés par minute) — les remontrer ici faisait doublon
  // (constat utilisateur : d'abord pour les buts, puis pour les cartons
  // "vu qu'on les a déplacés dans le header"). FD.org (useMatchDetail) reste
  // l'unique source des remplacements (ESPN n'en expose aucune).
  const { detail, loading: detailLoading } = useMatchDetail(match?.id)

  const fdSubs      = detail?.substitutions ?? []
  const hasEvents   = fdSubs.length > 0
  const eventsLoading = detailLoading

  const fifaRows = fifaStatsToRows(fifaData)
  const espnRows = fifaStatsToRows(espnStatsData?.stats)
  const aflRows  = aflStatsToRows(aflStats)
  const rows     = fifaRows.length ? fifaRows : espnRows.length ? espnRows : aflRows

  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const hs       = match.score?.fullTime?.home
  const as_      = match.score?.fullTime?.away
  const totalGoals = (hs ?? 0) + (as_ ?? 0)

  const isLoading = !rows.length && ((isWC && fifaLoading) || espnLoading || aflLoading)

  return (
    <div className="mp__statsWrap">
      <div className="mp__statsHeader">
        <span className="mp__statsTeam">{homeName}{hs != null ? ` ${hs}` : ''}</span>
        <span className="mp__statsCenter">Match</span>
        <span className="mp__statsTeam mp__statsTeam--r">{as_ != null ? `${as_} ` : ''}{awayName}</span>
      </div>

      {/* Résumé auto — masqué tant qu'aucun texte n'est disponible (pas de
          placeholder vide, cf. logique H2H) */}
      {recap && <p className="mp__recap">{recap}</p>}

      {/* Fil du match — remplacements seulement (buts + cartons déjà dans le
          hero, voir plus haut). S'il n'y a aucun remplacement à montrer ET
          aucun but marqué, on le précise ; s'il y a des buts/cartons mais pas
          de remplacement, on n'affiche rien ici (pas d'erreur : tout est déjà
          visible dans le hero). */}
      {hasEvents
        ? <MatchTimeline fdSubs={fdSubs} homeId={match.homeTeam?.id} />
        : (!eventsLoading && totalGoals === 0)
          ? <p className="pm__noData">Match sans but (0 – 0)</p>
          : null
      }

      {isLoading ? (
        <div className="mp__tabLoading"><div className="modal__spinner" /></div>
      ) : rows.length > 0 ? (
        <div className="mp__statsList">
          {rows.map(r => (
            <MpStatRow key={r.label} label={r.label}
              homeVal={r.hv} awayVal={r.av}
              homeBetter={r.hBetter} awayBetter={r.aBetter}
            />
          ))}
        </div>
      ) : (
        <p className="pm__noData">Statistiques non disponibles</p>
      )}
    </div>
  )
}

// ── Stats saison (matchs à venir) — barres depuis compMatches ────────────────
function calcTeamStats(teamId, compMatches) {
  const matches = (compMatches ?? []).filter(
    m => m.status === 'FINISHED' && (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId)
  )
  if (!matches.length) return null
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, cs = 0, btts = 0, over25 = 0
  matches.forEach(m => {
    const myHome = m.homeTeam?.id === teamId
    const f = myHome ? m.score?.fullTime?.home : m.score?.fullTime?.away
    const a = myHome ? m.score?.fullTime?.away : m.score?.fullTime?.home
    if (f == null || a == null) return
    gf += f; ga += a
    if (a === 0) cs++
    if (f > 0 && a > 0) btts++
    if (f + a >= 3) over25++
    if (f > a) wins++
    else if (f === a) draws++
    else losses++
  })
  const played = wins + draws + losses
  if (!played) return null
  return {
    played,
    avgFor:     (gf / played).toFixed(1),
    avgAgainst: (ga / played).toFixed(1),
    winPct:     Math.round((wins  / played) * 100),
    bttsPct:    Math.round((btts  / played) * 100),
    over25Pct:  Math.round((over25/ played) * 100),
    cs,
  }
}

function MpSeasonStats({ match, formMap, compMatches, hideForm = false }) {
  const homeId   = match.homeTeam?.id
  const awayId   = match.awayTeam?.id
  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  const h = calcTeamStats(homeId, compMatches)
  const a = calcTeamStats(awayId, compMatches)
  if (!h && !a) return null

  const rows = [
    { label: 'Buts marqués / match',    hv: h?.avgFor,                 av: a?.avgFor,                 hRaw: parseFloat(h?.avgFor),  aRaw: parseFloat(a?.avgFor),  higher: true  },
    { label: 'Buts encaissés / match',  hv: h?.avgAgainst,             av: a?.avgAgainst,             hRaw: parseFloat(h?.avgAgainst),aRaw: parseFloat(a?.avgAgainst),higher: false },
    { label: '% Victoires',             hv: h ? `${h.winPct}%` : '–',  av: a ? `${a.winPct}%` : '–', hRaw: h?.winPct,              aRaw: a?.winPct,              higher: true  },
    { label: 'Clean sheets',            hv: h?.cs,                     av: a?.cs,                     hRaw: h?.cs,                  aRaw: a?.cs,                  higher: true  },
    { label: 'Les deux marquent %',     hv: h ? `${h.bttsPct}%` : '–', av: a ? `${a.bttsPct}%` : '–',hRaw: h?.bttsPct,             aRaw: a?.bttsPct,             higher: true  },
    { label: '+2.5 buts %',             hv: h ? `${h.over25Pct}%` : '–',av: a ? `${a.over25Pct}%` : '–',hRaw: h?.over25Pct,       aRaw: a?.over25Pct,           higher: true  },
  ]

  return (
    <div className="mp__statsWrap">
      <div className="mp__statsHeader">
        <span className="mp__statsTeam">{homeName}</span>
        <span className="mp__statsCenter">Saison</span>
        <span className="mp__statsTeam mp__statsTeam--r">{awayName}</span>
      </div>
      <div className="mp__statsList">
        {rows.map(({ label, hv, av, hRaw, aRaw, higher }) => {
          const hBetter = hRaw != null && aRaw != null && (higher ? hRaw > aRaw : hRaw < aRaw)
          const aBetter = hRaw != null && aRaw != null && (higher ? aRaw > hRaw : aRaw < hRaw)
          return (
            <MpStatRow key={label} label={label}
              homeVal={hv ?? '–'} awayVal={av ?? '–'}
              homeBetter={hBetter} awayBetter={aBetter}
            />
          )
        })}
      </div>

      {/* Forme récente — dernier match joué de chaque équipe (score, W/D/L,
          date), même bloc que l'onglet "Avant-match". Masqué quand
          PreMatchSection est rendu juste après (matchs à venir) : il a déjà
          son propre bloc Forme récente, l'afficher ici aussi le dupliquait. */}
      {!hideForm && (
        <div className="pm__section modal__seasonForm">
          <h3 className="pm__sectionTitle">Forme récente</h3>
          <div className="pm__formGrid">
            <div className="pm__formCol">
              <p className="pm__formTeamName">{homeName}</p>
              <TeamFormTable teamId={homeId} compMatches={compMatches} />
            </div>
            <div className="pm__formDivider" />
            <div className="pm__formCol">
              <p className="pm__formTeamName">{awayName}</p>
              <TeamFormTable teamId={awayId} compMatches={compMatches} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
const TABS = ['statistiques', 'compos', 'classement']

export default function MatchPage() {
  const { matchId } = useParams()
  const navigate    = useNavigate()
  const location    = useLocation()

  const stateMatch = location.state?.match ?? null
  const { data: fetchedMatch, isLoading } = useMatchData(matchId, stateMatch)
  const match = stateMatch ?? fetchedMatch

  const isFinished = match?.status === 'FINISHED'
  const compId = match?.competition?.code ?? null

  // compMatches est nécessaire même pour un match terminé désormais : le
  // sous-onglet "Stats saison" en a besoin (avant, seuls les matchs à venir
  // le fetchaient, ce qui rendait "Stats saison" impossible pour un match FT).
  const { formMap, compMatches, isLoading: formLoading } = useTeamForm(compId)
  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]
  const prono = (hForm || aForm) ? calcProno(hForm, aForm) : null

  const [activeTab, setActiveTab] = useState('statistiques')
  const [tabDir, setTabDir]       = useState(null)
  // Sous-onglet dans "Statistiques" pour un match terminé : Stats live (le
  // récap du match, par défaut) / Stats saison (nouveau).
  const [statsView, setStatsView] = useState('live')

  const goTab = (t, dir) => { setTabDir(dir); setActiveTab(t) }

  const swipe = useSwipe(
    () => {
      const i = TABS.indexOf(activeTab)
      if (i < TABS.length - 1) goTab(TABS[i + 1], 'left')
    },
    () => {
      const i = TABS.indexOf(activeTab)
      if (i > 0) goTab(TABS[i - 1], 'right')
      else navigate(-1)
    }
  )

  if (isLoading || !match) {
    return (
      <div className="mp__page">
        <div className="mp__loading">
          <div className="modal__spinner" />
          <p>Chargement du match…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mp__page">

      {/* Hero plein-écran avec gradient */}
      <MatchPageHero match={match} navigate={navigate} hForm={hForm} aForm={aForm} />

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
                {t === 'statistiques' ? 'Statistiques'
               : t === 'compos'      ? 'Compos'
               :                       'Classement'}
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
            {activeTab === 'statistiques' && (
              isFinished
                ? <>
                    <StatsSubTabs view={statsView} onChange={setStatsView} />
                    {statsView === 'live'
                      ? <MpMatchStats match={match} />
                      : <MpSeasonStats match={match} formMap={formMap} compMatches={compMatches} />
                    }
                  </>
                : formLoading
                  ? <div className="mp__tabLoading"><div className="modal__spinner" /></div>
                  : <>
                      {/* Probabilités estimées — tout en haut, avant Stats saison */}
                      <div className="mp__pronoTop"><PmPronoSection prono={prono} /></div>
                      <MpSeasonStats
                        match={match}
                        formMap={formMap}
                        compMatches={compMatches}
                        hideForm
                      />
                      <PreMatchSection
                        match={match}
                        prono={prono}
                        formMap={formMap}
                        compMatches={compMatches}
                        hideStats
                        hideProno
                      />
                    </>
            )}
            {/* compMatches transmis même pour un match terminé : nécessaire au
                fallback "compositions probables" de ComposTab (dernier XI
                connu), maintenant aussi actif après-coup si la vraie compo
                n'a jamais pu être récupérée. */}
            {activeTab === 'compos'     && <ComposTab match={match} compMatches={compMatches} />}
            {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
          </div>
        </div>
      </div>
    </div>
  )
}
