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
//
// ⚠️ 2e CORRECTION (05/09, même jour, nouveau retour : "la ligue 1 c'est censé
// être bleu et c'est tout sauf bleu, et la Bundesliga le rouge est trop vif").
// Deux problèmes distincts trouvés au calcul (pas au jugé, voir le détail du
// dégradé dans LiveMatchPage.css) :
//   1. Bleu et rouge à la MÊME saturation/luminosité ne se perçoivent pas
//      pareil. Le fond de carte est un dégradé qui s'assombrit vers le bas
//      (zone la plus visible) : un bleu à L=44% y devenait rgb(12,34,78),
//      trop sombre pour être identifié comme bleu — pendant qu'un rouge à la
//      même L restait vif et entrait en conflit avec le rouge déjà utilisé
//      partout ailleurs dans l'UI (bordure live, minute, pastille "live").
//      Un plafond uniforme en HSL ne peut pas corriger ça : la correction a
//      donc été refaite par famille de teinte plutôt qu'avec une seule règle
//      pour les 5 —
//        • bleus (Ligue 1, Serie A) : légèrement éclaircis/saturés (L≈47%,
//          S≈78%) pour rester lisibles même dilués dans le bas du dégradé ;
//        • le dégradé lui-même a aussi été moins dilué (voir
//          LiveMatchPage.css) pour que la teinte porte sur toute la carte,
//          pas seulement le coin haut.
//   2. Bundesliga et LaLiga sont TOUTES LES DEUX rouges (6° de teinte
//      d'écart) : aucune correction de luminosité/saturation ne les rend
//      moins "criardes" sans les écarter en teinte, ce qui inventerait une
//      couleur que ces logos n'ont pas. Et un rouge assez sombre pour ne pas
//      crier se confond de toute façon avec les accents rouges de l'app
//      (bordure live, minute). Plutôt qu'un compromis raté, ces deux
//      championnats n'ont PLUS de `tint` : fond neutre, comme la Ligue des
//      champions — décision reprise de la proposition de l'utilisateur lui-
//      même ("le reste on fait du noir").
//
// ⚠️ 3e CORRECTION (05/09, même jour, retour utilisateur après coup : "en tout
// noir c'est moche, essaye un mélange de rouge et blanc"). Bundesliga et
// LaLiga retrouvent un `tint`, mais rouge mélangé au BLANC (rosé/saumon) et
// non plus au noir (bordeaux, déjà essayé et rejeté juste avant — "pas trop
// fan", "mauvaise teinte") : même teinte que chaque logo, luminosité/
// saturation remontées vers le blanc plutôt qu'assombries. Ne règle pas le
// point 2 ci-dessus (toujours la même famille de rouge, donc encore assez
// proche du rouge live) — mais un rosé assez clair s'en distingue déjà
// beaucoup mieux visuellement qu'un rouge sombre ou vif. `tintLight: true`
// (comme Ligue 1/Serie A) : la minute passe en blanc, le rouge du point live
// se fondrait sinon dans ce fond.
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
    // brut #0054fc (bleu dominant du logo, 20 526 px) → corrigé, puis affiné
    // (05/09, 2e passe) pour rester lisible comme bleu même dilué en bas du
    // dégradé — voir le commentaire au-dessus de COMPETITIONS
    // ⚠️ BLEU REPRIS (06/09, demande : "pour la Ligue 1 faudrait un bleu qui
    // brille, genre vraiment beau, pas trop clair pas trop foncé, le truc
    // parfait qui fait vraiment foot"). #1a5cd6 était un bleu correct mais un
    // peu éteint. Remonté en bleu royal saturé, avec un bleu franchement
    // lumineux en couleur 2 — c'est le passage de l'un à l'autre qui donne
    // l'effet "qui brille", pas la clarté de la base (un bleu clair uniforme
    // délave la carte, un bleu sombre l'éteint).
    tint: '#1c5ce0',
    // ⚠️ AJOUT (05/09, demande utilisateur : "fond bleu clair comme Serie A ou
    // Ligue 1, la minute doit être en blanc pas en rouge"). Le rouge de la
    // minute (voir .lmp__heroMinute, LiveMatchPage.css) se lit mal sur un
    // fond déjà assez clair/saturé — seuls les tints assez CLAIRS sont
    // concernés, pas un fond neutre sombre où le rouge tranche bien.
    tintLight: true,
    // ⚠️ TEXTURE REPRISE (06/09, demande : "pour les cards des matchs de Ligue 1
    // et Premier League faut revoir les couleurs, et Serie A aussi — c'est les
    // bonnes couleurs mais faut améliorer la texture et la couleur").
    // La teinte de base était donc validée : seul le RENDU changeait. Ces
    // championnats utilisaient encore l'ancienne recette (calque fondu en
    // `overlay` avec une variante éclaircie auto-calculée), qui donnait un
    // aplat un peu terne et subissait en plus le voile noir du poster sur
    // l'Accueil. Ils passent sur la même recette que Bundesliga/LaLiga, déjà
    // validée : zones de couleur distinctes (base → couleur 2 → couleur 3),
    // aucune fusion, voile allégé. Bleu Ligue 1 en base, bleu plus vif au
    // centre, blanc en fin de dégradé (couleurs de marque du championnat).
    tint2: '#2b82ff',
    tint3: '#ffffff',
    tintSoft: true,
    tintStops: { base: '20%', c2: '50%', c3: '84%' },
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
    // Même reprise de texture que Ligue 1 (voir son commentaire) : violet de
    // marque en base, violet plus vif au centre.
    // ⚠️ VERT RETIRÉ (06/09, demande : "enlève le vert mais garde ce côté blanc
    // pour la Premier League un peu partout mais léger, pour pas que ce soit
    // que violet"). Le vert-menthe #00d9a3 (2e couleur officielle PL)
    // tranchait trop.
    // ⚠️ 2e CORRECTION le même jour ("là le blanc est en bas à droite, faudrait
    // qu'il se disperse mais qu'il soit super léger un peu partout, comme si
    // il rajoutait un effet brillant") : un dégradé LINÉAIRE range forcément
    // sa dernière couleur dans un coin — mettre du blanc ici ne pouvait donc
    // jamais donner un éclat diffus. Le blanc a été sorti de ce dégradé et
    // confié à un calque dédié, commun à toutes les compétitions teintées
    // (voir .poster__bg--gradientTri / .lmp__heroTintC : plusieurs halos
    // blancs très larges à faible opacité, répartis sur toute la carte).
    // `tint3` n'est donc plus qu'un violet un peu plus clair : il donne du
    // relief au dégradé sans créer de zone claire identifiable.
    tint2: '#9d1fa8',
    tint3: '#b57fd0',
    tintSoft: true,
    tintStops: { base: '20%', c2: '50%', c3: '84%' },
    // ⚠️ AJOUTÉ (06/09, demande : "Terminé" en blanc pour Ligue 1, Premier
    // League et Serie A). Les 2 autres avaient déjà `tintLight` ; la Premier
    // League ne l'avait pas, son violet étant moins clair qu'un bleu — il est
    // pourtant assez saturé pour que le rouge du chrono s'y noie de la même
    // façon. Effet de bord assumé et cohérent : la minute d'un match en direct
    // passe elle aussi en blanc sur cette compétition (même règle CSS).
    tintLight: true,
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
    // ⚠️ NOIR + LÉGÈRE COUCHE DE ROUGE (05/09, demande explicite finale :
    // "nn remet en noir avec une légère couche de rouge"). Historique complet
    // des essais rejetés sur CETTE compétition, pour ne pas les refaire :
    //   1. rouge pur assombri (mélangé au noir)  → "pas fan", "mauvaise teinte"
    //   2. rosé (rouge mélangé au blanc)         → remplacé par le rouge+jaune
    //   3. rouge/rose/jaune en fondu uniforme    → "c pas un changement de
    //      couleur que je voulais... vraiment un mélange... des taches"
    //   4. rouge + taches jaunes                 → "ça ressort du orange,
    //      c'est pas ouf" — cause réelle vérifiée : `mix-blend-mode: overlay`
    //      faisait FONDRE le jaune dans le rouge, et rouge+jaune fondus
    //      donnent mécaniquement de l'orange, quelle que soit la nuance de
    //      jaune choisie. 3 alternatives (taches jaunes nettes sur rouge
    //      foncé / bordeaux+or / rouge+blanc) ont été montrées en rendu réel
    //      et toutes écartées au profit du noir ci-dessous.
    // Résultat retenu : `tint` quasi noir (le dégradé partagé le mélange
    // ensuite à du noir pur, voir .lmp__hero) et `tint2` rouge sourd pour les
    // taches en mouvement — d'où un fond noir parcouru d'un voile rouge
    // discret, jamais un aplat coloré. `tintSoft` (voir LiveMatchPage.css)
    // désactive le mode de fusion `overlay` pour cette compétition et adoucit
    // les taches : sur une base aussi sombre, `overlay` écraserait le rouge
    // au lieu de le laisser transparaître.
    // ⚠️ ORDRE DES 3 COULEURS (05/09, demande finale) : noir en couleur
    // PRIMAIRE (le plus présent), puis rouge, puis une pointe de jaune —
    // "pour la liga il manque du noir et du jaune, légèrement pour le jaune
    // et plus de noir". `tint` est donc quasi noir pur (plus sombre qu'avant),
    // `tint2` le rouge, `tint3` le jaune (posé en toute fin de dégradé et à
    // faible opacité, d'où son côté "léger" — voir LiveMatchPage.css).
    // ⚠️ MOINS DE NOIR (05/09, 2e réglage : "pour la liga y'a un peu trop de
    // noir, rajoute du rouge et un peu de jaune"). Le noir s'arrête maintenant
    // à 26% (au lieu des 48% par défaut), le rouge est un peu plus clair et
    // occupe une large plage centrale, et le jaune démarre à 88% pour rester
    // une pointe sans devenir dominant.
    tint: '#140f11',
    tint2: '#b3242b',
    tint3: '#e0b040',
    tintSoft: true,
    tintStops: { base: '26%', c2: '60%', c3: '88%' },
    // Chrono ("Terminé", minute) en blanc argenté plutôt qu'en rouge — le
    // rouge se confondrait avec le rouge du fond. Voir LiveMatchPage.css.
    tintSilverText: true,
    // Pas de `tintLight` ici : le fond est redevenu sombre, la minute reprend
    // donc le rouge standard de l'app (le blanc n'était nécessaire que sur
    // les fonds clairs/rosés des versions précédentes).
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
    // ⚠️ NOIR + BLANC + UN PEU DE ROUGE (05/09, demande explicite finale :
    // "pour bundesliga fait pareil mais en noir blanc et un peu de rouge" —
    // "pareil" = le traitement validé sur LaLiga juste au-dessus).
    // Essais précédents sur CETTE compétition, pour ne pas les refaire :
    // rouge vif brut (#cc000c, trop agressif), puis rosé (rouge + blanc),
    // puis rosé avec taches blanches fondues en `overlay` — cette dernière
    // donnait un rose délavé, le blanc se diluant dans le rouge.
    // Retenu : base quasi noire (`tint`), taches blanches (`tint2`, calque
    // principal) et taches rouges plus discrètes (`tint3`, 2e calque) — d'où
    // les trois couleurs demandées, sans qu'aucune ne se fonde dans les
    // autres. `tintSoft` coupe le `mix-blend-mode: overlay` (voir
    // LiveMatchPage.css) : indispensable ici, `overlay` sur une base sombre
    // écraserait aussi bien le blanc que le rouge.
    // ⚠️ ORDRE DES 3 COULEURS (05/09, demande finale) : "couleur primaire
    // noir puis rouge puis blanc". tint2/tint3 ont été ÉCHANGÉS par rapport à
    // la version précédente (blanc puis rouge) pour respecter cet ordre : le
    // dégradé va du noir (dominant) vers le rouge, puis finit sur le blanc.
    // ⚠️ `tintStops` (05/09, demande : "pour la bundesliga mets plus de blanc
    // et moins de noir") : positions des arrêts du dégradé, propres à cette
    // compétition. Par défaut (LaLiga, validée telle quelle) le noir occupe
    // toute la première moitié et la 3e couleur n'est qu'une pointe finale ;
    // ici le noir s'arrête bien plus tôt et le blanc occupe tout le dernier
    // tiers. Voir .lmp__hero--softTint (LiveMatchPage.css).
    // ⚠️ ROUGE VIF + PLUS DE BLANC (05/09, demande : "mets un rouge plus vif,
    // vraiment rouge bien prononcé, et plus de blanc, parce que là les
    // dégradés atténuent un peu la couleur"). `tint2` passe du rouge sourd
    // #b81f26 au rouge franc #e30613 (proche du rouge de marque Bundesliga),
    // et les arrêts sont avancés : le noir s'arrête à 20% au lieu de 26%, le
    // blanc démarre à 76% au lieu de 82% et occupe donc tout le dernier quart.
    // L'atténuation venait aussi du voile noir du poster, corrigé séparément
    // (voir .poster--softTint .poster__overlay dans accueil.css).
    tint: '#131217',
    tint2: '#e30613',
    tint3: '#ffffff',
    tintSoft: true,
    tintStops: { base: '20%', c2: '48%', c3: '76%' },
    // Voir LaLiga : chrono en blanc argenté, même raison (fond noir + rouge).
    tintSilverText: true,
    // Pas de `tintLight` : fond redevenu sombre, la minute reprend le rouge
    // standard de l'app (même raison que LaLiga ci-dessus).
    name: 'Bundesliga',
    shortName: 'Bundesliga',
    emblem: bundesligaLogo,
    // ⚠️ AJOUTÉ (06/09, constat utilisateur : "le logo Bundesliga à côté du nom
    // du championnat, y'a trop de blanc en fond qui se voit"). Vérifié sur le
    // fichier lui-même (PNG 246x246, coins à rgb(209,3,19), seulement 13% de
    // pixels transparents) : c'est une TUILE ROUGE PLEINE, pas un tracé
    // détouré. Sans ce drapeau elle recevait en plus la pastille blanche
    // commune (`background: rgba(white,.94)` + 2px de marge), d'où un liseré
    // blanc tout autour. `emblemOpaque` retire pastille et marge : la tuile
    // fait elle-même office de pastille, comme pour Ligue 1 / Serie A.
    emblemOpaque: true,
  },
  {
    id: 'SA',
    // brut #0084cc (bleu dominant du logo, 2 571 px) → corrigé, puis affiné
    // (05/09, 2e passe) même raison que Ligue 1
    // ⚠️ DÉPLACÉ VERS LE TURQUOISE (06/09, constat utilisateur : "pour la Serie
    // A le bleu ressemble à celui de la Ligue 1, on peut pas modifier un peu
    // pour différencier"). Les deux championnats étaient effectivement dans le
    // même registre (#1a8fd6 contre #1c5ce0) : deux bleus qui ne se
    // distinguaient que par la clarté. Deux pistes ont été montrées en rendu
    // réel — un marine plus profond (différence de CLARTÉ) et ce bleu-cyan
    // (différence de TEINTE) ; le turquoise a été retenu parce qu'on ne peut
    // plus confondre les deux d'un coup d'œil. Ça reste fidèle au logo Serie
    // A, dont le bleu dominant (#0084cc) tire déjà vers le cyan.
    tint: '#0a5f7a',
    tintLight: true, // voir le commentaire sur FL1 (même raison)
    tint2: '#10a3b8',
    tint3: '#7fdfe8',
    tintSoft: true,
    tintStops: { base: '22%', c2: '52%', c3: '82%' },
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
