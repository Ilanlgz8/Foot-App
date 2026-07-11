import { useQuery } from '@tanstack/react-query'
import { readCache, readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { KNOCKOUT_ORDER, KNOCKOUT_LABELS } from './useWcKnockout'

// TTL selon le statut : les matchs à venir/terminés changent rarement → cache long
// → évite les 429 (free tier football-data.org : 10 req/min)
const TTL = {
  SCHEDULED: 60 * 60 * 1000,   // 1h — calendrier très stable
  FINISHED:   2 * 60 * 1000,   // 2min (était 5min) — aligné sur le cache serveur, résultats/classement/buteurs à jour plus vite
  IN_PLAY:    2 * 60 * 1000,   // 2min — géré ailleurs mais garde un fallback court
}

function cacheKey(comp, status) {
  return `matches_${comp}_${status}`
}

// Regroupe les matchs pour la navigation "par journée" :
//   - phase de poules → par match.matchday (1, 2, 3…), comme avant
//   - phase à élimination directe → match.matchday est TOUJOURS null pour ces
//     matchs (vérifié : c'est ce qui provoquait l'affichage "Journée null" en
//     Résultats/Programme dès la fin de la phase de groupes). On les regroupe
//     alors par match.stage, avec les libellés français déjà définis dans
//     useWcKnockout.js (Seizièmes, Huitièmes, Quarts, Demies, Finale…).
// Retourne un tableau de { key, label, matches } dans l'ordre chronologique
// (poules d'abord, puis tours à élimination directe dans l'ordre du tableau),
// inversé si order === 'desc' (utilisé par Résultats : le plus récent d'abord).
export function groupRounds(matches, order = 'asc') {
  const groupStage = matches.filter(m => m.matchday != null)
  const knockout    = matches.filter(m => m.matchday == null && m.stage)

  const mdMap = {}
  groupStage.forEach(m => { (mdMap[m.matchday] ??= []).push(m) })
  const mdEntries = Object.keys(mdMap)
    .map(Number).sort((a, b) => a - b)
    .map(day => ({
      key: `md-${day}`,
      label: `Journée ${day}`,
      matches: [...mdMap[day]].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)),
    }))

  const koEntries = KNOCKOUT_ORDER
    .map(stage => ({ stage, ms: knockout.filter(m => m.stage === stage) }))
    .filter(({ ms }) => ms.length > 0)
    .map(({ stage, ms }) => ({
      key: stage,
      label: KNOCKOUT_LABELS[stage] ?? stage,
      matches: [...ms].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)),
    }))

  const chrono   = [...mdEntries, ...koEntries]
  const ordered  = order === 'desc' ? [...chrono].reverse() : chrono
  return ordered.map(g => ({
    ...g,
    matches: order === 'desc' ? [...g.matches].reverse() : g.matches,
  }))
}

// Calcule l'année de saison pour les ligues clubs (ex: juin 2026 → 2025)
// Les ligues club tournent Août-Mai, donc en juin/juillet on est en intersaison
// WC 2026 : saison spéciale juin-juillet 2026
export function getClubSeason() {
  const now = new Date()
  const month = now.getMonth() + 1 // 1-12
  const year = now.getFullYear()
  // En juin et juillet, la saison précédente vient de se terminer
  return month <= 7 ? year - 1 : year
}

// Logique de fetch partagée (extraite pour être réutilisable hors du hook,
// ex: récupérer les matchs à venir de PLUSIEURS compétitions d'un coup —
// voir useUpcomingMatchesAllComps ci-dessous, utilisé par Pronos.jsx).
async function fetchMatchesForComp(selectedComp, status) {
  const isClub = selectedComp !== 'WC' && selectedComp !== 'EC'

  async function tryFetch(url) {
    const res = await fdFetch(fdUrl(url))
    if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
    if (!res.ok) return null
    const json = await res.json()
    return json.matches ?? []
  }

  let matches = null

  if (!isClub) {
    const wcSeason = new Date().getFullYear()
    if (status === 'SCHEDULED') {
      matches = await tryFetch(
        `/api/v4/competitions/${selectedComp}/matches?season=${wcSeason}`
      )
      if (!matches || matches.length === 0) {
        matches = await tryFetch(
          `/api/v4/competitions/${selectedComp}/matches?status=TIMED&season=${wcSeason}`
        )
      }
      if (!matches || matches.length === 0) {
        matches = await tryFetch(
          `/api/v4/competitions/${selectedComp}/matches`
        )
      }
    } else {
      matches = await tryFetch(
        `/api/v4/competitions/${selectedComp}/matches?status=FINISHED&season=${wcSeason}`
      )
      if (!matches || matches.length === 0) {
        matches = await tryFetch(
          `/api/v4/competitions/${selectedComp}/matches?status=FINISHED`
        )
      }
    }
  } else if (status === 'FINISHED') {
    matches = await tryFetch(
      `/api/v4/competitions/${selectedComp}/matches?status=${status}&season=${getClubSeason()}`
    )
    if (!matches || matches.length === 0) {
      matches = await tryFetch(
        `/api/v4/competitions/${selectedComp}/matches?status=${status}`
      )
    }
  } else {
    matches = await tryFetch(
      `/api/v4/competitions/${selectedComp}/matches?status=${status}`
    )
  }

  return matches
}

export function useMatches(selectedComp, status = 'SCHEDULED', order = 'asc') {
  const key         = cacheKey(selectedComp, status)
  const cachedData  = readCacheStale(key)
  const cachedAt    = getCacheSavedAt(key)
  const ttl         = TTL[status] ?? 30 * 60 * 1000

  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', selectedComp, status],
    queryFn: async () => {
      const matches = await fetchMatchesForComp(selectedComp, status)
      if (!matches) return readCacheStale(key) ?? []
      if (matches.length > 0) writeCache(key, matches, ttl)
      return matches.length > 0 ? matches : (readCacheStale(key) ?? [])
    },
    initialData:          cachedData ?? undefined,
    initialDataUpdatedAt: cachedAt,
    // staleTime = TTL → si le cache est encore frais, 0 requête API au montage du composant
    staleTime: ttl,
    retry: false,
  })

  return {
    matches: data ?? [],
    loading: isLoading,
    error: error?.message === '429' ? null : (error?.message ?? null), // 429 silencieux
    grouped: groupRounds(data ?? [], order),
  }
}

// Fenêtre d'affichage Pronos : les 7 prochains jours seulement (demande
// utilisateur — pas tout le reste du tournoi d'un coup).
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// Matchs à venir de TOUTES les compétitions suivies, fusionnés, triés
// chronologiquement et limités aux 7 prochains jours — pour Pronos.jsx.
// IMPORTANT : pour le WC/EC, fetchMatchesForComp('SCHEDULED') fait un 1er
// essai SANS filtre de statut (récupère toute la saison, poules + bracket,
// y compris les matchs déjà joués — voir commentaire plus haut, pensé pour
// la page Programme qui filtre elle-même ensuite). Il faut donc filtrer ici
// explicitement par statut (comme filteredGrouped dans Match.jsx) sous peine
// d'afficher des matchs déjà terminés dans "à venir".
// Cache combiné dédié (clé "ALL", TTL 1h comme le cache par-compétition
// SCHEDULED) : au pire une rafale de N requêtes FD.org une fois par heure,
// lissée par le budget global déjà en place dans api/football.js.
export function useUpcomingMatchesAllComps(compIds) {
  const key        = cacheKey('ALL', 'SCHEDULED')
  const cachedData = readCacheStale(key)
  const cachedAt   = getCacheSavedAt(key)
  const ttl        = TTL.SCHEDULED

  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', 'ALL', 'SCHEDULED', compIds.join(',')],
    queryFn: async () => {
      const results = await Promise.allSettled(
        compIds.map(id => fetchMatchesForComp(id, 'SCHEDULED'))
      )
      const now = Date.now()
      const merged = results
        .filter(r => r.status === 'fulfilled' && Array.isArray(r.value))
        .flatMap(r => r.value)
        .filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED')
        .filter(m => {
          const t = new Date(m.utcDate).getTime()
          return t >= now && t - now <= UPCOMING_WINDOW_MS
        })
        .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))

      // Rien à écrire en cache si la fenêtre 7j est vide (ex: creux entre 2
      // journées) — évite d'effacer un cache valide avec un résultat vide.
      if (merged.length === 0) return readCacheStale(key) ?? []
      writeCache(key, merged, ttl)
      return merged
    },
    initialData:          cachedData ?? undefined,
    initialDataUpdatedAt: cachedAt,
    staleTime: ttl,
    retry: false,
  })

  return {
    matches: data ?? [],
    loading: isLoading,
    error: error?.message === '429' ? null : (error?.message ?? null),
  }
}

// Matchs FINISHED de toutes les compétitions — utilisé UNIQUEMENT par l'onglet
// Classement de Pronos.jsx pour comparer les pronostics au score réel. TTL
// volontairement long (10min, cache dédié "ALL_FINISHED_PRONOS", distinct du
// cache FINISHED 2min utilisé par Résultats) et enabled=false tant que
// l'onglet Classement n'est pas ouvert : évite une rafale répétée de N
// requêtes FD.org, un classement pronos n'a pas besoin d'être seconde près.
export function useFinishedMatchesAllComps(compIds, enabled = true) {
  const key        = 'matches_ALL_FINISHED_PRONOS'
  const cachedData = readCacheStale(key)
  const cachedAt   = getCacheSavedAt(key)
  const ttl        = 10 * 60 * 1000

  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', 'ALL', 'FINISHED_PRONOS', compIds.join(',')],
    queryFn: async () => {
      const results = await Promise.allSettled(
        compIds.map(id => fetchMatchesForComp(id, 'FINISHED'))
      )
      const merged = results
        .filter(r => r.status === 'fulfilled' && Array.isArray(r.value))
        .flatMap(r => r.value)

      if (merged.length === 0) return readCacheStale(key) ?? []
      writeCache(key, merged, ttl)
      return merged
    },
    initialData:          cachedData ?? undefined,
    initialDataUpdatedAt: cachedAt,
    staleTime: ttl,
    retry: false,
    enabled,
  })

  return {
    matches: data ?? [],
    loading: isLoading,
    error: error?.message === '429' ? null : (error?.message ?? null),
  }
}