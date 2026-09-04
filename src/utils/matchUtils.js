// Calcule la minute affichée côté client.
// Priorité :
//   1. ESPN (primary)  → espnStatus / espnClock + interpolation temps réel entre polls
//      • STATUS_HALFTIME            → 'MT'
//      • STATUS_IN_PROGRESS / clock → minute interpolée depuis espnCapturedAt (~2s de retard)
//      • STATUS_FINAL               → null, mais SEULEMENT une fois confirmé (state.ft ===
//        true, voir plus bas) — un STATUS_FINAL pas encore confirmé (1er poll, potentiel
//        faux FT ESPN pendant le temps additionnel — retour utilisateur) continue d'afficher
//        la minute normalement, comme si de rien n'était, en attendant la confirmation.
//   2. pausedAt   → dès qu'on a vu PAUSED, on gère MT + 2ème MT en local
//      a. half2Start (api-football.com ou ESPN) → minute précise 2ème MT
//      b. pausedAt + 15min              → estimation si sources non dispo
//   3. kickoffAt  → timestamp KO précis (1ère MT)
//   4. Heuristique → calcul depuis utcDate
// Utilisé dans Accueil.jsx (MatchCard, LiveWidget) et Match.jsx (BkCard).
import { getMatchState } from './matchStateTracker'
import { clubNameMatch, normalize } from './espnSummaryParse'
import { translateTeam } from '../data/teamNames'
import { readCacheStale, writeCache } from '../hooks/localCache'

const HT_DURATION = 15 * 60_000  // durée estimée de la mi-temps
// Pas de cap sur l'interpolation : STATUS_HALFTIME/FINAL sont gérés avant cet appel,
// donc interpoler sans limite évite les minutes gelées après un long arrière-plan iOS.

// ⚠️ AJOUT (constat utilisateur : "la minute ne se recalibre jamais par
// rapport à ESPN", ex. la reprise de la 2e MT ne repart pas à la 46e) : voir
// le commentaire détaillé au point d'usage (calcMinute, bloc `if
// (state.espnStatus)`). Volontairement basé sur un COMPTEUR d'échecs de
// matching consécutifs (espnMissStreak, incrémenté par useLiveMinute.js
// uniquement quand le poll global RÉUSSIT mais que CE match précis est
// absent de la réponse) plutôt que sur l'âge de espnCapturedAt — un simple
// seuil d'âge casserait le comportement DÉLIBÉRÉ de l'interpolation ci-
// dessus (STOPPAGE_CAP, voir test dédié) qui doit au contraire continuer à
// extrapoler sans limite après une longue mise en veille iOS (aucun poll
// tenté du tout dans ce cas, donc espnMissStreak n'augmente pas) — seul un
// vrai échec de matching répété, poll après poll, doit faire perdre
// confiance à ce statut. 5 échecs d'affilée ≈ 100-150s au cycle de poll
// normal (~20-30s) : assez pour ignorer un simple aléa isolé (ex. collision
// usedEspnIds ponctuelle, voir api/fifa-live.js), assez court pour ne pas
// laisser l'affichage dériver longtemps sur un vrai échec persistant.
const MAX_ESPN_MISS_STREAK = 5

/**
 * Parse un displayClock ESPN en { base, extra }.
 * "42:00"       → { base: 42, extra: 0 }
 * "45:00+2:00"  → { base: 45, extra: 2 }
 * Retourne null si non parseable.
 */
export function parseEspnClock(clock) {
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

/**
 * Résultat W/D/L pour UNE équipe donnée d'un match terminé.
 *
 * ⚠️ BUG CORRIGÉ (constat utilisateur : "Forme récente" de l'Angleterre
 * n'affichait pas son dernier match joué au Mondial 2026, disparu du
 * compteur "Matchs joués" aussi) : juste après le coup de sifflet final,
 * football-data.org marque parfois le match FINISHED avant d'avoir fini de
 * renseigner le score détaillé (regularTime/extraTime/penalties) —
 * finalScore() renvoie alors {home:null, away:null} et matchOutcome()/tout
 * calcul basé dessus renvoie null, faisant disparaître silencieusement ce
 * match des stats/formes tant que FD.org n'a pas fini de le compléter.
 * score.winner ('HOME_TEAM'/'AWAY_TEAM'/'DRAW', déjà documenté dans le
 * schéma football-data.org v4) est un champ catégorique plus simple,
 * disponible plus tôt dans la plupart des cas — utilisé ici en PREMIER,
 * avant de retomber sur la comparaison numérique si absent. Les matchs
 * sourcés ESPN (Ligue des Nations/CAN/Copa America/coupes nationales, voir
 * espnAdapter.js) exposent aussi ce champ (dérivé de winner/advance ESPN),
 * donc cette priorité s'applique uniformément à toutes les sources.
 */
export function outcomeForTeam(match, teamId) {
  if (!match || teamId == null) return null
  const isHome = match.homeTeam?.id === teamId
  const isAway = match.awayTeam?.id === teamId
  if (!isHome && !isAway) return null

  // ⚠️ 2e BUG CORRIGÉ (l'utilisateur a signalé que le problème persistait
  // pour l'Angleterre après le 1er correctif ci-dessus) : l'ordre de check
  // était faux pour un match à élimination directe décidé aux tirs au but.
  // score.winner === 'DRAW' peut ne refléter QUE le score 120min (à égalité
  // par définition en cas de tab) sans tenir compte des tirs au but — en le
  // vérifiant EN PREMIER (comme avant), un match comme Mexique-Angleterre
  // (1/8, Mondial 2026), s'il a été décidé aux tab, retombait sur 'D' au
  // lieu du vrai résultat W/L, AVANT même d'avoir regardé score.penalties.
  // matchOutcome() (au-dessus) avait le bon ordre depuis le début (tab
  // vérifiés avant toute comparaison de score) — outcomeForTeam() ne le
  // respectait pas. Les branches HOME_TEAM/AWAY_TEAM restent fiables en
  // premier (non ambiguës, jamais un score à égalité), seul le cas DRAW est
  // repoussé après le check tab.
  const winner = match.score?.winner
  if (winner === 'HOME_TEAM') return isHome ? 'W' : 'L'
  if (winner === 'AWAY_TEAM') return isAway ? 'W' : 'L'

  // Tirs au but : le score 120min (finalScore) est TOUJOURS à égalité par
  // définition — le vrai résultat vient de score.penalties.
  if (
    match.score?.duration === 'PENALTY_SHOOTOUT' &&
    match.score?.penalties?.home != null &&
    match.score?.penalties?.away != null
  ) {
    const { home: hp, away: ap } = match.score.penalties
    if (hp === ap) return null
    const homeWon = hp > ap
    return (isHome && homeWon) || (isAway && !homeWon) ? 'W' : 'L'
  }

  if (winner === 'DRAW') return 'D'

  const fs = finalScore(match.score)
  if (fs.home == null || fs.away == null) return null
  if (fs.home === fs.away) return 'D'
  const homeWon = fs.home > fs.away
  return (isHome && homeWon) || (isAway && !homeWon) ? 'W' : 'L'
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
  //
  // ⚠️ BUG CORRIGÉ (constat utilisateur : "la minute affichée ne se recalibre
  // jamais par rapport à ESPN", ex. la reprise de la 2e MT ne repart pas à la
  // 46e comme attendu) : state.espnStatus/espnClock restent "sticky" en
  // localStorage tant qu'un poll ne les réécrit pas (voir setEspnData,
  // useLiveMinute.js) — mais rien ici ne vérifiait qu'ils étaient toujours
  // fiables avant de leur faire confiance. Si le matching ESPN↔FD.org échoue
  // plusieurs polls d'affilée pour CE match précis (event déjà revendiqué par
  // une autre entrée, sorti temporairement du scoreboard... voir
  // api/fifa-live.js), setEspnData n'est plus jamais rappelé MAIS
  // state.espnStatus reste truthy indéfiniment avec l'ancien clock —
  // interpolateEspnMinute (pas de plafond par design, voir son commentaire,
  // pour éviter les minutes gelées après une mise en veille) continue alors
  // d'extrapoler EN AVANT depuis cette ancre figée, pour toujours, sans
  // jamais se recaler sur la vraie horloge ESPN tant que le matching ne
  // réussit pas de nouveau — exactement le symptôme décrit, et pas limité à
  // une page en particulier puisque calcMinute() est la seule et même
  // fonction utilisée par MatchCard/MatchPoster/LiveMatchPage.
  //
  // espnMissStreak (incrémenté par useLiveMinute.js, voir son commentaire)
  // compte les polls globaux RÉUSSIS où CE match était absent de la réponse —
  // délibérément PAS un simple âge de espnCapturedAt, qui casserait le
  // comportement voulu de l'interpolation ci-dessus après une longue mise en
  // veille (aucun poll tenté du tout dans ce cas, donc le compteur n'augmente
  // pas). Au-delà de MAX_ESPN_MISS_STREAK échecs consécutifs, on arrête de
  // faire confiance à ce statut et on retombe sur les heuristiques locales
  // ci-dessous (pausedAt/half2Start/kickoffAt), ancrées sur de VRAIS
  // timestamps observés qui avancent de façon autonome et fiable sans
  // dépendre d'un nouveau poll ESPN. Dès qu'un poll réussit à nouveau pour ce
  // match, setEspnData remet le compteur à 0 et ce bloc reprend la main
  // normalement (retour au calcul le plus précis).
  const espnTrusted = (state.espnMissStreak ?? 0) < MAX_ESPN_MISS_STREAK
  if (state.espnStatus && espnTrusted) {
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
    // ⚠️ SUPPRIMÉ (retour utilisateur : "j'ai eu comme quoi le match est fini
    // alors qu'il est pas fini, on est encore dans le temps additionnel, c'est
    // pas normal") : ce bloc renvoyait null dès qu'ESPN indiquait un statut
    // FINAL-ish, MÊME si ce n'était que le 1er poll à le voir (potentiel
    // glitch ESPN pendant le temps additionnel — voir le fix côté
    // useLiveMinute.js/pendingFt, qui retarde maintenant la confirmation
    // réelle du FT à un 2e poll). Résultat : la minute affichée disparaissait
    // (ou le match semblait "terminé") dès le 1er poll suspect, AVANT même
    // que la confirmation à 2 polls n'ait eu lieu. `state.ft` (tout en haut
    // de cette fonction) est désormais le SEUL signal qui fait vraiment
    // passer calcMinute() à null — il n'est écrit qu'une fois le FT
    // confirmé (voir confirmFt). Tant que non confirmé, on laisse tomber
    // vers les heuristiques normales plus bas (kickoffAt/half2Start), qui
    // continuent d'afficher une minute crédible (ex. "90+3'") pendant
    // l'attente de confirmation.
    if (state.espnStatus === 'STATUS_END_PERIOD') {
      // STATUS_END_PERIOD = coup de sifflet de fin de période, réutilisé par
      // ESPN à 2 moments différents : fin des 90min+arrêts AVANT que la 1ère
      // période de prolongation ne démarre vraiment (period pas encore à 3),
      // ET fin de la 2e période de prolongation (period déjà à 4) AVANT la
      // confirmation FT/tirs au but. BUG CONSTATÉ (retour utilisateur) : le
      // 2e cas affichait aussi le texte statique "Prolongation" à la place de
      // la minute (ex. "120+2'"), alors qu'on est déjà EN prolongation, pas
      // avant son début — seul le 1er cas (period pas encore 3/4) justifie ce
      // texte générique (aucune minute fiable avant period=3 confirmé).
      if (state.espnPeriod === 3 || state.espnPeriod === 4) {
        const interpolated = interpolateEspnMinute(state)
        if (interpolated && interpolated !== 'OVERRUN') return interpolated
        const parsed = parseEspnClock(state.espnClock)
        if (parsed) {
          return parsed.extra > 0
            ? `${parsed.base}+${parsed.extra}'`
            : `${Math.max(1, parsed.base)}'`
        }
      }
      // Avant period=3 confirmé (fin des 90min+arrêts) : pas de minute fiable
      // à afficher — voir commentaire ci-dessus. Repasse par
      // STATUS_IN_PROGRESS/EXTRA_TIME/OVERTIME ci-dessous une fois period=3
      // confirmé, qui reprend alors normalement l'horloge ESPN à 91', 92'...
      return 'Prolongation'
    }
    if (
      state.espnStatus === 'STATUS_IN_PROGRESS' ||
      state.espnStatus === 'STATUS_EXTRA_TIME'  ||
      state.espnStatus === 'STATUS_OVERTIME'
    ) {
      // ⚠️ REDESIGN (demande utilisateur, 15/08 : "pourquoi on redemande pas
      // à ESPN la minute en continu — au pire, dès qu'ESPN donne le go [KO,
      // reprise 2e MT], on chronomètre nous-même ensuite, minute par minute,
      // sans re-demander à ESPN entre-temps") : plus simple ET plus robuste
      // que suivre en continu l'horloge ESPN via interpolateEspnMinute plus
      // bas, qui a besoin d'un poll frais pour rester exacte (espnMissStreak
      // ci-dessus n'est qu'un filet de sécurité contre la dérive, pas la
      // vraie source de vérité). Pour le temps réglementaire (period 1/2),
      // kickoffAt/half2Start sont déjà des ancres réelles précises — calculées
      // depuis le clock ESPN AU MOMENT EXACT de la détection (voir "KO
      // détecté"/"2H détecté", useLiveMinute.js) — chronométrer nous-même
      // dessus ensuite (même formule que le repli plus bas, "1ère MT via
      // kickoffAt"/"MI-TEMPS & 2ème MT") ne dépend plus JAMAIS d'un nouveau
      // poll pour rester exact. ESPN garde son vrai rôle : confirmer les
      // TRANSITIONS d'état (KO/MT/reprise/fin), pas fournir la minute qui
      // défile seconde par seconde. Prolongations (period 3/4, sans ancre
      // dédiée) et bootstrap (anchor pas encore posé sur CE poll précis)
      // continuent de suivre l'horloge ESPN ci-dessous, seul cas où c'est
      // encore vraiment nécessaire.
      if ((state.espnPeriod ?? 1) === 1 && state.kickoffAt) {
        const min1 = Math.floor((now - state.kickoffAt) / 60_000)
        if (min1 <= 45) return `${Math.max(1, min1)}'`
        return `45+${min1 - 45}'`
      }
      if (state.espnPeriod === 2 && state.half2Start) {
        const min2 = Math.floor((now - state.half2Start) / 60_000) + 1
        if (min2 <= 45) return `${45 + min2}'`
        return `90+${min2 - 45}'`
      }

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

  // STATUS_HALFTIME est réutilisé par ESPN pour 2 pauses différentes : la
  // vraie mi-temps (45') ET la pause avant le début des prolongations (juste
  // après 90+arrêts, avant que period passe à 3) — voir le même constat déjà
  // fait dans calcMinute() ci-dessus (pastRegulation). getMatchPeriod() ne
  // faisait PAS cette distinction et affichait "MT" (badge en haut à droite
  // de la card Accueil) pendant cette pause de prolongation, jusqu'à ce
  // qu'ESPN confirme period=3 (~2min plus tard) — bug signalé. Même logique
  // de détection que calcMinute : period déjà connu (3/4) ou clock ≥ 90min.
  if (status === 'STATUS_HALFTIME') {
    const pastRegulation =
      period === 3 || period === 4 ||
      (() => { const p = parseEspnClock(state.espnClock); return p ? p.base >= 90 : false })()
    return pastRegulation ? 'Prolongations' : 'Mi-temps'
  }
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

// Un match est considéré "live" pour le routage du clic dès que sa card
// passe en mode live (même logique que isLive dans accueil/MatchCard.jsx/
// MatchPoster.jsx) : IN_PLAY/PAUSED confirmé, ou coup d'envoi imminent/en
// cours détecté par calcMinute() (ex: "Débute"), et pas encore terminé.
// Déplacée ici depuis accueil/MatchCard.jsx (demande utilisateur : sur
// l'Accueil desktop, quand des matchs sont en direct, ils sont affichés une
// seule fois — dans la grille de widgets live dédiée — donc exclus de la
// liste "à venir", voir Accueil.jsx/matchPanelMatches) : un export non-
// composant dans un fichier qui exporte par ailleurs des composants React
// casse le Fast Refresh (react-refresh/only-export-components) — ce fichier
// (matchUtils.js) est déjà le point de partage établi pour ce genre de
// helper (calcMinute, getMatchPeriod, mergeScore…), donc sa place naturelle.
export function isCardLive(match) {
  const ms = getMatchState(match.id)
  const isFinished = ms.ft === true || match.status === 'FINISHED'
  if (isFinished) return false
  return match.status === 'IN_PLAY' || match.status === 'PAUSED' || calcMinute(match) !== null
}

// ── Compétitions à hôte unique, terrain "neutre" pour les 2 équipes ──
// Sous-ensemble de isNationalTeamComp ci-dessus : Coupe du Monde, Euro, CAN
// et Copa America se jouent (quasi) intégralement dans un seul pays hôte —
// aucun avantage domicile réel entre les 2 équipes qui s'affrontent, sauf
// pour le·s pays hôte·s sur SES propres matchs (cas non détecté ici, faute
// de donnée fiable de lieu de match dans l'app). La Ligue des Nations (NL)
// est volontairement EXCLUE : sa phase de groupes se joue en vrai domicile/
// extérieur classique (chaque équipe reçoit chez elle), seule la finale à 4
// est à hôte neutre — traiter TOUTE la compétition comme neutre serait donc
// faux dans l'autre sens. Utilisé par calcProno.js (rawFormProno) pour ne
// pas appliquer le bonus avantage domicile sur ces 4 compétitions — constat
// utilisateur : le modèle traitait un quart de finale Argentine/France comme
// si l'une des deux jouait "chez elle".
const NEUTRAL_VENUE_COMP_CODES = new Set(['WC', 'EC', 'CAN', 'COPA'])
export function isNeutralVenueComp(match) {
  const id   = match?.competition?.id
  const code = match?.competition?.code
  return NATIONAL_TEAM_COMP_IDS.has(id) || NEUTRAL_VENUE_COMP_CODES.has(code)
}

// ── Résolution id équipe football-data.org (par nom, repli ESPN→FD.org) ────
// ⚠️ AJOUT (constat utilisateur, 26/07 : "quand je clique sur un match à
// venir dans Accueil y'a aucune donnée, mais le même match cliqué depuis
// Programme ça marche") : les 6 grands championnats sont sourcés ESPN dans
// Accueil (voir espnAdapter.js/normalizeEvent, useTodayMatches.js —
// ESPN_SOURCED_COMPS, choix délibéré pour réduire les appels FD.org) — ces
// matchs ont alors homeTeam.id/awayTeam.id dans le référentiel ESPN (l'id
// interne ESPN de l'équipe), PAS l'id numérique football-data.org.
// Programme, lui, reste 100% FD.org pour ces mêmes 6 comps (voir le
// commentaire dédié dans useTodayMatches.js) — ses matchs ont donc toujours
// le vrai id FD.org, d'où la différence de comportement constatée.
// Or Forme récente / Stats saison / Compos probables (PreMatchSection,
// MpSeasonStats, useProbableLineups) filtrent TOUS compMatches (liste de
// matchs FD.org de la compétition, via useTeamForm) par ÉGALITÉ STRICTE
// d'id — un id ESPN ne correspond jamais à rien dans cette liste : ces
// sections retombaient silencieusement sur "aucune donnée" pour CES matchs
// précis. ClassementTab avait déjà dû contourner exactement ce même problème
// en comparant par NOM (fuzzyTeam) plutôt que par id (voir MatchModal.jsx) —
// même technique ici, mais résolue UNE FOIS, en amont, pour que tout le reste
// de la page profite d'un id correct sans dupliquer la logique partout.
// Retombe sur l'id d'origine si aucune correspondance (compMatches pas
// encore chargé, ou vraiment aucune équipe correspondante) — comportement
// inchangé pour le cas normal (id déjà FD.org, la grande majorité des cas).
// ID de match football-data.org : purement numérique (voir normalizeEvent,
// espnAdapter.js — un match sourcé ESPN a un id du type "espn-PL-401584580").
export function isRealFdMatchId(id) {
  return /^\d+$/.test(String(id ?? ''))
}

// ── Résolution id MATCH football-data.org (repli ESPN→FD.org, pour le H2H) ─
// ⚠️ AJOUT (constat utilisateur, 26/07 : "dans Accueil t'as que 2 h2h, dans
// Programme t'as le vrai historique, pour le MÊME match, c'est pas normal")
// : suite directe de resolveFdTeamId ci-dessus. Un match sourcé ESPN (les 6
// grands championnats dans Accueil) a lui-même un id `espn-PL-...`, pas un
// vrai id numérique FD.org — l'historique complet des confrontations
// (endpoint FD.org /v4/matches/{id}/head2head, qui remonte plusieurs
// saisons) a justement besoin d'un vrai id FD.org pour fonctionner. Sans
// lui, useH2H se désactivait entièrement et retombait sur une approximation
// calculée depuis compMatches (matchs de la compétition déjà chargés) — mais
// cette liste ne couvre qu'UNE saison, donc au mieux 2 confrontations pour un
// championnat classique (aller-retour), beaucoup plus court que le vrai
// historique multi-saisons. FD.org couvre pourtant bien ce même match
// (Programme le lit directement depuis FD.org, sans passer par ESPN) — on le
// retrouve dans compMatches (même compétition, déjà chargé, aucun appel
// réseau en plus) en cherchant la même paire d'équipes (ids déjà résolus par
// resolveFdTeamId) à la date la plus proche, et on utilise SON id réel pour
// le head2head — l'historique complet redevient identique, peu importe la
// page de départ.
// ⚠️ `loose` (27/07, bug réel : H2H vide pour Toulouse-Lyon vu depuis
// Accueil, marche depuis Programme) : ESPN dit "Lyon" (nom court),
// football-data.org dit "Olympique Lyonnais" (name) / "Olympique Lyon"
// (shortName) — "Lyon" est un SUFFIXE de ces 2 variantes, jamais un
// préfixe, donc clubNameMatch (préfixe complet uniquement, voir
// espnSummaryParse.js) ne le détecte jamais. Un 1er essai avait élargi
// clubNameMatch lui-même (repli TEAM_NAMES_FR) mais a cassé l'affichage
// des cards dans l'Accueil à 2 reprises, MÊME protégé par un try/catch —
// cause exacte non confirmée avec certitude, faute d'accès navigateur en
// direct pour ce diagnostic précis. Plutôt que de continuer à deviner sur
// une fonction partagée par TOUTE l'app (clubNameMatch, utilisée aussi par
// MatchPoster.jsx/MatchDuJourCard.jsx pour CHAQUE card affichée sur
// l'Accueil), clubNameMatch reste ici totalement INTACTE (exactement comme
// avant tout ce fix, zéro changement) — le repli TEAM_NAMES_FR vit UNIQUEMENT
// ici, dans matchUtils.js, activé seulement via ce paramètre `loose`
// explicite. Passé à `true` UNIQUEMENT par MatchPage.jsx/LiveMatchPage.jsx
// (page dédiée du match, où le H2H manquant a été signalé) — jamais par
// défaut, donc jamais atteint par MatchPoster.jsx/MatchDuJourCard.jsx
// (cards Accueil), qui gardent un comportement strictement identique à
// avant, garanti par construction (pas juste "testé").
function looseTeamNameMatch(a, b) {
  try {
    const ta = normalize(translateTeam(a)), tb = normalize(translateTeam(b))
    return !!ta && !!tb && ta === tb
  } catch {
    return false
  }
}

// ── Garde-fou : mots génériques utilisés SEULS comme nom de club ───────────
// clubNameMatch (espnSummaryParse.js) accepte un préfixe complet — pensé pour
// un mot RAJOUTÉ en suffixe ("Manchester City" → "Manchester City FC"). Mais
// certains clubs sont couramment désignés par une source (souvent ESPN) par
// un SEUL mot qui est aussi, par coïncidence, le tout début du nom OFFICIEL
// d'un club distinct de la même ligue — ex. "Deportivo" (Deportivo La
// Corogne) préfixe valide de "Deportivo Alavés" (club différent), ou "Real"
// (si jamais utilisé seul) préfixe de "Real Sociedad"/"Real Betis"/"Real
// Oviedo". N'attrape QUE le cas où le nom le plus court, après normalisation,
// est ENTIÈREMENT égal à l'un de ces mots — un nom court à plusieurs mots
// ("Manchester City", "Toulouse FC"...) n'est jamais concerné, aucune
// régression possible sur les cas déjà couverts par les tests existants.
const AMBIGUOUS_BARE_PREFIXES = new Set([
  'deportivo', 'real', 'racing', 'sporting', 'union', 'atletico', 'dynamo',
  'dinamo', 'inter', 'club',
])

// ⚠️ AJOUT paramètre `compMatches` (constat utilisateur, 19/08 : "du jour au
// lendemain dans les matchs à venir j'ai plus de H2H alors qu'avant j'en
// avais") : ce garde-fou (17/08, voir juste au-dessus) protège bien le widget
// "forme récente"/stats contre le bug Deportivo/Alavés — mais il est appelé
// UNIQUEMENT par le mot générique (ex. "Real" préfixe de "Real Madrid"),
// jamais informé de la compétition réelle. Or `resolveFdMatchIdLive`
// (H2H) l'utilise aussi via resolveFdTeamId sur homeTeam/awayTeam — pour
// TOUT match sourcé ESPN (les 6 grands championnats dans Accueil, voir
// isRealFdMatchId plus haut) impliquant un club qu'ESPN désigne par un mot
// générique seul (Real Sociedad, Union Berlin, Inter Milan, Racing
// Strasbourg...), le H2H se désactivait silencieusement (aucune régression
// dans clubNameMatch lui-même, juste ce garde-fou trop large qui bloque
// désormais AUSSI les cas sûrs, pas seulement Deportivo/Alavés).
// Avec `compMatches` fourni (voir `allowBarePrefix` dans resolveFdTeamId,
// activé UNIQUEMENT par resolveFdMatchIdLive) : le mot générique n'est refusé
// que s'il existe VRAIMENT plusieurs clubs distincts dans CETTE compétition
// dont le nom démarre par ce même mot (ex. Real Madrid ET Real Sociedad ET
// Real Betis ET Real Oviedo, tous en Liga — collision réelle, même risque que
// Deportivo/Alavés). Un seul candidat dans la compétition = aucune collision
// possible, donc sûr d'accepter. Sans `compMatches` (tous les autres
// appelants : PreMatchSection, MpSeasonStats, useProbableLineups,
// ClassementTab...) : comportement 100% inchangé, refus systématique comme
// avant — le fix Deportivo/Alavés du 17/08 reste intact pour son usage
// d'origine, aucune régression possible sur ces appelants.
function isAmbiguousBarePrefixMatch(a, b, compMatches = null) {
  const na = normalize(a), nb = normalize(b)
  if (!na || !nb || na === nb) return false
  const shorter = na.length <= nb.length ? na : nb
  const longer  = na.length <= nb.length ? nb : na
  if (!AMBIGUOUS_BARE_PREFIXES.has(shorter) || !longer.startsWith(shorter)) return false
  if (!compMatches) return true
  // Dédoublonnage par id d'équipe (pas par nom) : name ET shortName du MÊME
  // club matchent tous les deux souvent le préfixe ("Real Sociedad de
  // Fútbol" + "Real Sociedad") — les compter comme 2 "candidats" créerait une
  // fausse collision dès qu'un seul vrai club est concerné.
  const candidates = new Set()
  for (const m of compMatches) {
    for (const t of [m.homeTeam, m.awayTeam]) {
      const n1 = normalize(t?.name ?? ''), n2 = normalize(t?.shortName ?? '')
      if (n1.startsWith(shorter) || n2.startsWith(shorter)) candidates.add(t?.id ?? `${n1}|${n2}`)
    }
  }
  return candidates.size > 1
}

// Logique de résolution "live" — EXACTEMENT le corps d'origine de
// resolveFdMatchId, inchangé au caractère près (voir wrapper juste en
// dessous, qui ajoute uniquement une couche de mémoire par-dessus, sans
// toucher à ces règles de matching déjà fragiles — plusieurs reverts
// documentés dans l'historique du projet sur cette zone précise).
function resolveFdMatchIdLive(match, compMatches, { loose = false } = {}) {
  const rawId = match?.id ?? null
  if (isRealFdMatchId(rawId)) return rawId
  if (!match || !compMatches?.length) return null
  // allowBarePrefix : voir le commentaire dédié sur isAmbiguousBarePrefixMatch
  // plus haut — sûr spécifiquement ici car homeId ET awayId doivent ENSEMBLE
  // retrouver une vraie fixture (paire d'équipes + date la plus proche,
  // juste en dessous) : un mauvais id issu d'une collision resterait sans
  // fixture correspondante et retomberait sur `null` (aucun H2H) plutôt que
  // d'afficher un H2H erroné — contrairement au widget forme récente/stats
  // (resolveFdTeamId appelé seul, sans cette double vérification), qui garde
  // le refus strict par défaut.
  const homeId = resolveFdTeamId(match.homeTeam, compMatches, { loose, allowBarePrefix: true })
  const awayId = resolveFdTeamId(match.awayTeam, compMatches, { loose, allowBarePrefix: true })
  if (homeId == null || awayId == null) return null
  const refTime = match.utcDate ? new Date(match.utcDate).getTime() : null
  let best = null, bestDiff = Infinity
  for (const m of compMatches) {
    const sameFixture =
      (m.homeTeam?.id === homeId && m.awayTeam?.id === awayId) ||
      (m.homeTeam?.id === awayId && m.awayTeam?.id === homeId)
    if (!sameFixture) continue
    if (refTime == null) return m.id
    const diff = Math.abs(new Date(m.utcDate).getTime() - refTime)
    if (diff < bestDiff) { bestDiff = diff; best = m.id }
  }
  return best
}

// ⚠️ AJOUT mémoire persistante (12/08, constat utilisateur : "H2H affiche 10
// confrontations un jour, plus que 2 le lendemain pour le même match") :
// resolveFdMatchIdLive ci-dessus a besoin de `compMatches` (données de la
// compétition déjà chargées) pour retrouver l'id football-data.org d'un
// match sourcé ESPN — si `compMatches` n'est pas encore arrivé au moment
// précis de ce calcul (ex. lancement à froid de l'app, cache local expiré),
// la résolution échoue, retombe sur le repli pauvre (2-3 confrontations)
// alors que le VRAI historique (7j de cache, voir useH2H/useMatchDetail.js)
// existe toujours sous le bon id — juste inatteignable ce jour-là faute de
// pouvoir recalculer la clé. Cette association (id ESPN → id FD.org) ne
// change JAMAIS une fois trouvée pour un match donné — mémorisée ici dès
// qu'elle est résolue avec succès, longue durée, relue en dernier repli
// avant d'abandonner. Aucune règle de matching touchée (voir ci-dessus) :
// pur ajout, ne peut jamais dégrader un cas qui marchait déjà.
const FD_MATCH_ID_MAP_TTL = 180 * 24 * 3600 * 1000 // 180j

export function resolveFdMatchId(match, compMatches, opts = {}) {
  const rawId = match?.id ?? null
  if (isRealFdMatchId(rawId)) return rawId
  const cacheKey = rawId ? `fdMatchIdMap_${rawId}` : null
  const live = resolveFdMatchIdLive(match, compMatches, opts)
  if (live != null) {
    if (cacheKey) writeCache(cacheKey, live, FD_MATCH_ID_MAP_TTL)
    return live
  }
  return cacheKey ? (readCacheStale(cacheKey) ?? null) : null
}

// ⚠️ AJOUT `strict` (constat utilisateur, 16/08 : losange "forme récente"
// affiché sous le logo de Racing — pas encore Racing lui-même, mais une
// AUTRE équipe — alors que le match était toujours en cours, jamais terminé
// ; même famille de bug repérée la veille sur Rayo Vallecano) : par défaut
// (strict:false, comportement historique inchangé, toujours couvert par le
// test "Équipe inconnue" plus bas), quand AUCUN nom ne matche dans
// compMatches, la fonction retombe sur `rawId` — l'id ESPN BRUT de l'équipe,
// tel quel. Le souci : cet id ESPN n'a AUCUN rapport avec le référentiel
// football-data.org utilisé comme clé de formMap/matchesByComp — deux
// numérotations totalement indépendantes qui peuvent parfaitement coïncider
// par hasard (l'id ESPN d'une équipe peut valoir "87", exactement l'id FD.org
// d'une équipe complètement différente). Tant que ce rawId sert juste de
// "meilleur effort" pour une recherche de FIXTURE à 2 id (homeId ET awayId
// doivent matcher ENSEMBLE, voir resolveFdMatchIdLive ci-dessus), une
// coïncidence isolée ne suffit pas à produire un faux résultat. Mais utilisé
// tel quel comme clé BRUTE d'un dictionnaire (formMap?.[resolvedId], voir
// MatchCard.jsx/MatchPoster.jsx/MatchDuJourCard.jsx/Pronos.jsx/MatchPage.jsx/
// LiveMatchPage.jsx), la moindre coïncidence numérique affiche silencieusement
// les données (forme récente, stats saison) d'une équipe totalement
// différente sous le logo de la bonne équipe — aucune vérification que l'id
// obtenu représente vraiment la même équipe. `strict:true` supprime ce repli
// dangereux : si aucun nom ne matche vraiment, on retourne `null` plutôt que
// de deviner — un losange absent (aucune donnée) est toujours préférable à
// un losange faux (donnée d'un autre club). Les appelants concernés ont tous
// déjà un garde-fou naturel en aval (formMap?.[null] → undefined →
// FormDiamonds masqué ; calcPronoAdvanced traite déjà homeId/awayId null
// comme "pas de H2H disponible", voir calcProno.js) — aucune régression,
// juste un vrai "je ne sais pas" au lieu d'un faux positif silencieux.
export function resolveFdTeamId(team, compMatches, { loose = false, strict = false, allowBarePrefix = false } = {}) {
  const rawId = team?.id ?? null
  const giveUp = () => (strict ? null : rawId)
  if (!team || !compMatches?.length) return giveUp()
  // ⚠️ clubNameMatch (pas fuzzyTeam) : voir commentaire dédié dans
  // espnSummaryParse.js — fuzzyTeam confond des clubs distincts qui
  // partagent juste un mot générique (bug réel : Manchester City / United).
  // On teste name ET shortName des deux côtés (4 combinaisons) puisque
  // clubNameMatch est volontairement plus strict (préfixe complet
  // uniquement) — plus de champs comparés compense sans réintroduire le
  // risque de faux positif.
  // ⚠️ AJOUT isAmbiguousBarePrefixMatch (constat utilisateur, 17/08 : losange
  // "forme récente" toujours affiché pour Deportivo, 0 match joué cette
  // saison, sur sa card Accueil contre Elche — 100% La Liga, donc PAS le
  // même mécanisme que les 2 fix précédents du 16/08, qui ciblaient une
  // collision d'ID numérique). Root cause différente, trouvée en relisant
  // clubNameMatch (préfixe complet, espnSummaryParse.js) : ESPN utilise
  // couramment "Deportivo" seul comme nom court du Deportivo La Corogne — et
  // "Deportivo" est un préfixe complet VALIDE de "Deportivo Alavés" (nom
  // officiel réel d'un club totalement différent, présent lui aussi en
  // LaLiga). clubNameMatch était pensé pour absorber un mot RAJOUTÉ en
  // SUFFIXE ("Manchester City" → "Manchester City FC") — jamais pour un nom
  // court qui EST ENTIÈREMENT un mot générique partagé par plusieurs clubs
  // distincts de la même ligue (Real Madrid/Sociedad/Betis/Oviedo,
  // Racing.../Sporting..., et donc aussi Deportivo/Deportivo Alavés). Vu
  // l'historique documenté juste au-dessus (2 tentatives de modifier
  // clubNameMatch/resolveFdTeamId ont cassé l'Accueil en prod, cause jamais
  // identifiée avec certitude), ce fix NE TOUCHE PAS clubNameMatch ni l'ordre
  // de résolution existant : un garde-fou purement additif, qui ne fait que
  // REFUSER un match déjà accepté par clubNameMatch quand le nom le plus
  // court vaut EXACTEMENT l'un de ces mots ambigus connus — ne peut donc
  // jamais transformer un cas qui échouait déjà en un nouveau succès, et ne
  // touche aucun autre appariement (tous les tests existants portent sur des
  // noms multi-mots, jamais un mot générique seul).
  // Le garde-fou ne s'applique qu'à clubNameMatch (préfixe, risqué) — jamais
  // à looseTeamNameMatch (égalité stricte après translateTeam, toujours sûre
  // par construction) : si une vraie correspondance canonique existe un jour
  // (ex. ajout d'une entrée TEAM_NAMES_FR pour Deportivo), `loose` doit
  // pouvoir continuer à la trouver normalement.
  const teamNames = [team.name, team.shortName].filter(Boolean)
  const matches = (candidate) => teamNames.some(n =>
    (clubNameMatch(candidate ?? '', n) && !isAmbiguousBarePrefixMatch(candidate ?? '', n, allowBarePrefix ? compMatches : null)) ||
    (loose && looseTeamNameMatch(candidate ?? '', n))
  )
  // Chemin normal (match déjà FD.org, id déjà dans le même référentiel que
  // compMatches) : rien à résoudre, on ne fait jamais de recherche par nom
  // inutilement.
  // ⚠️ AJOUT vérification du nom (constat utilisateur, 16/08 : losange "forme
  // récente" de Deportivo — 0 match joué cette saison — affichait le résultat
  // GAGNANT d'un autre club) : cet ancien raccourci faisait confiance à
  // `rawId` dès qu'il existait QUELQUE PART dans compMatches, MÊME sous le
  // nom d'une équipe complètement différente — exactement le bug que `strict`
  // était censé éviter (id ESPN qui coïncide par hasard avec l'id FD.org d'un
  // AUTRE club, voir le commentaire strict plus bas) : `strict` empêchait
  // bien de RETOMBER sur un id inconnu, mais ce raccourci-ci, lui, acceptait
  // encore aveuglément un id CONNU mais attribué au mauvais club. Un id
  // trouvé mais dont le nom associé ne correspond pas retombe maintenant sur
  // la recherche par nom ci-dessous plutôt que d'être accepté tel quel.
  const idMatch = compMatches.find(m => m.homeTeam?.id === rawId || m.awayTeam?.id === rawId)
  if (idMatch) {
    const teamAtId = idMatch.homeTeam?.id === rawId ? idMatch.homeTeam : idMatch.awayTeam
    if (!teamNames.length || matches(teamAtId?.name) || matches(teamAtId?.shortName)) return rawId
  }
  if (!teamNames.length) return giveUp()
  // `loose` : voir le commentaire détaillé sur resolveFdMatchId ci-dessus —
  // clubNameMatch seule (toujours essayée en premier, comportement inchangé)
  // ne détecte pas les noms courts ESPN qui sont un SUFFIXE (pas un préfixe)
  // du nom FD.org, ex. "Lyon" vs "Olympique Lyon(nais)".
  for (const m of compMatches) {
    if (matches(m.homeTeam?.name) || matches(m.homeTeam?.shortName)) {
      return m.homeTeam.id
    }
    if (matches(m.awayTeam?.name) || matches(m.awayTeam?.shortName)) {
      return m.awayTeam.id
    }
  }
  return giveUp()
}

// ⚠️ AJOUT (21/08, constat utilisateur : "les logos des clubs dans Programme/
// Résultats c'est pas les mêmes que sur les cards des matchs dans Accueil")
// : les 6 grands championnats affichés en cards Accueil (MatchCard/
// MatchPoster/MatchDuJourCard/ResultHeroCard) sont sourcés ESPN
// (fetchEspnPortion, useTodayMatches.js) — leur `team.crest` vient donc de
// `home.team.logo` (ESPN, voir espnAdapter.js), un CDN et un style d'écusson
// différents de celui de football-data.org qu'utilisent Programme/Résultats
// (`useMatches`, FD.org direct). Pas un bug — deux sources d'images
// légitimes mais distinctes pour le même club. resolveFdCrest permet de
// PRÉFÉRER l'écusson FD.org quand on le connaît déjà (compMatches, déjà
// chargé pour la résolution d'id/forme récente — AUCUN appel FD.org
// supplémentaire) : cherche l'écusson associé à `resolvedId` (voir
// resolveFdTeamId ci-dessus, déjà appelé par tous ces composants) dans
// compMatches, retombe sur l'écusson d'origine du match (`team.crest`,
// ESPN ou déjà FD.org selon la source) si non trouvé — jamais de blason vide.
export function resolveFdCrest(team, resolvedId, compMatches) {
  if (resolvedId != null && compMatches?.length) {
    for (const m of compMatches) {
      if (m.homeTeam?.id === resolvedId && m.homeTeam?.crest) return m.homeTeam.crest
      if (m.awayTeam?.id === resolvedId && m.awayTeam?.crest) return m.awayTeam.crest
    }
  }
  return team?.crest ?? null
}

// ── Ligne "Journée N · date" du bandeau ──────────────────────────────────────
// Partagée par MatchPage et LiveMatchPage, qui affichent le MÊME bandeau : la
// dupliquer aurait garanti qu'elles divergent (c'est déjà arrivé sur
// data-opaque, présent d'un côté et pas de l'autre pendant des semaines).
// Renvoie null si on n'a ni journée ni date — la ligne n'est alors pas rendue
// du tout plutôt que d'afficher un séparateur vide.
export function buildHeroSubline(match) {
  const md = match?.matchday
  const journee = Number.isFinite(md) ? `Journée ${md}` : null
  let date = null
  if (match?.utcDate) {
    const d = new Date(match.utcDate)
    if (!isNaN(d)) {
      date = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    }
  }
  return [journee, date].filter(Boolean).join(' · ') || null
}
