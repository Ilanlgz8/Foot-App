// Calcule la minute affichée côté client.
// Priorité :
//   1. ESPN (primary)  → espnStatus / espnClock + interpolation temps réel entre polls
//      • STATUS_HALFTIME            → 'MT'
//      • STATUS_IN_PROGRESS / clock → minute interpolée depuis espnCapturedAt (~2s de retard)
//      • STATUS_FINAL               → null
//   2. pausedAt   → dès qu'on a vu PAUSED, on gère MT + 2ème MT en local
//      a. half2Start (api-football.com ou ESPN) → minute précise 2ème MT
//      b. pausedAt + 15min              → estimation si sources non dispo
//   3. kickoffAt  → timestamp KO précis (1ère MT)
//   4. Heuristique → calcul depuis utcDate
// Utilisé dans Accueil.jsx (MatchCard, LiveWidget) et Match.jsx (BkCard).
import { getMatchState } from './matchStateTracker'

const HT_DURATION = 15 * 60_000  // durée estimée de la mi-temps
// Au-delà de 30s depuis le dernier poll ESPN, on ne tente plus d'interpoler
// (sécurité si l'onglet était en veille / intervals throttlés par le navigateur)
const ESPN_INTERP_CAP = 30_000

/**
 * Parse un displayClock ESPN en { base, extra }.
 * "42:00"       → { base: 42, extra: 0 }
 * "45:00+2:00"  → { base: 45, extra: 2 }
 * Retourne null si non parseable.
 */
function parseEspnClock(clock) {
  if (!clock) return null
  const plusIdx = clock.indexOf('+')
  if (plusIdx === -1) {
    const base = parseInt(clock.split(':')[0], 10)
    return isNaN(base) ? null : { base, extra: 0 }
  }
  const base  = parseInt(clock.slice(0, plusIdx).split(':')[0], 10)
  const extra = parseInt(clock.slice(plusIdx + 1).split(':')[0], 10)
  return (isNaN(base) || isNaN(extra)) ? null : { base, extra }
}

/**
 * Interpole la minute ESPN en temps réel depuis le dernier poll.
 * Évite le lag de ~30-50s entre deux polls ESPN + ticker Accueil.
 * Résultat : retard résiduel ~2-3s (délai intrinsèque d'ESPN).
 */
function interpolateEspnMinute(state) {
  const parsed = parseEspnClock(state.espnClock)
  if (!parsed || !state.espnCapturedAt) return null

  const elapsedMs = Date.now() - state.espnCapturedAt
  // Sécurité : si le poll est trop vieux (veille d'onglet, etc.), on ne tente pas
  if (elapsedMs > ESPN_INTERP_CAP) return null

  const elapsedMins = elapsedMs / 60_000

  if (parsed.extra > 0) {
    // Temps additionnel : la base (45 ou 90) est fixe, on avance l'extra
    const currentExtra = Math.floor(parsed.extra + elapsedMins)
    return `${parsed.base}+${currentExtra}'`
  }

  // Temps réglementaire : on avance la minute normalement
  const currentMins = Math.floor(parsed.base + elapsedMins)
  return `${Math.max(1, currentMins)}'`
}

export function calcMinute(match) {
  const state = getMatchState(match.id)

  // ── FT détecté localement ──
  // Quand ESPN/api-football détecte la fin du match, il écrit { ft: true } dans
  // localStorage et reporte le clearMatchState de 5min (le temps que FD.org confirme
  // FINISHED). Sans ce guard, clearMatchState efface espnStatus + kickoffAt et
  // calcMinute retombe sur l'heuristique utcDate → 90+X' continue de tourner.
  if (state.ft) return null

  // ── Tirs au but (period 5 / STATUS_SHOOTOUT) ──
  if (state.espnPeriod === 5 || state.espnStatus === 'STATUS_SHOOTOUT') return 'TAB'

  // ── ESPN (primaire) ──
  // Poll toutes les 20s + interpolation temps réel → retard résiduel ~2-3s.
  if (state.espnStatus) {
    if (state.espnStatus === 'STATUS_HALFTIME') return 'MT'
    if (state.espnStatus === 'STATUS_FINAL') return null
    if (
      state.espnStatus === 'STATUS_IN_PROGRESS' ||
      state.espnStatus === 'STATUS_END_PERIOD'
    ) {
      const interpolated = interpolateEspnMinute(state)
      if (interpolated) return interpolated
      // Fallback si interpolation non disponible (capturedAt absent ou trop vieux)
      const parsed = parseEspnClock(state.espnClock)
      if (parsed) {
        return parsed.extra > 0
          ? `${parsed.base}+${parsed.extra}'`
          : `${Math.max(1, parsed.base)}'`
      }
    }
  }

  // ── Fallback : calcul depuis timestamps locaux ──
  // Garde l'affichage live si football-data.org repasse brièvement en SCHEDULED
  // (faux retour arrière) mais qu'on a des timestamps locaux valides.
  const wasLive = state.kickoffAt || state.pausedAt
  if (match.status !== 'IN_PLAY' && match.status !== 'PAUSED' && !wasLive) return null
  if (match.status === 'FINISHED') return null

  const now = Date.now()

  // ── MI-TEMPS & 2ème MT ──
  if (state.pausedAt) {
    if (state.half2Start) {
      const min2 = Math.floor((now - state.half2Start) / 60_000) + 1
      if (min2 <= 45) return `${45 + min2}'`
      return `90+${min2 - 45}'`
    }
    // Match encore en PAUSED → ne jamais avancer au-delà de MT
    // (half2Start sera positionné dès que ESPN/api-football détecte la reprise)
    if (match.status === 'PAUSED') return 'MT'
    const sinceP = now - state.pausedAt
    if (sinceP < HT_DURATION) return 'MT'
    // half2Start absent et statut PAUSED déjà écarté → estimation
    const min2 = Math.floor((sinceP - HT_DURATION) / 60_000) + 1
    if (min2 <= 45) return `${45 + min2}'`
    return `90+${min2 - 45}'`
  }

  if (match.status === 'PAUSED') return 'MT'

  // ── 1ère MT via kickoffAt ──
  if (state.kickoffAt) {
    const min1 = Math.floor((now - state.kickoffAt) / 60_000)
    if (min1 <= 45) return `${Math.max(1, min1)}'`
    const stoppage = min1 - 45
    if (stoppage <= 8) return `45+${stoppage}'`
  }

  // ── Heuristique depuis utcDate ──
  const elapsed = Math.floor((now - new Date(match.utcDate)) / 60_000)

  if (elapsed <= 45) return `${Math.max(1, elapsed)}'`

  const stoppage1 = elapsed - 45
  if (stoppage1 <= 4) return `45+${stoppage1}'`

  if (elapsed <= 64) return 'MT'

  const half2 = elapsed - 64
  if (half2 <= 45) return `${45 + half2}'`
  return `90+${half2 - 45}'`
}

/**
 * Retourne l'indicateur de période affiché dans le LiveWidget.
 * null → pas de label (match à venir ou terminé).
 */
export function getMatchPeriod(match) {
  const state = getMatchState(match.id)
  if (state.ft) return null

  const status = state.espnStatus
  const period = state.espnPeriod

  if (status === 'STATUS_HALFTIME') return 'Mi-temps'
  if (status === 'STATUS_SHOOTOUT' || period === 5) return 'T.A.B.'
  if (status === 'STATUS_EXTRA_TIME' || status === 'STATUS_OVERTIME' || period === 3 || period === 4) return 'Prolongations'
  if (period === 2) return '2ème MT'
  if (period === 1) return '1ère MT'

  // Fallback FD.org sans ESPN
  if (match.status === 'PAUSED')      return 'Mi-temps'
  if (match.status === 'EXTRA_TIME')  return 'Prolongations'
  return null
}
