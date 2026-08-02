export const TEAM_NAMES_FR = {
  // Ligue 1
  'Stade Rennais': 'Rennes',
  'Marseille': 'Marseille',
  'RC Lens': 'Lens',
  'Olympique Lyon': 'Lyon',
  // ⚠️ AJOUT (27/07, bug réel : H2H vide pour Toulouse-Lyon vu depuis Accueil)
  // : le nom COMPLET football-data.org ("name", pas "shortName") est
  // "Olympique Lyonnais" — absent de cette table jusqu'ici (seul le
  // shortName "Olympique Lyon" y était). Utilisée par le repli `loose` de
  // resolveFdTeamId (matchUtils.js, PAS clubNameMatch — voir son commentaire)
  // pour rapprocher "Lyon" (nom ESPN) de la variante FD.org rencontrée,
  // quelle qu'elle soit — ceinture et bretelles avec le shortName déjà
  // couvert.
  'Olympique Lyonnais': 'Lyon',
  'Monaco': 'Monaco',
  'Le Havre': 'Le Havre',
  'Nice': 'Nice',
  'Toulouse': 'Toulouse',
  'Brest': 'Brest',
  'Lille': 'Lille',
  'Auxerre': 'Auxerre',
  'Lorient': 'Lorient',
  'FC Metz': 'Metz',
  'Strasbourg': 'Strasbourg',
  'Angers SCO': 'Angers',
  'Paris FC': 'Paris FC',
  'Nantes': 'Nantes',
  'PSG': 'Paris SG',

  // Premier League
  'Liverpool': 'Liverpool',
  'Bournemouth': 'Bournemouth',
  'Aston Villa': 'Aston Villa',
  'Newcastle': 'Newcastle',
  'Brighton Hove': 'Brighton',
  'Fulham': 'Fulham',
  'Sunderland': 'Sunderland',
  'West Ham': 'West Ham',
  'Tottenham': 'Tottenham',
  'Burnley': 'Burnley',
  'Wolverhampton': 'Wolverhampton',
  'Man City': 'Man. City',
  'Nottingham': 'Nottingham',
  'Brentford': 'Brentford',
  'Chelsea': 'Chelsea',
  'Crystal Palace': 'Crystal Palace',
  'Man United': 'Man. United',
  'Arsenal': 'Arsenal',
  'Leeds United': 'Leeds',
  'Everton': 'Everton',

  // La Liga
  'Girona': 'Girona',
  'Rayo Vallecano': 'Rayo Vallecano',
  'Villarreal': 'Villarreal',
  'Real Oviedo': 'Real Oviedo',
  'Mallorca': 'Mallorca',
  'Barça': 'Barcelone',
  'Alavés': 'Alavés',
  'Levante': 'Levante',
  'Valencia': 'Valence',
  'Real Sociedad': 'Real Sociedad',
  'Celta': 'Celta Vigo',
  'Getafe': 'Getafe',
  'Athletic': 'Athletic Bilbao',
  'Sevilla FC': 'Séville',
  'Espanyol': 'Espanyol',
  'Atleti': 'Atlético Madrid',
  'Elche': 'Elche',
  'Real Betis': 'Betis',
  'Real Madrid': 'Real Madrid',
  'Osasuna': 'Osasuna',

  // Bundesliga
  'Bayern': 'Bayern Munich',
  'RB Leipzig': 'RB Leipzig',
  'Frankfurt': 'Francfort',
  'Bremen': 'Werder Brême',
  'Leverkusen': 'Leverkusen',
  'Hoffenheim': 'Hoffenheim',
  'Freiburg': 'Fribourg',
  'Augsburg': 'Augsbourg',
  'Union Berlin': 'Union Berlin',
  'Stuttgart': 'Stuttgart',
  'Heidenheim': 'Heidenheim',
  'Wolfsburg': 'Wolfsburg',
  'St. Pauli': 'St. Pauli',
  'Dortmund': 'Dortmund',
  'Mainz': 'Mayence',
  '1. FC Köln': 'Cologne',
  "M'gladbach": 'M\'gladbach',
  'HSV': 'Hambourg',

  // Serie A
  'Genoa': 'Gênes',
  'Lecce': 'Lecce',
  'Sassuolo': 'Sassuolo',
  'Napoli': 'Naples',
  'Milan': 'Milan AC',
  'Cremonese': 'Cremonese',
  'Roma': 'Rome',
  'Bologna': 'Bologne',
  'Cagliari': 'Cagliari',
  'Fiorentina': 'Fiorentina',
  'Como 1907': 'Côme',
  'Lazio': 'Lazio',
  'Atalanta': 'Atalanta',
  'AC Pisa': 'Pise',
  'Juventus': 'Juventus',
  'Parma': 'Parme',
  'Udinese': 'Udinese',
  'Verona': 'Vérone',
  'Inter': 'Inter Milan',
  'Torino': 'Turin',

  // Champions League / Europa
  'PSV': 'PSV Eindhoven',
  'Union SG': 'Union Saint-Gilloise',
  'SL Benfica': 'Benfica',
  'Qarabağ Ağdam': 'Qarabağ',
  'Slavia Praha': 'Slavia Prague',
  'Bodø/Glimt': 'Bodø/Glimt',
  'Olympiakos': 'Olympiakos',
  'Paphos FC': 'Paphos',
  'Ajax': 'Ajax',
  'København': 'Copenhague',
  'Club Brugge': 'Bruges',
  // 'Monaco' déjà listé plus haut, section Ligue 1
  'Sporting CP': 'Sporting CP',
  'FK Kairat': 'Kairat',
  'Galatasaray': 'Galatasaray',

  // Euro / Nations
  'Germany': 'Allemagne',
  'Scotland': 'Écosse',
  'Hungary': 'Hongrie',
  'Switzerland': 'Suisse',
  'Spain': 'Espagne',
  'Croatia': 'Croatie',
  'Italy': 'Italie',
  'Albania': 'Albanie',
  'Poland': 'Pologne',
  'Netherlands': 'Pays-Bas',
  'Slovenia': 'Slovénie',
  'Denmark': 'Danemark',
  'Serbia': 'Serbie',
  'England': 'Angleterre',
  'Romania': 'Roumanie',
  'Ukraine': 'Ukraine',
  'Belgium': 'Belgique',
  'Slovakia': 'Slovaquie',
  'Austria': 'Autriche',
  'France': 'France',
  'Turkey': 'Turquie',
  'Georgia': 'Géorgie',
  'Portugal': 'Portugal',
  'Czechia': 'Tchéquie',

  // Coupe du monde
  'Mexico': 'Mexique',
  'South Africa': 'Afrique du Sud',
  'Korea Republic': 'Corée du Sud',
  'Canada': 'Canada',
  'Bosnia-H.': 'Bosnie-Herzégovine',
  'USA': 'États-Unis',
  'Paraguay': 'Paraguay',
  'Qatar': 'Qatar',
  'Brazil': 'Brésil',
  'Morocco': 'Maroc',
  'Haiti': 'Haïti',
  'Australia': 'Australie',
  'Curaçao': 'Curaçao',
  'Japan': 'Japon',
  'Ivory Coast': 'Côte d\'Ivoire',
  'Ecuador': 'Équateur',
  'Sweden': 'Suède',
  'Tunisia': 'Tunisie',
  'Cape Verde': 'Cap-Vert',
  'Egypt': 'Égypte',
  'Saudi Arabia': 'Arabie Saoudite',
  'Uruguay': 'Uruguay',
  'Iran': 'Iran',
  'New Zealand': 'Nouvelle-Zélande',
  'Senegal': 'Sénégal',
  'Iraq': 'Irak',
  'Norway': 'Norvège',
  'Argentina': 'Argentine',
  'Algeria': 'Algérie',
  'Jordan': 'Jordanie',
  'Congo DR': 'RD Congo',
  'Ghana': 'Ghana',
  'Panama': 'Panama',
  'Uzbekistan': 'Ouzbékistan',
  'Colombia': 'Colombie',

  // ── Ligue des Nations / CAN / Copa America / Coupe de France, Copa del
  // Rey, FA Cup (source ESPN, voir espnAdapter.js) ────────────────────────
  // Ces compétitions couvrent des équipes absentes du Mondial/Euro (donc pas
  // encore dans la liste ci-dessus) — traduction manquante = nom anglais
  // brut affiché tel quel (translateTeam() retombe sur le nom d'origine s'il
  // n'est pas dans ce dictionnaire). Complété ici plutôt que de laisser
  // toutes ces sélections en anglais.
  // CONMEBOL (Copa America) — les autres membres sont déjà couverts plus
  // haut (Argentina, Brazil, Uruguay, Colombia, Ecuador, Paraguay).
  'Chile': 'Chili',
  'Peru': 'Pérou',
  'Bolivia': 'Bolivie',
  'Venezuela': 'Venezuela',
  // CAF (CAN) — au-delà des qualifiés Mondial 2026 déjà listés plus haut
  // (Afrique du Sud, Maroc, Côte d'Ivoire, Tunisie, Cap-Vert, Égypte,
  // Sénégal, Algérie, Ghana, RD Congo).
  'Nigeria': 'Nigeria',
  'Cameroon': 'Cameroun',
  'Mali': 'Mali',
  'Burkina Faso': 'Burkina Faso',
  'Guinea': 'Guinée',
  'Zambia': 'Zambie',
  'Uganda': 'Ouganda',
  'Gabon': 'Gabon',
  'Benin': 'Bénin',
  'Mozambique': 'Mozambique',
  'Sudan': 'Soudan',
  'Zimbabwe': 'Zimbabwe',
  'Comoros': 'Comores',
  'Botswana': 'Botswana',
  'Equatorial Guinea': 'Guinée équatoriale',
  'Kenya': 'Kenya',
  'Angola': 'Angola',
  'Libya': 'Libye',
  'Ethiopia': 'Éthiopie',
  'Namibia': 'Namibie',
  'Rwanda': 'Rwanda',
  'Tanzania': 'Tanzanie',
  'Guinea-Bissau': 'Guinée-Bissau',
  'Central African Republic': 'République centrafricaine',
  'Chad': 'Tchad',
  'Niger': 'Niger',
  'Mauritania': 'Mauritanie',
  'Madagascar': 'Madagascar',
  'Malawi': 'Malawi',
  'Eswatini': 'Eswatini',
  'Lesotho': 'Lesotho',
  'Gambia': 'Gambie',
  'Sierra Leone': 'Sierra Leone',
  'Liberia': 'Liberia',
  'Togo': 'Togo',
  'Djibouti': 'Djibouti',
  'Somalia': 'Somalie',
  'Eritrea': 'Érythrée',
  'South Sudan': 'Soudan du Sud',
  'Burundi': 'Burundi',
  // UEFA (Ligue des Nations) — au-delà des équipes Euro déjà listées plus
  // haut. ⚠️ 'Bosnia and Herzegovina' (nom complet ESPN) s'ajoute à
  // 'Bosnia-H.' (forme FD.org) déjà présente plus haut — deux clés
  // différentes pour la même équipe, sources différentes.
  'Wales': 'Pays de Galles',
  'Northern Ireland': 'Irlande du Nord',
  'Republic of Ireland': 'Irlande',
  'Ireland': 'Irlande',
  'Finland': 'Finlande',
  'Iceland': 'Islande',
  'Israel': 'Israël',
  'Kazakhstan': 'Kazakhstan',
  'Armenia': 'Arménie',
  'Azerbaijan': 'Azerbaïdjan',
  'Belarus': 'Biélorussie',
  'Bulgaria': 'Bulgarie',
  'Estonia': 'Estonie',
  'Latvia': 'Lettonie',
  'Lithuania': 'Lituanie',
  'Moldova': 'Moldavie',
  'Montenegro': 'Monténégro',
  'North Macedonia': 'Macédoine du Nord',
  'Bosnia and Herzegovina': 'Bosnie-Herzégovine',
  'Cyprus': 'Chypre',
  'Luxembourg': 'Luxembourg',
  'Malta': 'Malte',
  'Andorra': 'Andorre',
  'San Marino': 'Saint-Marin',
  'Gibraltar': 'Gibraltar',
  'Kosovo': 'Kosovo',
  'Faroe Islands': 'Îles Féroé',
  'Liechtenstein': 'Liechtenstein',
  // ── Traductions manquantes trouvées en comparant avec les vrais noms
  // ESPN (endpoint /teams de chaque compétition, vérifié en direct) ────────
  // ESPN utilise "Türkiye" (pas "Turkey") pour la Ligue des Nations — clé
  // séparée de 'Turkey' (FD.org/Euro) déjà présente plus haut, même pays.
  'Türkiye': 'Turquie',
  // Grèce : absente de la liste Euro (n'était pas qualifiée) donc jamais
  // ajoutée — présente en Ligue des Nations.
  'Greece': 'Grèce',
  // Ligue des Nations ESPN renvoie "Bosnia-Herzegovina" (tiret, sans "and"),
  // 3e variante après 'Bosnia-H.' (FD.org) et 'Bosnia and Herzegovina' (nom
  // complet, vu ailleurs sur ESPN) déjà présentes plus haut.
  'Bosnia-Herzegovina': 'Bosnie-Herzégovine',
  // Copa America : invités CONCACAF absents du Mondial/Copa America côté
  // qualifiés déjà listés, + ESPN renvoie "United States" (pas "USA") pour
  // cette compétition spécifiquement.
  'Costa Rica': 'Costa Rica',
  'Jamaica': 'Jamaïque',
  'United States': 'États-Unis',

  // ── Audit complet noms ESPN vs FD.org, 5 grands championnats club (30/07,
  // constat utilisateur : "y'a des noms d'equipe chez espn genre... barcelona
  // au lieu de barcelone... verifier entre espn et fd.org") ──────────────────
  // Root cause générale : ESPN renvoie le nom OFFICIEL complet de chaque club
  // (team.name / team.shortDisplayName sur /scoreboard) alors que FD.org
  // utilise un nom raccourci — et clubNameMatch (espnSummaryParse.js) ne fait
  // qu'un match de PRÉFIXE (na.startsWith(nb) || nb.startsWith(na)). Ça
  // fonctionne quand le mot en trop est en SUFFIXE côté ESPN ("Le Havre AC"
  // commence bien par "Le Havre") mais échoue dès qu'il est en PRÉFIXE
  // ("Manchester City" ne commence PAS par "Man City", et vice-versa) — même
  // famille de bug que le cas Lyon/Toulouse déjà corrigé. Vérifié en direct
  // (api/espn.js, mode scoreboard, vraies données saison 2026-27) pour
  // Ligue 1/Premier League/LaLiga/Bundesliga/Serie A. Ajout PUREMENT additif
  // (aucune clé existante modifiée/supprimée, aucune logique de matching
  // touchée) — comble juste translateTeam() pour ces noms ESPN bruts, avec la
  // même valeur française déjà utilisée pour le nom FD.org de ce club.
  // Ligue 1
  'AS Monaco': 'Monaco',
  'AJ Auxerre': 'Auxerre',
  'Le Havre AC': 'Le Havre',
  // LaLiga — 'Barcelona' est le cas signalé par l'utilisateur (H2H vide vu
  // depuis Accueil pour Barcelone-Elche, entre autres).
  'Barcelona': 'Barcelone',
  // FD.org utilise généralement le nom officiel complet ("FC Barcelona") en
  // plus du shortName déjà couvert ('Barça') — ajouté par sécurité, même
  // schéma que Real Madrid/Real Betis déjà en table.
  'FC Barcelona': 'Barcelone',
  'Sevilla': 'Séville',
  'Athletic Club': 'Athletic Bilbao',
  // Premier League
  'Manchester United': 'Man. United',
  'Manchester City': 'Man. City',
  'Brighton & Hove Albion': 'Brighton',
  'AFC Bournemouth': 'Bournemouth',
  'Nottingham Forest': 'Nottingham',
  'Tottenham Hotspur': 'Tottenham',
  'Newcastle United': 'Newcastle',
  // ⚠️ Wolverhampton Wanderers / West Ham United : noms officiels standards,
  // pas observés directement dans la fenêtre de dates interrogée (calendrier
  // ESPN pas encore publié pour ces matchs au moment de l'audit) — ajoutés
  // par cohérence avec le même schéma de nommage confirmé pour tout le reste
  // de la Premier League (nom complet officiel), à revérifier si jamais pris
  // en défaut.
  'Wolverhampton Wanderers': 'Wolverhampton',
  'West Ham United': 'West Ham',
  // Bundesliga — quasi CHAQUE club allemand a un préfixe de statut (1. FC/
  // VfB/VfL/TSG/SC/Bayer/Borussia/Werder/Eintracht/FC/Hamburg) absent du nom
  // court FD.org déjà en table — bug quasi systématique pour cette ligue.
  'VfB Stuttgart': 'Stuttgart',
  '1. FC Union Berlin': 'Union Berlin',
  'Eintracht Frankfurt': 'Francfort',
  'FC Cologne': 'Cologne',
  'TSG Hoffenheim': 'Hoffenheim',
  'Borussia Mönchengladbach': 'M\'gladbach',
  'Bayer Leverkusen': 'Leverkusen',
  'Borussia Dortmund': 'Dortmund',
  'Hamburg SV': 'Hambourg',
  'SC Freiburg': 'Fribourg',
  'Werder Bremen': 'Werder Brême',
  'FC Augsburg': 'Augsbourg',
  // ⚠️ Wolfsburg/St. Pauli/Heidenheim : noms officiels standards, mêmes
  // réserves que Wolverhampton/West Ham ci-dessus (pas observés directement
  // dans la fenêtre de dates interrogée).
  'VfL Wolfsburg': 'Wolfsburg',
  'FC St. Pauli': 'St. Pauli',
  '1. FC Heidenheim': 'Heidenheim',
  // Serie A
  'Internazionale': 'Inter Milan',
  'Como': 'Côme',
  'AC Milan': 'Milan AC',
  'AS Roma': 'Rome',

  // ⚠️ RÉ-APPLIQUÉ (02/08, perdu par erreur dans le gros revert b0f424a du
  // même jour — voir git log, ces 6 entrées existaient déjà dans eaa3847 et
  // n'ont jamais été remises depuis) : audit exhaustif via /api/espn?
  // standings=1 (classement complet, toutes les équipes) pour les 5 grands
  // championnats club — gaps réels trouvés, le reste était déjà couvert.
  'Paris Saint-Germain': 'Paris SG', // FL1 — nom complet ESPN, seul 'PSG' (shortName) était couvert
  'C Palace': 'Crystal Palace',      // PL — shortName ESPN, filet de sécurité
  'Nottm Forest': 'Nottingham',      // PL — idem
  'Spurs': 'Tottenham',              // PL — idem
  'Gladbach': 'M\'gladbach',          // BL1 — shortName ESPN ("Mönchengladbach" tronqué), différent de "M'gladbach" déjà en table
  'Hamburg': 'Hambourg',             // BL1 — shortName ESPN, seul 'HSV' était couvert
}

export const translateTeam = (name) => TEAM_NAMES_FR[name] ?? name