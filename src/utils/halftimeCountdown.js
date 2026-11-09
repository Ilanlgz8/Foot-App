// Libellé de mi-temps partagé par les cards (MatchCard, MatchPoster, MatchDuJourCard) :
// "Reprise dans X min" → "Reprise imminente", ou null s'il n'y a rien de fiable à afficher.
// À appeler seulement quand la minute affichée vaut 'MT'.
//
// ⚠️ (09/11, constat utilisateur : plusieurs cards en mi-temps affichaient juste « Mi-temps »
// au lieu du compte à rebours) : le libellé disparaissait dès qu'un `half2Start` existait.
// Or `calcMinute` renvoie 'MT' dès qu'ESPN annonce STATUS_HALFTIME, MÊME si un `half2Start`
// a été posé à tort (ancrage trop précoce, voir canAnchorHalf2) : la card disait donc « MT »
// et cachait le compte à rebours. Un `half2Start` récent alors qu'on affiche 'MT' est
// forcément faux → effacé (sinon, à la vraie reprise, la minute serait aussi décalée).
// Un `half2Start` ancien (> 20 min) peut correspondre à la pause avant prolongation : on
// le garde et on n'affiche pas de compte à rebours, comme avant.
import { getMatchState, trackMatchState, setHalf2Start } from './matchStateTracker'
import { parseEspnClock } from './matchUtils'

const WRONG_ANCHOR_MS = 20 * 60_000
const HT_MS = 15 * 60_000

export function halftimeLabel(match, now = Date.now()) {
  if (!match?.id) return null
  let state = getMatchState(match.id)
  if (state.half2Start) {
    if (now - state.half2Start >= WRONG_ANCHOR_MS) return null
    setHalf2Start(match.id, null)
    state = getMatchState(match.id)
  }
  if (!state.pausedAt) {
    // Mi-temps pas vue en direct (app ouverte pendant la pause) : ESPN gèle son horloge
    // sur la minute réellement jouée → pause ≈ coup d'envoi + cette durée.
    const koReference  = state.kickoffAt ?? new Date(match.utcDate).getTime()
    const parsedClock  = parseEspnClock(state.espnClock)
    const realHalfMins = parsedClock ? parsedClock.base + (parsedClock.extra ?? 0) : null
    const halfMins     = (realHalfMins != null && realHalfMins > 0) ? realHalfMins : 47
    const estimatedPausedAt = Math.min(now, koReference + halfMins * 60_000)
    trackMatchState({ ...match, status: 'PAUSED' }, estimatedPausedAt)
    state = getMatchState(match.id)
  }
  if (!state.pausedAt) return null
  const remMin = Math.max(0, Math.ceil((HT_MS - (now - state.pausedAt)) / 60_000))
  return remMin > 0 ? `Reprise dans ${remMin} min` : 'Reprise imminente'
}
