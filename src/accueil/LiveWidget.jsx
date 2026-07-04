import { useState, useEffect } from 'react'
import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, mergeScore } from '../utils/matchUtils'
import { MatchCard } from './MatchCard'

// ── Widget live — version allégée ───────────────────────────────────────────
// Volontairement minimal : juste "il y a un/des match(s) en direct" avec le
// score et la minute, en un coup d'œil. Le détail complet (buteurs, stats,
// période, reprise…) est sur la page /live — le garder ici en double faisait
// doublon avec cette page (constat de l'utilisateur, confirmé : le widget
// affichait quasiment autant de détail que la page dédiée).
// Chip compacte — utilisée seulement s'il y a PLUSIEURS matchs en direct en
// même temps. Volontairement réduite à logo + score + minute (pas de nom
// d'équipe) : avec plusieurs matchs à caser sur une ligne, le nom rendait ça
// chargé — le logo suffit à identifier l'équipe en un coup d'œil.
function LiveChip({ match, espn, onMatchClick }) {
  const matchSt   = getMatchState(match.id)
  const isTermine = matchSt.ft === true
  const minute    = isTermine ? 'FIN' : (calcMinute(match) ?? '–')
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = match.competition?.id === 2000 || match.competition?.code === 'WC'

  const hs = mergeScore(espn?.home, match.score?.fullTime?.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, match.score?.fullTime?.away ?? match.score?.halfTime?.away)

  return (
    <button
      type="button"
      className={`accueil__liveChip${isTermine ? ' accueil__liveChip--ft' : ''}`}
      onClick={() => onMatchClick?.(match)}
    >
      <div className="accueil__liveChipTeams">
        {match.homeTeam?.crest
          ? <div className="accueil__liveChipCrestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="accueil__liveChipCrest" data-team={match.homeTeam?.name} /></div>
          : <div className="accueil__liveChipCrestFb" />}
        <span className="accueil__liveChipScore">{hs ?? '-'} – {as_ ?? '-'}</span>
        {match.awayTeam?.crest
          ? <div className="accueil__liveChipCrestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="accueil__liveChipCrest" data-team={match.awayTeam?.name} /></div>
          : <div className="accueil__liveChipCrestFb" />}
      </div>
      <span className={`accueil__liveChipMinute${isTermine ? ' accueil__liveChipMinute--ft' : ''}`}>
        {minute}
      </span>
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

  // Un seul match en direct → on réutilise la MÊME carte que sur les autres
  // pages (Programme, Résultats...) plutôt qu'un design maison : garantit un
  // rendu identique (drapeaux ronds, nom sous le drapeau) partout dans l'app.
  // noAnimation : la notif/animation de but reste gérée uniquement côté cron
  // (voir CLAUDE.md — source unique des notifs), pas ici en double.
  if (live.length === 1) {
    const m = live[0]
    return (
      <div className="accueil__matchCardClickable" onClick={() => onMatchClick?.(m)}>
        <MatchCard match={m} espnScore={espnScores[m.id] ?? null} noAnimation />
      </div>
    )
  }

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
