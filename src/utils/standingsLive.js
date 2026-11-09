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

/**
 * catchUpStandings — rattrape un classement football-data.org EN RETARD sur les résultats.
 *
 * CONSTAT (09/11, utilisateur) : « une équipe a une victoire dans la forme récente mais zéro
 * victoire dans la colonne ». Vérifié sur les données de l'app : Málaga 12 matchs / 0 V au
 * classement alors que les matchs football-data.org en comptent 13 dont 1 victoire ;
 * M'gladbach 9 matchs / 1 V au classement contre 10 / 2 V dans les matchs. Le classement
 * football-data.org est mis à jour avec du retard (plusieurs heures) après la fin d'une
 * journée, alors que la liste des matchs, d'où vient la forme, est déjà à jour.
 *
 * Correction : pour chaque équipe dont le nombre de matchs de championnat TERMINÉS (saison
 * en cours) dépasse `playedGames`, les derniers matchs manquants sont ajoutés à sa ligne
 * (V/N/D, buts, points, différence). Limité à 3 matchs manquants : au-delà, les deux sources
 * ne parlent pas de la même chose et on ne touche à rien. Puis reclassement par points ;
 * à égalité, l'ordre d'origine (règles de départage du championnat) est conservé entre deux
 * lignes non modifiées, sinon différence de buts puis buts marqués.
 * Les équipes en plein match ne sont pas concernées : football-data.org compte déjà le match
 * en cours au classement, il y a alors autant (ou plus) de matchs joués que de matchs terminés.
 *
 * @param {object[]} rows         lignes de classement ({ position, team, playedGames, won, draw, lost, points, goalsFor, goalsAgainst, goalDifference })
 * @param {object[]} compMatches  matchs football-data.org du championnat (useTeamForm)
 * @param {(team, matches) => any} resolveId  id football-data.org d'une ligne (ou null)
 */
export function catchUpStandings(rows, compMatches, resolveId) {
  if (!rows?.length || !compMatches?.length) return rows
  const latest = compMatches.reduce((acc, m) => (m.season?.startDate && m.season.startDate > acc ? m.season.startDate : acc), '')
  const league = compMatches.filter(m =>
    m.status === 'FINISHED' && !m.isCup &&
    (!latest || m.season?.startDate === latest) &&
    Number.isInteger(m.score?.fullTime?.home) && Number.isInteger(m.score?.fullTime?.away))
  if (!league.length) return rows
  const byTeam = new Map()
  for (const m of [...league].sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))) {
    for (const id of [m.homeTeam?.id, m.awayTeam?.id]) {
      if (id == null) continue
      if (!byTeam.has(id)) byTeam.set(id, [])
      byTeam.get(id).push(m)
    }
  }
  let changed = false
  const updated = rows.map((row, idx) => {
    const base = { ...row, _idx: idx }
    if ([row.playedGames, row.won, row.draw, row.lost, row.points].some(v => typeof v !== 'number')) return base
    const fdId = resolveId(row.team, league)
    if (fdId == null) return base
    const played = byTeam.get(fdId) ?? []
    const missing = played.length - row.playedGames
    if (missing <= 0 || missing > 3) return base
    let { won, draw, lost, points, playedGames } = row
    let gf = row.goalsFor ?? 0
    let ga = row.goalsAgainst ?? 0
    for (const m of played.slice(-missing)) {
      const home = m.homeTeam.id === fdId
      const f = home ? m.score.fullTime.home : m.score.fullTime.away
      const a = home ? m.score.fullTime.away : m.score.fullTime.home
      gf += f; ga += a; playedGames += 1
      if (f > a) { won += 1; points += 3 } else if (f === a) { draw += 1; points += 1 } else { lost += 1 }
    }
    changed = true
    return { ...base, playedGames, won, draw, lost, points, goalsFor: gf, goalsAgainst: ga, goalDifference: gf - ga, _caughtUp: true }
  })
  if (!changed) return rows
  updated.sort((a, b) =>
    (b.points - a.points) ||
    ((a._caughtUp || b._caughtUp)
      ? ((b.goalDifference ?? 0) - (a.goalDifference ?? 0)) || ((b.goalsFor ?? 0) - (a.goalsFor ?? 0)) || (a._idx - b._idx)
      : (a._idx - b._idx)))
  return updated.map((r, i) => {
    const { _idx, ...rest } = r
    void _idx
    return { ...rest, position: i + 1 }
  })
}
