// Regroupement des matchs par compétition (cocons de la page Match et
// sélection "à ne pas manquer" de l'Accueil) — une seule source de vérité.
import { COMPETITIONS, DOMESTIC_CUPS } from '../data/competitions'
import { bigTeamScore } from './matchDuJour'

// Couleur d'accent de chaque compétition (liseré/halo du cocon). Reprise des
// teintes principales des thèmes poster (accueil.css, `.poster--theme-*`) pour
// que le cocon "parle" comme les cards de la même compétition.
export const COMP_ACCENT = {
  CL: '#2f55ff',   UEL: '#e0661f',  UECL: '#2f8a3e',
  FL1: '#2a7bff',  FL2: '#15ffcf', PL: '#a23ab0',   PD: '#d23b3b',  BL1: '#e30613',  SA: '#3bb3c7',
  WC: '#f2c232',   EC: '#2f6fd6',   NL: '#4f7cff',  CAN: '#1fb050',  CANQ: '#1fb050',  COPA: '#2a7bff',
}
const FALLBACK_ACCENT = '#6b7a99'
export const accentFor = code => COMP_ACCENT[code] ?? FALLBACK_ACCENT

// Ordre des sections : Coupe du Monde, Ligue 1 (app francophone — choix déjà
// fait dans l'ancienne page Live), puis coupes d'Europe, puis le reste par nom.
// Une coupe nationale passe juste après son championnat (même code).
// Ligue 2 juste après la Ligue 1 et la Coupe de France.
const SECTION_ORDER = { WC: 0, FL1: 1, FL2: 1.7, CL: 2, UEL: 3, UECL: 4 }
const sectionRank = g => (SECTION_ORDER[g.code] ?? 10) + (g.isCup ? 0.5 : 0)

export function groupMatchesByCompetition(matches) {
  const map = new Map()
  for (const m of matches) {
    const code   = m.competition?.code ?? 'AUTRE'
    const isCup  = !!m.isCup
    const key    = isCup ? `${code}:cup:${m.competition?.name ?? ''}` : code
    const comp   = COMPETITIONS.find(c => c.id === code)
    if (!map.has(key)) {
      map.set(key, {
        key, code, isCup,
        name:   isCup ? (m.competition?.name ?? comp?.name ?? 'Coupe') : (comp?.name ?? m.competition?.name ?? 'Autre compétition'),
        // Coupe : son propre logo (12/11, constat utilisateur : la Copa del Rey affichait celui de
        // LaLiga) — détouré, donc sans pastille blanche (emblemOpaque).
        emblem: isCup ? (DOMESTIC_CUPS[code]?.emblem ?? m.competition?.emblem ?? comp?.emblem ?? null) : (comp?.emblem ?? m.competition?.emblem ?? null),
        emblemOpaque: isCup ? !!DOMESTIC_CUPS[code]?.emblem : comp?.emblemOpaque === true,
        accent: accentFor(code),
        matches: [],
      })
    }
    map.get(key).matches.push(m)
  }
  const groups = [...map.values()]
  for (const g of groups) g.matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
  return groups.sort((a, b) => {
    const d = sectionRank(a) - sectionRank(b)
    return d !== 0 ? d : a.name.localeCompare(b.name, 'fr')
  })
}

// Le match le plus intéressant d'une liste : un match en direct d'abord, puis
// la plus grosse affiche (même barème que le "match du jour"), puis le premier
// coup d'envoi. `isLive` est injecté pour garder ce module pur/testable.
export function pickBestMatch(matches, isLive = () => false) {
  let best = null
  let bestScore = -1
  const sorted = [...matches].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
  for (const m of sorted) {
    const score = (isLive(m) ? 100 : 0) + bigTeamScore(m)
    if (score > bestScore) { best = m; bestScore = score }
  }
  return best
}
