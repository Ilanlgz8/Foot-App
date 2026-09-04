/**
 * standingsLive — remet d'accord les compteurs V/N/D avec les points, quand un
 * match de l'équipe est en cours.
 *
 * CONSTAT (04/09, utilisateur) : "j'ai remarqué les points changer, mais par
 * exemple même si l'équipe gagne ça comptait comme un nul dans le compteur de
 * matchs nuls, alors que les points sont comptabilisés quand l'équipe est en
 * train de gagner. Et si jamais il y a match nul, ça met -1 au compteur de
 * matchs gagnés et +1 au compteur de nuls."
 *
 * Ce que fait football-data.org : pendant un match en direct, il l'intègre
 * DÉJÀ au classement — matchs joués, points, et victoire/nul/défaite selon le
 * score du moment. Vérifié en direct pendant PSG-Monaco (PSG menait 1-0) :
 * V1 N2 D0 5pts, ce qui est parfaitement cohérent (3x1 + 2 = 5).
 *
 * Mais ces valeurs ne sont pas toutes rafraîchies au même instant chez eux :
 * il existe des fenêtres où les points ont déjà bougé et pas encore les
 * compteurs, ce qui donne exactement la ligne décrite — des points de victoire
 * avec un nul de plus au compteur. Je n'ai pas pu reproduire cet état à la
 * demande (leurs données étaient cohérentes au moment du diagnostic), mais il
 * est parfaitement identifiable : dans un championnat à 3 points la victoire,
 * une ligne saine vérifie TOUJOURS `points === 3 × victoires + nuls`.
 *
 * D'où cette correction, volontairement minimale :
 *   • elle ne se déclenche QUE si cette égalité est rompue ET que l'équipe a un
 *     match en cours — donc jamais sur une ligne saine, jamais hors match ;
 *   • elle fait confiance aux POINTS (l'utilisateur les a vus justes) et
 *     réaligne les compteurs ;
 *   • l'écart de points suffit à savoir dans quelle case le match en cours a
 *     été rangé à tort, sans rien avoir à deviner :
 *       comptabilisé comme nul alors que l'équipe mène    → écart +2
 *       comptabilisé comme défaite alors que l'équipe mène → écart +3
 *       comptabilisé comme défaite alors que c'est nul     → écart +1
 *       comptabilisé comme victoire alors que c'est nul    → écart -2
 *       comptabilisé comme victoire alors que l'équipe perd → écart -3
 *       comptabilisé comme nul alors que l'équipe perd      → écart -1
 *     Tout autre écart n'est pas explicable par un seul match mal rangé : on
 *     ne touche à rien plutôt que d'inventer une correction.
 */

/** 'W' | 'D' | 'L' — issue actuelle du match en cours, du point de vue de l'équipe. */
export function liveOutcomeFor(match, teamId) {
  if (!match || teamId == null) return null
  const h = match.score?.fullTime?.home
  const a = match.score?.fullTime?.away
  if (h == null || a == null) return null
  const chezSoi = match.homeTeam?.id === teamId
  const dehors  = match.awayTeam?.id === teamId
  if (!chezSoi && !dehors) return null
  const pour    = chezSoi ? h : a
  const contre  = chezSoi ? a : h
  if (pour > contre) return 'W'
  if (pour < contre) return 'L'
  return 'D'
}

/** Points rapportés par une issue, barème standard des 5 grands championnats. */
const POINTS = { W: 3, D: 1, L: 0 }

/**
 * @param {object} row      ligne de classement football-data.org
 * @param {'W'|'D'|'L'|null} outcome  issue du match en cours de cette équipe
 * @returns {object} la ligne, corrigée si nécessaire (même référence sinon)
 */
export function reconcileRow(row, outcome) {
  if (row == null || !outcome) return row
  const { won, draw, lost, points } = row
  if ([won, draw, lost, points].some(v => typeof v !== 'number')) return row

  const ecart = points - (3 * won + draw)
  if (ecart === 0) return row               // ligne saine : on n'y touche pas

  // Dans quelle case le match en cours a-t-il été rangé, d'après l'écart ?
  const rangeDans = Object.keys(POINTS).find(
    issue => POINTS[outcome] - POINTS[issue] === ecart
  )
  // Écart inexplicable par un seul match mal rangé (pénalité de points,
  // barème différent, données franchement cassées) : on ne corrige rien.
  if (!rangeDans || rangeDans === outcome) return row

  const compteur = { W: won, D: draw, L: lost }
  // La case erronée doit bien contenir au moins ce match, sinon la déduction
  // est fausse et on s'abstient.
  if (compteur[rangeDans] < 1) return row

  compteur[rangeDans] -= 1
  compteur[outcome]   += 1
  return { ...row, won: compteur.W, draw: compteur.D, lost: compteur.L, _liveReconciled: true }
}

/**
 * Applique la correction à tout un tableau.
 * @param {Array}  rows          lignes de classement
 * @param {Array}  liveMatches   matchs en cours (référentiel d'ID football-data)
 */
export function reconcileStandings(rows, liveMatches) {
  if (!rows?.length || !liveMatches?.length) return rows
  return rows.map(row => {
    const id = row?.team?.id
    if (id == null) return row
    const match = liveMatches.find(m => m?.homeTeam?.id === id || m?.awayTeam?.id === id)
    return match ? reconcileRow(row, liveOutcomeFor(match, id)) : row
  })
}
