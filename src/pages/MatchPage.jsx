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
import {
  useEspnMatchStats,
  useFifaStats,
} from '../hooks/useMatchDetail'
import { useAflMatchStats } from '../hooks/useApiFootball'
import {
  PreMatchSection,
  ComposTab,
  ClassementTab,
} from '../components/MatchModal'
import './MatchPage.css'
import '../matchModal.css'
import '../live.css'

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
function MatchPageHero({ match, navigate }) {
  const comp       = COMPETITIONS.find(c => c.id === match.competition?.code)
  const homeName   = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName   = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const isFinished = match.status === 'FINISHED'
  const hs         = match.score?.fullTime?.home ?? match.score?.halfTime?.home
  const as_        = match.score?.fullTime?.away ?? match.score?.halfTime?.away
  const emblem     = comp?.emblem ?? match.competition?.emblem
  const compName   = match.competition?.name ?? comp?.name ?? ''
  const gradient   = getMatchGradient(
    match.homeTeam?.name || homeName,
    match.awayTeam?.name || awayName
  )

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
            ? <div className="mp__hero__crestWrap"><img src={match.homeTeam.crest} alt="" className="mp__hero__crest" /></div>
            : <div className="mp__hero__crestFb" />}
          <span className="mp__hero__name">{homeName}</span>
        </div>

        <div className="mp__hero__center">
          {isFinished ? (
            <>
              <span className="mp__hero__label">Terminé</span>
              <span className="mp__hero__score">{hs} – {as_}</span>
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
            ? <div className="mp__hero__crestWrap"><img src={match.awayTeam.crest} alt="" className="mp__hero__crest" /></div>
            : <div className="mp__hero__crestFb" />}
          <span className="mp__hero__name">{awayName}</span>
        </div>
      </div>
    </div>
  )
}

// ── Barre stat unique (mix A+C) ───────────────────────────────────────────────
function MpStatRow({ label, homeVal, awayVal, homeBetter, awayBetter }) {
  const hNum = parseFloat(String(homeVal ?? '').replace('%', ''))
  const aNum = parseFloat(String(awayVal ?? '').replace('%', ''))
  const total = (hNum || 0) + (aNum || 0) || 1
  // barres : chaque côté max 50% de la piste centrale
  const hPct = Math.round((hNum / total) * 100)
  const aPct = Math.round((aNum / total) * 100)
  const barsValid = !isNaN(hNum) && !isNaN(aNum)

  return (
    <div className="mp__statRow">
      <span className="mp__statLabel">{label}</span>
      <div className="mp__statBarRow">
        <span className={`mp__statVal${homeBetter ? ' mp__statVal--lead' : ''}`}>
          {homeVal ?? '–'}
        </span>

        {barsValid ? (
          <div className="mp__statBars">
            <div className="mp__bar mp__bar--home"
                 style={{ width: `${hPct}%` }} />
            <div className="mp__barDiv" />
            <div className="mp__bar mp__bar--away"
                 style={{ width: `${aPct}%` }} />
          </div>
        ) : (
          <div className="mp__statBars" />
        )}

        <span className={`mp__statVal mp__statVal--r${awayBetter ? ' mp__statVal--lead' : ''}`}>
          {awayVal ?? '–'}
        </span>
      </div>
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
  const { data: espnData,  isLoading: espnLoading  } = useEspnMatchStats(match)
  const { data: aflStats,  isLoading: aflLoading   } = useAflMatchStats(match)

  const fifaRows = fifaStatsToRows(fifaData)
  const espnRows = fifaStatsToRows(espnData?.stats)
  const aflRows  = aflStatsToRows(aflStats)
  const rows     = fifaRows.length ? fifaRows : espnRows.length ? espnRows : aflRows

  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const hs       = match.score?.fullTime?.home
  const as_      = match.score?.fullTime?.away

  const isLoading = !rows.length && ((isWC && fifaLoading) || espnLoading || aflLoading)

  return (
    <div className="mp__statsWrap">
      <div className="mp__statsHeader">
        <span className="mp__statsTeam">{homeName}{hs != null ? ` ${hs}` : ''}</span>
        <span className="mp__statsCenter">Match</span>
        <span className="mp__statsTeam mp__statsTeam--r">{as_ != null ? `${as_} ` : ''}{awayName}</span>
      </div>

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

function MpSeasonStats({ match, formMap, compMatches }) {
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

  const { formMap, compMatches, isLoading: formLoading } = useTeamForm(isFinished ? null : compId)
  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]
  const prono = (hForm || aForm) ? calcProno(hForm, aForm) : null

  const [activeTab, setActiveTab] = useState('statistiques')
  const [tabDir, setTabDir]       = useState(null)

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
      <MatchPageHero match={match} navigate={navigate} />

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
                ? <MpMatchStats match={match} />
                : formLoading
                  ? <div className="mp__tabLoading"><div className="modal__spinner" /></div>
                  : <>
                      <MpSeasonStats
                        match={match}
                        formMap={formMap}
                        compMatches={compMatches}
                      />
                      <PreMatchSection
                        match={match}
                        prono={prono}
                        formMap={formMap}
                        compMatches={compMatches}
                        hideStats
                      />
                    </>
            )}
            {activeTab === 'compos'     && <ComposTab match={match} compMatches={isFinished ? [] : compMatches} />}
            {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
          </div>
        </div>
      </div>
    </div>
  )
}
