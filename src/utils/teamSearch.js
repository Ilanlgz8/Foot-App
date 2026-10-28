/**
 * teamSearch.js — recherche d'équipe multi-compétitions (fiche équipe,
 * demande utilisateur 28/10 : "on cherche une équipe [...] on a tout le
 * récap des matchs depuis le début de la saison [...] en Ligue 1, en Ligue
 * des Champions").
 *
 * Problème de fond : les différentes sources de données de l'app (FD.org
 * pour les 5 grands championnats + C1, ESPN pour UEL/UECL) n'ont AUCUN id
 * commun pour une même équipe — PSG a un id FD.org numérique côté Ligue 1 et
 * un id ESPN (string) totalement différent côté Ligue des Champions. Il n'y
 * a donc aucun moyen fiable de "fusionner" les matchs d'une équipe entre
 * compétitions par id — même limite déjà documentée et acceptée ailleurs
 * dans ce projet (resolveFdTeamId/clubNameMatch, matchUtils.js). La seule
 * clé stable disponible entre toutes les sources est le NOM — ce fichier
 * compare donc toujours par nom normalisé (accents/casse/ponctuation
 * retirés), jamais par id.
 */
import { translateTeam } from '../data/teamNames'

// Retire les accents/diacritiques (ex. "Málaga" → "Malaga", "Séville" → "Seville")
// pour que la recherche ne dépende pas de la frappe exacte de l'utilisateur.
function stripAccents(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Normalisation commune à la requête tapée ET à chaque variante de nom
// comparée — minuscules, sans accents, ponctuation réduite à des espaces
// (gère "Saint-Germain"/"Saint Germain", "R. Madrid"/"R Madrid"...).
export function normalizeTeamQuery(s = '') {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Toutes les variantes de nom raisonnables pour une équipe telle qu'elle
// apparaît dans un match (voir homeTeam/awayTeam, fetchClubMatchesRaw/
// espnAdapter.js) : nom brut FD.org/ESPN, shortName, tla (FD.org — ex. "PSG",
// absent côté ESPN), et leur traduction française (teamNames.js, qui couvre
// surtout les clés au format ESPN shortDisplayName — ex. "PSG" → "Paris SG").
function teamNameVariants(team) {
  if (!team) return []
  const raw = [team.name, team.shortName, team.tla].filter(Boolean)
  const translated = raw.map(n => translateTeam(n)).filter(Boolean)
  return [...new Set([...raw, ...translated])]
}

// Une équipe "matche" une requête si une de ses variantes de nom contient la
// requête (ex. "madrid" → "Real Madrid"), si la requête contient une variante
// courte au mot près (ex. "psg" tapé seul matche le tla "PSG"), ou si un MOT
// de la variante commence par la requête (ex. "barc" → "Barcelone", "madrid"
// → "Real Madrid" ET "Atlético Madrid", les deux homonymes légitimes).
// Longueur minimale de 2 pour éviter qu'une seule lettre ne matche tout.
export function teamMatchesQuery(team, normalizedQuery) {
  if (!normalizedQuery || normalizedQuery.length < 2) return false
  return teamNameVariants(team).some(variant => {
    const nv = normalizeTeamQuery(variant)
    if (!nv) return false
    if (nv === normalizedQuery) return true
    if (nv.includes(normalizedQuery)) return true
    return nv.split(' ').some(word => word.length >= 2 && word.startsWith(normalizedQuery))
  })
}

// Nom d'affichage canonique — toujours la version française quand elle
// existe (même logique que le reste de l'app), sinon le nom brut le plus
// court disponible (shortName avant le nom complet officiel).
export function teamDisplayName(team) {
  if (!team) return ''
  return translateTeam(team.shortName || team.name || '') || team.name || ''
}

// Clé d'identité d'une équipe à travers les différentes sources — le nom
// affiché, normalisé. C'est volontairement la MÊME fonction de normalisation
// que la recherche elle-même : si deux variantes de nom donnent le même nom
// affiché une fois traduites, elles sont considérées comme la même équipe,
// peu importe la compétition/source d'où elles viennent.
export function teamIdentityKey(team) {
  return normalizeTeamQuery(teamDisplayName(team))
}
