// Suivi live en deux couches :
//
// ── PRIMAIRE : /api/fifa-live (Vercel function → ESPN + Redis cache) ──
//   • Fetch server-side : scoreboard ESPN mis en cache Redis 8s, FIFA live 6s
//     (voir api/fifa-live.js — ESPN_TTL/FIFA_TTL — cache PARTAGÉ entre tous
//     les utilisateurs, donc le coût upstream ne dépend pas du nombre de
//     clients qui pollent, seulement de ce TTL)
//   • eventId → fdMatchId stocké Redis 6h → survit aux rechargements iOS
//   • Scorer preservation + stats summary côté serveur (cache 30s, séparé —
//     voir SUMMARY_TTL dans api/fifa-live.js : les stats live comme la
//     possession sont donc un peu moins fraîches que le score lui-même)
//   • Poll toutes les 5s dès qu'un match approche ou est en cours (Web
//     Worker dédié, non throttlé même en arrière-plan — voir espnTimerWorker.js
//     et le hook plus bas ; ⚠️ commentaire corrigé, ce n'était plus 15s)
//
// ── FALLBACK : api-football.com (/apifootball?live=all) ──
//   • Poll toutes les 60s, UNIQUEMENT dans les 4 fenêtres critiques

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import EspnTimerWorker from '../workers/espnTimerWorker.js?worker'
import {
  getMatchState, trackMatchState, clearMatchState, clearFtFlags,
  getTrackedMatches, setKickoffAt, setHalf2Start,
  clearAllMatchStates, setEspnData, setEspnWorking,
  getLiveState, setLiveState,
} from '../utils/matchStateTracker'
import { markLive, markEnded, markPendingKickoff, isTrackedLive, getLiveMatches } from './liveTracker'
import { ESPN_SLUG_BY_COMP_ID } from '../data/espnSlugs.js'

// Notifications gérées exclusivement par le cron /api/cron-goals (VAPID web-push)
// → fonctionne même quand l'app est fermée, sans doublons.

// ─────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────

let quotaRemaining = Infinity
let espnFailStreak = 0

// Stages FD.org à élimination directe (jamais de match nul possible) — même
// liste que KNOCKOUT_ORDER dans useWcKnockout.js, dupliquée ici pour éviter un
// import croisé entre hooks pour une simple liste de constantes.
const KNOCKOUT_STAGES = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL']

// Cache module-level des scores ESPN (scores + buteurs + stats).
const espnScoresCache = {}

// ── Poll lock ─────────────────────────────────────────────────────────────────
// Un seul pollESPN à la fois. Si un poll est en cours quand le visibilitychange
// ou le Worker déclenche un autre tick, on l'ignore plutôt que de créer une race
// condition (stale Redis cache vs fresh ESPN data → régression de score).
let _pollInProgress = false
let _pollQueued     = false   // au plus un poll en attente
// Horodatage du dernier verrou posé — sert à détecter un verrou "fantôme" :
// sur iOS, un fetch en cours au moment où l'app passe en arrière-plan peut
// rester gelé (réseau suspendu) tant que l'app n'est pas revenue au premier
// plan. Le retour au premier plan appelle pollESPN(forceFresh=true), qui se
// contentait alors de mettre ce poll en FILE D'ATTENTE derrière le fetch gelé
// — lequel ne se débloque et ne timeout (AbortSignal 10s) qu'une fois relancé
// par l'event loop, retardant d'autant le rafraîchissement "immédiat" censé
// suivre le retour sur l'app. Voir STALE_LOCK_MS plus bas.
let _pollStartedAt = 0
const STALE_LOCK_MS = 4_000

// "FT potentiel" — STATUS_FINAL vu une 1ère fois, en attente de confirmation
// { [matchId]: { since: number, score: string } }
const pendingFt = {}

// Dernière fois que chaque match a été vu dans un event ESPN (scoreboard ou STATUS_FINAL)
// { [matchId]: timestamp }
const lastSeenInEspn = {}

// Restauration partielle au chargement
// On garde le cache jusqu'à 30 min pour couvrir les reloads pendant un match
try {
  const lastPoll = parseInt(localStorage.getItem('foot_espn_last_poll') ?? '0', 10)
  if (Date.now() - lastPoll < 30 * 60_000) {
    const raw = localStorage.getItem('espn_scores_cache')
    if (raw) Object.assign(espnScoresCache, JSON.parse(raw))
  }
} catch {}

// football-data.org competition ID → slug ESPN — voir src/data/espnSlugs.js.
// ⚠️ INCOHÉRENCE CORRIGÉE : ce mapping existait en TRIPLE (ici, dans
// api/fifa-live.js, et sous forme de simple tableau dans api/cron-goals.js) —
// trois copies à tenir manuellement synchronisées. Importé ici depuis la
// source unique et ré-exporté pour ne rien casser côté appelants
// (useMatchDetail.js notamment, qui importe COMP_ESPN depuis ce fichier).
export const COMP_ESPN = ESPN_SLUG_BY_COMP_ID

// ─────────────────────────────────────────────
// Helpers communs (conservés pour api-football fallback)
// ─────────────────────────────────────────────

export function normalize(name = '') {
  return name.toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[éèêë]/g, 'e')
    .replace(/[ûùüú]/g, 'u').replace(/[îïí]/g, 'i')
    .replace(/[ôöó]/g, 'o').replace(/ç/g, 'c')
    .trim()
}

export function fuzzyTeam(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (!na || !nb) return false
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true
  const wordsA = na.split(/\s+/).filter(w => w.length >= 4)
  const wordsB = nb.split(/\s+/).filter(w => w.length >= 4)
  return wordsA.some(wa =>
    wordsB.some(wb => wa.startsWith(wb.slice(0, 4)) || wb.startsWith(wa.slice(0, 4)))
  )
}

/**
 * Convertit un displayClock ESPN ("42:00", "45:00+2:00") en minutes entières.
 */
function parseClockMins(clock) {
  if (!clock) return null
  const plusIdx = clock.indexOf('+')
  if (plusIdx === -1) {
    const m = parseInt(clock.split(':')[0], 10)
    return isNaN(m) ? null : m
  }
  const base  = parseInt(clock.slice(0, plusIdx).split(':')[0], 10)
  const extra = parseInt(clock.slice(plusIdx + 1).split(':')[0], 10)
  if (isNaN(base) || isNaN(extra)) return null
  return base + extra
}

// ─────────────────────────────────────────────
// Helper : confirmer un FT et planifier l'éviction
// ─────────────────────────────────────────────

function confirmFt(match, now, queryClient) {
  const id    = match.id
  const cache = espnScoresCache[id]
  setLiveState(id, 'ended', { endedAt: now })

  // Persister le score ESPN pour MatchModal post-match
  if (espnScoresCache[id]) {
    try { localStorage.setItem(`foot_espn_${id}`, JSON.stringify(espnScoresCache[id])) } catch {}
  }

  // ft: true → stoppe calcMinute, MatchCard passe en "Terminé"
  try {
    localStorage.setItem(`foot_ms_${id}`, JSON.stringify({
      ...getMatchState(id),
      ft:        true,
      termineAt: now,
    }))
  } catch {}

  queryClient.invalidateQueries({ queryKey: ['liveMatches'] })

  const code = match.competition?.code
  const isWC = code === 'WC' || match.competition?.id === 2000

  // Tableau des phases finales (bracket WC) : football-data.org n'assigne
  // l'équipe qualifiée au tour suivant qu'une fois le match officiellement
  // clôturé côté FD.org — ce délai côté FD.org est hors de notre contrôle.
  // Mais AVANT ce fix, notre propre cache (useWcKnockout, staleTime 10min)
  // ajoutait un délai supplémentaire de NOTRE côté en plus de celui de
  // FD.org : le bracket ne se rafraîchissait jamais suite à une fin de
  // match, seulement au bout de 10min ou en rechargeant la page. Ici on
  // force un refetch dès qu'on sait qu'un match WC est terminé (2 essais,
  // comme pour todayMatches/matches FINISHED ci-dessous, au cas où FD.org
  // lui-même n'aurait pas encore mis à jour au 1er essai).
  if (isWC) queryClient.invalidateQueries({ queryKey: ['wc-knockout'] })

  // À 2s : mise à jour immédiate Accueil (recent results) + page Résultats
  setTimeout(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    // Invalider React Query
    queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
    if (code) {
      queryClient.invalidateQueries({ queryKey: ['matches', code, 'FINISHED'] })
      // ⚠️ BUG CORRIGÉ : le classement (useStandings, queryKey ['standings', code])
      // n'était JAMAIS invalidé à la fin d'un match — seul hook de données
      // affectées par un FT à ne recevoir aucune invalidation proactive (audit :
      // aucune autre référence à 'standings' dans tout le code). Concrètement,
      // un utilisateur resté sur la page Classement pendant qu'un match de la
      // même compétition se termine ne voyait jamais le tableau bouger tant que
      // le staleTime (2min) + un déclencheur (refocus/remount) n'arrivaient pas.
      // Même schéma 2s + 5min que le bracket WC juste au-dessus : FD.org peut
      // mettre quelques secondes à recalculer le classement après le FT.
      queryClient.invalidateQueries({ queryKey: ['standings', code] })
      // Même audit, même constat : "Forme récente" (teamForm2) et le
      // classement buteurs/passeurs (scorers) n'étaient pas non plus
      // invalidés. Clé partielle ['teamForm2', code] : matche les deux
      // variantes de saison (2026 pour WC, 'cur' sinon) sans avoir à
      // dupliquer l'invalidation — comportement par défaut de React Query
      // (préfixe de clé, pas besoin de clé exacte).
      queryClient.invalidateQueries({ queryKey: ['teamForm2', code] })
      queryClient.invalidateQueries({ queryKey: ['scorers', code] })
    }
    if (isWC) queryClient.invalidateQueries({ queryKey: ['wc-knockout'] })
    // Effacer les caches localStorage pour forcer un refetch propre
    try { localStorage.removeItem(`foot_matches_${todayStr}`) } catch {}
    if (code) {
      try { localStorage.removeItem(`foot_matches_${code}_FINISHED`) } catch {}
    }
  }, 2_000)

  // Éviction réelle après 5min (grace period : widget reste avec "Terminé")
  // Aussi un 2e essai pour le bracket, le classement, la forme et les
  // buteurs/passeurs : si FD.org n'avait pas encore mis à jour au 1er essai
  // (2s), il y a de bonnes chances que ce soit fait 5min plus tard.
  setTimeout(() => {
    markEnded(id)
    delete espnScoresCache[id]
    clearMatchState(id, { preserveEnded: true })
    queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
    queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
    if (code) {
      queryClient.invalidateQueries({ queryKey: ['matches', code, 'FINISHED'] })
      queryClient.invalidateQueries({ queryKey: ['standings', code] })
      queryClient.invalidateQueries({ queryKey: ['teamForm2', code] })
      queryClient.invalidateQueries({ queryKey: ['scorers', code] })
    }
    if (isWC) queryClient.invalidateQueries({ queryKey: ['wc-knockout'] })
  }, 5 * 60_000)
}

// ─────────────────────────────────────────────
// Pending kickoff — affichage immédiat à l'heure prévue
// ─────────────────────────────────────────────

/**
 * Détecte les matchs SCHEDULED dont l'heure de KO est atteinte.
 * Appelle markPendingKickoff() → widget s'affiche avec "Débute".
 * Pré-seed espnScoresCache avec des 0 pour que les stats s'affichent dès le départ.
 * Dès qu'ESPN confirme STATUS_IN_PROGRESS, markLive() écrase l'entrée pending.
 */
function _checkPendingKickoffs(matches, queryClient) {
  const now = Date.now()
  let changed = false

  for (const match of matches) {
    // FD.org utilise 'TIMED' pour les matchs à venir (WC inclus), pas seulement 'SCHEDULED'
    if (match.status !== 'SCHEDULED' && match.status !== 'TIMED') continue
    if (isTrackedLive(match.id)) continue

    const slug = COMP_ESPN[match.competition?.id]
    if (!slug) continue // compétition non suivie → skip

    const utcMs = new Date(match.utcDate).getTime()
    // Fenêtre : entre l'heure prévue et +30min (sécurité si ESPN tarde ou match annulé)
    if (now < utcMs || now - utcMs > 30 * 60_000) continue

    markPendingKickoff(match)

    // ⚠️ NE PAS seed kickoffAt ici sur l'heure prévue. Un essai précédent le
    // faisait pour démarrer le compteur de minutes sans attendre ESPN — mais
    // ça cassait justement le placeholder "Débute" (calcMinute exige
    // `!state.kickoffAt` pour l'afficher, voir matchUtils.js) : le match
    // affichait "1'" dès l'heure prévue même si le coup d'envoi réel avait du
    // retard (poteau, contrôle VAR, retard équipe...). Comportement voulu :
    // "Débute" tant qu'ESPN n'a pas confirmé, puis kickoffAt posé avec la
    // vraie minute ESPN (voir "KO détecté" plus bas dans _doPollESPN) →
    // transition directe vers la bonne minute, jamais "1'" avant le vrai KO.

    // Pré-seeder le cache à 0 si rien encore
    if (!espnScoresCache[match.id]) {
      espnScoresCache[match.id] = {
        home: 0, away: 0, scorers: [],
        stats: {
          home: { poss: 0, shots: 0, shotsOnTarget: 0, corners: 0 },
          away: { poss: 0, shots: 0, shotsOnTarget: 0, corners: 0 },
        },
      }
      changed = true
    }
  }

  if (changed) {
    queryClient.setQueryData(['espnScores'], { ...espnScoresCache })
    try { localStorage.setItem('espn_scores_cache', JSON.stringify(espnScoresCache)) } catch {}
  }
}

// ─────────────────────────────────────────────
// Safeguards FT — appelés avant le early return, même sans slugs à poller
// ─────────────────────────────────────────────
function _runFtSafeguards(matches, now, queryClient) {
  // Pool combiné : matches FD.org du jour + matchs stockés dans liveTracker
  const allLive = [...matches]
  for (const lm of getLiveMatches()) {
    if (!allLive.some(m => m.id === lm.id)) allLive.push(lm)
  }

  // Safeguard 1 : pendingFt timeout (45s)
  for (const [midStr, pft] of Object.entries(pendingFt)) {
    if (now - pft.since < 45_000) continue
    const mid = Number(midStr)
    delete pendingFt[midStr]
    if (getLiveState(mid).state === 'ended') continue
    if (!isTrackedLive(mid)) continue
    const match = allLive.find(m => m.id === mid)
    if (!match) continue
    console.log(`[useLiveMinute] pendingFt timeout → FT auto-confirmé match ${mid}`)
    confirmFt(match, now, queryClient)
  }

  // Safeguard 2 : durée max live — dernier filet de sécurité si ESPN ne confirme
  // jamais le FT. ⚠️ 150min était trop court pour un match à prolongations + tirs
  // au but (90min + arrêts + 15min pause + 30min ET + tab ≈ 160-180min) — pertinent
  // maintenant qu'on est en phase à élimination directe. Si ESPN indique encore
  // explicitement que le match est en cours (prolongations, tirs au but...), on ne
  // force pas le FT et on relève le plafond à 200min au lieu de 150.
  for (const lm of getLiveMatches()) {
    const mid = lm.id
    if (getLiveState(mid).state === 'ended') continue
    if (pendingFt[mid]) continue
    const ageMin = (now - new Date(lm.utcDate)) / 60_000
    const espnStatus2 = getMatchState(mid).espnStatus
    const stillGoingPerEspn = (
      espnStatus2 === 'STATUS_IN_PROGRESS' || espnStatus2 === 'STATUS_HALFTIME' ||
      espnStatus2 === 'STATUS_END_PERIOD'  || espnStatus2 === 'STATUS_EXTRA_TIME' ||
      espnStatus2 === 'STATUS_OVERTIME'    || espnStatus2 === 'STATUS_SHOOTOUT'
    )
    const limit = stillGoingPerEspn ? 200 : 150
    if (ageMin < limit) continue
    console.log(`[useLiveMinute] match ${mid} > ${limit}min → FT forcé`)
    confirmFt(lm, now, queryClient)
  }

  // Safeguard 3 : FD.org confirme FINISHED mais match encore dans liveTracker
  // ⚠️ FD.org réplique parfois les faux STATUS_FINAL de FIFA (ex: "FINISHED" à 72').
  //   Double garde : âge plausible (>= 85min) ET ESPN ne dit pas encore IN_PROGRESS.
  for (const lm of getLiveMatches()) {
    const mid = lm.id
    if (getLiveState(mid).state === 'ended') continue
    if (pendingFt[mid]) continue
    const fdMatch = allLive.find(m => m.id === mid)
    if (!fdMatch || fdMatch.status !== 'FINISHED') continue
    // Garde âge : ignorer si le match a moins de 85min (faux FT de transition FIFA/FD.org)
    const ageMin3 = (now - new Date(lm.utcDate)) / 60_000
    if (ageMin3 < 85) {
      console.log(`[useLiveMinute] Safeguard 3 ignoré — FD.org FINISHED mais ${Math.round(ageMin3)}min < 85 (faux FT ?)`)
      continue
    }
    // Garde ESPN : si ESPN confirme toujours que le match est en cours, on lui fait confiance.
    // ⚠️ Manquaient STATUS_EXTRA_TIME/OVERTIME/SHOOTOUT : un match en prolongations ou
    // tirs au but (phase à élimination directe) pouvait être marqué "Terminé" à tort si
    // FD.org renvoyait déjà FINISHED (souvent en avance/imprécis) pendant qu'ESPN
    // indiquait encore le match en cours.
    const ms3 = getMatchState(mid)
    if (
      ms3.espnStatus === 'STATUS_IN_PROGRESS' ||
      ms3.espnStatus === 'STATUS_HALFTIME'    ||
      ms3.espnStatus === 'STATUS_END_PERIOD'  ||
      ms3.espnStatus === 'STATUS_EXTRA_TIME'  ||
      ms3.espnStatus === 'STATUS_OVERTIME'    ||
      ms3.espnStatus === 'STATUS_SHOOTOUT'
    ) {
      console.log(`[useLiveMinute] Safeguard 3 ignoré — FD.org FINISHED mais ESPN=${ms3.espnStatus} (priorité ESPN)`)
      continue
    }
    console.log(`[useLiveMinute] match ${mid} FINISHED (FD.org, ${Math.round(ageMin3)}min) → FT`)
    confirmFt(lm, now, queryClient)
  }

  // Safeguard 4 : match disparu du scoreboard ESPN depuis > 5min après avoir été vu
  for (const lm of getLiveMatches()) {
    const mid = lm.id
    if (getLiveState(mid).state === 'ended') continue
    if (pendingFt[mid]) continue
    const lastSeen = lastSeenInEspn[mid]
    if (!lastSeen) continue
    if (now - lastSeen < 5 * 60_000) continue
    const ageMin = (now - new Date(lm.utcDate)) / 60_000
    if (ageMin < 90) continue
    console.log(`[useLiveMinute] match ${mid} disparu d'ESPN depuis ${Math.round((now - lastSeen) / 60_000)}min → FT`)
    confirmFt(lm, now, queryClient)
  }
}

// ─────────────────────────────────────────────
// ESPN — couche primaire (via /api/fifa-live)
// ─────────────────────────────────────────────

async function _doPollESPN(matches, queryClient, forceFresh = false) {
  const now = Date.now()

  // ── Pending kickoff : afficher le widget dès l'heure prévue ──
  _checkPendingKickoffs(matches, queryClient)

  // Étendre matches avec les matchs persistés dans liveTracker
  // → fix cold start PWA : matches[] vide pendant 1-2s au chargement
  const allMatches = [...matches]
  for (const lm of getLiveMatches()) {
    if (!allMatches.some(m => m.id === lm.id)) allMatches.push(lm)
  }

  // Filtrer les matchs dans la fenêtre de poll (0min → +150min).
  // Exception WC (FIFA, compId=2000) : on commence 60min avant le KO pour récupérer
  // les IDs FIFA (IdCompetition/Season/Stage) en cache Redis avant le coup d'envoi.
  // Cela permet d'afficher les compos dès que FIFA les publie (~1h avant).
  // ⚠️ Sûr : fifaToEspnStatus() retourne STATUS_SCHEDULED pour Period=0 → pas de faux KO.
  const toTrack = allMatches.filter(m => {
    const elapsed   = (now - new Date(m.utcDate)) / 60_000
    const preBuffer = m.competition?.id === 2000 ? -60 : 0   // WC : poll 60min avant
    return (elapsed >= preBuffer && elapsed <= 150) || isTrackedLive(m.id)
  })

  if (toTrack.length === 0) {
    _runFtSafeguards(allMatches, now, queryClient)
    return
  }

  try {
    // ── Appel au nouvel endpoint server-side ──
    // Fetch ESPN + Redis cache + matching + stats → retourne { [fdMatchId]: { ... } }
    // ⚠️ Timeout obligatoire : sans lui, une requête réseau qui traîne (connexion
    // mobile instable, cellulaire faible signal...) reste "pending" indéfiniment.
    // Or pollESPN() pose un verrou (_pollInProgress) tant que ce fetch n'est pas
    // résolu — TOUS les polls suivants (Worker toutes les ~15-20s, retour au
    // premier plan, etc.) sont alors simplement mis en file d'attente sans jamais
    // s'exécuter → le score en direct reste figé jusqu'à ce que CE fetch finisse
    // par aboutir (potentiellement plusieurs minutes sans limite côté navigateur).
    // Root cause identifiée d'un gel de score signalé (~10min, appli pourtant au
    // premier plan) : ce fetch n'avait aucune limite de temps. Avec le timeout,
    // il échoue proprement en 10s max → le catch ci-dessous relâche le verrou via
    // le finally de pollESPN(), et le tick suivant peut repartir sur un fetch frais.
    // forceFresh : utilisé au retour au premier plan (voir onVisible plus bas).
    // Le cache Redis serveur (6-8s) peut sinon renvoyer un score pré-but si un
    // but a été marqué juste avant/pendant que l'app était en arrière-plan et
    // qu'un autre appel (n'importe quel utilisateur) a rafraîchi ce cache
    // juste avant notre retour au premier plan — les 2 polls de rattrapage
    // (immédiat + à 3s) tombaient alors sur le MÊME cache encore valide,
    // laissant le score figé jusqu'au prochain cycle naturel du cache.
    // forceFresh demande au serveur de contourner ce cache pour CET appel
    // précis, sans changer le TTL normal utilisé par tous les autres polls.
    const res = await fetch('/api/fifa-live', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ matches: toTrack, forceFresh }),
      signal:  AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      espnFailStreak++
      if (espnFailStreak >= 3) setEspnWorking(false)
      _runFtSafeguards(allMatches, now, queryClient)
      return
    }

    espnFailStreak = 0
    setEspnWorking(true)
    try { localStorage.setItem('foot_espn_last_poll', String(Date.now())) } catch {}

    // liveData = { [fdMatchId]: { espnEventId, espnSlug, espnStatus, espnClock, espnPeriod, home, away, scorers, stats, fromCache? } }
    const liveData = await res.json()

    for (const [midStr, data] of Object.entries(liveData)) {
      const mid   = Number(midStr)
      const match = allMatches.find(m => m.id === mid)
      if (!match) continue

      const { espnStatus, espnClock, espnPeriod, home, away, scorers, cards, stats, fromCache, homeShootout, awayShootout } = data

      // Mémoriser que ce match est visible dans le scoreboard ESPN (sauf si fromCache)
      if (!fromCache) lastSeenInEspn[mid] = now

      const prevState = getMatchState(mid)
      const matchAge  = (now - new Date(match.utcDate)) / 60_000

      // ── Garde anti-régression "Terminé" ───────────────────────────────────────
      // BUG CORRIGÉ (constat utilisateur : "Terminé" déjà affiché correctement,
      // puis revient à "pas fini" quelques secondes après un retour d'arrière-plan
      // de 5min+, avant de re-confirmer "Terminé"). Cause : au retour au premier
      // plan, plusieurs polls partent en parallèle (immédiat + 3s + watchdog) —
      // un poll démarré AVANT la mise en veille peut être resté en vol pendant
      // toute la durée de la mise en veille (le réseau/JS est suspendu par l'OS,
      // pas juste ralenti) et résoudre APRÈS qu'un poll plus récent ait déjà
      // confirmé le FT. Sa réponse "en cours" est alors périmée (obsolète) et ne
      // doit pas effacer un "Terminé" déjà confirmé.
      // Fix : on compare l'heure de DÉMARRAGE de ce poll (`now`, capturé avant le
      // fetch en haut de _doPollESPN) à `termineAt` (heure de confirmation FT).
      // Si ce poll a démarré AVANT que le FT ait été confirmé → sa donnée est
      // trop vieille → on n'efface PAS le flag ft.
      // N'empêche PAS la correction d'un vrai faux FT (bug de la 21e minute
      // déjà corrigé) : dans ce cas le poll correcteur démarre APRÈS termineAt
      // (le faux FT étant déjà passé), donc ce garde le laisse passer normalement.
      const isStaleFtReversal = prevState.ft === true
        && prevState.termineAt != null
        && now < prevState.termineAt

      // ── Correction statuts FIFA implausibles ─────────────────────────────────
      // FIFA retourne parfois STATUS_EXTRA_TIME/OVERTIME lors de transitions normales
      // (halftime, début 2e MT) — même bug que le faux STATUS_FINAL à la 21e min.
      // Condition : clock < 90' ET matchAge < 90min → impossible d'être en prolongations.
      let safeStatus = espnStatus
      let safePeriod = espnPeriod ?? null
      if (safeStatus === 'STATUS_EXTRA_TIME' || safeStatus === 'STATUS_OVERTIME') {
        const clockMins = parseClockMins(espnClock)
        const etImplausible = (clockMins === null || clockMins < 90) && matchAge < 90
        if (etImplausible) {
          safeStatus = 'STATUS_IN_PROGRESS'
          // Période estimée depuis matchAge (1re MT si < 50min depuis utcDate, 2e MT sinon)
          safePeriod = matchAge < 50 ? 1 : 2
        }
      }

      // Toujours écrire les données ESPN (pour calcMinute + interpolation)
      setEspnData(mid, { espnClock, espnStatus: safeStatus, espnPeriod: safePeriod })

      // ════════════════════════════════════════════════════════════════════
      // CAS 1 : Match EN COURS — utilise safeStatus (statuts corrigés inclus)
      // ════════════════════════════════════════════════════════════════════
      if (
        safeStatus === 'STATUS_IN_PROGRESS' ||
        safeStatus === 'STATUS_HALFTIME'    ||
        safeStatus === 'STATUS_END_PERIOD'  ||
        safeStatus === 'STATUS_EXTRA_TIME'  ||
        safeStatus === 'STATUS_OVERTIME'    ||
        safeStatus === 'STATUS_SHOOTOUT'
      ) {
        if (getLiveState(mid).state !== 'live') setLiveState(mid, 'live')
        delete pendingFt[mid]
        if (!isStaleFtReversal) clearFtFlags(mid)
        markLive(match)

        const prevCache = espnScoresCache[mid]

        // ── Regression guard ─────────────────────────────────────────────────
        // Pendant un match live, on ne descend jamais un score déjà connu.
        // Fix : si deux polls concurrent ont des données différentes (Redis stale
        // vs ESPN frais), on garde le score le plus haut pour éviter la régression
        // qui reset prevHs via la détection VAR et fait rater le but suivant.
        const safeHome = (prevCache?.home != null && home != null)
          ? Math.max(home, prevCache.home)
          : (home ?? prevCache?.home)
        const safeAway = (prevCache?.away != null && away != null)
          ? Math.max(away, prevCache.away)
          : (away ?? prevCache?.away)
        // Scorers : garder la liste la plus longue entre Redis et localStorage
        const safeScorers = (() => {
          const fresh = scorers ?? []
          const cached = prevCache?.scorers ?? []
          return fresh.length >= cached.length ? fresh : cached
        })()
        // Cartons : même garde que les scorers
        const safeCards = (() => {
          const fresh = cards ?? []
          const cached = prevCache?.cards ?? []
          return fresh.length >= cached.length ? fresh : cached
        })()

        // Tirs au but : même garde anti-régression que le score (ESPN uniquement,
        // voir api/fifa-live.js — jamais redescendre un compteur déjà connu).
        const safeHomeShootout = (prevCache?.homeShootout != null && homeShootout != null)
          ? Math.max(homeShootout, prevCache.homeShootout)
          : (homeShootout ?? prevCache?.homeShootout ?? null)
        const safeAwayShootout = (prevCache?.awayShootout != null && awayShootout != null)
          ? Math.max(awayShootout, prevCache.awayShootout)
          : (awayShootout ?? prevCache?.awayShootout ?? null)

        espnScoresCache[mid] = {
          home:         safeHome,
          away:         safeAway,
          scorers:      safeScorers,
          cards:        safeCards,
          stats:        stats   ?? prevCache?.stats   ?? null,
          homeShootout: safeHomeShootout,
          awayShootout: safeAwayShootout,
          espnEventId:  data.espnEventId,
          espnSlug:     data.espnSlug,
        }
      }

      // ── KO détecté (1ère MT, kickoffAt pas encore connu) ──
      if (
        safeStatus === 'STATUS_IN_PROGRESS' &&
        (safePeriod ?? 1) === 1 &&
        !prevState.kickoffAt
      ) {
        const mins = parseClockMins(espnClock)
        if (mins != null && mins > 0) setKickoffAt(mid, now - mins * 60_000)
      }

      // ── HT détecté ──
      // Poser pausedAt=now serait faux si on détecte la mi-temps en retard
      // (app fermée/arrière-plan pendant le vrai coup de sifflet) : ça ferait
      // repartir "reprise dans 15min" de zéro alors que la pause est peut-être
      // déjà bien avancée (bug signalé). Correctif — PAS une moyenne devinée :
      // ESPN GÈLE son horloge (espnClock) sur la minute réelle atteinte au
      // coup de sifflet ("45:00", ou "45:00+3:00" s'il y a eu 3min d'arrêts de
      // jeu) et la maintient identique tant que dure la pause — qu'on
      // l'observe à l'instant précis ou 10min plus tard, la valeur lue est la
      // MÊME donnée réelle. On calcule donc pausedAt = kickoff + cette vraie
      // durée jouée, pas une estimation à peu près.
      // Seul residuel non garanti : le kickoff de référence lui-même.
      //   1. prevState.kickoffAt (confirmé par ESPN) si l'app a vu le coup
      //      d'envoi à un moment donné — fiable.
      //   2. match.utcDate (heure programmée FD.org) sinon, TOUJOURS
      //      disponible même si l'app n'a jamais tourné avant cet instant —
      //      peut différer de quelques minutes du coup d'envoi réel (retard
      //      terrain, cérémonie...), seule imprécision restante.
      // Si l'horloge ESPN est vide/inexploitable (rare), repli sur 47min
      // (durée moyenne 45min + arrêts de jeu) plutôt que de ne rien poser.
      if (espnStatus === 'STATUS_HALFTIME' && !prevState.pausedAt) {
        const koReference   = prevState.kickoffAt ?? new Date(match.utcDate).getTime()
        const realHalfMins  = parseClockMins(espnClock)
        const halfMins      = (realHalfMins != null && realHalfMins > 0) ? realHalfMins : 47
        const estimatedPausedAt = Math.min(now, koReference + halfMins * 60_000)
        trackMatchState({ ...match, status: 'PAUSED' }, estimatedPausedAt)
      }

      // ── 2H détecté ──
      if (
        safeStatus === 'STATUS_IN_PROGRESS' &&
        (safePeriod ?? 1) === 2 &&
        prevState.pausedAt &&
        !prevState.half2Start
      ) {
        const mins = parseClockMins(espnClock)
        // mins - 46 : la 2ème MT commence à 46', donc half2Start = now - (mins-46)min en arrière
        // (mins-45 donnait un décalage systématique de +1')
        if (mins != null) setHalf2Start(mid, now - Math.max(0, mins - 46) * 60_000)
      }

      // ════════════════════════════════════════════════════════════════════
      // CAS 2 : FT / ANNULÉ / REPORTÉ
      // STATUS_FINAL_AET (après prolongations) et STATUS_FINAL_PEN (après tirs au
      // but) sont les statuts réels renvoyés par ESPN pour un match de phase à
      // élimination directe qui ne se termine pas en 90min — vérifiés sur de
      // vrais matchs (finale CM 2022, CWC 2025). Sans eux, un match qui va en
      // prolongations/tab n'atteignait JAMAIS ce bloc (ni CAS 1, qui ne les
      // reconnaît pas non plus) : confirmFt() n'était jamais appelé par ce
      // chemin, on dépendait uniquement des garde-fous de secours.
      // ════════════════════════════════════════════════════════════════════
      if (
        espnStatus === 'STATUS_FINAL'     ||
        espnStatus === 'STATUS_FULL_TIME' ||
        espnStatus === 'STATUS_FINAL_AET' ||
        espnStatus === 'STATUS_FINAL_PEN' ||
        espnStatus === 'STATUS_POSTPONED' ||
        espnStatus === 'STATUS_CANCELED'
      ) {
        if (!isTrackedLive(mid)) continue
        if (getLiveState(mid).state === 'ended') continue

        const prevCache = espnScoresCache[mid]
        const prevStats = prevCache?.stats ?? null

        // Toujours mettre à jour le score (le but est peut-être dans ce poll)
        // Regression guard : on ne descend jamais un score déjà connu
        const ftSafeHome = (prevCache?.home != null && home != null) ? Math.max(home, prevCache.home) : (home ?? prevCache?.home)
        const ftSafeAway = (prevCache?.away != null && away != null) ? Math.max(away, prevCache.away) : (away ?? prevCache?.away)
        const ftScorers  = (() => { const f = scorers ?? []; const c = prevCache?.scorers ?? []; return f.length >= c.length ? f : c })()
        const ftCards    = (() => { const f = cards   ?? []; const c = prevCache?.cards   ?? []; return f.length >= c.length ? f : c })()
        // Même garde anti-régression pour le score des tab (dernier tir décisif
        // pouvant arriver dans le même poll que la confirmation STATUS_FINAL_PEN).
        const ftSafeHomeShootout = (prevCache?.homeShootout != null && homeShootout != null)
          ? Math.max(homeShootout, prevCache.homeShootout)
          : (homeShootout ?? prevCache?.homeShootout ?? null)
        const ftSafeAwayShootout = (prevCache?.awayShootout != null && awayShootout != null)
          ? Math.max(awayShootout, prevCache.awayShootout)
          : (awayShootout ?? prevCache?.awayShootout ?? null)
        espnScoresCache[mid] = {
          ...(prevCache ?? {}),
          home:         ftSafeHome,
          away:         ftSafeAway,
          scorers:      ftScorers,
          cards:        ftCards,
          stats:        stats   ?? prevStats,
          homeShootout: ftSafeHomeShootout,
          awayShootout: ftSafeAwayShootout,
          espnEventId:  data.espnEventId,
          espnSlug:     data.espnSlug,
        }

        if (espnStatus === 'STATUS_POSTPONED' || espnStatus === 'STATUS_CANCELED') {
          setLiveState(mid, 'ended', { endedAt: now })
          setTimeout(() => { markEnded(mid); clearMatchState(mid) }, 5 * 60_000)
          continue
        }

        // ── Garde : score à égalité en phase à élimination directe ──────────────
        // Un match à élimination directe (8es de finale et plus) ne peut JAMAIS
        // se terminer à égalité après les prolongations : la séance de tirs au
        // but est obligatoire. Si ESPN envoie un simple STATUS_FINAL/FULL_TIME
        // (pas STATUS_FINAL_AET ni STATUS_FINAL_PEN, qui restent des signaux de
        // fin réelle) alors que le score fusionné est encore à égalité, ce n'est
        // pas un vrai FT — ESPN n'a pas encore confirmé le passage aux tab (bug
        // signalé : le match affichait "Terminé" 1-1 juste après le 120e, sans
        // jamais montrer "T.A.B."). On force le passage en tab plutôt que de
        // confirmer un FT qu'on sait impossible.
        const isKnockout = KNOCKOUT_STAGES.includes(match.stage)
        const scoresStillTied = ftSafeHome != null && ftSafeAway != null && ftSafeHome === ftSafeAway
        if (
          (espnStatus === 'STATUS_FINAL' || espnStatus === 'STATUS_FULL_TIME') &&
          isKnockout && scoresStillTied
        ) {
          delete pendingFt[mid]
          markLive(match)
          if (!isStaleFtReversal) clearFtFlags(mid)
          setEspnData(mid, { espnClock: '120:00', espnStatus: 'STATUS_SHOOTOUT', espnPeriod: 5 })
          continue
        }

        // DÉTECTION FT : horloge >= 85min OU match vieux de >= 85min depuis le KO prévu.
        // Source FIFA : MatchTime='FT' → fifaToClock renvoie '' → mins=null.
        //   Dans ce cas, on se rabat sur l'âge du match (utcDate + 85min).
        // ⚠️ isFifaSource ne lève PAS le garde à lui seul : FIFA peut retourner
        //   MatchStatus=3/Period=8 lors d'une transition (but, VAR) même à la 21ème min.
        const mins = parseClockMins(espnClock)
        // matchAge déjà calculé en haut du bloc (réutilisé ici)
        // timePlausible : horloge >= 85min OU match vieux >= 85min depuis le KO prévu
        // ⚠️ ne pas bypass avec isFifaSource seul : FIFA peut retourner Status=3/Period=8
        //    lors de transitions (but, VAR) même à la 21ème min → faux FT.
        const timePlausible = (mins !== null && mins >= 85) || matchAge >= 85

        if (!timePlausible) {
          delete pendingFt[mid]
          markLive(match)
          if (!isStaleFtReversal) clearFtFlags(mid)
          // Override espnStatus → STATUS_IN_PROGRESS pour que calcMinute ne retourne
          // pas null (STATUS_FINAL → null). Si espnClock est vide, on dérive depuis utcDate.
          const ftMins = espnClock ? parseClockMins(espnClock) : null
          const safeClock = ftMins != null && ftMins > 0
            ? espnClock
            : `${Math.max(1, Math.floor((now - new Date(match.utcDate)) / 60_000))}:00`
          // Corriger aussi espnPeriod : espnPeriod peut valoir 3 si FIFA envoie Period=4
          // (faux STATUS_EXTRA_TIME) en même temps que Status=3 (faux FT) → "Prolongations".
          // Estimation depuis matchAge : < 50min = 1ère MT, ≥ 50min = 2ème MT.
          const implausiblePeriod = matchAge < 50 ? 1 : 2
          setEspnData(mid, { espnClock: safeClock, espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: implausiblePeriod })
          // Initialiser kickoffAt si absent (effacé après clearMatchState post-FT)
          const safeMins = parseClockMins(safeClock)
          if (safeMins) setKickoffAt(mid, now - safeMins * 60_000)
          continue
        }

        const prevScore    = prevCache ? `${prevCache.home}-${prevCache.away}` : null
        const currentScore = `${home}-${away}`

        if (prevScore !== null && prevScore !== currentScore) {
          // But tardif dans le même poll → rester live
          delete pendingFt[mid]
          markLive(match)
          if (!isStaleFtReversal) clearFtFlags(mid)
          continue
        }

        // STATUS_FINAL + score inchangé + horloge >= 85 → FT confirmé
        delete pendingFt[mid]
        confirmFt(match, now, queryClient)
      }

      // ── FALLBACK J-1 : STATUS_SCHEDULED mais FD.org sait que c'est live ──
      if (
        espnStatus === 'STATUS_SCHEDULED' &&
        (match.status === 'IN_PLAY' || match.status === 'PAUSED' || isTrackedLive(mid))
      ) {
        if (!espnScoresCache[mid]) {
          espnScoresCache[mid] = { home: null, away: null, scorers: [], stats: null }
        }
        if (!espnScoresCache[mid].espnEventId) {
          espnScoresCache[mid] = {
            ...espnScoresCache[mid],
            espnEventId: data.espnEventId,
            espnSlug:    data.espnSlug,
          }
        }
        // FD.org confirme IN_PLAY mais FIFA/ESPN retourne encore SCHEDULED
        // (lag FIFA ou fuzzy-match partiel) → marquer comme live quand même
        if (match.status === 'IN_PLAY' || match.status === 'PAUSED') {
          markLive(match)
        }
      }
    }

    // ── FD.org fallback global : match IN_PLAY selon FD.org mais absent de liveData ──
    // Peut arriver si fuzzy-match FIFA échoue côté serveur ou si FIFA API lag.
    // isEspnWorking()=true bloque useLiveMatches → ce fallback prend le relais.
    for (const match of toTrack) {
      const mid = match.id
      if (match.status !== 'IN_PLAY' && match.status !== 'PAUSED') continue
      if (isTrackedLive(mid)) continue          // déjà suivi → ok
      if (getLiveState(mid).state === 'ended') continue
      // Initialiser avec le score FD.org si disponible (visible dans le panel)
      if (!espnScoresCache[mid]) {
        espnScoresCache[mid] = {
          home:    match.score?.fullTime?.home ?? null,
          away:    match.score?.fullTime?.away ?? null,
          scorers: [],
          stats:   null,
        }
      }
      console.log(`[useLiveMinute] FD.org fallback → markLive match ${mid} (${match.homeTeam?.name} vs ${match.awayTeam?.name})`)
      markLive(match)
    }
  } catch (err) {
    console.warn('[useLiveMinute] /api/fifa-live erreur :', err.message)
    espnFailStreak++
    if (espnFailStreak >= 3) setEspnWorking(false)
  }

  // Safeguards après traitement ESPN
  _runFtSafeguards(allMatches, now, queryClient)

  // Pousser les scores dans React Query
  queryClient.setQueryData(['espnScores'], { ...espnScoresCache })
  try { localStorage.setItem('espn_scores_cache', JSON.stringify(espnScoresCache)) } catch {}
}

// ── Wrapper avec poll lock ─────────────────────────────────────────────────────
// Empêche deux appels simultanés à _doPollESPN (race condition visibilitychange + Worker).
// Si un poll est déjà en cours, on mémorise qu'un nouveau poll est souhaité (_pollQueued)
// et on le lancera dès que le poll courant se termine.
let _pollQueuedForceFresh = false

async function pollESPN(matches, queryClient, forceFresh = false) {
  if (_pollInProgress) {
    // Verrou fantôme : un forceFresh (retour au premier plan) qui tombe sur un
    // verrou posé il y a plus de STALE_LOCK_MS n'est presque sûrement pas un
    // poll légitime encore en cours (10s max normalement) mais un fetch gelé
    // par la suspension réseau iOS pendant que l'app était en arrière-plan. On
    // ne veut pas attendre qu'il se débloque tout seul (jusqu'à 10s de plus,
    // potentiellement davantage si les timers étaient eux aussi suspendus) —
    // on force le nouveau poll immédiatement plutôt que de le mettre en file.
    if (forceFresh && Date.now() - _pollStartedAt > STALE_LOCK_MS) {
      console.warn('[useLiveMinute] verrou fantôme détecté (>', STALE_LOCK_MS, 'ms) → poll forcé sans attendre')
      _pollInProgress = false
    } else {
      _pollQueued = true
      if (forceFresh) _pollQueuedForceFresh = true
      return
    }
  }
  _pollInProgress = true
  _pollStartedAt  = Date.now()
  _pollQueued     = false
  try {
    await _doPollESPN(matches, queryClient, forceFresh)
  } finally {
    _pollInProgress = false
    // Si un poll était en attente pendant qu'on était occupé, on le lance maintenant
    if (_pollQueued) {
      _pollQueued = false
      const queuedForceFresh = _pollQueuedForceFresh
      _pollQueuedForceFresh  = false
      // Léger délai pour laisser React traiter le setQueryData précédent
      setTimeout(() => pollESPN(matches, queryClient, queuedForceFresh), 150)
    }
  }
}

// ─────────────────────────────────────────────
// api-football.com — couche de fallback
// ─────────────────────────────────────────────

function isInPollingWindow(match, trackedIds) {
  if (quotaRemaining < 5) return false

  const state   = getMatchState(match.id)
  const elapsed = (Date.now() - new Date(match.utcDate)) / 60000

  if (elapsed >= 0 && elapsed <= 90 && !state.kickoffAt) return true
  if (!trackedIds.has(String(match.id))) return false

  if (state.kickoffAt && !state.pausedAt) {
    const realElapsed = (Date.now() - state.kickoffAt) / 60000
    if (realElapsed >= 44 && realElapsed <= 55) return true
  }

  if (state.pausedAt && !state.half2Start) {
    const pause = (Date.now() - state.pausedAt) / 60000
    if (pause >= 13 && pause <= 30) return true
  }

  if (state.half2Start) {
    const half2 = (Date.now() - state.half2Start) / 60000
    if (half2 >= 44 && half2 <= 105) return true
  }

  return false
}

function findMatch(fixture, matches) {
  const apiHome = normalize(fixture.teams?.home?.name ?? '')
  const apiAway = normalize(fixture.teams?.away?.name ?? '')
  if (!apiHome || !apiAway) return null

  return matches.find(m => {
    const h = normalize(m.homeTeam?.name ?? m.homeTeam?.shortName ?? '')
    const a = normalize(m.awayTeam?.name ?? m.awayTeam?.shortName ?? '')
    return fuzzyTeam(h, apiHome) && fuzzyTeam(a, apiAway)
  }) ?? null
}

async function pollApiFootball(matches, queryClient) {
  try {
    const res = await fetch('/apifootball?live=all')
    if (!res.ok) {
      console.warn('[useLiveMinute] api-football réponse non-OK :', res.status)
      return
    }

    const remaining = res.headers.get('x-quota-remaining')
    if (remaining !== null) {
      quotaRemaining = parseInt(remaining, 10)
      if (quotaRemaining < 10) {
        console.warn(`[useLiveMinute] Quota api-football bas : ${quotaRemaining} req restantes`)
      }
    }

    const json     = await res.json()
    const fixtures = json.response ?? []
    let koDetected = false

    for (const fixture of fixtures) {
      const match = findMatch(fixture, matches)
      if (!match) continue

      const status     = fixture.fixture?.status?.short
      const apiElapsed = fixture.fixture?.status?.elapsed
      const state      = getMatchState(match.id)

      // Fenêtre 0 : KO détecté
      if (status === '1H') {
        if (!state.kickoffAt && apiElapsed != null) {
          setKickoffAt(match.id, Date.now() - apiElapsed * 60_000)
          setLiveState(match.id, 'live')
          markLive(match)
          koDetected = true
        }
      }

      // Fenêtre 1 : HT détecté
      if (status === 'HT' && !state.pausedAt) {
        trackMatchState({ ...match, status: 'PAUSED' })
      }

      // Fenêtre 2 : 2H détecté
      if (status === '2H') {
        if (apiElapsed != null && apiElapsed > 45 && apiElapsed < 90) {
          const half2Start = Date.now() - (apiElapsed - 46) * 60_000
          setHalf2Start(match.id, half2Start)
        } else if (!state.half2Start) {
          trackMatchState({ ...match, status: 'IN_PLAY' })
        }
      }

      // Fenêtre 3 : FT détecté
      if (status === 'FT' || status === 'AET' || status === 'PEN') {
        const ls = getLiveState(match.id)
        if (ls.state === 'ended') continue  // déjà géré
        if (!isTrackedLive(match.id)) continue

        const now = Date.now()
        setLiveState(match.id, 'ended', { endedAt: now })

        try {
          const currentState = getMatchState(match.id)
          localStorage.setItem(`foot_ms_${match.id}`, JSON.stringify({
            ...currentState,
            ft:        true,
            termineAt: now,
          }))
        } catch {}

        queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
          // Même fix que confirmFt() (couche ESPN primaire) : le classement
          // n'était invalidé nulle part, y compris sur ce chemin de secours
          // api-football (fenêtres critiques uniquement, rare mais possible
          // si ESPN est down au moment du FT).
          if (match.competition?.code) {
            queryClient.invalidateQueries({ queryKey: ['standings', match.competition.code] })
            queryClient.invalidateQueries({ queryKey: ['teamForm2', match.competition.code] })
            queryClient.invalidateQueries({ queryKey: ['scorers', match.competition.code] })
          }
        }, 2_000)
        if (match.competition?.code) {
          try { localStorage.removeItem(`matches_${match.competition.code}_FINISHED`) } catch {}
        }

        const codeForEviction = match.competition?.code
        setTimeout(() => {
          markEnded(match.id)
          clearMatchState(match.id, { preserveEnded: true })
          queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
          if (codeForEviction) {
            queryClient.invalidateQueries({ queryKey: ['matches', codeForEviction, 'FINISHED'] })
            queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
            queryClient.invalidateQueries({ queryKey: ['standings', codeForEviction] })
            queryClient.invalidateQueries({ queryKey: ['teamForm2', codeForEviction] })
            queryClient.invalidateQueries({ queryKey: ['scorers', codeForEviction] })
          }
        }, 5 * 60_000)
      }
    }

    if (koDetected) {
      const liveState = queryClient.getQueryState(['liveMatches'])
      const liveAge   = Date.now() - (liveState?.dataUpdatedAt ?? 0)
      if (liveAge > 30_000) {
        queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
      }
    }
  } catch (err) {
    console.warn('[useLiveMinute] Erreur polling api-football :', err.message)
  }
}

// ── Invalidation des stats live "à la demande" (fifaStats/espnSummary/aflStats) ──
// Ces 3 hooks (MatchModal.jsx / useApiFootball.js) sont des useQuery indépendants
// avec leur propre refetchInterval (45-90s) — contrairement au score (espnScores),
// ils ne font PAS partie du poll coordonné de useLiveMinute et n'étaient donc PAS
// concernés par le fix cold-start/forceFresh ci-dessus : à l'ouverture de l'app en
// plein match, le score se mettait à jour immédiatement mais les stats (possession,
// tirs, corners) pouvaient rester vides jusqu'à leur prochain cycle (jusqu'à 90s).
// On force ici un refetch immédiat, même logique que pour le score.
function invalidateLiveStatsQueries(queryClient) {
  queryClient.invalidateQueries({
    predicate: q =>
      Array.isArray(q.queryKey) &&
      ['fifaStats', 'espnSummary', 'aflStats'].includes(q.queryKey[0]),
  })
}

// ─────────────────────────────────────────────
// Hook principal
// ─────────────────────────────────────────────

export function useLiveMinute(matches) {
  const queryClient  = useQueryClient()
  const matchesRef   = useRef(matches)
  matchesRef.current = matches

  // ── Seed immédiat depuis localStorage au montage ──
  // Évite le flash "stats vides" pendant le 1er poll réseau (~1-2s)
  useEffect(() => {
    if (Object.keys(espnScoresCache).length > 0) {
      queryClient.setQueryData(['espnScores'], { ...espnScoresCache })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── ESPN : Web Worker timer (non throttlé même en arrière-plan) ──
  useEffect(() => {
    const tick = () => pollESPN(matchesRef.current, queryClient)
    tick()

    let worker = null
    let fallbackId = null
    const lastTickAt = { t: Date.now() }

    try {
      worker = new EspnTimerWorker()
      worker.onmessage = () => { lastTickAt.t = Date.now(); tick() }
    } catch {
      fallbackId = setInterval(tick, 15_000)
    }

    // Watchdog : si le Worker se bloque, continuer depuis le main thread
    // ⚠️ Seuil relevé à 20s (le Worker tique maintenant lui-même toutes les
    // 10s, voir espnTimerWorker.js) : un seuil égal à l'intervalle normal du
    // Worker déclenchait ce watchdog sur du simple jitter (pas un vrai
    // blocage), doublant inutilement les polls — donc les commandes Redis —
    // exactement ce qu'on cherche à réduire (quota Upstash dépassé).
    const watchdogId = setInterval(() => {
      if (Date.now() - lastTickAt.t > 20_000) tick()
    }, 20_000)

    return () => {
      worker?.terminate()
      if (fallbackId) clearInterval(fallbackId)
      clearInterval(watchdogId)
    }
  }, [queryClient])

  // ── api-football.com : intervalle 60s (fallback) ──
  const apiFbRef = useRef(null)
  useEffect(() => {
    const tick = async () => {
      const current    = matchesRef.current
      const trackedIds = getTrackedMatches()
      const needsPoll  = current.some(m => isInPollingWindow(m, trackedIds))
      if (needsPoll) {
        await pollApiFootball(current, queryClient)
      }
    }
    apiFbRef.current = tick
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [queryClient])

  // Poll api-football immédiat si un match passe IN_PLAY sans kickoffAt connu
  const knownInPlayRef = useRef(new Set())
  // Re-poll ESPN dès que matches[] se peuple (cold start PWA : premier poll était sur tableau vide)
  const prevMatchesLen = useRef(0)
  useEffect(() => {
    const newMatches = matches.filter(m =>
      (m.status === 'IN_PLAY' || m.status === 'PAUSED') &&
      !getMatchState(m.id).kickoffAt &&
      !knownInPlayRef.current.has(m.id)
    )
    newMatches.forEach(m => knownInPlayRef.current.add(m.id))
    if (newMatches.length > 0 && apiFbRef.current) {
      apiFbRef.current()
    }
    // Cold start : matches[] vient de se charger (0 → N) → re-poll ESPN immédiatement
    // (même sans live en cours — pour détecter les pending kickoffs au bon moment)
    if (prevMatchesLen.current === 0 && matches.length > 0) {
      pollESPN(matches, queryClient)
      invalidateLiveStatsQueries(queryClient)
    }
    prevMatchesLen.current = matches.length
  }, [matches, queryClient])

  // ── Ancrage précoce de half2Start dès que FD.org confirme la reprise ──
  // ⚠️ BUG CORRIGÉ (constat utilisateur : "à la reprise de la mi-temps j'ai
  // genre 5min d'avance sur le temps", ex. 54' affiché alors que le vrai jeu
  // venait tout juste de reprendre à 46') : tant qu'aucun signal PRÉCIS
  // (ESPN period=2 ou api-football '2H' avec l'horloge exacte, voir plus haut
  // dans ce fichier) n'a positionné half2Start, calcMinute() se rabat sur
  // l'heuristique de matchUtils.js qui suppose une pause EXACTEMENT DE 15MIN
  // (pausedAt + 15min = coup d'envoi de la 2e MT). Si la vraie pause dure plus
  // longtemps (fréquent : mi-temps CM avec animation/VAR, souvent 16-20min),
  // dès que FD.org bascule IN_PLAY (confirmant que le jeu a réellement repris)
  // cette heuristique calcule le temps écoulé en 2e MT à partir d'une pause
  // supposée plus courte qu'en réalité → elle "rattrape" l'écart d'un coup et
  // affiche une minute en avance sur le vrai jeu, le temps qu'ESPN/api-football
  // arrivent avec l'horloge précise.
  // Fix : dès que FD.org (déjà réel, pas une supposition) confirme IN_PLAY
  // après une pause connue, on ancre half2Start à CET INSTANT (minute 46,
  // hypothèse la plus prudente : le jeu vient tout juste de reprendre) plutôt
  // que de laisser matchUtils.js deviner depuis une durée de pause fixe. Cet
  // ancrage précoce est ensuite écrasé par la détection ESPN/api-football plus
  // précise dès qu'elle arrive (setHalf2Start n'a pas de garde anti-écrasement).
  useEffect(() => {
    for (const match of matches) {
      if (match.status !== 'IN_PLAY') continue
      const state = getMatchState(match.id)
      if (state.pausedAt && !state.half2Start) {
        setHalf2Start(match.id, Date.now())
      }
    }
  }, [matches])

  // ── Cold start réseau pas prêt (iOS PWA) ──
  // Si le réseau est offline au montage du hook → attendre l'event 'online'
  // (iOS peut mettre 1-3s à établir la connexion après ouverture de la PWA)
  useEffect(() => {
    if (navigator.onLine) return
    const handler = () => pollESPN(matchesRef.current, queryClient)
    window.addEventListener('online', handler, { once: true })
    return () => window.removeEventListener('online', handler)
  }, [queryClient])

  // ── Repoll immédiat au retour sur l'app (PWA / Safari background) ──
  // iOS throttle les workers + timers en arrière-plan → score figé.
  // Dès que la page redevient visible, on force un poll ESPN immédiat
  // sans attendre le prochain tick (jusqu'à 15s de retard sinon).
  useEffect(() => {
    // Anti-doublon : sur iOS, 'visibilitychange' et 'focus'/'pageshow' peuvent
    // se déclencher quasi simultanément pour le même retour au premier plan
    // (on écoute les 3 events — voir plus bas — car 'visibilitychange' seul
    // n'est pas toujours fiable pour détecter la reprise après une longue
    // mise en arrière-plan iOS/PWA, cause plausible du score qui restait figé
    // indéfiniment plutôt que juste en retard de quelques secondes).
    let lastRunAt = 0
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRunAt < 1_000) return
      lastRunAt = Date.now()
      // Marquer les données ESPN comme périmées : empêche l'interpolation stale
      window.__espnNeedsRefresh = Date.now()
      // Stats live (possession/tirs/corners) — même fix que le score : ne pas
      // attendre leur cycle de refetch propre (jusqu'à 90s) après un retour au premier plan.
      // ⚠️ L'invalidation seule ne suffit pas (constat utilisateur : stats figées
      // après un passage en arrière-plan) : invalidateQueries relance bien un
      // fetch côté client, mais /api/fifa-lineups et /api/apifootball ont leur
      // propre cache Redis serveur (120s / 60s) — un refetch qui tombe dans
      // cette fenêtre reçoit la MÊME donnée périmée. Cette fenêtre (8s, le temps
      // du poll immédiat + du 2ème poll à 3s ci-dessous) dit aux queryFn stats
      // de contourner ce cache serveur via forceFresh=1 (voir useFifaStats /
      // useAflLiveStats et le paramètre forceFresh côté API).
      window.__liveStatsForceFreshUntil = Date.now() + 8_000
      invalidateLiveStatsQueries(queryClient)

      if (!navigator.onLine) {
        window.addEventListener('online', () => pollESPN(matchesRef.current, queryClient, true), { once: true })
        return
      }

      // Poll immédiat — le lock garantit qu'un tick Worker concurrent est mis en file
      // d'attente plutôt que de créer une race condition avec des données Redis décalées.
      // forceFresh=true : contourne le cache Redis serveur pour ce poll précis (voir
      // commentaire détaillé dans _doPollESPN).
      await pollESPN(matchesRef.current, queryClient, true)

      // 2ème poll après 3s pour rattraper les buts marqués pendant l'arrière-plan iOS.
      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          pollESPN(matchesRef.current, queryClient, true)
        }
      }, 3_000)
      const now = Date.now()
      // Invalider todayMatches si données > 2min
      const todayState = queryClient.getQueryState(['todayMatches'])
      if (now - (todayState?.dataUpdatedAt ?? 0) > 120_000) {
        queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
      }
      // Invalider TOUS les résultats FINISHED (toutes compétitions) si > 2min
      // (était hardcodé WC uniquement avant — fix pour Ligue 1, PL, etc.)
      queryClient.invalidateQueries({
        predicate: q =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === 'matches' &&
          q.queryKey[2] === 'FINISHED' &&
          (now - (q.state.dataUpdatedAt ?? 0)) > 120_000,
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [queryClient])

  // ── Filet de sécurité indépendant des events DOM ──
  // Bug WebKit documenté de longue date : sur iOS, visibilitychange (et
  // parfois focus/pageshow) ne se déclenche pas toujours de façon fiable pour
  // une PWA en mode standalone mise en arrière-plan brièvement via le
  // multitâche (contrairement à un verrouillage d'écran, plus fiable) — ce
  // qui correspond exactement au bug signalé : retour sur l'app après <5min
  // en arrière-plan, score/stats live pas rafraîchis, sans qu'aucun des 3
  // listeners ci-dessus ne se soit déclenché.
  // Ce filet ne dépend d'AUCUN event : un setInterval qui mesure l'écart RÉEL
  // entre deux tops (au lieu de faire confiance à l'intervalle programmé) se
  // détecte lui-même suspendu — si le JS était gelé (app en arrière-plan), le
  // prochain tick arrive bien après les 2s programmées dès que l'app redevient
  // active, ce qui EST la preuve qu'on sort d'une suspension, peu importe
  // qu'un event iOS se soit déclenché ou non.
  useEffect(() => {
    let lastAlive = Date.now()
    const GAP_THRESHOLD_MS = 4_000  // > intervalle programmé (2s) : suspension probable
    const id = setInterval(() => {
      const now = Date.now()
      const gap = now - lastAlive
      lastAlive = now
      if (gap > GAP_THRESHOLD_MS) {
        window.__espnNeedsRefresh = now
        // Même contournement du cache Redis stats que dans onVisible ci-dessus
        // (ce filet se déclenche justement quand visibilitychange n'a pas fired).
        window.__liveStatsForceFreshUntil = now + 8_000
        invalidateLiveStatsQueries(queryClient)
        pollESPN(matchesRef.current, queryClient, true)
      }
    }, 2_000)
    return () => clearInterval(id)
  }, [queryClient])

  // Recalibration manuelle
  // ─ Force un refetch FD.org pour récupérer les statuts IN_PLAY à jour,
  //   puis repoll ESPN → réaffiche les widgets live même après vidage de cache.
  // ─ Sans impact si pas de match en cours (refetch FD.org silencieux via cache Redis 2min).
  const recalibrate = useRef(async () => {
    clearAllMatchStates()
    // 1. Forcer un refetch FD.org → matchesRef se met à jour avec statuts IN_PLAY réels
    try { await queryClient.refetchQueries({ queryKey: ['todayMatches'] }) } catch {}
    // 2. Attendre un tick que matchesRef.current soit mis à jour par le re-render React
    await new Promise(r => setTimeout(r, 200))
    // 3. Repoll ESPN + api-football avec les données fraîches
    await Promise.all([
      pollESPN(matchesRef.current, queryClient),
      pollApiFootball(matchesRef.current, queryClient),
    ])
  })

  return { recalibrate: recalibrate.current }
}
