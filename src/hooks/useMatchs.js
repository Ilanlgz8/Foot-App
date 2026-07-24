import { useQuery } from '@tanstack/react-query'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { KNOCKOUT_ORDER, KNOCKOUT_LABELS } from './useWcKnockout'
import { fetchEspnCompMatches, fetchEspnCupMatches } from '../utils/espnAdapter'
import { COMPETITION_ESPN_SLUG, DOMESTIC_CUPS, MAJOR_LEAGUE_FD_ID } from '../data/competitions'
import { classifyFetchError } from '../utils/fetchErrors'

// Compétitions sans couverture football-data.org (free tier) — servies via
// ESPN à la place (voir src/utils/espnAdapter.js pour le détail des limites :
// pas de Poules/tableau pour l'instant, Programme+Résultats seulement).
// ⚠️ Volontairement INCHANGÉ (n'inclut PAS FL1/PL/PD/BL1/SA/CL) : ce Set est
// utilisé par fetchMatchesForComp, partagé avec useMatches (Programme.jsx),
// dont la vue "Par journée" a besoin du champ `matchday` — qu'ESPN ne fournit
// jamais (toujours `null`). Voir plus bas (opts.preferEspnForMajors) pour le
// SEUL appelant qui a besoin d'ESPN pour ces 6 comps sans toucher Programme.
const ESPN_SOURCED_COMPS = new Set(['NL', 'CAN', 'COPA', 'UEL', 'UECL'])

// ⚠️ AJOUT (constat utilisateur, 24/07 : "j'ai des doublons + les matchs
// avant le 21 août n'apparaissent pas, l'app saute direct au 21 au lieu du
// 15") : useUpcomingMatchesAllComps (ci-dessous — sert à la fois à trouver
// "le prochain jour avec un match" ET de filet de sécurité anti-trou dans
// Accueil.jsx) restait sur FD.org pour les 6 grands championnats via
// fetchMatchesForComp, alors que le widget qui AFFICHE réellement ces matchs
// dans Accueil (useTodayMatches.js) a été basculé sur ESPN pour elles le
// 23/07 (FD.org moins complet/fiable pour elles, cause du switch à
// l'origine). Résultat : un match connu d'ESPN mais pas encore (ou
// différemment daté) côté FD.org — ex. une rencontre publiée plus tôt côté
// ESPN — n'était jamais vu par ce hook, donc jamais retenu comme "jour le
// plus proche", ET pouvait réapparaître en double avec une date différente
// via le filet de sécurité (qui compare bien les noms d'équipe désormais,
// mais un vrai écart de date entre les 2 sources reste possible). Le fix
// (matchDedupeKey → fuzzyTeam, même jour) traitait le symptôme doublon mais
// pas la cause : deux sources différentes pour la même donnée. En alignant
// enfin les DEUX (widget d'affichage ET recherche du jour le plus proche)
// sur la même source pour ces 6 comps, les deux bugs disparaissent à la
// racine. `useMatches`/Programme.jsx n'est PAS concerné (voir ESPN_SOURCED_COMPS
// ci-dessus, inchangé) — seul useUpcomingMatchesAllComps passe désormais
// preferEspnForMajors:true à fetchMatchesForComp.
const MAJOR_LEAGUE_COMPS = new Set(Object.keys(MAJOR_LEAGUE_FD_ID))

// TTL selon le statut : les matchs à venir/terminés changent rarement → cache long
// → évite les 429 (free tier football-data.org : 10 req/min)
export const TTL = {
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
  // NL/CAN/COPA (source ESPN, voir espnAdapter.js) n'ont ni matchday ni stage
  // exploitable → sans ce 3e groupe, ces matchs ne rentraient dans AUCUNE des
  // 2 listes ci-dessus et disparaissaient silencieusement de Programme/
  // Résultats. On les regroupe par jour calendaire à la place.
  const ungrouped   = matches.filter(m => m.matchday == null && !m.stage)

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

  const dayMap = {}
  ungrouped.forEach(m => {
    const d = new Date(m.utcDate)
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    ;(dayMap[dayKey] ??= []).push(m)
  })
  const dayEntries = Object.keys(dayMap).sort().map(dayKey => ({
    key: `day-${dayKey}`,
    label: new Date(`${dayKey}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }),
    matches: [...dayMap[dayKey]].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)),
  }))

  const chrono   = [...mdEntries, ...koEntries, ...dayEntries]
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

// ⚠️ BUG CORRIGÉ (constat utilisateur, capture d'écran à l'appui : le
// chiffre brut "403" affiché en gros dans Résultats à la place de la liste
// des matchs) : `tryFetch` ci-dessous lève une Error dont le message est le
// code HTTP brut (429 OU 403, voir plus bas) quand FD.org rejette la
// requête. Les 3 hooks de ce fichier (useMatches/useUpcomingMatchesAllComps/
// useAllFinishedMatches) masquaient déjà ce message pour 429 ("429
// silencieux" — un rate-limit est transitoire, le cache stale/circuit
// breaker côté serveur (api/football.js) prend le relais, pas la peine
// d'effrayer l'utilisateur) mais PAS pour 403 — qui n'existait pas encore
// comme cas réel avant l'incident FD.org du 20/07. Un 403 est géré exactement
// pareil côté serveur (voir DOWN_TTL_FORBIDDEN dans api/football.js) : même
// traitement silencieux ici, pour la même raison.
// classifyFetchError (utils/fetchErrors.js) remplace l'ancien
// isSilentFetchError() ci-dessous — même détection 429/403, mais affiche
// désormais "réessaie plus tard" au lieu de masquer silencieusement l'erreur
// (demande utilisateur explicite).

// Logique de fetch partagée (extraite pour être réutilisable hors du hook,
// ex: récupérer les matchs à venir de PLUSIEURS compétitions d'un coup —
// voir useUpcomingMatchesAllComps ci-dessous, utilisé par Pronos.jsx).
async function tryFetch(url) {
  const res = await fdFetch(fdUrl(url))
  if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
  if (!res.ok) return null
  const json = await res.json()
  return json.matches ?? []
}

// ⚠️ FUSION Programme+Résultats + PARTAGE CLIENT (demande utilisateur, 24/07,
// en 2 temps) :
//  1. "rassembler les requêtes pour moins gaspiller" → un seul appel FD.org
//     par compét club (`?season=X` SANS `status=`, tous statuts confondus),
//     au lieu de 2 appels séparés par `status=`.
//  2. "je suis dans Programme, ça charge Programme mais pas Résultats du même
//     championnat" → la fusion ci-dessus ne partageait QUE le cache Redis
//     SERVEUR (api/football.js) — chaque page continuait de faire sa PROPRE
//     requête vers NOTRE serveur (rapide, cache HIT, mais pas instantané ni
//     partagé côté client) et surtout sa PROPRE clé de cache React
//     Query/disque. Pire : en intersaison, `season=X` seul contient TOUT
//     Résultats (saison qui vient de finir) mais RIEN de Programme (aucun
//     SCHEDULED encore publié sous ce numéro de saison) — Résultats n'avait
//     donc jamais besoin du repli sans saison, qui restait une clé JAMAIS
//     préchauffée pour Programme. D'où l'asymétrie observée : Résultats
//     toujours bon, Programme jamais.
// fetchClubMatchesRaw() récupère maintenant TOUJOURS les 2 statuts dans le
// MÊME appel logique (repli automatique dès qu'un des deux manque, fusionné
// sans doublon) — useMatches() partage ensuite CETTE MÊME donnée brute entre
// Programme et Résultats via une seule queryKey React Query + `select` pour
// filtrer par statut côté chaque page (mécanisme officiel React Query,
// aucun refetch dupliqué). Visiter l'une des deux pages peuple désormais
// aussi l'autre pour la même compét, sans requête supplémentaire.
async function fetchClubMatchesRaw(selectedComp) {
  let all = null
  // Mémorise la dernière vraie erreur réseau (429/403) — voir le rethrow en
  // fin de fonction : sans ça, 2 tentatives bloquées finissaient en `null`
  // silencieux, perdant la distinction "vraiment bloqué" vs "vraiment aucun
  // match", dont classifyFetchError (fetchErrors.js) a besoin pour afficher
  // "Veuillez patienter quelques instants" au lieu d'un écran vide.
  let lastErr = null

  try {
    all = await tryFetch(
      `/api/v4/competitions/${selectedComp}/matches?season=${getClubSeason()}`
    )
  } catch (e) { lastErr = e /* → repli ci-dessous, ne pas abandonner tout de suite */ }

  // Complet seulement si les 2 catégories sont représentées — en intersaison,
  // `season=${getClubSeason()}` (saison qui vient de finir) ne contient QUE
  // des FINISHED, jamais de SCHEDULED/TIMED : il faut alors le repli pour
  // compléter, pas juste quand la réponse est totalement vide.
  const hasFinished = (all ?? []).some(m => m.status === 'FINISHED')
  const hasUpcoming = (all ?? []).some(m => m.status !== 'FINISHED')

  if (!all || !hasFinished || !hasUpcoming) {
    // Repli sans season — s'appuie sur le "current season" implicite de
    // FD.org plutôt que sur un calcul de date local : couvre justement le cas
    // d'intersaison où le calcul par date (getClubSeason) et le vrai
    // "courant" FD.org divergent temporairement. Fusionné (pas remplacé) avec
    // `all` pour ne perdre ni les FINISHED déjà obtenus ni les SCHEDULED du
    // repli, quel que soit lequel des deux appels a réussi.
    let fallbackAll = null
    try {
      fallbackAll = await tryFetch(`/api/v4/competitions/${selectedComp}/matches`)
    } catch (e) { lastErr = e /* les 2 tentatives ont échoué — `all` reste tel quel */ }
    if (fallbackAll != null) {
      const seen   = new Set((all ?? []).map(m => m.id))
      const merged = [...(all ?? [])]
      for (const m of fallbackAll) if (!seen.has(m.id)) merged.push(m)
      if (merged.length > 0) all = merged
    }
  }

  // Coupe nationale du championnat (Coupe de France/Copa del Rey/FA Cup) :
  // fusionnée DANS ce même onglet plutôt que dans un onglet dédié (demande
  // explicite) — voir DOMESTIC_CUPS (competitions.js) et fetchEspnCupMatches
  // (espnAdapter.js), qui taggent ces matchs avec isCup:true + un nom de
  // compétition différent pour le relabeling sur les cards. Fusionnée ICI
  // (non filtrée par statut) plutôt qu'après filtrage : les 2 pages
  // (Programme/Résultats) profitent du filtrage commun plus bas.
  if (DOMESTIC_CUPS[selectedComp]) {
    const cupMatches = await fetchEspnCupMatches(selectedComp)
    if (cupMatches.length > 0) all = [...(all ?? []), ...cupMatches]
  }

  // Préserve la classification 429/403 (voir commentaire lastErr ci-dessus)
  // au lieu d'un null silencieux quand rien n'a pu être récupéré nulle part.
  if (all == null && lastErr) throw lastErr

  return all
}

async function fetchMatchesForComp(selectedComp, status, opts = {}) {
  const useEspn = ESPN_SOURCED_COMPS.has(selectedComp) ||
    (opts.preferEspnForMajors && MAJOR_LEAGUE_COMPS.has(selectedComp))
  if (useEspn) {
    const slug = COMPETITION_ESPN_SLUG[selectedComp]
    const all  = await fetchEspnCompMatches(selectedComp, slug, { compId: MAJOR_LEAGUE_FD_ID[selectedComp] })
    if (status === 'FINISHED') return all.filter(m => m.status === 'FINISHED')
    // 'SCHEDULED' ici couvre aussi TIMED/IN_PLAY/PAUSED — même logique que
    // Programme pour WC/EC qui affiche "à venir" au sens large (voir filtre
    // par date/statut fait ensuite côté composant, ex: filterUpcomingWindow).
    return all.filter(m => m.status !== 'FINISHED')
  }

  const isClub = selectedComp !== 'WC' && selectedComp !== 'EC'

  if (isClub) {
    const all = await fetchClubMatchesRaw(selectedComp)
    if (all == null) return null
    return status === 'FINISHED'
      ? all.filter(m => m.status === 'FINISHED')
      : all.filter(m => m.status !== 'FINISHED')
  }

  // ── WC/EC : statuts déjà distincts par nature du tournoi (poules puis
  // élimination directe sur quelques semaines), pas concernées par le repli
  // saison ci-dessus ni par le partage client (chaque page garde son propre
  // fetch, comportement historique inchangé). ──
  let matches
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

  if (DOMESTIC_CUPS[selectedComp]) {
    const cupMatches = await fetchEspnCupMatches(selectedComp)
    const cupFiltered = status === 'FINISHED'
      ? cupMatches.filter(m => m.status === 'FINISHED')
      : cupMatches.filter(m => m.status !== 'FINISHED')
    if (cupFiltered.length > 0) matches = [...(matches ?? []), ...cupFiltered]
  }

  return matches
}

// options.staleTime : repli explicite pour un appelant précis (ex: Résultats,
// voir Resultat.jsx) — n'affecte pas les autres appelants de ce même hook sur
// la même compét/statut (Classement.jsx notamment), chacun garde son propre
// staleTime côté React Query même si la clé de requête est partagée.
export function useMatches(selectedComp, status = 'SCHEDULED', order = 'asc', options = {}) {
  // ⚠️ PARTAGE CLIENT Programme/Résultats (constat utilisateur, 24/07 : "je
  // suis dans Programme, ça charge Programme mais pas Résultats du même
  // championnat") : pour une compét club (hors ESPN_SOURCED_COMPS, hors
  // WC/EC — voir fetchClubMatchesRaw plus haut), Programme (SCHEDULED) et
  // Résultats (FINISHED) utilisent maintenant LA MÊME entrée de cache React
  // Query (même queryKey, données brutes non filtrées) au lieu de deux clés
  // séparées — chaque page applique ensuite son propre filtre de statut via
  // `select`, le mécanisme officiel React Query pour que plusieurs observers
  // d'une même query se partagent UN SEUL fetch tout en affichant chacun une
  // vue différente des mêmes données (voir doc TanStack Query : "Using select
  // to Transform Data"). Concrètement : visiter Programme peuple aussi le
  // cache de Résultats pour la même compét, et inversement — sans requête
  // supplémentaire, sans refetch dupliqué.
  // WC/EC et ESPN_SOURCED_COMPS gardent le comportement historique (clés
  // séparées) : ces branches de fetchMatchesForComp fonctionnent différemment
  // et n'ont pas le même besoin (voir fetchClubMatchesRaw, dédié aux clubs).
  const isClubShared = selectedComp !== 'WC' && selectedComp !== 'EC' && !ESPN_SOURCED_COMPS.has(selectedComp)

  const key         = cacheKey(selectedComp, isClubShared ? 'RAW' : status)
  // RAW contient à la fois les matchs à venir et terminés — on aligne le TTL
  // disque sur la catégorie la plus volatile (FINISHED, scores/classement
  // changeants) plutôt que sur SCHEDULED (1h), pour ne pas garder une donnée
  // "à jour" trop longtemps du point de vue de Résultats.
  const ttl         = options.staleTime ?? (isClubShared ? TTL.FINISHED : (TTL[status] ?? 30 * 60 * 1000))

  // ⚠️ BUG CORRIGÉ (constat utilisateur, même jour que le partage de cache :
  // "je relance l'app complètement, je vais dans Programme, ça me met
  // 'Veuillez patienter' direct") : renommer la clé de cache en 'RAW' a
  // instantanément vidé le filet de sécurité stale de TOUTES les compéts club
  // d'un coup — l'ancienne clé ('matches_FL1_SCHEDULED' etc.) avait des mois
  // d'historique accumulé, la nouvelle ('matches_FL1_RAW') n'en a AUCUN au
  // moment du déploiement. Résultat : le tout premier vrai 429/403 rencontré
  // après le déploiement (FD.org sous tension, indépendant de ce bug) n'avait
  // plus aucune copie de secours à servir et remontait tel quel — exactement
  // le piège "clé toute neuve sans historique" déjà rencontré une fois ce
  // même jour (LaLiga, juste après la 1ère fusion). Repli : si la nouvelle
  // clé RAW est vide, on regarde une dernière fois les ANCIENNES clés
  // (SCHEDULED/FINISHED) — écrites par les sessions précédentes, avant ce
  // déploiement — et on les fusionne comme copie de secours migrée, plutôt
  // que de repartir de zéro. Purement une passerelle : dès qu'un vrai fetch
  // réussit, tout repasse par la clé RAW normalement.
  function readStaleWithMigration() {
    const direct = readCacheStale(key)
    if (direct) return direct
    if (!isClubShared) return null
    const oldFinished = readCacheStale(cacheKey(selectedComp, 'FINISHED'))
    const oldScheduled = readCacheStale(cacheKey(selectedComp, 'SCHEDULED'))
    if (!oldFinished && !oldScheduled) return null
    const seen = new Set()
    const merged = []
    for (const m of [...(oldFinished ?? []), ...(oldScheduled ?? [])]) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      merged.push(m)
    }
    if (merged.length === 0) return null
    writeCache(key, merged, ttl) // auto-guérison : la prochaine lecture retombe directement sur la clé RAW
    return merged
  }

  const cachedData = readStaleWithMigration()
  const cachedAt   = getCacheSavedAt(key)

  const filterByStatus = list => (list ?? []).filter(m =>
    status === 'FINISHED' ? m.status === 'FINISHED' : m.status !== 'FINISHED'
  )

  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', selectedComp, isClubShared ? 'RAW' : status],
    // ⚠️ BUG CORRIGÉ (même mécanisme que useStandings.js — constat utilisateur :
    // "j'avais tout, 5min après plus rien") : tryFetch() lève une exception sur
    // 429/403 (voir plus haut), qui traversait fetchMatchesForComp SANS être
    // interceptée nulle part — le repli `readCacheStale(key) ?? []` juste en
    // dessous n'était en réalité JAMAIS exécuté dans ce cas précis (l'exception
    // saute directement par-dessus), et `retry: false` empêchait toute
    // nouvelle tentative. Un try/catch autour de l'appel suffit à laisser le
    // repli déjà écrit faire son travail.
    //
    // ⚠️ 2e BUG CORRIGÉ (constat utilisateur : "Résultats → Coupe du Monde,
    // aucun résultat" alors que les 104 matchs existent bien côté FD.org,
    // vérifié en direct) : le `?? []` ci-dessous, quand AUCUN cache stale
    // n'existe encore pour cette clé (1re visite sur cette compét/statut,
    // exactement le cas d'un onglet peu consulté comme "Résultats WC" après
    // le tournoi), transformait un vrai échec réseau (429/403/erreur) en un
    // tableau vide traité comme un succès légitime — la page affichait
    // silencieusement "Aucun résultat disponible" au lieu du message
    // "réessaie plus tard", sans jamais réessayer (retry: false). Repris
    // EXACTEMENT sur le modèle de useStandings.js : on ne rattrape le raté
    // que s'il y a une vraie copie de secours à servir, sinon on relance
    // l'erreur pour que error/classifyFetchError fasse son travail.
    queryFn: async () => {
      try {
        const matches = isClubShared
          ? await fetchClubMatchesRaw(selectedComp)
          : await fetchMatchesForComp(selectedComp, status)
        if (!matches) {
          const stale = readStaleWithMigration()
          if (stale) return stale
          throw new Error('Erreur API')
        }
        if (matches.length > 0) writeCache(key, matches, ttl)
        return matches.length > 0 ? matches : (readStaleWithMigration() ?? [])
      } catch (err) {
        const stale = readStaleWithMigration()
        if (stale) return stale
        throw err
      }
    },
    // Filtre par statut appliqué CÔTÉ OBSERVER (pas dans queryFn) — c'est ce
    // qui permet à Programme et Résultats de partager le même fetch/cache
    // brut tout en affichant chacun un sous-ensemble différent (voir
    // commentaire isClubShared ci-dessus). undefined pour WC/EC/ESPN : ces
    // branches renvoient déjà des données pré-filtrées par status depuis
    // fetchMatchesForComp, comme avant.
    select: isClubShared ? filterByStatus : undefined,
    initialData:          cachedData ?? undefined,
    initialDataUpdatedAt: cachedAt,
    staleTime: ttl,
    // ⚠️ AJOUT (constat utilisateur, 24/07 : "les matchs dans Programme sont en
    // cache mais quand y'a une mise à jour sur l'heure ou le jour exact ça ne
    // met pas à jour") : avec staleTime=1h (SCHEDULED) et refetchOnWindowFocus
    // désactivé globalement (main.jsx, décision délibérée anti-429 FD.org),
    // React Query ne retentait AUCUN fetch pendant toute cette heure, même en
    // revenant sur Programme entre-temps — un changement d'heure/date publié
    // par FD.org restait invisible jusqu'à 1h, quel que soit le nombre de fois
    // où l'utilisateur rouvrait la page. 'always' : revalidation en arrière-
    // plan à CHAQUE fois que Programme est monté (donnée déjà en cache affichée
    // instantanément, remplacée dès que le fetch revient), SANS toucher au
    // vrai garde-fou anti-suspension FD.org — celui-ci vit côté SERVEUR
    // (cache Redis 5min partagé entre TOUS les utilisateurs, api/football.js)
    // et reste strictement inchangé : la quasi-totalité de ces revalidations
    // tombent sur ce cache serveur (X-Cache: HIT, ~0 coût), sans jamais
    // retaper FD.org plus souvent qu'avant.
    refetchOnMount: 'always',
    // ⚠️ AJOUT (24/07, capture Network utilisateur : 2 vrais 429 sur Ligue 1,
    // confirmés transitoires — un nouvel appel identique quelques instants
    // plus tard réussissait normalement) : `retry: false` faisait que le
    // moindre 429 passager (budget FD.org partagé momentanément épuisé par
    // TOUS les utilisateurs confondus, réinitialisé toutes les 7,5s à
    // MINUTE_CAP=8/min — voir SPACING_MS dans api/football.js) restait
    // affiché tel quel jusqu'à ce que l'utilisateur recharge manuellement,
    // même quand aucune copie stale n'existait encore pour se rattraper
    // (cas des URLs de calendrier fusionnées, encore "jeunes" depuis la
    // fusion Programme+Résultats du jour). Un 429/403 est PAR NATURE
    // transitoire (contrairement à une vraie erreur de code) — 2 tentatives
    // de plus, espacées de 8s (juste après la fenêtre de 7,5s), suffisent
    // dans l'immense majorité des cas à retomber sur une fenêtre où le
    // budget vient de se réinitialiser, sans le moindre geste de
    // l'utilisateur. Ne s'applique qu'aux 429/403 (message brut identifié
    // AVANT classifyFetchError) — toute autre erreur continue de ne jamais
    // réessayer, comme avant.
    retry: (failureCount, err) =>
      (err?.message === '429' || err?.message === '403') && failureCount < 2,
    retryDelay: 8000,
  })

  return {
    matches: data ?? [],
    loading: isLoading,
    error: classifyFetchError(error?.message),
    grouped: groupRounds(data ?? [], order),
  }
}

// Fenêtre d'affichage Pronos : les 7 prochains jours seulement (demande
// utilisateur — pas tout le reste du tournoi d'un coup). Paramétrable
// (windowDays) : Accueil.jsx s'en sert aussi avec une fenêtre plus large pour
// trouver le prochain jour avec un match (voir useUpcomingMatchesAllComps).
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function filterUpcomingWindow(matches, now, windowMs = UPCOMING_WINDOW_MS) {
  return (matches ?? [])
    .filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED')
    .filter(m => {
      const t = new Date(m.utcDate).getTime()
      return t >= now && t - now <= windowMs
    })
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
}

// Matchs à venir de TOUTES les compétitions suivies, fusionnés, triés
// chronologiquement et limités à `windowDays` jours (7 par défaut, pour
// Pronos.jsx). IMPORTANT : pour le WC/EC, fetchMatchesForComp('SCHEDULED')
// fait un 1er essai SANS filtre de statut (récupère toute la saison, poules +
// bracket, y compris les matchs déjà joués — voir commentaire plus haut,
// pensé pour la page Programme qui filtre elle-même ensuite). Il faut donc
// filtrer ici explicitement par statut ET par date (comme filteredGrouped
// dans Match.jsx) sous peine d'afficher des matchs déjà joués dans "à venir".
// Clé de cache "ALL_V2" (pas "ALL") : les navigateurs ayant déjà visité
// Pronos AVANT ce filtre ont un ancien cache localStorage non filtré, encore
// valide selon staleTime (1h) — sans changer de clé, ce vieux cache continue
// d'être servi tel quel pendant jusqu'à 1h après le déploiement du fix.
// windowDays fait partie de la clé de cache : une fenêtre 7j et une fenêtre
// 30j (Accueil, voir plus bas) ne doivent jamais se marcher dessus.
// ⚠️ REVERT (23/07, même jour) : passé à 24h plus tôt aujourd'hui (idée
// utilisateur), puis ramené à 1h suite à un vrai bug remonté par
// l'utilisateur — "Accueil saute direct au 21 août, des matchs le 15 et
// entre le 15-20 août sont invisibles". Cause confirmée en lisant
// Accueil.jsx : la flèche "jour suivant" ET le saut automatique (jour vide)
// cherchent TOUS LES DEUX le prochain match dans upcomingAllComps (ce hook)
// — si le cache client (24h) n'a pas encore vu les matchs du 15-20 août
// (calendrier publié par FD.org APRÈS le dernier vrai fetch, pas un report
// de dernière minute comme je l'avais anticipé) mais contient déjà celui du
// 21, la flèche saute directement au 21, ces jours devenant invisibles
// jusqu'à ce qu'un vrai refetch ait lieu — jusqu'à 24h plus tard, voire plus
// si l'app reste peu utilisée entre-temps. Mon raisonnement initial ne
// couvrait que le risque "reprogrammation tardive d'un match déjà connu",
// pas celui, bien plus fréquent, d'un NOUVEAU match qui apparaît dans le
// calendrier FD.org au fil du temps. Repassé à TTL.SCHEDULED (1h, aligné
// sur Programme) — écarte ce bug par construction (moins d'une heure entre
// la publication d'un match et sa prise en compte ici).
const ALL_COMPS_TTL = TTL.SCHEDULED
// Étalement sur ~8s (STAGGER_MS, même pattern que useRecentDaysMatches plus
// haut) : les 8-11 appels FD.org/ESPN partaient tous en même temps à chaque
// expiration du cache — déjà sans risque réel pour FD.org (le verrou
// d'espacement global dans api/football.js sérialise de toute façon), mais
// visuellement une "rafale" trompeuse dans l'onglet Network (a alimenté
// plusieurs fausses pistes de debug). Étalé, plus de rafale visible,
// comportement identique au final. Toujours valable indépendamment du TTL
// ci-dessus, conservé tel quel.
const ALL_COMPS_STAGGER_MS = 800  // 800ms x jusqu'à 10 = ~8s pour la dernière compétition

export function useUpcomingMatchesAllComps(compIds, windowDays = 7) {
  const windowMs   = windowDays * 24 * 60 * 60 * 1000
  // ⚠️ V3 (24/07) : bascule des 6 grands championnats FD.org→ESPN pour ce
  // hook (voir preferEspnForMajors, fetchMatchesForComp) — clé de cache
  // bumpée pour que le fix s'applique immédiatement (même raisonnement que
  // le passage V1→V2 documenté juste au-dessus) plutôt que d'attendre
  // jusqu'à 1h (ALL_COMPS_TTL) que l'ancien cache FD.org expire tout seul.
  const key        = cacheKey(`ALL_V3_${windowDays}`, 'SCHEDULED')
  const cachedData = readCacheStale(key)
  const cachedAt   = getCacheSavedAt(key)
  const ttl        = ALL_COMPS_TTL

  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', 'ALL_V3', 'SCHEDULED', compIds.join(','), windowDays],
    queryFn: async () => {
      const results = await Promise.allSettled(
        compIds.map(async (id, i) => {
          if (i > 0) await new Promise(r => setTimeout(r, i * ALL_COMPS_STAGGER_MS))
          return fetchMatchesForComp(id, 'SCHEDULED', { preferEspnForMajors: true })
        })
      )
      const now = Date.now()
      const merged = filterUpcomingWindow(
        results.filter(r => r.status === 'fulfilled' && Array.isArray(r.value)).flatMap(r => r.value),
        now, windowMs
      )

      // Rien à écrire en cache si la fenêtre est vide (ex: creux entre 2
      // journées) — évite d'effacer un cache valide avec un résultat vide.
      // Le fallback est lui aussi re-filtré (même fenêtre) : jamais de vieux
      // match déjà joué réintroduit via le cache stale.
      if (merged.length === 0) return filterUpcomingWindow(readCacheStale(key), now, windowMs)
      writeCache(key, merged, ttl)
      return merged
    },
    // Forme fonction (déjà utilisée dans useEspnScores.js) plutôt qu'une valeur
    // calculée directement dans le corps du hook : Date.now() n'est alors appelé
    // que quand React Query en a réellement besoin (1ère fois pour cette
    // queryKey), pas à chaque render — résout l'appel impur pendant le render
    // sans changer le résultat.
    initialData:          () => filterUpcomingWindow(cachedData, Date.now(), windowMs),
    initialDataUpdatedAt: cachedAt,
    staleTime: ttl,
    retry: false,
  })

  return {
    matches: data ?? [],
    loading: isLoading,
    error: classifyFetchError(error?.message),
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
    error: classifyFetchError(error?.message),
  }
}