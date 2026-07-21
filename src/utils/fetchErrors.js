// Message affiché quand une requête est bloquée par NOS PROPRES protections
// anti-abus (429/403 renvoyés par api/football.js — budget/minute dépassé ou
// circuit breaker actif, voir CLAUDE.md) — pas une vraie absence de donnée,
// juste une pause de sécurité pour ne pas faire suspendre le compte
// football-data.org. Centralisé ici pour un message identique partout où ce
// cas peut survenir (classement, matchs, buteurs, bracket) plutôt que de
// laisser afficher "aucune donnée disponible"/le code HTTP brut, qui laisse
// penser à tort qu'il n'y a rien à trouver.
//
// ⚠️ AJOUT (demande utilisateur explicite : "au lieu d'afficher 'aucune
// compétition trouvée' on pourrait mettre 'réessayer plus tard' pour savoir
// que c'est pas qu'il y a pas de donnée mais qu'on a fait trop de
// requêtes") : avant, ces hooks (useStandings/useMatchs/useScorers/
// useWcKnockout) masquaient purement et simplement le 429/403 (`error: null`)
// — plus sûr pour l'utilisateur que d'afficher "429" en toutes lettres, mais
// ça laissait retomber sur le message générique vide, indiscernable d'une
// vraie absence de données.
export const RATE_LIMITED_MESSAGE = 'Trop de requêtes en peu de temps — réessaie dans quelques instants.'

// Transforme le message d'erreur brut (souvent juste le code HTTP, voir
// tryFetch() dans chaque hook) en texte affichable. Les 429/403 deviennent le
// message ci-dessus ; tout le reste passe tel quel (déjà le comportement
// existant pour les erreurs non-429/403 dans Match.jsx/Resultat.jsx, qui
// affichent error directement).
export function classifyFetchError(rawMessage) {
  if (rawMessage === '429' || rawMessage === '403') return RATE_LIMITED_MESSAGE
  return rawMessage ?? null
}
