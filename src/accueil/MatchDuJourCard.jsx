// MatchDuJourCard — carte "Match du jour" en haut de l'Accueil.
//
// Design validé avec l'utilisateur après plusieurs itérations : fond rouge
// intense (couleur de marque de l'app) qui plonge vers le noir, titre en
// Chakra Petch (police déjà utilisée partout ailleurs dans l'app — scores,
// badges live — donc zéro coût d'ajout), et une secousse "façon séisme" qui
// se joue UNE FOIS au montage puis s'arrête (un tremblement permanent aurait
// été fatigant à l'usage, voir discussion).
import { translateTeam } from '../data/teamNames'
import { getMatchTeamColors } from '../data/teamPhotos'
import { TEAM_SHORT } from '../data/teamShortNames'

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
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = match.competition?.id === 2000 || match.competition?.code === 'WC'

  // Couleurs réelles des deux équipes (dico curé teamPhotos) → halos latéraux
  // du hero. Le thème v2 (theme-v2.css) les consomme via var(--mdj-home/away),
  // avec repli rouge de marque si l'équipe est inconnue.
  const teamColors = getMatchTeamColors(match.homeTeam?.name, match.awayTeam?.name)

  return (
    <button
      className="accueil__mdj"
      onClick={onClick}
      style={{
        '--mdj-home': teamColors.home.main,
        '--mdj-away': teamColors.away.main,
      }}
    >
      <div className="accueil__mdjTitleWrap">
        <span className="accueil__mdjTitle">Match du jour</span>
        <div className="accueil__mdjUnderline" />
      </div>

      <div className="accueil__mdjTeams">
        <div className="accueil__mdjTeam">
          {match.homeTeam?.crest
            ? <div className="accueil__mdjCrestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="accueil__mdjCrest" data-team={match.homeTeam?.name} /></div>
            : <div className="accueil__mdjCrestFb">{homeName?.[0] ?? ''}</div>}
          <span className="accueil__mdjTeamName">{homeName}</span>
        </div>

        <div className="accueil__mdjVs">
          <span className="accueil__mdjToday">Aujourd'hui</span>
          <span className="accueil__mdjTime">{kickoff}</span>
        </div>

        <div className="accueil__mdjTeam">
          {match.awayTeam?.crest
            ? <div className="accueil__mdjCrestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="accueil__mdjCrest" data-team={match.awayTeam?.name} /></div>
            : <div className="accueil__mdjCrestFb">{awayName?.[0] ?? ''}</div>}
          <span className="accueil__mdjTeamName">{awayName}</span>
        </div>
      </div>
    </button>
  )
}
