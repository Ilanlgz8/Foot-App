import { translateTeam } from '../data/teamNames'

// Sélection du "match du jour" — la carte mise en avant en haut de l'Accueil.
//
// Heuristique en 3 niveaux : priorité à la compétition la plus prestigieuse,
// puis — à égalité de compétition — à l'affiche la plus attendue entre les
// deux équipes, puis — à égalité totale — au coup d'envoi le plus tardif de
// la journée (créneau prime-time).
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
// Leverkusen (champion d'Allemagne invaincu 2023-24) pour la Bundesliga ;
// Séville (club le plus titré en Ligue Europa, 7 trophées) pour la Liga.
const BIG_TEAMS = new Set([
  // Ligue 1
  'Paris SG', 'Marseille', 'Lyon', 'Monaco',
  // Premier League
  'Man. City', 'Man. United', 'Liverpool', 'Arsenal', 'Chelsea', 'Tottenham',
  // La Liga
  'Real Madrid', 'Barcelone', 'Atlético Madrid', 'Séville',
  // Bundesliga
  'Bayern Munich', 'Dortmund', 'RB Leipzig', 'Leverkusen',
  // Serie A
  'Juventus', 'Inter Milan', 'Milan AC', 'Naples',
  // Autres clubs européens historiques (Ligue Europa/Ligue des Champions)
  'Ajax', 'Benfica',
  // Coupe du monde / Euro / Ligue des Nations — vainqueurs et finalistes
  // récents, plus historiquement dominants
  'France', 'Brésil', 'Argentine', 'Angleterre', 'Espagne', 'Allemagne',
  'Portugal', 'Italie', 'Pays-Bas', 'Belgique', 'Croatie',
  // Copa America — grandes nations CONMEBOL
  'Uruguay', 'Colombie', 'Chili', 'Équateur',
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
const NOTABLE_TEAMS = new Set([
  // Ligue 1
  'Lille', 'Lens', 'Nice', 'Rennes', 'Toulouse', 'Strasbourg',
  // Premier League
  'Newcastle', 'Aston Villa', 'West Ham', 'Everton',
  // La Liga
  'Villarreal', 'Betis', 'Athletic Bilbao', 'Valence',
  // Bundesliga
  'Francfort', 'Stuttgart', "M'gladbach", 'Wolfsburg',
  // Serie A
  'Rome', 'Lazio', 'Atalanta', 'Fiorentina',
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

// Score d'affiche : 2 points par club du 1er niveau, 1 point par club du 2e.
// Un match entre 2 géants (4) devance un géant + un club notable (3), qui
// devance 2 clubs notables (2), etc. — la hiérarchie reste lisible sans
// jamais inverser l'ordre des tiers de COMP_PRIORITY (ce score ne sert qu'à
// départager DANS un même tier).
function bigTeamScore(match) {
  const rank = (team) =>
    teamMatchesSet(team, BIG_TEAMS) ? 2
      : teamMatchesSet(team, NOTABLE_TEAMS) ? 1
      : 0
  return rank(match.homeTeam) + rank(match.awayTeam)
}

/**
 * Retourne le match à mettre en avant parmi les matchs pas encore commencés
 * aujourd'hui, ou null s'il n'y en a aucun dans une compétition couverte, ou
 * s'il n'y a qu'un seul match à venir (la carte n'a alors aucun intérêt :
 * c'est déjà le seul match visible partout ailleurs sur la page).
 */
export function pickMatchDuJour(matches) {
  const upcoming = (matches ?? []).filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED')
  if (upcoming.length < 2) return null

  let best = null
  let bestPriority = Infinity
  let bestBigScore = -1
  for (const m of upcoming) {
    const priority = COMP_PRIORITY[m.competition?.code]
    if (priority == null) continue
    const bigScore = bigTeamScore(m)
    if (priority < bestPriority) {
      bestPriority = priority
      bestBigScore = bigScore
      best = m
    } else if (priority === bestPriority && best) {
      if (bigScore > bestBigScore) {
        bestBigScore = bigScore
        best = m
      } else if (bigScore === bestBigScore && new Date(m.utcDate) > new Date(best.utcDate)) {
        best = m
      }
    }
  }
  return best
}
