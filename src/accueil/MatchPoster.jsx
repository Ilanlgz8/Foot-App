import { translateTeam }             from '../data/teamNames'
import { calcMinute }                from '../utils/matchUtils'
import { getMatchState }              from '../utils/matchStateTracker'
import { calcProno }                  from '../utils/calcProno'
import { getTeamColor }               from '../data/teamPhotos'
import { useTeamPhoto }               from '../hooks/useTeamPhoto'
import { useTeamForm }                from '../hooks/useTeamForm'

function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function MatchPoster({ match, espnScore = null, onClick }) {
  // Charger le formMap de la compétition de CE match
  // React Query déduplique : N posters de la même compét → 1 seule requête
  const compCode = match.competition?.code ?? null
  const { formMap } = useTeamForm(compCode)

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

  const homeName  = match.homeTeam?.name ?? ''
  const awayName  = match.awayTeam?.name ?? ''
  const hForm     = formMap?.[match.homeTeam?.id] ?? []
  const aForm     = formMap?.[match.awayTeam?.id] ?? []
  const prono     = calcProno(hForm, aForm)

  // Photo Wikipedia de chaque équipe (API REST, cache 7j localStorage)
  const { data: homePhoto } = useTeamPhoto(homeName)
  const { data: awayPhoto } = useTeamPhoto(awayName)

  // Favori → on met sa photo en fond. Fallback = crest flouté
  const isFavHome = prono.home >= prono.away
  const wikiPhoto  = isFavHome ? homePhoto : awayPhoto
  const favCrest   = isFavHome ? match.homeTeam?.crest : match.awayTeam?.crest

  // Couleurs barre prono
  const hColor    = getTeamColor(homeName)
  const aColor    = getTeamColor(awayName)

  const homeShort = translateTeam(match.homeTeam?.shortName || homeName)
  const awayShort = translateTeam(match.awayTeam?.shortName || awayName)

  const cls = 'poster' + (isLive ? ' poster--live' : isFinished ? ' poster--ft' : '')

  return (
    <div className={cls} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>

      {/* ── Fond : photo Wikipedia si dispo, sinon crest flouté ── */}
      <div
        className={'poster__bg' + (wikiPhoto ? ' poster__bg--photo' : '')}
        style={{ backgroundImage: `url('${wikiPhoto ?? favCrest ?? ''}')` }}
      />
      <div className="poster__overlay" />

      {/* ── Badge compét / live (haut gauche) ── */}
      <div className="poster__topbar">
        {isLive
          ? <div className="poster__live-pill">
              <span className="poster__live-dot" />En direct
            </div>
          : <span className="poster__comp-name">{match.competition?.name ?? ''}</span>
        }
      </div>

      {/* ── Bloc central : [crest+nom] | [label+temps] | [crest+nom] ── */}
      <div className="poster__middle">

        {/* Équipe domicile — gauche */}
        <div className="poster__team-col poster__team-col--home">
          {match.homeTeam?.crest
            ? <img className="poster__crest" src={match.homeTeam.crest} alt=""
                onError={e => { e.currentTarget.style.display = 'none' }} />
            : <div className="poster__crest-empty" />
          }
          <span className="poster__name poster__name--home">{homeShort}</span>
        </div>

        {/* Centre : label + temps/score */}
        <div className="poster__center">
          {isLive && minute && (
            <div className="poster__min-label">
              {minute === 'MT' ? 'Mi-temps' : `${minute}'`}
            </div>
          )}
          {isUpcoming && <div className="poster__env-label">Coup d&apos;envoi</div>}
          {isFinished  && <div className="poster__env-label">Terminé</div>}
          {(isLive || isFinished)
            ? <div className="poster__score">{homeScore ?? 0} – {awayScore ?? 0}</div>
            : <div className="poster__time">{formatHour(match.utcDate)}</div>
          }
        </div>

        {/* Équipe extérieure — droite */}
        <div className="poster__team-col poster__team-col--away">
          {match.awayTeam?.crest
            ? <img className="poster__crest" src={match.awayTeam.crest} alt=""
                onError={e => { e.currentTarget.style.display = 'none' }} />
            : <div className="poster__crest-empty" />
          }
          <span className="poster__name poster__name--away">{awayShort}</span>
        </div>

      </div>

      {/* ── Barre prono ── */}
      <div className="poster__footer">
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
        <div className="poster__prono-bar">
          <div className="poster__seg poster__seg--h" style={{ width: `${prono.home}%`, background: hColor }} />
          <div className="poster__seg poster__seg--d"  style={{ width: `${prono.draw}%` }} />
          <div className="poster__seg poster__seg--a" style={{ width: `${prono.away}%`, background: aColor, opacity: 0.75 }} />
        </div>
      </div>
    </div>
  )
}
