/**
 * groupScorers.js — regroupe les buts d'un même buteur en une seule entrée
 * (demande utilisateur, 09/09) : au lieu d'afficher deux fois "K. Mbappé"
 * quand il marque un doublé, on affiche une seule fois son nom avec les
 * minutes de chaque but séparées par une virgule ("K. Mbappé 23', 34'").
 *
 * Utilisé par les 4 endroits qui affichent une liste de buteurs (aucun ne
 * partageait de logique commune avant ça, voir recherche du 09/09) :
 * - LiveCardWidget.jsx  (ScorerColumns, card live Accueil/Live)
 * - MatchModal.jsx      (ESPNScorers, onglet Stats)
 * - MatchModal.jsx      (buildMatchEvents, Fil du match + hero
 *   MatchPage.jsx/LiveMatchPage.jsx)
 * - MatchModal.jsx      (GoalTimeline, fallback FD.org)
 *
 * Ne regroupe QUE des buts entre eux (jamais avec des cartons/remplacements,
 * qui gardent leur propre entrée) — l'appelant doit filtrer par type/équipe
 * en amont, cette fonction se contente de regrouper par nom en préservant
 * l'ordre de première apparition.
 */
export function groupScorers(scorers) {
  const order = []
  const byName = new Map()
  for (const s of scorers) {
    if (!byName.has(s.name)) {
      byName.set(s.name, [])
      order.push(s.name)
    }
    byName.get(s.name).push(s)
  }
  return order.map(name => ({ name, entries: byName.get(name) }))
}
