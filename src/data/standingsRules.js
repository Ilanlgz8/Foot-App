// Zones de couleur des classements (pastilles + légende) — SOURCE UNIQUE pour toute l'app : page
// Classement, onglet Classement des pages de match (MatchModal.jsx), fiche équipe (TeamSearchPage.jsx).
// Revu le 19/11 (règles 2026-27 vérifiées) :
//  • Places européennes 2027-28 = indice UEFA des pays à la fin de 2025-26 : Angleterre, Italie,
//    Espagne, Allemagne (rangs 1-4) → 4 places directes en Ligue des champions ; France 5e → 3
//    places directes + le 4e au 3e tour de qualification. 5e (et 6e, la place du vainqueur de coupe
//    retombant presque toujours sur le championnat) en Europa League, suivant en Conférence League.
//    La 5e place « bonus » en Ligue des champions (performance européenne) ne se connaîtra qu'en mai
//    2027 → pas affichée.
//  • Relégations : Ligue 1 / Bundesliga / Ligue 2 = 2 directes + barrage du 16e ; PL / Liga / Serie A
//    = 3 directes ; Ligue 3 = 16e à 18e (règlement FFF 2026-27).
//  • Coupes d'Europe (phase de ligue à 36) : 1-8 huitièmes, 9-24 barrages, 25-36 éliminés — même
//    règle en Ligue des champions, Europa League et Conférence League.
//  • Phases finales à poules de 4 avec « meilleurs 3es » (Coupe du monde à 48, Euro, CAN) : 3e = peut
//    encore passer. Copa América (édition 2024, 16 équipes) : 2 premiers seulement.
//  • Ligue des nations 2026-27 : règles différentes selon la ligue (A, B, C, D) du groupe.
//  • Éliminatoires CAN 2027 : 2 premiers qualifiés, sauf groupes des pays hôtes (D Kenya, H Ouganda,
//    L Tanzanie : hôte + meilleur des autres) → pas de zone là plutôt qu'une zone fausse.
// Pas de règle connue = pas de zone (jamais une zone inventée).

const Z = (label, start, end, kind) => ({
  label, start, end,
  dotClassName: `classement__zoneDot classement__zoneDot--${kind}`,
  cardClassName: `classement__zoneCard--${kind}`,
})

const BIG4_EUROPE = [
  Z('Ligue des champions', 1, 4, 'ucl'),
  Z('Europa League', 5, 6, 'uel'),
  Z('Conférence League', 7, 7, 'uecl'),
]
const FL1_EUROPE = [
  Z('Ligue des champions', 1, 3, 'ucl'),
  { ...Z('Qualif. Ligue des champions', 4, 4, 'barrage'), dotClassName: 'classement__zoneDot classement__L1__zoneDot--barrage' },
  Z('Europa League', 5, 6, 'uel'),
  Z('Conférence League', 7, 7, 'uecl'),
]
const LEAGUE_PHASE = [
  Z('Huitièmes de finale', 1, 8, 'ucl'),
  Z('Barrages', 9, 24, 'barrage'),
  Z('Éliminé', 25, 36, 'elimine'),
]
const GROUP_BEST_THIRDS = [
  Z('Qualifié', 1, 2, 'ucl'),
  Z('Meilleurs 3es', 3, 3, 'barrage'),
  Z('Éliminé', 4, 4, 'elimine'),
]
const GROUP_TOP2 = [
  Z('Qualifié', 1, 2, 'ucl'),
  Z('Éliminé', 3, 4, 'elimine'),
]

const TOP = {
  FL1: FL1_EUROPE,
  PL: BIG4_EUROPE, PD: BIG4_EUROPE, BL1: BIG4_EUROPE, SA: BIG4_EUROPE,
  FL2: [Z('Montée en Ligue 1', 1, 2, 'ucl'), Z('Play-offs', 3, 5, 'barrage')],
  L3:  [Z('Montée en Ligue 2', 1, 2, 'ucl'), Z("Play-off d'accession", 3, 6, 'barrage')],
  CL: LEAGUE_PHASE, UEL: LEAGUE_PHASE, UECL: LEAGUE_PHASE,
  WC: GROUP_BEST_THIRDS, EC: GROUP_BEST_THIRDS, CAN: GROUP_BEST_THIRDS,
  COPA: GROUP_TOP2,
}

// direct = relégués d'office ; playoff = barrage juste au-dessus.
const RELEGATION = {
  FL1: { direct: 2, playoff: 1 },
  BL1: { direct: 2, playoff: 1 },
  FL2: { direct: 2, playoff: 1 },
  PL:  { direct: 3, playoff: 0 },
  PD:  { direct: 3, playoff: 0 },
  SA:  { direct: 3, playoff: 0 },
  L3:  { direct: 3, playoff: 0 },
}

function relegationZones(compId, teamCount) {
  const r = RELEGATION[compId]
  // Positions calculées sur le nombre RÉEL d'équipes affichées ; classement trop court = pas de zone.
  if (!r || !teamCount || teamCount < 10) return []
  const out = []
  if (r.playoff > 0) {
    const start = teamCount - r.direct - r.playoff + 1
    out.push(Z('Barrage relégation', start, start + r.playoff - 1, 'relegBarrage'))
  }
  out.push(Z('Relégation', teamCount - r.direct + 1, teamCount, 'relegation'))
  return out
}

// Ligue des nations : la ligue se lit dans le nom du groupe ESPN (« Group A1 », « League B Group 2 »…).
function nationsLeagueZones(groupName) {
  const s = String(groupName ?? '')
  const letter = (/league[\s_]*([A-D])/i.exec(s) ?? /group[\s_]*([A-D])[\s_]*\d/i.exec(s))?.[1]?.toUpperCase()
  switch (letter) {
    case 'A': return [Z('Quarts de finale', 1, 2, 'ucl'), Z('Maintien ou barrage', 3, 3, 'barrage'), Z('Barrage ou relégation', 4, 4, 'relegBarrage')]
    case 'B': return [Z('Montée en Ligue A', 1, 1, 'ucl'), Z('Barrage montée', 2, 2, 'barrage'), Z('Barrage relégation', 4, 4, 'relegBarrage')]
    case 'C': return [Z('Montée en Ligue B', 1, 1, 'ucl'), Z('Barrage montée', 2, 2, 'barrage')]
    case 'D': return [Z('Montée en Ligue C', 1, 3, 'ucl')]
    default:  return []
  }
}

function canQualifZones(groupName) {
  const g = /group[\s_]*([A-L])\b/i.exec(String(groupName ?? ''))?.[1]?.toUpperCase()
  if (!g || g === 'D' || g === 'H' || g === 'L') return []
  return [Z('Qualifié', 1, 2, 'ucl')]
}

// compId : code compétition (FL1, PL, CL…). opts.teamCount : nombre d'équipes du classement
// (relégation). opts.groupName : nom du groupe (compétitions à poules).
export function getStandingsRules(compId, { teamCount = 0, groupName = null } = {}) {
  if (compId === 'NL') return nationsLeagueZones(groupName)
  if (compId === 'CANQ') return canQualifZones(groupName)
  return [...(TOP[compId] ?? []), ...relegationZones(compId, teamCount)]
}

// Légende d'une page à plusieurs groupes : toutes les zones différentes, sans doublon.
export function mergeRulesForLegend(ruleLists) {
  const seen = new Set(), out = []
  for (const list of ruleLists) for (const r of list) if (!seen.has(r.label)) { seen.add(r.label); out.push(r) }
  return out
}
