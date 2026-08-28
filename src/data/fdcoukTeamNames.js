/**
 * fdcoukTeamNames.js — correspondance nom d'équipe football-data.org (FD.org,
 * shortName — même clé que TEAM_NAMES_FR dans teamNames.js) → nom exact
 * utilisé par football-data.co.uk (PAS football-data.org — site différent,
 * voir commentaire dans api/h2h.js) dans ses fichiers CSV historiques.
 *
 * ⚠️ Portée VOLONTAIREMENT PARTIELLE, PAS un mapping exhaustif inventé :
 * chaque valeur ci-dessous a été vérifiée en récupérant en direct un vrai
 * fichier CSV football-data.co.uk (saison 2026-2027, ou 2025-2026 pour la
 * Bundesliga — le fichier D1 2026-2027 n'existe pas encore sur le site au
 * 28/08) et en lisant les noms d'équipe RÉELLEMENT utilisés dedans, plutôt
 * que devinés depuis la mémoire. Les clubs absents d'ici (ex. promus très
 * récents pas encore dans teamNames.js, comme Le Mans/Troyes en Ligue 1 ou
 * Coventry/Hull/Ipswich en Premier League au moment de cet ajout) n'ont
 * simplement pas de H2H multi-années disponible — dégradation silencieuse et
 * sûre (voir api/h2h.js), jamais une correspondance fausse.
 *
 * Utilisation : les clés sont les MÊMES chaînes déjà utilisées comme clés
 * dans TEAM_NAMES_FR (teamNames.js) — réutilisées ici plutôt que dupliquées,
 * donc same shortName FD.org des 2 côtés.
 */
export const FDCOUK_TEAM_NAMES = {
  // Ligue 1 — vérifié via mmz4281/2627/F1.csv
  'Stade Rennais':  'Rennes',
  'Marseille':      'Marseille',
  'RC Lens':        'Lens',
  'Olympique Lyon': 'Lyon',
  'Monaco':         'Monaco',
  'Le Havre':       'Le Havre',
  'Nice':           'Nice',
  'Toulouse':       'Toulouse',
  'Brest':          'Brest',
  'Lille':          'Lille',
  'Auxerre':        'Auxerre',
  'Lorient':        'Lorient',
  'FC Metz':        'Metz',
  'Strasbourg':     'Strasbourg',
  'Angers SCO':     'Angers',
  'Paris FC':       'Paris FC',
  'Nantes':         'Nantes',
  'PSG':            'Paris SG',

  // Premier League — vérifié via mmz4281/2627/E0.csv
  'Liverpool':      'Liverpool',
  'Bournemouth':    'Bournemouth',
  'Aston Villa':    'Aston Villa',
  'Newcastle':      'Newcastle',
  'Brighton Hove':  'Brighton',
  'Fulham':         'Fulham',
  'Sunderland':     'Sunderland',
  'West Ham':       'West Ham',
  'Tottenham':      'Tottenham',
  'Burnley':        'Burnley',
  'Wolverhampton':  'Wolves',
  'Man City':       'Man City',
  'Nottingham':     "Nott'm Forest",
  'Brentford':      'Brentford',
  'Chelsea':        'Chelsea',
  'Crystal Palace': 'Crystal Palace',
  'Man United':     'Man United',
  'Arsenal':        'Arsenal',
  'Leeds United':   'Leeds',
  'Everton':        'Everton',

  // La Liga — vérifié via mmz4281/2627/SP1.csv
  'Girona':         'Girona',
  'Rayo Vallecano': 'Vallecano',
  'Villarreal':     'Villarreal',
  'Real Oviedo':    'Oviedo',
  'Mallorca':       'Mallorca',
  'Barça':          'Barcelona',
  'FC Barcelona':   'Barcelona',
  'Barcelona':      'Barcelona',
  'Alavés':         'Alaves',
  'Levante':        'Levante',
  'Valencia':       'Valencia',
  'Real Sociedad':  'Sociedad',
  'Celta':          'Celta',
  'Getafe':         'Getafe',
  'Athletic':       'Ath Bilbao',
  'Athletic Club':  'Ath Bilbao',
  'Sevilla FC':     'Sevilla',
  'Sevilla':        'Sevilla',
  'Espanyol':       'Espanol',
  'Atleti':         'Ath Madrid',
  'Elche':          'Elche',
  'Real Betis':     'Betis',
  'Real Madrid':    'Real Madrid',
  'Osasuna':        'Osasuna',
  'Racing Santander':                'Santander',
  'Real Racing Club de Santander':   'Santander',
  'Santander':      'Santander',

  // Bundesliga — vérifié via mmz4281/2526/D1.csv (dernière saison publiée,
  // voir note en tête de fichier)
  'Bayern':         'Bayern Munich',
  'RB Leipzig':     'RB Leipzig',
  'Frankfurt':      'Ein Frankfurt',
  'Eintracht Frankfurt': 'Ein Frankfurt',
  'Bremen':         'Werder Bremen',
  'Werder Bremen':  'Werder Bremen',
  'Leverkusen':     'Leverkusen',
  'Bayer Leverkusen': 'Leverkusen',
  'Hoffenheim':     'Hoffenheim',
  'TSG Hoffenheim': 'Hoffenheim',
  'Freiburg':       'Freiburg',
  'SC Freiburg':    'Freiburg',
  'Augsburg':       'Augsburg',
  'FC Augsburg':    'Augsburg',
  'Union Berlin':   'Union Berlin',
  '1. FC Union Berlin': 'Union Berlin',
  'Stuttgart':      'Stuttgart',
  'VfB Stuttgart':  'Stuttgart',
  'Heidenheim':     'Heidenheim',
  '1. FC Heidenheim': 'Heidenheim',
  'St. Pauli':      'St Pauli',
  'FC St. Pauli':   'St Pauli',
  'Dortmund':       'Dortmund',
  'Borussia Dortmund': 'Dortmund',
  'Mainz':          'Mainz',
  '1. FC Köln':     'FC Koln',
  'FC Cologne':     'FC Koln',
  "M'gladbach":     "M'gladbach",
  'Gladbach':       "M'gladbach",
  'Borussia Mönchengladbach': "M'gladbach",
  'HSV':            'Hamburg',
  'Hamburg':        'Hamburg',
  'Hamburg SV':     'Hamburg',
  'Wolfsburg':      'Wolfsburg',
  'VfL Wolfsburg':  'Wolfsburg',

  // Serie A — vérifié via mmz4281/2627/I1.csv
  'Genoa':          'Genoa',
  'Lecce':          'Lecce',
  'Sassuolo':       'Sassuolo',
  'Napoli':         'Napoli',
  'Milan':          'Milan',
  'AC Milan':       'Milan',
  'Cremonese':      'Cremonese',
  'Roma':           'Roma',
  'AS Roma':        'Roma',
  'Bologna':        'Bologna',
  'Cagliari':       'Cagliari',
  'Fiorentina':     'Fiorentina',
  'Como 1907':      'Como',
  'Como':           'Como',
  'Lazio':          'Lazio',
  'Atalanta':       'Atalanta',
  'Juventus':       'Juventus',
  'Parma':          'Parma',
  'Udinese':        'Udinese',
  'Verona':         'Verona',
  'Inter':          'Inter',
  'Internazionale': 'Inter',
  'Torino':         'Torino',
}

// Code fichier football-data.co.uk par compétition (SIM_COMP_IDS de
// PronosSimulateur.jsx) — pas Champions League (CL) : ce sont des fichiers
// PAR CHAMPIONNAT NATIONAL, une confrontation PSG-Bayern (Ligue des Champions)
// n'apparaît dans AUCUN des deux (voir commentaire complet dans api/h2h.js).
export const FDCOUK_LEAGUE_FILE = {
  FL1: 'F1',
  PL:  'E0',
  PD:  'SP1',
  BL1: 'D1',
  SA:  'I1',
}

export function toFdcoukName(fdShortName) {
  return FDCOUK_TEAM_NAMES[fdShortName] ?? null
}
