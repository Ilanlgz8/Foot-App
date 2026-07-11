// api/fifa-live.js
// Source live : FIFA API officielle (primaire — couvre WC 2026 + toutes compétitions)
//               ESPN (fallback ligues club si match pas dans FIFA live)
// Fallback final : données Redis last-known
//
// Input:  POST { matches: FD_Match[] }
// Output: { [fdMatchId]: { espnStatus, espnClock, espnPeriod, home, away, scorers, stats, espnEventId, espnSlug } }

import { Redis } from '@upstash/redis'
import Ably from 'ably'
import { ESPN_SLUG_BY_COMP_ID } from '../src/data/espnSlugs.js'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// ── Ably (temps quasi réel) ────────────────────────────────────────────────
// Client REST (pas Realtime) : chaque invocation de cette fonction serverless
// est un processus éphémère, une connexion persistante n'a aucun sens ici —
// le client REST fait un simple appel HTTP par publish, sans rien à fermer.
// ABLY_API_KEY absent (pas encore configuré) → ablyClient reste null, tout
// le reste du fichier continue de fonctionner exactement comme avant (aucune
// régression si Ably n'est pas configuré).
const ablyClient = process.env.ABLY_API_KEY ? new Ably.Rest(process.env.ABLY_API_KEY) : null

const FIFA_LIVE_URL = 'https://api.fifa.com/api/v3/live/football'
const FIFA_TTL      = 6           // Cache Redis FIFA live (s)
const ESPN_BASE     = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
const ESPN_TTL      = 8           // Cache Redis ESPN (s)
const MATCH_TTL     = 90 * 24 * 3600   // Données match persistées 90 jours (WC 2026)
const ESPN_TIMEOUT  = 5_000
const FIFA_TIMEOUT  = 7_000
// ⚠️ AJOUT (question utilisateur : "quand y'aura plein de matchs en même temps
// [reprise championnats club], ça va tenir le quota CPU ?") : marqueur séparé de
// fm:match:{id} — celui-ci indique juste QUAND le dernier calcul RÉEL (fetch
// ESPN/FIFA + matching + extraction) a eu lieu pour un match, peu importe si le
// contenu a changé. Sert au fast-path plus bas : si un autre utilisateur a déjà
// fait ce calcul il y a moins de FRESH_TTL secondes pour les mêmes matchs, on lui
// repique directement le résultat au lieu de tout refaire. Plus il y a de
// spectateurs simultanés sur les mêmes matchs, plus ce fast-path est efficace —
// l'inverse du problème actuel où chaque utilisateur ajoute du coût.
const FRESH_TTL     = 12

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeJson(val) {
  if (!val) return null
  if (typeof val === 'string') { try { return JSON.parse(val) } catch { return null } }
  return val
}

function dateStr(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function normalize(name = '') {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function fuzzyTeam(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true
  const wa = na.match(/[a-z]{4,}/g) ?? []
  const wb = nb.match(/[a-z]{4,}/g) ?? []
  return wa.some(x => wb.some(y => x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))))
}

// ── FIFA fetch + cache ─────────────────────────────────────────────────────────

async function fetchFifaLive(bypassCache = false) {
  const cKey = 'fifa:live'
  if (!bypassCache) {
    try {
      const cached = await kv.get(cKey)
      if (cached) return { data: safeJson(cached), fromCache: true }
    } catch {}
  }

  try {
    const res = await fetch(FIFA_LIVE_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(FIFA_TIMEOUT),
    })
    if (!res.ok) return { data: null, fromCache: false }
    const json = await res.json()
    const data = json.Results ?? []
    try { await kv.set(cKey, JSON.stringify(data), { ex: FIFA_TTL }) } catch {}
    return { data, fromCache: false }
  } catch {
    return { data: null, fromCache: false }
  }
}

// ── FIFA status/period → ESPN-style ───────────────────────────────────────────
// MatchStatus : 0=pas commencé  1=en cours  3=terminé
// Period      : 1=1erMT  2=2èmeMT  3=pause MT  4=Prol MT1  5=pause Prol  6=Prol MT2  7=TAB  8=FT

function fifaToEspnStatus(m) {
  const s = m.MatchStatus, p = m.Period
  if (s === 3 || p === 8) return 'STATUS_FINAL'
  // Period=0 = pré-match : FIFA inclut le match avec MatchStatus=1 avant le vrai KO.
  // Traiter comme SCHEDULED pour éviter un faux STATUS_IN_PROGRESS qui déclencherait
  // markLive() + notifyKickoff() 5min avant l'heure.
  if (s !== 1 || p === 0) return 'STATUS_SCHEDULED'
  if (p === 3 || p === 5) return 'STATUS_HALFTIME'
  if (p === 4 || p === 6) return 'STATUS_EXTRA_TIME'
  if (p === 7)            return 'STATUS_SHOOTOUT'
  return 'STATUS_IN_PROGRESS'
}

function fifaToClock(m) {
  const t = (m.MatchTime ?? '').replace(/'/g, '').trim()
  if (!t || t === 'HT' || t === 'FT') return ''
  // Préserver le temps additionnel : "45+2" → "45:00+2:00"
  // (sans ça, parseInt("45+2") = 45 → perd l'info stoppage, affiche "45'" figé)
  const plusIdx = t.indexOf('+')
  if (plusIdx !== -1) {
    const base  = parseInt(t.slice(0, plusIdx), 10)
    const extra = parseInt(t.slice(plusIdx + 1), 10)
    if (!isNaN(base) && !isNaN(extra) && extra > 0) return `${base}:00+${extra}:00`
  }
  const mins = parseInt(t, 10)
  if (isNaN(mins)) return ''

  // FIFA envoie parfois les minutes en comptage linéaire pendant le temps additionnel
  // (ex: "49" pour la 4ème min de stoppage de la 1ère MT au lieu de "45+4").
  // Convertir en format "base:00+extra:00" selon la période en cours.
  const p = m.Period
  if (p === 1 && mins > 45 && mins <= 60)  return `45:00+${mins - 45}:00`
  if (p === 2 && mins > 90 && mins <= 105) return `90:00+${mins - 90}:00`
  if (p === 4 && mins > 105 && mins <= 125) return `105:00+${mins - 105}:00`
  if (p === 6 && mins > 120 && mins <= 140) return `120:00+${mins - 120}:00`

  return `${mins}:00`
}

function fifaToPeriod(m) {
  const p = m.Period
  if (p === 4 || p === 6) return 3   // prolongations → period 3 (ET)
  if (p === 7)            return 5   // TAB → period 5
  if (p === 2)            return 2   // 2ème MT
  return 1
}

function fifaScore(m) {
  return { home: m.HomeTeam?.Score ?? 0, away: m.AwayTeam?.Score ?? 0 }
}

// Retourne TOUS les noms d'équipe disponibles dans toutes les locales.
// Permet de faire matcher "Iraq" (FD.org) avec "Irak" (FIFA locale fr), etc.
function fifaTeamNames(team) {
  const names = (team?.TeamName ?? [])
    .map(t => t.Description)
    .filter(Boolean)
  // Mettre l'anglais en premier si dispo
  const enIdx = (team?.TeamName ?? []).findIndex(t => /^en/i.test(t.Locale))
  if (enIdx > 0) {
    const en = names.splice(enIdx, 1)[0]
    names.unshift(en)
  }
  return names.length ? names : ['?']
}

function fifaPlayerName(goal) {
  // FIFA WC API peut utiliser différents formats selon la compétition / version API.
  // On essaie tous les champs connus dans l'ordre de préférence.
  return (
    // Format standard : tableau { Locale, Description }
    goal.PlayerName?.find(n => /^en/i.test(n.Locale))?.Description
    ?? goal.PlayerName?.[0]?.Description
    // Format alternatif parfois utilisé en WC
    ?? goal.ShortPlayerName?.find(n => /^en/i.test(n.Locale))?.Description
    ?? goal.ShortPlayerName?.[0]?.Description
    // Champs plats éventuels
    ?? goal.PlayerShortName
    ?? goal.Name
    ?? null  // null = pas de nom connu → le widget cachera le scorer
  )
}

function extractFifaScorers(m) {
  const scorers = []
  try {
    for (const goal of (m.HomeTeam?.Goals ?? [])) {
      const name = fifaPlayerName(goal)
      if (!name) continue  // but sans nom connu → ne pas afficher '?'
      scorers.push({
        name,
        minute:      goal.Minute != null ? `${goal.Minute}'` : '',
        team:        'home',
        ownGoal:     goal.OwnGoal === true,
        penaltyKick: goal.Penalty === true,
      })
    }
    for (const goal of (m.AwayTeam?.Goals ?? [])) {
      const name = fifaPlayerName(goal)
      if (!name) continue
      scorers.push({
        name,
        minute:      goal.Minute != null ? `${goal.Minute}'` : '',
        team:        'away',
        ownGoal:     goal.OwnGoal === true,
        penaltyKick: goal.Penalty === true,
      })
    }
    scorers.sort((a, b) => parseInt(a.minute) - parseInt(b.minute))
  } catch {}
  return scorers
}

// ── ESPN (source primaire pour statuts/clock) ──────────────────────────────────
// ESPN est la source principale pour espnStatus / espnClock / espnPeriod.
// WC 2026 : slug 'fifa.world' → ESPN couvre aussi la WC, statuts fiables.
// FIFA sert UNIQUEMENT pour le score + buteurs WC (plus réactif sur les buts).
// ⚠️ INCOHÉRENCE CORRIGÉE : ce mapping id FD.org → slug ESPN était dupliqué
// ici ET dans cron-goals.js (sous forme d'un simple tableau de slugs sans les
// id FD.org) — deux copies à tenir manuellement synchronisées, avec un vrai
// risque d'oubli si une compétition est ajoutée un jour dans un fichier sans
// penser à l'autre. Déplacé dans src/data/competitions.js (déjà la source
// pour TEAM_NAMES_FR partagée avec cron-goals.js) — source unique désormais.
const COMP_ESPN = ESPN_SLUG_BY_COMP_ID

// ── Normalisation statut ESPN ──────────────────────────────────────────────────
// ⚠️ BUG CORRIGÉ (constat en DIRECT sur France-Maroc, quart CM 2026 : fetch
// direct de site.api.espn.com pendant la 2e MT renvoyait
// type.name = "STATUS_SECOND_HALF" — PAS le générique "STATUS_IN_PROGRESS"
// que TOUT le pipeline attend (ce fichier, cron-goals.js, matchUtils.js côté
// client). Conséquence concrète et vérifiée : score/buteurs/stats plus mis à
// jour pendant toute la 2e MT (le bloc "CAS 1 : Match EN COURS" de
// useLiveMinute.js exige explicitement safeStatus === 'STATUS_IN_PROGRESS'),
// ET les notifs de but/mi-temps de cron-goals.js coupées (même check dans
// son Set LIVE_ESPN) — le match était traité comme "non reconnu" alors qu'il
// était bien en cours. `type.state` ('pre'/'in'/'post') est lui un champ
// générique et fiable côté ESPN quel que soit le libellé exact du statut →
// utilisé ici comme filet de sécurité pour tout statut "en cours" non mappé
// explicitement, en plus du mapping direct des variantes déjà repérées.
const KNOWN_ESPN_STATUS = new Set([
  'STATUS_SCHEDULED', 'STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME', 'STATUS_OVERTIME', 'STATUS_SHOOTOUT',
  'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
  'STATUS_POSTPONED', 'STATUS_CANCELED',
])
function normalizeEspnStatus(st) {
  const name = st?.type?.name ?? ''
  if (KNOWN_ESPN_STATUS.has(name)) return name
  // Variantes par mi-temps déjà repérées en direct
  if (name === 'STATUS_FIRST_HALF' || name === 'STATUS_SECOND_HALF') return 'STATUS_IN_PROGRESS'
  if (st?.type?.completed === true) return 'STATUS_FINAL'
  if (st?.type?.state === 'in')   return 'STATUS_IN_PROGRESS'
  if (st?.type?.state === 'post') return 'STATUS_FINAL'
  return name || 'STATUS_SCHEDULED'
}

function parseEspnScore(raw) {
  if (raw == null) return 0
  if (typeof raw === 'number') return Math.round(raw)
  if (typeof raw === 'string') return parseInt(raw, 10) || 0
  if (typeof raw === 'object') return parseInt(raw.displayValue ?? raw.value ?? '0', 10) || 0
  return 0
}

// ── Regression guard AVEC confirmation (but annulé VAR) ─────────────────────
// Demande utilisateur : le score et le buteur doivent redescendre/disparaître
// dans LiveMatchPage et tous les widgets quand un but est annulé par la VAR.
// Un 1er correctif a été fait côté client (useLiveMinute.js) mais le score
// affiché reste bloqué en pratique : pour un match Mondial (fifaD non-null,
// isWC), CETTE fonction (source Redis PARTAGÉE entre tous les utilisateurs)
// a SES PROPRES gardes anti-régression indépendantes — Math.max(FIFA, ESPN)
// pour le score, liste de buteurs qui ne raccourcit jamais, et un plancher
// score = max(score, nb de buteurs connus). Le client ne reçoit donc jamais
// la valeur corrigée : elle est déjà écrasée ICI, en amont, avant même
// d'atteindre le réseau. Même principe de correctif que côté client : une
// valeur plus basse n'est acceptée que si elle est confirmée sur 2 passes de
// calcul consécutives (comparée à la valeur BRUTE de la passe précédente,
// stockée séparément de la valeur publiée) — un glitch isolé (FIFA ou ESPN
// temporairement à jour partiellement) ne repasse jamais 2 fois de suite
// avec la même valeur plus basse, contrairement à une vraie annulation VAR.
function confirmedOrMax(fresh, cached, prevRaw) {
  if (cached == null || fresh == null) return fresh ?? cached
  if (fresh < cached && fresh === prevRaw) return fresh
  return Math.max(fresh, cached)
}
// Même principe pour les listes (buteurs/cartons), comparaison par longueur.
function confirmedListOrLonger(fresh, cached, prevRawLen) {
  const freshList  = fresh ?? []
  const cachedList = cached ?? []
  if (freshList.length < cachedList.length && freshList.length === prevRawLen) return freshList
  return freshList.length >= cachedList.length ? freshList : cachedList
}

function extractEspnScorers(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const txt = (d.type?.text ?? '').toLowerCase()
      const id  = String(d.type?.id ?? '')
      // ⚠️ BUG CORRIGÉ (constat utilisateur : "les buts marqués sur penalty,
      // ça ne s'affiche pas le buteur") : `txt === 'penaltykick'` exigeait une
      // égalité stricte SANS espace, alors qu'ESPN libelle ce type d'événement
      // avec un espace/tiret (ex: "Penalty - Scored", même style que "Yellow
      // Card"/"Red Card") — cette égalité ne matchait donc quasiment jamais en
      // pratique, et le but manquait silencieusement dans scorers[] (widget
      // live ET notif push, voir même fonction dupliquée dans cron-goals.js).
      // `txt.includes('penalty')` élargit la détection sans dépendre du format
      // exact — mais on exclut explicitement "miss" pour ne jamais compter un
      // penalty RATÉ comme un but marqué.
      return txt.includes('goal') || (txt.includes('penalty') && !txt.includes('miss')) || id === '57' || id === '58' || id === '72'
    })
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      const txt = (d.type?.text ?? '').toLowerCase()
      return {
        name:        ath?.shortName ?? ath?.displayName ?? '?',
        minute:      d.clock?.displayValue ?? '',
        team:        d.team?.id === homeTeamId ? 'home' : 'away',
        ownGoal:     d.ownGoal ?? txt.includes('own') ?? false,
        penaltyKick: d.penaltyKick ?? txt.includes('penalty') ?? false,
      }
    })
}

// Cartons (jaune/rouge) — mêmes ids ESPN que ceux vérifiés en direct sur de vrais
// matchs (type.id "94"="Yellow Card", "93"="Red Card"). Pas d'équivalent FIFA
// fiable pour les cartons (contrairement aux buts) → ESPN uniquement.
function extractEspnCards(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const id = String(d.type?.id ?? '')
      return id === '93' || id === '94'
    })
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      return {
        name:   ath?.shortName ?? ath?.displayName ?? '?',
        minute: d.clock?.displayValue ?? '',
        team:   d.team?.id === homeTeamId ? 'home' : 'away',
        red:    d.redCard === true || String(d.type?.id) === '93',
      }
    })
}

// ── ESPN summary → stats live (possession, tirs, corners) ─────────────────────
// Le scoreboard ESPN n'inclut pas statistics[] pour le soccer.
// Les stats réelles sont dans l'endpoint /summary?event={espnEventId}.
// ⚠️ TTL abaissé de 30s à 10s (proche de ESPN_TTL=8s du score, marge de
// sécurité volontaire) : avant ce fix, la possession/tirs/corners pouvait
// traîner jusqu'à 30s de retard sur le score lui-même — signalé par
// l'utilisateur comme une asymétrie gênante en live. 10s plutôt que 8s :
// aucune limite de débit ESPN documentée publiquement, donc marge de
// prudence délibérée (25% de requêtes en moins qu'à 8s) pour une perte de
// fraîcheur perçue négligeable. Cache toujours PARTAGÉ entre tous les
// utilisateurs (une requête ESPN par fenêtre de 10s, pas par utilisateur).
const SUMMARY_TTL = 10   // Cache Redis summary (s)

async function fetchEspnSummaryStats(slug, espnEventId) {
  if (!slug || !espnEventId) return null
  const cKey = `espn:sum:${espnEventId}`
  try {
    const cached = await kv.get(cKey)
    if (cached) {
      const d = safeJson(cached)
      return d  // peut être null si match pas encore de stats
    }
  } catch {}

  try {
    const r = await fetch(
      `${ESPN_BASE}/${slug}/summary?event=${espnEventId}`,
      { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(ESPN_TIMEOUT) }
    )
    if (!r.ok) return null
    const j = await r.json()

    // Les stats sont dans boxscore.teams[]
    const teams = j.boxscore?.teams ?? []
    const homeT = teams.find(t => t.homeAway === 'home')
    const awayT = teams.find(t => t.homeAway === 'away')
    const stats = extractBoxscoreStats(homeT?.statistics, awayT?.statistics)
    // Stocker même si null pour éviter de re-fetcher inutilement
    try { await kv.set(cKey, JSON.stringify(stats), { ex: SUMMARY_TTL }) } catch {}
    return stats
  } catch {
    return null
  }
}

function extractBoxscoreStats(hArr, aArr) {
  if (!hArr?.length && !aArr?.length) return null

  function find(arr, ...names) {
    if (!arr) return null
    for (const name of names) {
      const s = arr.find(s => s.name === name || s.abbreviation === name)
      if (s == null) continue
      const v = parseFloat(s.displayValue ?? String(s.value ?? ''))
      if (!isNaN(v)) return v
    }
    return null
  }

  const hPoss    = find(hArr, 'possessionPct', 'possession')
  const aPoss    = find(aArr, 'possessionPct', 'possession')
  const hShots   = find(hArr, 'totalShots', 'shotsTotal', 'shots')
  const aShots   = find(aArr, 'totalShots', 'shotsTotal', 'shots')
  const hSOT     = find(hArr, 'shotsOnTarget', 'shotsOnGoal', 'onGoalAttempts')
  const aSOT     = find(aArr, 'shotsOnTarget', 'shotsOnGoal', 'onGoalAttempts')
  // 'wonCorners' = vrai nom de champ ESPN (vérifié sur un vrai match terminé) —
  // les anciens noms devinés ('cornerKicks' etc.) ne matchaient jamais, corners
  // toujours vide comme le xG. Gardés en repli au cas où ESPN varie par ligue.
  const hCorners = find(hArr, 'wonCorners', 'cornerKicks', 'cornerKick', 'cornersTotal', 'corners')
  const aCorners = find(aArr, 'wonCorners', 'cornerKicks', 'cornerKick', 'cornersTotal', 'corners')
  const hFouls   = find(hArr, 'foulsCommitted', 'totalFouls', 'fouls', 'foulCommitted')
  const aFouls   = find(aArr, 'foulsCommitted', 'totalFouls', 'fouls', 'foulCommitted')
  const hYellow  = find(hArr, 'yellowCards', 'yellowCard')
  const aYellow  = find(aArr, 'yellowCards', 'yellowCard')
  const hOffside = find(hArr, 'offsides', 'offside')
  const aOffside = find(aArr, 'offsides', 'offside')
  // xG retiré : jamais présent en pratique dans le tableau `statistics` du
  // boxscore ESPN (vérifié sur de vrais matchs terminés, toutes compétitions
  // — aucune clé 'expectedGoals'/'xg' ne remonte jamais), et l'app n'a aucune
  // autre source xG réelle malgré ce que suggérait la doc ("FotMob (xG)") —
  // aucune intégration FotMob n'a jamais existé dans le code.

  // Stats supplémentaires (retour utilisateur) — noms de champs vérifiés sur
  // un vrai match ESPN terminé (même méthode que pour le fix corners) : tous
  // présents dans le tableau `statistics` du boxscore, pas d'invention.
  const hPasses      = find(hArr, 'totalPasses')
  const aPasses      = find(aArr, 'totalPasses')
  const hPassPct     = find(hArr, 'passPct')
  const aPassPct     = find(aArr, 'passPct')
  const hTackles     = find(hArr, 'totalTackles')
  const aTackles     = find(aArr, 'totalTackles')
  const hInterceptions = find(hArr, 'interceptions')
  const aInterceptions = find(aArr, 'interceptions')
  const hCrosses     = find(hArr, 'totalCrosses')
  const aCrosses     = find(aArr, 'totalCrosses')
  const hCrossPct    = find(hArr, 'crossPct')
  const aCrossPct    = find(aArr, 'crossPct')
  const hLongBalls   = find(hArr, 'totalLongBalls')
  const aLongBalls   = find(aArr, 'totalLongBalls')
  const hLongBallPct = find(hArr, 'longballPct')
  const aLongBallPct = find(aArr, 'longballPct')
  const hTacklePct   = find(hArr, 'tacklePct')
  const aTacklePct   = find(aArr, 'tacklePct')
  const hRedCards    = find(hArr, 'redCards')
  const aRedCards    = find(aArr, 'redCards')
  const hSaves       = find(hArr, 'saves')
  const aSaves       = find(aArr, 'saves')
  const hClearances  = find(hArr, 'effectiveClearance', 'totalClearance')
  const aClearances  = find(aArr, 'effectiveClearance', 'totalClearance')
  const hBlockedShots = find(hArr, 'blockedShots')
  const aBlockedShots = find(aArr, 'blockedShots')

  if (hPoss == null && hShots == null && hCorners == null) return null

  return {
    home: {
      poss: hPoss, shots: hShots, shotsOnTarget: hSOT, corners: hCorners, fouls: hFouls, yellow: hYellow, offsides: hOffside,
      passes: hPasses, passPct: hPassPct, tackles: hTackles, tacklePct: hTacklePct, interceptions: hInterceptions,
      crosses: hCrosses, crossPct: hCrossPct, longBalls: hLongBalls, longBallPct: hLongBallPct,
      redCards: hRedCards, saves: hSaves, clearances: hClearances, blockedShots: hBlockedShots,
    },
    away: {
      poss: aPoss, shots: aShots, shotsOnTarget: aSOT, corners: aCorners, fouls: aFouls, yellow: aYellow, offsides: aOffside,
      passes: aPasses, passPct: aPassPct, tackles: aTackles, tacklePct: aTacklePct, interceptions: aInterceptions,
      crosses: aCrosses, crossPct: aCrossPct, longBalls: aLongBalls, longBallPct: aLongBallPct,
      redCards: aRedCards, saves: aSaves, clearances: aClearances, blockedShots: aBlockedShots,
    },
  }
}

async function fetchEspnEvents(slugSet, today, yesterday, bypassCache = false) {
  const allEvents = []
  await Promise.allSettled([...slugSet].map(async slug => {
    const cKey = `espn:fb:${slug}`
    let events = null
    if (!bypassCache) {
      try {
        const cached = await kv.get(cKey)
        if (cached) events = safeJson(cached)
      } catch {}
    }

    if (!events) {
      try {
        // ⚠️ &limit=100 indispensable : sans lui, ESPN renvoie pour les matchs à
        // élimination directe pas encore "résolus" par défaut des noms d'équipe
        // placeholder de bracket ("Round of 32 5 Winner") et un statut/score
        // figés à SCHEDULED/0-0, même après le vrai coup d'envoi — confirmé en
        // comparant en direct la même URL avec/sans ce paramètre (voir même fix
        // dans cron-goals.js, où le bug a été identifié en premier).
        const [rT, rY] = await Promise.all([
          fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${today}&limit=100`,     { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(ESPN_TIMEOUT) }),
          fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${yesterday}&limit=100`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(ESPN_TIMEOUT) }),
        ])
        const [jT, jY] = await Promise.all([
          rT.ok ? rT.json() : { events: [] },
          rY.ok ? rY.json() : { events: [] },
        ])
        events = [...(jT.events ?? []), ...(jY.events ?? [])]
        try { await kv.set(cKey, JSON.stringify(events), { ex: ESPN_TTL }) } catch {}
      } catch { events = [] }
    }

    for (const evt of (events ?? [])) allEvents.push({ slug, evt })
  }))
  return allEvents
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).end()

  // Rate limiting : 60 req / IP / minute
  const ip    = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const rlKey = `ratelimit:espnlive:${ip}`
  try {
    const count = await kv.incr(rlKey)
    if (count === 1) await kv.expire(rlKey, 60)
    if (count > 60) return res.status(429).json({ error: 'Trop de requêtes' })
  } catch {}

  // forceFresh : envoyé par le client au retour au premier plan (voir onVisible
  // dans useLiveMinute.js) — contourne le cache Redis (6-8s) pour CET appel
  // précis, afin de ne pas rater un but marqué juste avant/pendant l'arrière-plan
  // si ce cache a été rafraîchi par un autre appel juste avant notre retour.
  const { matches, forceFresh } = req.body ?? {}
  if (!Array.isArray(matches) || !matches.length) return res.json({})
  // ⚠️ BUG CORRIGÉ (question utilisateur : "l'app va supporter d'avoir genre
  // 30 matchs par jour ?") : ce plafond était à 20 — un simple samedi après-
  // midi avec plusieurs championnats club en simultané (PL + Bundesliga +
  // Serie A + Ligue 1 + coupes européennes...) peut largement dépasser ce
  // nombre de matchs "à suivre" au même moment (fenêtre 0-150min après KO,
  // voir toTrack dans useLiveMinute.js). Conséquence AVANT ce fix : la
  // requête entière échouait (400), donc PLUS AUCUN match ne recevait de
  // score/stats ce jour-là, pas juste les matchs en trop. Relevé à 60 — large
  // marge pour un jour très chargé, tout en gardant un plafond de sécurité
  // contre un payload abusif. Le vrai coût serveur ne scale de toute façon
  // pas linéairement avec le nombre de matchs (voir fetchEspnSummaryStats
  // désormais parallélisé plus bas), donc ce plafond n'est qu'un garde-fou,
  // pas une contrainte de performance réelle.
  if (matches.length > 60) return res.status(400).json({ error: 'Trop de matchs (max 60)' })

  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))

  // Charger les données Redis last-known
  let storedMatches = Array(matches.length).fill(null)
  try {
    const keys = matches.map(m => `fm:match:${m.id}`)
    storedMatches = await kv.mget(...keys)
  } catch {}

  const storedData = {}
  matches.forEach((m, i) => {
    const d = safeJson(storedMatches[i])
    if (d) storedData[m.id] = d
  })

  const result = {}

  // ── Fast-path : réutiliser un calcul tout juste fait par un AUTRE utilisateur ──
  // Voir commentaire de FRESH_TTL plus haut. Tout ou rien (pas de fast-path
  // partiel match par match) : si ne serait-ce qu'UN match manque de fraîcheur,
  // on retombe sur le pipeline complet ci-dessous, strictement inchangé — choix
  // délibéré pour ne prendre aucun risque de régression sur le matching FIFA/ESPN
  // déjà éprouvé (buts, cartons, désync score/buteur, tirs au but…).
  // forceFresh (retour au premier plan) contourne toujours ce fast-path, comme il
  // contourne déjà le cache ESPN/FIFA plus bas — même intention.
  if (!forceFresh) {
    try {
      const freshFlags = await kv.mget(...matches.map(m => `fm:fresh:${m.id}`))
      const allFresh = matches.every((m, i) => freshFlags[i] != null && storedData[m.id])
      if (allFresh) {
        const fast = {}
        matches.forEach(m => { fast[m.id] = { ...storedData[m.id], fromCache: true } })
        return res.json(fast)
      }
    } catch {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1 : FIFA live → score + buteurs + IDs (WC uniquement)
  // FIFA est UNIQUEMENT utilisé pour les données de score/buteurs WC.
  // Les statuts (espnStatus/espnClock/espnPeriod) viennent d'ESPN — plus fiables.
  // ══════════════════════════════════════════════════════════════════════════
  const { data: fifaLive, fromCache: fifaCached } = await fetchFifaLive(!!forceFresh)

  // Index FIFA par fdMatchId : score + buteurs + IDs FIFA pour les compos/stats
  const fifaByFdId = {}
  if (fifaLive?.length > 0) {
    const usedFifaIds = new Set()
    for (const fdMatch of matches) {
      if (fdMatch.competition?.id !== 2000) continue   // WC seulement

      const fdHome = fdMatch.homeTeam?.name ?? fdMatch.homeTeam?.shortName ?? ''
      const fdAway = fdMatch.awayTeam?.name ?? fdMatch.awayTeam?.shortName ?? ''
      if (!fdHome || !fdAway) continue

      const fifaMatch = fifaLive.find(m => {
        if (usedFifaIds.has(m.IdMatch)) return false
        const homeNames = fifaTeamNames(m.HomeTeam)
        const awayNames = fifaTeamNames(m.AwayTeam)
        return homeNames.some(n => fuzzyTeam(fdHome, n))
            && awayNames.some(n => fuzzyTeam(fdAway, n))
      })
      if (!fifaMatch) continue

      usedFifaIds.add(fifaMatch.IdMatch)
      const { home, away } = fifaScore(fifaMatch)

      fifaByFdId[fdMatch.id] = {
        home, away,
        scorers:      extractFifaScorers(fifaMatch),
        fifaMatchId:  fifaMatch.IdMatch,
        fifaCompId:   fifaMatch.IdCompetition ?? null,
        fifaSeasonId: fifaMatch.IdSeason      ?? null,
        fifaStageId:  fifaMatch.IdStage       ?? null,
        fifaRaw:      fifaMatch,              // gardé pour fallback statut
        fromCache:    fifaCached,
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2 : ESPN → statuts + clock + period (source primaire pour TOUS)
  // WC inclus via slug 'fifa.world'. Pas de faux STATUS_FINAL / STATUS_EXTRA_TIME.
  // ══════════════════════════════════════════════════════════════════════════
  const slugSet = new Set()
  for (const m of matches) {
    const s = COMP_ESPN[m.competition?.id]
    if (s) slugSet.add(s)
  }

  const espnEvents = slugSet.size > 0
    ? await fetchEspnEvents(slugSet, today, yesterday, !!forceFresh)
    : []

  // Matcher chaque match FD.org avec un event ESPN
  const usedEspnIds = new Set()
  // ⚠️ PERF (question utilisateur sur la tenue en charge avec beaucoup de
  // matchs simultanés) : les fetchEspnSummaryStats() nécessaires plus bas
  // dans cette boucle ne sont PLUS attendus (`await`) un par un — ça
  // sérialisait un aller-retour réseau PAR MATCH (ex: 20 matchs en direct
  // sans stats scoreboard × ~300-500ms chacun = jusqu'à 10s rien que pour
  // cette étape, risquant de dépasser le timeout par défaut d'une fonction
  // Vercel Hobby et de faire échouer TOUTE la réponse). Le fetch est lancé
  // immédiatement (la requête réseau part tout de suite) mais collecté ici
  // pour être résolu APRÈS la boucle, en parallèle pour tous les matchs qui
  // en ont besoin — le temps total ne dépend plus du nombre de matchs mais
  // du plus lent des appels ESPN.
  const pendingStatsFetches = []
  for (const fdMatch of matches) {
    const slug = COMP_ESPN[fdMatch.competition?.id]
    if (!slug) continue

    const fdHome = fdMatch.homeTeam?.name ?? fdMatch.homeTeam?.shortName ?? ''
    const fdAway = fdMatch.awayTeam?.name ?? fdMatch.awayTeam?.shortName ?? ''
    if (!fdHome || !fdAway) continue

    // ── Raccourci : ré-utiliser l'ID ESPN déjà résolu lors d'un poll précédent ──
    // Root cause d'une bonne partie des bugs "intermittents" déjà corrigés cette
    // session (matchs simultanés, noms légèrement différents...) : le fuzzy-match
    // par NOM était re-exécuté à chaque poll (~toutes les 15-20s), pour CHAQUE
    // match, y compris ceux déjà identifiés avec certitude auparavant. Ré-tenter
    // un pari probabiliste en boucle indéfiniment, c'est mathématiquement
    // garanti de finir par tomber sur le mauvais tirage tôt ou tard. On ne
    // devrait avoir à "deviner" qu'UNE SEULE FOIS par match (à son apparition),
    // puis se souvenir du bon ID ESPN et le réutiliser directement tant qu'il
    // reste valide — beaucoup plus fiable ET moins de travail à chaque poll.
    // (espnRealEventId ≠ le champ espnEventId du résultat final, qui contient
    // l'ID FIFA pour la CM — deux systèmes d'ID différents, à ne pas confondre.)
    const prevRealId = storedData[fdMatch.id]?.espnRealEventId ?? null
    let found = prevRealId != null
      ? espnEvents.find(({ slug: s, evt }) =>
          s === slug && evt.id === prevRealId && !usedEspnIds.has(evt.id))
      : null

    // Si l'ID connu n'est plus dans le scoreboard actuel (rare — event retiré,
    // changement de jour...), on retombe sur le fuzzy-match par nom comme avant.
    if (!found) {
      found = espnEvents.find(({ slug: s, evt }) => {
        if (s !== slug) return false
        if (usedEspnIds.has(evt.id)) return false
        const comp  = evt.competitions?.[0]
        const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
        const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
        const eHome = homeC?.team?.displayName ?? homeC?.team?.name ?? ''
        const eAway = awayC?.team?.displayName ?? awayC?.team?.name ?? ''
        return fuzzyTeam(fdHome, eHome) && fuzzyTeam(fdAway, eAway)
      })
    }

    // Repli : le fuzzy-match strict (2 côtés) peut échouer sur un des deux
    // matchs quand plusieurs commencent à la même minute — situation garantie
    // pour les derniers matchs de poule (kickoff simultané obligatoire), pas
    // juste un hasard. Dans ce cas un match restait bloqué sur "Débute" sans
    // jamais se raccrocher à son event ESPN. Repli : n'exiger qu'UN des deux
    // côtés + un coup d'envoi ESPN à ±10min du nôtre (assez précis pour ne pas
    // accrocher un mauvais match, assez large pour couvrir les petits écarts
    // de synchro d'horloge entre FD.org et ESPN).
    if (!found) {
      const fdKickoff = new Date(fdMatch.utcDate).getTime()
      found = espnEvents.find(({ slug: s, evt }) => {
        if (s !== slug) return false
        if (usedEspnIds.has(evt.id)) return false
        const comp  = evt.competitions?.[0]
        const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
        const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
        const eHome = homeC?.team?.displayName ?? homeC?.team?.name ?? ''
        const eAway = awayC?.team?.displayName ?? awayC?.team?.name ?? ''
        if (!fuzzyTeam(fdHome, eHome) && !fuzzyTeam(fdAway, eAway)) return false
        const rawKickoff = evt.date ?? comp?.date
        if (!rawKickoff) return false
        const evtKickoff = new Date(rawKickoff).getTime()
        return Math.abs(evtKickoff - fdKickoff) <= 10 * 60_000
      })
    }

    if (!found) continue

    usedEspnIds.add(found.evt.id)
    const comp     = found.evt.competitions[0]
    const st       = comp.status
    const espnStatus = normalizeEspnStatus(st)
    const espnClock  = st?.displayClock ?? ''
    const espnPeriod = st?.period ?? null

    const homeC = comp.competitors?.find(c => c.homeAway === 'home')
    const awayC = comp.competitors?.find(c => c.homeAway === 'away')

    const isWC    = fdMatch.competition?.id === 2000
    const fifaD   = isWC ? fifaByFdId[fdMatch.id] : null
    const prevData = storedData[fdMatch.id]

    // WC : si ESPN retourne encore STATUS_SCHEDULED mais que FIFA confirme Period=1
    // (match réellement commencé), utiliser le statut FIFA pour ne pas attendre
    // le lag ESPN (~4min). Le garde Period=0 → SCHEDULED est déjà dans fifaToEspnStatus.
    let finalEspnStatus = espnStatus
    let finalEspnClock  = espnClock
    let finalEspnPeriod = espnPeriod
    if (isWC && espnStatus === 'STATUS_SCHEDULED' && fifaD?.fifaRaw) {
      const fifaStatus = fifaToEspnStatus(fifaD.fifaRaw)
      if (fifaStatus === 'STATUS_IN_PROGRESS' || fifaStatus === 'STATUS_HALFTIME') {
        finalEspnStatus = fifaStatus
        finalEspnClock  = fifaToClock(fifaD.fifaRaw)
        finalEspnPeriod = fifaToPeriod(fifaD.fifaRaw)
      }
    }

    // ⚠️ FIX retard fin de tirs au but (~7min, vérifié sur un vrai match CM 2026 :
    // dernier tir réel confirmé par le wallclock ESPN lui-même à 22:50:28Z, mais
    // ESPN ne bascule son statut scoreboard en STATUS_FINAL_PEN que vers 22:57:27Z —
    // ESPN a du retard sur SES PROPRES données détaillées pour confirmer la fin aux
    // tab). Contrairement à l'usage normal de fifaToEspnStatus() (jamais fiable pour
    // déclarer une fin de match en cours de jeu — VAR pouvant faussement ressembler à
    // Period=8), cette fenêtre est sûre : on ne l'utilise QUE quand ESPN nous a déjà
    // confirmé nous-mêmes être en tirs au but (STATUS_SHOOTOUT) — donc après 120min+
    // confirmées par ESPN, où aucune transition de jeu normal ne peut se produire.
    if (isWC && espnStatus === 'STATUS_SHOOTOUT' && fifaD?.fifaRaw?.MatchStatus === 3 && fifaD.fifaRaw.Period === 8) {
      finalEspnStatus = 'STATUS_FINAL_PEN'
    }

    // Score : FIFA si WC (plus réactif sur les buts), ESPN sinon
    // Pour WC : max(FIFA, ESPN) → le premier à détecter le but gagne
    // Évite d'attendre FIFA si ESPN a déjà mis à jour (ou inversement)
    let rawHome, rawAway, scorers
    if (fifaD) {
      const espnHome = parseEspnScore(homeC?.score) ?? 0
      const espnAway = parseEspnScore(awayC?.score) ?? 0
      rawHome = Math.max(fifaD.home ?? 0, espnHome)
      rawAway = Math.max(fifaD.away ?? 0, espnAway)
      // ⚠️ AMÉLIORATION (question utilisateur : "pour avoir le score plus
      // rapidement c'est FIFA ou ESPN ?") : le score numérique (ligne
      // ci-dessus) prenait déjà le max des deux sources — le premier arrivé
      // gagne. Mais le NOM du buteur ne suivait pas la même logique : FIFA
      // était toujours préféré dès qu'il avait au moins 1 but connu, même si
      // ESPN avait DÉJÀ le nom et que FIFA était encore vide/en retard sur ce
      // but précis. Même principe "le plus complet des deux gagne" appliqué
      // ici : on prend la liste la plus longue (donc la plus à jour) entre
      // FIFA et ESPN, à égalité on garde FIFA (déjà jugé plus fiable pour les
      // noms sur la CM).
      const fifaScorers = fifaD.scorers
      const espnScorersNow = extractEspnScorers(comp, homeC?.team?.id)
      scorers = fifaScorers.length >= espnScorersNow.length ? fifaScorers : espnScorersNow
    } else {
      rawHome = parseEspnScore(homeC?.score)
      rawAway = parseEspnScore(awayC?.score)
      scorers = extractEspnScorers(comp, homeC?.team?.id)
    }

    // ⚠️ BUT ANNULÉ VAR (constat utilisateur, plusieurs itérations) : cette
    // fonction alimente un cache Redis PARTAGÉ entre tous les utilisateurs.
    // Un 1er correctif basé sur "le nombre de buteurs vient de baisser PAR
    // RAPPORT À LA PASSE PRÉCÉDENTE" ne suffisait pas : dès que la
    // transition (2 buteurs → 1) était déjà passée (donc déjà stockée dans
    // prevData AVANT ce correctif), plus aucune baisse n'était détectée —
    // le compteur restait à 0 et le score restait bloqué, y compris pour un
    // match DÉJÀ touché par une annulation au moment du déploiement.
    //
    // Solution robuste : comparer directement l'ÉCART (numérique confirmé −
    // buteurs confirmés) d'une passe à l'autre, plutôt que la transition.
    // Si ce même écart positif est observé sur 2 passes de calcul
    // consécutives (peu importe qu'il ait commencé avant ou après ce
    // déploiement), il est traité comme des buts annulés confirmés,
    // mémorisé en PERMANENCE (le compteur ne fait qu'augmenter) et soustrait
    // du score numérique à chaque passe suivante — le champ numérique
    // ESPN/FIFA ne se corrigeant TYPIQUEMENT JAMAIS tout seul après une
    // annulation VAR (observé en direct : reste bloqué indéfiniment sur
    // l'ancienne valeur même quand le buteur a bien disparu de bestScorers).
    // Contrepartie assumée : si un but est marqué et que le nom du buteur
    // met EXCEPTIONNELLEMENT plus d'une passe à être publié (cas déjà connu,
    // ~20s habituellement), le score peut être temporairement sous-estimé
    // pendant cette fenêtre avant de se corriger automatiquement dès que le
    // buteur est confirmé (le plancher buteurs reprend alors la main) — un
    // compromis nécessaire pour pouvoir aussi corriger un match déjà bloqué
    // au moment du déploiement, pas seulement les nouvelles annulations.
    const bestScorers = confirmedListOrLonger(scorers, prevData?.scorers, prevData?.rawScorersLen)
    const homeGoalsFromScorers = bestScorers.filter(s => s.team === 'home').length
    const awayGoalsFromScorers = bestScorers.filter(s => s.team === 'away').length

    const homeNumeric = confirmedOrMax(rawHome, prevData?.home, prevData?.rawHome)
    const awayNumeric = confirmedOrMax(rawAway, prevData?.away, prevData?.rawAway)

    const rawHomeGap = Math.max(0, homeNumeric - homeGoalsFromScorers)
    const rawAwayGap = Math.max(0, awayNumeric - awayGoalsFromScorers)
    const homeGapConfirmed = rawHomeGap > 0 && rawHomeGap === (prevData?.rawGoalGapHome ?? null)
    const awayGapConfirmed = rawAwayGap > 0 && rawAwayGap === (prevData?.rawGoalGapAway ?? null)
    const homeCancelledGoals = homeGapConfirmed
      ? Math.max(prevData?.homeCancelledGoals ?? 0, rawHomeGap)
      : (prevData?.homeCancelledGoals ?? 0)
    const awayCancelledGoals = awayGapConfirmed
      ? Math.max(prevData?.awayCancelledGoals ?? 0, rawAwayGap)
      : (prevData?.awayCancelledGoals ?? 0)
    // Score final : numérique confirmé (protège contre un pic isolé vers le
    // haut sur un seul poll) MOINS les buts confirmés annulés, avec les
    // buteurs confirmés comme plancher (protège le cas inverse : but déjà
    // marqué mais buteur pas encore publié, voir commentaire historique
    // ci-dessous — jamais concerné par une soustraction puisque
    // homeCancelledGoals ne peut pas dépasser homeGoalsFromScorers par
    // construction).
    //
    // ⚠️ Fix désync score/buteur (constat utilisateur historique : le nom du
    // buteur et la minute s'affichent déjà mais le score reste bloqué à
    // l'ancienne valeur, ~20s de retard) : le tableau Goals[] peut
    // apparaître avant que le champ Score FIFA/ESPN s'incrémente réellement
    // → un buteur déjà connu (et confirmé) pour un camp est en soi la preuve
    // qu'un but a été marqué, même si le champ numérique n'a pas encore
    // suivi.
    let home = Math.max(homeNumeric - homeCancelledGoals, homeGoalsFromScorers)
    let away = Math.max(awayNumeric - awayCancelledGoals, awayGoalsFromScorers)

    // Cartons — ESPN uniquement (voir extractEspnCards ci-dessus). Pas de
    // scénario VAR réaliste pour un carton annulé → confirmation non requise,
    // même garde simple qu'avant.
    const cards = extractEspnCards(comp, homeC?.team?.id)
    const bestCards = cards.length >= (prevData?.cards?.length ?? 0)
      ? cards : (prevData?.cards ?? [])

    // ── Score des tirs au but ────────────────────────────────────────────────
    // ESPN expose un champ dédié `shootoutScore` sur chaque compétiteur (vérifié
    // sur un vrai match : finale CM 2022, Argentine 4 - France 2). FIFA n'a pas
    // d'équivalent confirmé pour ce champ précis (contrairement au score/buteurs
    // où FIFA est privilégié) — et ses transitions de période sont déjà connues
    // pour avoir des ratés (cf plus haut STATUS_EXTRA_TIME/STATUS_FINAL foireux).
    // Donc ESPN uniquement ici, avec le même garde anti-régression que le score
    // (le compteur de tab ne peut que monter, jamais redescendre).
    const rawHomeShootout = homeC?.shootoutScore ?? null
    const rawAwayShootout = awayC?.shootoutScore ?? null
    const prevHomeShootout = prevData?.homeShootout ?? null
    const prevAwayShootout = prevData?.awayShootout ?? null
    const homeShootout = (rawHomeShootout != null && prevHomeShootout != null)
      ? Math.max(rawHomeShootout, prevHomeShootout)
      : (rawHomeShootout ?? prevHomeShootout)
    const awayShootout = (rawAwayShootout != null && prevAwayShootout != null)
      ? Math.max(rawAwayShootout, prevAwayShootout)
      : (rawAwayShootout ?? prevAwayShootout)

    // Stats : scoreboard ESPN d'abord
    // Si scoreboard vide (WC et beaucoup de ligues club) ET match en cours
    // → appel summary endpoint ESPN (cached 30s Redis) qui contient boxscore complet
    let matchStats = extractBoxscoreStats(homeC?.statistics, awayC?.statistics)
    let statsPromise = null
    if (
      !matchStats &&
      (finalEspnStatus === 'STATUS_IN_PROGRESS' ||
       finalEspnStatus === 'STATUS_HALFTIME'    ||
       finalEspnStatus === 'STATUS_END_PERIOD')
    ) {
      // found.slug = 'fifa.world' pour WC, 'fra.1' etc pour club
      // Pas de `await` ici — voir commentaire sur pendingStatsFetches plus haut.
      statsPromise = fetchEspnSummaryStats(found.slug, found.evt.id)
    }
    // Valeur temporaire tant que statsPromise n'est pas résolu (voir plus bas,
    // après la boucle) — jamais renvoyée telle quelle au client si un fetch
    // est en cours : écrasée par le vrai résultat une fois Promise.allSettled fini.
    matchStats = matchStats ?? prevData?.stats ?? null

    result[fdMatch.id] = {
      // IDs : FIFA match ID pour WC (nécessaire pour les compos), ESPN sinon.
      // Si fifaD absent (FIFA live cache stale), on préserve l'ID FIFA depuis prevData
      // pour ne pas écraser un bon espnEventId par un ID ESPN inutilisable.
      espnEventId:  fifaD?.fifaMatchId
                      ?? (isWC ? prevData?.espnEventId : null)
                      ?? found.evt.id,
      espnSlug:     isWC ? 'fifa' : found.slug,
      // ID ESPN "brut" — distinct de espnEventId ci-dessus (qui est l'ID FIFA
      // pour la CM) — mémorisé pour éviter de re-fuzzy-matcher ce match par nom
      // à chaque poll (voir commentaire plus haut sur le raccourci de matching).
      espnRealEventId: found.evt.id,
      // Statut : ESPN primaire, mais si ESPN lag au KO WC → FIFA Period=1 utilisé
      espnStatus:   finalEspnStatus,
      espnClock:    finalEspnClock,
      espnPeriod:   finalEspnPeriod,
      // Score FIFA (WC) ou ESPN (club)
      home,
      away,
      scorers:      bestScorers,
      cards:        bestCards,
      // Valeurs BRUTES de CETTE passe (pas home/away/bestScorers publiés
      // ci-dessus) — servent uniquement à détecter une baisse confirmée à la
      // PROCHAINE passe de calcul, voir confirmedOrMax/confirmedListOrLonger.
      rawHome,
      rawAway,
      rawScorersLen: scorers.length,
      // Écart brut (numérique confirmé − buteurs confirmés) de CETTE passe —
      // sert à détecter 2 passes consécutives avec le MÊME écart, voir
      // commentaire "BUT ANNULÉ VAR" plus haut.
      rawGoalGapHome: rawHomeGap,
      rawGoalGapAway: rawAwayGap,
      // Compteur permanent de buts annulés confirmés (voir commentaire "BUT
      // ANNULÉ VAR" plus haut) — ne fait qu'augmenter, jamais réinitialisé.
      homeCancelledGoals,
      awayCancelledGoals,
      // Tirs au but (ESPN uniquement — voir commentaire ci-dessus)
      homeShootout,
      awayShootout,
      // Stats : summary ESPN (possession, tirs, corners) — scoreboard souvent vide en soccer
      stats:        matchStats,
      // IDs FIFA pour api/fifa-lineups.js — préserver depuis prevData si fifaD absent
      ...(fifaD ? {
        fifaCompId:   fifaD.fifaCompId,
        fifaSeasonId: fifaD.fifaSeasonId,
        fifaStageId:  fifaD.fifaStageId,
      } : isWC && prevData?.fifaCompId ? {
        fifaCompId:   prevData.fifaCompId,
        fifaSeasonId: prevData.fifaSeasonId,
        fifaStageId:  prevData.fifaStageId,
      } : {}),
    }

    if (statsPromise) {
      pendingStatsFetches.push({ fdMatchId: fdMatch.id, promise: statsPromise, prevStats: prevData?.stats ?? null })
    }
  }

  // Résout tous les fetchs de stats ESPN collectés ci-dessus EN PARALLÈLE
  // (voir commentaire détaillé sur pendingStatsFetches plus haut) — remplace
  // la valeur temporaire (prevData?.stats) posée dans la boucle par le
  // résultat réel, une fois tous les appels réseau terminés.
  if (pendingStatsFetches.length > 0) {
    const settled = await Promise.allSettled(pendingStatsFetches.map(p => p.promise))
    settled.forEach((r, i) => {
      const { fdMatchId, prevStats } = pendingStatsFetches[i]
      const fresh = r.status === 'fulfilled' ? r.value : null
      if (result[fdMatchId]) result[fdMatchId].stats = fresh ?? prevStats
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3 : Fallback FIFA pour matchs WC non trouvés dans ESPN
  // Si ESPN ne retourne pas encore le match (lag ou match tout juste commencé)
  // → utiliser FIFA status en dernier recours (plutôt que rien).
  // ══════════════════════════════════════════════════════════════════════════
  for (const fdMatch of matches) {
    if (result[fdMatch.id]) continue
    const fifaD = fifaByFdId[fdMatch.id]
    if (!fifaD?.fifaRaw) continue

    const fm       = fifaD.fifaRaw
    const prevData = storedData[fdMatch.id]
    // Même correctif "but annulé VAR" (écart numérique/buteurs confirmé sur
    // 2 passes, voir commentaire détaillé dans la branche principale
    // ci-dessus) — ce chemin de repli dépend UNIQUEMENT de FIFA (ESPN pas
    // matché), même exposé au même risque de score/buteur bloqué.
    const bestScorers = confirmedListOrLonger(fifaD.scorers, prevData?.scorers, prevData?.rawScorersLen)
    const fbHomeGoals = bestScorers.filter(s => s.team === 'home').length
    const fbAwayGoals = bestScorers.filter(s => s.team === 'away').length
    const rawFbHome = fifaD.home ?? 0
    const rawFbAway = fifaD.away ?? 0
    const fbHomeNumeric = confirmedOrMax(rawFbHome, prevData?.home, prevData?.rawHome)
    const fbAwayNumeric = confirmedOrMax(rawFbAway, prevData?.away, prevData?.rawAway)
    const rawFbHomeGap = Math.max(0, fbHomeNumeric - fbHomeGoals)
    const rawFbAwayGap = Math.max(0, fbAwayNumeric - fbAwayGoals)
    const fbHomeGapConfirmed = rawFbHomeGap > 0 && rawFbHomeGap === (prevData?.rawGoalGapHome ?? null)
    const fbAwayGapConfirmed = rawFbAwayGap > 0 && rawFbAwayGap === (prevData?.rawGoalGapAway ?? null)
    const fbHomeCancelledGoals = fbHomeGapConfirmed
      ? Math.max(prevData?.homeCancelledGoals ?? 0, rawFbHomeGap)
      : (prevData?.homeCancelledGoals ?? 0)
    const fbAwayCancelledGoals = fbAwayGapConfirmed
      ? Math.max(prevData?.awayCancelledGoals ?? 0, rawFbAwayGap)
      : (prevData?.awayCancelledGoals ?? 0)
    const fbHome = Math.max(fbHomeNumeric - fbHomeCancelledGoals, fbHomeGoals)
    const fbAway = Math.max(fbAwayNumeric - fbAwayCancelledGoals, fbAwayGoals)

    result[fdMatch.id] = {
      espnEventId:  fifaD.fifaMatchId,
      espnSlug:     'fifa',
      espnStatus:   fifaToEspnStatus(fm),
      espnClock:    fifaToClock(fm),
      espnPeriod:   fifaToPeriod(fm),
      home:         fbHome,
      away:         fbAway,
      scorers:      bestScorers,
      rawHome:      rawFbHome,
      rawAway:      rawFbAway,
      rawScorersLen: fifaD.scorers.length,
      rawGoalGapHome: rawFbHomeGap,
      rawGoalGapAway: rawFbAwayGap,
      homeCancelledGoals: fbHomeCancelledGoals,
      awayCancelledGoals: fbAwayCancelledGoals,
      // Pas de source fiable pour les cartons ici (fallback FIFA sans ESPN) →
      // on préserve juste la dernière valeur ESPN connue plutôt que de la perdre.
      cards:        prevData?.cards ?? [],
      stats:        prevData?.stats ?? null,
      // Pas de source fiable pour le score des tab ici (fallback FIFA sans ESPN)
      // → on préserve juste la dernière valeur ESPN connue plutôt que de la perdre.
      homeShootout: prevData?.homeShootout ?? null,
      awayShootout: prevData?.awayShootout ?? null,
      // Préserver l'ID ESPN déjà résolu (voir raccourci de matching plus haut) —
      // sinon un aller-retour en fallback FIFA (ex: fetch ESPN temporairement en
      // échec) ferait perdre le raccourci et forcerait un nouveau fuzzy-match.
      espnRealEventId: prevData?.espnRealEventId ?? null,
      fifaCompId:   fifaD.fifaCompId,
      fifaSeasonId: fifaD.fifaSeasonId,
      fifaStageId:  fifaD.fifaStageId,
      fromCache:    fifaD.fromCache,
      source:       'fifa_fallback',
    }
  }

  // ── Persistance Redis ─────────────────────────────────────────────────────
  // ⚠️ AMÉLIORATION (question utilisateur : "avec plus de matchs, ça va pas
  // exploser le quota Redis ?") : ce coût-là scale VRAIMENT avec le nombre de
  // matchs (contrairement au poll lui-même, dominé par le nombre de
  // compétitions distinctes, pas de matchs) — un kv.set était écrit à CHAQUE
  // poll pour CHAQUE match, même quand rien n'avait changé depuis le poll
  // précédent (cas ultra majoritaire : la plupart des polls d'un match ne
  // voient aucun but/carton/changement de statut). On réécrit maintenant
  // uniquement si le contenu a réellement changé — `fromCache` est exclu de
  // la comparaison (bascule true/false selon le cache FIFA interne sans
  // rapport avec une vraie évolution du match, ce qui aurait fait réécrire
  // à chaque poll quand même). Avec beaucoup de matchs simultanés, la
  // majorité des writes sont désormais évités plutôt que multipliés.
  const stableFields = (data) => {
    const { fromCache, ...rest } = data
    return JSON.stringify(rest)
  }
  const writes = []
  // ── Publication Ably (temps quasi réel) ───────────────────────────────────
  // Même condition que le write-skip Redis ci-dessus (donnée réellement
  // changée) : publiée UNIQUEMENT quand ce poll précis vient de détecter un
  // vrai changement (score, statut, buteur...), jamais à chaque poll pour
  // rien. Effet recherché : le premier client dont le poll tombe sur un cache
  // Redis expiré (donc un vrai fetch upstream) prévient TOUS les autres
  // utilisateurs abonnés au même match instantanément, sans qu'ils aient à
  // attendre leur propre prochain cycle de poll (jusqu'à ~10-20s de moins
  // dans le pire cas). Signal minimal (pas les données complètes) : le
  // client réagit en relançant son poll normal, qui retombera de toute façon
  // sur un cache Redis tout juste rafraîchi (rapide, pas cher) — évite de
  // dupliquer toute la logique de traitement (regression guards, etc.) côté
  // serveur ET côté client sur 2 chemins différents.
  const ablyPublishes = []
  // Marqueurs de fraîcheur (voir FRESH_TTL/fast-path plus haut) — pour TOUS les
  // matchs réellement (re)calculés cette passe (phases 1-3), changés ou pas :
  // seule une VRAIE tentative de calcul justifie de dire "c'est frais", pas
  // juste la persistance Redis (qui elle reste conditionnelle, volontairement,
  // pour ne pas faire remonter le nombre de commandes Redis).
  const freshWrites = []
  for (const [midStr, data] of Object.entries(result)) {
    const prev = storedData[midStr]
    freshWrites.push(kv.set(`fm:fresh:${midStr}`, '1', { ex: FRESH_TTL }))
    if (prev && stableFields(data) === stableFields(prev)) continue
    writes.push(kv.set(`fm:match:${midStr}`, JSON.stringify(data), { ex: MATCH_TTL }))
    if (ablyClient) {
      ablyPublishes.push(
        ablyClient.channels.get(`live-${midStr}`).publish('update', { t: Date.now() }).catch(() => {})
      )
    }
  }
  if (writes.length > 0) await Promise.allSettled(writes)
  if (freshWrites.length > 0) await Promise.allSettled(freshWrites)
  if (ablyPublishes.length > 0) await Promise.allSettled(ablyPublishes)

  // ── Redis last-known pour matchs non trouvés ──────────────────────────────
  for (const m of matches) {
    if (result[m.id]) continue
    const stored = storedData[m.id]
    if (stored) result[m.id] = { ...stored, fromCache: true }
  }

  return res.json(result)
}
