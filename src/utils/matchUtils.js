// Calcule la minute affichée côté client.
// Priorité :
//   1. pausedAt   → dès qu'on a vu PAUSED, on gère MT + 2ème MT en local
//                   sans dépendre du statut football-data.org (imprévisible)
//      a. half2Start (api-football.com) → minute précise 2ème MT
//      b. pausedAt + 15min              → estimation si api-football non dispo
//   2. kickoffAt  → timestamp KO précis (1ère MT)
//   3. Heuristique → calcul depuis utcDate
// Utilisé dans Accueil.jsx (MatchCard, LiveWidget) et Match.jsx (BkCard).
import { getMatchState } from './matchStateTracker'

const HT_DURATION = 15 * 60_000  // durée estimée de la mi-temps

export function calcMinute(match) {
  const state = getMatchState(match.id)

  // Si l'API renvoie brièvement SCHEDULED alors que le match était déjà live
  // (faux retour arrière football-data.org), on continue à calculer
  // tant qu'on a des timestamps locaux — évite d'afficher l'heure prévue à la place de la minute
  const wasLive = state.kickoffAt || state.pausedAt
  if (match.status !== 'IN_PLAY' && match.status !== 'PAUSED' && !wasLive) return null
  if (match.status === 'FINISHED') return null
  const now    = Date.now()

  // ── MI-TEMPS & 2ème MT ──
  // Dès que pausedAt est connu, on pilote en local — indépendant du statut API.
  if (state.pausedAt) {
    // Source précise via api-football.com → prioritaire
    if (state.half2Start) {
      const min2 = Math.floor((now - state.half2Start) / 60_000) + 1
      if (min2 <= 45) return `${45 + min2}'`
      return `90+${min2 - 45}'`
    }
    // Estimation : MT dure 15min, puis on avance la minute côté client
    const sinceP = now - state.pausedAt
    if (sinceP < HT_DURATION) return 'MT'
    const min2 = Math.floor((sinceP - HT_DURATION) / 60_000) + 1
    if (min2 <= 45) return `${45 + min2}'`
    return `90+${min2 - 45}'`
  }

  if (match.status === 'PAUSED') return 'MT'  // pausedAt pas encore écrit (lag localStorage)

  // ── CAS PRÉCIS 1ère MT : timestamp du vrai KO connu via API-Football ──
  // Évite tout décalage si le match commence en retard
  if (state.kickoffAt) {
    const min1 = Math.floor((Date.now() - state.kickoffAt) / 60_000)
    if (min1 <= 45) return `${Math.max(1, min1)}'`
    const stoppage = min1 - 45
    if (stoppage <= 8) return `45+${stoppage}'`
    // Au-delà → HT pas encore détecté, fallback heuristique
  }

  // ── CAS APPROXIMATIF : heuristique depuis l'heure prévue (utcDate) ──
  const elapsed = Math.floor((Date.now() - new Date(match.utcDate)) / 60_000)

  if (elapsed <= 45) return `${Math.max(1, elapsed)}'`

  const stoppage1 = elapsed - 45
  if (stoppage1 <= 4) return `45+${stoppage1}'`

  if (elapsed <= 64) return 'MT'

  const half2 = elapsed - 64
  if (half2 <= 45) return `${45 + half2}'`
  return `90+${half2 - 45}'`
}
