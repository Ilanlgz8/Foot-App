import { useQuery, useQueries } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCache, getCacheSavedAt, writeCache } from './localCache'
import { outcomeForTeam } from '../utils/matchUtils'
import { getClubSeason } from './useMatchs'
import { MIN_LEAGUE_GAMES } from '../utils/calcProno'

// Aligné sur le cache serveur (api/football.js retourne déjà ce endpoint avec un
// TTL de 2min par défaut) — 30min côté client empêchait de profiter d'une donnée
// pourtant déjà plus fraîche côté serveur.
const FORM_STALE = 1000 * 60 * 2  // 2min (était 30min)

// Un seul fetch "saison" FD.org (season explicite optionnel) → matchs FINISHED
// côté client (status=FINISHED non supporté par le free tier sur certains
// endpoints). Factorisé pour être réutilisé par la saison en cours ET le
// repli saison précédente ci-dessous.
async function fetchFinishedSeasonMatches(selectedComp, seasonParam) {
  const res = await fdFetch(
    fdUrl(`/api/v4/competitions/${selectedComp}/matches${seasonParam}`)
  )
  // 429 → throw pour que React Query retente (rate limit temporaire)
  if (res.status === 429) throw new Error('rate_limit')
  if (!res.ok) return []
  const json = await res.json()
  return (json.matches ?? []).filter(m => m.status === 'FINISHED')
}

// ⚠️ BUG CORRIGÉ (constat utilisateur : "Forme récente" de l'Angleterre
// n'affichait pas son dernier match joué au Mondial 2026) : on lisait avant
// directement le score numérique (finalScore) pour déterminer W/D/L, qui
// peut être temporairement absent juste après le coup de sifflet final
// (FD.org marque parfois FINISHED avant d'avoir fini de renseigner le score
// détaillé) — le match disparaissait alors silencieusement de la liste au
// lieu d'apparaître. outcomeForTeam() (matchUtils.js) résout ça en
// préférant score.winner (champ catégorique, disponible plus tôt) et ne
// retombe sur le score numérique qu'en dernier recours.
function buildFormMap(matches) {
  const formMap = {}
  matches.forEach(match => {
    const homeId = match.homeTeam.id
    const awayId = match.awayTeam.id
    const homeResult = outcomeForTeam(match, homeId)
    const awayResult = outcomeForTeam(match, awayId)
    if (!homeResult || !awayResult) return

    if (!formMap[homeId]) formMap[homeId] = []
    if (!formMap[awayId]) formMap[awayId] = []

    formMap[homeId].push(homeResult)
    formMap[awayId].push(awayResult)
  })

  // Garde seulement les 5 derniers résultats par équipe
  Object.keys(formMap).forEach(id => {
    formMap[id] = formMap[id].slice(-5)
  })

  return formMap
}

// Logique de fetch factorisée — réutilisée par useTeamForm (1 compétition) et
// useTeamFormMulti (plusieurs compétitions mélangées, voir plus bas).
async function fetchTeamForm(selectedComp) {
  // WC 2026 : forcer season=2026 sinon FD.org renvoie WC 2022
  // Euro : même problème (compétition non-annuelle, FD.org peut résoudre une
  // vieille édition sans ?season= explicite — voir useWcKnockout.js) — année
  // courante plutôt qu'une valeur figée, pas d'édition Euro connue à l'avance
  // ici contrairement à WC 2026.
  const isClub = selectedComp !== 'WC' && selectedComp !== 'EC'
  const seasonParam = selectedComp === 'WC' ? '?season=2026'
    : selectedComp === 'EC' ? `?season=${new Date().getFullYear()}`
    : ''
  const matches = await fetchFinishedSeasonMatches(selectedComp, seasonParam)

  // Repli saison précédente (constat utilisateur : cotes de pronos
  // identiques pour tous les matchs en tout début de saison club, ex. août)
  // — tant que la saison en cours n'a pas encore MIN_LEAGUE_GAMES matchs
  // FINISHED, formMap est vide (aucun match joué) et compMatches ne permet
  // pas à calcPronoAdvanced de construire un modèle de buts fiable (voir
  // calcProno.js) → repli neutre identique pour tous les matchs. On
  // retombe alors sur la saison précédente de CETTE compétition : un seul
  // appel FD.org de PLUS PAR COMPÉTITION (pas par match/carte affichée),
  // budget-safe même avec plusieurs cartes en même temps (Pronos.jsx,
  // Accueil via useTeamFormMulti) — voir budget global 7/min, api/football.js.
  // Non applicable à WC/EC (compétitions non-annuelles, pas de "saison
  // précédente" comparable au sens sportif).
  // Cas équipe promue : elle n'a par construction AUCUNE entrée dans la
  // saison précédente de CETTE compétition (elle jouait dans une autre
  // division) — elle reste donc neutre (strength() par défaut) plutôt que
  // comparée à tort avec un autre championnat : comportement voulu.
  if (isClub && matches.length < MIN_LEAGUE_GAMES) {
    const lastSeason = getClubSeason() - 1
    const fallbackMatches = await fetchFinishedSeasonMatches(selectedComp, `?season=${lastSeason}`)
    if (fallbackMatches.length >= MIN_LEAGUE_GAMES) {
      return { formMap: buildFormMap(fallbackMatches), matches: fallbackMatches, isLastSeason: true }
    }
  }

  return { formMap: buildFormMap(matches), matches, isLastSeason: false }
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

  // matchesByComp : nécessaire à calcPronoAdvanced (calcProno.js) pour le
  // modèle buts marqués/encaissés — contrairement à formMap (fusionné, une
  // seule table id équipe → forme), les matchs saison doivent rester séparés
  // PAR compétition (la moyenne du championnat n'a de sens que dans une
  // seule compétition à la fois).
  const matchesByComp = {}
  codes.forEach((code, i) => { matchesByComp[code] = results[i]?.data?.matches ?? [] })

  return { formMap, matchesByComp, isLoading: results.some(r => r.isLoading) }
}
