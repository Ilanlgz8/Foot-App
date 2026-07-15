import { useState }      from 'react'
import { useQuery }                from '@tanstack/react-query'
import { useLineups, useFifaStats, useH2H, useEspnMatchStats, useProbableLineups, useFdLineups } from '../hooks/useMatchDetail'
import { useTeamForm } from '../hooks/useTeamForm'
import { useAflLiveStats, useAflLineups, useAflMatchStats, useAflProbableLineups } from '../hooks/useApiFootball'
import LineupPitch             from './LineupPitch'
import { StandingsTable }     from './StandingsTable'
import { useStandings }       from '../hooks/useStandings'
import { translateTeam }       from '../data/teamNames'
import { getLiveState } from '../utils/matchStateTracker'
import { calcMinute, mergeScore, finalScore, matchOutcome, outcomeForTeam, isNationalTeamComp } from '../utils/matchUtils'
import { calcLiveProno } from '../utils/calcProno'
import { getMatchTeamColors } from '../data/teamPhotos'
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
// parseStatNum : lit une valeur affichée ("58%", "14", "–") en nombre pour
// calculer les proportions de la barre — null si non exploitable (valeur
// manquante ou "–"), auquel cas aucune barre n'est dessinée pour cette ligne
// (comme avant, seuls les chiffres restent affichés).
function parseStatNum(v) {
  if (v == null) return null
  const n = parseFloat(String(v).replace('%', ''))
  return Number.isNaN(n) ? null : n
}

// ── Piste colorée sous chaque ligne de stat : part du centre, s'étend vers
// le camp de chaque équipe proportionnellement à sa part de la stat.
// Retour utilisateur : pas la couleur de l'équipe (drapeau), mais une paire
// fixe bleu clair (domicile) / rose-violet clair (extérieur), gérée entièrement
// en CSS (.statBar__home/.statBar__away) — homeColor/awayColor ne servent
// plus qu'aux chiffres (voir StatBar), pas à la piste. Exportée : réutilisée
// telle quelle par MpStatRow (MatchPage.jsx, stats match terminé/saison) —
// une seule implémentation du calcul de proportions pour toute l'app.
export function StatTrack({ homeVal, awayVal, noCompare = false }) {
  if (noCompare) return null
  const hNum = parseStatNum(homeVal)
  const aNum = parseStatNum(awayVal)
  if (hNum == null || aNum == null) return null
  const total = hNum + aNum
  if (total <= 0) return null
  const hPct = (hNum / total) * 100
  const aPct = (aNum / total) * 100
  return (
    <div className="statBar__track">
      <span className="statBar__home" style={{ width: `${hPct / 2}%` }} />
      <span className="statBar__away" style={{ width: `${aPct / 2}%` }} />
      <span className="statBar__mid" />
    </div>
  )
}

// homeColor/awayColor ici ne sont PLUS la couleur de l'équipe (retour
// utilisateur : "pas par rapport au drapeau") — ils ne servent que pour les
// rares lignes à couleur sémantique dédiée (ex. "Série en cours" V/N/D en
// vert/jaune/rouge, voir SeasonStatsTab). Par défaut (aucune couleur passée),
// les chiffres restent blancs via les classes CSS .modal__statTableVal(--home/--away).
function StatBar({ homeVal, awayVal, label, noCompare = false, homeColor = null, awayColor = null }) {
  const hNum = parseFloat(homeVal)
  const aNum = parseFloat(awayVal)
  const hasNums   = !noCompare && !Number.isNaN(hNum) && !Number.isNaN(aNum)
  const homeLeads = hasNums && hNum > aNum
  const awayLeads = hasNums && aNum > hNum
  return (
    <div className="statBar__wrap">
      <div className="modal__statTableRow">
        <span className={`modal__statTableVal${homeLeads ? ' modal__statTableVal--home' : ''}`} style={homeColor ? { color: homeColor } : undefined}>{homeVal ?? '–'}</span>
        <span className="modal__statTableLabel">{label}</span>
        <span className={`modal__statTableVal modal__statTableVal--right${awayLeads ? ' modal__statTableVal--away' : ''}`} style={awayColor ? { color: awayColor } : undefined}>{awayVal ?? '–'}</span>
      </div>
      <StatTrack homeVal={homeVal} awayVal={awayVal} noCompare={noCompare} />
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
    { label: 'Passes',        hv: h.passes        != null ? `${h.passes}`        : null, av: a.passes        != null ? `${a.passes}`        : null },
    { label: 'Précision passes', hv: h.passPct    != null ? `${h.passPct}%`      : null, av: a.passPct       != null ? `${a.passPct}%`       : null },
    { label: 'Tacles',        hv: h.tackles       != null ? `${h.tackles}`       : null, av: a.tackles       != null ? `${a.tackles}`        : null },
    { label: '% Tacles réussis', hv: h.tacklePct  != null ? `${h.tacklePct}%`    : null, av: a.tacklePct     != null ? `${a.tacklePct}%`     : null },
    { label: 'Interceptions', hv: h.interceptions != null ? `${h.interceptions}` : null, av: a.interceptions != null ? `${a.interceptions}`  : null },
    { label: 'Centres',       hv: h.crosses       != null ? `${h.crosses}`       : null, av: a.crosses       != null ? `${a.crosses}`        : null },
    { label: '% Centres réussis', hv: h.crossPct  != null ? `${h.crossPct}%`     : null, av: a.crossPct      != null ? `${a.crossPct}%`      : null },
    { label: 'Longs ballons', hv: h.longBalls     != null ? `${h.longBalls}`     : null, av: a.longBalls     != null ? `${a.longBalls}`      : null },
    { label: '% Longs ballons réussis', hv: h.longBallPct != null ? `${h.longBallPct}%` : null, av: a.longBallPct != null ? `${a.longBallPct}%` : null },
    { label: 'Dégagements',   hv: h.clearances    != null ? `${h.clearances}`    : null, av: a.clearances    != null ? `${a.clearances}`     : null },
    { label: 'Tirs contrés',  hv: h.blockedShots  != null ? `${h.blockedShots}`  : null, av: a.blockedShots  != null ? `${a.blockedShots}`   : null },
    { label: 'Arrêts',        hv: h.saves         != null ? `${h.saves}`         : null, av: a.saves         != null ? `${a.saves}`          : null },
    { label: 'Fautes',        hv: h.fouls         != null ? `${h.fouls}`         : null, av: a.fouls         != null ? `${a.fouls}`         : null },
    { label: 'Hors-jeu',      hv: h.offsides      != null ? `${h.offsides}`      : null, av: a.offsides      != null ? `${a.offsides}`      : null },
    { label: 'Cartons rouges',hv: h.redCards      != null ? `${h.redCards}`      : null, av: a.redCards      != null ? `${a.redCards}`       : null },
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
          <div className="sk" style={{ width: '7rem', height: '0.5rem', marginBottom: '0.5rem' }} />
          <div className="h2h__lineup">
            <div className="sk" style={{ width: '4.5rem', height: '0.72rem', justifySelf: 'end' }} />
            <div className="sk" style={{ width: '2.4rem', height: '0.9rem' }} />
            <div className="sk" style={{ width: '4.5rem', height: '0.72rem' }} />
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
  if (!base) return raw || ''
  // ⚠️ BUG CORRIGÉ (constat utilisateur, capture à l'appui : "36''",
  // "45'+2''") : ESPN renvoie déjà la minute pré-formatée avec son
  // apostrophe (clock.displayValue = "36'", "45'+2'", "93'"...) — on en
  // rajoutait systématiquement une 2e sans vérifier, d'où le doublon visible
  // en fin de chaîne. On n'ajoute l'apostrophe que si elle n'y est pas déjà.
  return base.endsWith(`'`) ? base : `${base}'`
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

// ── Stats ESPN summary (endpoint summary → boxscore.teams[].statistics) ───────
// Fetché à la demande quand espnEventId est connu mais le scoreboard n'a pas les stats.
//
// ⚠️ ÉLARGI (retour utilisateur : "on avait dit qu'on ajoutait d'autres
// stats") — ne remontait avant que possession/tirs/corners alors qu'ESPN
// fournit bien plus dans boxscore.teams[].statistics (vérifié en direct sur
// un vrai match Premier League — noms de champs confirmés ci-dessous : fautes,
// cartons, hors-jeu, tirs cadrés, passes, tacles, interceptions, centres,
// longs ballons, dégagements, tirs contrés, arrêts). Le renderer ESPNStats
// (juste au-dessus) sait déjà afficher toutes ces lignes, seule l'extraction
// ici était incomplète.
function useEspnSummaryStats(espnEventId, espnSlug, enabled) {
  return useQuery({
    queryKey: ['espnSummary', espnEventId],
    queryFn: async () => {
      // Retour d'arrière-plan récent (voir useLiveMinute.js onVisible) : on
      // contourne le cache Redis serveur du summary ESPN pour ne pas
      // resservir les mêmes stats périmées qu'avant la mise en arrière-plan.
      const forceFresh = typeof window !== 'undefined'
        && window.__liveStatsForceFreshUntil
        && Date.now() < window.__liveStatsForceFreshUntil
      const url = `/espn?slug=${espnSlug}&eventId=${espnEventId}`
        + (forceFresh ? '&forceFresh=1' : '')
      const res = await fetch(url)
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

      // ⚠️ Les champs "*Pct" d'ESPN (passPct, tacklePct, crossPct,
      // longballPct...) sont un RATIO 0-1 arrondi à 1 décimale dans
      // displayValue (ex: "0.9" pour 86% de passes réussies, PAS 90%) —
      // vérifié en direct. Affiché tel quel avec un "%" ça donnerait "0.9%"
      // au lieu de "86%". On recalcule donc le vrai pourcentage nous-mêmes à
      // partir des 2 compteurs bruts (réussi/total) plutôt que de faire
      // confiance à ce champ arrondi.
      const pct = (made, total) => (made != null && total != null && total > 0)
        ? Math.round((made / total) * 100)
        : null

      function buildSide(team) {
        const totalPasses    = getStat(team, 'totalPasses')
        const accuratePasses = getStat(team, 'accuratePasses')
        const totalTackles   = getStat(team, 'totalTackles')
        const okTackles      = getStat(team, 'effectiveTackles')
        const totalCrosses   = getStat(team, 'totalCrosses')
        const okCrosses      = getStat(team, 'accurateCrosses')
        const totalLongBalls = getStat(team, 'totalLongBalls')
        const okLongBalls    = getStat(team, 'accurateLongBalls')

        return {
          poss:          getStat(team, 'possessionPct'),
          shots:         getStat(team, 'totalShots', 'shotsTotal', 'shots'),
          shotsOnTarget: getStat(team, 'shotsOnTarget'),
          corners:       getStat(team, 'wonCorners', 'cornerKicks', 'corners'),
          passes:        totalPasses,
          passPct:       pct(accuratePasses, totalPasses),
          tackles:       totalTackles,
          tacklePct:     pct(okTackles, totalTackles),
          interceptions: getStat(team, 'interceptions'),
          crosses:       totalCrosses,
          crossPct:      pct(okCrosses, totalCrosses),
          longBalls:     totalLongBalls,
          longBallPct:   pct(okLongBalls, totalLongBalls),
          clearances:    getStat(team, 'totalClearance', 'effectiveClearance'),
          blockedShots:  getStat(team, 'blockedShots'),
          saves:         getStat(team, 'saves'),
          fouls:         getStat(team, 'foulsCommitted', 'fouls'),
          offsides:      getStat(team, 'offsides'),
          redCards:      getStat(team, 'redCards'),
        }
      }

      const home = buildSide(homeTeam)
      const away = buildSide(awayTeam)

      if (home.poss === null && home.shots === null) return null

      return { home, away }
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

// compMatches, hForm, aForm : ré-utilisés depuis le 15/07 (retour utilisateur)
// pour le pronostic live (voir LiveProno plus bas) — compMatches sert de prior
// pré-match (calcPronoAdvanced) à faire glisser vers le score réel, hForm/aForm
// sont le repli si compMatches est insuffisant (calcProno, forme récente).
// L'historique des confrontations affiché à l'écran reste dans son propre
// onglet (H2HTabContent) : compMatches n'est plus utilisé pour ÇA ici.
export function LiveStatsTab({ match, espnScore, compMatches, hForm, aForm }) {
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

  // BUG CORRIGÉ (constat utilisateur : "même sur LiveMatchPage j'avais que
  // possession/tirs/tirs cadrés/fautes/corners") : cette requête n'était
  // activée QUE si `!hasEspn` — dès que le scoreboard ESPN avait ne serait-ce
  // que la possession/les tirs (l'ancienne "Priorité 1" plus bas, réputée
  // "rare" dans un vieux commentaire mais en fait fréquente en pratique), la
  // version enrichie (passes/tacles/interceptions/centres/longs ballons/
  // dégagements/tirs contrés/arrêts — 19 champs contre 6) n'était JAMAIS
  // interrogée : le scoreboard basique gagnait toujours la course et
  // affichait ses seuls 6 champs, pour toute la durée du match. Elle se
  // déclenche maintenant dès qu'on a un event ID, qu'il y ait déjà ou non
  // des stats basiques du scoreboard — c'est un sur-ensemble strict des
  // stats scoreboard, donc toujours préférable quand disponible (voir ordre
  // de priorité ci-dessous, également corrigé).
  const { data: summaryStats, isLoading: summaryLoading } = useEspnSummaryStats(
    espnScore?.espnEventId,
    espnScore?.espnSlug,
    isLive && hasEspnId
  )

  // Fallback api-football — si ESPN n'a rien (ni scoreboard ni summary) et pas FIFA
  const espnSummaryFailed = !summaryLoading && !summaryStats
  const { data: statsData, isLoading: aflLoading } = useAflLiveStats(
    match, isLive && !isFifaMatch && !hasEspn && (!hasEspnId || espnSummaryFailed)
  )

  // ── Pronostic live façon "côtes bookmaker" (retour utilisateur : afficher
  // le calcul au-dessus des stats, recalculé selon le score actuel, les
  // cartons rouges, la possession/pression adverse — pas juste figé au
  // pré-match). Calculé ICI (pas dans le parent LiveMatchPage) car c'est ici
  // qu'on a déjà les stats live (redCards/poss) sous la main, quelle que
  // soit la source qui a fini de charger — et affiché AVANT même que les
  // stats détaillées soient prêtes : le score/la minute arrivent toujours
  // en premier (voir espnScore, déjà dispo dès le montage), pas besoin
  // d'attendre fifaStats/summaryStats pour montrer un premier résultat.
  // espnScore?.stats (scoreboard ESPN, déjà dans le cache live global —
  // aucun fetch supplémentaire) suffit pour redCards/poss/shotsOnTarget :
  // mêmes noms de champs que fifaStats/mergedStats (voir extractBoxscoreStats,
  // api/fifa-live.js), donc valable quelle que soit la source finale des
  // stats détaillées affichées plus bas.
  const liveMinute = calcMinute(match)
  const fsLive      = finalScore(match.score)
  const homeGoals   = mergeScore(espnScore?.home, fsLive.home ?? match.score?.halfTime?.home)
  const awayGoals   = mergeScore(espnScore?.away, fsLive.away ?? match.score?.halfTime?.away)
  const pronoStats  = espnScore?.stats
  const liveProno   = (hForm != null || aForm != null) ? calcLiveProno(
    hForm, aForm, homeGoals, awayGoals, liveMinute,
    {
      homeId: match?.homeTeam?.id, awayId: match?.awayTeam?.id, compMatches,
      homeRedCards:      pronoStats?.home?.redCards,
      awayRedCards:      pronoStats?.away?.redCards,
      homePoss:          pronoStats?.home?.poss,
      awayPoss:          pronoStats?.away?.poss,
      homeShotsOnTarget: pronoStats?.home?.shotsOnTarget,
      awayShotsOnTarget: pronoStats?.away?.shotsOnTarget,
    }
  ) : null

  // ── Priorité 1 : Stats FIFA live (WC 2026) — vérifié AVANT le scoreboard
  // basique ci-dessous (l'ancien ordre laissait un match CM avec juste
  // possession/tirs au scoreboard ESPN doubler les stats FIFA, plus riches). ──
  const mergeSide = (...sides) => {
    const out = {}
    for (const side of sides) {
      if (!side) continue
      for (const k of Object.keys(side)) {
        if (out[k] == null && side[k] != null) out[k] = side[k]
      }
    }
    return out
  }
  // ── Priorité 2 : ESPN summary (19 champs) FUSIONNÉ avec le scoreboard
  // (6 champs) — question utilisateur : plutôt que "le premier qui a des
  // données gagne et on jette le reste", on combine champ par champ (le
  // summary est préféré à champ égal, le scoreboard ne comble que les trous).
  // Aucun risque de casse : les deux sources retournent déjà le même format
  // normalisé { home:{poss,shots,...}, away:{...} } avec des valeurs
  // `null`-safe (voir useEspnSummaryStats/useEspnMatchDetail), ESPNStats
  // filtre déjà les champs null à l'affichage — la fusion ne fait qu'élargir
  // l'ensemble de champs non-null disponibles, jamais planter dessus. Seule
  // nuance honnête : summary et scoreboard sont interrogés à des instants
  // différents (staleTime différents), donc 2 champs fusionnés depuis 2
  // sources peuvent techniquement dater de quelques secondes d'écart l'un de
  // l'autre en live — invisible en pratique (déjà le cas de base pour
  // n'importe quelle stat live qui a plusieurs secondes de retard). ──
  const mergedStats = (summaryStats || hasEspn) ? {
    home: mergeSide(summaryStats?.home, espnScore?.stats?.home),
    away: mergeSide(summaryStats?.away, espnScore?.stats?.away),
  } : null

  // Corps de l'onglet (stats détaillées) — 4 priorités, une seule return à
  // la fin de LiveStatsTab désormais (voir plus bas) pour pouvoir afficher
  // le pronostic live au-dessus quel que soit le chemin emprunté ici.
  const statsBody = (() => {
    if (isFifaMatch) {
      if (fifaStatsLoading) return <StatsSkeleton />
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

    if (mergedStats) {
      return (
        <div>
          <ESPNStats stats={mergedStats} />
          {espnScore?.scorers?.length > 0 && <ESPNScorers scorers={espnScore.scorers} />}
        </div>
      )
    }

    // Chargement du summary en cours (et aucune stat scoreboard à afficher
    // tout de suite en attendant) : on patiente plutôt que d'afficher un état
    // vide qui se remplirait un instant après — évite un saut visuel.
    if (summaryLoading && hasEspnId) return <StatsSkeleton />

    // ── Priorité 4 : Fallback api-football ──
    const allPeriod = statsData?.statistics?.find(s => s.period === 'ALL')
    const items     = allPeriod?.groups?.flatMap(g => g.statisticsItems ?? []) ?? []
    const rows      = STAT_KEYS
      .map(k => items.find(item => item.name === k))
      .filter(Boolean)

    if (aflLoading && rows.length === 0) return <StatsSkeleton />

    return (
      <div>
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
      </div>
    )
  })()

  return (
    <div>
      {liveProno && <LiveProno prono={liveProno} match={match} />}
      {statsBody}
    </div>
  )
}

// ── Pronostic live façon "côtes bookmaker" ────────────────────────────────
// Barre 1/N/2 recalculée en direct (score, minute, cartons rouges,
// possession, tirs cadrés — voir calcLiveProno) affichée au-dessus des
// stats live pour un aperçu immédiat de "qui est favori maintenant", sans
// attendre le chargement des stats détaillées.
function LiveProno({ prono, match }) {
  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const homeCode = (match.homeTeam?.tla || homeName).slice(0, 3).toUpperCase()
  const awayCode = (match.awayTeam?.tla || awayName).slice(0, 3).toUpperCase()
  const { home: homeColors, away: awayColors } = getMatchTeamColors(homeName, awayName)

  return (
    <div className="modal__liveProno">
      <div className="modal__liveProno__title">
        <span className="modal__liveProno__dot" />
        Pronostic en direct
      </div>
      <div className="modal__liveProno__labels">
        <span className="modal__liveProno__lbl modal__liveProno__lbl--h">{homeCode} {prono.home}%</span>
        <span className="modal__liveProno__lbl modal__liveProno__lbl--d" style={{ left: `${prono.home + prono.draw / 2}%` }}>Nul {prono.draw}%</span>
        <span className="modal__liveProno__lbl modal__liveProno__lbl--a">{awayCode} {prono.away}%</span>
      </div>
      <div className="modal__liveProno__bar">
        <div className="modal__liveProno__seg modal__liveProno__seg--h" style={{ width: `${prono.home}%`, background: homeColors.main }} />
        <div className="modal__liveProno__seg modal__liveProno__seg--d" style={{ width: `${prono.draw}%` }} />
        <div className="modal__liveProno__seg modal__liveProno__seg--a" style={{ width: `${prono.away}%`, background: awayColors.main, opacity: 0.8 }} />
      </div>
    </div>
  )
}

// ── Stats saison — agrégées depuis les matchs terminés de la compétition ─────
// Partagé entre LiveMatchPage (sous-onglet "Stats saison") et MatchPage pour
// un match terminé (même sous-onglet). Logique identique à MpSeasonStats
// (MatchPage.jsx, utilisé pour les matchs à venir) mais exportée ici pour
// être réutilisable sans dupliquer le calcul dans LiveMatchPage.
// split: 'all' | 'home' | 'away' (retour utilisateur : comparatif dom/ext)
function calcSeasonTeamStats(teamId, compMatches, split = 'all') {
  const matches = (compMatches ?? []).filter(m => {
    if (m.status !== 'FINISHED') return false
    const isHome = m.homeTeam?.id === teamId
    const isAway = m.awayTeam?.id === teamId
    if (!isHome && !isAway) return false
    if (split === 'home') return isHome
    if (split === 'away') return isAway
    return true
  })
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
    // Aux tirs au but, le score 120min (f/a) est TOUJOURS à égalité : le vrai
    // résultat vient de score.penalties (même convention que FormDiamonds).
    let outcome
    if (m.score?.duration === 'PENALTY_SHOOTOUT' &&
        m.score?.penalties?.home != null && m.score?.penalties?.away != null) {
      const myPens  = myHome ? m.score.penalties.home : m.score.penalties.away
      const oppPens = myHome ? m.score.penalties.away : m.score.penalties.home
      outcome = myPens > oppPens ? 'W' : 'L'
    } else {
      outcome = f > a ? 'W' : f === a ? 'D' : 'L'
    }
    if (outcome === 'W') { wins++; results.push('W') }
    else if (outcome === 'D') { draws++; results.push('D') }
    else { losses++; results.push('L') }
  })
  // ⚠️ BUG CORRIGÉ (voir même correctif dans MatchPage.jsx/calcTeamStats,
  // constat utilisateur : match "Matchs joués" en retard d'1 pour l'Angleterre) :
  // "played" comptait wins+draws+losses, qui exclut un match FINISHED dont le
  // score n'est pas encore pleinement renseigné par FD.org juste après le
  // coup de sifflet. On compte maintenant tous les matchs FINISHED ; les
  // moyennes/% restent calculées sur scoredCount (score connu uniquement).
  const played      = matches.length
  const scoredCount = wins + draws + losses
  if (!played) return null

  let streak = 0, streakType = null
  for (let i = results.length - 1; i >= 0; i--) {
    if (streakType === null) { streakType = results[i]; streak = 1 }
    else if (results[i] === streakType) streak++
    else break
  }

  return {
    played,
    avgFor:     scoredCount ? (gf / scoredCount).toFixed(1) : '0.0',
    avgAgainst: scoredCount ? (ga / scoredCount).toFixed(1) : '0.0',
    winPct:     scoredCount ? Math.round((wins  / scoredCount) * 100) : 0,
    bttsPct:    scoredCount ? Math.round((btts  / scoredCount) * 100) : 0,
    over25Pct:  scoredCount ? Math.round((over25 / scoredCount) * 100) : 0,
    cs,
    streak, streakType,
  }
}

export function SeasonStatsTab({ match, compMatches }) {
  const homeId = match?.homeTeam?.id
  const awayId = match?.awayTeam?.id
  // ⚠️ BUG CORRIGÉ (écran noir en ouvrant "Stats saison" sur LiveMatchPage) :
  // ces 2 variables avaient été supprimées par erreur en retirant le calcul
  // de couleurs d'équipe (getMatchTeamColors, plus utilisé pour les barres,
  // voir StatTrack) — mais elles servent aussi à afficher le nom des équipes
  // dans le bloc "Forme récente" plus bas, qui plantait avec un
  // ReferenceError (variable non définie) au lieu de simplement s'afficher.
  const homeName = translateTeam(match?.homeTeam?.shortName || match?.homeTeam?.name || '?')
  const awayName = translateTeam(match?.awayTeam?.shortName || match?.awayTeam?.name || '?')

  // Toggle Global/Domicile/Extérieur (retour utilisateur)
  const [split, setSplit] = useState('all')
  const h = calcSeasonTeamStats(homeId, compMatches, split)
  const a = calcSeasonTeamStats(awayId, compMatches, split)
  const hAll = calcSeasonTeamStats(homeId, compMatches, 'all')
  const aAll = calcSeasonTeamStats(awayId, compMatches, 'all')

  if (!hAll && !aAll) {
    return <p className="modal__noEvents">Stats saison non disponibles</p>
  }

  const streakColor = type => type === 'W' ? '#4ade80' : type === 'D' ? '#facc15' : '#f87171'
  const streakLabel = s => !s?.streak ? '–' : `${s.streak}${s.streakType === 'W' ? 'V' : s.streakType === 'D' ? 'N' : 'D'}`

  const rows = [
    { label: 'Matchs joués',            hv: h?.played,                 av: a?.played,                 noCompare: true },
    { label: 'Buts marqués / match',    hv: h?.avgFor,                 av: a?.avgFor },
    { label: 'Buts encaissés / match',  hv: h?.avgAgainst,             av: a?.avgAgainst },
    { label: '% Victoires',             hv: h ? `${h.winPct}%` : null, av: a ? `${a.winPct}%` : null },
    { label: 'Clean sheets',            hv: h?.cs,                     av: a?.cs },
    { label: 'Les 2 équipes marquent %',hv: h ? `${h.bttsPct}%` : null,av: a ? `${a.bttsPct}%` : null },
    { label: '+2.5 buts %',             hv: h ? `${h.over25Pct}%` : null, av: a ? `${a.over25Pct}%` : null },
    { label: 'Série en cours',          hv: streakLabel(h), av: streakLabel(a), noCompare: true,
      homeColor: h ? streakColor(h.streakType) : null, awayColor: a ? streakColor(a.streakType) : null },
  ].filter(r => r.hv != null || r.av != null)

  return (
    <div className="modal__espnStats">
      <div className="homeAwayToggle">
        <button className={`homeAwayToggle__btn${split === 'all' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('all')}>Global</button>
        <button className={`homeAwayToggle__btn${split === 'home' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('home')}>Domicile</button>
        <button className={`homeAwayToggle__btn${split === 'away' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('away')}>Extérieur</button>
      </div>

      {rows.map(r => (
        <StatBar key={r.label} label={r.label} homeVal={r.hv ?? '–'} awayVal={r.av ?? '–'}
          noCompare={r.noCompare}
          homeColor={r.homeColor}
          awayColor={r.awayColor} />
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
// ⚠️ ÉVOLUTION (demande explicite : "met l'onglet historique... dans
// l'onglet statistique... à côté de stat saison") : Historique (confrontations
// passées) était un 4e onglet TOP-LEVEL séparé (Statistiques/Compos/Classement
// /Historique) dans MatchPage.jsx + LiveMatchPage.jsx. Replié ici comme 3e
// sous-onglet, à côté de Stats live/Stats saison — un seul endroit à
// maintenir pour les 3 pages qui l'utilisent (MatchPage avant + après match,
// LiveMatchPage). `showLive`/`showHistorique` permettent à chaque appelant de
// n'afficher que les sous-onglets pertinents (ex: pas de "Stats live" avant
// le coup d'envoi dans MatchPage.jsx, pas de "Historique" tant qu'aucune
// confrontation connue n'est confirmée).
export function StatsSubTabs({ view, onChange, showLive = true, showHistorique = false }) {
  return (
    <div className="statsSubTabs">
      {showLive && (
        <button
          className={`statsSubTabs__btn${view === 'live' ? ' statsSubTabs__btn--active' : ''}`}
          onClick={() => onChange('live')}
        >
          Stats live
        </button>
      )}
      <button
        className={`statsSubTabs__btn${view === 'saison' ? ' statsSubTabs__btn--active' : ''}`}
        onClick={() => onChange('saison')}
      >
        Stats saison
      </button>
      {showHistorique && (
        <button
          className={`statsSubTabs__btn${view === 'historique' ? ' statsSubTabs__btn--active' : ''}`}
          onClick={() => onChange('historique')}
        >
          Historique
        </button>
      )}
    </div>
  )
}

// ── Onglet Compos — api-football (primaire) → ESPN/FIFA (fallback) ────────────

// normName : normalise un nom de joueur pour faire correspondre le buteur
// (liste ESPN scorers) au joueur affiché dans la compo (liste ESPN roster) —
// mêmes deux champs `shortName` d'ESPN, censés être identiques, mais trim +
// lowercase par prudence (espace en trop déjà observé sur au moins un nom
// ESPN réel, ex: "Pedri " avec espace final).
function normName(n) {
  return (n ?? '').trim().toLowerCase()
}

// buildGoalCounts : { "nom normalisé" -> nombre de buts } à partir de la
// liste de buteurs (même provenance ESPN que la compo — voir normName —
// donc correspondance fiable, contrairement à un croisement entre deux
// sources différentes comme pour les remplacements).
function buildGoalCounts(scorers = []) {
  const counts = {}
  for (const s of scorers) {
    const key = normName(s?.name)
    if (!key) continue
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

export function ComposTab({ match, compMatches, scorers = [] }) {
  const isFinished = match?.status === 'FINISHED'
  const isUpcoming = !isFinished

  // WC 2026 : useLineups gère FIFA API en interne (redis fm:match:) puis ESPN fallback.
  // Pour WC on lance api-football EN PARALLÈLE d'ESPN (ESPN/FIFA souvent vides si hors cron).
  // Pour non-WC, api-football attend qu'ESPN échoue (économie de quota 100 req/jour).
  const isWC = isNationalTeamComp(match)

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
  // hero) — remplace le rouge fixe pour les deux équipes.
  const { home: pitchHome, away: pitchAway } = getMatchTeamColors(match?.homeTeam?.name, match?.awayTeam?.name)

  if (lineups) {
    // Buts par joueur — uniquement sur une VRAIE compo confirmée (pas sur les
    // "probables" ci-dessous, où on ne sait pas si ce joueur a réellement
    // joué ce match précis).
    const goalCounts = buildGoalCounts(scorers)
    return (
      <div style={{ padding: '8px 0 0' }}>
        <LineupPitch
          home={withCrest(lineups.home, homeCrest)}
          away={withCrest(lineups.away, awayCrest)}
          isCountry={isWC}
          hColor={pitchHome.main}
          aColor={pitchAway.main}
          goals={goalCounts}
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

// (FinishedDetails — ex-section "détails match terminé" combinant buts +
// cartons + remplacements + stats ESPN pour un match FT — et son helper
// EventsSkeleton ont été retirés (10/07 cleanup) : plus aucun call site,
// buts et cartons sont désormais affichés dans le hero (MatchPageHero, voir
// MatchPage.jsx), et les remplacements + stats ont leur propre affichage
// dédié ailleurs (MpMatchStats dans MatchPage.jsx).)

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
  // tout en haut (même convention que l'onglet Historique, voir H2HRowsList).
  //
  // ⚠️ BUG CORRIGÉ (constat utilisateur répété pour l'Angleterre, toujours
  // présent après 2 correctifs faits ailleurs dans useTeamForm.js/
  // matchUtils.js) : CE composant est celui RÉELLEMENT affiché à l'écran
  // pour "Forme récente" — mais il avait sa PROPRE logique W/D/L
  // indépendante, jamais branchée sur outcomeForTeam() (matchUtils.js),
  // reconstruite ici directement depuis compMatches plutôt que d'utiliser le
  // formMap déjà corrigé dans useTeamForm.js. Les correctifs précédents
  // n'avaient donc jamais eu d'effet sur ce qui s'affiche réellement.
  // Remplacé par outcomeForTeam() (même fonction, même priorité partout) —
  // un match dont le résultat n'est pas encore déterminable (score pas
  // encore renseigné par FD.org) est maintenant exclu de la liste plutôt que
  // silencieusement affiché comme un match nul "-:-" trompeur.
  const matches = (compMatches ?? [])
    .filter(m => m.status === 'FINISHED' && (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId))
    .filter(m => outcomeForTeam(m, teamId) != null)
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
        const wentToPens = m.score?.duration === 'PENALTY_SHOOTOUT'
        const hp = m.score?.penalties?.home ?? null
        const ap = m.score?.penalties?.away ?? null
        const result  = outcomeForTeam(m, teamId)
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
// split: 'all' | 'home' | 'away' (retour utilisateur : comparatif dom/ext)
function calcTeamStats(teamId, compMatches, split = 'all') {
  const matches = (compMatches ?? []).filter(m => {
    if (m.status !== 'FINISHED') return false
    const isHome = m.homeTeam?.id === teamId
    const isAway = m.awayTeam?.id === teamId
    if (!isHome && !isAway) return false
    if (split === 'home') return isHome
    if (split === 'away') return isAway
    return true
  })
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
  // ⚠️ BUG CORRIGÉ (même correctif que calcTeamStats dans MatchPage.jsx et
  // calcSeasonTeamStats plus haut dans ce fichier — constat utilisateur :
  // "Matchs joués" en retard d'1 pour l'Angleterre) : "played" excluait tout
  // match FINISHED sans score encore pleinement renseigné par FD.org. On
  // compte maintenant tous les matchs FINISHED ; moyennes/% restent sur
  // scoredCount (score connu uniquement) pour ne pas fausser ces stats.
  const played      = matches.length
  const scoredCount = wins + draws + losses
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
    avgFor:     scoredCount ? (gf / scoredCount).toFixed(1) : '0.0',
    avgAgainst: scoredCount ? (ga / scoredCount).toFixed(1) : '0.0',
    winPct:     scoredCount ? Math.round((wins / scoredCount) * 100) : 0,
    bttsPct:    scoredCount ? Math.round((btts / scoredCount) * 100) : 0,
    over25Pct:  scoredCount ? Math.round((over25 / scoredCount) * 100) : 0,
    streak: streakLabel,
    streakType,
  }
}

function SeasonStatsSection({ homeId, awayId, homeName, awayName, compMatches }) {
  // Toggle Global/Domicile/Extérieur (retour utilisateur)
  const [split, setSplit] = useState('all')
  const h = calcTeamStats(homeId, compMatches, split)
  const a = calcTeamStats(awayId, compMatches, split)
  const hAll = calcTeamStats(homeId, compMatches, 'all')
  const aAll = calcTeamStats(awayId, compMatches, 'all')
  if (!hAll && !aAll) return null

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
      <div className="homeAwayToggle">
        <button className={`homeAwayToggle__btn${split === 'all' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('all')}>Global</button>
        <button className={`homeAwayToggle__btn${split === 'home' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('home')}>Domicile</button>
        <button className={`homeAwayToggle__btn${split === 'away' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('away')}>Extérieur</button>
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
// useH2HRows, useTeamForm.js) pour ne pas dupliquer cette logique. Perspective
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

// ── Bilan des confrontations : victoires / nuls / victoires + barre de
//    domination aux couleurs réelles des deux équipes (teamPhotos) ──────────
function H2HBilan({ rows, match, isWC }) {
  const homeId = match.homeTeam?.id
  let homeWins = 0, awayWins = 0, draws = 0
  for (const m of rows) {
    const fs = finalScore(m.score)
    if (fs.home == null || fs.away == null) continue
    const pens = m.score?.duration === 'PENALTY_SHOOTOUT' ? m.score?.penalties : null
    let winnerId
    if (pens && pens.home != null && pens.away != null) {
      winnerId = pens.home > pens.away ? m.homeTeam?.id
               : pens.home < pens.away ? m.awayTeam?.id : null
    } else {
      winnerId = fs.home > fs.away ? m.homeTeam?.id
               : fs.home < fs.away ? m.awayTeam?.id : null
    }
    if (winnerId == null) draws++
    else if (winnerId === homeId) homeWins++
    else awayWins++
  }
  if (homeWins + awayWins + draws === 0) return null

  const colors = getMatchTeamColors(
    match.homeTeam?.name || match.homeTeam?.shortName || '',
    match.awayTeam?.name || match.awayTeam?.shortName || ''
  )

  const crest = (team) => team?.crest && (
    <span className="h2h__bilanCrestWrap" data-crest={isWC ? 'country' : 'club'}>
      <img src={team.crest} alt="" className="h2h__bilanCrest" data-team={team?.name}
        onError={e => { e.currentTarget.style.display = 'none' }} />
    </span>
  )

  return (
    <div className="h2h__bilan">
      <div className="h2h__bilanGrid">
        <div className="h2h__bilanSide">
          {crest(match.homeTeam)}
          <div className="h2h__bilanWins">{homeWins}</div>
          <div className="h2h__bilanLabel">Victoires</div>
        </div>
        {/* Nuls : label AU-DESSUS, chiffre en bas — le chiffre vient toucher
            la barre de domination (demande utilisateur : "trop haut" quand le
            label était dessous et repoussait le chiffre vers le haut) */}
        <div className="h2h__bilanMid">
          <div className="h2h__bilanLabel">Nuls</div>
          <div className="h2h__bilanDraws">{draws}</div>
        </div>
        <div className="h2h__bilanSide">
          {crest(match.awayTeam)}
          <div className="h2h__bilanWins">{awayWins}</div>
          <div className="h2h__bilanLabel">Victoires</div>
        </div>
      </div>
      <div className="h2h__domBar">
        {homeWins > 0 && <span style={{ flexGrow: homeWins, background: colors.home.main }} />}
        {draws    > 0 && <span className="h2h__domBar--nul" style={{ flexGrow: draws }} />}
        {awayWins > 0 && <span style={{ flexGrow: awayWins, background: colors.away.main }} />}
      </div>
    </div>
  )
}

// ── Hook partagé : calcule les confrontations passées (rows) + état de
// chargement. Appelé au niveau de la page (MatchPage/LiveMatchPage) pour
// piloter à la fois la visibilité du bouton d'onglet "Historique" et le
// contenu affiché (H2HTabContent) sans dupliquer la logique FD.org +
// fallback compMatches à deux endroits.
export function useH2HRows(match, compMatches) {
  const { data: h2hMatches, isLoading } = useH2H(match)
  const homeId = match?.homeTeam?.id
  const awayId = match?.awayTeam?.id

  // Données FD.org, du plus récent au plus vieux. ⚠️ CORRIGÉ (constat
  // utilisateur : "met en premier les plus récent" — ce n'était pas le cas)
  // : avant, un simple .reverse() supposait que l'API renvoyait déjà les
  // confrontations du plus vieux au plus récent, ce qui n'est pas garanti
  // (non documenté côté football-data.org, et dans les faits pas vérifié
  // dans ce sens). Tri explicite par date décroissante — correct quel que
  // soit l'ordre renvoyé par l'API, plus robuste qu'un .reverse() à l'aveugle.
  // Pas de troncature arbitraire ici : on affiche tout ce que l'API renvoie
  // réellement pour ce duo d'équipes plutôt que de promettre un nombre fixe
  // — football-data.org ne documente pas de garantie sur la profondeur de
  // son historique H2H (parfois 2 confrontations, parfois une dizaine selon
  // les équipes).
  const fdRecent = (h2hMatches ?? [])
    .filter(m => m.status === 'FINISHED')
    .slice()
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))

  // Fallback : confrontations dans la compétition en cours (si FD.org vide)
  const compH2H = !fdRecent.length && compMatches?.length
    ? (compMatches).filter(m =>
        m.status === 'FINISHED' &&
        ((m.homeTeam?.id === homeId && m.awayTeam?.id === awayId) ||
         (m.homeTeam?.id === awayId && m.awayTeam?.id === homeId))
      ).slice().sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    : []

  return { rows: fdRecent.length ? fdRecent : compH2H, isLoading }
}

// ── Liste des confrontations (championnat/date + équipes-score alignés) —
// utilisée par H2HTabContent.
function H2HRowsList({ rows, homeId }) {
  return (
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
      // Vainqueur de CETTE ligne (surbrillance nom + buts en or)
      const homeWon = result !== 'D' && ((result === 'W') === isHomeTeam)
      const awayWon = result !== 'D' && !homeWon
      const compLabel = m.competition?.name ?? ''
      // Liseré or à gauche : repère visuel immédiat pour un match allé aux
      // tirs au but, sans avoir à lire le petit texte "tab X-Y" sous le score
      // (demande utilisateur : affichage jugé "brouillon", historique dense
      // à parcourir rapidement — ce repère aide à repérer d'un coup d'œil les
      // confrontations les plus disputées).
      const pensRow = wentToPens && hp != null && ap != null
      return (
        <div key={i} className={`h2h__row${pensRow ? ' h2h__row--pens' : ''}`}>
          {/* Championnat + date — en haut à gauche de la card */}
          <div className="h2h__meta">{compLabel ? `${compLabel} · ${date}` : date}</div>
          {/* Équipes + score alignés sur une seule ligne, score centré */}
          <div className="h2h__lineup">
            <span className={`h2h__team${homeWon ? ' h2h__team--win' : ''}`}>
              {translateTeam(m.homeTeam?.shortName || m.homeTeam?.name || '?')}
            </span>
            <span className="h2h__scoreWrap">
              <span className="h2h__score">
                <span className={homeWon ? 'h2h__goal--w' : ''}>{hs}</span>
                {' – '}
                <span className={awayWon ? 'h2h__goal--w' : ''}>{as_}</span>
              </span>
              {wentToPens && hp != null && ap != null && (
                <span className="h2h__pens">tab {hp}-{ap}</span>
              )}
            </span>
            <span className={`h2h__team h2h__team--right${awayWon ? ' h2h__team--win' : ''}`}>
              {translateTeam(m.awayTeam?.shortName || m.awayTeam?.name || '?')}
            </span>
          </div>
        </div>
      )
    })}
    </div>
  )
}

// ── Contenu de l'onglet "Historique" dédié (MatchPage/LiveMatchPage) — la
// section H2H vivait auparavant dans "Statistiques"/"Avant-match", elle a
// désormais son propre onglet (le libellé de l'onglet fait déjà office de
// titre, pas besoin de le répéter). rows/isLoading viennent de
// useH2HRows(), appelé une seule fois au niveau de la page pour piloter à la
// fois ce contenu ET la visibilité du bouton d'onglet lui-même (masqué tant
// qu'aucune confrontation connue — demande explicite : "si y'en a pas on le
// hide, on affiche pas le bouton").
export function H2HTabContent({ match, rows, isLoading }) {
  const isWC = isNationalTeamComp(match)
  const homeId = match.homeTeam?.id
  const homeShort = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayShort = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  if (isLoading) return <H2HSkeleton />
  if (!rows.length) return <p className="modal__noEvents">Aucune confrontation connue entre ces deux équipes</p>

  return (
    <>
      <H2HBilan rows={rows} match={match} isWC={isWC} />
      <H2HTrend rows={rows} homeId={homeId} homeShort={homeShort} awayShort={awayShort} />
      <H2HRowsList rows={rows} homeId={homeId} />
    </>
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

// ⚠️ EXPORTÉ (constat utilisateur : "dans résultat y'a pas toutes les stats
// live qu'il y a sur livematchpage") : MatchPage.jsx avait sa PROPRE copie de
// cette fonction (commentaire "mêmes que MatchModal, dupliqués"), mais figée
// à seulement 6 lignes (Possession/Tirs/Tirs cadrés/Corners/Fautes/Hors-jeux)
// pendant que celle-ci était enrichie à 19 lignes (Passes, Tacles,
// Interceptions, Centres, Longs ballons, Dégagements, Tirs contrés, Arrêts,
// Cartons rouges...) — exactement le même jeu de stats que ESPNStats/
// STAT_KEYS ci-dessus, utilisé en LIVE (LiveMatchPage). Résultat : une fois
// le match terminé, ces 13 stats supplémentaires disparaissaient purement à
// l'affichage (la donnée FIFA les avait bien) — pas un vrai manque de
// donnée, juste deux fonctions dupliquées qui avaient divergé dans le temps.
// Exportée ici et IMPORTÉE par MatchPage.jsx (sa copie locale supprimée) :
// une seule source de vérité désormais, plus de risque de re-divergence.
// Convertit les stats FIFA (useFifaStats) en lignes d'affichage
export function fifaStatsToRows(data) {
  if (!data?.home && !data?.away) return []
  const h = data.home ?? {}
  const a = data.away ?? {}
  return [
    makeStatRow('Possession',   h.poss  != null ? `${h.poss}%` : null,  a.poss  != null ? `${a.poss}%` : null,  true),
    makeStatRow('Tirs',         h.shots,          a.shots,          true),
    makeStatRow('Tirs cadrés',  h.shotsOnTarget,  a.shotsOnTarget,  true),
    makeStatRow('Corners',      h.corners,        a.corners,        true),
    makeStatRow('Passes',       h.passes,         a.passes,         true),
    makeStatRow('Précision passes', h.passPct != null ? `${h.passPct}%` : null, a.passPct != null ? `${a.passPct}%` : null, true),
    makeStatRow('Tacles',       h.tackles,        a.tackles,        true),
    makeStatRow('% Tacles réussis', h.tacklePct != null ? `${h.tacklePct}%` : null, a.tacklePct != null ? `${a.tacklePct}%` : null, true),
    makeStatRow('Interceptions', h.interceptions, a.interceptions,  true),
    makeStatRow('Centres',      h.crosses,        a.crosses,        true),
    makeStatRow('% Centres réussis', h.crossPct != null ? `${h.crossPct}%` : null, a.crossPct != null ? `${a.crossPct}%` : null, true),
    makeStatRow('Longs ballons', h.longBalls,     a.longBalls,      true),
    makeStatRow('% Longs ballons réussis', h.longBallPct != null ? `${h.longBallPct}%` : null, a.longBallPct != null ? `${a.longBallPct}%` : null, true),
    makeStatRow('Dégagements',  h.clearances,     a.clearances,     true),
    makeStatRow('Tirs contrés', h.blockedShots,   a.blockedShots,   true),
    makeStatRow('Arrêts',       h.saves,          a.saves,          true),
    makeStatRow('Fautes',       h.fouls,          a.fouls,          false),
    makeStatRow('Hors-jeux',    h.offsides,       a.offsides,       false),
    makeStatRow('Cartons rouges', h.redCards,     a.redCards,       false),
  ].filter(Boolean)
}

// Convertit les stats api-football (useAflMatchStats) en lignes d'affichage
export function aflStatsToRows(statsData) {
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
  const isWC = isNationalTeamComp(match)

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

export function PreMatchSection({ match, compMatches, hideStats = false }) {
  const homeId = match.homeTeam?.id
  const awayId = match.awayTeam?.id
  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  return (
    <div className="pm__wrap">

      {/* Pronostic des fans — masqué si déjà affiché ailleurs (ex: MatchPage
          l'affiche en haut de page, au-dessus de "Stats saison") */}
      {/* Historique des confrontations : déplacé dans son propre onglet
          "Historique" (MatchPage/LiveMatchPage) — voir H2HTabContent. */}

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
