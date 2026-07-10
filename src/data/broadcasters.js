// src/data/broadcasters.js
// Diffuseur GRATUIT connu pour un match — UNIQUEMENT des infos vérifiées
// publiquement, jamais devinées.
//
// Coupe du Monde 2026 (France) : droits TV partagés entre M6 (gratuit, TNT +
// application M6+) et beIN Sports (payant, ~15€/mois, les 104 matchs). M6
// diffuse gratuitement les matchs de l'équipe de France, une sélection
// d'affiches de poule/élimination directe (curation éditoriale M6 — PAS une
// règle fixe qu'on peut coder sans deviner LAQUELLE des affiches est choisie),
// et SYSTÉMATIQUEMENT les demi-finales, la petite finale et la finale.
//
// On n'affiche donc l'info "gratuit" QUE pour ces 3 tours, où la règle est
// certaine à 100%. Pour tout le reste — poules/16es/8es/quarts (déjà joués à
// la date d'ajout de ce fichier, donc plus pertinent pour "matchs à venir" de
// toute façon), et les championnats de clubs (droits qui changent chaque
// saison, aucune source gratuite fiable identifiée) — on ne rend rien plutôt
// que de deviner.
const FREE_M6_STAGES = new Set(['SEMI_FINALS', 'THIRD_PLACE', 'FINAL'])

/**
 * Retourne { name, url } si on a une info FIABLE de diffusion gratuite pour ce
 * match, sinon null (jamais d'invention).
 */
export function getFreeBroadcaster(match) {
  const isWC = match?.competition?.id === 2000 || match?.competition?.code === 'WC'
  if (!isWC) return null
  if (!FREE_M6_STAGES.has(match?.stage)) return null
  return { name: 'M6', url: 'https://www.6play.fr/m6' }
}
