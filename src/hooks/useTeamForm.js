import { useQuery, useQueries } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCache, readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { outcomeForTeam, resolveFdTeamId } from '../utils/matchUtils'
import { fetchClubMatchesRaw } from './useMatchs'
import { MIN_LEAGUE_GAMES } from '../utils/calcProno'
import { fetchEspnCompMatches } from '../utils/espnAdapter'
import { COMPETITION_ESPN_SLUG } from '../data/competitions'
import { shouldQueryWcEcWithMeta } from '../utils/wcEcGate'
import { registerFdCallAttempt, waitForFdSpacing } from '../utils/fdSpacingTracker'

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
// ⚠️ AJOUT TDC/CS/USC (constat utilisateur, 17/08 : "Historique" (H2H) vide/
// figé sur Lens-PSG, Trophée des Champions) : même trou que NL/CAN/COPA/UEL/
// UECL ci-dessus, jamais comblé pour les supercoupes nationales/européenne
// (SINGLE_MATCH_COMPS, competitions.js — 1 match/an, aucune couverture
// football-data.org). `fetchTeamForm('TDC')` tapait donc FD.org avec un code
// de compétition qui n'existe pas chez eux → toujours vide → compMatches
// TOUJOURS vide pour ces 3 comps → double conséquence : le "Historique"
// (useH2HRows, MatchModal.jsx) n'avait aucune donnée où chercher les
// confrontations passées (repli compH2H) NI le match du jour une fois
// terminé, ET la Forme récente était logiquement vide aussi (pas de bug
// visible, juste vide, contrairement au vrai bug Deportivo/Alavés — cause
// différente, corrigée séparément — mais même trou de données sous-jacent).
// COMPETITION_ESPN_SLUG (competitions.js) couvre déjà ces 3 codes depuis le
// 16/08 — seule cette liste n'avait pas été mise à jour en même temps.
const ESPN_SOURCED_FORM_COMPS = new Set(['NL', 'CAN', 'COPA', 'UEL', 'UECL', 'TDC', 'CS', 'USC'])

// Un seul fetch "saison" FD.org (season explicite optionnel) → matchs FINISHED
// côté client (status=FINISHED non supporté par le free tier sur certains
// endpoints). Factorisé pour être réutilisé par la saison en cours ET le
// repli saison précédente ci-dessous.
// ⚠️ AJOUT `fresh` (24/07, trouvé via l'audit chronologique demandé par
// l'utilisateur) : expose si la réponse vient d'un vrai appel FD.org à
// l'instant (absence de X-Cache, voir api/football.js) ou d'un cache Redis
// (HIT/STALE) — sert à fetchTeamForm ci-dessous, qui enchaîne 2 appels pour
// la MÊME compétition (saison en cours + repli saison précédente) quasi tout
// le temps en ce moment (intersaison, saison en cours toujours vide) : même
// collision que fetchClubMatchesRaw (useMatchs.js) sur le verrou
// d'espacement global, jamais corrigée ici jusqu'à présent.
async function fetchFinishedSeasonMatches(selectedComp, seasonParam) {
  // Enregistré AVANT le await (voir fdSpacingTracker.js) — permet à
  // useScorers (voisin, même page) d'attendre CET appel-ci s'il a démarré
  // après celui de useStandings.
  const fetchPromise = fdFetch(
    fdUrl(`/api/v4/competitions/${selectedComp}/matches${seasonParam}`)
  )
  registerFdCallAttempt(fetchPromise.then(r => !r.headers.get('X-Cache')).catch(() => false))
  const res = await fetchPromise
  // 429 → throw pour que React Query retente (rate limit temporaire)
  if (res.status === 429) throw new Error('rate_limit')
  const fresh = !res.headers.get('X-Cache')
  if (!res.ok) return { matches: [], fresh }
  const json = await res.json()
  return { matches: (json.matches ?? []).filter(m => m.status === 'FINISHED'), fresh }
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
export function buildFormMap(matches) {
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

  // ⚠️ RÉÉCRIT (27/07, demande explicite utilisateur : "fusionne, moins de
  // requêtes... et je veux que les compétitions comme coupe de france
  // comptent dans la forme récente, c'est le but") : cette branche refaisait
  // avant sa PROPRE séquence complète (saison en cours + repli saison
  // précédente, 2 appels FD.org), un quasi-doublon de fetchClubMatchesRaw
  // (useMatchs.js) qui fait EXACTEMENT la même chose pour Programme/
  // Résultats (même repli saison précédente) — 2 implémentations séparées,
  // jamais partagées, du même besoin. Réutilise maintenant directement
  // fetchClubMatchesRaw (verrou anti-doublon "in-flight" ajouté là-bas) :
  // si Programme/Résultats ont déjà tapé FD.org pour cette compétition, le
  // cache Redis serveur (voire le verrou in-flight côté client si c'est
  // vraiment simultané) absorbe l'appel — FD.org n'est plus jamais
  // interrogé 2 fois pour la même donnée. Inclut aussi les coupes
  // nationales (Coupe de France/Copa del Rey/FA Cup, déjà mergées par
  // fetchClubMatchesRaw, source ESPN) : elles comptent maintenant dans
  // Forme récente/Stats saison/Compos probables, comme n'importe quel autre
  // match joué par l'équipe — demande explicite.
  if (isClub) {
    const raw = await fetchClubMatchesRaw(selectedComp)
    if (raw == null) {
      const stale = readCacheStale(`teamform2_${selectedComp}`)
      if (stale) return stale
      return { formMap: {}, matches: [], isLastSeason: false }
    }

    const cupMatchesRaw = raw.filter(m => m.isCup)
    const leagueMatches = raw.filter(m => !m.isCup)

    // ⚠️ AJOUT (constat utilisateur, 16/08 : losange "forme récente" de
    // Deportivo — 0 match joué cette saison — affichait le résultat GAGNANT
    // d'un autre club) : cupMatchesRaw est sourcé ESPN (fetchEspnCupMatches,
    // espnAdapter.js) — homeTeam.id/awayTeam.id y sont donc des ids ESPN, un
    // ESPACE D'ID DIFFÉRENT des ids FD.org utilisés par leagueMatches ET par
    // le classement (StandingsTable.jsx fait `formMap[team.team.id]`, un vrai
    // id FD.org). Si un id ESPN coïncide PAR HASARD avec l'id FD.org d'une
    // AUTRE équipe (même bug de fond que resolveFdTeamId ailleurs dans
    // l'app, voir son commentaire), le résultat de ce match de coupe
    // s'affichait sous le mauvais club dans buildFormMap ci-dessous. Chaque
    // équipe du match de coupe est résolue INDÉPENDAMMENT par nom contre
    // leagueMatches (source d'ids FD.org fiable, toujours dispo dès le
    // calendrier publié) — strict:true, une équipe sans correspondance de
    // nom claire (ex. petit club amateur d'un 1er tour de coupe, jamais dans
    // leagueMatches) garde son id ESPN brut plutôt que d'être écartée : ça
    // préserve le résultat du VRAI club suivi (celui dont "forme récente"
    // nous intéresse) même quand son adversaire de coupe n'est pas
    // identifiable côté FD.org. Seul un match où NI L'UN NI L'AUTRE ne
    // résout (round 100% amateur, aucun intérêt ici) est écarté.
    const cupMatches = cupMatchesRaw
      .map(m => {
        const homeId = resolveFdTeamId(m.homeTeam, leagueMatches, { loose: true, strict: true })
        const awayId = resolveFdTeamId(m.awayTeam, leagueMatches, { loose: true, strict: true })
        if (homeId == null && awayId == null) return null
        return {
          ...m,
          homeTeam: { ...m.homeTeam, id: homeId ?? m.homeTeam?.id },
          awayTeam: { ...m.awayTeam, id: awayId ?? m.awayTeam?.id },
        }
      })
      .filter(Boolean)

    // "Saison en cours" = la plus récente présente dans les données FD.org
    // (season.startDate le plus tardif parmi les matchs de championnat).
    // Les matchs de coupe (source ESPN, pas de champ `season` FD.org)
    // rejoignent toujours ce lot : fetchEspnCupMatches (espnAdapter.js) ne
    // renvoie qu'une fenêtre glissante autour d'aujourd'hui (±60/150j),
    // jamais d'historique multi-saisons — toujours "actuel" par construction.
    const latestStart = leagueMatches.reduce((max, m) => {
      const s = m.season?.startDate
      return s && s > max ? s : max
    }, '')
    const currentLeague = leagueMatches.filter(m => m.season?.startDate === latestStart)
    const olderLeague   = leagueMatches.filter(m => m.season?.startDate !== latestStart)
    const current = [...currentLeague, ...cupMatches]
    const matches = current.filter(m => m.status === 'FINISHED')

    // Repli saison précédente (constat utilisateur : cotes de pronos
    // identiques pour tous les matchs en tout début de saison club, ex.
    // août) — tant que la saison en cours n'a pas encore MIN_LEAGUE_GAMES
    // matchs FINISHED, formMap est vide et compMatches ne permet pas à
    // calcPronoAdvanced de construire un modèle de buts fiable (calcProno.js)
    // → repli neutre identique pour tous les matchs. Cas équipe promue :
    // aucune entrée dans la saison précédente de CETTE compétition (elle
    // jouait dans une autre division) → reste neutre plutôt que comparée à
    // tort à un autre championnat, comportement voulu.
    if (matches.length < MIN_LEAGUE_GAMES) {
      const fallbackMatches = olderLeague.filter(m => m.status === 'FINISHED')
      // Vérification a posteriori sur la date du match le plus RÉCENT du
      // lot : si même celui-là est plus vieux que ~450j (saison + trêve),
      // le repli n'est pas fiable — on ne l'utilise pas, quel que soit le
      // nombre de matchs (même logique qu'avant ce refactor).
      // ⚠️ BUG CORRIGÉ (30/07, trouvé via repro test avec données réalistes) :
      // Math.max(max, new Date(m.utcDate).getTime()) — si UN SEUL match de
      // fallbackMatches a un utcDate invalide/absent, .getTime() renvoie NaN
      // et Math.max(..., NaN) VAUT NaN, ce qui contamine TOUT le reduce pour
      // toujours (NaN se propage à chaque itération suivante). Résultat :
      // newestFallbackTs devient NaN → fallbackIsRecent devient false → le
      // repli "saison précédente" entier est silencieusement désactivé, alors
      // que fallbackMatches contient pourtant une saison complète valide.
      // Un seul match mal formé (edge case FD.org réel : date reportée non
      // confirmée, etc.) suffisait à vider Stats saison/Forme récente/Historique
      // pour TOUS les matchs à venir de la compétition. Ignore maintenant
      // silencieusement les dates invalides au lieu de laisser NaN se propager.
      const MAX_FALLBACK_AGE_DAYS = 450
      const newestFallbackTs = fallbackMatches.reduce((max, m) => {
        const t = new Date(m.utcDate).getTime()
        return Number.isFinite(t) ? Math.max(max, t) : max
      }, 0)
      const fallbackIsRecent = newestFallbackTs > 0
        && (Date.now() - newestFallbackTs) / 86_400_000 <= MAX_FALLBACK_AGE_DAYS
      if (fallbackMatches.length >= MIN_LEAGUE_GAMES && fallbackIsRecent) {
        // formMap (losanges "forme récente") ne doit PAS venir de la saison
        // précédente — le mercato a pu tout changer entre-temps (demande
        // explicite, 25/07). `matches` (saison en cours, quasi vide en
        // intersaison) donne donc un formMap vide. `matches` RETOURNÉ
        // (compMatches, 2e champ) reste `fallbackMatches` — le modèle de
        // pronostic et le repli H2H continuent d'utiliser la saison passée.
        return { formMap: buildFormMap(matches), matches: fallbackMatches, isLastSeason: true }
      }
    }

    // ⚠️ REVERT (constat utilisateur, 20/08 : "tu as remis la forme récente
    // de la saison d'avant sur certaines équipes, surtout la Serie A") :
    // une tentative plus tôt le même jour retournait `current` (non filtré
    // FINISHED, saison en cours + SCHEDULED) au lieu de `matches` ici, pour
    // que le H2H d'un match à venir se résolve même sans confrontation
    // encore jouée CETTE saison (cas Rayo-Alavés). Mais TeamFormTable/
    // calcSeasonTeamStats (MatchModal.jsx/MatchPage.jsx) filtrent bien
    // FINISHED — vérifié — mais ne filtrent PAS par SAISON : une fois fusionné
    // avec `fallbackMatches` (saison précédente) dans la branche juste
    // au-dessus, `.slice(-5)` de TeamFormTable pouvait piocher des matchs des
    // 2 saisons mélangés (ex. Serie A, saison en cours encore trop jeune) —
    // exactement le mélange que le commentaire "formMap ne doit PAS venir de
    // la saison précédente" (25/07, juste au-dessus) était censé empêcher.
    // Le H2H reste corrigé malgré ce revert : useH2HHistory (fetch 100%
    // indépendant de ce hook, voir MatchDuJourCard.jsx/MatchPoster.jsx/
    // MatchPage.jsx/LiveMatchPage.jsx, commit dédié du même jour) fournit
    // déjà les saisons passées SPÉCIFIQUEMENT au pool de résolution H2H, sans
    // jamais toucher au `compMatches` utilisé ici pour Forme récente/Stats
    // saison — la bonne séparation était d'utiliser ce hook-là pour ce
    // besoin-là, pas d'élargir ce que ce fichier-ci expose partout.
    return { formMap: buildFormMap(matches), matches, isLastSeason: false }
  }

  // ── WC/EC : compétitions non-annuelles, pas de "saison précédente"
  // comparable au sens sportif — comportement historique inchangé (propre
  // séquence FD.org avec le portillon partagé wcEcGate.js). ──
  // Portillon partagé (voir wcEcGate.js) : évite la cascade FD.org ci-dessous
  // quand on sait déjà qu'aucun match WC/EC n'existe dans une large fenêtre —
  // cas quasi permanent hors Mondial/Euro. Repli sur le cache existant (même
  // clé que useTeamForm/useTeamFormMulti, teamform2_${comp}) plutôt qu'un
  // objet vide, pour ne jamais régresser une forme déjà affichée.
  // ⚠️ AJOUT wait `fresh` (25/07, constat utilisateur : 429 spécifique à WC,
  // jamais aux compétitions club) : sans cette attente, un portillon qui
  // vient de vraiment taper FD.org fait bloquer l'appel plus bas par notre
  // propre garde-fou serveur (verrou d'espacement ~6s).
  const { should, fresh } = await shouldQueryWcEcWithMeta()
  if (!should) {
    const stale = readCacheStale(`teamform2_${selectedComp}`)
    if (stale) return stale
    return { formMap: {}, matches: [], isLastSeason: false }
  }
  if (fresh) await new Promise(r => setTimeout(r, 6_000))
  // Protège aussi contre un hook voisin totalement différent (useWcKnockout,
  // useTodayMatches...) qui viendrait de taper FD.org — voir fdSpacingTracker.js.
  await waitForFdSpacing()

  const seasonParam = selectedComp === 'WC' ? '?season=2026'
    : selectedComp === 'EC' ? `?season=${new Date().getFullYear()}`
    : ''
  const primary = await fetchFinishedSeasonMatches(selectedComp, seasonParam)
  const matches = primary.matches

  return { formMap: buildFormMap(matches), matches, isLastSeason: false }
}

// ⚠️ AJOUT `delayMs` (24/07, trouvé via l'audit chronologique demandé par
// l'utilisateur) : même collision que celle documentée dans useScorers.js —
// Classement.jsx ET ClassementTab (MatchModal.jsx) appellent useStandings +
// useTeamForm pour LA MÊME compétition quasi au même instant, sans le savoir
// l'un de l'autre, sur le même verrou d'espacement FD.org global. Défaut à 0
// (comportement inchangé pour MatchPage.jsx/MatchDuJourCard.jsx/
// LiveMatchPage.jsx, qui n'appellent jamais useStandings en parallèle).
// ⚠️ AJOUT `enabled` (24/07, même audit) : permet à un appelant qui reçoit
// déjà formMap/compMatches tout faits via props (voir MatchPoster.jsx) de
// désactiver la requête réseau de CETTE instance sans violer les Rules of
// Hooks (le Hook doit toujours être appelé, juste avec la query désactivée)
// — évite un fetch FD.org redondant avec celui déjà fait ailleurs (ex.
// useTeamFormMulti côté Accueil.jsx) pour la même compétition.
export function useTeamForm(selectedComp, delayMs = 0, enabled = true) {
  const cacheKey = `teamform2_${selectedComp}`

  const { data, isLoading } = useQuery({
    queryKey: ['teamForm2', selectedComp, selectedComp === 'WC' ? '2026' : 'cur'],
    queryFn: () => {
      const run = async () => {
        // delayMs>0 : signal "un hook voisin (useStandings, même page) peut
        // avoir déjà tapé FD.org juste avant" — attente ADAPTATIVE (voir
        // fdSpacingTracker.js), pas un délai fixe : 0ms si ce voisin n'a en
        // fait rien tapé de réel (cache déjà chaud), sinon juste le temps
        // qui reste avant l'expiration du verrou serveur.
        if (delayMs > 0) await waitForFdSpacing(delayMs)
        return fetchTeamForm(selectedComp)
      }
      const result = run()
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
    enabled:              !!selectedComp && enabled,
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
    // ⚠️ AJOUT (bug réel trouvé le 27/07, demande explicite utilisateur :
    // "pas la peine de recuperer la forme recente et stat saison des
    // dernieres saison... juste h2h") : fetchTeamForm calcule bien
    // `isLastSeason` (voir ci-dessus) et MatchPage.jsx/LiveMatchPage.jsx
    // s'en servaient DÉJÀ (destructuré depuis ce hook, transmis à
    // MpSeasonStats) — mais ce hook ne le renvoyait jamais dans son objet
    // de retour : `isLastSeason` valait donc toujours `undefined` côté
    // appelant, quelle que soit la réalité. Le garde-fou existait dans le
    // code mais n'a jamais été branché — Stats saison/Forme récente
    // affichaient silencieusement la saison précédente en intersaison
    // depuis le début. Corrigé ici ; redevient automatiquement `false` dès
    // que la vraie saison en cours atteint MIN_LEAGUE_GAMES matchs
    // FINISHED (voir fetchTeamForm plus haut) — pas besoin d'y retoucher
    // quand les championnats démarreront.
    isLastSeason: data?.isLastSeason ?? false,
    isLoading,
  }
}

// ⚠️ AJOUT (25/07, demande explicite utilisateur) : Programme (Match.jsx) ne
// précharge PAS la forme (pas de losanges affichés là-bas, contrairement à
// Accueil/useTeamFormMulti) — cliquer une card déclenche donc un tout premier
// chargement à froid sur la fiche match (useTeamForm(compId), voir
// MatchPage.jsx), dont dépendent aussi le prono, "Stats saison" et le repli
// H2H. Plutôt que précharger la forme de TOUTES les compétitions affichées
// dans la liste (gaspillage FD.org pour des matchs jamais cliqués — écarté
// explicitement, voir discussion), ce helper précharge UNIQUEMENT la
// compétition du match sur lequel l'utilisateur vient de cliquer, au moment
// précis du clic (juste avant la navigation) — même queryKey que useTeamForm
// ci-dessus, donc la fiche match retrouve directement le résultat déjà en
// vol/en cache au montage, sans le redemander.
export function prefetchTeamForm(queryClient, selectedComp) {
  if (!selectedComp) return
  const cacheKey = `teamform2_${selectedComp}`
  queryClient.prefetchQuery({
    queryKey: ['teamForm2', selectedComp, selectedComp === 'WC' ? '2026' : 'cur'],
    queryFn: async () => {
      const result = await fetchTeamForm(selectedComp)
      writeCache(cacheKey, result, FORM_STALE)
      return result
    },
    staleTime: FORM_STALE,
  })
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

  // ⚠️ AJOUT (24/07, trouvé via l'audit chronologique demandé par
  // l'utilisateur — "regarde chaque requête dans l'ordre, dis-moi si ça se
  // croise") : AUCUN espacement n'existait ici entre les compétitions —
  // l'Accueil affichant souvent des matchs de plusieurs grands championnats
  // en même temps, ce hook lançait autant de fetchTeamForm() SIMULTANÉS,
  // chacun pouvant lui-même faire jusqu'à 2 vrais appels FD.org (saison en
  // cours + repli saison précédente, voir fetchTeamForm) — un vrai risque de
  // rafale à chaque lancement de l'Accueil, resté invisible jusqu'ici. Même
  // remède qu'ailleurs dans l'app (ALL_COMPS_STAGGER_MS, useMatchs.js) :
  // léger espacement entre compétitions.
  const STAGGER_MS = 1_000

  const results = useQueries({
    queries: codes.map((code, i) => {
      const cacheKey = `teamform2_${code}`
      return {
        queryKey:             ['teamForm2', code, code === 'WC' ? '2026' : 'cur'],
        queryFn:              async () => {
          if (i > 0) await new Promise(r => setTimeout(r, i * STAGGER_MS))
          const result = await fetchTeamForm(code)
          // Voir le commentaire équivalent dans useTeamForm ci-dessus.
          writeCache(cacheKey, result, FORM_STALE)
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

  // ⚠️ AJOUT (constat utilisateur : Deportivo — 0 match joué cette saison —
  // affichait un losange vert de victoire sur sa card de match Accueil,
  // contre Elche, un match 100% La Liga) : les compétitions ESPN-only
  // (NL/CAN/COPA/UEL/UECL, voir ESPN_SOURCED_FORM_COMPS plus haut) ont un
  // formMap keyé par des ids ESPN — un espace DIFFÉRENT des ids FD.org
  // utilisés par les championnats club. Object.assign fusionnait
  // auparavant TOUTES les compétitions affichées le même jour sur
  // l'Accueil dans un SEUL objet plat, sans distinction d'origine.
  // ⚠️ 1ère version de ce fix (insuffisante, gardée en mémoire pour la
  // suite) : ne fusionnait les compétitions ESPN-only QUE sur les clés
  // encore vides — protège contre l'écrasement d'une vraie entrée FD.org,
  // mais PAS contre le cas de Deportivo, justement 0 match joué : sa clé
  // est vide côté PD (rien à écraser), donc un id ESPN coïncidant par
  // hasard avec le sien "comblait" ce vide avec le résultat d'un club
  // totalement différent — exactement le bug resté après ce 1er passage.
  // Fix complet : chaque match des compétitions ESPN-only est résolu PAR
  // NOM contre les matchs des compétitions FD.org du jour (même technique
  // que pour les matchs de coupe, voir fetchTeamForm plus haut) AVANT de
  // reconstruire son formMap — un id ESPN qui ne correspond au nom
  // d'AUCUN club FD.org du jour ne peut plus jamais entrer dans le formMap
  // partagé, qu'une clé soit déjà prise ou non.
  const formMap    = {}
  const resultByCode = Object.fromEntries(codes.map((c, i) => [c, results[i]]))
  const fdCodes   = codes.filter(c => !ESPN_SOURCED_FORM_COMPS.has(c))
  const espnCodes = codes.filter(c => ESPN_SOURCED_FORM_COMPS.has(c))
  for (const c of fdCodes) Object.assign(formMap, resultByCode[c]?.data?.formMap ?? {})
  if (espnCodes.length) {
    const fdTeamPool = fdCodes.flatMap(c => resultByCode[c]?.data?.matches ?? [])
    for (const c of espnCodes) {
      const espnMatches = resultByCode[c]?.data?.matches ?? []
      const resolvedMatches = espnMatches
        .filter(m => m.status === 'FINISHED')
        .map(m => {
          const homeId = resolveFdTeamId(m.homeTeam, fdTeamPool, { loose: true, strict: true })
          const awayId = resolveFdTeamId(m.awayTeam, fdTeamPool, { loose: true, strict: true })
          if (homeId == null && awayId == null) return null
          return {
            ...m,
            homeTeam: { ...m.homeTeam, id: homeId ?? m.homeTeam.id },
            awayTeam: { ...m.awayTeam, id: awayId ?? m.awayTeam.id },
          }
        })
        .filter(Boolean)
      const espnFormMap = buildFormMap(resolvedMatches)
      for (const [id, form] of Object.entries(espnFormMap)) {
        if (!(id in formMap)) formMap[id] = form
      }
    }
  }

  // matchesByComp : nécessaire à calcPronoAdvanced (calcProno.js) pour le
  // modèle buts marqués/encaissés — contrairement à formMap (fusionné, une
  // seule table id équipe → forme), les matchs saison doivent rester séparés
  // PAR compétition (la moyenne du championnat n'a de sens que dans une
  // seule compétition à la fois).
  const matchesByComp = {}
  codes.forEach((code, i) => { matchesByComp[code] = results[i]?.data?.matches ?? [] })

  return { formMap, matchesByComp, isLoading: results.some(r => r.isLoading) }
}
