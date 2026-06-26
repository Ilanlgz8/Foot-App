import { translateTeam } from '../data/teamNames'
import { calcMinute } from '../utils/matchUtils'
import { getMatchState } from '../utils/matchStateTracker'
import { calcProno } from '../utils/calcProno'
import {
  getTeamColor,
  getTeamSecondaryColor,
  getTeamPhoto,
  getMatchGradient
} from '../data/teamPhotos'
import { useTeamForm } from '../hooks/useTeamForm'

/* ─────────────────────────────
   🧠 utils robustes couleurs
───────────────────────────── */

function normalize(name = '') {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/fc|cf|sc|afc/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getSafeColor(primary, secondary, fallback) {
  return primary || secondary || fallback
}

function shiftColor(hex, amount = 25) {
  // fallback safe simple (sans lib)
  // décale légèrement visuellement si clash
  if (!hex?.startsWith('#')) return hex
  return hex + (amount > 0 ? 'cc' : 'aa') // pseudo variation opacity-like
}

/* ───────────────────────────── */

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

  const espnLive =
    ms.espnStatus === 'STATUS_IN_PROGRESS' ||
    ms.espnStatus === 'STATUS_HALFTIME' ||
    ms.espnStatus === 'STATUS_END_PERIOD'

  const isFinished =
    ms.ft === true ||
    (match.status === 'FINISHED' && !espnLive)

  const isLive =
    !isFinished &&
    (match.status === 'IN_PLAY' ||
      match.status === 'PAUSED' ||
      match.status === 'HALFTIME' ||
      espnLive)

  const isUpcoming = !isFinished && !isLive

  const homeScore = espnScore?.home ?? match.score?.fullTime?.home
  const awayScore = espnScore?.away ?? match.score?.fullTime?.away
  const minute = isLive ? calcMinute(match) : null

  const homeName = match.homeTeam?.name ?? ''
  const awayName = match.awayTeam?.name ?? ''

  const hForm = formMap?.[match.homeTeam?.id] ?? []
  const aForm = formMap?.[match.awayTeam?.id] ?? []
  const prono = calcProno(hForm, aForm)

  /* ─────────────────────────────
     🎯 clés normalisées
  ───────────────────────────── */
  const homeKey = normalize(translateTeam(match.homeTeam?.shortName || homeName))
  const awayKey = normalize(translateTeam(match.awayTeam?.shortName || awayName))

  /* ─────────────────────────────
     🎨 couleurs intelligentes
  ───────────────────────────── */

  let homeColor = getTeamColor(homeKey)
  let awayColor = getTeamColor(awayKey)

  const homeSecondary = getTeamSecondaryColor?.(homeKey)
  const awaySecondary = getTeamSecondaryColor?.(awayKey)

  homeColor = getSafeColor(homeColor, homeSecondary, '#2a3a4a')
  awayColor = getSafeColor(awayColor, awaySecondary, '#2a3a4a')

  /* ⚠️ anti clash couleurs */
  if (homeColor === awayColor) {
    awayColor =
      awaySecondary ||
      shiftColor(awayColor, 25)
  }

  /* ─────────────────────────────
     🖼 background
  ───────────────────────────── */

  const favHome = prono.home >= prono.away
  const favName = favHome ? homeName : awayName
  const photo = getTeamPhoto(favName)

  const gradient = getMatchGradient(homeColor, awayColor)

  const homeShort = translateTeam(match.homeTeam?.shortName || homeName)
  const awayShort = translateTeam(match.awayTeam?.shortName || awayName)

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

        {/* ───── BACKGROUND ───── */}
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

        {/* ───── TOP BAR ───── */}
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

        {/* ───── MAIN ───── */}
        <div className="poster__middle">

          {/* HOME */}
          <div className="poster__team-col">
            {match.homeTeam?.crest && (
              <img
                className="poster__crest"
                src={match.homeTeam.crest}
                alt=""
                onError={e => (e.currentTarget.style.display = 'none')}
              />
            )}
            <span className="poster__name">{homeShort}</span>
          </div>

          {/* CENTER */}
          <div className="poster__center">
            {isLive && minute && (
              <div className="poster__min">{minute === 'MT' ? 'MT' : `${minute}'`}</div>
            )}

            {isUpcoming && <div className="poster__status">Kick-off</div>}
            {isFinished && <div className="poster__status">FT</div>}

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

          {/* AWAY */}
          <div className="poster__team-col">
            {match.awayTeam?.crest && (
              <img
                className="poster__crest"
                src={match.awayTeam.crest}
                alt=""
                onError={e => (e.currentTarget.style.display = 'none')}
              />
            )}
            <span className="poster__name">{awayShort}</span>
          </div>
        </div>

        {/* ───── PRONO BAR ───── */}
        <div className="poster__footer">
          <div className="poster__bar">
            <div style={{ width: `${prono.home}%`, background: homeColor }} />
            <div style={{ width: `${prono.draw}%` }} />
            <div style={{ width: `${prono.away}%`, background: awayColor }} />
          </div>

          <div className="poster__labels">
            <span>{homeShort} {prono.home}%</span>
            <span>Nul {prono.draw}%</span>
            <span>{awayShort} {prono.away}%</span>
          </div>
        </div>

      </div>
    </div>
  )
}