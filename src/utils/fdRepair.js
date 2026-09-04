/**
 * fdRepair — répare les statuts de match invalides renvoyés par
 * football-data.org.
 *
 * CONSTAT (04/09, signalé par l'utilisateur : "dans la forme récente des
 * équipes de Ligue 1 il n'y a qu'un match au lieu de deux, et dans Programme
 * et Résultats il y a un gros problème").
 *
 * Diagnostic, fait sur la réponse BRUTE de /api/football (donc avant que le
 * moindre code de l'app n'y touche) : football-data.org renvoyait, pour la
 * Ligue 1 uniquement, une DATE dans le champ `status` au lieu du statut —
 * par exemple `"status": "2026-08-28 17:45:00Z"` sur un match dont
 * `utcDate` valait "2026-08-28T18:45:00Z". 92 matchs sur 306 étaient touchés.
 * La Premier League, interrogée par exactement le même chemin de code au même
 * moment, était intacte (0 sur 380) — ce n'est donc ni le proxy
 * (api/football.js relaie le corps tel quel, sans réécrire aucun champ) ni le
 * cache Redis, mais bien la source.
 *
 * Conséquence dans l'app : `status` est comparé partout à des valeurs
 * précises ('FINISHED', 'TIMED', 'SCHEDULED'…). Un statut inconnu ne
 * correspond à AUCUN filtre, donc ces 92 matchs disparaissaient purement et
 * simplement — d'où une forme récente à un seul match au lieu de trois, et
 * des journées vides dans Programme et Résultats.
 *
 * On ne peut pas corriger football-data.org. Ce qu'on peut faire, et qui
 * manquait, c'est ne plus faire une confiance aveugle à ce champ : un statut
 * inconnu est reconstruit à partir des données du match lui-même (heure de
 * coup d'envoi et score), qui, elles, étaient correctes.
 *
 * Le correctif est volontairement inerte quand la source va bien : la
 * détection est un simple test de texte (un statut valide ne commence jamais
 * par un chiffre), et rien n'est parsé ni recopié tant qu'aucun statut
 * suspect n'est présent. Quand football-data.org sera réparé, ce fichier ne
 * coûtera plus rien du tout.
 */

/** Tous les statuts publiés par football-data.org (documentation officielle). */
const KNOWN_STATUS = new Set([
  'SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED',
  'FINISHED', 'POSTPONED', 'SUSPENDED', 'CANCELLED', 'AWARDED',
])

/** Durée au-delà de laquelle un match commencé est forcément terminé
 *  (90 min + mi-temps + arrêts de jeu, large). */
const LIVE_WINDOW_MS = 150 * 60_000

/**
 * Reconstruit le statut d'UN match si le sien est invalide.
 * Renvoie le match inchangé (même référence) si son statut est déjà correct —
 * important : aucune copie inutile, et l'égalité référentielle est préservée
 * pour React/React Query.
 */
export function repairMatchStatus(match, now = Date.now()) {
  if (match == null || KNOWN_STATUS.has(match.status)) return match

  const kickoff  = Date.parse(match.utcDate)
  const started  = Number.isFinite(kickoff) && now >= kickoff
  const longOver = Number.isFinite(kickoff) && now >= kickoff + LIVE_WINDOW_MS
  const hasScore = match.score?.fullTime?.home != null && match.score?.fullTime?.away != null

  let status
  if (!started)      status = 'TIMED'      // pas encore commencé
  else if (!longOver) status = 'IN_PLAY'   // dans la fenêtre d'un match en cours
  // Commencé depuis longtemps : terminé si on a un score. Sans score, on
  // repasse en 'TIMED' plutôt que d'annoncer un résultat qu'on n'a pas — le
  // match reste visible dans Programme au lieu de disparaître, ce qui est le
  // comportement déjà appliqué à un match réellement reporté.
  else               status = hasScore ? 'FINISHED' : 'TIMED'

  return { ...match, status, _statusRepaired: true }
}

/**
 * Détection ultra-bon-marché : un statut valide est toujours alphabétique.
 * Sert à ne PAS parser/recopier la réponse quand tout va bien.
 */
export function bodyHasBrokenStatus(text) {
  return typeof text === 'string' && /"status"\s*:\s*"\d/.test(text)
}

/**
 * Répare le corps JSON brut d'une réponse football-data.org.
 * Gère les deux formes servies par l'API : une liste (`{ matches: [...] }`)
 * et un match seul (`/v4/matches/{id}`).
 *
 * @param {string} text  corps JSON brut
 * @returns {string}     le même texte si rien n'est à réparer, sinon réécrit
 */
export function repairFdBody(text, now = Date.now()) {
  if (!bodyHasBrokenStatus(text)) return text
  let json
  try { json = JSON.parse(text) } catch { return text }

  if (Array.isArray(json?.matches)) {
    json.matches = json.matches.map(m => repairMatchStatus(m, now))
  } else if (json != null && typeof json === 'object' && 'status' in json && 'utcDate' in json) {
    json = repairMatchStatus(json, now)
  } else {
    return text
  }
  return JSON.stringify(json)
}
