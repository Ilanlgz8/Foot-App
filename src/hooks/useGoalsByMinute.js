// useGoalsByMinute — répartition des buts par tranche de minute de jeu, sur
// TOUS les matchs terminés d'une compétition (onglet Tendances).
//
// Pourquoi ESPN et pas football-data.org : FD.org (plan gratuit, 10 req/min)
// n'expose pas la minute exacte de chaque but dans la liste des matchs, il
// faudrait un appel détaillé par match — hors budget. ESPN, en revanche, est
// déjà documenté ailleurs dans l'app comme "gratuit, illimité" (voir
// useProbableLineups) et chaque summary est mis en cache côté serveur 7 jours
// dans Redis, PARTAGÉ entre tous les utilisateurs (voir api/espn.js) — donc
// ce coût (1 scoreboard par date + 1 summary par match) n'est payé qu'UNE
// SEULE FOIS par match, par le premier utilisateur qui ouvre Tendances après
// que ce match soit terminé. Aucune nouvelle fonction serverless : on
// réutilise /api/espn.js tel quel (mode scoreboard + mode summary, déjà
// utilisés par useEspnMatchDetail.js).
import { useQuery } from '@tanstack/react-query'
import { fuzzyTeam } from './useLiveMinute'
import { extractGoalMinutes } from './useEspnMatchDetail'
import { COMPETITION_ESPN_SLUG } from '../data/competitions'

const BUCKET_ORDER = ['0-15', '16-30', '31-45', '46-60', '61-75', '76-90', '90+']

function espnDateStr(utcDate) {
  const d = new Date(utcDate)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

// "45+2'" → 45 (le "+2" de temps additionnel n'affecte pas la tranche —
// un but à 45+2 reste un but de fin de 1ère mi-temps, pas de 2e).
function baseMinute(displayValue) {
  const m = String(displayValue ?? '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function bucketFor(minute) {
  if (minute == null) return null
  if (minute <= 15) return '0-15'
  if (minute <= 30) return '16-30'
  if (minute <= 45) return '31-45'
  if (minute <= 60) return '46-60'
  if (minute <= 75) return '61-75'
  if (minute <= 90) return '76-90'
  return '90+'
}

export function useGoalsByMinute(selectedComp, finishedMatches) {
  const slug = COMPETITION_ESPN_SLUG[selectedComp] ?? null
  const matches = finishedMatches ?? []
  const matchIds = matches.map(m => m.id).join(',')

  return useQuery({
    queryKey: ['goalsByMinute', selectedComp, matchIds],
    enabled: !!slug && matches.length > 0,
    staleTime: 15 * 60_000,
    retry: 1,
    queryFn: async () => {
      // 1. Grouper par date ESPN — un seul appel scoreboard par jour distinct,
      // au lieu d'un appel par match, pour retrouver l'eventId de chacun.
      const byDate = new Map()
      for (const m of matches) {
        if (!m?.utcDate) continue
        const day = espnDateStr(m.utcDate)
        if (!byDate.has(day)) byDate.set(day, [])
        byDate.get(day).push(m)
      }

      const eventIds = []
      await Promise.all([...byDate.entries()].map(async ([day, dayMatches]) => {
        try {
          const res = await fetch(`/espn?slug=${slug}&dates=${day}`)
          if (!res.ok) return
          const board = await res.json()
          for (const m of dayMatches) {
            const fdHome = m.homeTeam?.name ?? m.homeTeam?.shortName ?? ''
            const fdAway = m.awayTeam?.name ?? m.awayTeam?.shortName ?? ''
            for (const evt of board.events ?? []) {
              const comp  = evt.competitions?.[0]
              const homeC = (comp?.competitors ?? []).find(c => c.homeAway === 'home')
              const awayC = (comp?.competitors ?? []).find(c => c.homeAway === 'away')
              if (!homeC || !awayC) continue
              const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
              const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
              if (fuzzyTeam(fdHome, espnHome) && fuzzyTeam(fdAway, espnAway)) {
                eventIds.push(evt.id)
                break
              }
            }
          }
        } catch { /* jour ignoré si erreur réseau — pas bloquant pour le reste */ }
      }))

      // 2. Summary par match résolu → minutes de but réelles
      const buckets = Object.fromEntries(BUCKET_ORDER.map(k => [k, 0]))
      let totalGoals = 0

      await Promise.all(eventIds.map(async (eventId) => {
        try {
          const res = await fetch(`/espn?slug=${slug}&eventId=${eventId}`)
          if (!res.ok) return
          const summary = await res.json()
          for (const raw of extractGoalMinutes(summary)) {
            const bucket = bucketFor(baseMinute(raw))
            if (bucket) { buckets[bucket]++; totalGoals++ }
          }
        } catch { /* match ignoré si erreur réseau */ }
      }))

      return {
        rounds: BUCKET_ORDER.map(key => ({ key, label: key, goals: buckets[key] })),
        totalGoals,
        resolvedMatches: eventIds.length,
      }
    },
  })
}
