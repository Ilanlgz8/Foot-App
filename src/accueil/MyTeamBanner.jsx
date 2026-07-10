// Bandeau "Mon équipe" — mis en avant tout en haut de l'Accueil quand une
// équipe favorite (useFavoriteClubs) a un match live ou à venir parmi les
// données déjà chargées par la page (voir le calcul dans Accueil.jsx).
import { translateTeam } from '../data/teamNames'
import { calcMinute, mergeScore, finalScore } from '../utils/matchUtils'
import { useFavoriteClubs } from '../hooks/useFavoriteClubs'
import { getTeamColor, hexToRgbTriplet } from '../data/teamPhotos'

function formatDate(utcDate) {
  const d = new Date(utcDate)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (day.getTime() === today.getTime())    return `Aujourd'hui ${time}`
  if (day.getTime() === tomorrow.getTime()) return `Demain ${time}`
  return `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

export function MyTeamBanner({ match, isLive, espnScore, onClick }) {
  const isWC = match.competition?.id === 2000 || match.competition?.code === 'WC'
  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  const fs = finalScore(match.score)
  const hs = mergeScore(espnScore?.home, fs.home)
  const as_ = mergeScore(espnScore?.away, fs.away)
  const minute = isLive ? calcMinute(match) : null

  // Couleur réelle de l'équipe favorite concernée (home ou away) — le bandeau
  // reprend sa teinte au lieu d'un rouge générique fixe, cohérent avec le
  // thème dynamique déjà utilisé sur les pages match (getMatchThemeVars).
  const { isFavorite } = useFavoriteClubs()
  const homeIsFav = isFavorite(match.homeTeam?.id)
  const favColor = getTeamColor(homeIsFav ? (match.homeTeam?.shortName || match.homeTeam?.name) : (match.awayTeam?.shortName || match.awayTeam?.name))
  const favColorRgb = hexToRgbTriplet(favColor)

  return (
    <button
      className="myTeamBanner"
      onClick={onClick}
      type="button"
      style={{ '--fav-team-color': favColor, '--fav-team-rgb': favColorRgb }}
    >
      <span className="myTeamBanner__kicker">
        {isLive
          ? <><span className="myTeamBanner__liveDot" />Mon équipe · en direct</>
          : 'Mon équipe · prochain match'}
      </span>
      <span className="myTeamBanner__body">
        <span className="myTeamBanner__team">
          {match.homeTeam?.crest
            ? <span className="myTeamBanner__crestWrap" data-crest={isWC ? 'country' : 'club'}>
                <img src={match.homeTeam.crest} alt="" className="myTeamBanner__crest" />
              </span>
            : <span className="myTeamBanner__crestEmpty" />}
          <span className="myTeamBanner__name">{homeName}</span>
        </span>

        {isLive && hs != null && as_ != null ? (
          <span className="myTeamBanner__score">
            {hs} – {as_}
            {minute && <span className="myTeamBanner__minute">{minute}</span>}
          </span>
        ) : (
          <span className="myTeamBanner__date">{formatDate(match.utcDate)}</span>
        )}

        <span className="myTeamBanner__team myTeamBanner__team--away">
          {match.awayTeam?.crest
            ? <span className="myTeamBanner__crestWrap" data-crest={isWC ? 'country' : 'club'}>
                <img src={match.awayTeam.crest} alt="" className="myTeamBanner__crest" />
              </span>
            : <span className="myTeamBanner__crestEmpty" />}
          <span className="myTeamBanner__name">{awayName}</span>
        </span>
      </span>
    </button>
  )
}
