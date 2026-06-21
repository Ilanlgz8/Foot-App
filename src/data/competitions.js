import bundesligaLogo from '../assets/leagues/bundesliga.svg'
import laligaLogo from '../assets/leagues/laliga-ea-sports.svg'
import ligue1Logo from '../assets/leagues/ligue-1-mcdonalds.svg'
import premierLeagueLogo from '../assets/leagues/premier-league.svg'
import serieALogo from '../assets/leagues/serie-a-enilive.svg'
import worldCupLogo from '../assets/leagues/coupe-du-monde.png'
import championsLeagueLogo from '../assets/leagues/ldc.png'
import europaLeagueLogo from '../assets/leagues/europa-league.png'
import conferenceLeagueLogo from '../assets/leagues/conference-league.png'


export const COMPETITIONS = [
  {
    id: ‘FL1’,
    name: ‘Ligue 1 McDonald’s’,
    shortName: ‘Ligue 1’,
    emblem: ligue1Logo,
  },
  {
    id: ‘PL’,
    name: ‘Premier League’,
    shortName: ‘Premier L.’,
    emblem: premierLeagueLogo,
  },
  {
    id: ‘PD’,
    name: ‘LALIGA EA SPORTS’,
    shortName: ‘LaLiga’,
    emblem: laligaLogo,
  },
  {
    id: ‘BL1’,
    name: ‘Bundesliga’,
    shortName: ‘Bundesliga’,
    emblem: bundesligaLogo,
  },
  {
    id: ‘SA’,
    name: ‘Serie A Enilive’,
    shortName: ‘Serie A’,
    emblem: serieALogo,
  },
  {
    id: ‘CL’,
    name: ‘Ligue des Champions’,
    shortName: ‘C. League’,
    emblem: championsLeagueLogo,
  },
  {
    id: ‘WC’,
    name: ‘Coupe du Monde’,
    shortName: ‘Mondial’,
    emblem: worldCupLogo,
  },
]
