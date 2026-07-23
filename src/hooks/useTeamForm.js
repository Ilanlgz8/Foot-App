import { useQuery, useQueries } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCache, getCacheSavedAt, writeCache } from './localCache'
import { outcomeForTeam } from '../utils/matchUtils'
import { getClubSeason } from './useMatchs'
import { MIN_LEAGUE_GAMES } from '../utils/calcProno'
import { fetchEspnCompMatches } from '../utils/espnAdapter'
import { COMPETITION_ESPN_SLUG } from '../data/competitions'

// Aligné sur le cache serveur (api/football.js retourne déjà ce endpoint avec un
// TTL de 2min par défaut) — 30min côté client empêchait de profiter d'une donnée
// pourtant déjà plus fraîche côté serveur.
const FORM_STALE = 1000 * 60 * 2  // 2min (était 30min)

// ⚠️ BUG CORRIGÉ (constat utilisateur : "es-tu sûr que c'est la bonne logique
// pour VRAIMENT tous les matchs ?") : Ligue des Nations/CAN/Copa America ne
// sont PAS couvertes par football-data.org en free tier (voir competitions.js,
// espnAdapter.js) — mais fetchTeamForm() interrogeait quand même FD.org sans
// distinction pour CES 3 compétitions, qui répondait donc systématiquement
// vide. Résultat : formMap/compMatches toujours vides pour NL/CAN/COPA → prono
// neutre pour CHAQUE match de ces compétitions, en permanence (pas juste en
// début de saison comme le vrai repli saison précédente plus bas). Corrigé en
// sourçant forme/buts via ESPN pour ces 3 comps (fetchEspnCompMatches, même
// fonction déjà utilisée pour Programme/Résultats — normalise vers exactement
// la même forme d'objet que FD.org, voir espnAdapter.js, donc calcProno.js
// n'a besoin d'aucune modification). Pas de repli "saison précédente" ESPN ici
// : ces compétitions ne suivent pas un cycle annuel comparable aux
// championnats club (getClubSeason() ne s'applique pas), et la fenêtre
// glissante d'espnAdapter.js (60j avant / 150j après) n'a pas de notion de
// "saison" à décaler — si pas assez de matchs dispo, repli normal sur
// calcProno (forme récente), comme pour toute compétition sous-alimentée.
const ESPN_SOURCED_FORM_COMPS = new Set(['NL', 'CAN', 'COPA'])

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
  // NL/CAN/COPA : voir ESPN_SOURCED_FORM_COMPS plus haut — FD.org ne les
  // couvre pas, on source via ESPN à la place (même fonction que Programme/
  // Résultats, objets déjà normalisés au format FD.org-like).
  if (ESPN_SOURCED_FORM_COMPS.has(selectedComp)) {
    const slug = COMPETITION_ESPN_SLUG[selectedComp]
    const all = await fetchEspnCompMatches(selectedComp, slug)
    const matches = all.filter(m => m.status === 'FINISHED')
    return { formMap: buildFormMap(matches), matches, isLastSeason: false }
  }

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
    // ⚠️ AJOUT (constat utilisateur : "compo probable"/"stats saison" avec des
    // matchs vieux de 2 ans, alors que le repli ne devrait remonter QUE d'une
    // saison — "la saison en cours ou la saison juste avant, jamais plus
    // loin") : `?season=${lastSeason}` explicite DEVRAIT suffire à garantir
    // ça, mais rien ne vérifiait que FD.org avait bien respecté ce
    // paramètre — si la compétition n'a pas cette saison précise en base,
    // le comportement de résolution par défaut de l'API n'est pas garanti
    // (pas documenté). Vérification a posteriori sur la date du match le
    // plus RÉCENT du lot reçu : si même celui-là est plus vieux que ~450j
    // (saison + trève, exclut une saison encore plus ancienne), le repli
    // n'est pas fiable → on ne l'utilise pas du tout, quel que soit le
    // nombre de matchs reçus, et on retombe sur la saison en cours (quasi
    // vide en tout début de saison) plutôt que d'afficher une saison
    // d'il y a 2 ans comme si c'était "la saison juste avant".
    const MAX_FALLBACK_AGE_DAYS = 450
    const newestFallbackTs = fallbackMatches.reduce(
      (max, m) => Math.max(max, new Date(m.utcDate).getTime()), 0
    )
    const fallbackIsRecent = newestFallbackTs > 0
      && (Date.now() - newestFallbackTs) / 86_400_000 <= MAX_FALLBACK_AGE_DAYS
    if (fallbackMatches.length >= MIN_LEAGUE_GAMES && fallbackIsRecent) {
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
      // ⚠️ BUG CORRIGÉ (constat utilisateur : "Uncaught (in promise) Error:
      // rate_limit" dans la console) : `result.then(...)` crée une PROMESSE
      // DÉRIVÉE distincte de `result` — quand `result` rejette (429 FD.org,
      // voir fetchFinishedSeasonMatches plus haut), React Query gère bien le
      // rejet du `result` qu'on retourne (retry automatique), mais cette
      // promesse dérivée-là rejette aussi de son côté, SANS jamais être
      // interceptée nulle part → rejet de promesse non géré, visible en
      // console. Le `.catch(() => {})` ne fait qu'absorber CETTE promesse
      // dérivée précise (write en cache, best-effort) — ne change rien au
      // `result` original ni à sa gestion d'erreur/retry par React Query.
      result.then(r => writeCache(cacheKey, r, FORM_STALE)).catch(() => {})
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
          // Voir le commentaire équivalent dans useTeamForm ci-dessus.
          result.then(r => writeCache(cacheKey, r, FORM_STALE)).catch(() => {})
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
