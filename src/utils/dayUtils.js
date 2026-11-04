// Utilitaires de "jour" partagés par l'Accueil et la page Match (/live).
// Extraits d'Accueil.jsx (comportement strictement identique) pour que les
// deux pages ne puissent pas diverger sur les dates ni sur les doublons ESPN/FD.org.
import { fuzzyTeam } from './espnSummaryParse'

export function getTargetDate(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getDayLabel(offset) {
  if (offset === 0) return "Aujourd'hui"
  if (offset === 1) return 'Demain'
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

// Date locale "YYYY-MM-DD" d'un match (même découpage que le filtre par jour d'Accueil).
export function localDateStr(utcDate) {
  const d = new Date(utcDate)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Même rencontre réelle sous deux sources (ESPN `espn-FL1-123` / FD.org numérique) :
// les IDs ne sont pas comparables entre sources, on rapproche donc sur les noms
// d'équipe (voir le long historique dans Accueil.jsx, bug "j'ai que des doublons").
// --- Historique (déplacé d'Accueil.jsx) ---
// ⚠️ AJOUT (nécessaire suite au passage de FL1/PL/PD/BL1/SA/CL sur ESPN dans
// useTodayMatches.js, 23/07) : `rawMatches` (widget "jour", désormais ESPN
// pour ces 6 comps, id façon `espn-FL1-123`) et `upcomingAllComps` (reste
// FD.org pour elles, id numérique FD.org classique) peuvent désormais
// représenter le MÊME match réel avec des `id` de format complètement
// différent — un simple Set de `m.id` (utilisé dans les filets de sécurité
// `extra` ci-dessous) ne détecterait pas ce doublon et afficherait la même
// rencontre deux fois.
//
// ⚠️ BUG CORRIGÉ (constat utilisateur, 24/07 : "j'ai que des doublons") :
// la 1ère version de ce filet comparait `homeTeam.id`/`awayTeam.id` — mais
// `home.team?.id` côté ESPN (espnAdapter.js, normalizeEvent) est l'ID INTERNE
// D'ESPN, alors que le `id` côté FD.org est l'ID INTERNE DE FOOTBALL-DATA.ORG —
// deux systèmes d'ID totalement indépendants, qui ne se recoupent JAMAIS pour
// la même équipe réelle. Résultat : la comparaison échouait TOUJOURS pour
// exactement le cas qu'elle devait détecter (les 6 grands championnats,
// désormais sourcés ESPN dans rawMatches ET toujours FD.org dans
// upcomingAllComps) — le filet de sécurité n'a jamais réellement filtré quoi
// que ce soit depuis son ajout, chaque match de ces 6 comps s'affichait deux
// fois. Remplacé par une comparaison sur le NOM d'équipe (fuzzyTeam, déjà
// utilisée ailleurs dans l'app — api/fifa-live.js — pour ce même problème de
// rapprochement inter-sources, éprouvée toute la Coupe du Monde) : les noms
// d'équipe, contrairement aux ID, sont comparables entre sources.
export function isDuplicateMatch(m, existingMatches) {
  if (existingMatches.some(e => e.id === m.id)) return true
  const mDate = m.utcDate ? new Date(m.utcDate).getTime() : null
  const mHome = m.homeTeam?.name ?? m.homeTeam?.shortName ?? ''
  const mAway = m.awayTeam?.name ?? m.awayTeam?.shortName ?? ''
  if (!mDate || !mHome || !mAway) return false
  return existingMatches.some(e => {
    if (!e.utcDate) return false
    if (Math.abs(new Date(e.utcDate).getTime() - mDate) > 24 * 60 * 60 * 1000) return false
    const eHome = e.homeTeam?.name ?? e.homeTeam?.shortName ?? ''
    const eAway = e.awayTeam?.name ?? e.awayTeam?.shortName ?? ''
    return fuzzyTeam(mHome, eHome) && fuzzyTeam(mAway, eAway)
  })
}
