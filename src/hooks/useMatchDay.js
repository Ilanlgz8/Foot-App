// Données d'une journée (page Match, onglet "Tous les matchs").
// Reprend EXACTEMENT la fusion déjà utilisée par l'Accueil pour le panneau
// "matchs du jour" (rawMatches + filet upcomingAllComps + matchs live non
// rattachés + overrides tableau final Coupe du monde), sans la refactoriser
// dans Accueil.jsx pour ne pas toucher à ce composant fragile.
import { useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTodayMatches, prefetchMatchesForDate } from './useTodayMatches'
import { useUpcomingMatchesAllComps } from './useMatchs'
import { useWcKnockout, getKnockoutTeamOverrides, applyKnockoutTeamOverrides } from './useWcKnockout'
import { useTeamFormMulti } from './useTeamForm'
import { useLiveData } from '../context/LiveProvider'
import { COMPETITIONS } from '../data/competitions'
import { getTargetDate, isDuplicateMatch, localDateStr } from '../utils/dayUtils'

const ALL_COMP_IDS = COMPETITIONS.map(c => c.id)
const DAY_MS = 86_400_000

export function useMatchDay(dayOffset) {
  const targetDate  = getTargetDate(dayOffset)
  const queryClient = useQueryClient()
  const { matches: rawMatches, loading } = useTodayMatches(targetDate)
  const { liveMatches, espnScores } = useLiveData()
  const { matches: upcomingAllComps } = useUpcomingMatchesAllComps(ALL_COMP_IDS, 30)
  const { rounds: wcRounds } = useWcKnockout('WC')
  const knockoutOverrides = useMemo(() => getKnockoutTeamOverrides(wcRounds), [wcRounds])

  const matches = useMemo(() => {
    const extra = upcomingAllComps.filter(m =>
      !isDuplicateMatch(m, rawMatches) && m.utcDate && localDateStr(m.utcDate) === targetDate
    )
    let merged = [...rawMatches, ...extra]
    if (dayOffset === 0 && liveMatches.length > 0) {
      const stillLive = liveMatches.filter(m => !isDuplicateMatch(m, merged))
      if (stillLive.length > 0) merged = [...merged, ...stillLive]
    }
    return applyKnockoutTeamOverrides(merged, knockoutOverrides)
  }, [rawMatches, upcomingAllComps, targetDate, knockoutOverrides, dayOffset, liveMatches])

  const formCompCodes = useMemo(() => {
    const codes = new Set()
    for (const m of matches) if (m.competition?.code) codes.add(m.competition.code)
    return [...codes]
  }, [matches])
  const { formMapByComp, matchesByComp } = useTeamFormMulti(formCompCodes)

  // Jour suivant = prochain jour AVEC un match connu (30 j) ; jour précédent =
  // plancher à aujourd'hui (les jours passés sont dans "Résultats"). Même règle
  // que les flèches du panneau de l'Accueil.
  const nextMatchDayOffset = useMemo(() => {
    const endOfTargetDay = new Date(`${targetDate}T23:59:59`).getTime()
    const next = upcomingAllComps.find(m => new Date(m.utcDate).getTime() > endOfTargetDay)
    if (!next) return null
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const next0  = new Date(next.utcDate); next0.setHours(0, 0, 0, 0)
    return Math.round((next0 - today0) / DAY_MS)
  }, [targetDate, upcomingAllComps])

  const prevMatchDayOffset = useMemo(() => {
    if (dayOffset <= 0) return null
    const startOfTargetDay = new Date(`${targetDate}T00:00:00`).getTime()
    const before = upcomingAllComps.filter(m => new Date(m.utcDate).getTime() < startOfTargetDay)
    if (before.length === 0) return 0
    const prev = before[before.length - 1]
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const prev0  = new Date(prev.utcDate); prev0.setHours(0, 0, 0, 0)
    return Math.max(0, Math.round((prev0 - today0) / DAY_MS))
  }, [targetDate, upcomingAllComps, dayOffset])

  // Préchargement du jour suivant (même principe que l'Accueil).
  useEffect(() => {
    if (loading) return
    let cancelled = false
    const id = setTimeout(() => {
      if (!cancelled) prefetchMatchesForDate(queryClient, getTargetDate(dayOffset + 1))
    }, 2000)
    return () => { cancelled = true; clearTimeout(id) }
  }, [dayOffset, loading, queryClient])

  return {
    matches, loading, targetDate, espnScores, liveMatches,
    formMapByComp, matchesByComp,
    nextMatchDayOffset, prevMatchDayOffset,
  }
}
