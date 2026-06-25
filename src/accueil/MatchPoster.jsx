import { translateTeam }            from '../data/teamNames'
import { calcMinute }               from '../utils/matchUtils'
import { getMatchState }             from '../utils/matchStateTracker'
import { calcProno }                 from '../utils/calcProno'
import { getTeamPhoto, getTeamColor } from '../data/teamPhotos'

function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function MatchPoster({ match, espnScore = null, formMap = {}, onClick }) {
  const _ms       = getMatchState(match.id)
  const _espnLive = (
    _ms.espnStatus === 'STATUS_IN_PROGRESS' ||
    _ms.espnStatus === 'STATUS_HALFTIME'    ||
    _ms.espnStatus === 'STATUS_END_PERIOD'
  )
  const isFinished = _ms.ft === true || (match.status === 'FINISHED' && !_espnLive)
  const isLive     = !isFinished && (
    match.status === 'IN_PLAY' ||
    match.status === 'PAUSED'  ||
    match.status === 'HALFTIME'||
    _espnLive
  )
  const isUpcoming = !isFinished && !isLive

  const homeScore = espnScore?.home ?? match.score?.fullTime?.home
  const awayScore = espnScore?.away ?? match.score?.fullTime?.away
  const minute    = isLive ? calcMinute(match) : null

  const homeName = match.homeTeam?.name ?? ''
  const awayName = match.awayTeam?.name ?? ''
  const hForm    = formMap?.[match.homeTeam?.id] ?? []
  const aForm    = formMap?.[match.awayTeam?.id] ?? []
  const prono    = calcProno(hForm, aForm)

  // Photo de fond : favori (team avec le plus haut % win)
  const favName  = prono.home >= prono.away ? homeName : awayName
  const photo    = getTeamPhoto(favName) ?? getTeamPhoto(homeName) ?? null

  // Couleurs barre prono
  const hColor   = getTeamColor(homeName)
  const aColor   = getTeamColor(awayName)

  const homeShort = translateTeam(match.homeTeam?.shortName || homeName)
  const awayShort = translateTeam(match.awayTeam?.shortName || awayName)

  return (
    <div
      className={'poster' + (isLive ? ' poster--live' : isFinished ? ' poster--ft' : '')}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      {/* ── Fond ── */}
      {photo
        ? <div className="poster__photo" style={{ backgroundImage: `url('${photo}')` }} />
        : <div className="poster__photo poster__photo--nogradient" />
      }
      <div className="poster__fog" />
      <div className="poster__vignette" />

      {/* ── Badge compét (haut gauche) ── */}
      <div className="poster__comp-row">
        {isLive
          ? <div className="poster__live-pill"><span className="poster__live-dot" />En direct</div>
          : <span className="poster__comp-name">{match.competition?.name ?? ''}</span>
        }
      </div>

      {/* ── Corps ── */}
      <div className="poster__body">

        {/* Minute AU-DESSUS du score (live uniquement) */}
        {isLive && minute && (
          <div className="poster__minute-top">
            {minute === 'MT' ? 'Mi-temps' : `${minute}'`}
          </div>
        )}

        {/* Score / Heure */}
        {(isLive || isFinished)
          ? <div className="poster__score">{homeScore ?? 0} – {awayScore ?? 0}</div>
          : <div className="poster__time">{formatHour(match.utcDate)}</div>
        }

        {/* Équipes : crest + nom */}
        <div className="poster__teams">
          <div className="poster__team poster__team--home">
            {match.homeTeam?.crest && (
              <img
                className="poster__crest"
                src={match.homeTeam.crest}
                alt=""
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            )}
            <span className="poster__team-name">{homeShort}</span>
          </div>
          <div className="poster__team poster__team--away">
            {match.awayTeam?.crest && (
              <img
                className="poster__crest"
                src={match.awayTeam.crest}
                alt=""
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            )}
            <span className="poster__team-name">{awayShort}</span>
          </div>
        </div>

        {/* Sous-label */}
        <div className="poster__sub-label">
          {isFinished ? 'Terminé'
           : isLive   ? ''
           : "Coup d'envoi"}
        </div>
      </div>

      {/* ── Barre prono (footer) ── */}
      <div className="poster__footer">
        {/* Labels alignés sur les segments */}
        <div className="poster__prono-labels">
          <span className="poster__lbl poster__lbl--h" style={{ width: `${prono.home}%` }}>
            {homeShort} {prono.home}%
          </span>
          <span className="poster__lbl poster__lbl--d" style={{ width: `${prono.draw}%`, flexShrink: 0 }}>
            Nul {prono.draw}%
          </span>
          <span className="poster__lbl poster__lbl--a" style={{ width: `${prono.away}%` }}>
            {awayShort} {prono.away}%
          </span>
        </div>
        {/* Barre */}
        <div className="poster__prono-bar">
          <div className="poster__seg poster__seg--h" style={{ width: `${prono.home}%`, background: hColor }} />
          <div className="poster__seg poster__seg--d"  style={{ width: `${prono.draw}%` }} />
          <div className="poster__seg poster__seg--a" style={{ width: `${prono.away}%`, background: aColor, opacity: 0.75 }} />
        </div>
      </div>
    </div>
  )
}
