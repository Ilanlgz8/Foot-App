// MatchDuJourCard — carte "Match du jour" en haut de l'Accueil.
//
// Design validé avec l'utilisateur après plusieurs itérations : fond rouge
// intense (couleur de marque de l'app) qui plonge vers le noir, titre en
// Chakra Petch (police déjà utilisée partout ailleurs dans l'app — scores,
// badges live — donc zéro coût d'ajout), et une secousse "façon séisme" qui
// se joue UNE FOIS au montage puis s'arrête (un tremblement permanent aurait
// été fatigant à l'usage, voir discussion).
import { translateTeam } from '../data/teamNames'

const TEAM_SHORT = {
  'Union Saint-Gilloise': 'Union SG', 'Paris Saint-Germain': 'Paris SG',
  'Paris Saint-Germain FC': 'Paris SG', 'Crystal Palace': 'C. Palace',
  'Wolverhampton': 'Wolves', 'Wolverhampton Wanderers': 'Wolves',
  'Nottingham Forest': 'Nott. Forest', 'Brighton & Hove Albion': 'Brighton',
  'Brighton Hove Albion': 'Brighton', 'Newcastle United': 'Newcastle',
  'Tottenham Hotspur': 'Tottenham', 'West Ham United': 'West Ham',
  'Manchester City': 'Man. City', 'Manchester United': 'Man. United',
  'Leeds United': 'Leeds', 'Atlético Madrid': 'Atl. Madrid',
  'Athletic Bilbao': 'Ath. Bilbao', 'Real Sociedad': 'R. Sociedad',
  'Deportivo Alavés': 'Alavés', 'Rayo Vallecano': 'Rayo',
  'Bayern Munich': 'Bayern', 'Eintracht Frankfurt': 'Frankfurt',
  'Werder Brême': 'Werder', 'Werder Bremen': 'Werder',
  'Borussia Dortmund': 'Dortmund', 'Inter Milan': 'Inter',
  'Milan AC': 'Milan', 'Hellas Verona': 'Verona',
  'PSV Eindhoven': 'PSV', 'Club Brugge': 'Bruges', 'Slavia Prague': 'Slavia',
}
function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 14) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0].toUpperCase()}. ${words.slice(1).join(' ')}`
}

export function MatchDuJourCard({ match, onClick }) {
  if (!match) return null

  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))
  const kickoff  = new Date(match.utcDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  return (
    <button className="accueil__mdj" onClick={onClick}>
      <div className="accueil__mdjTitleWrap">
        <span className="accueil__mdjTitle">Match du jour</span>
        <div className="accueil__mdjUnderline" />
      </div>

      <div className="accueil__mdjTeams">
        <div className="accueil__mdjTeam">
          {match.homeTeam?.crest
            ? <img src={match.homeTeam.crest} alt="" className="accueil__mdjCrest" data-team={match.homeTeam?.name} />
            : <div className="accueil__mdjCrestFb">{homeName?.[0] ?? ''}</div>}
          <span className="accueil__mdjTeamName">{homeName}</span>
        </div>

        <div className="accueil__mdjVs">
          <span className="accueil__mdjToday">Aujourd'hui</span>
          <span className="accueil__mdjTime">{kickoff}</span>
        </div>

        <div className="accueil__mdjTeam">
          {match.awayTeam?.crest
            ? <img src={match.awayTeam.crest} alt="" className="accueil__mdjCrest" data-team={match.awayTeam?.name} />
            : <div className="accueil__mdjCrestFb">{awayName?.[0] ?? ''}</div>}
          <span className="accueil__mdjTeamName">{awayName}</span>
        </div>
      </div>
    </button>
  )
}
