import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { classifyFetchError } from '../utils/fetchErrors'

// ── useCrossCompH2H — confrontations directes entre 2 équipes, PEU IMPORTE
// leur championnat respectif ──────────────────────────────────────────────
//
// ⚠️ AJOUT (28/08, demande utilisateur — simulateur de confrontation
// hypothétique dans Pronos.jsx) : tous les hooks H2H existants de l'app
// (useH2HHistory, useH2HRows...) sont scopés à UNE compétition (ils lisent
// dans compMatches, déjà chargé pour cette compétition précise) — aucun ne
// peut répondre à "est-ce que ces 2 équipes-là, MÊME de championnats
// différents, se sont déjà affrontées" (ex. PSG-Bayern en Ligue des
// Champions alors qu'on compare depuis Ligue 1/Bundesliga).
//
// football-data.org expose /v4/teams/{id}/matches : TOUT l'historique
// d'UNE équipe, toutes compétitions confondues — jamais utilisé ailleurs
// dans l'app jusqu'ici. Un seul appel (équipe domicile), filtré côté client
// pour ne garder que les matchs contre l'équipe extérieure — TOUTES ses
// confrontations apparaissent déjà dans cette liste (elle contient ses
// matchs domicile ET extérieur), pas besoin d'un 2e appel symétrique.
//
// Volontairement PAS auto-déclenché : seulement quand l'utilisateur clique
// "Comparer" (enabled), jamais en arrière-plan — un appel FD.org de plus par
// clic explicite reste dans l'esprit du budget partagé (7 req/min, voir
// CLAUDE.md), contrairement à un fetch qui se répéterait à chaque
// changement de sélection dans les menus déroulants.
const STALE_MS = 1000 * 60 * 60 * 24  // 24h — un historique de confrontations ne change qu'après un nouveau match entre les 2, rarissime

export function useCrossCompH2H(homeId, awayId, enabled) {
  const key = `crossH2H_${homeId}_${awayId}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['crossCompH2H', homeId, awayId],
    queryFn: async () => {
      const url = fdUrl(`/api/v4/teams/${homeId}/matches?status=FINISHED&limit=100`)
      const res = await fdFetch(url)
      if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      const all = json.matches ?? []
      const meetings = all.filter(m =>
        (m.homeTeam?.id === homeId && m.awayTeam?.id === awayId) ||
        (m.homeTeam?.id === awayId && m.awayTeam?.id === homeId)
      )
      writeCache(key, meetings, STALE_MS)
      return meetings
    },
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            STALE_MS,
    retry:                false,
    enabled:               enabled && homeId != null && awayId != null,
  })

  return {
    meetings: data ?? [],
    loading:  isLoading,
    error:    classifyFetchError(error?.message),
  }
}
