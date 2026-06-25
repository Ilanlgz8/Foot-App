import { useEffect, useState }      from 'react'
import { createPortal }            from 'react-dom'
import { useQuery }                from '@tanstack/react-query'
import { useMatchDetail, useLineups, useFifaStats, useH2H, useEspnMatchStats, useProbableLineups } from '../hooks/useMatchDetail'
import { useTeamForm } from '../hooks/useTeamForm'
import { useEspnMatchDetail }  from '../hooks/useEspnMatchDetail'
import { useAflLiveStats, useAflLineups, useAflMatchStats, useAflProbableLineups } from '../hooks/useApiFootball'
import LineupPitch             from './LineupPitch'
import { StandingsTable }     from './StandingsTable'
import { useStandings }       from '../hooks/useStandings'
import { useSwipe }           from '../hooks/useSwipe'
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
      <span className="modal__statBarLabel">{label}</span>
      <div className="modal__statBarRow">
        <span className="modal__statBarVal">{homeVal ?? '–'}</span>
        <div className="modal__statBarTrack">
          <div className="modal__statBarFill modal__statBarFill--home" style={{ width: `${homePct}%` }} />
          <div className="modal__statBarFill modal__statBarFill--away" style={{ width: `${100 - homePct}%` }} />
        </div>
        <span className="modal__statBarVal modal__statBarVal--away">{awayVal ?? '–'}</span>
      </div>
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
    staleTime:       30_000,
    refetchInterval: enabled ? 60_000 : false,
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

export function LiveStatsTab({ match, espnScore, prono, homeShort, awayShort, compMatches }) {
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
  const { data: statsData, isLoading: aflLoading } = useAflLiveStats(
    match, isLive && !isFifaMatch && !hasEspn && (!hasEspnId || espnSummaryFailed)
  )

  const homeName = match.homeTeam?.shortName ?? match.homeTeam?.name ?? 'Dom.'
  const awayName = match.awayTeam?.shortName ?? match.awayTeam?.name ?? 'Ext.'

  // Barre de prono affichée en haut du tab stats
  const pronoBar = prono ? (
    <div style={{ marginBottom: '0.25rem' }}>
      <PronoSection prono={prono} homeShort={homeShort || homeName} awayShort={awayShort || awayName} />
    </div>
  ) : null

  // H2H affiché en bas pour matchs terminés (pas en live pour ne pas alourdir)
  const h2hBlock = !isLive ? <H2HSection match={match} compMatches={compMatches} /> : null

  // ── Priorité 1 : ESPN scoreboard stats (rarement dispo, mais gardé) ──
  if (hasEspn) {
    return (
      <div>
        {pronoBar}
        <ESPNStats stats={espnScore.stats} />
        {espnScore.scorers?.length > 0 && <ESPNScorers scorers={espnScore.scorers} />}
        {h2hBlock}
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
        {pronoBar}
        {fifaStats
          ? <ESPNStats stats={fifaStats} />
          : <p className="modal__noEvents">Stats non disponibles</p>
        }
        {espnScore?.scorers?.length > 0 && <ESPNScorers scorers={espnScore.scorers} />}
        {h2hBlock}
      </div>
    )
  }

  // ── Priorité 3 : ESPN summary stats (via /espn?eventId=) ──
  if (summaryStats) {
    return (
      <div>
        {pronoBar}
        <ESPNStats stats={summaryStats} />
        {espnScore?.scorers?.length > 0 && <ESPNScorers scorers={espnScore.scorers} />}
        {h2hBlock}
      </div>
    )
  }

  // Loading ESPN summary
  if (summaryLoading && hasEspnId) {
    return <div className="modal__state"><div className="modal__spinner" />Chargement des stats…</div>
  }

  // ── Priorité 4 : Fallback api-football ──
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
      {pronoBar}
      {rows.length > 0 ? (
        <div className="modal__espnStats">
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
      {h2hBlock}
    </div>
  )
}

// ── Onglet Compos — api-football (primaire) → ESPN/FIFA (fallback) ────────────

export function ComposTab({ match, compMatches }) {
  const isFinished = match?.status === 'FINISHED'
  const isUpcoming = !isFinished

  // WC 2026 : useLineups gère FIFA API en interne (redis fm:match:) puis ESPN fallback.
  // Pour WC on lance api-football EN PARALLÈLE d'ESPN (ESPN/FIFA souvent vides si hors cron).
  // Pour non-WC, api-football attend qu'ESPN échoue (économie de quota 100 req/jour).
  const isWC = match?.competition?.id === 2000 || match?.competition?.code === 'WC'

  // Source 1 : ESPN/FIFA (useLineups essaie FIFA Redis puis ESPN — gère WC en interne)
  const { data: espnLineups,   isLoading: espnLoading    } = useLineups(match)
  const { data: espnMatchData, isLoading: espnMatchLoading } = useEspnMatchStats(match)

  const espnDone    = !espnLoading && !espnMatchLoading
  const espnHasData = espnLineups?.home?.starters?.length || espnMatchData?.lineups?.home?.starters?.length

  // Source 2 : api-football
  // WC : en parallèle (ESPN/FIFA souvent vides sans cron)
  // Non-WC : seulement après échec ESPN (économie quota)
  const { data: aflLineups, isLoading: aflLoading } = useAflLineups(
    isWC ? match : (espnDone && !espnHasData ? match : null)
  )

  // Source 3a (matchs à venir) : probables via ESPN (fonctionne WC avec header.competitions)
  const { data: probableData, isLoading: probableLoading } = useProbableLineups(
    isUpcoming ? match : null,
    compMatches
  )

  // Source 3b (matchs à venir) : probables via api-football (fallback si ESPN vide)
  const { data: aflProbableData, isLoading: aflProbableLoading } = useAflProbableLineups(
    isUpcoming ? match : null,
    compMatches
  )

  const isLoading = espnLoading || espnMatchLoading
    || (!espnHasData && aflLoading)
    || (isUpcoming && probableLoading)
    || (isUpcoming && !probableData && aflProbableLoading)

  const lineups = espnLineups?.home?.starters?.length           ? espnLineups
               : espnMatchData?.lineups?.home?.starters?.length ? espnMatchData.lineups
               : aflLineups?.home?.starters?.length             ? aflLineups
               : null

  const probSource = probableData ?? aflProbableData ?? null
  const probable = !lineups && probSource?.home?.starters?.length ? probSource : null

  if (isLoading) {
    return <div className="modal__state"><div className="modal__spinner" />Chargement des compos…</div>
  }

  // Enrichit les objets lineup avec les crests du match (non inclus dans l'API ESPN roster)
  const homeCrest = match?.homeTeam?.crest ?? null
  const awayCrest = match?.awayTeam?.crest ?? null
  const withCrest = (obj, crest) => obj ? { ...obj, crest } : obj

  if (lineups) {
    return (
      <div style={{ padding: '8px 0 0' }}>
        <LineupPitch
          home={withCrest(lineups.home, homeCrest)}
          away={withCrest(lineups.away, awayCrest)}
        />
      </div>
    )
  }

  if (probable) {
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : ''
    const homeFrom = probable.home?.fromMatch
    return (
      <div>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '2px', padding: '0.45rem 1rem', margin: '8px 8px 0',
          background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)',
          borderRadius: '0.6rem', fontSize: '0.72rem', color: 'rgba(251,191,36,0.85)',
        }}>
          <span>⚡ Compositions probables · dernier XI connu</span>
          {homeFrom && (
            <span style={{ fontSize: '0.62rem', opacity: 0.6 }}>
              Basé sur match du {fmtDate(homeFrom.date)}
            </span>
          )}
        </div>
        <div style={{ padding: '8px 0 0' }}>
          <LineupPitch
            home={withCrest(probable.home, homeCrest)}
            away={withCrest(probable.away ?? probable.home, awayCrest)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="modal__state" style={{ flexDirection: 'column', gap: '6px' }}>
      <span style={{ fontSize: '22px' }}>📋</span>
      <span>Compos non disponibles</span>
      <span style={{ fontSize: '12px', opacity: 0.55 }}>
        {isUpcoming ? 'Disponibles ~1h avant le coup d\'envoi' : 'Compos non publiées'}
      </span>
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

// ── Onglet Classement — classement du championnat en cours ────────────────────
// WC : affiche uniquement le(s) groupe(s) contenant les deux équipes
// Autres : affiche le classement complet

const WC_RULES = [
  { label: 'Qualifié', start: 1, end: 2, dotClassName: 'classement__zoneDot classement__zoneDot--ucl' },
  { label: 'Éliminé',  start: 3, end: 4, dotClassName: 'classement__zoneDot classement__zoneDot--elimine' },
]
const DEFAULT_RULES = [
  { label: 'Ligue des champions', start: 1, end: 4, dotClassName: 'classement__zoneDot classement__zoneDot--ucl' },
  { label: 'Europa League',       start: 5, end: 6, dotClassName: 'classement__zoneDot classement__zoneDot--uel' },
  { label: 'Conférence League',   start: 7, end: 7, dotClassName: 'classement__zoneDot classement__zoneDot--uecl' },
]
const COMP_RULES = { WC: WC_RULES, FL1: DEFAULT_RULES, PL: DEFAULT_RULES, PD: DEFAULT_RULES, BL1: DEFAULT_RULES, SA: DEFAULT_RULES }

export function ClassementTab({ match, compId }) {
  const { standings, groups, loading } = useStandings(compId)
  const { formMap } = useTeamForm(compId)

  if (loading) {
    return <div className="modal__state"><div className="modal__spinner" />Chargement du classement…</div>
  }

  const rules = COMP_RULES[compId] ?? DEFAULT_RULES
  const homeId = match?.homeTeam?.id
  const awayId = match?.awayTeam?.id

  // WC → filtrer les groupes contenant les deux équipes
  if (groups.length > 0) {
    const relevantGroups = groups.filter(g =>
      g.table.some(r => r.team?.id === homeId || r.team?.id === awayId)
    )
    const toShow = relevantGroups.length > 0 ? relevantGroups : groups.slice(0, 1)
    return (
      <div style={{ padding: '4px 0' }}>
        {toShow.map(g => (
          <div key={g.name}>
            {toShow.length > 1 && (
              <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', marginBottom: '6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {g.name.replace('GROUP_', 'Groupe ')}
              </p>
            )}
            <StandingsTable rows={g.table} compact={false} formMap={formMap} qualificationRules={rules} />
          </div>
        ))}
      </div>
    )
  }

  // Autres championnats → classement complet
  if (standings.length === 0) {
    return <p className="modal__noEvents">Classement non disponible</p>
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <StandingsTable rows={standings} formMap={formMap} qualificationRules={rules} />
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
export function PronoSection({ prono, homeShort, awayShort }) {
  if (!prono) return null
  const winner = prono.home >= prono.away && prono.home >= prono.draw ? 'home'
    : prono.away >= prono.home && prono.away >= prono.draw ? 'away'
    : 'draw'
  return (
    <div className="modal__prono">
      <p className="modal__pronoTitle">Probabilités estimées</p>
      <div className="modal__pronoRow">
        <div className="modal__pronoBar">
          <div className={`modal__pronoSeg modal__pronoSeg--home${winner === 'home' ? ' modal__pronoSeg--winner' : ''}`} style={{ '--prono-home': prono.home }} />
          <div className={`modal__pronoSeg modal__pronoSeg--draw${winner === 'draw' ? ' modal__pronoSeg--winner' : ''}`} style={{ '--prono-draw': prono.draw }} />
          <div className={`modal__pronoSeg modal__pronoSeg--away${winner === 'away' ? ' modal__pronoSeg--winner' : ''}`} style={{ '--prono-away': prono.away }} />
        </div>
      </div>
      <div className="modal__pronoNums">
        <span className={`modal__pronoNum modal__pronoNum--home${winner === 'home' ? ' modal__pronoNum--winner' : ''}`}>{prono.home}%</span>
        <span className={`modal__pronoNum modal__pronoNum--draw${winner === 'draw' ? ' modal__pronoNum--winner' : ''}`}>{prono.draw}%</span>
        <span className={`modal__pronoNum modal__pronoNum--away${winner === 'away' ? ' modal__pronoNum--winner' : ''}`}>{prono.away}%</span>
      </div>
      <div className="modal__pronoKeys">
        <span>Victoire</span>
        <span>Nul</span>
        <span>Victoire</span>
      </div>
      <p className="modal__pronoDisclaimer">Basé sur la forme des 5 derniers matchs</p>
    </div>
  )
}

// ── Section pré-match ────────────────────────────────────────────────────────
// Affichée pour les matchs à venir : prono + forme 5 derniers + H2H

function ResultBadge({ result }) {
  const cls = result === 'W' ? 'pm__badge--w' : result === 'D' ? 'pm__badge--d' : 'pm__badge--l'
  const label = result === 'W' ? 'V' : result === 'D' ? 'N' : 'D'
  return <span className={`pm__badge ${cls}`}>{label}</span>
}

function TeamFormTable({ teamId, compMatches }) {
  const matches = (compMatches ?? [])
    .filter(m => m.status === 'FINISHED' && (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId))
    .slice(-5)

  if (!matches.length) return <p className="pm__noData">Pas de données</p>

  return (
    <div className="pm__formTable">
      {matches.map((m, i) => {
        const myHome  = m.homeTeam?.id === teamId
        const hs      = m.score?.fullTime?.home ?? '-'
        const as_     = m.score?.fullTime?.away ?? '-'
        const myGoals  = myHome ? hs : as_
        const oppGoals = myHome ? as_ : hs
        const result  = myGoals > oppGoals ? 'W' : myGoals < oppGoals ? 'L' : 'D'
        const hName   = translateTeam(m.homeTeam?.shortName || m.homeTeam?.name || '?')
        const aName   = translateTeam(m.awayTeam?.shortName || m.awayTeam?.name || '?')
        const date    = new Date(m.utcDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
        return (
          <div key={i} className="pm__formRow">
            <ResultBadge result={result} />
            <span className="pm__formMatchup">
              <span className={`pm__formTeam${myHome ? ' pm__formTeam--me' : ''}`}>{hName}</span>
              <span className="pm__formScore">{hs}:{as_}</span>
              <span className={`pm__formTeam${!myHome ? ' pm__formTeam--me' : ''}`}>{aName}</span>
            </span>
            <span className="pm__formDate">{date}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Stats saison calculées depuis compMatches ─────────────────────────────
function calcTeamStats(teamId, compMatches) {
  const matches = (compMatches ?? []).filter(
    m => m.status === 'FINISHED' && (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId)
  )
  if (!matches.length) return null
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, cs = 0, btts = 0, over25 = 0
  const results = []
  matches.forEach(m => {
    const myHome = m.homeTeam?.id === teamId
    const f = myHome ? m.score?.fullTime?.home : m.score?.fullTime?.away
    const a = myHome ? m.score?.fullTime?.away : m.score?.fullTime?.home
    if (f == null || a == null) return
    gf += f; ga += a
    if (a === 0) cs++
    if (f > 0 && a > 0) btts++
    if (f + a >= 3) over25++
    if (f > a) { wins++; results.push('W') }
    else if (f === a) { draws++; results.push('D') }
    else { losses++; results.push('L') }
  })
  const played = wins + draws + losses
  if (!played) return null

  // Série en cours : compte les derniers résultats identiques consécutifs
  let streak = 0, streakType = null
  for (let i = results.length - 1; i >= 0; i--) {
    if (streakType === null) { streakType = results[i]; streak = 1 }
    else if (results[i] === streakType) streak++
    else break
  }
  const streakLabel = streakType === 'W' ? `${streak}V` : streakType === 'D' ? `${streak}N` : `${streak}D`

  return {
    played, wins, draws, losses, gf, ga, cs,
    avgFor:     (gf / played).toFixed(1),
    avgAgainst: (ga / played).toFixed(1),
    winPct:     Math.round((wins / played) * 100),
    bttsPct:    Math.round((btts / played) * 100),
    over25Pct:  Math.round((over25 / played) * 100),
    streak: streakLabel,
    streakType,
  }
}

function SeasonStatsSection({ homeId, awayId, homeName, awayName, compMatches }) {
  const h = calcTeamStats(homeId, compMatches)
  const a = calcTeamStats(awayId, compMatches)
  if (!h && !a) return null

  // Série en cours : losanges colorés (◆ vert=V, jaune=N, rouge=D)
  const streakColor = type => type === 'W' ? '#4ade80' : type === 'D' ? '#facc15' : '#f87171'
  const makeStreakEl = (stats) => {
    if (!stats?.streak) return '–'
    const count = parseInt(stats.streak, 10)
    const color = streakColor(stats.streakType)
    return (
      <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
        {Array.from({ length: count }).map((_, i) => (
          <span key={i} style={{ color, fontSize: 'clamp(0.65rem, 3vw, 2.25rem)', lineHeight: 1 }}>◆</span>
        ))}
      </span>
    )
  }
  const hStreakEl = makeStreakEl(h)
  const aStreakEl = makeStreakEl(a)

  const rows = [
    { label: 'Matchs joués',         hv: h?.played,                av: a?.played,                higher: true  },
    { label: 'Buts marqués / match',  hv: h?.avgFor,                av: a?.avgFor,                higher: true  },
    { label: 'Buts encaissés / match',hv: h?.avgAgainst,            av: a?.avgAgainst,            higher: false },
    { label: '% Victoires',           hv: h ? `${h.winPct}%` : '–', av: a ? `${a.winPct}%` : '–',
      hRaw: h?.winPct, aRaw: a?.winPct, higher: true },
    { label: 'Clean sheets',          hv: h?.cs,                    av: a?.cs,                    higher: true  },
    { label: 'Les deux marquent %',   hv: h ? `${h.bttsPct}%` : '–', av: a ? `${a.bttsPct}%` : '–',
      hRaw: h?.bttsPct, aRaw: a?.bttsPct, higher: true },
    { label: '+2.5 buts %',           hv: h ? `${h.over25Pct}%` : '–', av: a ? `${a.over25Pct}%` : '–',
      hRaw: h?.over25Pct, aRaw: a?.over25Pct, higher: true },
    { label: 'Série en cours',        hv: hStreakEl, av: aStreakEl, noCompare: true },
  ]

  return (
    <div className="pm__section">
      <h3 className="pm__sectionTitle">Statistiques saison</h3>
      <div className="pm__statHeader">
        <span className="pm__statTeam">{homeName}</span>
        <span />
        <span className="pm__statTeam pm__statTeam--away">{awayName}</span>
      </div>
      <div className="pm__statTable">
        {rows.map(({ label, hv, av, hRaw, aRaw, higher, noCompare }) => {
          const hNum = hRaw !== undefined ? hRaw : parseFloat(hv)
          const aNum = hRaw !== undefined ? aRaw : parseFloat(av)
          const hBetter = !noCompare && (higher ? hNum > aNum : hNum < aNum)
          const aBetter = !noCompare && (higher ? aNum > hNum : aNum < hNum)
          return (
            <div key={label} className="pm__statRow">
              <span className={`pm__statVal${hBetter ? ' pm__statVal--better' : ''}`}>{hv ?? '–'}</span>
              <span className="pm__statName">{label}</span>
              <span className={`pm__statVal pm__statVal--right${aBetter ? ' pm__statVal--better' : ''}`}>{av ?? '–'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function H2HSection({ match, compMatches }) {
  const { data: h2hMatches, isLoading } = useH2H(match)

  const homeId = match.homeTeam?.id
  const awayId = match.awayTeam?.id

  // Données FD.org (du plus récent au plus vieux)
  const fdRecent = (h2hMatches ?? [])
    .filter(m => m.status === 'FINISHED')
    .slice(-8)
    .reverse()

  // Fallback : confrontations dans la compétition en cours (si FD.org vide)
  const compH2H = !fdRecent.length && compMatches?.length
    ? (compMatches).filter(m =>
        m.status === 'FINISHED' &&
        ((m.homeTeam?.id === homeId && m.awayTeam?.id === awayId) ||
         (m.homeTeam?.id === awayId && m.awayTeam?.id === homeId))
      ).slice().reverse()
    : []

  const rows = fdRecent.length ? fdRecent : compH2H

  return (
    <div className="pm__section">
      <h3 className="pm__sectionTitle">Derniers résultats entre les deux équipes</h3>
      {isLoading ? (
        <p className="pm__noData">Chargement…</p>
      ) : !rows.length ? (
        <p className="pm__noData">Aucune confrontation disponible</p>
      ) : (
        <div className="pm__h2hList">
          {rows.map((m, i) => {
            const isHomeTeam = m.homeTeam?.id === homeId
            const hs = m.score?.fullTime?.home ?? '-'
            const as_ = m.score?.fullTime?.away ?? '-'
            const date = new Date(m.utcDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
            const myGoals  = isHomeTeam ? hs : as_
            const oppGoals = isHomeTeam ? as_ : hs
            const result = myGoals > oppGoals ? 'W' : myGoals < oppGoals ? 'L' : 'D'
            return (
              <div key={i} className="pm__h2hRow">
                <span className="pm__h2hDate">{date}</span>
                <span className="pm__h2hHome">{translateTeam(m.homeTeam?.shortName || m.homeTeam?.name || '?')}</span>
                <span className="pm__h2hScore">{hs} – {as_}</span>
                <span className="pm__h2hAway">{translateTeam(m.awayTeam?.shortName || m.awayTeam?.name || '?')}</span>
                <ResultBadge result={result} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Stats d'un match terminé (api-football) ──────────────────────────────────
const MATCH_STAT_KEYS = [
  { key: 'Ball possession',  label: 'Possession',     higher: true  },
  { key: 'Total shots',      label: 'Tirs',           higher: true  },
  { key: 'Shots on target',  label: 'Tirs cadrés',    higher: true  },
  { key: 'Corner kicks',     label: 'Corners',        higher: true  },
  { key: 'Fouls',            label: 'Fautes',         higher: false },
  { key: 'Offsides',         label: 'Hors-jeux',      higher: false },
  { key: 'Yellow Cards',     label: 'Cartons jaunes', higher: false },
]

// ── Helpers stats match terminé ───────────────────────────────────────────────

function makeStatRow(label, hv, av, higher) {
  if (hv == null && av == null) return null
  const hvStr = hv != null ? String(hv) : '–'
  const avStr = av != null ? String(av) : '–'
  const hNum  = parseFloat(hvStr.replace('%',''))
  const aNum  = parseFloat(avStr.replace('%',''))
  const hBetter = !isNaN(hNum) && !isNaN(aNum) && (higher ? hNum > aNum : hNum < aNum)
  const aBetter = !isNaN(hNum) && !isNaN(aNum) && (higher ? aNum > hNum : aNum < hNum)
  return { label, hv: hvStr, av: avStr, hBetter, aBetter }
}

// Convertit les stats FIFA (useFifaStats) en lignes d'affichage
function fifaStatsToRows(data) {
  if (!data?.home && !data?.away) return []
  const h = data.home ?? {}
  const a = data.away ?? {}
  return [
    makeStatRow('Possession',   h.poss  != null ? `${h.poss}%` : null,  a.poss  != null ? `${a.poss}%` : null,  true),
    makeStatRow('Tirs',         h.shots,          a.shots,          true),
    makeStatRow('Tirs cadrés',  h.shotsOnTarget,  a.shotsOnTarget,  true),
    makeStatRow('Corners',      h.corners,        a.corners,        true),
    makeStatRow('Fautes',       h.fouls,          a.fouls,          false),
    makeStatRow('Hors-jeux',    h.offside,        a.offside,        false),
  ].filter(Boolean)
}

// Convertit les stats api-football (useAflMatchStats) en lignes d'affichage
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

export function MatchStatsSection({ match }) {
  const isWC = match?.competition?.code === 'WC' || match?.competition?.id === 2000

  // Source 1 — FIFA (Redis, WC uniquement, one-shot)
  const { data: fifaData, isLoading: fifaLoading } = useFifaStats(
    isWC ? match : null, isWC, false
  )

  // Source 2 — ESPN scoreboard → summary (tous les matchs COMP_ESPN, sans Redis)
  const { data: espnData, isLoading: espnLoading } = useEspnMatchStats(match)

  // Source 3 — api-football (fallback universel)
  const { data: aflStats, isLoading: aflLoading } = useAflMatchStats(match)

  // ── Buteurs : match.goals (FD.org) ou fetch full match si absent ─────────────
  const needGoalsFetch = !!match?.id && !(match?.goals?.length > 0)
  const { data: fullMatch } = useQuery({
    queryKey: ['matchFull', match?.id],
    queryFn:  async () => {
      const res = await fetch(`/api/football?apiPath=/v4/matches/${match.id}`)
      if (!res.ok) return null
      return res.json()
    },
    enabled:   needGoalsFetch,
    staleTime: 60 * 60_000,   // 1h — goals ne changent pas
  })
  const goals = match?.goals?.length ? match.goals : fullMatch?.goals ?? []

  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  const fifaRows = fifaStatsToRows(fifaData)
  const espnRows = fifaStatsToRows(espnData?.stats)   // même format { poss, shots, … }
  const aflRows  = aflStatsToRows(aflStats)
  // Priorité : FIFA → ESPN → api-football
  const rows = fifaRows.length ? fifaRows : espnRows.length ? espnRows : aflRows

  const isLoading = !rows.length && (
    (isWC && fifaLoading) || espnLoading || aflLoading
  )

  const hs  = match.score?.fullTime?.home
  const as_ = match.score?.fullTime?.away

  return (
    <div className="pm__section">
      <h3 className="pm__sectionTitle">Statistiques du match</h3>
      <div className="pm__statHeader">
        <span className="pm__statTeam">{homeName}{hs != null ? ` ${hs}` : ''}</span>
        <span />
        <span className="pm__statTeam pm__statTeam--away">{as_ != null ? `${as_} ` : ''}{awayName}</span>
      </div>

      {/* Buteurs */}
      {goals.length > 0 && (
        <GoalTimeline goals={goals} homeId={match.homeTeam?.id} />
      )}

      {/* Stats du match */}
      {isLoading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'1.5rem 0' }}>
          <div className="modal__spinner" />
        </div>
      ) : rows.length > 0 ? (
        <div className="pm__statTable">
          {rows.map(({ label, hv, av, hBetter, aBetter }) => (
            <div key={label} className="pm__statRow">
              <span className={`pm__statVal${hBetter ? ' pm__statVal--better' : ''}`}>{hv}</span>
              <span className="pm__statName">{label}</span>
              <span className={`pm__statVal pm__statVal--right${aBetter ? ' pm__statVal--better' : ''}`}>{av}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="pm__noData">Stats non disponibles</p>
      )}
    </div>
  )
}

export function PreMatchSection({ match, prono, formMap, compMatches }) {
  const homeId = match.homeTeam?.id
  const awayId = match.awayTeam?.id
  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const winner = prono
    ? (prono.home >= prono.away && prono.home >= prono.draw ? 'home'
      : prono.away >= prono.home && prono.away >= prono.draw ? 'away'
      : 'draw')
    : null

  return (
    <div className="pm__wrap">

      {/* Prono */}
      {prono && (
        <div className="pm__section">
          <h3 className="pm__sectionTitle">Probabilités estimées</h3>
          <div className="pm__pronoRow">
            <div className="pm__pronoBar">
              <div className={`pm__pronoSeg pm__pronoSeg--home${winner === 'home' ? ' pm__pronoSeg--winner' : ''}`} style={{ '--p': prono.home }}>
                {prono.home}%
              </div>
              <div className={`pm__pronoSeg pm__pronoSeg--draw${winner === 'draw' ? ' pm__pronoSeg--winner' : ''}`} style={{ '--p': prono.draw }}>
                {prono.draw}%
              </div>
              <div className={`pm__pronoSeg pm__pronoSeg--away${winner === 'away' ? ' pm__pronoSeg--winner' : ''}`} style={{ '--p': prono.away }}>
                {prono.away}%
              </div>
            </div>
          </div>
          <div className="pm__pronoNums">
            <span className={`pm__pronoNum${winner === 'home' ? ' pm__pronoNum--winner' : ''}`}>{prono.home}%<br /><small>Victoire</small></span>
            <span className={`pm__pronoNum pm__pronoNum--draw${winner === 'draw' ? ' pm__pronoNum--winner' : ''}`}>{prono.draw}%<br /><small>Nul</small></span>
            <span className={`pm__pronoNum${winner === 'away' ? ' pm__pronoNum--winner' : ''}`}>{prono.away}%<br /><small>Victoire</small></span>
          </div>
          <p className="pm__disclaimer">Basé sur la forme des 5 derniers matchs</p>
        </div>
      )}

      {/* Dernières confrontations — en premier pour voir l'historique direct */}
      <H2HSection match={match} compMatches={compMatches} />

      {/* Stats saison */}
      {compMatches?.length > 0 && (
        <SeasonStatsSection
          homeId={homeId} awayId={awayId}
          homeName={homeName} awayName={awayName}
          compMatches={compMatches}
        />
      )}

      {/* Forme récente */}
      {compMatches?.length > 0 && (
        <div className="pm__section">
          <h3 className="pm__sectionTitle">Forme récente</h3>
          <div className="pm__formGrid">
            <div className="pm__formCol">
              <p className="pm__formTeamName">{homeName}</p>
              <TeamFormTable teamId={homeId} compMatches={compMatches} isHome={true} />
            </div>
            <div className="pm__formDivider" />
            <div className="pm__formCol">
              <p className="pm__formTeamName">{awayName}</p>
              <TeamFormTable teamId={awayId} compMatches={compMatches} isHome={false} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MatchModal({ match, compId: compIdProp, onClose, defaultTab = 'stats', espnScore, formMap: formMapProp, compMatches: compMatchesProp }) {
  const isFinished = match?.status === 'FINISHED' || getMatchState(match?.id).ft === true
  const isLive     = !isFinished && (match?.status === 'IN_PLAY' || match?.status === 'PAUSED')
  const isUpcoming = !isFinished && !isLive
  const [tab, setTab]           = useState(defaultTab)
  const [preTab, setPreTab]     = useState('avant-match')
  const [tabDir, setTabDir]     = useState(null)   // 'left' | 'right' | null

  // Wrappers qui enregistrent la direction avant de changer d'onglet
  const goTab    = (t, dir)  => { setTabDir(dir);  setTab(t) }
  const goPreTab = (t, dir)  => { setTabDir(dir);  setPreTab(t) }
  const pickTab    = (t) => goTab(t, null)
  const pickPreTab = (t) => goPreTab(t, null)

  // ── Swipe entre onglets (mobile) ──────────────────────────────────────────
  const LIVE_TABS = ['livestats','compos','prono','classement']
  const PRE_TABS  = ['avant-match','compos','classement']

  const swipeLive = useSwipe(
    () => { const i = LIVE_TABS.indexOf(tab);   if (i < LIVE_TABS.length - 1) goTab(LIVE_TABS[i + 1], 'left') },
    () => { const i = LIVE_TABS.indexOf(tab);   if (i > 0) goTab(LIVE_TABS[i - 1], 'right') }
  )
  const swipePre = useSwipe(
    () => { const i = PRE_TABS.indexOf(preTab); if (i < PRE_TABS.length - 1) goPreTab(PRE_TABS[i + 1], 'left') },
    () => { const i = PRE_TABS.indexOf(preTab); if (i > 0) goPreTab(PRE_TABS[i - 1], 'right') }
  )

  // Déduire compId depuis la prop ou depuis match.competition.code
  const compId = compIdProp ?? match?.competition?.code ?? null

  // Pour les matchs à venir : charger formMap + compMatches en interne si non fournis
  const { formMap: internalFormMap, compMatches: internalCompMatches } = useTeamForm(
    isUpcoming && !formMapProp ? compId : null
  )
  const formMap     = formMapProp     ?? internalFormMap
  const compMatches = compMatchesProp ?? internalCompMatches

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

  // Prono basé sur la forme FD.org
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
          <div ref={swipeLive.ref}>
            {/* Onglets match en cours */}
            <div className="modal__tabs">
              <button
                className={`modal__tab${tab === 'livestats' ? ' modal__tab--active' : ''}`}
                onClick={() => pickTab('livestats')}
              >Stats Live</button>
              <button
                className={`modal__tab${tab === 'compos' ? ' modal__tab--active' : ''}`}
                onClick={() => pickTab('compos')}
              >Compos</button>
              {prono && (
                <button
                  className={`modal__tab${tab === 'prono' ? ' modal__tab--active' : ''}`}
                  onClick={() => pickTab('prono')}
                >Prono</button>
              )}
              <button
                className={`modal__tab${tab === 'classement' ? ' modal__tab--active' : ''}`}
                onClick={() => pickTab('classement')}
              >Classement</button>
            </div>
            <div
              key={tab}
              className={`modal__tabContent${!swipeLive.isDragging && tabDir === 'left' ? ' modal__tabContent--fromRight' : !swipeLive.isDragging && tabDir === 'right' ? ' modal__tabContent--fromLeft' : ''}`}
              style={{
                transform: swipeLive.isDragging ? `translateX(${swipeLive.dragOffset}px)` : undefined,
                transition: swipeLive.isDragging ? 'none' : undefined,
              }}
            >
              {tab === 'livestats' && <LiveStatsTab match={match} espnScore={espnScore} compMatches={compMatches} />}
              {tab === 'compos'      && <ComposTab match={match} compMatches={compMatches} />}
              {tab === 'classement'  && <ClassementTab match={match} compId={compId} />}
              {tab === 'prono'       && (
                <PronoSection
                  prono={prono}
                  homeShort={match.homeTeam?.shortName || match.homeTeam?.name}
                  awayShort={match.awayTeam?.shortName || match.awayTeam?.name}
                />
              )}
            </div>
          </div>
        ) : (
          <div ref={swipePre.ref}>
            {/* Onglets match à venir */}
            <div className="modal__tabs">
              <button
                className={`modal__tab${preTab === 'avant-match' ? ' modal__tab--active' : ''}`}
                onClick={() => pickPreTab('avant-match')}
              >Avant-match</button>
              <button
                className={`modal__tab${preTab === 'compos' ? ' modal__tab--active' : ''}`}
                onClick={() => pickPreTab('compos')}
              >Compos</button>
              <button
                className={`modal__tab${preTab === 'classement' ? ' modal__tab--active' : ''}`}
                onClick={() => pickPreTab('classement')}
              >Classement</button>
            </div>
            <div
              key={preTab}
              className={`modal__tabContent${!swipePre.isDragging && tabDir === 'left' ? ' modal__tabContent--fromRight' : !swipePre.isDragging && tabDir === 'right' ? ' modal__tabContent--fromLeft' : ''}`}
              style={{
                transform: swipePre.isDragging ? `translateX(${swipePre.dragOffset}px)` : undefined,
                transition: swipePre.isDragging ? 'none' : undefined,
              }}
            >
              {preTab === 'avant-match' && (
                <PreMatchSection
                  match={match}
                  prono={prono}
                  formMap={formMap}
                  compMatches={compMatches}
                />
              )}
              {preTab === 'compos'      && <ComposTab match={match} compMatches={compMatches} />}
              {preTab === 'classement'  && <ClassementTab match={match} compId={compId} />}
            </div>
          </div>
        )}

      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

export default MatchModal
