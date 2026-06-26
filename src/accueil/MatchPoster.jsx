import { translateTeam } from '../data/teamNames'
import { calcMinute } from '../utils/matchUtils'
import { getMatchState } from '../utils/matchStateTracker'
import { calcProno } from '../utils/calcProno'
import { getTeamColor, getTeamPhoto, getMatchGradient } from '../data/teamPhotos'
import { useTeamForm } from '../hooks/useTeamForm'

function normalize(name = '') {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/fc|cf|sc|afc/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeColor(color) {
  return typeof color === 'string' && color.startsWith('#')
    ? color
    : '#2a3a4a'
}

function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function MatchPoster({ match, espnScore = null, onClick }) {
  const compCode = match.competition?.code ?? null
  const { formMap } = useTeamForm(compCode)

  const ms = getMatchState(match.id)

  const isFinished =
    ms.ft === true ||
    (match.status === 'FINISHED' && ms.espnStatus !== 'STATUS_IN_PROGRESS')

  const isLive =
    !isFinished &&
    (match.status === 'IN_PLAY' ||
      match.status === 'PAUSED' ||
      match.status === 'HALFTIME')

  const isUpcoming = !isFinished && !isLive

  const homeName = match.homeTeam?.name ?? ''
  const awayName = match.awayTeam?.name ?? ''

  const hForm = formMap?.[match.homeTeam?.id] ?? []
  const aForm = formMap?.[match.awayTeam?.id] ?? []
  const prono = calcProno(hForm, aForm)

  const homeKey = normalize(translateTeam(match.homeTeam?.shortName || homeName))
  const awayKey = normalize(translateTeam(match.awayTeam?.shortName || awayName))

  // 🎨 couleurs SAFE
  const rawHomeColor = getTeamColor(homeKey)
  const rawAwayColor = getTeamColor(awayKey)

  const homeColor = safeColor(rawHomeColor)
  let awayColor = safeColor(rawAwayColor)

  // ⚠️ si mêmes couleurs → on force différenciation
  if (homeColor === awayColor) {
    awayColor = '#4a6fa5'
  }

  // 🧠 gradient SAFE (jamais crash)
  let gradient = ''
  try {
    gradient = getMatchGradient(homeColor, awayColor)
  } catch {
    gradient = `linear-gradient(135deg, ${homeColor}, ${awayColor})`
  }

  const photo = getTeamPhoto(match.homeTeam?.name) || getTeamPhoto(match.awayTeam?.name)

  const homeShort = translateTeam(match.homeTeam?.shortName || homeName)
  const awayShort = translateTeam(match.awayTeam?.shortName || awayName)

  const homeScore = espnScore?.home ?? match.score?.fullTime?.home
  const awayScore = espnScore?.away ?? match.score?.fullTime?.away

  const minute = isLive ? calcMinute(match) : null

  return (
    <div
      className="poster__frame"
      style={{
        '--hc': homeColor,
        '--ac': awayColor
      }}
    >
      <div
        className={`poster ${isLive ? 'poster--live' : isFinished ? 'poster--ft' : ''}`}
        onClick={onClick}
      >

        {/* 🌈 BACKGROUND (toujours safe) */}
        {photo ? (
          <div
            className="poster__bg poster__bg--photo"
            style={{ backgroundImage: `url(${photo})` }}
          />
        ) : (
          <div
            className="poster__bg poster__bg--gradient"
            style={{ background: gradient }}
          />
        )}

        <div className="poster__overlay" />

        {/* TOP */}
        <div className="poster__topbar">
          {isLive ? (
            <div className="poster__live-pill">LIVE</div>
          ) : (
            <span>{match.competition?.name}</span>
          )}
        </div>

        {/* MIDDLE */}
        <div className="poster__middle">

          <div>{homeShort}</div>

          <div className="poster__center">
            {isLive && minute && <span>{minute}'</span>}

            {isUpcoming && <span>Kick-off</span>}
            {isFinished && <span>FT</span>}

            {isLive || isFinished ? (
              <strong>{homeScore ?? 0} - {awayScore ?? 0}</strong>
            ) : (
              <span>{formatHour(match.utcDate)}</span>
            )}
          </div>

          <div>{awayShort}</div>

        </div>

        {/* PRONO */}
        <div className="poster__footer">
          <div
            className="bar-home"
            style={{ width: `${prono.home}%`, background: homeColor }}
          />
          <div
            className="bar-away"
            style={{ width: `${prono.away}%`, background: awayColor }}
          />
        </div>

      </div>
    </div>
  )
}