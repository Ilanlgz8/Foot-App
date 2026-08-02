import { useQuery } from '@tanstack/react-query'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { KNOCKOUT_ORDER, KNOCKOUT_LABELS } from './useWcKnockout'
import { fetchEspnCompMatches, fetchEspnCupMatches } from '../utils/espnAdapter'
import { COMPETITION_ESPN_SLUG, DOMESTIC_CUPS, MAJOR_LEAGUE_FD_ID } from '../data/competitions'
import { classifyFetchError } from '../utils/fetchErrors'
import { shouldQueryWcEcWithMeta } from '../utils/wcEcGate'
import { registerFdCallAttempt, waitForFdSpacing } from '../utils/fdSpacingTracker'

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
// ⚠️ BUG CORRIGÉ (constat utilisateur, 02/08 : cotes par défaut ET H2H
// manquant sur beaucoup de matchs — les 2 symptômes venaient de la même
// cause) : le seuil `month <= 7` considérait le 1er août comme déjà la
// nouvelle saison — vérifié en direct sur l'API FD.org réelle ce jour-là
// (season=2026 pour FL1) : 306 matchs, TOUS "SCHEDULED", ZÉRO "FINISHED".
// La vraie reprise n'a lieu qu'à partir du 15/08 (LaLiga) et du 21-22/08
// (Ligue 1/Premier League), calendriers ESPN réels vérifiés. Résultat :
// fetchClubMatchesRaw demandait `?season=2026` comme repli "saison
// précédente" — exactement la MÊME saison vide que la saison en cours, donc
// AUCUNE vraie donnée historique (2025-26) récupérée. Impact double : (1)
// calcPronoAdvanced retombe sur un prior neutre partout (compMatches vide,
// pas de modèle de buts) — "cotes par défaut" ; (2) useH2HRows (MatchModal.jsx)
// perd aussi son repli compH2H (qui a besoin de compMatches rempli) — seul
// fdRecent (appel FD.org direct par id de match) reste disponible, moins
// complet — "H2H disparu sur beaucoup de matchs". Les deux symptômes,
// signalés séparément par l'utilisateur, pointaient donc vers la même cause
// unique. Décalé à `month <= 8`, sans risque de régression une fois la
// vraie saison lancée : ce repli n'est utilisé QUE tant que la saison en
// cours n'a encore aucun match FINISHED (hasFinished) — dès le 1er vrai
// résultat, la branche cesse d'être utilisée automatiquement.
export function getClubSeason() {
  const now = new Date()
  const month = now.getMonth() + 1 // 1-12
  const year = now.getFullYear()
  // Juin à août : la saison précédente vient de se terminer, la nouvelle n'a
  // pas encore débuté pour aucun des championnats suivis.
  return month <= 8 ? year - 1 : year
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
  // Enregistré AVANT le await (voir fdSpacingTracker.js) — permet à un appel
  // voisin (ex: EC après WC dans useUpcomingMatchesAllComps) d'attendre
  // CET appel-ci avant de décider s'il doit patienter.
  const fetchPromise = fdFetch(fdUrl(url))
  registerFdCallAttempt(fetchPromise.then(r => !r.headers.get('X-Cache')).catch(() => false))
  const res = await fetchPromise
  if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
  if (!res.ok) return null
  const json = await res.json()
  return json.matches ?? []
}

// ⚠️ AJOUT (24/07, constat utilisateur : switch LaLiga→Serie A après 8s
// d'attente = 429 quand même, alors que le budget FD.org n'a rien à voir avec
// ce délai précis) : variante de tryFetch() qui expose aussi si la réponse
// vient d'un vrai appel FD.org à l'instant (`fresh`, absence de X-Cache) ou
// d'un cache Redis (HIT/STALE, header présent — voir api/football.js). Sert
// uniquement à fetchClubMatchesRaw ci-dessous, qui enchaîne 2 appels pour la
// MÊME compétition (season + repli sans season) — les 5 autres appelants de
// tryFetch() restent inchangés (pas besoin de cette info).
async function tryFetchWithMeta(url) {
  // Enregistré AVANT le await (voir fdSpacingTracker.js).
  const fetchPromise = fdFetch(fdUrl(url))
  registerFdCallAttempt(fetchPromise.then(r => !r.headers.get('X-Cache')).catch(() => false))
  const res = await fetchPromise
  if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
  const fresh = !res.headers.get('X-Cache')
  if (!res.ok) return { matches: null, fresh }
  const json = await res.json()
  return { matches: json.matches ?? [], fresh }
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
// ⚠️ AJOUT coalescing + export (27/07, demande explicite utilisateur :
// "fusionne, moins de requêtes") : fetchClubMatchesRaw est maintenant aussi
// appelée depuis useTeamForm.js (Forme récente/Stats saison/Compos
// probables réutilisent désormais cette même donnée au lieu de refaire leur
// propre séquence FD.org quasi-identique — voir le commentaire détaillé
// là-bas). Une page comme MatchPage.jsx appelle useTeamForm(compId) ET
// useMatches(compId,'SCHEDULED') quasi au même instant, au montage — sans
// protection, les 2 pourraient déclencher 2 VRAIS appels FD.org simultanés
// pour la MÊME compétition avant que le cache Redis serveur (api/football.js)
// n'ait eu le temps d'absorber le premier. Ce verrou "in-flight" mémorise la
// promesse en cours par compétition : un 2e appel pendant que le 1er est
// encore en vol reçoit directement CETTE MÊME promesse au lieu de repartir
// pour son compte — dédup garantie côté client, pas seulement "probable"
// via le cache serveur.
const inFlightRawFetches = new Map()

export function fetchClubMatchesRaw(selectedComp) {
  if (inFlightRawFetches.has(selectedComp)) {
    return inFlightRawFetches.get(selectedComp)
  }
  const promise = fetchClubMatchesRawInner(selectedComp).finally(() => {
    inFlightRawFetches.delete(selectedComp)
  })
  inFlightRawFetches.set(selectedComp, promise)
  return promise
}

async function fetchClubMatchesRawInner(selectedComp) {
  // Mémorise la dernière vraie erreur réseau (429/403) — voir le rethrow en
  // fin de fonction : sans ça, une tentative bloquée finissait en résultat
  // vide silencieux, perdant la distinction "vraiment bloqué" vs "vraiment
  // aucun match", dont classifyFetchError (fetchErrors.js) a besoin pour
  // afficher "Veuillez patienter quelques instants" au lieu d'un écran vide.
  let lastErr = null
  let primaryFresh = false

  // ⚠️ REFONTE COMPLÈTE (24/07, idée utilisateur : "avant je n'avais AUCUN
  // problème pour afficher les données, donc c'est nous, pas FD.org" — root
  // cause enfin bien identifiée). L'ancienne version appelait TOUJOURS
  // `season=${getClubSeason()}` (la saison qui vient de finir) EN PREMIER,
  // puis — dès qu'il manquait une des 2 catégories FINISHED/SCHEDULED, quasi
  // systématiquement en intersaison — un 2e vrai appel FD.org quasi
  // simultané (repli sans season). Ces 2 appels se disputaient le MÊME
  // verrou d'espacement global (~7,5s, voir SPACING_MS dans api/football.js)
  // à CHAQUE consultation, d'où le 429 même après un switch de compétition.
  //
  // Nouvelle logique, inversée : `current` (sans param season — la vraie
  // notion de "saison active" de FD.org) part EN PREMIER et suffit À LUI
  // SEUL dès qu'une vraie saison est publiée avec au moins un résultat joué
  // (cas normal, ~11 mois/an — contient déjà FINISHED + SCHEDULED dans la
  // même réponse). Le 2e appel (saison qui vient de finir) n'est tenté QUE
  // si `current` n'a encore AUCUN match FINISHED — le seul cas où c'est
  // réellement utile : la fenêtre d'intersaison (~1 mois/an) où la nouvelle
  // saison est déjà publiée côté calendrier mais n'a produit aucun résultat.
  // Et même dans ce cas, ce 2e appel passe par le MÊME cache Redis partagé
  // (TTL 300s + file prioritaire cf-worker) que tout le reste de l'app — la
  // plupart du temps un cache HIT instantané, pas un 2e vrai appel FD.org.
  //
  // Bonus demandé explicitement : sert aussi de repli d'AFFICHAGE pour
  // Résultats (derniers résultats de la saison qui vient de se terminer) tant
  // que la nouvelle saison n'a produit aucun résultat — et s'efface tout
  // seul dès que `current` a son 1er FINISHED, sans logique de nettoyage à
  // part (hasFinished redevient vrai naturellement, la branche ci-dessous ne
  // se déclenche plus).
  // ⚠️ AJOUT cache dédié (25/07, constat utilisateur : Programme vide "Aucun
  // match à venir" en revenant de Résultats/Classement, alors que les matchs
  // s'étaient bien affichés juste avant) : même mécanisme que le repli
  // "saison précédente" plus bas (voir son commentaire), mais dans l'AUTRE
  // sens. Programme et Résultats PARTAGENT le même cache RAW (voir plus haut
  // dans le fichier) — si l'utilisateur va sur Résultats/Classement et que
  // CET appel précis (`current`, saison en cours) échoue sur LEUR refetch en
  // arrière-plan (429 transitoire, budget partagé), l'ancien code repartait
  // de zéro (`current = null`) puis ne récupérait que le repli "saison
  // précédente" (FINISHED uniquement) — le RAW partagé se faisait écraser
  // par une version SANS AUCUN match SCHEDULED. Retour sur Programme : le
  // cache partagé, déjà corrompu par cette écriture, ne contient plus rien
  // à venir → "Aucun match à venir" alors que les matchs existent bien côté
  // FD.org. Même remède : cache dédié pour CE résultat précis, relu comme
  // repli si l'appel échoue cette fois, pour ne jamais régresser une donnée
  // déjà bonne.
  const currentKey = `matches_current_${selectedComp}`
  let current = null
  try {
    const r = await tryFetchWithMeta(`/api/v4/competitions/${selectedComp}/matches`)
    current = r.matches
    primaryFresh = r.fresh
  } catch (e) { lastErr = e /* → repli ci-dessous, ne pas abandonner tout de suite */ }

  if (current != null) {
    // `current` peut légitimement être un tableau vide (vraie info : aucun
    // match programmé actuellement) — seule l'absence de réponse exploitable
    // (null, voir tryFetchWithMeta) déclenche le repli cache ci-dessous.
    writeCache(currentKey, current, 24 * 3600 * 1000)
  } else {
    const cachedCurrent = readCacheStale(currentKey)
    if (cachedCurrent != null) current = cachedCurrent
  }

  const hasFinished = (current ?? []).some(m => m.status === 'FINISHED')
  let all = current ?? []

  if (!hasFinished) {
    // Même protection anti-collision que le switch de compétition (voir
    // historique) : n'attend que si le 1er appel a réellement tapé FD.org
    // (primaryFresh) — un cache HIT/STALE ne prend pas le verrou, le repli
    // part alors immédiatement, sans latence ajoutée.
    if (primaryFresh) await new Promise(r => setTimeout(r, 6_000))

    // ⚠️ AJOUT cache dédié long terme (25/07, constat utilisateur : "on
    // récupère les résultats de la saison juste avant, ça devrait pas
    // repoll, ça devrait rester en cache le temps que la saison qui arrive
    // commence") — root cause du symptôme qui persistait sur Résultats après
    // les fix précédents : ces matchs FINISHED de la saison passée sont de
    // l'HISTORIQUE, définitivement figé — aucune raison de les re-taper à
    // chaque montage de page (refetchOnMount:'always'). Avant ce fix, un
    // simple 429 transitoire sur CET appel précis (repli optionnel, contenu
    // du RAW cache PARTAGÉ avec Programme — voir plus haut) effaçait purement
    // et simplement les résultats déjà affichés au prochain refetch réussi
    // (le nouveau RAW ne contenait plus que les matchs SCHEDULED de `current`,
    // sans erreur levée nulle part donc invisible pour le filet de secours
    // classique). Cache dédié à part (clé propre, jamais mélangée au RAW
    // partagé) : écrit dès qu'un vrai fetch réussit, relu comme repli
    // immédiat si CE fetch précis échoue — les résultats affichés à l'écran
    // ne peuvent plus jamais régresser à cause d'un 429 ponctuel sur ce seul
    // appel. Aucun risque de rester périmé : `hasFinished` redevient vrai dès
    // que la vraie saison 2026/27 produit son 1er résultat, cette branche
    // entière (et donc ce cache) cesse alors d'être utilisée.
    const lastSeasonKey = `matches_lastSeason_${selectedComp}`
    let lastSeason = null
    const primarySeasonYear = getClubSeason()
    try {
      lastSeason = await tryFetch(
        `/api/v4/competitions/${selectedComp}/matches?season=${primarySeasonYear}`
      )
    } catch (e) {
      // ⚠️ NE PLUS PROPAGER via `lastErr` ici (25/07, voir bug détaillé plus
      // bas) : ce repli n'est qu'un enrichissement optionnel — si `current`
      // (juste au-dessus) a déjà réussi avec de vraies données (matchs
      // SCHEDULED de la saison à venir), un échec ICI ne doit jamais faire
      // disparaître ces données déjà en main. `lastErr` ne sert plus qu'au
      // cas où `current` LUI-MÊME a échoué (voir catch plus haut) — seul cas
      // où on n'a vraiment rien à montrer.
      void e
    }
    // ⚠️ AJOUT (02/08, constat vérifié en direct sur l'API réelle football-data.org,
    // 5 tentatives espacées de plusieurs minutes) : `season=${primarySeasonYear}`
    // (l'exercice qui vient de se terminer) peut renvoyer une réponse VIDE côté
    // FD.org de façon reproductible, alors que `season=${primarySeasonYear - 1}`
    // (l'exercice encore avant) répond normalement avec de vrais matchs FINISHED.
    // Cause exacte non identifiable depuis cet environnement (pas d'accès aux
    // logs/quota du compte football-data.org) — mais reproductible sur PD, donc
    // pas un simple 429/403 passager (déjà couvert par le catch ci-dessus, qui
    // lève une vraie erreur distincte). Repli en cascade : si la saison
    // immédiatement précédente ne renvoie rien, retente automatiquement une
    // saison plus tôt avant d'abandonner — une vraie donnée (même un peu plus
    // vieille) reste toujours préférable à des cotes par défaut identiques sur
    // tous les matchs. S'auto-corrige tout seul le jour où
    // `season=${primarySeasonYear}` refonctionne (repasse alors en 1er choix,
    // ce 2e appel ne se déclenche même plus). Coût réseau négligeable : ce
    // repli ne s'exécute déjà que ~1 mois/an (intersaison, voir `!hasFinished`
    // plus haut), et passe par le même cache Redis serveur partagé (api/football.js)
    // que tout le reste — 1 seul vrai appel FD.org pour TOUS les utilisateurs,
    // pas par utilisateur. Limite connue : `MAX_FALLBACK_AGE_DAYS` (450j, voir
    // useTeamForm.js) rendra ce repli-ci trop vieux pour être utilisé à partir
    // de mi-août 2026 — sans conséquence pratique, la vraie saison 2026/27 aura
    // alors démarré (hasFinished redevient vrai, toute cette branche s'efface).
    if (lastSeason == null || lastSeason.length === 0) {
      try {
        const olderSeason = await tryFetch(
          `/api/v4/competitions/${selectedComp}/matches?season=${primarySeasonYear - 1}`
        )
        if (olderSeason != null && olderSeason.length > 0) lastSeason = olderSeason
      } catch (e) {
        void e
      }
    }
    if (lastSeason != null && lastSeason.length > 0) {
      writeCache(lastSeasonKey, lastSeason, 24 * 3600 * 1000)
    } else {
      // Échec ou réponse vide cette fois-ci : on retombe sur la dernière
      // version connue plutôt que de perdre ces résultats (readCacheStale
      // sert la donnée peu importe son âge — voir localCache.js).
      lastSeason = readCacheStale(lastSeasonKey)
    }
    if (lastSeason != null && lastSeason.length > 0) {
      const seen = new Set(all.map(m => m.id))
      all = [...all, ...lastSeason.filter(m => !seen.has(m.id))]
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
    if (cupMatches.length > 0) all = [...all, ...cupMatches]
  }

  // ⚠️ BUG CORRIGÉ (25/07, constat utilisateur : Serie A/LaLiga affichaient
  // les matchs puis "Veuillez patienter" ~2s après, alors que les autres
  // championnats non) : il existait ICI un 2e garde-fou qui vérifiait
  // `hasFinishedNow` (un match FINISHED) au lieu de "a-t-on vraiment des
  // données à montrer" — or on est TOUJOURS dans le bloc `if (!hasFinished)`
  // plus haut uniquement quand la saison en cours n'a encore aucun FINISHED
  // (intersaison, cas normal pour tous les championnats en ce moment), donc
  // `hasFinishedNow` était FAUX PAR CONSTRUCTION. Résultat : dès que le repli
  // saison précédente échouait (429, budget partagé déjà pris par quelqu'un
  // d'autre) — même si `all` contenait déjà les vrais matchs SCHEDULED de la
  // saison à venir, récupérés avec succès par le tout premier appel plus haut
  // — cette donnée pourtant bonne était systématiquement jetée, remplacée par
  // une erreur. Vérifié en direct sur l'API réelle : Serie A a bien des vrais
  // matchs SCHEDULED publiés (saison 2026/27) que `current` récupère
  // correctement — c'est CE fallback raté qui les effaçait après coup. Le
  // repli saison précédente n'est qu'un enrichissement optionnel (repêcher
  // des résultats affichables tant que la vraie saison n'a encore rien
  // produit) : son échec ne doit jamais faire disparaître des données déjà en
  // main. Le check ci-dessous (`all.length === 0 && lastErr`, `fallbackErr`
  // inclus puisqu'il alimente aussi `lastErr`) couvre déjà entièrement le
  // seul cas légitime — lever l'erreur quand on n'a VRAIMENT rien à montrer,
  // peu importe la catégorie — le 2e garde-fou était donc à la fois faux ET
  // redondant, supprimé.
  if (all.length === 0 && lastErr) throw lastErr

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
  //
  // ⚠️ AJOUT (24/07, trouvé via l'audit chronologique demandé par
  // l'utilisateur — "regarde chaque requête dans l'ordre, dis-moi si ça se
  // croise ou ça bouche quelque part") : cette cascade (jusqu'à 3 appels
  // FD.org pour SCHEDULED, 2 pour FINISHED) part sur CHAQUE lancement de
  // l'Accueil via useUpcomingMatchesAllComps (WC/EC sont dans
  // ACCUEIL_COMP_IDS) — et comme il n'y a actuellement AUCUN match SCHEDULED
  // pour WC (Coupe du monde finie) ni EC (pas d'Euro cette année), la
  // cascade va systématiquement jusqu'au bout, plusieurs vrais appels FD.org
  // dos à dos pour la MÊME compétition, sans aucune protection — même
  // collision que fetchClubMatchesRaw plus haut (verrou d'espacement global
  // ~7,5s), jamais corrigée ici jusqu'à présent. Même remède : n'attendre
  // que si la tentative précédente a réellement tapé FD.org (primaryFresh).
  // Portillon partagé (voir wcEcGate.js) : évite la cascade FD.org ci-dessous
  // (jusqu'à 3 appels) quand on sait déjà qu'aucun match WC/EC n'existe dans
  // une large fenêtre — cas quasi permanent hors Mondial/Euro.
  // ⚠️ AJOUT wait `fresh` (25/07, constat utilisateur : 429 spécifique à WC,
  // jamais aux compétitions club) : sans cette attente, un portillon qui
  // vient de vraiment taper FD.org fait bloquer l'appel juste en dessous par
  // notre propre garde-fou serveur (verrou d'espacement ~6s) — même remède
  // que partout ailleurs dans ce fichier.
  const { should, fresh } = await shouldQueryWcEcWithMeta()
  if (!should) return []
  if (fresh) await new Promise(r => setTimeout(r, 6_000))
  // ⚠️ AJOUT (26/07, audit "dis moi toutes les requêtes au lancement") :
  // WC et EC sont voisins dans compIds (useUpcomingMatchesAllComps) mais
  // espacés seulement de ALL_COMPS_STAGGER_MS (800ms) — largement
  // insuffisant contre le verrou d'espacement serveur (~6s). Attente
  // adaptative (fdSpacingTracker.js) : 0ms si aucun appel voisin réel n'est
  // en cours (cas club, ESPN — la grande majorité), sinon le temps qui
  // reste réellement avant l'expiration du verrou.
  await waitForFdSpacing()

  let matches
  const wcSeason = new Date().getFullYear()
  if (status === 'SCHEDULED') {
    let r = await tryFetchWithMeta(`/api/v4/competitions/${selectedComp}/matches?season=${wcSeason}`)
    matches = r.matches
    if (!matches || matches.length === 0) {
      if (r.fresh) await new Promise(res => setTimeout(res, 6_000))
      r = await tryFetchWithMeta(`/api/v4/competitions/${selectedComp}/matches?status=TIMED&season=${wcSeason}`)
      matches = r.matches
    }
    if (!matches || matches.length === 0) {
      if (r.fresh) await new Promise(res => setTimeout(res, 6_000))
      matches = await tryFetch(`/api/v4/competitions/${selectedComp}/matches`)
    }
  } else {
    const r = await tryFetchWithMeta(`/api/v4/competitions/${selectedComp}/matches?status=FINISHED&season=${wcSeason}`)
    matches = r.matches
    if (!matches || matches.length === 0) {
      if (r.fresh) await new Promise(res => setTimeout(res, 6_000))
      matches = await tryFetch(`/api/v4/competitions/${selectedComp}/matches?status=FINISHED`)
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
  // ⚠️ AJOUT (25/07, constat utilisateur : LaLiga "Aucun match à venir" ~2min
  // après un retour sur l'app, seule cette compét, disparu tout seul après).
  // Bug trouvé : `ttl` ci-dessus sert à DEUX choses différentes qui n'ont
  // aucune raison d'être identiques — le staleTime React Query (2min pour
  // isClubShared, volontairement court) ET le TTL DISQUE de writeCache(). Or
  // purgeExpiredCache() (appelé une fois à chaque lancement, main.jsx)
  // SUPPRIME PHYSIQUEMENT toute entrée dont `exp` est dépassé — avec un TTL
  // disque de 2min, le cache RAW de CHAQUE compét club repart de zéro à
  // pratiquement CHAQUE relance de l'app (PWA relancée après avoir été tuée en
  // arrière-plan par l'OS, très fréquent sur mobile), pile le filet de
  // sécurité que readStaleWithMigration()/readCacheStale() sont censés fournir
  // "peu importe l'âge" (voir localCache.js) — exactement le même principe déjà
  // appliqué aux caches dédiés current/lastSeason plus haut (24h), qui eux
  // survivent. Résultat concret : si le tout premier refetch après une relance
  // tombe sur un 429/403 transitoire (budget FD.org partagé, plusieurs compéts
  // consultées d'affilée), il n'y a plus rien à servir en repli → flash vide,
  // qui se résout tout seul dès qu'un refetch suivant réussit. Honnêteté : je
  // n'ai pas pu reproduire ce cas précis en direct pour le confirmer à 100%,
  // mais c'est un vrai bug indépendant de la cause exacte de ce signalement —
  // le TTL disque DOIT être long comme partout ailleurs dans ce fichier.
  const diskTtl     = isClubShared ? 24 * 3600 * 1000 : ttl

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
    writeCache(key, merged, diskTtl) // auto-guérison : la prochaine lecture retombe directement sur la clé RAW
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
        if (matches.length > 0) writeCache(key, matches, diskTtl)
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
    // ⚠️ REVERT (constat utilisateur, capture Network : rafale de 8 requêtes
    // 429 vers /api/football en ~15s — "tu veux qu'on se fasse suspendre ou
    // quoi") : le retry 429/403 ajouté plus tôt (2 tentatives, 8s d'écart)
    // semblait raisonnable pris isolément, mais pour les compét club
    // (isClubShared), queryFn appelle fetchClubMatchesRaw() qui fait JUSQU'À
    // 2 vrais appels FD.org par tentative (season=X + repli sans season) —
    // un retry ici ne rejoue pas 1 requête mais rejoue LES 2, donc jusqu'à
    // 3 tentatives × 2 appels = 6 requêtes FD.org pour UNE seule compét,
    // exactement au moment où FD.org nous bloque déjà (le pire moment pour
    // insister). Vu l'historique de suspensions répétées du compte FD.org
    // documenté dans CLAUDE.md, ce risque l'emporte largement sur le
    // bénéfice (un 429 transitoire manqué une fois). Le vrai filet de
    // sécurité reste ailleurs et n'a pas besoin de ce retry pour fonctionner :
    // le circuit breaker + cache stale côté SERVEUR (api/football.js,
    // partagé entre tous les utilisateurs) absorbe déjà l'essentiel des 429,
    // et readStaleWithMigration() (voir plus haut, catch du queryFn) sert la
    // dernière donnée valide en cache dès qu'une vraie erreur remonte jusqu'ici
    // — sans requête supplémentaire. `refetchOnMount: 'always'` ci-dessus
    // suffit à retenter naturellement à la prochaine visite de la page, sans
    // rafale.
    retry: false,
    // ⚠️ AJOUT `enabled` (27/07, réutilisation de ce hook depuis
    // MatchPage.jsx/LiveMatchPage.jsx pour la résolution H2H — voir
    // resolveFdMatchId, matchUtils.js) : cette query n'avait JAMAIS eu de
    // garde-fou `enabled`, sans risque tant que le seul appelant (Match.jsx/
    // Resultat.jsx, Programme) avait toujours un `selectedComp` valide
    // (choisi dans une liste fermée). Un nouvel appelant peut légitimement
    // avoir un `compId` encore `null` (le temps que le match charge) — sans
    // ce garde-fou, ça aurait tapé `/api/v4/competitions/null/matches` pour
    // rien à chaque montage. `options.enabled` par défaut `true` : aucun
    // changement de comportement pour les appelants existants.
    enabled: (options.enabled ?? true) && !!selectedComp,
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