import bundesligaLogo from '../assets/leagues/bundesliga.svg'
import laligaLogo from '../assets/leagues/laliga-ea-sports.svg'
import ligue1Logo from '../assets/leagues/ligue-1-mcdonalds.svg'
import premierLeagueLogo from '../assets/leagues/premier-league.svg'
import serieALogo from '../assets/leagues/serie-a-enilive.svg'
import worldCupLogo from '../assets/leagues/coupe-du-monde.png'
import championsLeagueLogo from '../assets/leagues/ldc.png'
import europaLeagueLogo from '../assets/leagues/europa-league.png'
import conferenceLeagueLogo from '../assets/leagues/conference-league.png'
// Vrais logos ajoutés par l'utilisateur (12/07) : CAF (logo officiel de la
// confédération, utilisé génériquement pour la CAN comme il n'existe pas de
// logo CAN intemporel — pratique standard, ex. beIN/RMC Sport) + Nations
// League (logo UEFA générique, pas lié à une édition précise). Fond
// blanc/damier d'origine retiré (détourage transparent) — voir le fichier
// caf-can.png nettoyé, le webp Nations League avait déjà une vraie
// transparence.
import nationsLeagueLogo from '../assets/leagues/nations-league-real.png'
import canLogo from '../assets/leagues/caf-can.png'
// Pas de logo officiel utilisable pour l'instant (voir explication donnée à
// l'utilisateur) : badges simples dessinés maison (couleurs distinctes par
// compétition), à remplacer si un vrai logo propre (fond réellement
// transparent, pas d'édition/année précise) est fourni un jour.
// - Euro : le fichier fourni (Logo_UEFA_Euro_2024.svg) est celui de l'UEFA
//   EURO 2024 ALLEMAGNE — spécifique à cette édition (déjà terminée), pas un
//   logo générique "Euro".
// - Copa America : le fichier fourni (jpg) a un fond "damier transparent" en
//   réalité cuit dans les pixels (site source), impossible à détourer
//   proprement car le trophée blanc se confond avec ce fond — tentative de
//   nettoyage automatique a mangé une partie du trophée.
import euroLogo from '../assets/leagues/euro.svg'
import copaAmericaLogo from '../assets/leagues/copa-america.svg'


// Slug ESPN correspondant à chaque compétition — c'est cet identifiant que
// cron-goals.js utilise pour boucler sur les matchs (ESPN_SLUGS), donc c'est
// ce qu'on stocke comme favori côté abonnement push (voir useFavoriteComps.js)
// pour un filtre serveur simple, sans ambiguïté de nom d'équipe/traduction.
export const COMPETITION_ESPN_SLUG = {
  FL1: 'fra.1',
  PL:  'eng.1',
  PD:  'esp.1',
  BL1: 'ger.1',
  SA:  'ita.1',
  CL:  'uefa.champions',
  WC:  'fifa.world',
  EC:  'uefa.euro',
  NL:  'uefa.nations',
  CAN: 'caf.nations',
  COPA: 'conmebol.america',
}

// Coupes nationales — non couvertes par football-data.org en free tier (voir
// CLAUDE.md), sourcées via ESPN et fusionnées DANS l'onglet du championnat
// parent (pas d'entrée sidebar dédiée, contrairement à NL/CAN/COPA/EC) —
// demande explicite : "dans ligue 1 on rajoute coupe de france mais à
// l'intérieur de ligue 1, sur les cards on précise juste le nom de la coupe".
export const DOMESTIC_CUPS = {
  FL1: { slug: 'fra.coupe_de_france', name: 'Coupe de France' },
  PD:  { slug: 'esp.copa_del_rey',    name: 'Copa del Rey' },
  PL:  { slug: 'eng.fa',              name: 'FA Cup' },
}

// Compétitions sourcées via ESPN (pas football-data.org, voir espnAdapter.js)
// : pas de classement/buteurs pour l'instant (ESPN n'expose pas proprement la
// structure de groupe sur son scoreboard) — utilisé par Classement.jsx et
// FavoritesPage.jsx pour ne pas proposer un classement qui n'existe pas.
export const NO_STANDINGS_COMPS = new Set(['NL', 'CAN', 'COPA'])

export const COMPETITIONS = [
  {
    id: 'FL1',
    name: "Ligue 1 McDonald's",
    shortName: 'Ligue 1',
    emblem: ligue1Logo,
  },
  {
    id: 'PL',
    name: 'Premier League',
    shortName: 'Premier L.',
    emblem: premierLeagueLogo,
  },
  {
    id: 'PD',
    name: 'LALIGA EA SPORTS',
    shortName: 'LaLiga',
    emblem: laligaLogo,
  },
  {
    id: 'BL1',
    name: 'Bundesliga',
    shortName: 'Bundesliga',
    emblem: bundesligaLogo,
  },
  {
    id: 'SA',
    name: 'Serie A Enilive',
    shortName: 'Serie A',
    emblem: serieALogo,
  },
  {
    id: 'CL',
    name: 'Ligue des Champions',
    shortName: 'C. League',
    emblem: championsLeagueLogo,
  },
  {
    id: 'WC',
    name: 'Coupe du Monde',
    shortName: 'Mondial',
    emblem: worldCupLogo,
  },
  {
    id: 'EC',
    name: 'Euro',
    shortName: 'Euro',
    emblem: euroLogo,
  },
  {
    id: 'NL',
    name: 'Ligue des Nations',
    shortName: 'Nations L.',
    emblem: nationsLeagueLogo,
  },
  {
    id: 'CAN',
    name: 'Coupe d’Afrique des Nations',
    shortName: 'CAN',
    emblem: canLogo,
  },
  {
    id: 'COPA',
    name: 'Copa America',
    shortName: 'Copa America',
    emblem: copaAmericaLogo,
  },
]
