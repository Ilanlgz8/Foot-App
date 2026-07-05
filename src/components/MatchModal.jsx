import { useEffect, useState }      from 'react'
import { createPortal }            from 'react-dom'
import { useQuery }                from '@tanstack/react-query'
import { useMatchDetail, useLineups, useFifaStats, useH2H, useEspnMatchStats, useProbableLineups, useFdLineups } from '../hooks/useMatchDetail'
import { useTeamForm } from '../hooks/useTeamForm'
import { useEspnMatchDetail }  from '../hooks/useEspnMatchDetail'
import { useAflLiveStats, useAflLineups, useAflMatchStats, useAflProbableLineups } from '../hooks/useApiFootball'
import LineupPitch             from './LineupPitch'
import { StandingsTable }     from './StandingsTable'
import { useStandings }       from '../hooks/useStandings'
import { useSwipe }           from '../hooks/useSwipe'
import { translateTeam }       from '../data/teamNames'
import { getMatchState, getLiveState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, matchOutcome } from '../utils/matchUtils'
import { calcLiveProno } from '../utils/calcProno'
import { recordProbaSample } from '../utils/probaCurve'
import { getMatchThemeVars, getMatchTeamColors } from '../data/teamPhotos'
import './../matchModal.css'

// ── Lecture des données ESPN persistées au moment du FT ──────────────────────
// Sauvegardées par useLiveMinute dans foot_espn_{matchId} lors de la détection FT.
export function getEspnData(matchId) {
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
export function ESPNScorers({ scorers = [] }) {
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
// Design "table minimaliste" : une ligne par stat, valeur dom. à gauche,
// libellé au centre, valeur ext. à droite — la valeur la plus haute est
// mise en avant (couleur + gras). Remplace l'ancienne barre de progression
// (jugée trop chargée par rapport à ce format plus lisible d'un coup d'œil).
function StatBar({ homeVal, awayVal, label }) {
  const hNum = parseFloat(homeVal)
  const aNum = parseFloat(awayVal)
  const hasNums   = !Number.isNaN(hNum) && !Number.isNaN(aNum)
  const homeLeads = hasNums && hNum > aNum
  const awayLeads = hasNums && aNum > hNum
  return (
    <div className="modal__statTableRow">
      <span className={`modal__statTableVal${homeLeads ? ' modal__statTableVal--home' : ''}`}>{homeVal ?? '–'}</span>
      <span className="modal__statTableLabel">{label}</span>
      <span className={`modal__statTableVal modal__statTableVal--right${awayLeads ? ' modal__statTableVal--away' : ''}`}>{awayVal ?? '–'}</span>
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

// ── Skeletons de chargement — remplacent les anciens spinners "Chargement…"
// par des placeholders qui reprennent la forme exacte du contenu final
// (mêmes classes CSS que le contenu réel), avec le shimmer .sk déjà utilisé
// dans Classement.jsx/Resultat.jsx. Perçu comme plus premium et évite le
// petit "saut" de layout au moment où le vrai contenu apparaît. ──────────────
function StatsSkeleton() {
  return (
    <div className="modal__espnStats">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="modal__statTableRow">
          <div className="sk" style={{ width: '1.6rem', height: '0.9rem', marginLeft: 'auto' }} />
          <div className="sk" style={{ width: '4.4rem', height: '0.6rem' }} />
          <div className="sk" style={{ width: '1.6rem', height: '0.9rem' }} />
        </div>
      ))}
    </div>
  )
}

function CompsSkeleton() {
  const rows = [1, 4, 3, 3]
  return (
    <div className="pitch__sk">
      {['home', 'away'].map(side => (
        <div key={side} className={`pitch__skHalf pitch__skHalf--${side}`}>
          {rows.map((n, ri) => (
            <div key={ri} className="pitch__skRow">
              {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="sk pitch__skDot" />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ClassementSkeleton({ rows = 6 }) {
  return (
    <div className="classement__tableWrap">
      <table className="classement__table">
        <thead>
          <tr>
            <th>Pos</th><th>Équipe</th><th>MJ</th><th>Pts</th>
            <th>V</th><th>N</th><th>D</th><th>Diff</th><th>BM</th><th>Forme</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i} className="classement__row">
              <td><div className="sk" style={{ width: '1.2rem', height: '0.8rem' }} /></td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="sk" style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%', flexShrink: 0 }} />
                  <div className="sk" style={{ width: `${5 + (i % 3)}rem`, height: '0.8rem' }} />
                </div>
              </td>
              {Array.from({ length: 7 }).map((_, j) => (
                <td key={j}><div className="sk" style={{ width: '1.5rem', height: '0.8rem', margin: '0 auto' }} /></td>
              ))}
              <td>
                <div style={{ display: 'flex', gap: '0.2rem' }}>
                  {Array.from({ length: 5 }).map((_, k) => (
                    <div key={k} className="sk" style={{ width: '1.35rem', height: '1.35rem', borderRadius: '0.3rem' }} />
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EventsSkeleton() {
  return (
    <div className="modal__stats">
      <div className="modal__statsCol modal__statsCol--home">
        {[60, 45].map((w, i) => (
          <div key={i} className="modal__goalRow">
            <div className="sk" style={{ width: `${w}%`, height: '0.7rem' }} />
            <div className="sk" style={{ width: '1.4rem', height: '0.6rem' }} />
          </div>
        ))}
      </div>
      <div className="modal__statsDivider" />
      <div className="modal__statsCol modal__statsCol--away">
        {[50, 65].map((w, i) => (
          <div key={i} className="modal__goalRow modal__goalRow--away">
            <div className="sk" style={{ width: '1.4rem', height: '0.6rem' }} />
            <div className="sk" style={{ width: `${w}%`, height: '0.7rem' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function PmStatsSkeleton() {
  const widths = [40, 65, 30, 50, 35]
  return (
    <div className="pm__statTable">
      {widths.map((w, i) => (
        <div key={i} className="pm__statRow">
          <div className="sk" style={{ width: '1.6rem', height: '0.85rem', marginLeft: 'auto' }} />
          <div className="sk" style={{ width: '4.2rem', height: '0.56rem' }} />
          <div className="sk" style={{ width: '1.6rem', height: '0.85rem' }} />
        </div>
      ))}
    </div>
  )
}

function H2HSkeleton() {
  return (
    <div className="h2h__list">
      {[0, 1, 2].map(i => (
        <div key={i} className="h2h__row">
          <div className="h2h__matchup">
            <div className="h2h__side h2h__side--home">
              <div className="sk" style={{ width: '4.5rem', height: '0.72rem' }} />
              <div className="sk h2h__crestWrap" style={{ borderRadius: '22%' }} />
            </div>
            <div className="h2h__scoreBlock">
              <div className="sk" style={{ width: '2.2rem', height: '0.5rem' }} />
              <div className="sk" style={{ width: '2rem', height: '0.9rem' }} />
            </div>
            <div className="h2h__side h2h__side--away">
              <div className="sk h2h__crestWrap" style={{ borderRadius: '22%' }} />
              <div className="sk" style={{ width: '4.5rem', height: '0.72rem' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Timeline des buts FD.org (fallback) ──────────────────────────────────────
export function GoalTimeline({ goals = [], homeId }) {
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

// ── Fil du match : buts + cartons + remplacements, triés par minute ──────────
// Buts/cartons : ESPN en priorité (matchs suivis en live ou re-fetchés à la
// demande — voir useEspnMatchDetail.js/api/fifa-live.js), fallback FD.org.
// Remplacements : FD.org uniquement — ESPN n'expose aucune donnée de
// remplacement dans son scoreboard/summary soccer (vérifié, aucune occurrence
// avec 2+ athlètes dans details[]/plays[] sur plusieurs matchs réels testés).
function minuteSort(raw) {
  if (raw == null) return 9999
  const m = String(raw).match(/(\d+)(?:[+:](\d+))?/)
  if (!m) return 9999
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 100 : 0)
}

function espnMinuteLabel(raw) {
  const base = String(raw ?? '').split(':')[0]
  return base ? `${base}'` : (raw || '')
}

// Exportée : réutilisée par MatchPage.jsx pour fusionner buts + cartons dans
// le hero (au lieu de n'y afficher que les buts), triés par minute — même
// logique que le Fil du match, sans dupliquer le parsing des minutes.
export function buildMatchEvents({ espnScorers = [], espnCards = [], fdGoals = [], fdBookings = [], fdSubs = [], homeId }) {
  const events = { home: [], away: [] }
  let k = 0

  if (espnScorers.length > 0) {
    espnScorers.forEach(s => {
      const suffix = s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''
      events[s.team === 'home' ? 'home' : 'away'].push({
        key: `e${k++}`, sort: minuteSort(s.minute), minute: espnMinuteLabel(s.minute),
        icon: '⚽', name: `${s.name}${suffix}`,
      })
    })
  } else {
    fdGoals.forEach(g => {
      const isHome = g.team?.id === homeId
      const suffix = g.type === 'OWN_GOAL' ? ' (csc)' : g.type === 'PENALTY' ? ' (pen)' : ''
      events[isHome ? 'home' : 'away'].push({
        key: `e${k++}`, sort: minuteSort(g.minute), minute: g.minute ? `${g.minute}'` : '',
        icon: '⚽', name: `${g.scorer?.shortName ?? g.scorer?.name ?? '?'}${suffix}`,
      })
    })
  }

  if (espnCards.length > 0) {
    espnCards.forEach(c => {
      events[c.team === 'home' ? 'home' : 'away'].push({
        key: `e${k++}`, sort: minuteSort(c.minute), minute: espnMinuteLabel(c.minute),
        icon: c.red ? '🟥' : '🟨', name: c.name,
      })
    })
  } else {
    fdBookings.forEach(b => {
      const isHome = b.team?.id === homeId
      const isRed  = b.card === 'RED_CARD' || b.card === 'YELLOW_RED_CARD'
      events[isHome ? 'home' : 'away'].push({
        key: `e${k++}`, sort: minuteSort(b.minute), minute: b.minute ? `${b.minute}'` : '',
        icon: isRed ? '🟥' : '🟨', name: b.player?.shortName ?? b.player?.name ?? '?',
      })
    })
  }

  fdSubs.forEach(s => {
    const isHome = s.team?.id === homeId
    events[isHome ? 'home' : 'away'].push({
      key: `e${k++}`, sort: minuteSort(s.minute), minute: s.minute ? `${s.minute}'` : '',
      icon: '🔁', name: `${s.playerIn?.shortName ?? s.playerIn?.name ?? '?'} ↔ ${s.playerOut?.shortName ?? s.playerOut?.name ?? '?'}`,
    })
  })

  events.home.sort((a, b) => a.sort - b.sort)
  events.away.sort((a, b) => a.sort - b.sort)
  return events
}

export function MatchTimeline({ espnScorers, espnCards, fdGoals, fdBookings, fdSubs, homeId }) {
  const { home, away } = buildMatchEvents({ espnScorers, espnCards, fdGoals, fdBookings, fdSubs, homeId })
  if (home.length === 0 && away.length === 0) return null

  return (
    <div className="modal__stats">
      <div className="modal__statsCol modal__statsCol--home">
        {home.map(e => (
          <div key={e.key} className="modal__goalRow">
            <span className="modal__goalName">{e.name}</span>
            <span className="modal__goalMeta">{e.minute}</span>
            <span className="modal__goalIcon" aria-hidden="true">{e.icon}</span>
          </div>
        ))}
      </div>
      <div className="modal__statsDivider" />
      <div className="modal__statsCol modal__statsCol--away">
        {away.map(e => (
          <div key={e.key} className="modal__goalRow modal__goalRow--away">
            <span className="modal__goalIcon" aria-hidden="true">{e.icon}</span>
            <span className="modal__goalMeta">{e.minute}</span>
            <span className="modal__goalName">{e.name}</span>
          </div>
        ))}
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

// ── Jauge de dangerosité en direct ("pression du moment") ──────────────────
// Complémentaire à LivePulse (qui répond à "qui les fans pensent voir
// gagner") : celle-ci répond à "qui pousse LÀ maintenant", à partir des
// mêmes stats déjà affichées (tirs/tirs cadrés/corners) — voir
// utils/dangerMeter.js pour la logique de decay/momentum.


// function DangerMeter({ matchId, stats, homeShort, awayShort }) {
//   const result = updateDangerMeter(matchId, stats)
//   if (!result) return null
//   const { homePct, awayPct, hasSignal } = result

//   return (
//     <div className="danger">
//       <p className="danger__title">Pression du moment</p>
//       <div className="danger__bar">
//         <div className="danger__seg danger__seg--home" style={{ '--danger-w': homePct }} />
//         <div className="danger__seg danger__seg--away" style={{ '--danger-w': awayPct }} />
//       </div>
//       <div className="danger__labels">
//         <span>{homeShort}{hasSignal && homePct >= 65 ? ' 🔥' : ''}</span>
//         <span>{awayShort}{hasSignal && awayPct >= 65 ? ' 🔥' : ''}</span>
//       </div>
//       {!hasSignal && <p className="danger__hint">En attente d'occasions…</p>}
//     </div>
//   )
// }

// Convertit les stats api-football (statisticsItems) vers le même format
// normalisé {home:{shots,shotsOnTarget,corners}, away:{...}} que ESPN/FIFA,
// pour que DangerMeter fonctionne aussi sur ce fallback.
function extractAflDangerStats(statsData) {
  const allPeriod = statsData?.statistics?.find(s => s.period === 'ALL')
  const items = allPeriod?.groups?.flatMap(g => g.statisticsItems ?? []) ?? []
  const find = (name) => items.find(i => i.name === name)
  const shots = find('Total shots'), onTarget = find('Shots on target'), corners = find('Corner kicks')
  if (!shots && !onTarget && !corners) return null
  return {
    home: { shots: shots?.home ?? null, shotsOnTarget: onTarget?.home ?? null, corners: corners?.home ?? null },
    away: { shots: shots?.away ?? null, shotsOnTarget: onTarget?.away ?? null, corners: corners?.away ?? null },
  }
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

export function LiveStatsTab({ match, espnScore, homeShort, awayShort, compMatches }) {
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

  // Stats normalisées {home:{shots,shotsOnTarget,corners}, away:{...}} —
  // quelle que soit la source active (ESPN scoreboard/FIFA/ESPN summary/
  // api-football) — pour alimenter DangerMeter avec les mêmes chiffres déjà
  // affichés dans ESPNStats, sans dupliquer les appels de fetch.
  const activeStats = hasEspn ? espnScore.stats
    : (isFifaMatch && fifaStats) ? fifaStats
    : summaryStats ? summaryStats
    : extractAflDangerStats(statsData)

  // Jauge de dangerosité, affichée en haut du tab stats — le pronostic des
  // fans (LivePulse) est affiché plus haut, au niveau de la modale/page
  // entière (pas dupliqué ici), voir MatchModal/LiveMatchPage.
  const dangerBlock = isLive ? (
    <div style={{ marginBottom: '0.25rem' }}>
      <DangerMeter
        matchId={match.id}
        stats={activeStats}
        homeShort={homeShort || homeName}
        awayShort={awayShort || awayName}
      />
    </div>
  ) : null

  // H2H affiché en bas pour matchs terminés (pas en live pour ne pas alourdir)
  const h2hBlock = !isLive ? <H2HSection match={match} compMatches={compMatches} /> : null

  // ── Priorité 1 : ESPN scoreboard stats (rarement dispo, mais gardé) ──
  if (hasEspn) {
    return (
      <div>
        {dangerBlock}
        <ESPNStats stats={espnScore.stats} />
        {espnScore.scorers?.length > 0 && <ESPNScorers scorers={espnScore.scorers} />}
        {h2hBlock}
      </div>
    )
  }

  // ── Priorité 2 : Stats FIFA live (WC 2026) ──
  if (isFifaMatch) {
    if (fifaStatsLoading) {
      return <StatsSkeleton />
    }
    return (
      <div>
        {dangerBlock}
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
        {dangerBlock}
        <ESPNStats stats={summaryStats} />
        {espnScore?.scorers?.length > 0 && <ESPNScorers scorers={espnScore.scorers} />}
        {h2hBlock}
      </div>
    )
  }

  // Loading ESPN summary
  if (summaryLoading && hasEspnId) {
    return <StatsSkeleton />
  }

  // ── Priorité 4 : Fallback api-football ──
  const allPeriod = statsData?.statistics?.find(s => s.period === 'ALL')
  const items     = allPeriod?.groups?.flatMap(g => g.statisticsItems ?? []) ?? []
  const rows      = STAT_KEYS
    .map(k => items.find(item => item.name === k))
    .filter(Boolean)

  if (aflLoading && rows.length === 0) {
    return <StatsSkeleton />
  }

  return (
    <div>
      {dangerBlock}
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

// ── Stats saison — agrégées depuis les matchs terminés de la compétition ─────
// Partagé entre LiveMatchPage (sous-onglet "Stats saison") et MatchPage pour
// un match terminé (même sous-onglet). Logique identique à MpSeasonStats
// (MatchPage.jsx, utilisé pour les matchs à venir) mais exportée ici pour
// être réutilisable sans dupliquer le calcul dans LiveMatchPage.
function calcSeasonTeamStats(teamId, compMatches) {
  const matches = (compMatches ?? []).filter(
    m => m.status === 'FINISHED' && (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId)
  )
  if (!matches.length) return null
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, cs = 0, btts = 0, over25 = 0
  matches.forEach(m => {
    const myHome = m.homeTeam?.id === teamId
    const fs = finalScore(m.score)
    const f = myHome ? fs.home : fs.away
    const a = myHome ? fs.away : fs.home
    if (f == null || a == null) return
    gf += f; ga += a
    if (a === 0) cs++
    if (f > 0 && a > 0) btts++
    if (f + a >= 3) over25++
    // Aux tirs au but, le score 120min (f/a) est TOUJOURS à égalité : le vrai
    // résultat vient de score.penalties (même convention que FormDiamonds).
    if (m.score?.duration === 'PENALTY_SHOOTOUT' &&
        m.score?.penalties?.home != null && m.score?.penalties?.away != null) {
      const myPens  = myHome ? m.score.penalties.home : m.score.penalties.away
      const oppPens = myHome ? m.score.penalties.away : m.score.penalties.home
      if (myPens > oppPens) wins++; else losses++
    } else if (f > a) wins++
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
    over25Pct:  Math.round((over25 / played) * 100),
    cs,
  }
}

export function SeasonStatsTab({ match, compMatches }) {
  const homeId = match?.homeTeam?.id
  const awayId = match?.awayTeam?.id
  const h = calcSeasonTeamStats(homeId, compMatches)
  const a = calcSeasonTeamStats(awayId, compMatches)

  if (!h && !a) {
    return <p className="modal__noEvents">Stats saison non disponibles</p>
  }

  const rows = [
    { label: 'Buts marqués / match',    hv: h?.avgFor,                 av: a?.avgFor },
    { label: 'Buts encaissés / match',  hv: h?.avgAgainst,             av: a?.avgAgainst },
    { label: '% Victoires',             hv: h ? `${h.winPct}%` : null, av: a ? `${a.winPct}%` : null },
    { label: 'Clean sheets',            hv: h?.cs,                     av: a?.cs },
    { label: 'Les 2 équipes marquent %',hv: h ? `${h.bttsPct}%` : null,av: a ? `${a.bttsPct}%` : null },
    { label: '+2.5 buts %',             hv: h ? `${h.over25Pct}%` : null, av: a ? `${a.over25Pct}%` : null },
  ].filter(r => r.hv != null || r.av != null)

  const homeName = translateTeam(match?.homeTeam?.shortName || match?.homeTeam?.name || '?')
  const awayName = translateTeam(match?.awayTeam?.shortName || match?.awayTeam?.name || '?')

  return (
    <div className="modal__espnStats">
      {rows.map(r => (
        <StatBar key={r.label} label={r.label} homeVal={r.hv ?? '–'} awayVal={r.av ?? '–'} />
      ))}

      {/* Forme récente — même bloc que l'onglet "Avant-match" (TeamFormTable),
          manquant ici avant : dernier match joué de chaque équipe avec le score,
          W/D/L et la date. */}
      {compMatches?.length > 0 && (
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

// ── Sous-onglets "Stats live" / "Stats saison" — utilisé dans LiveMatchPage
// et MatchPage (match terminé) au sein de l'onglet principal "Statistiques".
export function StatsSubTabs({ view, onChange }) {
  return (
    <div className="statsSubTabs">
      <button
        className={`statsSubTabs__btn${view === 'live' ? ' statsSubTabs__btn--active' : ''}`}
        onClick={() => onChange('live')}
      >
        Stats live
      </button>
      <button
        className={`statsSubTabs__btn${view === 'saison' ? ' statsSubTabs__btn--active' : ''}`}
        onClick={() => onChange('saison')}
      >
        Stats saison
      </button>
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

  // Source 2 : football-data.org (via useMatchDetail déjà fetchée — zéro quota)
  // /v4/matches/{id} retourne homeTeam.lineup + awayTeam.lineup + formation
  // ⚠️ Avant, limité aux matchs TERMINÉS (isFinished ? match : null) — or
  // FD.org publie souvent la compo dès le coup d'envoi, pas seulement après.
  // Ce gate privait les matchs EN DIRECT de cette source gratuite (déjà
  // fetchée par useMatchDetail, zéro coût), alors que c'est justement en
  // direct que FIFA (cache lazy, pas toujours peuplé) et ESPN (rosters
  // incomplets pour la CM) peuvent être vides — probable cause du "pas de
  // compo même en direct" : on perdait un filet de sécurité gratuit.
  const { data: fdLineups, isLoading: fdLoading } = useFdLineups(match)

  // Source 3 : api-football
  // WC : en parallèle (ESPN/FIFA souvent vides sans cron)
  // Non-WC : seulement après échec ESPN (économie quota)
  const espnOrFdHasData = espnHasData || fdLineups?.home?.starters?.length
  const { data: aflLineups, isLoading: aflLoading } = useAflLineups(
    isWC ? match : (espnDone && !espnOrFdHasData ? match : null)
  )

  // Source 3a : probables via ESPN (dernier XI connu de chaque équipe).
  // Avant : limité aux matchs pas encore terminés (isUpcoming) — un match déjà
  // fini dont la vraie compo n'a jamais pu être récupérée (FIFA/ESPN/FD.org/
  // api-football tous vides) affichait "Compos non disponibles" au lieu du
  // dernier XI connu, alors que rien n'empêche de l'utiliser aussi après coup
  // (demande explicite : "éviter de rien afficher"). Toujours activé — ne
  // s'affiche de toute façon que si `lineups` (Source 1/2/3) est vide, voir
  // plus bas.
  const { data: probableData, isLoading: probableLoading } = useProbableLineups(
    match,
    compMatches
  )

  // Source 3b : probables via api-football (fallback si ESPN vide) — même
  // changement que Source 3a.
  const { data: aflProbableData, isLoading: aflProbableLoading } = useAflProbableLineups(
    match,
    compMatches
  )

  const isLoading = espnLoading || espnMatchLoading
    || (!espnHasData && fdLoading)
    || (!espnHasData && !fdLineups?.home?.starters?.length && aflLoading)
    || probableLoading
    || (!probableData && aflProbableLoading)

  // api-football fournit un `grid` ("ligne:colonne") par titulaire — une
  // coordonnée exacte propre à CE match (jamais périmée), contrairement au
  // champ "poste" d'ESPN/FD.org qui reflète le profil général du joueur et
  // peut être faux (cause des inversions DC/DG constatées). Quand ce grid
  // est complet pour les deux équipes (WC uniquement, où api-football est
  // fetché en parallèle), on le préfère à ESPN pour un placement fiable.
  const gridRe   = /^\d+:\d+$/
  const aflGridOk = isWC
    && aflLineups?.home?.starters?.length && aflLineups?.away?.starters?.length
    && [...aflLineups.home.starters, ...aflLineups.away.starters].every(p => gridRe.test(p.grid ?? ''))

  const lineups = aflGridOk                                        ? aflLineups
               : espnLineups?.home?.starters?.length           ? espnLineups
               : espnMatchData?.lineups?.home?.starters?.length ? espnMatchData.lineups
               : fdLineups?.home?.starters?.length              ? fdLineups
               : aflLineups?.home?.starters?.length             ? aflLineups
               : null

  const probSource = probableData ?? aflProbableData ?? null
  // Il faut que LES DEUX équipes aient un XI probable résolu — sinon (ex: le
  // dernier match connu de l'équipe away n'a pas pu être retrouvé), l'ancien
  // fallback `probable.away ?? probable.home` affichait l'équipe home des
  // DEUX côtés (bug rapporté : "Suisse" ou "Maroc" affiché deux fois).
  // Mieux vaut ne rien afficher (→ état "Compos non disponibles" plus bas)
  // que d'afficher une compo fausse.
  const probable = !lineups && probSource?.home?.starters?.length && probSource?.away?.starters?.length
    ? probSource
    : null

  if (isLoading) {
    return <CompsSkeleton />
  }

  // Enrichit les objets lineup avec les crests du match (non inclus dans l'API ESPN roster)
  const homeCrest = match?.homeTeam?.crest ?? null
  const awayCrest = match?.awayTeam?.crest ?? null
  const withCrest = (obj, crest) => obj ? { ...obj, crest } : obj
  // isWC déjà calculé plus haut dans ce composant (voir usage useLineups ci-dessus)

  // Couleurs dynamiques des vraies équipes (même logique anti-collision que le
  // hero/LivePulse/DangerMeter) — remplace le rouge fixe pour les deux équipes.
  const { home: pitchHome, away: pitchAway } = getMatchTeamColors(match?.homeTeam?.name, match?.awayTeam?.name)

  if (lineups) {
    return (
      <div style={{ padding: '8px 0 0' }}>
        <LineupPitch
          home={withCrest(lineups.home, homeCrest)}
          away={withCrest(lineups.away, awayCrest)}
          isCountry={isWC}
          hColor={pitchHome.main}
          aColor={pitchAway.main}
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
            away={withCrest(probable.away, awayCrest)}
            isCountry={isWC}
            hColor={pitchHome.main}
            aColor={pitchAway.main}
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
    return <div style={{ padding: '4px 0' }}><ClassementSkeleton /></div>
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
            <StandingsTable rows={g.table} compact={false} formMap={formMap} qualificationRules={rules} isCountry={compId === 'WC'} />
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
      <StandingsTable rows={standings} formMap={formMap} qualificationRules={rules} isCountry={compId === 'WC'} />
    </div>
  )
}

// ── Section détails match terminé ────────────────────────────────────────────
// Priorité ESPN (persisté en localStorage au FT) → fallback FD.org
function FinishedDetails({ match, espnData, detail, loading }) {
  const homeId     = match.homeTeam?.id
  const fsFinished = finalScore(match.score)
  const totalGoals = (fsFinished.home ?? 0) + (fsFinished.away ?? 0)

  const fdGoals     = detail?.goals         ?? []
  const fdBookings  = detail?.bookings      ?? []
  const fdSubs      = detail?.substitutions ?? []
  const espnScorers = espnData?.scorers ?? []
  const espnCards   = espnData?.cards   ?? []

  // ESPN scoreboard ne retourne pas toujours les détails de buts pour les matchs passés.
  // On considère ESPN "utile" seulement s'il a des buteurs OU des stats.
  const espnHasData = espnScorers.length > 0 || !!espnData?.stats

  // Skeleton : on attend si aucune source n'a encore répondu
  const hasAnyData = espnHasData || fdGoals.length > 0 || !!detail
  if (loading && !hasAnyData) {
    return <EventsSkeleton />
  }

  const hasEvents = espnScorers.length > 0 || espnCards.length > 0 ||
    fdGoals.length > 0 || fdBookings.length > 0 || fdSubs.length > 0

  return (
    <>
      {/* ── Fil du match : buts + cartons + remplacements ── */}
      {hasEvents
        ? <MatchTimeline
            espnScorers={espnScorers} espnCards={espnCards}
            fdGoals={fdGoals} fdBookings={fdBookings} fdSubs={fdSubs}
            homeId={homeId}
          />
        : !loading
          ? <p className="modal__noEvents">
              {totalGoals > 0 ? 'Événements non disponibles' : 'Match sans but (0 – 0)'}
            </p>
          : null   // FD.org charge encore, on n'affiche pas le message trop tôt
      }

      {/* ── Stats ESPN si disponibles ── */}
      {espnData?.stats && <ESPNStats stats={espnData.stats} />}
    </>
  )
}


// ── Indicateur de pages (dots) sous les onglets swipables ────────────────────
// Signale visuellement que l'onglet actif fait partie d'un groupe swipable.
export function TabDots({ count, active }) {
  if (!count || count <= 1) return null
  return (
    <div className="tabDots">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className={`tabDots__dot${i === active ? ' tabDots__dot--active' : ''}`} />
      ))}
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

export function TeamFormTable({ teamId, compMatches }) {
  // compMatches (FD.org) est trié du plus ancien au plus récent → slice(-5)
  // garde les 5 derniers, puis reverse() pour afficher le dernier match joué
  // tout en haut (même convention que H2HSection juste au-dessus).
  const matches = (compMatches ?? [])
    .filter(m => m.status === 'FINISHED' && (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId))
    .slice(-5)
    .reverse()

  if (!matches.length) return <p className="pm__noData">Pas de données</p>

  return (
    <div className="pm__formTable">
      {matches.map((m, i) => {
        const myHome  = m.homeTeam?.id === teamId
        const fsRow   = finalScore(m.score)
        const hs      = fsRow.home ?? '-'
        const as_     = fsRow.away ?? '-'
        const myGoals  = myHome ? hs : as_
        const oppGoals = myHome ? as_ : hs
        // Score 120min (finalScore) : un match décidé aux tirs au but y est
        // TOUJOURS à égalité, le vrai W/D/L vient de penalties.
        const wentToPens = m.score?.duration === 'PENALTY_SHOOTOUT'
        const hp = m.score?.penalties?.home ?? null
        const ap = m.score?.penalties?.away ?? null
        let result
        if (wentToPens && hp != null && ap != null) {
          const myPens  = myHome ? hp : ap
          const oppPens = myHome ? ap : hp
          result = myPens > oppPens ? 'W' : myPens < oppPens ? 'L' : 'D'
        } else {
          result = myGoals > oppGoals ? 'W' : myGoals < oppGoals ? 'L' : 'D'
        }
        const hName   = translateTeam(m.homeTeam?.shortName || m.homeTeam?.name || '?')
        const aName   = translateTeam(m.awayTeam?.shortName || m.awayTeam?.name || '?')
        const date    = new Date(m.utcDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
        return (
          <div key={i} className="pm__formRow">
            <ResultBadge result={result} />
            <span className="pm__formMatchup">
              <span className={`pm__formTeam${myHome ? ' pm__formTeam--me' : ''}`}>{hName}</span>
              <span className="pm__formScore">
                <span className="pm__formScoreMain">{hs}:{as_}</span>
                {wentToPens && hp != null && ap != null && (
                  <span className="pm__formPens">
                    <span className="pm__formPensLabel">T.A.B</span>
                    <span className="pm__formPensScore">({hp}-{ap})</span>
                  </span>
                )}
              </span>
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
    const fs = finalScore(m.score)
    const f = myHome ? fs.home : fs.away
    const a = myHome ? fs.away : fs.home
    if (f == null || a == null) return
    gf += f; ga += a
    if (a === 0) cs++
    if (f > 0 && a > 0) btts++
    if (f + a >= 3) over25++
    // Score 120min (finalScore) : un match décidé aux tirs au but y est
    // TOUJOURS à égalité, le vrai W/D/L vient de score.penalties (sans ça, une
    // victoire aux tab comptait comme un nul dans les stats/série).
    let outcome
    if (m.score?.duration === 'PENALTY_SHOOTOUT') {
      const hp = m.score?.penalties?.home ?? null
      const ap = m.score?.penalties?.away ?? null
      const myPens  = hp != null && ap != null ? (myHome ? hp : ap) : null
      const oppPens = hp != null && ap != null ? (myHome ? ap : hp) : null
      outcome = myPens != null && oppPens != null
        ? (myPens > oppPens ? 'W' : myPens < oppPens ? 'L' : 'D')
        : (f > a ? 'W' : f === a ? 'D' : 'L')
    } else {
      outcome = f > a ? 'W' : f === a ? 'D' : 'L'
    }
    if (outcome === 'W') { wins++; results.push('W') }
    else if (outcome === 'D') { draws++; results.push('D') }
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
              <span className={`pm__statVal${hBetter ? ' pm__statVal--better pm__statVal--better--home' : ''}`}>{hv ?? '–'}</span>
              <span className="pm__statName">{label}</span>
              <span className={`pm__statVal pm__statVal--right${aBetter ? ' pm__statVal--better pm__statVal--better--away' : ''}`}>{av ?? '–'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Évolution du rapport de force sur l'historique H2H disponible, dans l'ordre
// chronologique (plus ancien à gauche → plus récent à droite). Basée sur
// matchOutcome() (même règle de départage tab que le reste de l'app :
// H2HSection, useTeamForm.js) pour ne pas dupliquer cette logique. Perspective
// fixe = l'équipe qui reçoit aujourd'hui, peu importe qui recevait à l'époque.
// Même technique (SVG polyline à la main) que ProbaCurve.jsx — pas de lib de
// graphique pour un seul tracé.
function H2HTrend({ rows, homeId, homeShort, awayShort }) {
  const chrono = rows.slice().reverse() // rows = plus récent d'abord → on repasse en ordre chronologique
  if (chrono.length < 3) return null // pas assez de points pour qu'une tendance ait un sens

  const toValue = (m) => {
    const outcome = matchOutcome(m)
    if (outcome === 'draw') return 50
    const wasHomeToday = m.homeTeam?.id === homeId
    const homeWonThatMatch = outcome === 'home'
    return wasHomeToday === homeWonThatMatch ? 100 : 0
  }

  const width  = 100
  const height = 32
  const n = chrono.length
  const toX = (i) => n === 1 ? width / 2 : (i / (n - 1)) * width
  const toY = (v) => height - (v / 100) * height
  const points = chrono.map((m, i) => `${toX(i).toFixed(1)},${toY(toValue(m)).toFixed(1)}`).join(' ')

  return (
    <div className="h2h__trend">
      <p className="h2h__trendTitle">Évolution du rapport de force</p>
      <svg className="h2h__trendSvg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} className="h2h__trendMid" vectorEffect="non-scaling-stroke" />
        <polyline points={points} className="h2h__trendLine" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="h2h__trendLegend">
        <span className="h2h__trendLegendItem h2h__trendLegendItem--home">{homeShort}</span>
        <span className="h2h__trendLegendItem h2h__trendLegendItem--away">{awayShort}</span>
      </div>
    </div>
  )
}

function H2HSection({ match, compMatches }) {
  const { data: h2hMatches, isLoading } = useH2H(match)
  const isWC = match?.competition?.code === 'WC' || match?.competition?.id === 2000

  const homeId = match.homeTeam?.id
  const awayId = match.awayTeam?.id

  // Données FD.org (du plus récent au plus vieux). Pas de troncature
  // arbitraire ici : on affiche tout ce que l'API renvoie réellement pour ce
  // duo d'équipes plutôt que de promettre un nombre fixe — football-data.org
  // ne documente pas de garantie sur la profondeur de son historique H2H
  // (parfois 2 confrontations, parfois une dizaine selon les équipes).
  const fdRecent = (h2hMatches ?? [])
    .filter(m => m.status === 'FINISHED')
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

  // Aucune confrontation connue (une fois le chargement terminé) → on masque
  // toute la section plutôt que d'afficher un titre suivi d'un texte "vide".
  if (!isLoading && !rows.length) return null

  const homeShort = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayShort = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  return (
    <div className="pm__section">
      <h3 className="pm__sectionTitle">Historique des confrontations</h3>
      {isLoading ? (
        <H2HSkeleton />
      ) : (
        <>
          <H2HTrend rows={rows} homeId={homeId} homeShort={homeShort} awayShort={awayShort} />
          <div className="h2h__list">
          {rows.map((m, i) => {
            const isHomeTeam = m.homeTeam?.id === homeId
            const fsH2H = finalScore(m.score)
            const hs = fsH2H.home ?? '-'
            const as_ = fsH2H.away ?? '-'
            const date = new Date(m.utcDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
            const myGoals  = isHomeTeam ? hs : as_
            const oppGoals = isHomeTeam ? as_ : hs
            // Score 120min (finalScore) : à égalité par définition si le match est allé aux tab.
            const wentToPens = m.score?.duration === 'PENALTY_SHOOTOUT'
            const hp = m.score?.penalties?.home ?? null
            const ap = m.score?.penalties?.away ?? null
            let result
            if (wentToPens && hp != null && ap != null) {
              const myPens  = isHomeTeam ? hp : ap
              const oppPens = isHomeTeam ? ap : hp
              result = myPens > oppPens ? 'W' : myPens < oppPens ? 'L' : 'D'
            } else {
              result = myGoals > oppGoals ? 'W' : myGoals < oppGoals ? 'L' : 'D'
            }
            const resultClass = result === 'W' ? 'h2h__row--w' : result === 'L' ? 'h2h__row--l' : 'h2h__row--d'
            return (
              <div key={i} className={`h2h__row ${resultClass}`}>
                <div className="h2h__matchup">
                  <div className="h2h__side h2h__side--home">
                    <span className="h2h__team">{translateTeam(m.homeTeam?.shortName || m.homeTeam?.name || '?')}</span>
                    {m.homeTeam?.crest && (
                      <span className="h2h__crestWrap" data-crest={isWC ? 'country' : 'club'}>
                        <img src={m.homeTeam.crest} alt="" className="h2h__crest" data-team={m.homeTeam?.name}
                          onError={e => { e.currentTarget.style.display = 'none' }} />
                      </span>
                    )}
                  </div>
                  <div className="h2h__scoreBlock">
                    <span className="h2h__date">{date}</span>
                    <span className="h2h__score">{hs} – {as_}</span>
                    {wentToPens && hp != null && ap != null && (
                      <span className="h2h__pens">tab {hp}-{ap}</span>
                    )}
                  </div>
                  <div className="h2h__side h2h__side--away">
                    {m.awayTeam?.crest && (
                      <span className="h2h__crestWrap" data-crest={isWC ? 'country' : 'club'}>
                        <img src={m.awayTeam.crest} alt="" className="h2h__crest" data-team={m.awayTeam?.name}
                          onError={e => { e.currentTarget.style.display = 'none' }} />
                      </span>
                    )}
                    <span className="h2h__team">{translateTeam(m.awayTeam?.shortName || m.awayTeam?.name || '?')}</span>
                  </div>
                </div>
              </div>
            )
          })}
          </div>
        </>
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

  const { home: hs, away: as_ } = finalScore(match.score)

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
        <PmStatsSkeleton />
      ) : rows.length > 0 ? (
        <div className="pm__statTable">
          {rows.map(({ label, hv, av, hBetter, aBetter }) => (
            <div key={label} className="pm__statRow">
              <span className={`pm__statVal${hBetter ? ' pm__statVal--better pm__statVal--better--home' : ''}`}>{hv}</span>
              <span className="pm__statName">{label}</span>
              <span className={`pm__statVal pm__statVal--right${aBetter ? ' pm__statVal--better pm__statVal--better--away' : ''}`}>{av}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="pm__noData">Stats non disponibles</p>
      )}
    </div>
  )
}

export function PreMatchSection({ match, formMap, compMatches, hideStats = false, hideProno = false }) {
  const homeId = match.homeTeam?.id
  const awayId = match.awayTeam?.id
  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  return (
    <div className="pm__wrap">

      {/* Pronostic des fans — masqué si déjà affiché ailleurs (ex: MatchPage
          l'affiche en haut de page, au-dessus de "Stats saison") */}
      {/* Dernières confrontations — en premier pour voir l'historique direct */}
      <H2HSection match={match} compMatches={compMatches} />

      {/* Stats saison */}
      {!hideStats && compMatches?.length > 0 && (
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
  const LIVE_TABS = ['livestats','compos','classement']
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

  // calcLiveProno n'est plus affiché tel quel (remplacé par LivePulse, le
  // pronostic des fans) — gardé uniquement pour alimenter l'échantillonnage
  // de la courbe de bascule post-match (voir <ProbaCurve> sur MatchPage).
  const hForm = formMap?.[match.homeTeam?.id]
  const aForm = formMap?.[match.awayTeam?.id]
  const liveMinute = isLive ? calcMinute(match) : null
  const fsPanel = finalScore(match.score)
  const prono = isLive && (hForm || aForm)
    ? calcLiveProno(
        hForm, aForm,
        mergeScore(espnScore?.home, fsPanel.home ?? match.score?.halfTime?.home),
        mergeScore(espnScore?.away, fsPanel.away ?? match.score?.halfTime?.away),
        liveMinute
      )
    : null

  if (isLive && prono) recordProbaSample(match.id, liveMinute, prono)

  const { home: hs, away: as_ } = fsPanel
  // Score 120min (finalScore) : un match décidé aux tirs au but y est
  // TOUJOURS à égalité, le vrai vainqueur vient de score.penalties.
  const wentToPens = match.score?.duration === 'PENALTY_SHOOTOUT'
  const hPens = match.score?.penalties?.home ?? null
  const aPens = match.score?.penalties?.away ?? null
  const hWin = isFinished && (wentToPens ? (hPens != null && aPens != null && hPens > aPens) : hs > as_)
  const aWin = isFinished && (wentToPens ? (hPens != null && aPens != null && aPens > hPens) : as_ > hs)

  const formatHour = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const formatDate = (d) => {
    const today    = new Date(); today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
    const date     = new Date(d); date.setHours(0,0,0,0)
    if (date.getTime() === today.getTime())    return "Aujourd'hui"
    if (date.getTime() === tomorrow.getTime()) return 'Demain'
    return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = match.competition?.id === 2000 || match.competition?.code === 'WC'

  // Thème dynamique — mêmes couleurs anti-collision que MatchPage/LiveMatchPage.
  const themeVars = getMatchThemeVars(match.homeTeam?.name, match.awayTeam?.name)

  const modal = (
    <div className="modal__overlay" onClick={onClose}>
      <div className="modal__panel" style={themeVars} onClick={e => e.stopPropagation()}>

        <button className="modal__close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="modal__header">
          <span className="modal__kicker">{match.competition?.name}</span>
        </div>

        {/* Équipes + score */}
        <div className="modal__teams">
          <div className="modal__team">
            {match.homeTeam.crest && (
              <div className="modal__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="modal__crest" data-team={match.homeTeam?.name}
                onError={e => e.currentTarget.style.display = 'none'} /></div>
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
                {wentToPens && hPens != null && aPens != null && (
                  <span className="modal__pens">({hPens}-{aPens} tab)</span>
                )}
                <span className="modal__ftLabel">Terminé</span>
              </>
            ) : isLive ? (() => {
              const matchSt = getMatchState(match.id)
              const fsLiveBadge = finalScore(match.score)
              const liveHs  = mergeScore(espnScore?.home, fsLiveBadge.home ?? match.score?.halfTime?.home)
              const liveAs  = mergeScore(espnScore?.away, fsLiveBadge.away ?? match.score?.halfTime?.away)
              const minute  = calcMinute(match)
              const period  = getMatchPeriod(match)
              // Score des tab en direct — ESPN uniquement (champ confirmé fiable,
              // voir api/fifa-live.js). Ne s'affiche que si les tab ont commencé.
              const liveHomePens = espnScore?.homeShootout ?? null
              const liveAwayPens = espnScore?.awayShootout ?? null
              const showLivePens = period === 'T.A.B.' && (liveHomePens != null || liveAwayPens != null)
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
                  {showLivePens && (
                    <span className="modal__pens">({liveHomePens ?? 0}-{liveAwayPens ?? 0} tab)</span>
                  )}
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
              <div className="modal__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="modal__crest" data-team={match.awayTeam?.name}
                onError={e => e.currentTarget.style.display = 'none'} /></div>
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
            {/* Pronostic des fans — modal-wide, au-dessus des onglets (la
                modale n'a pas de sous-onglets Stats Live/Stats Saison,
                contrairement à LiveMatchPage/MatchPage). */}

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
              <button
                className={`modal__tab${tab === 'classement' ? ' modal__tab--active' : ''}`}
                onClick={() => pickTab('classement')}
              >Classement</button>
            </div>
            <TabDots count={LIVE_TABS.length} active={LIVE_TABS.indexOf(tab)} />
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
            <TabDots count={PRE_TABS.length} active={PRE_TABS.indexOf(preTab)} />
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
