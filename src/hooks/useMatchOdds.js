/**
 * useMatchOdds.js — cotes d'UN match, calculées d'une seule façon pour toute l'app (18/11).
 *
 * Constat utilisateur : « les cotes des cartes (Accueil / Match) ne sont pas les mêmes que dans
 * la page du match ». Cause : 4 calculs séparés (MatchPoster, MatchDuJourCard, LiveStatsTab,
 * PreMatchProno) avec des entrées légèrement différentes — ids d'équipe résolus sur des listes
 * différentes, historique H2H différent, score du direct pris à une autre source, et la cote de
 * marché d'avant-match gardée en mémoire DANS chaque composant (perdue si la page est ouverte
 * après le coup d'envoi → repli sur le modèle interne, d'où un autre chiffre).
 *
 * Désormais TOUS passent par ce hook : mêmes entrées, même calcul → mêmes chiffres partout.
 * La référence reste la logique des cartes de l'Accueil (décision utilisateur, voir MatchModal) :
 *   - avant le match : vraie cote de marché ESPN si dispo, sinon calcPronoAdvanced ;
 *   - en direct     : calcLiveProno (score, minute, cartons rouges, possession, tirs cadrés,
 *                     corners) en partant de la dernière cote de marché d'avant-match.
 * Cette dernière est gardée dans une mémoire PARTAGÉE (module + localStorage, par match), pour
 * que la carte et la page partent du même point même si l'une a été ouverte avant l'autre.
 *
 * Aucune requête en plus : tous les hooks utilisés ici passent par React Query (dédupliqués).
 */
import { useTeamForm, formKey } from './useTeamForm'
import { useH2HHistory, useLowerDivisionStats } from './useMatchs'
import { useEspnPregameOdds } from './useMatchDetail'
import { useH2HRows } from '../components/MatchModal'
import { useLiveData } from '../context/LiveProvider'
import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, mergeScore, finalScore, isNeutralVenueComp, resolveFdTeamId } from '../utils/matchUtils'
import { calcPronoAdvanced, calcLiveProno, pronoToOdds, pronoFavoriteKey, qualificationOdds } from '../utils/calcProno'

// ── Mémoire partagée de la dernière cote de marché d'avant-match ─────────────────────────────────
const LS_KEY = 'sf_pregameOdds'
const KEEP_MS = 2 * 24 * 3600 * 1000
let memo = null
function store() {
  if (memo) return memo
  memo = {}
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      const now = Date.now()
      for (const [id, v] of Object.entries(raw)) if (v?.at && now - v.at < KEEP_MS) memo[id] = v
    }
  } catch { /* stockage indisponible : mémoire seule */ }
  return memo
}
export function rememberPregameOdds(matchId, odds) {
  if (!matchId || !odds?.pct) return
  const s = store()
  const prev = s[matchId]
  if (prev && prev.pct?.home === odds.pct.home && prev.pct?.away === odds.pct.away && prev.pct?.draw === odds.pct.draw
      && prev.decimal?.home === odds.decimal?.home) return
  s[matchId] = { pct: odds.pct, decimal: odds.decimal ?? null, at: Date.now() }
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* plein : mémoire seule */ }
}
export function recallPregamePct(matchId) {
  return store()[matchId]?.pct ?? null
}
function recallPregame(matchId) {
  return store()[matchId] ?? null
}

// ── Le hook ──────────────────────────────────────────────────────────────────────────────────────
// opts.formMap / opts.compMatches : données déjà chargées par le parent (listes de cartes) — sinon
// chargées ici (même source, même cache). espnScore : null/objet ; undefined = celui du direct.
export function useMatchOdds(match, espnScoreArg, opts = {}) {
  const { espnScores } = useLiveData()
  const espnScore = espnScoreArg !== undefined ? espnScoreArg : (espnScores?.[match?.id] ?? null)
  const compCode = match?.competition?.code ?? null
  const hasPropsData = opts.formMap !== undefined
  const fetched = useTeamForm(compCode, 0, !hasPropsData)
  const formMap     = hasPropsData ? opts.formMap : fetched.formMap
  const compMatches = hasPropsData ? (opts.compMatches ?? []) : (fetched.compMatches ?? [])
  const h2hHistory = useH2HHistory(compCode, compMatches)
  const h2hPool = (compMatches?.length || h2hHistory?.length) ? [...compMatches, ...(h2hHistory ?? [])] : compMatches
  const { rows: dedicatedH2H } = useH2HRows(match, h2hPool, 0, { looseTeamMatch: true })
  const fullH2H = dedicatedH2H.length > 0 ? dedicatedH2H : h2hPool
  const lowerDivMatches = useLowerDivisionStats(compCode, compMatches)

  const ms = match ? getMatchState(match.id) : {}
  const espnLive = ms.espnStatus === 'STATUS_IN_PROGRESS' || ms.espnStatus === 'STATUS_HALFTIME' || ms.espnStatus === 'STATUS_END_PERIOD'
  const isFinished = !!match && (ms.ft === true || (match.status === 'FINISHED' && !espnLive))
  const liveMinute = (match && !isFinished) ? calcMinute(match) : null
  const isLive = !!match && !isFinished && (
    match.status === 'IN_PLAY' || match.status === 'PAUSED' || match.status === 'HALFTIME' ||
    espnLive || liveMinute !== null
  )
  const isUpcoming = !!match && !isFinished && !isLive

  const { data: espnOdds } = useEspnPregameOdds(match, !!match && !isFinished)

  if (!match) return null

  const fs = finalScore(match.score)
  const homeScore = mergeScore(espnScore?.home, fs.home)
  const awayScore = mergeScore(espnScore?.away, fs.away)

  const teamIdPool = dedicatedH2H.length > 0 ? [...h2hPool, ...dedicatedH2H] : h2hPool
  const resolvedHomeId = resolveFdTeamId(match.homeTeam, teamIdPool, { loose: true, strict: true })
  const resolvedAwayId = resolveFdTeamId(match.awayTeam, teamIdPool, { loose: true, strict: true })
  const formHomeId = resolveFdTeamId(match.homeTeam, h2hPool, { loose: true, strict: true })
  const formAwayId = resolveFdTeamId(match.awayTeam, h2hPool, { loose: true, strict: true })
  const hForm = formMap?.[formKey(match, formHomeId)] ?? []
  const aForm = formMap?.[formKey(match, formAwayId)] ?? []

  // Direct sans cote d'avant-match mémorisée (app jamais ouverte avant le coup d'envoi) : repli sur
  // la cote de marché d'avant-match ESPN si elle existe — posée AVANT le calcul, pour ne pas sauter
  // au rendu suivant.
  if (isLive && !recallPregamePct(match.id) && espnOdds?.pct) rememberPregameOdds(match.id, espnOdds)
  const st = espnScore?.stats
  const prono = isLive
    ? calcLiveProno(hForm, aForm, homeScore, awayScore, liveMinute, {
        homeId: resolvedHomeId, awayId: resolvedAwayId, compMatches,
        fullH2H, lowerDivMatches,
        neutralVenue:      isNeutralVenueComp(match),
        homeRedCards:      st?.home?.redCards,
        awayRedCards:      st?.away?.redCards,
        homePoss:          st?.home?.poss,
        awayPoss:          st?.away?.poss,
        homeShotsOnTarget: st?.home?.shotsOnTarget,
        awayShotsOnTarget: st?.away?.shotsOnTarget,
        homeCorners:       st?.home?.corners,
        awayCorners:       st?.away?.corners,
        marketPre:         recallPregamePct(match.id),
      })
    : calcPronoAdvanced(resolvedHomeId, resolvedAwayId, compMatches, hForm, aForm, {
        fullH2H, lowerDivMatches,
        neutralVenue: isNeutralVenueComp(match),
      })

  const useMarketOdds = isUpcoming && !!espnOdds
  const displayPct = useMarketOdds ? espnOdds.pct : prono
  // 19/11 : on mémorise la cote AFFICHÉE avant le match (marché ESPN OU modèle interne) — c'est d'elle
  // que le direct repart (calcLiveProno, marketPre), pour qu'il n'y ait plus de saut au coup d'envoi.
  // Repli si l'app n'a jamais montré ce match avant le coup d'envoi : la cote de marché d'avant-match.
  let odds = useMarketOdds
    ? { home: espnOdds.decimal.home, draw: espnOdds.decimal.draw, away: espnOdds.decimal.away }
    : { home: pronoToOdds(prono.home), draw: pronoToOdds(prono.draw), away: pronoToOdds(prono.away) }
  if (isUpcoming) rememberPregameOdds(match.id, { pct: displayPct, decimal: odds })
  // En direct : la cote de marché a sa propre marge, différente de celle de pronoToOdds — sans
  // correction, « 2,30 » avant le match devenait « 2,34 » à la 1re minute. On applique à chaque issue
  // le petit écart (borné ±10 %) constaté sur la cote d'avant-match, pour repartir PILE de son chiffre.
  if (isLive) {
    const pre = recallPregame(match.id)
    if (pre?.decimal && pre?.pct) {
      const adj = k => {
        const f = pre.decimal[k] / pronoToOdds(pre.pct[k])
        return Number.isFinite(f) ? Math.min(1.1, Math.max(0.9, f)) : 1
      }
      odds = {
        home: Math.max(1.01, Math.round(odds.home * adj('home') * 100) / 100),
        draw: Math.max(1.01, Math.round(odds.draw * adj('draw') * 100) / 100),
        away: Math.max(1.01, Math.round(odds.away * adj('away') * 100) / 100),
      }
    }
  }

  // Prolongations / tirs au but (périodes ESPN 3, 4, 5) : plus de match nul possible → cotes de
  // QUALIFICATION à 2 issues, exactement comme la page du direct (LiveStatsTab → LiveProno,
  // même règle espnPeriod, même qualificationOdds, même favori). 18/11, constat utilisateur.
  const isQualification = isLive && (ms.espnPeriod === 3 || ms.espnPeriod === 4 || ms.espnPeriod === 5)
  let qualification = null
  if (isQualification) {
    const q = qualificationOdds(displayPct)
    qualification = {
      pct: q,
      odds: { home: pronoToOdds(q.home), away: pronoToOdds(q.away) },
      favorite: q.home >= q.away ? 'home' : 'away',
    }
  }

  return {
    displayPct, odds, favorite: pronoFavoriteKey(displayPct), prono, useMarketOdds, qualification,
    isLive, isFinished, isUpcoming, liveMinute, homeScore, awayScore,
    hForm, aForm, teamIdPool, h2hPool, resolvedHomeId, resolvedAwayId, compMatches, formMap,
  }
}
