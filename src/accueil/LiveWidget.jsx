import { useState, useEffect } from 'react'
import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, mergeScore } from '../utils/matchUtils'

// ── Widget live — version allégée ───────────────────────────────────────────
// Volontairement minimal : juste "il y a un/des match(s) en direct" avec le
// score et la minute, en un coup d'œil. Le détail complet (buteurs, stats,
// période, reprise…) est sur la page /live — le garder ici en double faisait
// doublon avec cette page (constat de l'utilisateur, confirmé : le widget
// affichait quasiment autant de détail que la page dédiée).
function shortenName(name) {
  if (!name) return name
  if (name.length <= 10) return name
  return name.slice(0, 9) + '.'
}

function LiveChip({ match, espn, onMatchClick }) {
  const matchSt   = getMatchState(match.id)
  const isTermine = matchSt.ft === true
  const minute    = isTermine ? 'FIN' : (calcMinute(match) ?? '–')

  const hs = mergeScore(espn?.home, match.score?.fullTime?.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, match.score?.fullTime?.away ?? match.score?.halfTime?.away)
  const homeName = shortenName(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = shortenName(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  return (
    <button
      type="button"
      className="accueil__liveChip"
      onClick={() => onMatchClick?.(match)}
    >
      <div className="accueil__liveChipTeams">
        {match.homeTeam?.crest
          ? <img src={match.homeTeam.crest} alt="" className="accueil__liveChipCrest" />
          : <div className="accueil__liveChipCrestFb" />}
        <span className="accueil__liveChipScore">{hs ?? '-'} – {as_ ?? '-'}</span>
        {match.awayTeam?.crest
          ? <img src={match.awayTeam.crest} alt="" className="accueil__liveChipCrest" />
          : <div className="accueil__liveChipCrestFb" />}
      </div>
      <span className={`accueil__liveChipMinute${isTermine ? ' accueil__liveChipMinute--ft' : ''}`}>
        {minute}
      </span>
      <span className="accueil__liveChipNames">{homeName} – {awayName}</span>
    </button>
  )
}

export function LiveWidget({ liveMatches = [], espnScores = {}, onMatchClick }) {
  const now = Date.now()
  const live = liveMatches.filter(m => {
    const state = getMatchState(m.id)
    if (state.ft === true) return true
    if (m.status === 'IN_PLAY' || m.status === 'PAUSED') return true
    if (m.status === 'SCHEDULED' || m.status === 'TIMED') {
      const utcMs = new Date(m.utcDate).getTime()
      if (now >= utcMs && now - utcMs < 30 * 60_000) return true
    }
    return false
  })

  // Tick léger pour rafraîchir la minute affichée
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceUpdate(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  if (live.length === 0) return null

  return (
    <div className="accueil__liveChips">
      {live.map(match => (
        <LiveChip
          key={match.id}
          match={match}
          espn={espnScores[match.id] ?? null}
          onMatchClick={onMatchClick}
        />
      ))}
    </div>
  )
}
