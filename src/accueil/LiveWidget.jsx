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

// Chip compacte — utilisée seulement s'il y a PLUSIEURS matchs en direct en
// même temps. Volontairement réduite à logo + score + minute (pas de nom
// d'équipe) : avec plusieurs matchs à caser sur une ligne, le nom rendait ça
// chargé — le logo suffit à identifier l'équipe en un coup d'œil.
function LiveChip({ match, espn, onMatchClick }) {
  const matchSt   = getMatchState(match.id)
  const isTermine = matchSt.ft === true
  const minute    = isTermine ? 'FIN' : (calcMinute(match) ?? '–')

  const hs = mergeScore(espn?.home, match.score?.fullTime?.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, match.score?.fullTime?.away ?? match.score?.halfTime?.away)

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
    </button>
  )
}

// Carte pleine largeur — utilisée quand il n'y a QU'UN SEUL match en direct :
// autant de place disponible, donc on affiche noms + logos + score + minute
// en plus grand. Reste volontairement léger (pas de stats/buteurs/xG comme
// LiveCard de la page /live — sinon on retombe dans le doublon déjà constaté
// et corrigé : le widget ne doit pas dupliquer le détail de /live).
function LiveBig({ match, espn, onMatchClick }) {
  const matchSt   = getMatchState(match.id)
  const isTermine = matchSt.ft === true
  const minute    = isTermine ? 'Terminé' : (calcMinute(match) ?? '–')

  const hs = mergeScore(espn?.home, match.score?.fullTime?.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, match.score?.fullTime?.away ?? match.score?.halfTime?.away)
  const homeName = shortenName(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = shortenName(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  return (
    <button
      type="button"
      className="accueil__liveBig"
      onClick={() => onMatchClick?.(match)}
    >
      <div className="accueil__liveBigTeam">
        {match.homeTeam?.crest
          ? <img src={match.homeTeam.crest} alt="" className="accueil__liveBigCrest" />
          : <div className="accueil__liveBigCrestFb" />}
        <span className="accueil__liveBigName">{homeName}</span>
      </div>

      <div className="accueil__liveBigCenter">
        <span className={`accueil__liveBigMinute${isTermine ? ' accueil__liveBigMinute--ft' : ''}`}>{minute}</span>
        <span className="accueil__liveBigScore">{hs ?? '-'} – {as_ ?? '-'}</span>
      </div>

      <div className="accueil__liveBigTeam accueil__liveBigTeam--away">
        {match.awayTeam?.crest
          ? <img src={match.awayTeam.crest} alt="" className="accueil__liveBigCrest" />
          : <div className="accueil__liveBigCrestFb" />}
        <span className="accueil__liveBigName">{awayName}</span>
      </div>
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

  if (live.length === 1) {
    return (
      <LiveBig
        match={live[0]}
        espn={espnScores[live[0].id] ?? null}
        onMatchClick={onMatchClick}
      />
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
