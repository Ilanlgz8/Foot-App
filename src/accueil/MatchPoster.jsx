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

function safeHex(color) {
  return typeof color === 'string' && color.startsWith('#')
    ? color
    : null
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

  // 🎨 couleurs RAW
  const rawHome = safeHex(getTeamColor(homeKey))
  const rawAway = safeHex(getTeamColor(awayKey))

  // 🎯 fallback garanti (JAMAIS undefined)
  const homeColor = rawHome || '#2a3a4a'
  let awayColor = rawAway || '#3a506b'

  // ⚠️ anti clash
  if (homeColor === awayColor) {
    awayColor = '#4f6d7a'
  }

  // 🌈 gradient SAFE (sans crash possible)
  let gradient
  try {
    gradient = getTeamGradient
      ? getMatchGradient(homeColor, awayColor)
      : `linear-gradient(135deg, ${homeColor}, ${awayColor})`
  } catch {
    gradient = `linear-gradient(135deg, ${homeColor}, ${awayColor})`
  }

  const photo =
    getTeamPhoto(match.homeTeam?.name) ||
    getTeamPhoto(match.awayTeam?.name)

  const homeShort = translateTeam(match.homeTeam?.shortName || homeName)
  const awayShort = translateTeam(match.awayTeam?.shortName || awayName)

  const homeScore = espnScore?.home ?? match.score?.fullTime?.home
  const awayScore = espnScore?.away ?? match.score?.fullTime?.away

  const minute = isLive ? calcMinute(match) : null

  const cls =
    'poster' +
    (isLive ? ' poster--live' : isFinished ? ' poster--ft' : '')

  return (
    <div
      className="poster__frame"
      style={{
        '--hc': homeColor,
        '--ac': awayColor
      }}
    >
      <div
        className={cls}
        onClick={onClick}
        style={{ cursor: onClick ? 'pointer' : 'default' }}
      >

        {/* BACKGROUND (inchangé CSS) */}
        {photo ? (
          <div
            className="poster__bg poster__bg--photo"
            style={{ backgroundImage: `url('${photo}')` }}
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
            <div className="poster__live-pill">
              <span className="poster__live-dot" />
              LIVE
            </div>
          ) : (
            <span className="poster__comp-name">
              {match.competition?.name ?? ''}
            </span>
          )}
        </div>

        {/* MIDDLE (TOUT INCHANGÉ CSS) */}
        <div className="poster__middle">

          <div className="poster__team-col poster__team-col--home">
            {match.homeTeam?.crest && (
              <img
                className="poster__crest"
                src={match.homeTeam.crest}
                alt=""
                onError={e => (e.currentTarget.style.display = 'none')}
              />
            )}
            <span className="poster__name poster__name--home">
              {homeShort}
            </span>
          </div>

          <div className="poster__center">
            {isLive && minute && (
              <div className="poster__min-label">
                {minute === 'MT' ? 'Mi-temps' : `${minute}'`}
              </div>
            )}

            {isUpcoming && <div className="poster__env-label">Kick-off</div>}
            {isFinished && <div className="poster__env-label">FT</div>}

            {isLive || isFinished ? (
              <div className="poster__score">
                {homeScore ?? 0} – {awayScore ?? 0}
              </div>
            ) : (
              <div className="poster__time">
                {formatHour(match.utcDate)}
              </div>
            )}
          </div>

          <div className="poster__team-col poster__team-col--away">
            {match.awayTeam?.crest && (
              <img
                className="poster__crest"
                src={match.awayTeam.crest}
                alt=""
                onError={e => (e.currentTarget.style.display = 'none')}
              />
            )}
            <span className="poster__name poster__name--away">
              {awayShort}
            </span>
          </div>

        </div>

        {/* PRONO (inchangé CSS) */}
        <div className="poster__footer">
          <div className="poster__prono-labels">
            <span className="poster__lbl" style={{ width: `${prono.home}%` }}>
              {homeShort} {prono.home}%
            </span>

            <span className="poster__lbl" style={{ width: `${prono.draw}%` }}>
              Nul {prono.draw}%
            </span>

            <span className="poster__lbl" style={{ width: `${prono.away}%` }}>
              {awayShort} {prono.away}%
            </span>
          </div>

          <div className="poster__prono-bar">
            <div style={{ width: `${prono.home}%`, background: homeColor }} />
            <div style={{ width: `${prono.draw}%` }} />
            <div style={{ width: `${prono.away}%`, background: awayColor }} />
          </div>
        </div>

      </div>
    </div>
  )
}