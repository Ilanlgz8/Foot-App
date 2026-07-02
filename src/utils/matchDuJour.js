// Sélection du "match du jour" — la carte mise en avant en haut de l'Accueil.
//
// Heuristique volontairement simple (pas de score "hype" inventé, pas d'appel
// API supplémentaire) : priorité à la compétition la plus prestigieuse, puis —
// à égalité — au coup d'envoi le plus tardif de la journée (créneau prime-time,
// généralement réservé à l'affiche la plus attendue par les diffuseurs).
//
// Les 5 grands championnats domestiques sont volontairement à égalité entre eux
// (aucun favoritisme, ex. Ligue 1 vs Premier League) — seule la Coupe du Monde
// et la Ligue des Champions priment.
const COMP_PRIORITY = { WC: 0, CL: 1, PL: 2, PD: 2, BL1: 2, SA: 2, FL1: 2 }

/**
 * Retourne le match à mettre en avant parmi les matchs pas encore commencés
 * aujourd'hui, ou null s'il n'y en a aucun dans une compétition couverte.
 */
export function pickMatchDuJour(matches) {
  const upcoming = (matches ?? []).filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED')
  if (!upcoming.length) return null

  let best = null
  let bestPriority = Infinity
  for (const m of upcoming) {
    const priority = COMP_PRIORITY[m.competition?.code]
    if (priority == null) continue
    if (priority < bestPriority) {
      bestPriority = priority
      best = m
    } else if (priority === bestPriority && best && new Date(m.utcDate) > new Date(best.utcDate)) {
      best = m
    }
  }
  return best
}
