// Bandeau "Mon équipe" — mis en avant tout en haut de l'Accueil quand une
// équipe favorite (useFavoriteClubs) a un match live ou à venir parmi les
// données déjà chargées par la page (voir le calcul dans Accueil.jsx).
import { translateTeam } from '../data/teamNames'
import { calcMinute, mergeScore, finalScore, isNationalTeamComp } from '../utils/matchUtils'
import { useFavoriteClubs } from '../hooks/useFavoriteClubs'
import { getTeamColor, hexToRgbTriplet } from '../data/teamPhotos'
import { useState } from 'react'
import { CalendarSheet } from '../components/MatchActions'
import { matchEventInfo, isAdded, markAdded } from '../utils/calendarEvent'
import { getBroadcaster } from '../data/broadcasters'
import { compForMatch } from '../data/competitions'

// 22/11 : « Ajouter au calendrier » sur le prochain match d'une équipe favorite, s'il a lieu dans les
// 7 jours. Une fois ajouté, le bouton devient « ✓ Ajouté » pour ce match — mémorisé sur le téléphone
// (calendarEvent.js, survit à la fermeture de l'app), donc jamais proposé deux fois.
const CAL_WINDOW_MS = 7 * 86400000

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
  const isWC = isNationalTeamComp(match)
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

  const [added, setAdded] = useState(() => isAdded(match.id))
  const [sheet, setSheet] = useState(false)
  const startsIn = new Date(match.utcDate).getTime() - Date.now()
  const showCal = !isLive && startsIn > 0 && startsIn < CAL_WINDOW_MS
  const compName = compForMatch(match)?.name ?? match.competition?.name ?? ''
  const ev = showCal ? matchEventInfo({
    id: match.id, homeName, awayName, utcDate: match.utcDate,
    compLabel: `${compName}${match.matchday ? ` · Journée ${match.matchday}` : ''}`.trim(),
    channel: getBroadcaster(match)?.name ?? null,
    homeCrest: match.homeTeam?.crest, awayCrest: match.awayTeam?.crest,
  }) : null

  return (
    <div className="myTeamBannerWrap">
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
                <img src={match.homeTeam.crest} alt="" className="myTeamBanner__crest" data-team={match.homeTeam?.name} />
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
                <img src={match.awayTeam.crest} alt="" className="myTeamBanner__crest" data-team={match.awayTeam?.name} />
              </span>
            : <span className="myTeamBanner__crestEmpty" />}
          <span className="myTeamBanner__name">{awayName}</span>
        </span>
      </span>
    </button>
    {ev && (added
      ? <span className="myTeamBanner__cal myTeamBanner__cal--done">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          Dans l'agenda
        </span>
      : <button type="button" className="myTeamBanner__cal" onClick={() => setSheet(true)}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
          Ajouter
        </button>)}
    {sheet && ev && (
      <CalendarSheet ev={ev} onClose={() => setSheet(false)}
        onDone={() => { markAdded(match.id); setAdded(true); setSheet(false) }} />
    )}
    </div>
  )
}
