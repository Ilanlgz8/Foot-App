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
// Pas de cap sur l'interpolation : STATUS_HALFTIME/FINAL sont gérés avant cet appel,
// donc interpoler sans limite évite les minutes gelées après un long arrière-plan iOS.

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

// ── Cap sur le temps additionnel en fin de période (90/105/120') ──────────
// Entre le coup de sifflet de fin de période et le vrai début de la période
// suivante (prolongations, 2e MT de prolongation, tirs au but), ESPN ne
// renvoie pas toujours un statut dédié pour cette pause (contrairement à
// STATUS_END_PERIOD, géré séparément dans calcMinute quand il est présent) —
// le statut reste STATUS_IN_PROGRESS avec une horloge figée sur le dernier
// arrêt de jeu connu, et l'interpolation (qui avance sans limite pour éviter
// les minutes gelées après un retour d'arrière-plan) faisait grimper le
// temps additionnel indéfiniment (91', 92', 93'... du "90+X") au lieu
// d'afficher "Prolongation" (bug signalé). Aucun arrêt de jeu réel ne dépasse
// ~15min → au-delà, on considère la pause déjà entamée.
const STOPPAGE_CAP = 15
function isEndOfPeriodBase(base) {
  return base === 90 || base === 105 || base === 120
}

/**
 * Interpole la minute ESPN en temps réel depuis le dernier poll.
 * Évite le lag de ~30-50s entre deux polls ESPN + ticker Accueil.
 * Résultat : retard résiduel ~2-3s (délai intrinsèque d'ESPN).
 * Retourne 'OVERRUN' (signal spécial, voir STOPPAGE_CAP) si le temps
 * additionnel extrapolé dépasse le plafond en fin de période.
 */
function interpolateEspnMinute(state) {
  const parsed = parseEspnClock(state.espnClock)
  if (!parsed || !state.espnCapturedAt) return null

  // Si l'app vient de revenir en foreground (visibilitychange), refuser d'interpoler
  // des données capturées AVANT le retour : évite le saut "49'+Δ = 55'" dû aux données stales.
  // window.__espnNeedsRefresh est posé par useLiveMinute au retour visible,
  // et devient obsolète dès que setEspnData repose espnCapturedAt = Date.now() (poll frais).
  if (
    typeof window.__espnNeedsRefresh === 'number' &&
    state.espnCapturedAt < window.__espnNeedsRefresh
  ) return null

  const elapsedMs = Date.now() - state.espnCapturedAt
  const elapsedMins = elapsedMs / 60_000

  if (parsed.extra > 0) {
    // Temps additionnel : la base (45 ou 90) est fixe, on avance l'extra
    const currentExtra = Math.floor(parsed.extra + elapsedMins)
    if (isEndOfPeriodBase(parsed.base) && currentExtra > STOPPAGE_CAP) return 'OVERRUN'
    return `${parsed.base}+${currentExtra}'`
  }

  // Temps réglementaire : on avance la minute normalement
  const currentMins = Math.floor(parsed.base + elapsedMins)
  return `${Math.max(1, currentMins)}'`
}

/**
 * Fusionne deux valeurs de score (ESPN/FIFA vs football-data.org) : garde toujours
 * la plus élevée des deux sources non-nulles.
 * Fix score périmé : chaque source (ESPN, FIFA, FD.org) peut avoir du retard
 * indépendamment (fuzzy-match raté, cache Redis, lag API). Sans fusion, l'UI
 * privilégiait toujours ESPN même quand il était en retard sur FD.org (ou l'inverse)
 * → score affiché figé (ex: 1-0 affiché alors que FD.org ou ESPN sait déjà 3-0).
 */
export function mergeScore(a, b) {
  if (a == null) return b ?? null
  if (b == null) return a
  return Math.max(a, b)
}

/**
 * Score "vrai" du match (120 minutes, tirs au but EXCLUS) — à utiliser à la
 * place de match.score.fullTime dès qu'on affiche/agrège le score final d'un
 * match.
 *
 * ⚠️ Bug FD.org découvert en production (constat utilisateur, confirmé sur
 * de vrais matchs de la CM 2026) : pour un match décidé aux tirs au but,
 * score.fullTime n'est PAS le score après prolongations comme supposé partout
 * dans le code — c'est en réalité regularTime + extraTime + penalties,
 * CUMULÉS. Exemple réel vérifié (8e de finale) :
 *   fullTime: {home:4, away:5}, regularTime: {home:1, away:1},
 *   extraTime: {home:0, away:0}, penalties: {home:3, away:4}
 *   → 1+0+3=4, 1+0+4=5 : fullTime inclut bien les tab, le vrai score 120min
 *   est 1-1 (regularTime + extraTime), pas 4-5.
 * FD.org ne fournit regularTime/extraTime QUE quand le match est allé
 * au-delà du temps réglementaire (duration !== 'REGULAR') — sinon on retombe
 * sur fullTime, qui est déjà correct dans ce cas (aucun changement de
 * comportement pour l'immense majorité des matchs, y compris ceux décidés en
 * prolongations SANS tirs au but : fullTime y est déjà correctement égal à
 * regularTime + extraTime).
 */
export function finalScore(score) {
  if (!score) return { home: null, away: null }
  if (score.regularTime?.home != null && score.regularTime?.away != null) {
    return {
      home: score.regularTime.home + (score.extraTime?.home ?? 0),
      away: score.regularTime.away + (score.extraTime?.away ?? 0),
    }
  }
  return { home: score.fullTime?.home ?? null, away: score.fullTime?.away ?? null }
}

/**
 * Résultat 1/N/2 d'un match terminé, à partir de finalScore() (donc du score
 * 120min, tirs au but exclus) + la même règle de départage aux tab que le
 * reste du projet (H2HSection, useTeamForm.js) : le score 120min est par
 * définition à égalité si le match est allé aux tirs au but, donc c'est
 * score.penalties qui décide, jamais un match nul dans ce cas.
 * Retourne null si le score n'est pas encore connu (match pas terminé).
 */
export function matchOutcome(match) {
  if (!match) return null
  const fs = finalScore(match.score)
  if (fs.home == null || fs.away == null) return null

  if (
    match.score?.duration === 'PENALTY_SHOOTOUT' &&
    match.score?.penalties?.home != null &&
    match.score?.penalties?.away != null
  ) {
    const { home: hp, away: ap } = match.score.penalties
    return hp > ap ? 'home' : 'away'
  }

  if (fs.home > fs.away) return 'home'
  if (fs.away > fs.home) return 'away'
  return 'draw'
}

export function calcMinute(match) {
  const state = getMatchState(match.id)
  const now   = Date.now()

  // ── FT détecté localement ──
  // Quand ESPN/api-football détecte la fin du match, il écrit { ft: true } dans
  // localStorage et reporte le clearMatchState de 5min (le temps que FD.org confirme
  // FINISHED). Sans ce guard, clearMatchState efface espnStatus + kickoffAt et
  // calcMinute retombe sur l'heuristique utcDate → 90+X' continue de tourner.
  if (state.ft) return null

  // ── Pending kickoff : heure atteinte, ESPN pas encore confirmé ──
  // Afficher "Débute" pendant les ~30-60s entre l'heure prévue et la confirmation ESPN.
  // ⚠️ 'STATUS_SCHEDULED' (string truthy) = FIFA/ESPN n'a pas encore confirmé le KO.
  // Sans le test sur STATUS_SCHEDULED, la condition !state.espnStatus serait fausse
  // même si le match n'est pas encore officiellement en cours → '–' affiché au lieu de 'Débute'.
  //
  // ⚠️ BUG CORRIGÉ (régression signalée : "Débute" a disparu, "1'" s'affiche dès
  // l'heure prévue) : ce garde-fou ne testait QUE match.status === 'SCHEDULED'.
  // Or football-data.org rapporte 'TIMED' pour les matchs à venir de la Coupe
  // du monde (voir _checkPendingKickoffs dans useLiveMinute.js, qui teste bien
  // les deux statuts, lui) — pour un match WC, ce bloc n'était donc JAMAIS
  // atteint, et l'heuristique utcDate plus bas ("Math.max(1, elapsed)") prenait
  // le relais dès l'heure de coup d'envoi prévue, sans attendre la confirmation
  // ESPN. Idem si FD.org bascule sur 'IN_PLAY' de son côté avant qu'ESPN
  // confirme réellement le KO (détections pas forcément synchrones) : on veut
  // "Débute" tant qu'ESPN n'a rien confirmé, quel que soit le statut FD.org,
  // sauf s'il indique déjà PAUSED/FINISHED (signe qu'on est allé plus loin).
  if (
    match.status !== 'FINISHED' && match.status !== 'PAUSED' &&
    (!state.espnStatus || state.espnStatus === 'STATUS_SCHEDULED') &&
    !state.kickoffAt && !state.pausedAt
  ) {
    const utcMs = new Date(match.utcDate).getTime()
    if (now < utcMs) return null
    if (now - utcMs < 30 * 60_000) return 'Débute'
    // Au-delà de 30min sans confirmation ESPN : on laisse tomber vers les
    // heuristiques utcDate plus bas plutôt que de rester bloqué sans rien
    // afficher (cas rare : ESPN indisponible ou très en retard).
  }

  // ── Tirs au but (period 5 / STATUS_SHOOTOUT) ──
  if (state.espnPeriod === 5 || state.espnStatus === 'STATUS_SHOOTOUT') return 'TAB'

  // ── ESPN (primaire) ──
  // Poll toutes les 20s + interpolation temps réel → retard résiduel ~2-3s.
  if (state.espnStatus) {
    if (state.espnStatus === 'STATUS_HALFTIME') {
      // Deux pauses distinctes partagent ce statut : la vraie mi-temps (45') ET la
      // pause avant/pendant les prolongations (juste après 90+arrêts, et entre les
      // 2 mi-temps de prolongation à 105'). On les distingue via la période déjà
      // connue (3/4 = prolongations) ou, à défaut, le dernier clock connu (≥ 90min
      // = on a dépassé le temps réglementaire, donc forcément une pause de prolong).
      const pastRegulation =
        state.espnPeriod === 3 || state.espnPeriod === 4 ||
        (() => { const p = parseEspnClock(state.espnClock); return p ? p.base >= 90 : false })()
      return pastRegulation ? 'Pause' : 'MT'
    }
    if (
      state.espnStatus === 'STATUS_FINAL'     ||
      state.espnStatus === 'STATUS_FULL_TIME' ||
      state.espnStatus === 'STATUS_FINAL_AET' ||
      state.espnStatus === 'STATUS_FINAL_PEN'
    ) return null
    if (state.espnStatus === 'STATUS_END_PERIOD') {
      // STATUS_END_PERIOD = coup de sifflet de fin des 90min+arrêts, AVANT que
      // la 1ère période de prolongation ne démarre vraiment (period passe à 3).
      // BUG CONSTATÉ : ce statut était regroupé avec STATUS_IN_PROGRESS
      // ci-dessous, donc l'horloge ESPN (encore sur "90:00+X:00" à ce moment)
      // continuait d'être interpolée → le temps additionnel de la 90e minute
      // continuait de tourner à l'écran pendant tout ce round de transition,
      // alors que le match n'est plus vraiment "en jeu" (ni terminé). On
      // affiche donc "Prolongation" ici, jusqu'à ce qu'ESPN confirme period=3
      // (→ repasse par STATUS_IN_PROGRESS/EXTRA_TIME/OVERTIME ci-dessous, qui
      // reprend alors normalement l'horloge ESPN à 91', 92'...).
      return 'Prolongation'
    }
    if (
      state.espnStatus === 'STATUS_IN_PROGRESS' ||
      state.espnStatus === 'STATUS_EXTRA_TIME'  ||
      state.espnStatus === 'STATUS_OVERTIME'
    ) {
      // Le clock ESPN continue naturellement de compter en prolongations
      // (91'…105', pause, 106'…120', +arrêts éventuels) : même logique
      // d'interpolation que le temps réglementaire, pas de calcul spécial requis.
      const interpolated = interpolateEspnMinute(state)
      if (interpolated === 'OVERRUN') return 'Prolongation'
      if (interpolated) return interpolated
      // Fallback si interpolation non disponible (capturedAt absent ou trop vieux)
      const parsed = parseEspnClock(state.espnClock)
      if (parsed) {
        // Même plafond que l'interpolation (voir STOPPAGE_CAP) : le clock
        // brut peut lui aussi être resté figé au-delà du raisonnable si le
        // dernier poll remonte à un moment déjà tardif de la pause.
        if (isEndOfPeriodBase(parsed.base) && parsed.extra > STOPPAGE_CAP) return 'Prolongation'
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

  // ── Déjà connu en prolongations mais espnStatus indisponible sur ce poll ──
  // Les heuristiques ci-dessous (pausedAt/half2Start/kickoffAt/utcDate) ne
  // modélisent QUE les 2 mi-temps réglementaires (45'/90') — elles n'ont
  // aucune notion des prolongations. Si un poll ESPN précédent a déjà établi
  // qu'on est en prolongations (espnPeriod 3 ou 4, mémorisé par setEspnData)
  // mais qu'espnStatus n'est pas exploitable sur CE poll (ex: transition
  // entre la fin de la 1ère période de prolongation et sa mi-temps), ces
  // heuristiques calculaient depuis half2Start/kickoffAt d'il y a bien plus
  // d'1h30 de temps réel écoulé → un résultat absurde du style "90+27'" au
  // lieu de "Pause"/"105'" (bug signalé). "Prolongation" reste l'affichage
  // le plus honnête ici : pas assez d'info pour une minute précise.
  if (state.espnPeriod === 3 || state.espnPeriod === 4) return 'Prolongation'

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
  // FD.org PAUSED override — prioritaire sur espnPeriod potentiellement stale.
  // Cas : FIFA laisse period=3 en localStorage pendant la transition mi-temps
  // alors que FD.org a déjà passé le match en PAUSED → évite badge 'Prolongations'.
  // ⚠ Ne pas appliquer si ESPN a déjà confirmé period=2 (2ème MT démarrée) :
  //   FD.org peut rester PAUSED une ~poll de retard après la reprise.
  if (match.status === 'PAUSED' && period !== 2) return 'Mi-temps'
  if (status === 'STATUS_SHOOTOUT' || period === 5) return 'T.A.B.'
  if (status === 'STATUS_EXTRA_TIME' || status === 'STATUS_OVERTIME' || status === 'STATUS_END_PERIOD' || period === 3 || period === 4) return 'Prolongations'
  if (period === 2) return '2ème MT'
  if (period === 1) return '1ère MT'

  // Fallback FD.org sans ESPN
  if (match.status === 'EXTRA_TIME')  return 'Prolongations'
  return null
}

// ── Compétitions "équipe nationale" (drapeau pays, PAS blason club) ──
// Détermine si un match doit afficher un drapeau (cercle, [data-crest=
// "country"]) plutôt qu'un blason club ([data-crest="club"]). AVANT :
// chaque composant (~20 fichiers — MatchCard, Live.jsx, MatchPage.jsx,
// Pronos.jsx, etc.) redéfinissait sa propre variable locale
// `match.competition?.id === 2000 || match.competition?.code === 'WC'` —
// un seul oubli lors de l'ajout d'une compétition nationale (Euro, Ligue des
// Nations, CAN, Copa America) = drapeau affiché en blason carré quelque part
// sans que ce soit repéré. Centralisé ici, un seul endroit à mettre à jour.
const NATIONAL_TEAM_COMP_IDS   = new Set([2000, 2018]) // WC, Euro (id numérique football-data.org)
const NATIONAL_TEAM_COMP_CODES = new Set(['WC', 'EC', 'NL', 'CAN', 'COPA'])
export function isNationalTeamComp(match) {
  const id   = match?.competition?.id
  const code = match?.competition?.code
  return NATIONAL_TEAM_COMP_IDS.has(id) || NATIONAL_TEAM_COMP_CODES.has(code)
}
