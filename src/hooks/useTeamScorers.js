import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'

// Reconstruit TOUS les buteurs d'une équipe dans une compétition donnée, en
// agrégeant les buts match par match — contrairement au classement buteurs
// officiel (/competitions/{id}/scorers), qui ne liste que le top N global de
// la compétition (voir useScorers.js) et peut donc manquer un joueur qui n'a
// marqué qu'une ou deux fois si la compétition compte beaucoup de buteurs
// différents (typique en Coupe du Monde).
//
// Contrainte réelle de l'API : le sous-ressource "Team / Matches" ne propose
// PAS de filtre par compétition (seulement dateFrom/dateTo/season/status/
// venue/limit — voir docs.football-data.org/general/v4/team.html) : on
// récupère donc TOUS les matchs de l'équipe sur la saison, puis on filtre
// côté client sur la compétition demandée. Le détail des buts (goals[])
// n'est inclus que via le header X-Unfold-Goals (masqué par défaut), géré
// par le proxy api/football.js.
//
// N'est appelé qu'à la demande (recherche d'une équipe dans Classement.jsx),
// pas en polling — usage ponctuel, pas de risque de spam sur le quota FD.org.
const STALE_MS = 1000 * 60 * 5 // 5min

export function useTeamScorers(teamId, compId) {
  const key = `teamScorers_${teamId}_${compId}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['teamScorers', teamId, compId],
    queryFn: async () => {
      const season = new Date().getFullYear()
      const url = fdUrl(`/api/v4/teams/${teamId}/matches?season=${season}&status=FINISHED&limit=500`)
      const res = await fdFetch(url, { headers: { 'X-Unfold-Goals': 'true' } })
      if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
      if (!res.ok) return []
      const json = await res.json()
      const matches = (json.matches ?? []).filter(m =>
        m.competition?.code === compId || m.competition?.id === compId
      )

      // Agrège les buts (et passes decisives) par joueur, à partir de
      // goals[] déplié sur chaque match.
      const map = new Map()
      const bump = (scorer, teamObj, field) => {
        if (!scorer?.id) return
        if (!map.has(scorer.id)) {
          map.set(scorer.id, { player: { id: scorer.id, name: scorer.name }, team: teamObj, goals: 0, assists: 0 })
        }
        map.get(scorer.id)[field] += 1
      }
      for (const m of matches) {
        for (const g of m.goals ?? []) {
          const isHome  = g.team?.id === m.homeTeam?.id
          const teamObj = isHome ? m.homeTeam : m.awayTeam
          bump(g.scorer, teamObj, 'goals')
          if (g.assist) bump(g.assist, teamObj, 'assists')
        }
      }

      const list = [...map.values()]
        // Ne garder que les buts/passes de l'équipe recherchée (matches
        // inclut aussi des adversaires, dont on ne veut pas ici)
        .filter(s => s.team?.id === teamId)
        .sort((a, b) => b.goals - a.goals)

      writeCache(key, list, STALE_MS)
      return list
    },
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            STALE_MS,
    retry:                false,
    enabled:              !!teamId && !!compId,
  })

  return {
    scorers: data ?? [],
    loading: isLoading,
    error:   error?.message === '429' ? null : (error?.message ?? null),
  }
}
