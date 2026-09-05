// ⚠️ LOGOS MIS À JOUR (02/09, fournis par l'utilisateur) : Ligue 1 (nouvelle
// identité), Premier League, Bundesliga et Serie A. Tous recadrés au plus
// près du contenu avant intégration, et compressés en palette (aplats à peu
// de couleurs, aucune perte visible) — le poids compte, c'est une PWA :
//   • Premier League : 1024x600 avec le lion perdu au milieu d'un aplat
//     violet → recadré 256x256 (tel quel, `object-fit: contain` l'aurait
//     rendu minuscule, exactement le défaut corrigé le même jour) ; 45 → 16 ko
//   • Ligue 1 : 960x1200 → 256x256 ; 15,6 → 5,7 ko
//   • Serie A : marge noire du fichier source retirée, recadré sur le badge
//     blanc lui-même (736x736 → 172x256)
//   • Bundesliga : recadré sur sa zone non transparente (300x300 → 246x246)
//
// ⚠️ RECADRAGE ÉTENDU (02/09, constat utilisateur : "le carré blanc, faut
// qu'il s'adapte à chaque logo, qu'il n'y ait pas de blanc autour"). Le CSS
// ne peut pas deviner la marge TRANSPARENTE cuite dans un fichier : elle
// s'affiche comme du blanc dans la pastille. Mesurée sur tous les logos, puis
// recadrée sur le contenu réel là où elle était visible :
//   • coupe-du-monde.png : 28% de marge (640x640 → 286x604) — de loin le pire
//   • caf-can.png        : 3%  (347x326 → 327x306)
//   • euro-generic.png   : 3%  (413x500 → 388x475)
// Les autres étaient déjà collés à leur contenu (vérifié un par un).
//
// `emblemOpaque` distingue les logos à FOND PLEIN — vérifié sur les pixels :
// tuile bleue Ligue 1 (#085DFE), violette Premier League (#39003D), badge
// blanc Serie A, aucune transparence — de ceux tracés sur fond transparent
// (Bundesliga, LaLiga…). Les premiers ne doivent PAS être posés dans la
// pastille blanche de la carte "Match du jour" : ça ferait un carré de
// couleur dans un carré blanc. Ils remplissent leur cadre eux-mêmes, la
// tuile EST la pastille. Les seconds gardent le fond blanc, sans quoi leurs
// tracés sombres seraient invisibles sur le fond sombre de la carte.
import bundesligaLogo from '../assets/leagues/bundesliga-2026.png'
import laligaLogo from '../assets/leagues/laliga-ea-sports.svg'
import ligue1Logo from '../assets/leagues/ligue1-2026.png'
import premierLeagueLogo from '../assets/leagues/premier-league-2026.png'
import serieALogo from '../assets/leagues/serie-a-2026.png'
import worldCupLogo from '../assets/leagues/coupe-du-monde.png'
import championsLeagueLogo from '../assets/leagues/ldc.png'
// europa-league.png / conference-league.png : mêmes assets que ldc.png ci-
// dessus (même style visuel — fond noir plein, ballon/coupe + texte "UEFA
// ... LEAGUE", déjà validé en prod pour la C1), désormais utilisés (demande
// utilisateur, 23/07 : "et pour la ligue europa et la ligue conference espn
// prend ça en compte normalement ?" → intégration complète ajoutée).
import europaLeagueLogo     from '../assets/leagues/europa-league.png'
import conferenceLeagueLogo from '../assets/leagues/conference-league.png'
// Vrais logos ajoutés par l'utilisateur (12/07) — tous nettoyés/détourés :
// - CAF : logo officiel de la confédération, utilisé génériquement pour la
//   CAN comme il n'existe pas de logo CAN intemporel (pratique standard, ex.
//   beIN/RMC Sport). Recadré : le fichier d'origine avait beaucoup de marge
//   vide autour (rendait le logo visuellement plus petit que les autres).
// - Nations League : fond blanc/damier (artefact du site source) retiré,
//   texte "UEFA NATIONS LEAGUE" recoloré en blanc (gris-bleu terne
//   à l'origine, peu lisible sur fond sombre).
// - Euro : euro-generic.png, recadré depuis le logo ESPN "UEFA European
//   Championship" (leaguelogos/soccer/500-dark/74.png, fourni par
//   l'utilisateur) sur l'écusson trophée + arc-en-ciel de drapeaux
//   uniquement — bandeau texte "UEFA / EURO2024 / GERMANY" retiré (coupe
//   nette sur les lignes 100% transparentes qui séparaient déjà icône et
//   texte). ⚠️ Reste visuellement daté de l'édition 2024 (aucune vraie
//   alternative générique trouvée, même limite réseau que les autres), mais
//   bien plus lisible en petit — l'ancien fichier (euro-real.png, tout bleu
//   avec le texte complet) donnait un simple blob bleu illisible en petit
//   (retour utilisateur).
// - Copa America : fond "damier transparent" (en réalité cuit dans les
//   pixels JPEG du site source) aplati en blanc uni plutôt que rendu
//   transparent — le trophée blanc se confondait avec ce damier, une vraie
//   transparence aurait mangé une partie du trophée (testé). Résultat :
//   disque blanc plein (comme la plupart des logos de compétition), coins
//   du canvas d'origine découpés en cercle.
import nationsLeagueLogo from '../assets/leagues/nations-league-real.png'
import canLogo from '../assets/leagues/caf-can.png'
import euroLogo from '../assets/leagues/euro-generic.png'
import copaAmericaLogo from '../assets/leagues/copa-america-real.png'


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
  UEL:  'uefa.europa',
  UECL: 'uefa.europa.conf',
  USC:  'uefa.super_cup',
  // Supercoupes nationales (16/08, demande explicite utilisateur) — voir
  // NATIONAL_SUPER_CUP_SLUGS dans espnSlugs.js pour le détail/la vérification.
  TDC:  'fra.super_cup',
  CS:   'eng.charity',
}

// ID numérique football-data.org réel des 6 grands championnats club —
// nécessaire quand ces comps sont exceptionnellement sourcées depuis ESPN
// (useTodayMatches.js, useUpcomingMatchesAllComps dans useMatchs.js) : sans
// lui, elles récupéreraient un competition.id à `null` (SYNTHETIC_COMP_ID,
// espnAdapter.js, n'a pas d'entrée pour elles — seulement pour les comps
// 100% ESPN comme NL/CAN/COPA), cassant le matching live (api/fifa-live.js,
// COMP_ESPN[fdMatch.competition?.id]) et le regroupement par compétition
// ailleurs dans l'app.
export const MAJOR_LEAGUE_FD_ID = { CL: 2001, PL: 2021, FL1: 2015, PD: 2014, BL1: 2002, SA: 2019 }

// Code football-data.org de la division INFÉRIEURE directe de chaque grand
// championnat — sert de repli pour un club fraîchement promu (aucune donnée
// dans SA nouvelle compétition la saison passée, ex. Hull City en PL
// 2026-27, voir calcProno.js computeLambdasWithPromotion). Demande
// utilisateur explicite (02/08) : plutôt qu'un neutre plat pour tout promu,
// aller chercher ses stats dans son ancienne division et les injecter avec
// une forte décote de confiance (LOWER_DIV_SHRINK_K).
// ⚠️ Honnêteté : PL→ELC est le SEUL code vérifié en réel (appel FD.org
// direct, 02/08 — réponse valide, Hull absent de la liste Championship
// actuelle, cohérent avec une promotion). Les 4 autres sont des codes
// FD.org standards par convention (jamais eu de 403/vide en usage courant
// sur ce projet pour PL/ELC) mais PAS testés individuellement ici — le verrou
// d'espacement FD.org a bloqué mes tentatives de vérif (FL2 3x en échec).
// Sans risque : useLowerDivisionStats échoue silencieusement sur un code
// invalide (comme tout le reste des fetchs FD.org du projet), donc une
// entrée fausse ici ne casse rien, elle prive juste ce repli de données.
export const LOWER_DIVISION_FD_CODE = {
  PL:  'ELC',  // Championship — vérifié 02/08
  FL1: 'FL2',  // Ligue 2 — assumé, non vérifié (verrou FD.org)
  PD:  'SD',   // Segunda División — assumé, non vérifié
  BL1: 'BL2',  // 2. Bundesliga — assumé, non vérifié
  SA:  'SB',   // Serie B — assumé, non vérifié
}

// ⚠️ TheSportsDB : testé comme 3e repli classement (23/07), retiré le même
// jour — la clé publique gratuite plafonne lookuptable.php à 5 lignes
// seulement, quelle que soit la ligue (confirmé par appels réels), donc
// inutilisable pour un classement complet. Voir l'historique git.

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
// structure de groupe sur son scoreboard) — utilisé par Classement.jsx pour
// ne pas proposer un classement qui n'existe pas.
// UEL/UECL ajoutées par prudence (même raison, jamais vérifié en direct pour
// leur format "phase de ligue" — si ESPN s'avère exposer un classement
// propre pour elles, à retirer d'ici).
// ⚠️ N'est PLUS utilisé par FavoritesPage.jsx pour filtrer les favoris de
// NOTIFS (voir son commentaire dédié) — l'absence de classement n'a aucun
// rapport avec l'éligibilité aux notifs push, seulement avec l'onglet
// Classement.
// USC (Supercoupe UEFA) ajoutée pour la même raison — un seul match par an,
// aucun classement n'a jamais de sens ici.
export const NO_STANDINGS_COMPS = new Set(['NL', 'CAN', 'COPA', 'UEL', 'UECL', 'USC', 'TDC', 'CS'])

// ⚠️ AJOUT (16/08, demande explicite utilisateur : "ce genre de championnat
// où c'est qu'un match par an, ne le mets pas dans la liste où y'a tous les
// championnats") : sous-ensemble de NO_STANDINGS_COMPS — contrairement à
// NL/CAN/COPA/UEL/UECL (vrais tournois multi-matchs, juste sans classement
// exploitable), USC/TDC/CS sont un SEUL match par an. Les lister dans le
// sélecteur de championnat (Programme/Résultats — Match.jsx/Resultat.jsx)
// n'a pas de sens à l'année longue (rien à y voir la quasi-totalité du
// temps). Reste néanmoins visibles normalement partout ailleurs : card
// Accueil le jour du match, page match dédiée au clic, favoris notifs
// (FavoritesPage.jsx, n'utilise pas ce filtre — activer/désactiver les
// notifs d'un match par an reste légitime).
export const SINGLE_MATCH_COMPS = new Set(['USC', 'TDC', 'CS'])

// ── Couleur d'ambiance par championnat ───────────────────────────────────────
// ⚠️ RENFORCÉE ET CORRIGÉE (05/09, retour utilisateur : "c'est pas comme je
// t'avais dit, je voulais la couleur du logo du championnat, et si la couleur
// est moche tu l'embellis un chouia").
// La couleur brute du logo est pensée pour un petit aplat, pas pour une grande
// surface sombre : à cette échelle elle devient criarde (bleu Ligue 1 à
// saturation 100%) ou illisible (violet Premier League presque noir).
// D'où une correction SYSTÉMATIQUE, pas un choix au jugé :
//   • la TEINTE n'est jamais touchée — c'est elle qui fait reconnaître le
//     championnat ;
//   • la saturation est plafonnée à 0,80 (au-delà, effet néon sur une grande
//     surface) ;
//   • la luminosité est ramenée dans 0,24–0,44 : plus clair, le texte blanc
//     ne passe plus ; plus sombre, la teinte ne se voit plus.
// Chaque entrée note la couleur brute ET la couleur corrigée, pour qu'on
// puisse refaire le calcul.
// Limite connue et assumée : Bundesliga et LaLiga restent proches après
// correction (#b8141e et #ca1d16) — leurs deux logos sont rouges, à 6° de
// teinte l'un de l'autre. Les écarter davantage reviendrait à inventer une
// couleur que ces championnats n'ont pas.
// ⚠️ AJOUT (05/09, demande utilisateur : "le fond de la card sur la page du
// direct aux couleurs du championnat, genre Ligue 1 en bleu comme le logo").
// Chaque valeur est EXTRAITE du logo réellement utilisé par l'app, pas choisie
// à la main : couleur dominante des pixels du fichier, en ignorant blancs,
// noirs et gris (jamais la couleur d'identité d'un logo). Le détail par
// championnat est noté sur chaque entrée.
// Une compétition sans `tint` garde le fond sombre neutre — c'est le cas de la
// Ligue des champions, dont le logo est strictement noir et blanc : il n'y a
// aucune couleur à en tirer, et en inventer une n'aurait aucun fondement.
export const COMPETITIONS = [
  {
    id: 'FL1',
    // brut #0054fc (bleu dominant du logo, 20 526 px) → corrigé
    tint: '#1652ca',
    name: "Ligue 1 McDonald's",
    shortName: 'Ligue 1',
    emblem: ligue1Logo,
    // ⚠️ Logo à FOND PLEIN (tuile bleue), pas un tracé sur transparent —
    // voir emblemOpaque plus bas dans ce fichier.
    emblemOpaque: true,
  },
  {
    id: 'PL',
    // brut #39003d (violet du logo d'origine, avant détourage) → corrigé
    tint: '#680c6e',
    name: 'Premier League',
    shortName: 'Premier L.',
    emblem: premierLeagueLogo,
    // ⚠️ L'APLAT VIOLET A ÉTÉ DÉTOURÉ (04/09, demande utilisateur) : le fichier
    // ne contient plus que le lion blanc sur transparent. Le violet était un
    // fond plein baké dans l'image (#39003D), et le lion étant blanc, aucune
    // couleur ne se confondait — le détourage est net, bords anticrénelés
    // compris (opacité résolue par pixel plutôt que découpée au seuil).
    // `emblemOpaque` reste à true : ce drapeau ne dit pas "l'image a un fond",
    // il commande "pas de pastille blanche derrière". Le retirer collerait le
    // lion BLANC sur une pastille BLANCHE, donc invisible — exactement
    // l'inverse du but.
    emblemOpaque: true,
    // Une ombre sombre est bakée dans l'image : invisible sur les fonds
    // sombres de l'app, elle détache le lion si la card affiche une équipe aux
    // couleurs claires. `emblemTransparent` sert uniquement à retirer l'ombre
    // portée du conteneur sur l'affiche "Match du jour" : dessinée autour d'une
    // image sans fond, elle produirait un halo RECTANGULAIRE derrière un logo
    // détouré. Elle reste en place pour Ligue 1 et Serie A, qui sont de vraies
    // tuiles pleines.
    emblemTransparent: true,
  },
  {
    id: 'PD',
    // brut #ff4b44 (unique couleur du SVG LaLiga) → corrigé
    tint: '#ca1d16',
    name: 'LALIGA EA SPORTS',
    shortName: 'LaLiga',
    emblem: laligaLogo,
    // ⚠️ FOND NOIR (02/09, demande explicite : "mets un fond noir pour ce
    // championnat uniquement"). Le fichier LaLiga est un tracé MONOCHROME
    // rouge corail (#ff4b44, vérifié : c'est la seule couleur du SVG) — sur la
    // pastille blanche commune il ressort mal. Sur fond sombre il retrouve son
    // rendu de marque. Seule compétition concernée, d'où un réglage par
    // compétition plutôt qu'une règle globale.
    emblemBg: '#0b0b0e',
  },
  {
    id: 'BL1',
    // brut #cc000c (rouge dominant du logo, 16 158 px) → corrigé
    tint: '#b8141e',
    name: 'Bundesliga',
    shortName: 'Bundesliga',
    emblem: bundesligaLogo,
  },
  {
    id: 'SA',
    // brut #0084cc (bleu dominant du logo, 2 571 px) → corrigé
    tint: '#147eb8',
    name: 'Serie A Enilive',
    shortName: 'Serie A',
    emblem: serieALogo,
    // Badge BLANC plein (pas un tracé sur transparent) : la tuile sert
    // elle-même de pastille, voir emblemOpaque en tête de fichier.
    emblemOpaque: true,
  },
  {
    id: 'CL',
    name: 'Ligue des Champions',
    shortName: 'C. League',
    emblem: championsLeagueLogo,
  },
  {
    id: 'UEL',
    name: 'Ligue Europa',
    shortName: 'Europa L.',
    emblem: europaLeagueLogo,
  },
  {
    id: 'UECL',
    name: 'Ligue Europa Conférence',
    shortName: 'Conférence L.',
    emblem: conferenceLeagueLogo,
  },
  {
    // Supercoupe de l'UEFA (vainqueur C1 vs vainqueur Ligue Europa) — un seul
    // match par an, 100% ESPN comme NL/CAN/COPA/UEL/UECL (pas d'id
    // football-data.org). Pas de logo dédié disponible (emblem: null, safe —
    // tous les points d'affichage vérifient déjà `comp.emblem &&` avant
    // d'afficher une image).
    id: 'USC',
    name: "Supercoupe de l'UEFA",
    shortName: 'Supercoupe UEFA',
    emblem: null,
  },
  {
    // Trophée des Champions (vainqueur Ligue 1 vs vainqueur Coupe de France)
    // — 1 seul match par an, 100% ESPN (fra.super_cup, vérifié en direct le
    // 16/08), même traitement que USC. Pas de logo dédié disponible.
    id: 'TDC',
    name: 'Trophée des Champions',
    shortName: 'Troph. Champions',
    emblem: null,
  },
  {
    // Community Shield (vainqueur Premier League vs vainqueur FA Cup) — 1
    // seul match par an, 100% ESPN (eng.charity, vérifié en direct le 16/08),
    // même traitement que USC/TDC. Pas de logo dédié disponible.
    id: 'CS',
    name: 'Community Shield',
    shortName: 'Comm. Shield',
    emblem: null,
  },
  {
    id: 'WC',
    name: 'Coupe du Monde',
    shortName: 'Coupe du monde',
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
    shortName: 'Ligue des nations',
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
