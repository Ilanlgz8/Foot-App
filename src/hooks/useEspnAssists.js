// useEspnAssists — classement des passes décisives via ESPN (api/espn-assists.js)
//
// Remplace useAflTopAssists (api-football) : le plan gratuit api-football ne
// couvre pas la saison en cours (2025/2026), rendant ce classement vide en
// permanence tant que le compte n'est pas passé sur un plan payant. ESPN a la
// même donnée à jour (page publique, pas d'API JSON dédiée trouvée pour ce
// point précis) — voir api/espn-assists.js pour le détail du parsing et ses
// limites (peut casser si ESPN change la structure de sa page).
import { useQuery } from '@tanstack/react-query'
import { COMPETITION_ESPN_SLUG } from '../data/competitions'

async function afetch(slug) {
  const res = await fetch(`/espn-assists?slug=${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error(`espn-assists ${res.status}`)
  const data = await res.json()
  const errs = data?.errors
  if (errs && Object.keys(errs).length > 0) {
    throw new Error(`espn-assists: ${Object.values(errs).join(' / ')}`)
  }
  return data?.response ?? []
}

export function useEspnAssists(compId) {
  const slug = COMPETITION_ESPN_SLUG[compId]
  return useQuery({
    queryKey: ['espnAssists', compId],
    queryFn:  () => afetch(slug),
    enabled:   !!slug,
    // La page ESPN elle-même n'est mise à jour que "nightly" (indiqué sur la
    // page) — inutile de repoller plus souvent côté client.
    staleTime: 10 * 60_000,
    retry: 1,
  })
}
