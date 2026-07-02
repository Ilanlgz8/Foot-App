import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { getClubSeason } from './useMatchs'

// Reconstruit TOUS les buteurs d'une équipe dans une compétition donnée, en
// agrégeant les buts match par match — contrairement au classement buteurs
// officiel (/competitions/{id}/scorers), qui ne liste que le top N global de
// la compétition (voir useScorers.js) et peut donc manquer un joueur qui n'a
// marqué qu'une ou deux fois si la compétition compte beaucoup de buteurs
// différents (typique en Coupe du Monde).
//
// IMPORTANT — bug corrigé : la 1ère version utilisait /v4/teams/{id}/matches
// (sous-ressource "Team / Matches"), qui est revenue systématiquement vide
// en pratique. La doc officielle FD.org montre un exemple de réponse pour
// CE endpoint précis avec "permission": "TIER_THREE" dans les filtres échos
// — signe que ce sous-endpoint est probablement restreint à un palier payant
// et inaccessible avec la clé API (gratuite) de cette app. On utilise donc
// à la place /v4/competitions/{compId}/matches, l'endpoint que le reste de
// l'app utilise déjà avec succès partout ailleurs (Résultat, Programme…), en
// filtrant côté client sur l'équipe recherchée — même source de données,
// donc mêmes garanties d'accès que le reste de l'app.
//
// Le détail des buts (goals[]) n'est inclus dans la liste que via le header
// X-Unfold-Goals (masqué par défaut, voir "Automatic folding" dans la doc
// FD.org), géré par le proxy api/football.js.
//
// N'est appelé qu'à la demande (recherche d'une équipe dans Classement.jsx),
// pas en polling — usage ponctuel, pas de risque de spam sur le quota FD.org.
const STALE_MS = 1000 * 60 * 5 // 5min

export function useTeamScorers(teamId, compId) {
  const key = `teamScorers_${teamId}_${compId}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['teamScorers', teamId, compId],
    queryFn: async () => {
      async function tryFetch(qs) {
        const res = await fdFetch(
          fdUrl(`/api/v4/competitions/${compId}/matches?${qs}`),
          { headers: { 'X-Unfold-Goals': 'true' } }
        )
        if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
        if (!res.ok) return null
        const json = await res.json()
        return json.matches ?? null
      }

      // Même cascade éprouvée que useMatchs.js pour les résultats FINISHED :
      // saison explicite d'abord (WC/EC utilisent l'année civile, les clubs
      // la saison qui vient de se terminer), puis sans filtre de saison si
      // ça ne remonte rien (FD.org peut résoudre "saison courante" sur une
      // édition différente pour les compétitions annuelles).
      const isAnnualIntl = compId === 'WC' || compId === 'EC'
      const season = isAnnualIntl ? new Date().getFullYear() : getClubSeason()

      let matches = await tryFetch(`status=FINISHED&season=${season}&limit=500`)
      if (!matches || matches.length === 0) {
        matches = await tryFetch(`status=FINISHED&limit=500`)
      }
      matches = matches ?? []

      // Ne garder que les matchs de l'équipe recherchée (domicile ou extérieur)
      const teamMatches = matches.filter(m => m.homeTeam?.id === teamId || m.awayTeam?.id === teamId)

      // Agrège les buts (et passes décisives) par joueur, à partir de
      // goals[] déplié sur chaque match.
      const map = new Map()
      const bump = (scorer, teamObj, field) => {
        if (!scorer?.id) return
        if (!map.has(scorer.id)) {
          map.set(scorer.id, { player: { id: scorer.id, name: scorer.name }, team: teamObj, goals: 0, assists: 0 })
        }
        map.get(scorer.id)[field] += 1
      }
      for (const m of teamMatches) {
        for (const g of m.goals ?? []) {
          const isHome  = g.team?.id === m.homeTeam?.id
          const teamObj = isHome ? m.homeTeam : m.awayTeam
          // On ne compte que les buts de l'équipe recherchée (un match
          // contient aussi les buts de l'adversaire).
          if (teamObj?.id !== teamId) continue
          bump(g.scorer, teamObj, 'goals')
          if (g.assist) bump(g.assist, teamObj, 'assists')
        }
      }

      const list = [...map.values()].sort((a, b) => b.goals - a.goals)
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
