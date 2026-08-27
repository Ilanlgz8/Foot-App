import { translateTeam } from '../data/teamNames'

// Sélection du "match du jour" — la carte mise en avant en haut de l'Accueil.
//
// Heuristique en 3 niveaux : priorité à la compétition la plus prestigieuse,
// puis — à égalité de compétition — à l'affiche la plus attendue entre les
// deux équipes, puis — à égalité totale — au coup d'envoi le plus tardif de
// la journée (créneau prime-time).
//
// Les 5 grands championnats domestiques sont volontairement à égalité entre eux
// (aucun favoritisme, ex. Ligue 1 vs Premier League) — seule la Coupe du Monde
// et la Ligue des Champions priment.
const COMP_PRIORITY = { WC: 0, CL: 1, PL: 2, PD: 2, BL1: 2, SA: 2, FL1: 2 }

// ⚠️ AJOUT (constat utilisateur, 28/08 : "le but du match du jour c'est de
// montrer... la rencontre la plus solide, la plus attendue... par rapport à
// l'influence des deux équipes" — avant ce fix, à compétition égale, seul le
// coup d'envoi le plus tardif départageait, sans jamais regarder QUI joue :
// un America 20h anonyme passait devant un Real Madrid-Barcelone 13h le même
// jour). Honnêteté : il n'existe aucune donnée "popularité"/"enjeu" exploitable
// sans appel API supplémentaire (budget FD.org déjà fragile, voir CLAUDE.md) —
// ceci reste une liste CURÉE des clubs les plus suivis mondialement dans les 5
// grands championnats + habitués C1, pas un score calculé/objectif. Sert
// uniquement de départage DANS une même compétition (n'change jamais l'ordre
// Mondial > C1 > 5 grands championnats déjà en place) : un match avec 2 clubs
// de cette liste passe devant un match avec 1 seul, qui passe devant un match
// sans aucun. `translateTeam` (déjà utilisé partout dans l'app pour unifier
// les variantes de noms ESPN/FD.org, voir data/teamNames.js) garantit que ça
// fonctionne quelle que soit la source du match.
const BIG_CLUBS = new Set([
  // Ligue 1
  'Paris SG', 'Marseille',
  // Premier League
  'Man. City', 'Man. United', 'Liverpool', 'Arsenal', 'Chelsea', 'Tottenham',
  // La Liga
  'Real Madrid', 'Barcelone', 'Atlético Madrid',
  // Bundesliga
  'Bayern Munich', 'Dortmund',
  // Serie A
  'Juventus', 'Inter Milan', 'Milan AC', 'Naples',
])

function bigClubScore(match) {
  const home = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '')
  const away = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '')
  return (BIG_CLUBS.has(home) ? 1 : 0) + (BIG_CLUBS.has(away) ? 1 : 0)
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
    const bigScore = bigClubScore(m)
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
