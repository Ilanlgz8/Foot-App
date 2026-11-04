// MatchRow — ligne de match fine (page Match, mode "Ligne").
// Même contenu qu'une card Accueil (logo au-dessus du nom, libellé + score/heure
// au centre, période en petit en haut à droite) mais sans le fond de compétition
// ni les pastilles de pronostic : la couleur vient du cocon qui l'enveloppe.
// Même logique d'état que MatchPoster.jsx (terminé / direct / à venir, minute,
// "Reprise dans X min") — recopiée ici plutôt que partagée pour ne pas toucher à
// un composant très ajusté ; les classes de typographie `poster__*` sont réutilisées
// telles quelles pour garder EXACTEMENT les mêmes polices que les cards Accueil.
import { useState, useEffect, memo } from 'react'
import { translateTeam } from '../data/teamNames'
import {
  calcMinute, getMatchPeriod, mergeScore, finalScore,
  parseEspnClock, resolveFdTeamId, resolveFdCrest, sameJSON,
} from '../utils/matchUtils'
import { getMatchState, trackMatchState } from '../utils/matchStateTracker'

function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

const PERIOD_LABELS = {
  '1ère MT': '1ère mi-temps',
  '2ème MT': '2ème mi-temps',
  'Mi-temps': 'MT',
  'Prolongations': 'Prolongations',
  'T.A.B.': 'T.A.B.',
}

function Crest({ src, name }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <div className="mhRow__crestSpacer" aria-hidden="true" />
  return (
    <div className="mhRow__crest">
      <img src={src} alt="" data-team={name} loading="lazy" onError={() => setFailed(true)} />
    </div>
  )
}

function MatchRowImpl({ match, espnScore = null, live = false, onMatchClick, onLiveClick, compMatches = null }) {
  const handleClick = live
    ? (onLiveClick ? () => onLiveClick(match) : undefined)
    : (onMatchClick ? () => onMatchClick(match) : undefined)

  // Rafraîchit la minute pendant le direct (le composant est mémoïsé).
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [live])

  const ms = getMatchState(match.id)
  const espnLive = ms.espnStatus === 'STATUS_IN_PROGRESS' || ms.espnStatus === 'STATUS_HALFTIME' || ms.espnStatus === 'STATUS_END_PERIOD'
  const isFinished = ms.ft === true || (match.status === 'FINISHED' && !espnLive)
  const liveMinute = isFinished ? null : calcMinute(match)
  const isLive = !isFinished && (
    match.status === 'IN_PLAY' || match.status === 'PAUSED' || match.status === 'HALFTIME' ||
    espnLive || liveMinute !== null
  )
  const isUpcoming = !isFinished && !isLive
  const minute = isLive ? liveMinute : null

  const fs = finalScore(match.score)
  const homeScore = mergeScore(espnScore?.home, fs.home)
  const awayScore = mergeScore(espnScore?.away, fs.away)

  const homeName = match.homeTeam?.name ?? ''
  const awayName = match.awayTeam?.name ?? ''
  const homeShort = translateTeam(match.homeTeam?.shortName || homeName)
  const awayShort = translateTeam(match.awayTeam?.shortName || awayName)
  const pool = compMatches ?? []
  const homeId = resolveFdTeamId(match.homeTeam, pool, { loose: true, strict: true })
  const awayId = resolveFdTeamId(match.awayTeam, pool, { loose: true, strict: true })
  const homeCrest = resolveFdCrest(match.homeTeam, homeId, pool)
  const awayCrest = resolveFdCrest(match.awayTeam, awayId, pool)

  const periodLabel = isLive ? (PERIOD_LABELS[getMatchPeriod(match)] ?? null) : null

  // "Reprise dans X min" pendant la mi-temps (même calcul que MatchPoster.jsx).
  const [htLabel, setHtLabel] = useState(null)
  useEffect(() => {
    // (hors mi-temps le libellé n'est jamais affiché : inutile de le remettre à zéro ici)
    if (liveMinute !== 'MT') return
    const compute = () => {
      let state = getMatchState(match.id)
      if (!state.pausedAt && !state.half2Start) {
        const koReference = state.kickoffAt ?? new Date(match.utcDate).getTime()
        const parsedClock = parseEspnClock(state.espnClock)
        const realHalfMins = parsedClock ? parsedClock.base + (parsedClock.extra ?? 0) : null
        const halfMins = (realHalfMins != null && realHalfMins > 0) ? realHalfMins : 47
        const estimatedPausedAt = Math.min(Date.now(), koReference + halfMins * 60_000)
        trackMatchState({ ...match, status: 'PAUSED' }, estimatedPausedAt)
        state = getMatchState(match.id)
      }
      if (!state.pausedAt || state.half2Start) { setHtLabel(null); return }
      const remMin = Math.max(0, Math.ceil((15 * 60_000 - (Date.now() - state.pausedAt)) / 60_000))
      setHtLabel(remMin > 0 ? `Reprise ${remMin}min` : 'Reprise imminente')
    }
    compute()
    const id = setInterval(compute, 60_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMinute, match.id])

  const isHt = isLive && minute === 'MT'

  return (
    <div
      className={'mhRow' + (isLive ? ' mhRow--live' : '') + (isHt ? ' mhRow--ht' : '') + (handleClick ? ' mhRow--click' : '')}
      onClick={handleClick}
      role={handleClick ? 'button' : undefined}
      tabIndex={handleClick ? 0 : undefined}
      onKeyDown={handleClick ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }) : undefined}
      aria-label={`${homeShort} contre ${awayShort}`}
    >
      {periodLabel && <span className="mhRow__period">{periodLabel}</span>}

      <div className="mhRow__team">
        <Crest src={homeCrest} name={homeName} />
        <span className="mhRow__name">{homeShort}</span>
      </div>

      <div className="mhRow__mid">
        {isLive && minute && (isHt ? (
          <>
            <div className="poster__min-label mhRow__minLabel"><span className="poster__live-dot" />MT<span className="poster__live-dot poster__live-dot--ghost" aria-hidden="true" /></div>
            <div className="poster__reprise-label mhRow__reprise">{htLabel ?? 'Mi-temps'}</div>
          </>
        ) : (
          <div className="poster__min-label mhRow__minLabel"><span className="poster__live-dot" />{minute}<span className="poster__live-dot poster__live-dot--ghost" aria-hidden="true" /></div>
        ))}
        {isUpcoming && <div className="poster__env-label mhRow__envLabel">Coup d&apos;envoi</div>}
        {isFinished && <div className="poster__env-label mhRow__envLabel">Terminé</div>}
        {(isLive || isFinished)
          ? <div className="poster__score mhRow__score">{homeScore ?? 0} – {awayScore ?? 0}</div>
          : <div className="poster__time mhRow__score">{formatHour(match.utcDate)}</div>}
      </div>

      <div className="mhRow__team">
        <Crest src={awayCrest} name={awayName} />
        <span className="mhRow__name">{awayShort}</span>
      </div>
    </div>
  )
}

function sameRowProps(prev, next) {
  return (
    prev.live === next.live &&
    prev.onMatchClick === next.onMatchClick &&
    prev.onLiveClick === next.onLiveClick &&
    prev.compMatches === next.compMatches &&
    sameJSON(prev.match, next.match) &&
    sameJSON(prev.espnScore, next.espnScore)
  )
}

export const MatchRow = memo(MatchRowImpl, sameRowProps)
