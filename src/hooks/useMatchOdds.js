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
import { calcPronoAdvanced, calcLiveProno, pronoToOdds, pronoFavoriteKey } from '../utils/calcProno'

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
  if (prev && prev.pct?.home === odds.pct.home && prev.pct?.away === odds.pct.away) return
  s[matchId] = { pct: odds.pct, at: Date.now() }
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* plein : mémoire seule */ }
}
export function recallPregamePct(matchId) {
  return store()[matchId]?.pct ?? null
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
  if (espnOdds?.pct && match) rememberPregameOdds(match.id, espnOdds)

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
  const odds = useMarketOdds
    ? { home: espnOdds.decimal.home, draw: espnOdds.decimal.draw, away: espnOdds.decimal.away }
    : { home: pronoToOdds(prono.home), draw: pronoToOdds(prono.draw), away: pronoToOdds(prono.away) }

  return {
    displayPct, odds, favorite: pronoFavoriteKey(displayPct), prono, useMarketOdds,
    isLive, isFinished, isUpcoming, liveMinute, homeScore, awayScore,
    hForm, aForm, teamIdPool, h2hPool, resolvedHomeId, resolvedAwayId, compMatches, formMap,
  }
}
