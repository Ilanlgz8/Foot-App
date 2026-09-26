import { translateTeam } from '../data/teamNames'

// Sélection du "match du jour" — la carte mise en avant en haut de l'Accueil.
//
// ⚠️ INVERSÉ (26/09, demande explicite utilisateur, posée directement pour
// trancher un cas ambigu : "si un jour il y a un match de Coupe du Monde
// entre 2 petites nations ET un PSG-Marseille le même jour, tu veux quoi ?"
// → réponse "la meilleure affiche gagne, peu importe la compétition") :
// avant, la compétition (COMP_PRIORITY) décidait EN PREMIER, le score
// d'affiche (bigTeamScore) ne départageant QUE dans un même tier — un match
// de Coupe du Monde entre 2 petites nations passait donc TOUJOURS devant un
// Clasico en Ligue des Champions, uniquement parce que WC < CL dans
// COMP_PRIORITY, sans aucun rapport avec l'intérêt réel des 2 matchs.
//
// Heuristique en 3 niveaux, dans l'ordre : le score d'affiche (2 équipes
// fortes/intéressantes) décide EN PREMIER, la compétition ne sert plus que
// de départage à score d'affiche ÉGAL, et le coup d'envoi le plus tardif
// reste le tout dernier recours à égalité totale. Une affiche exceptionnelle
// (2 clubs élite) peut donc désormais dépasser une compétition mieux classée
// si l'écart d'intérêt est net — mais à intérêt équivalent, la compétition la
// plus prestigieuse (tiers ci-dessous) l'emporte toujours.
//
// ⚠️ ÉTENDU (constat utilisateur, 28/08 : "fait ça pour tous les
// championnats qu'il y'a dans l'app") : COMP_PRIORITY ne couvrait avant que
// WC/CL/les 5 grands championnats — toute autre compétition (Euro, Ligue des
// Nations, CAN, Copa America, Ligue Europa/Conférence, Supercoupe UEFA,
// Trophée des Champions, Community Shield) avait `priority == null` → SKIP
// dans la boucle plus bas → ces matchs ne pouvaient jamais devenir "match du
// jour", même seuls sur la journée. Toutes les compétitions listées dans
// data/competitions.js ont maintenant une place.
//
// Classement (tiers, du plus au moins prioritaire) :
//  0. Coupe du monde — l'événement le plus suivi au monde, aucun débat.
//  1. Euro + Ligue des Champions — les 2 compétitions les plus prestigieuses
//     de leur catégorie (nations / clubs). Quasi jamais en conflit le même
//     jour (l'Euro se joue l'été, hors saison de C1).
//  2. Supercoupe UEFA (forcément 2 clubs qui viennent de gagner un trophée
//     européen) + Copa America (continental, même registre que l'Euro pour
//     l'Amérique du Sud).
//  3. Les 5 grands championnats domestiques — le cœur du contenu quotidien
//     de l'app, volontairement à égalité entre eux (aucun favoritisme, ex.
//     Ligue 1 vs Premier League).
//  4. Ligue Europa (2e compétition officielle UEFA) + CAN (continental
//     Afrique).
//  5. Ligue des Nations, Ligue Europa Conférence, Trophée des Champions,
//     Community Shield — enjeu sportif réel plus faible (Ligue des Nations
//     longtemps vue comme un cran au-dessus d'un simple amical ; Conférence
//     L. = 3e échelon UEFA ; TDC/CS = un seul match de pré-saison chacun).
//
// ⚠️ Honnêteté : au-delà des 3 premiers tiers (assez larges pour ne pas
// prêter à débat), cet ordre est un jugement raisonnable, pas une vérité
// objective mesurée — dis-moi si un rang te semble à côté de la plaque, je
// l'ajuste.
const COMP_PRIORITY = {
  WC: 0,
  EC: 1, CL: 1,
  USC: 2, COPA: 2,
  PL: 3, PD: 3, BL1: 3, SA: 3, FL1: 3,
  UEL: 4, CAN: 4,
  NL: 5, UECL: 5, TDC: 5, CS: 5,
}

// ⚠️ AJOUT (26/09, constat utilisateur : "c clairement espagne angleterre
// la c quoi ça" — le match du jour élu était Pinatarense-Melilla, un tour
// préliminaire de Copa del Rey entre 2 clubs amateurs espagnols, DEVANT
// Espagne-Angleterre en Ligue des Nations) : root cause — un match de coupe
// domestique garde volontairement le `competition.code` du championnat
// PARENT ('PD' pour Copa del Rey, voir DOMESTIC_CUPS/fetchEspnCupMatches,
// espnAdapter.js) — `COMP_PRIORITY['PD']` valait donc 3 (le MÊME tier qu'un
// vrai Real Madrid-Barcelone), très largement devant NL (tier 5), sans
// aucun rapport avec l'intérêt réel du match. Un tour préliminaire de coupe
// entre clubs amateurs n'a évidemment pas le même enjeu qu'un vrai match de
// championnat — ce tier dédié, le plus bas de tous (6, sous NL/UECL/TDC/CS),
// s'applique à TOUT match de coupe domestique quel que soit le tier de son
// championnat parent. Honnêteté : comme le reste de ce fichier, un jugement
// assumé, pas une science exacte — une finale de coupe entre 2 grands clubs
// mériterait sans doute mieux qu'un tier 6, mais rien dans les données
// dispo ici ne distingue un tour préliminaire d'une finale de façon fiable
// (voir mapEspnStage, espnAdapter.js) ; à ajuster si un vrai cas de finale
// se présente et semble mal classé.
const DOMESTIC_CUP_PRIORITY = 6

function compPriority(match) {
  if (match.isCup) return DOMESTIC_CUP_PRIORITY
  return COMP_PRIORITY[match.competition?.code]
}

// ⚠️ AJOUT (constat utilisateur, 28/08 : "le but du match du jour c'est de
// montrer... la rencontre la plus solide, la plus attendue... par rapport à
// l'influence des deux équipes" — avant ce fix, à compétition égale, seul le
// coup d'envoi le plus tardif départageait, sans jamais regarder QUI joue :
// un America 20h anonyme passait devant un Real Madrid-Barcelone 13h le même
// jour). Honnêteté : il n'existe aucune donnée "popularité"/"enjeu" exploitable
// sans appel API supplémentaire (budget FD.org déjà fragile, voir CLAUDE.md) —
// ceci reste une liste CURÉE (clubs ET sélections nationales), pas un score
// calculé/objectif. Sert uniquement de départage DANS un même tier de
// COMP_PRIORITY (ne change jamais l'ordre des tiers ci-dessus) : un match
// avec 2 entrées de cette liste passe devant un match avec 1 seule, qui passe
// devant un match sans aucune. `translateTeam` (déjà utilisé partout dans
// l'app pour unifier les variantes de noms ESPN/FD.org, voir data/teamNames.js)
// garantit que ça fonctionne quelle que soit la source du match.
//
// ⚠️ ÉTENDU (28/08, même demande : "analyse bien les équipes les plus fortes
// et intéressantes parmi les autres") : liste initiale limitée aux clubs des
// 5 grands championnats — complétée avec les sélections nationales les plus
// titrées/haut classées pour WC/EC/NL (Coupe du monde/Euro, vainqueurs et
// finalistes récents), CAN (vainqueurs/finalistes récents, meilleures nations
// africaines au classement FIFA) et Copa America (grandes nations CONMEBOL),
// plus 2 clubs européens historiques hors "5 grands championnats" qui
// reviennent régulièrement en Ligue Europa/Ligue des Champions (Ajax, Benfica
// — plusieurs Coupes d'Europe chacun, palmarès objectif, pas une préférence).
// ⚠️ REBALANCÉ (constat utilisateur, 02/09 : "le match du jour choisi entre
// les 5 grands championnats n'est pas terrible") : root cause identifiée en
// comptant les entrées par championnat — Premier League (6 clubs) et Serie A
// (4) avaient beaucoup plus de clubs "gros" que Ligue 1 (2) ou Bundesliga (2),
// donc statistiquement bien plus de chances de sortir un bigScore élevé un
// week-end donné (plus de paires possibles entre clubs listés), peu importe
// si le vrai choc du jour était ailleurs. Complété avec des clubs au
// palmarès européen/domestique objectivement comparable (mêmes critères que
// le reste de la liste, aucune préférence personnelle) : Lyon (7 titres de
// champion consécutifs 2002-2008, habitué des soirées européennes) et Monaco
// (finaliste C1 2004, champion 2017) pour la Ligue 1 ; RB Leipzig (habitué
// de la phase à élimination directe de C1, finaliste de coupe d'Allemagne) et
// Leverkusen (champion d'Allemagne invaincu 2023-24) pour la Bundesliga.
// ⚠️ Séville RETIRÉ d'ici, déplacé dans NOTABLE_TEAMS (constat utilisateur,
// 11/09 : "aujourd'hui c'est Valence-Séville alors qu'il y a un meilleur
// match qui est Rennes-Marseille") — root cause : Séville (2 pts, BIG_TEAMS)
// + Valence (1 pt, NOTABLE_TEAMS) = 3, EXACTEMENT à égalité avec Marseille
// (2 pts) + Rennes (1 pt) = 3 — le départage tombait alors sur le coup
// d'envoi le plus tardif (voir electBest), purement horaire, sans lien avec
// le "meilleur match". Son ajout initial ci-dessus reposait sur un palmarès
// européen réel (7 Ligues Europa) mais plus étroit que celui des autres clubs
// de ce tier (champions nationaux/finalistes C1) — objectivement un cran
// en dessous en termes d'affiche générale, d'où son déplacement au tier du
// dessous plutôt qu'un retrait pur et simple. Avec ce changement, Rennes-
// Marseille (1+2=3) devance désormais clairement Valence-Séville (1+1=2).
const BIG_TEAMS = new Set([
  // Ligue 1
  'Paris SG', 'Marseille', 'Lyon', 'Monaco',
  // Premier League
  'Man. City', 'Man. United', 'Liverpool', 'Arsenal', 'Chelsea', 'Tottenham',
  // La Liga
  'Real Madrid', 'Barcelone', 'Atlético Madrid',
  // Bundesliga
  'Bayern Munich', 'Dortmund', 'RB Leipzig', 'Leverkusen',
  // Serie A
  'Juventus', 'Inter Milan', 'Milan AC', 'Naples',
  // Autres clubs européens historiques (Ligue Europa/Ligue des Champions) —
  // plusieurs Coupes d'Europe/Ligues des Champions chacun, palmarès objectif.
  // Porto/PSV Eindhoven/Feyenoord ajoutés le 26/09 (demande utilisateur :
  // "pour tous les championnats différents faut qu'on mette les meilleures
  // équipes à chaque fois") — Ajax/Benfica seuls ne couvraient qu'une
  // fraction de la Ligue Europa/Conférence hors 5 grands championnats. Même
  // critère objectif (palmarès européen réel) : Porto (2 Coupes des clubs
  // champions/C1 1987+2004, 2 Coupes UEFA 2003+2011), PSV Eindhoven (1 Coupe
  // des clubs champions 1988), Feyenoord (1 Coupe des clubs champions 1970,
  // 2 Coupes UEFA 1974+2002). Honnêteté : contrairement au reste de cette
  // liste (noms vérifiés un par un sur de vrais matchs ESPN/FD.org), ces 3
  // clubs n'ont jamais encore été rencontrés par l'app — libellé choisi par
  // cohérence avec teamNames.js, à corriger si un vrai match révèle une autre
  // forme de nom.
  'Ajax', 'Benfica', 'Porto', 'PSV Eindhoven', 'Feyenoord',
  // Coupe du monde / Euro / Ligue des Nations — vainqueurs et finalistes
  // récents, plus historiquement dominants
  'France', 'Brésil', 'Argentine', 'Angleterre', 'Espagne', 'Allemagne',
  'Portugal', 'Italie', 'Pays-Bas', 'Belgique', 'Croatie',
  // Copa America — grandes nations CONMEBOL. Paraguay/Pérou ajoutés le 26/09
  // (même demande que ci-dessus) : sur les 10 membres CONMEBOL, seuls 4
  // étaient listés (hors Brésil/Argentine déjà dans le groupe Mondial/Euro
  // au-dessus). Pérou (vainqueur 1975, finaliste 2011) et Paraguay (finaliste
  // à 6 reprises dont 2011) ont un palmarès continental comparable à
  // Chili/Équateur déjà présents.
  'Uruguay', 'Colombie', 'Chili', 'Équateur', 'Paraguay', 'Pérou',
  // CAN — vainqueurs/finalistes récents, meilleures nations africaines
  'Maroc', 'Sénégal', 'Nigeria', 'Égypte', 'Algérie', 'Côte d\'Ivoire',
  'Cameroun', 'Ghana', 'Tunisie', 'Afrique du Sud',
])

// ⚠️ AJOUT 2e NIVEAU (constat utilisateur, 02/09 : "Toulouse et Lille sont
// plus intéressants que Real Sociedad et Celta Vigo"). Avant ce fix, AUCUNE
// de ces 4 équipes n'était listée : le score d'affiche valait 0 des deux
// côtés, et c'est le coup d'envoi le plus tardif qui tranchait (21:00 contre
// 20:45) — un départage sans le moindre sens sportif, purement horaire.
//
// Honnêteté sur ce que c'est : aucune donnée disponible dans l'app ne permet
// de mesurer qu'un match est "plus intéressant" qu'un autre (la position au
// classement ou la cote de chaque match exigeraient un appel réseau
// supplémentaire par match — budget football-data.org déjà fragile, voir
// CLAUDE.md). C'est donc une liste CURÉE, un jugement assumé, pas un score
// calculé. D'où ce 2e niveau : des clubs qui comptent réellement dans le
// paysage de leur championnat sans être des géants européens (habitués du
// haut de tableau, de la coupe d'Europe ou vainqueurs récents d'un trophée
// national). Ils pèsent moitié moins qu'un club du 1er niveau — un vrai choc
// entre géants reste donc toujours devant.
// Si un choix te paraît à côté de la plaque, dis-le : c'est une liste, elle
// s'ajuste en une ligne.
// ⚠️ Les libellés ci-dessous doivent être ceux que renvoie translateTeam()
// (vérifiés un par un en exécutant translateTeam sur les noms réels FD.org
// ET ESPN — c'est comme ça que "Real Betis" a été corrigé en "Betis", la
// table de traduction raccourcissant ce nom-là). Voir aussi teamMatchesSet()
// juste en dessous : selon la source, `shortName` peut être absent ou déjà
// être le nom long, donc les deux champs sont testés.
// ⚠️ COMPLÉTÉ (26/09, demande utilisateur : "pour tous les championnats
// différents faut qu'on mette les meilleures équipes à chaque fois") : audit
// des 5 grands championnats — chacun avait un club récent, qualifié en Ligue
// des Champions ou en forte progression, absent de cette liste (score 0 alors
// qu'il pèse réellement plus qu'un club anonyme). Même critère déjà établi
// (habitué du haut de tableau ou de la coupe d'Europe) : Brest (qualifié C1
// 2024-25, 1re campagne européenne à ce niveau de son histoire), Brighton
// (qualifié en coupe d'Europe chaque saison depuis 2022-23), Real Sociedad
// (habituée de la C1/Ligue Europa), Girona (vice-champion d'Espagne 2023-24,
// 1re participation C1 de son histoire), Union Berlin (qualifié C1 2023-24,
// 1re campagne européenne majeure de son histoire), Bologne (qualifié C1
// 2024-25, 1re campagne européenne depuis des décennies).
const NOTABLE_TEAMS = new Set([
  // Ligue 1
  'Lille', 'Lens', 'Nice', 'Rennes', 'Toulouse', 'Strasbourg', 'Brest',
  // Premier League
  'Newcastle', 'Aston Villa', 'West Ham', 'Everton', 'Brighton',
  // La Liga
  'Villarreal', 'Betis', 'Athletic Bilbao', 'Valence', 'Séville',
  'Real Sociedad', 'Girona',
  // Bundesliga
  'Francfort', 'Stuttgart', "M'gladbach", 'Wolfsburg', 'Union Berlin',
  // Serie A
  'Rome', 'Lazio', 'Atalanta', 'Fiorentina', 'Bologne',
])

// ⚠️ Teste `shortName` ET `name` (bug évité de justesse en vérifiant sur les
// vrais noms) : selon la source du match, l'un ou l'autre peut être le seul
// à correspondre. Exemples réels mesurés — FD.org donne shortName "Lille" et
// name "LOSC Lille" ; côté ESPN certains matchs n'ont pas de shortName du
// tout et arrivent en "Toulouse FC". Ne regarder qu'un seul des deux champs
// (l'ancien comportement) faisait silencieusement rater la moitié des clubs
// de la liste selon la compétition, sans que rien ne le signale.
function teamMatchesSet(team, set) {
  const short = translateTeam(team?.shortName || '')
  const full  = translateTeam(team?.name || '')
  return set.has(short) || set.has(full)
}

// ⚠️ AJOUT 3e NIVEAU "ÉLITE" (constat utilisateur, 02/09 : "Arsenal-Chelsea,
// même si c'est pas le soir, c'est plus intéressant" que Juventus-Milan).
// Root cause : les deux matchs avaient EXACTEMENT le même score (2 clubs du
// 1er niveau chacun = 4), et le seul départage restant était le coup d'envoi
// le plus tardif — Juventus-Milan à 20h45 passait donc devant Arsenal-Chelsea
// à 17h30 pour une raison purement horaire, sans aucun sens sportif. Le vrai
// problème n'était pas la règle de départage mais le manque de granularité :
// un seul niveau "gros club" mettait Arsenal au même rang que la Juventus.
// Ce 3e niveau (3 points) est réservé aux clubs qui remplissent un stade
// n'importe où dans le monde. Choisi avec l'utilisateur, assumé comme un
// jugement : il n'existe aucune donnée dans l'app pour mesurer ça (voir le
// commentaire de NOTABLE_TEAMS). Tout le reste de BIG_TEAMS reste à 2.
const ELITE_TEAMS = new Set([
  'Real Madrid', 'Barcelone', 'Bayern Munich', 'Paris SG',
  'Man. City', 'Liverpool', 'Arsenal', 'Chelsea',
])

// Score d'affiche : 3 points par club "élite", 2 par club du 1er niveau,
// 1 par club du 2e. Deux élites (6) devancent une élite + un gros (5), qui
// devance deux gros (4), etc. — la somme des 2 équipes (pas une seule) fait
// qu'un club énorme contre un amateur (ex. Real Madrid en coupe contre un
// club de division régionale) ne score jamais aussi haut qu'un vrai choc où
// LES DEUX équipes sont fortes, cohérent avec "la rencontre de deux fortes
// équipes" plutôt qu'une seule.
// ⚠️ DEVENU LE CRITÈRE PRINCIPAL (26/09, voir l'en-tête du fichier) : décide
// maintenant EN PREMIER, COMP_PRIORITY ne sert plus qu'à départager une
// égalité de score d'affiche.
function bigTeamScore(match) {
  const rank = (team) =>
    teamMatchesSet(team, ELITE_TEAMS) ? 3
      : teamMatchesSet(team, BIG_TEAMS) ? 2
      : teamMatchesSet(team, NOTABLE_TEAMS) ? 1
      : 0
  return rank(match.homeTeam) + rank(match.awayTeam)
}

const UPCOMING_STATUSES = new Set(['SCHEDULED', 'TIMED'])
const ONGOING_STATUSES  = new Set(['IN_PLAY', 'PAUSED', 'SUSPENDED'])
// Un match REPORTÉ/ANNULÉ ne doit jamais pouvoir être élu match du jour : il
// n'aura pas lieu, la carte resterait bloquée dessus toute la journée.
const DEAD_STATUSES = new Set(['POSTPONED', 'CANCELLED', 'SUSPENDED_INDEFINITELY'])

// Élit le meilleur match d'une liste selon les 3 critères, dans l'ordre :
// score d'affiche (2 équipes fortes/intéressantes), puis prestige de la
// compétition (départage uniquement), puis coup d'envoi le plus tardif (tout
// dernier recours — voir ELITE_TEAMS : c'est justement pour éviter d'y
// arriver trop souvent que le 3e niveau de score a été ajouté).
// ⚠️ ORDRE INVERSÉ (26/09, voir l'en-tête du fichier) : avant, la compétition
// décidait en premier et le score d'affiche ne départageait QUE dans un même
// tier — désormais l'inverse, demande explicite utilisateur ("la meilleure
// affiche gagne, peu importe la compétition").
function electBest(candidates) {
  let best = null
  let bestBigScore = -1
  let bestPriority = Infinity
  for (const m of candidates) {
    const priority = compPriority(m)
    if (priority == null) continue
    const bigScore = bigTeamScore(m)
    if (bigScore > bestBigScore) {
      bestBigScore = bigScore
      bestPriority = priority
      best = m
    } else if (bigScore === bestBigScore && best) {
      if (priority < bestPriority) {
        bestPriority = priority
        best = m
      } else if (priority === bestPriority && new Date(m.utcDate) > new Date(best.utcDate)) {
        best = m
      }
    }
  }
  return best
}

/**
 * Retourne le match à mettre en avant aujourd'hui, ou null s'il n'y a rien à
 * mettre en avant.
 *
 * ⚠️ ÉPINGLAGE (constat/demande utilisateur, 02/09 : "c'est possible que la
 * card du match du jour reste pour le match en question, pour après avoir la
 * card en mode live avec le score ?"). C'était un vrai trou, pas un ajout :
 * cette fonction ne regardait QUE les matchs pas encore commencés
 * (SCHEDULED/TIMED). Dès le coup d'envoi, le match élu quittait donc le lot
 * de candidats et la carte sautait à un AUTRE match (ou disparaissait s'il
 * en restait moins de 2) — alors que MatchDuJourCard.jsx contient tout le
 * rendu live (pastille "En direct", minute, score géant) et le rendu
 * "Terminé", du code qui ne pouvait quasiment jamais s'afficher pour le
 * match choisi.
 *
 * Nouveau comportement : dès qu'un match en cours (ou terminé aujourd'hui)
 * est présent, on élit le meilleur PARMI CES MATCHS-LÀ en priorité — donc
 * une fois lancé, le match du jour reste affiché et bascule naturellement en
 * mode live puis "Terminé", au lieu d'être remplacé. On ne repart sur les
 * matchs à venir que quand plus rien n'est en cours ou fini.
 * Un match en cours l'emporte toujours sur un match à venir : c'est celui
 * qu'on veut voir en direct sur l'Accueil.
 *
 * Le garde-fou historique "moins de 2 matchs à venir = pas de carte" (la
 * carte n'apporte rien si elle double le seul match visible ailleurs sur la
 * page) ne s'applique donc plus qu'au cas pré-match.
 */
export function pickMatchDuJour(matches) {
  // ⚠️ BUG CORRIGÉ (constat utilisateur, 02/09 : "le match du jour vient de se
  // finir et maintenant c'est l'autre match qui est affiché comme match du
  // jour, c'est pas bon — il faut qu'il y en ait UN SEUL par jour").
  // Cause : cette fonction classait les candidats par STATUT (un match en
  // cours passait devant, sinon un terminé, sinon les à venir). Le lot de
  // candidats changeait donc au fil de la journée, et l'élu avec — au coup de
  // sifflet final du match du jour, un autre match en cours prenait sa place.
  // C'était une conséquence non vue de l'épinglage ajouté plus tôt (dc4c8cd),
  // qui visait justement à garder la carte sur SON match une fois lancé.
  //
  // L'élection porte maintenant sur TOUS les matchs du jour d'un coup, quel
  // que soit leur statut. Le résultat ne dépend donc plus que de la liste du
  // jour (compétition, affiche, coup d'envoi) — des données qui ne bougent pas
  // de la journée. Un seul match du jour, du matin jusqu'au soir, qui passe
  // naturellement de "à venir" à "en direct" puis "terminé" sans jamais être
  // remplacé.
  const all = (matches ?? []).filter(m => !DEAD_STATUSES.has(m.status))

  // Garde-fou historique conservé : une carte qui met en avant le seul match
  // de la journée n'apporte rien, il est déjà visible partout ailleurs sur la
  // page. Compté sur TOUS les matchs du jour (et non plus les seuls "à venir")
  // — sinon la carte disparaissait dès qu'il ne restait qu'un match à jouer,
  // alors que la journée en comptait plusieurs.
  //
  // ⚠️ BUG CORRIGÉ (constat utilisateur, 15/09 : "quand il reste plus que
  // [le match en cours] et que les autres sont terminé il redevient comme
  // les autres cards basique" — PAS après la fin du match du jour lui-même,
  // pendant qu'il est encore en direct). Reproduit en isolant `pickMatchDuJour`
  // (2 matchs FINISHED + 1 IN_PLAY → élit bien le match en cours ; le MÊME
  // match seul dans le tableau → `null`, alors que rien n'a changé pour LUI).
  // Root cause : `all` reflète le tableau `matches` REÇU en argument (au final
  // `todayMatchesForResults`, Accueil.jsx) — si les 2 autres matchs finis
  // disparaissent de CE tableau au fil de la journée (rafraîchissement réseau,
  // repli `upcomingAllComps` qui ne garde que SCHEDULED/TIMED, etc. — un
  // problème de FLUX DE DONNÉES, pas de cette fonction), `all.length` tombe
  // à 1 pour le SEUL match qui compte encore : celui déjà épinglé, en cours
  // ou terminé. Le garde-fou "carte redondante" n'a jamais eu de sens pour ce
  // cas : une fois qu'un match a débuté, l'affiche n'affiche plus jamais un
  // simple doublon (minute live/score/"Terminé", absents de la card normale
  // pour CE match précis — voir le filet anti-doublon dans Accueil.jsx) —
  // elle mérite donc sa place même si elle se retrouve seule dans le tableau.
  // Ne s'applique donc plus qu'au cas où AUCUN candidat n'a encore débuté
  // (vrai cas pré-match visé à l'origine par ce garde-fou).
  const hasStarted = all.some(m => !UPCOMING_STATUSES.has(m.status))
  if (!hasStarted && all.length < 2) return null

  const elected = electBest(all)

  // ⚠️ RETOUR ARRIÈRE (16/09, demande explicite : "quand le match est
  // terminé faut bien qu'elle disparaisse comme toutes les autres frerot")
  // — annule le comportement ajouté le 02/09 (voir tout l'historique
  // ci-dessus) : une fois TERMINÉ, le match élu ne reste plus affiché avec
  // son score final jusqu'au lendemain, la carte disparaît comme n'importe
  // quelle autre card une fois le match fini. L'algorithme d'élection
  // lui-même est inchangé (le même match reste "le meilleur du jour" tout
  // du long, invariant au statut — voir electBest) : ça évite de retomber
  // dans le bug du 02/09 où un AUTRE match prenait la place une fois le
  // 1er terminé. Ici, une fois l'élu terminé, on masque simplement la
  // carte plutôt que d'élire un remplaçant — jamais de bascule vers un
  // 2e match, juste une disparition.
  if (elected?.status === 'FINISHED') return null

  return elected
}

// Statuts exportés pour les tests (et pour éviter qu'un appelant réinvente
// sa propre liste ailleurs).
export const MDJ_STATUSES = { UPCOMING_STATUSES, ONGOING_STATUSES, DEAD_STATUSES }
