import { useState }                   from 'react'
import { translateTeam }              from '../data/teamNames'
import { calcMinute, mergeScore }     from '../utils/matchUtils'
import { getMatchState }              from '../utils/matchStateTracker'
import { calcProno }                  from '../utils/calcProno'
import { getMatchTeamColors, buildMatchGradient, buildMatchGradientAlt } from '../data/teamPhotos'
import { useTeamForm }                from '../hooks/useTeamForm'

function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function MatchPoster({ match, espnScore = null, onClick }) {
  // Vrai formMap depuis football-data.org pour cette compétition
  const compCode = match.competition?.code ?? null
  const { formMap } = useTeamForm(compCode)

  // Fallback initiale si le crest ne charge pas (404, image cassée)
  const [homeCrestError, setHomeCrestError] = useState(false)
  const [awayCrestError, setAwayCrestError] = useState(false)

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

  const homeScore = mergeScore(espnScore?.home, match.score?.fullTime?.home)
  const awayScore = mergeScore(espnScore?.away, match.score?.fullTime?.away)
  const minute    = isLive ? calcMinute(match) : null

  const homeName  = match.homeTeam?.name ?? ''
  const awayName  = match.awayTeam?.name ?? ''
  const hForm     = formMap?.[match.homeTeam?.id] ?? []
  const aForm     = formMap?.[match.awayTeam?.id] ?? []
  const prono     = calcProno(hForm, aForm)

  // Fond : dégradé couleurs des deux équipes (anti-collision) — plus de photo
  // hardcodée : elle masquait systématiquement les couleurs pour toute la trentaine
  // de pays "populaires" pré-photographiés (très fréquent en Coupe du Monde), ce qui
  // donnait l'impression que "les couleurs ne s'affichent jamais".
  const { home: homeColors, away: awayColors } = getMatchTeamColors(homeName, awayName)
  const hColor     = homeColors.main
  const aColor     = awayColors.main
  const gradient    = buildMatchGradient(homeColors, awayColors)
  const gradientAlt = buildMatchGradientAlt(homeColors, awayColors)

  const homeShort = translateTeam(match.homeTeam?.shortName || homeName)
  const awayShort = translateTeam(match.awayTeam?.shortName || awayName)

  const cls = 'poster' + (isLive ? ' poster--live' : isFinished ? ' poster--ft' : '')

  return (
    <div className="poster__frame" style={{ '--hc': hColor ?? '#2a3a4a', '--ac': aColor ?? '#2a3a4a' }}>
    <div className={cls} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>

      {/* ── Fond : dégradé couleurs des équipes, en 2 calques qui se fondent l'un
          dans l'autre ──
          Calque 1 (toujours visible) : couleur principale de chaque équipe en
          dégradé, qui glisse lentement (drift).
          Calque 2 (apparaît/disparaît en fondu par-dessus) : même dégradé mais
          avec la couleur secondaire ("accent") de chaque équipe mise en avant —
          au lieu d'un simple panoramique, la palette dominante change vraiment.
          ⚠️ background-size DOIT être fixé ici en inline, pas seulement en CSS :
          la propriété raccourcie "background" posée en style inline réinitialise
          silencieusement ses sous-propriétés (background-size, -position…) à leur
          valeur initiale avec la priorité la plus haute, ce qui annulait purement
          et simplement toute animation de drift définie seulement en CSS
          (background-size restait à "auto" = plein cadre → aucun mouvement
          possible, quelle que soit l'amplitude choisie). */}
      <div className="poster__bg poster__bg--gradient" style={{ background: gradient, backgroundSize: '320% 320%' }} />
      <div className="poster__bg poster__bg--gradientAlt" style={{ background: gradientAlt, backgroundSize: '320% 320%' }} />
      <div className="poster__overlay" />

      {/* ── Badge compét / live ── */}
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

        <div className="poster__team-col poster__team-col--home">
          {match.homeTeam?.crest && !homeCrestError
            ? <div className="poster__crestWrap"><img className="poster__crest" src={match.homeTeam.crest} alt=""
                onError={() => setHomeCrestError(true)} /></div>
            : <div className="poster__crest-empty">{homeShort?.[0] ?? ''}</div>
          }
          <span className="poster__name poster__name--home">{homeShort}</span>
        </div>

        <div className="poster__center">
          {isLive && minute && (
            <div className="poster__min-label">
              {/* calcMinute() renvoie déjà des libellés complets pour les états
                  spéciaux (MT/Pause/TAB/Débute) et inclut déjà l'apostrophe pour
                  les minutes chiffrées ("91'") — ne jamais en rajouter une. */}
              {minute === 'MT' ? 'Mi-temps' : minute}
            </div>
          )}
          {isUpcoming && <div className="poster__env-label">Coup d&apos;envoi</div>}
          {isFinished  && <div className="poster__env-label">Terminé</div>}
          {(isLive || isFinished)
            ? <div className="poster__score">{homeScore ?? 0} – {awayScore ?? 0}</div>
            : <div className="poster__time">{formatHour(match.utcDate)}</div>
          }
        </div>

        <div className="poster__team-col poster__team-col--away">
          {match.awayTeam?.crest && !awayCrestError
            ? <div className="poster__crestWrap"><img className="poster__crest" src={match.awayTeam.crest} alt=""
                onError={() => setAwayCrestError(true)} /></div>
            : <div className="poster__crest-empty">{awayShort?.[0] ?? ''}</div>
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
    </div>
  )
}
