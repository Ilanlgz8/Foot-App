// Store localStorage pour "Mes Paris" — paris fictifs, aucun argent réel.
// Même famille que matchStateTracker.js/notify.js : fonctions pures sur
// localStorage, pas un hook (consommé directement par pages/MesParis.jsx,
// qui gère son propre state React autour de ces appels).
//
// Solde/historique 100% local à l'appareil (décision utilisateur explicite,
// pas de compte/backend — voir CLAUDE.md, aucun système d'auth dans l'app) :
// ne suit pas d'un appareil à l'autre, mais zéro backend à maintenir, zéro
// identifiant à inventer.
import { matchOutcome, finalScore } from './matchUtils'

const BALANCE_KEY = 'foot_bets_balance'
const BETS_KEY = 'foot_bets_history'
export const STARTING_BALANCE = 10

function readBalance() {
  try {
    const raw = localStorage.getItem(BALANCE_KEY)
    if (raw != null) {
      const v = parseFloat(raw)
      if (!isNaN(v)) return v
    }
  } catch {}
  return STARTING_BALANCE
}

function writeBalance(v) {
  try { localStorage.setItem(BALANCE_KEY, String(Math.round(v * 100) / 100)) } catch {}
}

// Initialise le solde à STARTING_BALANCE une seule fois, au tout premier
// appel (jamais réécrit ensuite tant qu'un pari n'a pas été placé/réglé).
export function getBalance() {
  try {
    if (localStorage.getItem(BALANCE_KEY) == null) writeBalance(STARTING_BALANCE)
  } catch {}
  return readBalance()
}

function readBets() {
  try {
    const raw = JSON.parse(localStorage.getItem(BETS_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeBets(bets) {
  try { localStorage.setItem(BETS_KEY, JSON.stringify(bets)) } catch {}
}

export function getBets() {
  return readBets()
}

/**
 * Place un pari (simple ou combiné).
 * picks: [{ matchId, homeTeam, awayTeam, competition, market: '1N2'|'TOTAL',
 *           key: 'home'|'draw'|'away'|'OVER'|'UNDER', label, odd, line? }]
 * Un seul pick par matchId dans un même bulletin (la page appelante garde
 * cette contrainte — voir MesParis.jsx, remplace la sélection précédente
 * pour ce match plutôt que d'en ajouter une 2e incohérente).
 */
export function placeBet(picks, stake) {
  if (!Array.isArray(picks) || picks.length === 0) {
    return { ok: false, error: 'Aucune sélection' }
  }
  const balance = getBalance()
  const stakeNum = Number(stake)
  if (!(stakeNum > 0)) return { ok: false, error: 'Mise invalide' }
  if (stakeNum > balance) return { ok: false, error: 'Solde fictif insuffisant' }

  const combinedOdd = picks.reduce((acc, p) => acc * p.odd, 1)
  const bet = {
    id: `bet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    picks,
    stake: stakeNum,
    combinedOdd,
    status: 'pending',
    placedAt: Date.now(),
  }
  writeBalance(balance - stakeNum)
  writeBets([bet, ...readBets()])
  return { ok: true, bet }
}

// Résout UN pick — jamais de résultat deviné : renvoie null si le score du
// match n'est pas encore exploitable (mêmes garde-fous que le reste de
// l'app, voir finalScore()/matchOutcome() dans matchUtils.js — gèrent déjà
// correctement le cas tirs au but pour le marché 1N2).
function evaluatePick(pick, match) {
  if (pick.market === '1N2') {
    const outcome = matchOutcome(match)
    if (outcome == null) return null
    return outcome === pick.key
  }
  if (pick.market === 'TOTAL') {
    const fs = finalScore(match.score)
    if (fs.home == null || fs.away == null) return null
    const total = fs.home + fs.away
    if (pick.key === 'OVER') return total > pick.line
    if (pick.key === 'UNDER') return total < pick.line
    return null
  }
  // Double chance — recombinaison du résultat final (matchOutcome, déjà
  // fiable sur les tirs au but) : '1X' gagne si dom. ou nul, '12' si pas de
  // nul, 'X2' si ext. ou nul.
  if (pick.market === 'DC') {
    const outcome = matchOutcome(match)
    if (outcome == null) return null
    if (pick.key === '1X') return outcome === 'home' || outcome === 'draw'
    if (pick.key === '12') return outcome === 'home' || outcome === 'away'
    if (pick.key === 'X2') return outcome === 'away' || outcome === 'draw'
    return null
  }
  // BTTS — les 2 équipes ont marqué au moins 1 but (score du temps
  // réglementaire, mêmes garde-fous que finalScore()).
  if (pick.market === 'BTTS') {
    const fs = finalScore(match.score)
    if (fs.home == null || fs.away == null) return null
    const bothScored = fs.home > 0 && fs.away > 0
    if (pick.key === 'YES') return bothScored
    if (pick.key === 'NO') return !bothScored
    return null
  }
  // Score exact — key au format "H-A" (ex. "2-1"), comparé au score final
  // exact (120min exclu, tirs au but exclus — mêmes garde-fous que
  // finalScore()).
  if (pick.market === 'SCORE_EXACT') {
    const fs = finalScore(match.score)
    if (fs.home == null || fs.away == null) return null
    return pick.key === `${fs.home}-${fs.away}`
  }
  // Écart de buts — même découpage que goalMarginProbabilities (calcProno.js) :
  // CLOSE = écart de 0 ou 1 but, HOME_BIG/AWAY_BIG = 2 buts d'écart ou plus.
  if (pick.market === 'MARGIN') {
    const fs = finalScore(match.score)
    if (fs.home == null || fs.away == null) return null
    const diff = fs.home - fs.away
    if (pick.key === 'CLOSE')    return Math.abs(diff) <= 1
    if (pick.key === 'HOME_BIG') return diff >= 2
    if (pick.key === 'AWAY_BIG') return diff <= -2
    return null
  }
  // Total buts d'UNE équipe (ligne fixe +1,5, voir teamGoalsOverProbability).
  if (pick.market === 'TEAM_TOTAL') {
    const fs = finalScore(match.score)
    if (fs.home == null || fs.away == null) return null
    if (pick.key === 'HOME_OVER')  return fs.home > pick.line
    if (pick.key === 'HOME_UNDER') return fs.home < pick.line
    if (pick.key === 'AWAY_OVER')  return fs.away > pick.line
    if (pick.key === 'AWAY_UNDER') return fs.away < pick.line
    return null
  }
  // Buteur (SCORER) — VOLONTAIREMENT jamais résolu ici, même une fois le
  // match terminé : aucune donnée fiable dans l'app ne dit qui a marqué dans
  // CE match précis (voir calcProno.js/scorerOddsPct — la cote, elle, est
  // réelle ; seule la vérification après-coup manque). Retourne null à vie
  // pour ce marché → réglé à la main par l'utilisateur, voir
  // resolveManualPick ci-dessous (jamais un verdict deviné, décision
  // explicite utilisateur du 25/08).
  return null
}

/**
 * Règle tous les paris "pending" dont CHAQUE match sélectionné est présent
 * dans finishedById ({ [matchId]: match }, matchs FINISHED déjà chargés
 * côté app — voir useFinishedMatchesAllComps dans hooks/useMatchs.js,
 * appelé depuis MesParis.jsx). Un pari combiné dont un seul match n'est pas
 * encore terminé reste "pending" en entier — repassera au prochain appel.
 * Idempotent : ne touche jamais un pari déjà 'won'/'lost'.
 *
 * ⚠️ Marché buteur (SCORER, voir evaluatePick) : evaluatePick renvoie
 * toujours null pour ce marché, même une fois le match terminé — impossible
 * de savoir automatiquement si le joueur a marqué (aucune donnée fiable dans
 * l'app). Logique en 3 temps par pari, tous les matchs étant terminés :
 *  1. Une SEULE jambe perdue (résultat false, pick normal OU déjà confirmé à
 *     la main) suffit à perdre tout le combiné — pas besoin d'attendre une
 *     jambe buteur encore floue pour annoncer une défaite déjà acquise.
 *  2. Toutes les jambes gagnées (aucun null) → gagné, réglé normalement.
 *  3. Au moins une jambe encore floue (buteur, résultat null) et aucune
 *     perdue par ailleurs → `needsManual: true`, reste "pending" — l'UI
 *     (BetHistory/MesParis.jsx) propose alors à l'utilisateur de confirmer
 *     lui-même cette jambe précise (resolveManualPick ci-dessous). Décision
 *     explicite utilisateur (25/08) plutôt qu'un règlement automatique
 *     risqué (matching de noms de joueurs ESPN/FD.org, plus fragile qu'un
 *     matching d'équipes — déjà source de bugs réels dans ce projet).
 *
 * Retourne { bets, changed } — `changed` explicite (pas juste une nouvelle
 * référence de tableau) pour que l'appelant React (MesParis.jsx, effet
 * synchronisant avec localStorage) puisse sauter setState quand il n'y a
 * réellement rien de neuf, plutôt que de le faire à chaque re-render.
 */
export function settlePendingBets(finishedById) {
  const bets = readBets()
  let balance = readBalance()
  let changed = false

  const updated = bets.map(bet => {
    if (bet.status !== 'pending') return bet
    const matches = bet.picks.map(p => finishedById[p.matchId])
    if (matches.some(m => !m)) return bet

    const results = bet.picks.map((p, i) => p.manualResult ?? evaluatePick(p, matches[i]))

    if (results.some(r => r === false)) {
      changed = true
      return { ...bet, status: 'lost', payout: 0, settledAt: Date.now(), needsManual: false }
    }
    if (results.every(r => r === true)) {
      changed = true
      const payout = Math.round(bet.stake * bet.combinedOdd * 100) / 100
      balance += payout
      return { ...bet, status: 'won', payout, settledAt: Date.now(), needsManual: false }
    }
    // Reste au moins une jambe null (buteur) — signale needsManual une seule
    // fois (évite un `changed`/setState à chaque poll de `finished` tant que
    // l'utilisateur n'a rien confirmé).
    if (!bet.needsManual) { changed = true; return { ...bet, needsManual: true } }
    return bet
  })

  if (!changed) return { bets, changed: false }
  writeBets(updated)
  writeBalance(balance)
  return { bets: updated, changed: true }
}

/**
 * Confirmation manuelle d'UNE jambe buteur (voir settlePendingBets ci-dessus)
 * — l'utilisateur indique lui-même si le joueur a marqué, une fois qu'il
 * connaît le vrai résultat. Ne s'applique qu'à un pari déjà `needsManual`
 * (tous ses matchs sont terminés, toutes ses autres jambes sont déjà
 * garanties gagnantes — sinon le pari aurait déjà été réglé "lost" par
 * settlePendingBets avant d'atteindre l'état needsManual).
 *
 * @param {string} betId
 * @param {number} pickIndex  index du pick buteur dans bet.picks
 * @param {boolean} won       true = "il a marqué", false = "il n'a pas marqué"
 */
export function resolveManualPick(betId, pickIndex, won) {
  const bets = readBets()
  const idx = bets.findIndex(b => b.id === betId)
  if (idx === -1 || bets[idx].status !== 'pending' || !bets[idx].picks[pickIndex]) {
    return { ok: false }
  }
  const bet = bets[idx]
  const picks = bet.picks.map((p, i) => i === pickIndex ? { ...p, manualResult: won } : p)

  if (!won) {
    const updated = { ...bet, picks, status: 'lost', payout: 0, settledAt: Date.now(), needsManual: false }
    const next = bets.map((b, i) => i === idx ? updated : b)
    writeBets(next)
    return { ok: true, bet: updated }
  }

  const stillPending = picks.some(p => p.market === 'SCORER' && p.manualResult == null)
  if (stillPending) {
    const updated = { ...bet, picks }
    const next = bets.map((b, i) => i === idx ? updated : b)
    writeBets(next)
    return { ok: true, bet: updated }
  }

  // Toutes les jambes buteur du combiné sont maintenant confirmées gagnantes
  // (les autres jambes étaient déjà garanties gagnantes avant needsManual,
  // voir settlePendingBets) → tout le combiné est gagné.
  const payout = Math.round(bet.stake * bet.combinedOdd * 100) / 100
  const updated = { ...bet, picks, status: 'won', payout, settledAt: Date.now(), needsManual: false }
  const next = bets.map((b, i) => i === idx ? updated : b)
  writeBets(next)
  writeBalance(readBalance() + payout)
  return { ok: true, bet: updated }
}
