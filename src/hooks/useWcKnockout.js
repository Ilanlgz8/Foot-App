import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { fetchEspnCupMatches } from '../utils/espnAdapter'
import { DOMESTIC_CUPS } from '../data/competitions'
import { classifyFetchError } from '../utils/fetchErrors'

const STALE_MS = 1000 * 60 * 10  // 10min

// football-data.org v4 n'utilise PAS "ROUND_OF_32" (cette valeur n'existe pas
// dans leur enum `stage`) : la bonne valeur est "LAST_32". Avec l'ancienne
// constante, les 32es de finale (nouveau tour propre au format à 48 équipes
// de la CM 2026) étaient silencieusement filtrés hors du bracket — le tableau
// démarrait directement aux 8es, et comme les 8es affichés dans l'API restent
// des places provisoires tant que les 32es ne sont pas joués/actés, l'affiche
// pouvait rester fausse (ex: "Canada-Paraguay" au lieu de "Paraguay-France")
// jusqu'à ce que football-data.org mette à jour les vrais qualifiés.
export const KNOCKOUT_ORDER = [
  'LAST_32',
  'LAST_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
]

export const KNOCKOUT_LABELS = {
  LAST_32:        'Seizièmes de finale',
  LAST_16:        'Huitièmes de finale',
  QUARTER_FINALS: 'Quarts de finale',
  SEMI_FINALS:    'Demi-finales',
  THIRD_PLACE:    'Petite finale',
  FINAL:          'Finale',
}

const EMPTY_ROUNDS = []

// football-data.org ne fournit aucun "index de position dans le bracket" —
// l'ordre du tableau pour un tour donné suit l'ordre de création/planification
// des matchs côté API, PAS forcément l'ordre d'adjacence de l'arbre (les 2
// matchs qui alimentent le même match du tour suivant ne sont pas garantis
// consécutifs). Ça se voit peu sur les tours à peu de matchs (huitièmes,
// quarts...) mais beaucoup sur les 32es (16 matchs) → lignes de connexion et
// positions du SVG qui ne correspondent plus aux vrais vainqueurs qualifiés.
// On reconstruit le vrai ordre en remontant les résultats réels : pour
// chaque match du tour N+1, on cherche quels 2 matchs du tour N ont produit
// ses 2 équipes (home/away), et on les replace côte à côte dans cet ordre.
function getWinnerTeamId(m) {
  // Matchs sourcés ESPN (coupes nationales, voir espnAdapter.js) : le
  // vainqueur est déjà connu directement (winner/advance), y compris pour un
  // match décidé aux tirs au but où le score affiché reste à égalité — pas
  // besoin (et pas fiable) de comparer home/away dans ce cas.
  if (m.winnerTeamId) return m.winnerTeamId

  const hs  = m.score?.fullTime?.home
  const as_ = m.score?.fullTime?.away
  if (hs == null || as_ == null) return null
  if (m.score?.duration === 'PENALTY_SHOOTOUT') {
    const hp = m.score?.penalties?.home
    const ap = m.score?.penalties?.away
    if (hp == null || ap == null || hp === ap) return null
    return hp > ap ? m.homeTeam?.id : m.awayTeam?.id
  }
  if (hs > as_) return m.homeTeam?.id
  if (as_ > hs) return m.awayTeam?.id
  return null
}

function reorderRoundsByTopology(rounds) {
  // La Petite Finale n'a pas de "tour suivant" dans l'arbre (elle est
  // alimentée par les perdants des demies, pas par un tour adjacent dans la
  // même chaîne) → on la sort de la chaîne de réordonnancement.
  const chain = rounds.filter(r => r.stage !== 'THIRD_PLACE')

  // On part de la fin vers le début : pour réordonner le tour N, il faut
  // déjà connaître l'ordre définitif (corrigé) du tour N+1.
  for (let ri = chain.length - 2; ri >= 0; ri--) {
    const round     = chain[ri]
    const nextRound = chain[ri + 1]
    const used       = new Set()
    const reordered  = new Array(round.matches.length).fill(null)

    nextRound.matches.forEach((nm, ni) => {
      const needHome = nm.homeTeam?.id
      const needAway = nm.awayTeam?.id
      let slotHome = null, slotAway = null
      round.matches.forEach((m, mi) => {
        if (used.has(mi)) return
        const w = getWinnerTeamId(m)
        if (w == null) return
        if (needHome != null && w === needHome) slotHome = mi
        else if (needAway != null && w === needAway) slotAway = mi
      })
      if (slotHome != null) { reordered[ni * 2]     = round.matches[slotHome]; used.add(slotHome) }
      if (slotAway != null) { reordered[ni * 2 + 1] = round.matches[slotAway]; used.add(slotAway) }
    })

    // Matchs pas encore joués/appariés (pas de vainqueur connu, ou pas encore
    // affecté à un tour suivant tbd) : replacés dans les trous restants, dans
    // leur ordre d'origine — on ne perd jamais un match, on améliore juste
    // l'ordre de ceux qu'on peut tracer.
    const leftovers = []
    round.matches.forEach((m, mi) => { if (!used.has(mi)) leftovers.push(m) })
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i] == null) reordered[i] = leftovers.shift() ?? null
    }
    round.matches = reordered.filter(Boolean)
  }

  return rounds
}

// compCode : 'WC' (défaut, historique) ou 'EC' (Euro) — même format de
// bracket à élimination directe côté football-data.org (stage LAST_32/
// LAST_16/QUARTER_FINALS/SEMI_FINALS/THIRD_PLACE/FINAL), donc même logique
// de reconstruction/affichage, juste paramétrée par compétition. Cache et
// queryKey inclus compCode pour ne jamais mélanger les 2 tableaux.
// Seules WC/EC ont un bracket — enabled=false pour toute autre compétition
// (Ligue 1, LaLiga...) : évite de taper FD.org pour rien à chaque fois que
// Matchs() est monté (le hook est appelé inconditionnellement, la garde
// react-query est le seul endroit possible pour ne pas violer les Rules of
// Hooks avec un retour anticipé conditionnel).
const BRACKET_COMPS = new Set(['WC', 'EC'])

export function useWcKnockout(compCode = 'WC') {
  const cacheKey = `wc_knockout_${compCode}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['wc-knockout', compCode],
    enabled: BRACKET_COMPS.has(compCode),
    queryFn: async () => {
      // Comme pour /matches et /scorers (voir useMatchs.js / useScorers.js) :
      // football-data.org résout la "saison courante" comme "celle qui a la
      // date de début la plus récente", une règle ambiguë pour une compétition
      // non-annuelle comme la CM/l'Euro. Sans ?season= explicite, l'endpoint
      // peut silencieusement retourner un jeu de données obsolète/incomplet —
      // vu en pratique : seuls 3 matchs de phase finale au lieu de tous ceux
      // déjà joués.
      const season = new Date().getFullYear()
      async function tryFetch(url) {
        const r = await fdFetch(fdUrl(url))
        if (r.status === 403 || r.status === 429) throw new Error(String(r.status))
        if (!r.ok) return null
        const j = await r.json()
        return j.matches ?? null
      }
      // ⚠️ BUG CORRIGÉ (même mécanisme que useStandings.js/useMatchs.js/
      // useScorers.js — constat utilisateur : "j'avais tout, 5min après plus
      // rien") : tryFetch lève une exception sur 403/429, jamais interceptée
      // ici → avec `retry: false`, une seule erreur transitoire faisait
      // disparaître le bracket CM/Euro sans repli, malgré readCacheStale déjà
      // en place plus bas (initialData) pour le montage initial seulement.
      let all
      try {
        all = await tryFetch(`/api/v4/competitions/${compCode}/matches?season=${season}`)
        if (!all || all.length === 0) {
          all = await tryFetch(`/api/v4/competitions/${compCode}/matches`)
        }
      } catch {
        const stale = readCacheStale(cacheKey)
        if (stale) return stale
        all = null
      }
      all = all ?? []

      const knockout = all.filter(m => KNOCKOUT_ORDER.includes(m.stage))

      const rounds = []
      for (const stage of KNOCKOUT_ORDER) {
        const stageMatches = knockout.filter(m => m.stage === stage)
        if (stageMatches.length > 0) {
          rounds.push({ stage, label: KNOCKOUT_LABELS[stage], matches: stageMatches })
        }
      }

      reorderRoundsByTopology(rounds)

      writeCache(cacheKey, rounds, STALE_MS)
      return rounds
    },
    initialData:          readCacheStale(cacheKey) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(cacheKey),
    staleTime:            STALE_MS,
    retry: false,
  })

  return {
    rounds:  data ?? EMPTY_ROUNDS,
    loading: isLoading,
    // Voir classifyFetchError (utils/fetchErrors.js).
    error:   classifyFetchError(error?.message),
  }
}

// ── Correctif fraîcheur "à déterminer" (Programme/Accueil vs bracket) ─────
// Constat utilisateur : le tableau à élimination directe (useWcKnockout/
// useCupKnockout ci-dessus, cache 10min) se met à jour avec les bons
// qualifiés (ex: petite finale/finale) plus vite que la vue "Par journée" de
// Programme (useMatches, cache 1h — voir TTL.SCHEDULED dans useMatchs.js) ou
// les cards "à venir" de l'Accueil (useTodayMatches, cache 30min-6h côté
// jours futurs) — ces caches plus longs sont volontaires (ménager le quota
// football-data.org free tier + le budget CPU Vercel, voir CLAUDE.md), donc
// on ne les raccourcit PAS. À la place, on réutilise ici les rounds DÉJÀ
// chargés par le bracket (aucune requête réseau supplémentaire) pour
// corriger l'affichage des mêmes matchs ailleurs dans l'app — ainsi tout se
// met à jour en même temps, sans coût réseau additionnel ni risque de
// re-déclencher le dépassement CPU déjà rencontré pendant la CdM.
export function getKnockoutTeamOverrides(rounds) {
  const map = new Map()
  for (const round of rounds ?? []) {
    for (const m of round.matches ?? []) {
      if (m?.id != null) map.set(m.id, { homeTeam: m.homeTeam, awayTeam: m.awayTeam })
    }
  }
  return map
}

export function applyKnockoutTeamOverrides(matches, overrides) {
  if (!overrides || overrides.size === 0) return matches
  return matches.map(m => {
    const o = overrides.get(m.id)
    if (!o) return m
    // Garde-fou : ne remplace que si le bracket a mieux (au moins un nom
    // d'équipe) — évite de régresser vers "à déterminer" dans le cas rare où
    // le bracket lui-même n'a pas encore l'info alors que l'autre source si.
    if (!o.homeTeam?.name && !o.awayTeam?.name) return m
    return { ...m, homeTeam: o.homeTeam ?? m.homeTeam, awayTeam: o.awayTeam ?? m.awayTeam }
  })
}

// ── useCupKnockout — même moteur de tableau, source ESPN ──────────────────
// Coupes nationales (Coupe de France/Copa del Rey/FA Cup, voir DOMESTIC_CUPS
// dans competitions.js) : pas de FD.org, matchs sourcés via
// fetchEspnCupMatches (espnAdapter.js), stage déjà résolu depuis
// event.season.slug (mapEspnStage) → même KNOCKOUT_ORDER/LABELS et même
// reorderRoundsByTopology que WC/EC, juste une source de matchs différente.
export function useCupKnockout(parentCode) {
  const cacheKey = `cup_knockout_${parentCode}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['cup-knockout', parentCode],
    enabled: !!DOMESTIC_CUPS[parentCode],
    queryFn: async () => {
      const all = await fetchEspnCupMatches(parentCode)
      const knockout = all.filter(m => KNOCKOUT_ORDER.includes(m.stage))

      const rounds = []
      for (const stage of KNOCKOUT_ORDER) {
        const stageMatches = knockout.filter(m => m.stage === stage)
        if (stageMatches.length > 0) {
          rounds.push({ stage, label: KNOCKOUT_LABELS[stage], matches: stageMatches })
        }
      }

      reorderRoundsByTopology(rounds)

      writeCache(cacheKey, rounds, STALE_MS)
      return rounds
    },
    initialData:          readCacheStale(cacheKey) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(cacheKey),
    staleTime:            STALE_MS,
    retry: false,
  })

  return {
    rounds:  data ?? EMPTY_ROUNDS,
    loading: isLoading,
    // Voir classifyFetchError (utils/fetchErrors.js).
    error:   classifyFetchError(error?.message),
  }
}
