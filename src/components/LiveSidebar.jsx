/**
 * LiveSidebar — colonne de droite sur LiveMatchPage en desktop.
 * Liste tous les matchs en direct (score, équipes, crests) — clic sur un
 * widget navigue vers /live/:id. Masquée en mobile (voir .lmp__sidebar dans
 * LiveMatchPage.css) : sur petit écran il n'y a simplement pas la place, et
 * /live existe déjà pour parcourir tous les matchs en cours.
 * Réutilise les mêmes helpers que Live.jsx/LiveMatchPage.jsx (calcMinute,
 * getMatchPeriod, mergeScore, finalScore) — zéro fetch supplémentaire, ça
 * pioche dans le state déjà tenu à jour par LiveProvider.
 */
import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useLiveData } from '../context/LiveProvider'
import { getMatchState, isRecentlyFinished } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod, mergeScore, finalScore , isNationalTeamComp } from '../utils/matchUtils'
import { translateTeam } from '../data/teamNames'
import { TEAM_SHORT } from '../data/teamShortNames'

function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 14) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0]}. ${words.slice(1).join(' ')}`
}

function SidebarRow({ match, isActive, onClick }) {
  const matchSt   = getMatchState(match.id)
  const isTermine = matchSt.ft === true

  // Ticker 5s — même logique que LiveCard/MatchHeader, pour que la minute
  // avance sans attendre le prochain poll ESPN.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (isTermine) return
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [isTermine])

  const minute = isTermine ? null : calcMinute(match)
  const period = getMatchPeriod(match)
  const label  = isTermine ? 'Terminé' : (period ?? minute ?? 'À suivre')

  const fs  = finalScore(match.score)
  const hs  = mergeScore(match._espn?.home, fs.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(match._espn?.away, fs.away ?? match.score?.halfTime?.away)

  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))
  const isWC = isNationalTeamComp(match)

  return (
    <button
      className={`lmpSide__row${isActive ? ' lmpSide__row--active' : ''}`}
      onClick={onClick}
    >
      <span className={`lmpSide__badge${isTermine ? ' lmpSide__badge--ft' : ''}`}>{label}</span>
      <span className="lmpSide__team">
        {match.homeTeam?.crest
          ? <span className="lmpSide__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="lmpSide__crest" /></span>
          : <span className="lmpSide__crestFb">{homeName?.[0] ?? ''}</span>}
        <span className="lmpSide__name">{homeName}</span>
        <span className="lmpSide__score">{hs ?? '-'}</span>
      </span>
      <span className="lmpSide__team">
        {match.awayTeam?.crest
          ? <span className="lmpSide__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="lmpSide__crest" /></span>
          : <span className="lmpSide__crestFb">{awayName?.[0] ?? ''}</span>}
        <span className="lmpSide__name">{awayName}</span>
        <span className="lmpSide__score">{as_ ?? '-'}</span>
      </span>
    </button>
  )
}

export function LiveSidebar({ activeMatchId }) {
  const navigate = useNavigate()
  const { liveMatches, espnScores } = useLiveData()

  // Même ticker dédié que Live.jsx — voir commentaire là-bas.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!liveMatches.some(m => isRecentlyFinished(m.id))) return
    const id = setInterval(() => {
      forceTick(n => n + 1)
      if (!liveMatches.some(m => isRecentlyFinished(m.id))) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [liveMatches])

  const matches = liveMatches
    .filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED' || isRecentlyFinished(m.id))
    .map(m => ({ ...m, _espn: espnScores[m.id] ?? null }))

  if (matches.length === 0) return null

  return (
    <aside className="lmpSide">
      <div className="lmpSide__header">
        <span className="lmpSide__headerDot" />
        <span className="lmpSide__headerTitle">En direct</span>
        <span className="lmpSide__headerCount">{matches.length}</span>
      </div>
      <div className="lmpSide__list">
        {matches.map(m => (
          <SidebarRow
            key={m.id}
            match={m}
            isActive={String(m.id) === String(activeMatchId)}
            onClick={() => navigate(`/live/${m.id}`)}
          />
        ))}
      </div>
    </aside>
  )
}
