// Calcule la minute affichée côté client.
// Priorité :
//   1. kickoffAt  → timestamp exact du vrai KO (détecté par API-Football)
//                   Précis toute la 1ère MT, même si le match commence en retard
//   2. half2Start → timestamp exact de la reprise 2ème MT (détecté par API-Football)
//                   Précis toute la 2ème MT
//   3. Heuristique → calcul depuis utcDate si API-Football n'a pas encore pollé
// Utilisé dans Accueil.jsx (MatchCard, LiveWidget) et Match.jsx (BkCard).
import { getMatchState } from './matchStateTracker'

export function calcMinute(match) {
  if (match.status === 'PAUSED') return 'MT'
  if (match.status !== 'IN_PLAY') return null

  const state = getMatchState(match.id)

  // ── CAS PRÉCIS 2ème MT : on sait exactement quand la 2ème MT a repris ──
  if (state.half2Start) {
    const min2 = Math.floor((Date.now() - state.half2Start) / 60_000) + 1
    if (min2 <= 45) return `${45 + min2}'`
    return `90+${min2 - 45}'`
  }

  // MT confirmée par football-data.org, reprise pas encore détectée
  if (state.pausedAt && !state.half2Start) return 'MT'

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
