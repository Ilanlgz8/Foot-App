import { useEffect, useState }      from 'react'
import { createPortal }            from 'react-dom'
import { useQuery }                from '@tanstack/react-query'
import { useMatchDetail, useLineups, useFifaStats } from '../hooks/useMatchDetail'
import { useEspnMatchDetail }  from '../hooks/useEspnMatchDetail'
import { useSofaLiveStats, useSofaMomentum } from '../hooks/useSofaScore'
import LineupPitch             from './LineupPitch'
import { translateTeam }       from '../data/teamNames'
import { getMatchState, getLiveState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod } from '../utils/matchUtils'
import { calcProno } from '../utils/calcProno'
import './../matchModal.css'

// ── Lecture des données ESPN persistées au moment du FT ──────────────────────
// Sauvegardées par useLiveMinute dans foot_espn_{matchId} lors de la détection FT.
function getEspnData(matchId) {
  if (!matchId) return null
  try {
    const raw = localStorage.getItem(`foot_espn_${matchId}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ── Forme récente (matchs à venir) ──────────────────────────────────────────
function FormBadge({ result }) {
  const label = result === 'W' ? 'V' : result === 'D' ? 'N' : 'D'
  return <span className={`modal__formeBadge modal__formeBadge--${result}`}>{label}</span>
}

// ── Buteurs ESPN (format espnScoresCache.scorers) ────────────────────────────
// ESPN scorers : { name, minute (ex "24:00"), team ('home'|'away'), ownGoal, penaltyKick }
function ESPNScorers({ scorers = [] }) {
  if (scorers.length === 0) return null

  const homeGoals = scorers.filter(s => s.team === 'home')
  const awayGoals = scorers.filter(s => s.team === 'away')
  if (homeGoals.length === 0 && awayGoals.length === 0) return null

  const fmtMin  = (m) => { const base = (m ?? '').split(':')[0]; return base ? `${base}'` : '' }
  const fmtType = (s) => s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''

  return (
    <div className="modal__stats">
      <div className="modal__statsCol modal__statsCol--home">
        {homeGoals.map((s, i) => (
          <div key={i} className="modal__goalRow">
            <span className="modal__goalName">{s.name}{fmtType(s)}</span>
            <span className="modal__goalMeta">{fmtMin(s.minute)}</span>
            <span className="modal__goalIcon" aria-hidden="true">⚽</span>
          </div>
        ))}
      </div>
      <div className="modal__statsDivider" />
      <div className="modal__statsCol modal__statsCol--away">
        {awayGoals.map((s, i) => (
          <div key={i} className="modal__goalRow modal__goalRow--away">
            <span className="modal__goalIcon" aria-hidden="true">⚽</span>
            <span className="modal__goalMeta">{fmtMin(s.minute)}</span>
            <span className="modal__goalName">{s.name}{fmtType(s)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Stats ESPN (possession, tirs, corners) ───────────────────────────────────
function StatBar({ homeVal, awayVal, label }) {
  const hNum = parseFloat(homeVal) || 0
  const aNum = parseFloat(awayVal) || 0
  const total = hNum + aNum
  const homePct = total === 0 ? 50 : Math.round((hNum / total) * 100)
  return (
    <div className="modal__statBar">
      <span className="modal__statBarVal">{homeVal ?? '–'}</span>
      <div className="modal__statBarTrack">
        <div className="modal__statBarFill modal__statBarFill--home" style={{ width: `${homePct}%` }} />
        <div className="modal__statBarFill modal__statBarFill--away" style={{ width: `${100 - homePct}%` }} />
      </div>
      <span className="modal__statBarVal modal__statBarVal--away">{awayVal ?? '–'}</span>
      <span className="modal__statBarLabel">{label}</span>
    </div>
  )
}

function ESPNStats({ stats }) {
  if (!stats) return null
  const { home: h, away: a } = stats
  const rows = [
    { label: 'Possession',    hv: h.poss          != null ? `${h.poss}%`         : null, av: a.poss          != null ? `${a.poss}%`         : null },
    { label: 'Tirs',          hv: h.shots         != null ? `${h.shots}`         : null, av: a.shots         != null ? `${a.shots}`         : null },
    { label: 'Tirs cadrés',   hv: h.shotsOnTarget != null ? `${h.shotsOnTarget}` : null, av: a.shotsOnTarget != null ? `${a.shotsOnTarget}` : null },
    { label: 'Corners',       hv: h.corners       != null ? `${h.corners}`       : null, av: a.corners       != null ? `${a.corners}`       : null },
    { label: 'Fautes',        hv: h.fouls         != null ? `${h.fouls}`         : null, av: a.fouls         != null ? `${a.fouls}`         : null },
    { label: 'Hors-jeu',      hv: h.offside       != null ? `${h.offside}`       : null, av: a.offside       != null ? `${a.offside}`       : null },
  ].filter(r => r.hv != null || r.av != null)

  if (rows.length === 0) return null

  return (
    <div className="modal__espnStats">
      <p className="modal__espnStatsTitle">Statistiques</p>
      {rows.map(({ label, hv, av }) => (
        <StatBar key={label} label={label} homeVal={hv} awayVal={av} />
      ))}
    </div>
  )
}

// ── Timeline des buts FD.org (fallback) ──────────────────────────────────────
function GoalTimeline({ goals = [], homeId }) {
  if (goals.length === 0) return null

  const homeGoals = goals.filter(g => g.team?.id === homeId)
  const awayGoals = goals.filter(g => g.team?.id !== homeId)
  if (Math.max(homeGoals.length, awayGoals.length) === 0) return null

  const goalLabel = (g) => ({
    name: g.scorer?.shortName ?? g.scorer?.name ?? '?',
    min:  g.minute ? `${g.minute}'` : '',
    type: g.type === 'OWN_GOAL' ? ' (csc)' : g.type === 'PENALTY' ? ' (pen)' : '',
  })

  return (
    <div className="modal__stats">
      <div className="modal__statsCol modal__statsCol--home">
        {homeGoals.map((g, i) => {
          const { name, min, type } = goalLabel(g)
          return (
            <div key={i} className="modal__goalRow">
              <span className="modal__goalName">{name}{type}</span>
              <span className="modal__goalMeta">{min}</span>
              <span className="modal__goalIcon" aria-hidden="true">⚽</span>
            </div>
          )
        })}
      </div>
      <div className="modal__statsDivider" />
      <div className="modal__statsCol modal__statsCol--away">
        {awayGoals.map((g, i) => {
          const { name, min, type } = goalLabel(g)
          return (
            <div key={i} className="modal__goalRow modal__goalRow--away">
              <span className="modal__goalIcon" aria-hidden="true">⚽</span>
              <span className="modal__goalMeta">{min}</span>
              <span className="modal__goalName">{name}{type}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Graphique momentum ───────────────────────────────────────────────────────
function MomentumChart({ points, homeName, awayName }) {
  if (!points || points.length === 0) return null
  const W = 400, H = 72
  const maxAbs = Math.max(...points.map(p => Math.abs(p.value ?? 0)), 0.01)
  const barW = W / points.length

  return (
    <div className="modal__momentum">
      <p className="modal__momentumTitle">Momentum</p>
      <div className="modal__momentumLegend">
        <span className="modal__momentumLegendHome">■ {homeName}</span>
        <span className="modal__momentumLegendAway">■ {awayName}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="modal__momentumSvg" preserveAspectRatio="none">
        {/* Ligne centrale */}
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        {points.map((p, i) => {
          const v         = p.value ?? 0
          const norm      = v / maxAbs
          const isHome    = norm >= 0
          const barH      = Math.max(Math.abs(norm) * (H / 2 - 2), 1)
          const x         = i * barW
          const y         = isHome ? H / 2 - barH : H / 2
          return (
            <rect
              key={i}
              x={x + 0.2}
              y={y}
              width={Math.max(barW - 0.4, 0.8)}
              height={barH}
              fill={isHome ? 'rgba(239,68,68,0.65)' : 'rgba(59,130,246,0.65)'}
              rx="0.5"
            />
          )
        })}
      </svg>
    </div>
  )
}

// ── Stats ESPN summary (possession, tirs, corners — endpoint summary) ─────────
// Fetché à la demande quand espnEventId est connu mais le scoreboard n'a pas les stats.
function useEspnSummaryStats(espnEventId, espnSlug, enabled) {
  return useQuery({
    queryKey: ['espnSummary', espnEventId],
    queryFn: async () => {
      const res = await fetch(`/espn?slug=${espnSlug}&eventId=${espnEventId}`)
      if (!res.ok) return null
      const json = await res.json()

      // Le summary ESPN retourne les stats dans boxscore.teams[]
      const teams    = json.boxscore?.teams ?? []
      const homeTeam = teams.find(t => t.homeAway === 'home')
      const awayTeam = teams.find(t => t.homeAway === 'away')

      const getStat = (team, ...names) => {
        for (const name of names) {
          const s = (team?.statistics ?? []).find(st => st.name === name)
          if (s != null) {
            const v = parseFloat(s.displayValue)
            return isNaN(v) ? null : v
          }
        }
        return null
      }

      const homePoss    = getStat(homeTeam, 'possessionPct')
      const awayPoss    = getStat(awayTeam, 'possessionPct')
      const homeShots   = getStat(homeTeam, 'totalShots', 'shotsTotal', 'shots')
      const awayShots   = getStat(awayTeam, 'totalShots', 'shotsTotal', 'shots')
      const homeCorners = getStat(homeTeam, 'cornerKicks', 'corners')
      const awayCorners = getStat(awayTeam, 'cornerKicks', 'corners')

      if (homePoss === null && homeShots === null) return null

      return {
        home: { poss: homePoss, shots: homeShots, corners: homeCorners },
        away: { poss: awayPoss, shots: awayShots, corners: awayCorners },
      }
    },
    enabled:         enabled && !!espnEventId && !!espnSlug,
    staleTime:       60_000,
    refetchInterval: enabled ? 90_000 : false,
    retry:           false,
  })
}

// ── Onglet Stats Live ─────────────────────────────────────────────────────────
// Priorité : ESPN (déjà fetché par LiveProvider, 0 quota) → api-football fallback
const STAT_KEYS = [
  'Ball possession',
  'Total shots',
  'Shots on target',
  'Corner kicks',
  'Fouls',
]
const STAT_FR = {
  'Ball possession': 'Possession',
  'Total shots':     'Tirs',
  'Shots on target': 'Tirs cadrés',
  'Corner kicks':    'Corners',
  'Fouls':           'Fautes',
}

function LiveStatsTab({ match, espnScore }) {
  // isLive : vrai si FD.org dit IN_PLAY/PAUSED OU si le tracker local sait que c'est live
  // (cas où FD.org est temporairement en retard ou rapporte un statut différent)
  const isLive      = match.status === 'IN_PLAY' || match.status === 'PAUSED'
    || getLiveState(match.id).state === 'live'
  // WC 2026 = competition.id 2000 → toujours traiter comme FIFA même si espnSlug
  // pas encore rempli (cas FD.org fallback avant le premier poll FIFA réussi)
  const isFifaMatch = espnScore?.espnSlug === 'fifa' || match.competition?.id === 2000
  const hasEspn     = !!(espnScore?.stats)
  // Pour les matchs FIFA, espnEventId est un FIFA IdMatch (pas un event ESPN) →
  // ne pas appeler useEspnSummaryStats qui ferait une req ESPN inutile
  const hasEspnId   = !isFifaMatch && !!(espnScore?.espnEventId && espnScore?.espnSlug)

  // ── Stats FIFA (WC 2026 uniquement) ──
  // Fetché depuis /api/fifa-lineups qui lit le cache Redis du match FIFA live.
  const { data: fifaStats, isLoading: fifaStatsLoading } = useFifaStats(
    match, isFifaMatch && isLive
  )

  // ESPN summary — fetché si on a l'event ID mais pas encore les stats du scoreboard
  const { data: summaryStats, isLoading: summaryLoading } = useEspnSummaryStats(
    espnScore?.espnEventId,
    espnScore?.espnSlug,
    isLive && !hasEspn && hasEspnId
  )

  // Fallback api-football — si ESPN n'a rien (ni scoreboard ni summary) et pas FIFA
  const espnSummaryFailed = !summaryLoading && !summaryStats
  const { data: statsData, isLoading: aflLoading } = useSofaLiveStats(
    match, isLive && !isFifaMatch && !hasEspn && (!hasEspnId || espnSummaryFailed)
  )

  const homeName = match.homeTeam?.shortName ?? match.homeTeam?.name ?? 'Dom.'
  const awayName = match.awayTeam?.shortName ?? match.awayTeam?.name ?? 'Ext.'

  // ── Priorité 1 : ESPN scoreboard stats (rarement dispo, mais gardé) ──
  if (hasEspn) {
    return (
      <div>
        <ESPNStats stats={espnScore.stats} />
        {espnScore.scorers?.length > 0 && <ESPNScorers scorers={espnScore.scorers} />}
      </div>
    )
  }

  // ── Priorité 2 : Stats FIFA live (WC 2026) ──
  if (isFifaMatch) {
    if (fifaStatsLoading) {
      return <div className="modal__state"><div className="modal__spinner" />Chargement des stats…</div>
    }
    return (
      <div>
        {fifaStats
          ? <ESPNStats stats={fifaStats} />
          : <p className="modal__noEvents">Stats non disponibles</p>
        }
        {espnScore?.scorers?.length > 0 && <ESPNScorers scorers={espnScore.scorers} />}
      </div>
    )
  }

  // ── Priorité 3 : ESPN summary stats (via /espn?eventId=) ──
  if (summaryStats) {
    return (
      <div>
        <ESPNStats stats={summaryStats} />
        {espnScore?.scorers?.length > 0 && <ESPNScorers scorers={espnScore.scorers} />}
      </div>
    )
  }

  // Loading ESPN summary
  if (summaryLoading && hasEspnId) {
    return <div className="modal__state"><div className="modal__spinner" />Chargement des stats…</div>
  }

  // ── Priorité 3 : Fallback api-football ──
  const allPeriod = statsData?.statistics?.find(s => s.period === 'ALL')
  const items     = allPeriod?.groups?.flatMap(g => g.statisticsItems ?? []) ?? []
  const rows      = STAT_KEYS
    .map(k => items.find(item => item.name === k))
    .filter(Boolean)

  if (aflLoading && rows.length === 0) {
    return <div className="modal__state"><div className="modal__spinner" />Chargement des stats…</div>
  }

  return (
    <div>
      {rows.length > 0 ? (
        <div className="modal__espnStats">
          <p className="modal__espnStatsTitle">Statistiques live</p>
          {rows.map(item => (
            <StatBar
              key={item.name}
              label={STAT_FR[item.name] ?? item.name}
              homeVal={item.home ?? '0'}
              awayVal={item.away ?? '0'}
            />
          ))}
        </div>
      ) : (
        <p className="modal__noEvents">Stats non disponibles</p>
      )}
    </div>
  )
}

// ── Onglet Compos — terrain + maillots (ESPN) ─────────────────────────────────

function ComposTab({ match }) {
  const { data: lineups, isLoading, isError } = useLineups(match)

  if (isLoading) {
    return <div className="modal__state"><div className="modal__spinner" />Chargement des compos…</div>
  }
  if (isError || !lineups?.home?.starters?.length) {
    return (
      <div className="modal__state" style={{ flexDirection: 'column', gap: '6px' }}>
        <span style={{ fontSize: '22px' }}>📋</span>
        <span>Compos non disponibles</span>
        <span style={{ fontSize: '12px', opacity: 0.55 }}>
          Disponibles ~1h avant le coup d'envoi
        </span>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 8px 8px' }}>
      <LineupPitch home={lineups.home} away={lineups.away} />
    </div>
  )
}

// ── Cartons FD.org ────────────────────────────────────────────────────────────
function Bookings({ bookings = [], homeId }) {
  if (bookings.length === 0) return null
  const icon = (card) =>
    card === 'YELLOW_CARD'     ? '🟨' :
    card === 'RED_CARD'        ? '🟥' :
    card === 'YELLOW_RED_CARD' ? '🟨🟥' : '📋'
  const homeCards = bookings.filter(b => b.team?.id === homeId)
  const awayCards = bookings.filter(b => b.team?.id !== homeId)
  if (homeCards.length === 0 && awayCards.length === 0) return null
  return (
    <div className="modal__stats" style={{ marginTop: '0.1rem' }}>
      <div className="modal__statsCol modal__statsCol--home">
        {homeCards.map((b, i) => (
          <div key={i} className="modal__goalRow">
            <span className="modal__goalName">{b.player?.shortName ?? b.player?.name ?? '?'}</span>
            <span className="modal__goalMeta">{b.minute ? `${b.minute}'` : ''}</span>
            <span className="modal__goalIcon">{icon(b.card)}</span>
          </div>
        ))}
      </div>
      <div className="modal__statsDivider" />
      <div className="modal__statsCol modal__statsCol--away">
        {awayCards.map((b, i) => (
          <div key={i} className="modal__goalRow modal__goalRow--away">
            <span className="modal__goalIcon">{icon(b.card)}</span>
            <span className="modal__goalMeta">{b.minute ? `${b.minute}'` : ''}</span>
            <span className="modal__goalName">{b.player?.shortName ?? b.player?.name ?? '?'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section détails match terminé ────────────────────────────────────────────
// Priorité ESPN (persisté en localStorage au FT) → fallback FD.org
function FinishedDetails({ match, espnData, detail, loading }) {
  const homeId     = match.homeTeam?.id
  const totalGoals = (match.score?.fullTime?.home ?? 0) + (match.score?.fullTime?.away ?? 0)

  const fdGoals    = detail?.goals    ?? []
  const fdBookings = detail?.bookings ?? []
  const espnScorers = espnData?.scorers ?? []

  // ESPN scoreboard ne retourne pas toujours les détails de buts pour les matchs passés.
  // On considère ESPN "utile" seulement s'il a des buteurs OU des stats.
  const espnHasData = espnScorers.length > 0 || !!espnData?.stats

  // Spinner : on attend si aucune source n'a encore répondu
  const hasAnyData = espnHasData || fdGoals.length > 0 || !!detail
  if (loading && !hasAnyData) {
    return (
      <div className="modal__state">
        <div className="modal__spinner" />
        Chargement…
      </div>
    )
  }

  return (
    <>
      {/* ── Buteurs : ESPN en priorité si utile, FD.org sinon ── */}
      {espnScorers.length > 0
        ? <ESPNScorers scorers={espnScorers} />
        : fdGoals.length > 0
          ? <GoalTimeline goals={fdGoals} homeId={homeId} />
          : !loading
            ? <p className="modal__noEvents">
                {totalGoals > 0 ? 'Buteurs non disponibles' : 'Match sans but (0 – 0)'}
              </p>
            : null   // FD.org charge encore, on n'affiche pas le message trop tôt
      }

      {/* ── Stats ESPN si disponibles ── */}
      {espnData?.stats && <ESPNStats stats={espnData.stats} />}

      {/* ── Cartons FD.org ── */}
      {fdBookings.length > 0 && <Bookings bookings={fdBookings} homeId={homeId} />}
    </>
  )
}


// ── Modal principale ─────────────────────────────────────────────────────────
function PronoSection({ prono, homeShort, awayShort }) {
  if (!prono) return null
  const winner = prono.home >= prono.away && prono.home >= prono.draw ? 'home'
    : prono.away >= prono.home && prono.away >= prono.draw ? 'away'
    : 'draw'
  return (
    <div className="modal__prono">
      <p className="modal__pronoTitle">Probabilités estimées</p>
      <div className="modal__pronoRow">
        <span className="modal__pronoLabel">{homeShort}</span>
        <div className="modal__pronoBar">
          <div className={`modal__pronoSeg modal__pronoSeg--home${winner === 'home' ? ' modal__pronoSeg--winner' : ''}`} style={{ '--prono-home': prono.home }} />
          <div className={`modal__pronoSeg modal__pronoSeg--draw${winner === 'draw' ? ' modal__pronoSeg--winner' : ''}`} style={{ '--prono-draw': prono.draw }} />
          <div className={`modal__pronoSeg modal__pronoSeg--away${winner === 'away' ? ' modal__pronoSeg--winner' : ''}`} style={{ '--prono-away': prono.away }} />
        </div>
        <span className="modal__pronoLabel">{awayShort}</span>
      </div>
      <div className="modal__pronoNums">
        <span className={`modal__pronoNum modal__pronoNum--home${winner === 'home' ? ' modal__pronoNum--winner' : ''}`}>{prono.home}%</span>
        <span className={`modal__pronoNum modal__pronoNum--draw${winner === 'draw' ? ' modal__pronoNum--winner' : ''}`}>{prono.draw}%</span>
        <span className={`modal__pronoNum modal__pronoNum--away${winner === 'away' ? ' modal__pronoNum--winner' : ''}`}>{prono.away}%</span>
      </div>
      <div className="modal__pronoKeys">
        <span>Victoire</span>
        <span>Nul</span>
        <span>Défaite</span>
      </div>
      <p className="modal__pronoDisclaimer">Basé sur la forme des 5 derniers matchs</p>
    </div>
  )
}

function MatchModal({ match, compId, onClose, defaultTab = 'stats', espnScore, formMap }) {
  const isFinished = match?.status === 'FINISHED' || getMatchState(match?.id).ft === true
  const isLive     = !isFinished && (match?.status === 'IN_PLAY' || match?.status === 'PAUSED')
  const [tab, setTab] = useState(defaultTab)

  // 1. Données ESPN déjà persistées en localStorage (match suivi en live)
  const cachedEspn = isFinished ? getEspnData(match?.id) : null

  // 2. Si pas en cache → fetch ESPN à la demande (matchs du jour avec STATUS_FINAL)
  const { espnData: fetchedEspn, loading: espnLoading } = useEspnMatchDetail(
    isFinished && !cachedEspn ? match : null,
    isFinished && !cachedEspn ? compId : null,
    isFinished && !cachedEspn
  )
  const espnData = cachedEspn ?? fetchedEspn

  // FD.org uniquement si pas de données ESPN (fallback matchs anciens)
  // FD.org fetch en parallèle (pas conditionné à ESPN) — fallback buteurs + cartons
  const { detail, loading: detailLoading } = useMatchDetail(
    isFinished ? match?.id : null
  )

  useEffect(() => {
    const scrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    return () => {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      window.scrollTo(0, scrollY)
    }
  }, [])

  if (!match) return null

  // Prono basé sur la forme FD.org (passée depuis Match.jsx / Accueil)
  const hForm = formMap?.[match.homeTeam?.id]
  const aForm = formMap?.[match.awayTeam?.id]
  const prono = !isFinished && (hForm || aForm) ? calcProno(hForm, aForm) : null

  const hs  = match.score?.fullTime?.home
  const as_ = match.score?.fullTime?.away
  const hWin = isFinished && hs > as_
  const aWin = isFinished && as_ > hs

  const formatHour = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const formatDate = (d) => {
    const today    = new Date(); today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
    const date     = new Date(d); date.setHours(0,0,0,0)
    if (date.getTime() === today.getTime())    return "Aujourd'hui"
    if (date.getTime() === tomorrow.getTime()) return 'Demain'
    return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  const modal = (
    <div className="modal__overlay" onClick={onClose}>
      <div className="modal__panel" onClick={e => e.stopPropagation()}>

        <button className="modal__close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="modal__header">
          <span className="modal__kicker">{match.competition?.name}</span>
        </div>

        {/* Équipes + score */}
        <div className="modal__teams">
          <div className="modal__team">
            {match.homeTeam.crest && (
              <img src={match.homeTeam.crest} alt="" className="modal__crest"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <span className="modal__teamName">
              {translateTeam(match.homeTeam.shortName || match.homeTeam.name)}
            </span>
          </div>

          <div className="modal__vs">
            {isFinished ? (
              <>
                <div className="modal__scoreboard">
                  <span className={`modal__scoreNum ${hWin ? 'modal__scoreNum--win' : ''}`}>{hs}</span>
                  <span className="modal__scoreSep">–</span>
                  <span className={`modal__scoreNum ${aWin ? 'modal__scoreNum--win' : ''}`}>{as_}</span>
                </div>
                <span className="modal__ftLabel">Terminé</span>
              </>
            ) : isLive ? (() => {
              const matchSt = getMatchState(match.id)
              const liveHs  = espnScore?.home ?? match.score?.fullTime?.home ?? match.score?.halfTime?.home
              const liveAs  = espnScore?.away ?? match.score?.fullTime?.away ?? match.score?.halfTime?.away
              const minute  = calcMinute(match)
              const period  = getMatchPeriod(match)
              const pauseElapsed = match.status === 'PAUSED' && matchSt.pausedAt && !matchSt.half2Start
                ? Date.now() - matchSt.pausedAt : null
              const repriseImminente = pauseElapsed != null && pauseElapsed >= 15 * 60_000
              const repriseDans = pauseElapsed != null && pauseElapsed < 15 * 60_000
                ? Math.max(1, Math.ceil((15 * 60_000 - pauseElapsed) / 60_000)) : null
              return (
                <>
                  <div className="modal__liveMinuteRow">
                    <span className="modal__liveDot" />
                    <span className="modal__liveMinute">{minute ?? period ?? 'LIVE'}</span>
                  </div>
                  <div className="modal__scoreboard">
                    <span className="modal__scoreNum">{liveHs ?? '–'}</span>
                    <span className="modal__scoreSep">–</span>
                    <span className="modal__scoreNum">{liveAs ?? '–'}</span>
                  </div>
                  {repriseImminente && <span className="modal__repriseLabel">reprise imminente</span>}
                  {repriseDans != null && !repriseImminente && <span className="modal__repriseLabel">reprise dans {repriseDans} min</span>}
                </>
              )
            })() : (
              <>
                <span className="modal__date">{formatDate(match.utcDate)}</span>
                <span className="modal__hour">{formatHour(match.utcDate)}</span>
              </>
            )}
          </div>

          <div className="modal__team modal__team--away">
            {match.awayTeam.crest && (
              <img src={match.awayTeam.crest} alt="" className="modal__crest"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <span className="modal__teamName">
              {translateTeam(match.awayTeam.shortName || match.awayTeam.name)}
            </span>
          </div>
        </div>

        {/* Contenu selon statut */}
        {isFinished ? (
          <FinishedDetails
            match={match}
            espnData={espnData}
            detail={detail}
            loading={espnLoading || detailLoading}
          />
        ) : isLive ? (
          <>
            {/* Onglets match en cours */}
            <div className="modal__tabs">
              <button
                className={`modal__tab${tab === 'livestats' ? ' modal__tab--active' : ''}`}
                onClick={() => setTab('livestats')}
              >Stats Live</button>
              <button
                className={`modal__tab${tab === 'compos' ? ' modal__tab--active' : ''}`}
                onClick={() => setTab('compos')}
              >Compos</button>
              {prono && (
                <button
                  className={`modal__tab${tab === 'prono' ? ' modal__tab--active' : ''}`}
                  onClick={() => setTab('prono')}
                >Prono</button>
              )}
            </div>
            {tab === 'livestats' && <LiveStatsTab match={match} espnScore={espnScore} />}
            {tab === 'compos'    && <ComposTab match={match} />}
            {tab === 'prono'     && (
              <PronoSection
                prono={prono}
                homeShort={match.homeTeam?.shortName || match.homeTeam?.name}
                awayShort={match.awayTeam?.shortName || match.awayTeam?.name}
              />
            )}
          </>
        ) : (
          /* Match à venir — prono affiché directement */
          <PronoSection
            prono={prono}
            homeShort={match.homeTeam?.shortName || match.homeTeam?.name}
            awayShort={match.awayTeam?.shortName || match.awayTeam?.name}
          />
        )}

      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

export default MatchModal
