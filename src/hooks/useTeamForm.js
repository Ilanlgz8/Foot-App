import { useQuery, useQueries } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCache, getCacheSavedAt, writeCache } from './localCache'
import { finalScore } from '../utils/matchUtils'

// Retourne 'W', 'L' ou 'D' selon les buts marqués et encaissés
function getResult(myGoals, theirGoals) {
  if (myGoals > theirGoals) return 'W'
  if (myGoals < theirGoals) return 'L'
  return 'D'
}

// Aligné sur le cache serveur (api/football.js retourne déjà ce endpoint avec un
// TTL de 2min par défaut) — 30min côté client empêchait de profiter d'une donnée
// pourtant déjà plus fraîche côté serveur.
const FORM_STALE = 1000 * 60 * 2  // 2min (était 30min)

// Logique de fetch factorisée — réutilisée par useTeamForm (1 compétition) et
// useTeamFormMulti (plusieurs compétitions mélangées, voir plus bas).
async function fetchTeamForm(selectedComp) {
  // WC 2026 : forcer season=2026 sinon FD.org renvoie WC 2022
  // Euro : même problème (compétition non-annuelle, FD.org peut résoudre une
  // vieille édition sans ?season= explicite — voir useWcKnockout.js) — année
  // courante plutôt qu'une valeur figée, pas d'édition Euro connue à l'avance
  // ici contrairement à WC 2026.
  // On NE filtre PAS status=FINISHED côté serveur (non supporté par le free tier FD.org
  // sur certains endpoints) → on filtre côté client
  const seasonParam = selectedComp === 'WC' ? '?season=2026'
    : selectedComp === 'EC' ? `?season=${new Date().getFullYear()}`
    : ''
  const res = await fdFetch(
    fdUrl(`/api/v4/competitions/${selectedComp}/matches${seasonParam}`)
  )
  // 429 → throw pour que React Query retente (rate limit temporaire)
  if (res.status === 429) throw new Error('rate_limit')
  if (!res.ok) return { formMap: {}, matches: [] }

  const json = await res.json()
  // Filtrer les matchs terminés côté client
  const matches = (json.matches ?? []).filter(m => m.status === 'FINISHED')

  const formMap = {}

  matches.forEach(match => {
    const homeId = match.homeTeam.id
    const awayId = match.awayTeam.id
    // ⚠️ NE PAS lire match.score.fullTime directement : pour un match décidé
    // aux tirs au but, FD.org y met regularTime+extraTime+penalties CUMULÉS
    // (bug confirmé en prod), pas le score 120min — voir finalScore() dans
    // matchUtils.js pour le détail. Sans ce fix, un match gagné aux tab
    // pouvait ressortir 'L' (défaite) dans "Forme récente" au lieu de 'W'.
    const { home: homeGoals, away: awayGoals } = finalScore(match.score)

    if (homeGoals === null || awayGoals === null) return

    // Aux tirs au but, le score 120min est TOUJOURS à égalité : le vrai
    // vainqueur se lit dans score.penalties (même convention que partout
    // ailleurs dans l'app, voir MatchModal.jsx FormDiamonds).
    let homeResult, awayResult
    if (match.score?.duration === 'PENALTY_SHOOTOUT' &&
        match.score?.penalties?.home != null && match.score?.penalties?.away != null) {
      const { home: hp, away: ap } = match.score.penalties
      homeResult = hp > ap ? 'W' : 'L'
      awayResult = ap > hp ? 'W' : 'L'
    } else {
      homeResult = getResult(homeGoals, awayGoals)
      awayResult = getResult(awayGoals, homeGoals)
    }

    if (!formMap[homeId]) formMap[homeId] = []
    if (!formMap[awayId]) formMap[awayId] = []

    formMap[homeId].push(homeResult)
    formMap[awayId].push(awayResult)
  })

  // Garde seulement les 5 derniers résultats par équipe
  Object.keys(formMap).forEach(id => {
    formMap[id] = formMap[id].slice(-5)
  })

  return { formMap, matches }
}

export function useTeamForm(selectedComp) {
  const cacheKey = `teamform2_${selectedComp}`

  const { data, isLoading } = useQuery({
    queryKey: ['teamForm2', selectedComp, selectedComp === 'WC' ? '2026' : 'cur'],
    queryFn: () => {
      const result = fetchTeamForm(selectedComp)
      result.then(r => writeCache(cacheKey, r, FORM_STALE))
      return result
    },
    enabled:              !!selectedComp,
    initialData:          readCache(cacheKey) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(cacheKey),
    staleTime:            FORM_STALE,
    retry:                2,
    retryDelay:           attempt => Math.min(1000 * 2 ** attempt, 15_000)
  })

  return {
    formMap:     data?.formMap  ?? {},
    // Matches bruts — utilisés pour extraire le H2H en modal
    compMatches: data?.matches ?? [],
    isLoading,
  }
}

// ── useTeamFormMulti ──────────────────────────────────────────────────────
// L'Accueil affiche des matchs de plusieurs championnats mélangés (contrairement
// à Classement/MatchModal/MatchPoster qui sont toujours dans le contexte d'UNE
// seule compétition) — un formMap fusionné pour toutes les compétitions
// présentes dans les listes affichées. Même queryKey que useTeamForm ci-dessus
// → partage de cache si l'utilisateur a déjà consulté Classement pour l'une
// de ces compétitions (pas de double fetch).
export function useTeamFormMulti(compCodes) {
  const codes = [...new Set((compCodes ?? []).filter(Boolean))]

  const results = useQueries({
    queries: codes.map(code => {
      const cacheKey = `teamform2_${code}`
      return {
        queryKey:             ['teamForm2', code, code === 'WC' ? '2026' : 'cur'],
        queryFn:              () => {
          const result = fetchTeamForm(code)
          result.then(r => writeCache(cacheKey, r, FORM_STALE))
          return result
        },
        initialData:          readCache(cacheKey) ?? undefined,
        initialDataUpdatedAt: getCacheSavedAt(cacheKey),
        staleTime:            FORM_STALE,
        retry:                2,
        retryDelay:           attempt => Math.min(1000 * 2 ** attempt, 15_000),
      }
    }),
  })

  const formMap = {}
  for (const r of results) Object.assign(formMap, r.data?.formMap ?? {})

  return { formMap, isLoading: results.some(r => r.isLoading) }
}
