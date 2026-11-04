import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { classifyFetchError } from '../utils/fetchErrors'
import { registerFdCallAttempt, waitForFdSpacing } from '../utils/fdSpacingTracker'
import { NO_SCORERS_COMPS } from '../data/competitions'

// Aligné sur le TTL du cache serveur (api/football.js) — inutile d'être plus frais
// côté client que la donnée que le serveur peut réellement fournir.
// ⚠️ 2min → 5min (02/11, même changement que le TTL serveur, api/football.js
// getTtl — garde les deux alignés, sinon React Query redemanderait côté
// client avant même que le cache serveur ait expiré, sans aucun gain).
const STALE_MS = 1000 * 60 * 5  // 5min (était 2min, 30min avant ça)

// ⚠️ AJOUT (même optimisation que useStandings.js, 23/07 — idée utilisateur
// appliquée par cohérence ici aussi) : les buteurs ne peuvent pas plus
// changer que le classement sans match — 2min tout le temps, même les jours
// sans aucun match pour cette compétition, n'avait pas de sens. hasMatchToday
// (passé par l'appelant, même valeur déjà calculée pour useStandings dans
// Classement.jsx — aucun calcul en double) bascule le staleTime : 24h les
// jours sans match, 2min les jours où ça joue.
const NO_MATCH_STALE_MS = 1000 * 60 * 60 * 6  // 6h (voir scorersUpdateDue : hors mise à jour attendue, inutile de redemander)

// ⚠️ EXTRAIT ici (02/11, constat utilisateur : "si on fait un appel pour la
// CAN alors qu'elle joue pas ce jour-là, ça sert à rien") — ce calcul vivait
// jusqu'ici UNIQUEMENT dans Classement.jsx (`scorersLiveWindow`), donc
// TeamSearchPage.jsx (`useTeamScorersMulti`, useTeamSearch.js) ne l'utilisait
// jamais : il appelait `fetchScorersData(comp)` avec `hasMatchToday` par
// défaut (`true`), traitant TOUJOURS une compétition comme "ça joue
// aujourd'hui" — même une compétition sporadique (CAN/Copa América) qui n'a
// peut-être aucun match avant des mois. Résultat concret : une équipe
// affichée dans la fiche équipe et jouant en CAN consommait le TTL serveur
// court (5min) en PERMANENCE pour cette compétition, jamais le TTL long
// (24h), même les jours où CAN ne joue littéralement pas — exactement le
// gaspillage signalé. Extraction en fonction pure réutilisable par les deux
// appelants (Classement.jsx ET useTeamSearch.js), AUCUN changement de
// comportement pour Classement.jsx (même calcul, même fenêtre).
// ── Quand mettre à jour le classement buteurs (04/11 nuit, demande utilisateur) ─────────
// Règle voulue : UN appel dès que TOUS les matchs d'une compétition d'un même jour sont finis
// (football-data.org met `/scorers` à jour dans la minute), puis plus rien pendant des heures —
// pas d'appel toutes les 5min pendant les matchs, pas de rafraîchissement la nuit.
// `scorersUpdateDue` est vrai quand : le dernier jour avec des matchs terminés (≤ 3 jours) n'a
// plus aucun match non terminé, ET la copie locale date d'AVANT la fin probable de ce dernier
// match (`lastUpdated` FD.org, sinon coup d'envoi + 150min). Une fois la donnée récupérée, `cacheSavedAt` dépasse ce seuil →
// faux → on retombe sur NO_MATCH_STALE_MS (6h). Sans copie locale (premier lancement) : vrai si
// ce jour-là s'est terminé il y a moins de 8h (sinon la copie serveur `live=0`, jusqu'à 6h, pouvait
// dater d'avant le match — constaté : Haaland à 4 buts au lieu de 5).
const SCORERS_END_AFTER_KICKOFF_MS = 1000 * 60 * 150
const SCORERS_FRESH_INSTALL_MS = 1000 * 60 * 60 * 8
const NOT_PLAYED = new Set(['POSTPONED', 'CANCELLED', 'SUSPENDED', 'AWARDED'])
export function scorersUpdateDue(finishedMatches, compId, scheduledMatches = null, now = Date.now()) {
  const t = m => (m?.utcDate ? new Date(m.utcDate).getTime() : NaN)
  const day = m => new Date(t(m)).toLocaleDateString('sv-SE')
  const finished = (finishedMatches ?? []).filter(m => Number.isFinite(t(m)) && t(m) <= now && now - t(m) < 3 * 86_400_000)
  if (finished.length === 0) return false
  const lastDay = finished.map(day).sort().at(-1)
  const sameDay = [...finished, ...(scheduledMatches ?? [])].filter(m => Number.isFinite(t(m)) && day(m) === lastDay && !NOT_PLAYED.has(m.status))
  // Un match de ce jour pas encore terminé (programmé, ou commencé il y a < 150min) : on attend.
  const pending = sameDay.some(m => m.status !== 'FINISHED' && (t(m) > now || now - t(m) < SCORERS_END_AFTER_KICKOFF_MS))
  if (pending) return false
  // Fin du dernier match : `lastUpdated` de football-data.org (moment où il l'a passé FINISHED) si
  // présent, sinon coup d'envoi + 150min (matchs sourcés ESPN, sans ce champ).
  const endOf = m => {
    const lu = Date.parse(m.lastUpdated)
    return Number.isFinite(lu) && lu > t(m) ? lu : t(m) + SCORERS_END_AFTER_KICKOFF_MS
  }
  const lastEnd = Math.max(...sameDay.map(endOf))
  const cacheSavedAt = getCacheSavedAt(`scorers3_${compId}`)
  if (!cacheSavedAt) return now - lastEnd < SCORERS_FRESH_INSTALL_MS
  return cacheSavedAt < lastEnd
}

// ⚠️ AJOUT `delayMs` (24/07, trouvé via l'audit chronologique demandé par
// l'utilisateur) : Classement.jsx appelle useStandings + useTeamForm +
// useScorers pour LA MÊME compétition quasi au même instant à chaque
// changement de championnat — 3 hooks indépendants, aucun ne sait que les
// autres existent, donc aucun espacement entre eux malgré le même verrou
// FD.org global. Résultat concret : sur un championnat jamais consulté cette
// session (pas de repli stale possible), 2 des 3 requêtes perdent la course
// au verrou et échouent (buteurs/forme vides le temps d'un retry). Défaut à 0
// (comportement inchangé pour tout autre appelant — MatchPage.jsx,
// MatchPoster.jsx, LiveMatchPage.jsx... qui n'appellent jamais useStandings
// en parallèle) — seuls Classement.jsx et ClassementTab (MatchModal.jsx, même
// collision : standings+form ensemble) passent un délai explicite.
// ⚠️ Source ESPN AJOUTÉE PUIS RETIRÉE LE MÊME JOUR (26/09) : après le constat
// utilisateur "y'a pas... le classement des meilleurs buteurs dans ligue des
// nations", `/apis/site/v2/sports/soccer/{slug}/statistics` avait d'abord été
// branché ici (endpoint jamais essayé jusque-là, voir historique CLAUDE.md
// pour /leaders et TheSportsDB, tous deux vides). Retiré quelques minutes
// après déploiement : constat utilisateur PRÉCIS et vérifiable ("impossible
// que haaland il est 4 buts et joao felix 2 vu que y'avait meme pas 4 buts et
// 1 but au portugal seulement") — recroisé en direct avec les VRAIS totaux
// d'équipe de ce même ESPN (`/apis/v2/sports/soccer/uefa.nations/standings`) :
// Portugal n'a marqué QUE 1 but au total (1 match joué) alors que João Félix
// seul apparaissait à 2 ; la Norvège n'a marqué QUE 3 buts au total alors que
// Haaland (4) + Bobb (2) totalisaient 6 à eux deux. Mathématiquement
// impossible si l'endpoint reflétait la saison en cours — very probablement
// un cumul historique/all-time de la compétition (toutes éditions confondues)
// plutôt qu'un classement de la saison affichée, aucun paramètre de
// filtrage par saison/édition trouvé sur cet endpoint pour le corriger.
// CAN/COPA/UEL/UECL restent dans `NO_SCORERS_COMPS` (bouton "Buteurs" caché
// pour ces 4, voir Classement.jsx) — gap honnêtement documenté plutôt qu'une
// donnée fausse affichée. `compactEspnScorers`/le mode `scorers=1` de
// `api/espn.js` ont été retirés avec ce revert (code mort, plus aucun
// appelant) — voir CLAUDE.md pour l'historique complet de cette tentative.
//
// ⚠️ NL relancée le même jour via un calcul MAISON, puis RETIRÉE le 30/09
// (demande explicite utilisateur, feature qui n'affichait jamais rien tant
// que le quota Upstash reste épuisé — voir NO_SCORERS_COMPS, competitions.js,
// pour l'historique complet). NL rejoint CAN/COPA/UEL/UECL, aucune des 5 n'a
// de source de buteurs fiable actuellement.
// ⚠️ EXTRAIT (28/10, demande utilisateur : meilleurs buteurs de l'équipe
// dans la fiche équipe, voir TeamSearchPage.jsx) : la logique de fetch
// (NO_SCORERS_COMPS, repli limit=500→100, repli cache stale) vivait jusqu'ici
// inline dans le `queryFn` de useScorers — extraite ici en fonction pure
// réutilisable par useTeamScorersMulti (useTeamSearch.js), SANS AUCUN
// changement de comportement : useScorers l'appelle désormais elle aussi, à
// l'identique. Partage la MÊME queryKey (['scorers', compId]) que ce hook —
// un classement buteurs déjà consulté via la page Classement n'est jamais
// re-fetché pour la fiche équipe, et vice-versa.
// ⚠️ AJOUT `hasMatchToday` (02/11, constat utilisateur : "le classement des
// buteurs met 24s à s'afficher c'est trop lent") — le vrai coût venait du
// chemin LENT (verrou d'espacement 12s + retries 8s/16s, voir useScorers
// plus bas) déclenché à chaque cache-miss serveur, et ce cache-miss arrivait
// bien trop souvent : le TTL Redis de /scorers (api/football.js, getTtl)
// est fixé à 2min QUEL QUE SOIT le contexte, alors que côté client cette
// même donnée est déjà traitée comme stable 24h entières les jours SANS
// match pour cette compétition (NO_MATCH_STALE_MS plus haut) — un buteur ne
// peut tout simplement pas marquer hors d'un vrai match en cours. Le cache
// client (localStorage) protège le même appareil, mais pas un autre
// utilisateur/onglet qui retombe sur le serveur avec seulement 2min de TTL.
// Corrigé en propageant ce même signal au serveur : `live=0` dans l'URL
// (nouvelle clé de cache Redis distincte, aucun risque sur l'ancienne) quand
// `hasMatchToday` est faux — `getTtl` (api/football.js) lui donne alors un
// TTL de 24h au lieu de 2min. Résultat concret : les jours sans match pour
// cette compétition (l'immense majorité du temps), N'IMPORTE QUEL visiteur
// obtient un HIT Redis instantané, SANS jamais passer par le verrou
// d'espacement ni les retries — le chemin lent (12-24s) ne se déclenche plus
// que les jours où ça joue vraiment, là où la fraîcheur a un sens.
export async function fetchScorersData(compId, delayMs = 0, hasMatchToday = true) {
  const key = `scorers3_${compId}`

  if (NO_SCORERS_COMPS.has(compId)) { writeCache(key, [], STALE_MS); return [] }

  if (delayMs > 0) await waitForFdSpacing(delayMs)
  const isAnnualIntl = compId === 'WC' || compId === 'EC'
  const season = new Date().getFullYear()
  const liveFlag = hasMatchToday ? '' : '&live=0'

  async function tryFetch(url) {
    const fetchPromise = fdFetch(fdUrl(url))
    registerFdCallAttempt(fetchPromise.then(resp => !resp.headers.get('X-Cache')).catch(() => false))
    const r = await fetchPromise
    if (r.status === 429 || r.status === 403) {
      // ⚠️ AJOUT (02/11, suite directe du constat utilisateur "la première
      // fois qu'on ouvre un classement buteurs jamais consulté, il n'y a
      // AUCUN cache possible — ça doit quand même marcher, sans bombarder")
      // — api/football.js répond déjà avec un en-tête `Retry-After` (15s pour
      // un budget/minute épuisé, le cas le plus fréquent — voir son
      // commentaire sur DOWN_TTL) : jusqu'ici cette info était jetée, et le
      // client retentait selon un calendrier FIXE (8s/16s) choisi à l'aveugle,
      // parfois AVANT que le serveur n'ait dit que c'était utile. On la lit et
      // on l'attache à l'erreur pour que `retryDelay` (plus bas) puisse
      // attendre AU MOINS ce que le serveur demande — jamais moins, donc
      // jamais une retentative gâchée par anticipation.
      const err = new Error(String(r.status))
      const retryAfterS = Number(r.headers.get('Retry-After'))
      if (Number.isFinite(retryAfterS) && retryAfterS > 0) err.retryAfterMs = retryAfterS * 1000
      throw err
    }
    const fresh = !r.headers.get('X-Cache')
    if (!r.ok) throw new Error(String(r.status))
    const j = await r.json()
    return { scorers: j.scorers ?? null, fresh }
  }

  let scorers = null
  try {
    let fresh = false
    if (isAnnualIntl) {
      const r = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=500&season=${season}${liveFlag}`)
      scorers = r.scorers
      fresh = r.fresh
    }
    if (!scorers || scorers.length === 0) {
      if (fresh) await new Promise(res => setTimeout(res, 6_000))
      try {
        const r2 = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=500${liveFlag}`)
        scorers = r2.scorers
      } catch (e) {
        if (e.message === '429' || e.message === '403') throw e
        const r3 = await tryFetch(`/api/v4/competitions/${compId}/scorers?limit=100${liveFlag}`)
        scorers = r3.scorers
      }
    }
  } catch (err) {
    const stale = readCacheStale(key)
    if (stale) return stale
    throw err
  }
  scorers = scorers ?? []
  writeCache(key, scorers, STALE_MS)
  return scorers
}

export function useScorers(compId, hasMatchToday = true, delayMs = 0) {
  // ⚠️ Clé bumpée scorers_ → scorers2_ (même fix qu'ailleurs dans l'app pour
  // ce type de bug, voir Pronos.jsx classement) : le bug corrigé ci-dessus
  // (tryFetch) a pu déjà écrire un [] en cache localStorage AVANT ce
  // déploiement, avec un staleTime allant jusqu'à 24h (NO_MATCH_STALE_MS) —
  // sans ce bump, un appareil déjà "empoisonné" continuerait d'afficher
  // "Aucun buteur disponible" jusqu'à l'expiration naturelle de ce cache
  // périmé. Changer la clé fait repartir de zéro instantanément pour tout
  // le monde, sans jamais devoir attendre.
  // ⚠️ Re-bumpée scorers2_ → scorers3_ (28/08, 2e bug trouvé le même jour,
  // voir le `throw err` ci-dessous) : le tout premier déploiement du fix
  // précédent a pu, sur certains appareils, essuyer un 429 (budget FD.org
  // partagé, cf CLAUDE.md) juste après le changement de clé — cet ancien
  // code avalait alors l'erreur et écrivait quand même un faux [] sous
  // scorers2_. TTL court (2min) donc pas critique, mais autant repartir
  // propre plutôt que d'attendre une expiration naturelle.
  const key = `scorers3_${compId}`

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['scorers', compId],
    // ⚠️ Logique de fetch déplacée dans fetchScorersData (voir juste avant
    // cette fonction, extraction du 28/10) — appelée ici à l'identique,
    // aucun changement de comportement.
    queryFn: () => fetchScorersData(compId, delayMs, hasMatchToday),
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            hasMatchToday ? STALE_MS : NO_MATCH_STALE_MS,
    // ⚠️ BUG CORRIGÉ (constat utilisateur, 02/09 : "le classement des buteurs
    // a du mal à se charger, faut changer de championnat et revenir sur celui
    // qu'on voulait voir"). Ce `retry: false` était la cause exacte du
    // symptôme décrit : sur la page Classement, TROIS hooks visent
    // football-data.org pour la même compétition au même instant (standings,
    // forme récente, buteurs) et se disputent le verrou d'espacement global.
    // Les buteurs partent EN DERNIER (delayMs 12s, le plus gros stagger), donc
    // c'est celui qui perd le plus souvent la course et se prend un 429.
    // Sans retry, un seul échec transitoire laissait la liste vide DÉFINITIVEMENT
    // — jusqu'à ce que l'utilisateur quitte le championnat et y revienne, ce
    // qui remonte le composant et relance la requête. D'où sa manip.
    // Les deux autres hooks avaient déjà leur filet (useStandings a un repli
    // ESPN + copie stale, useTeamForm a `retry: 2`) ; les buteurs étaient les
    // seuls à n'en avoir aucun — et c'est justement la donnée pour laquelle il
    // n'existe AUCUNE source de secours gratuite (voir CLAUDE.md, gap connu).
    // Backoff volontairement LONG (8s puis 16s) : le verrou d'espacement
    // serveur dure ~7,5s (SPACING_MS = 60000/MINUTE_CAP, voir api/football.js).
    // Retenter plus tôt retomberait dans le même verrou et gâcherait l'essai
    // sans rien tenter de réel.
    // ⚠️ RETRY REVU UNE 2e FOIS (02/11, retour utilisateur immédiat sur le
    // fix précédent : "90 à 110 secondes c'est hyper lent [...] je veux que
    // ça s'affiche dans la seconde") — root cause du calendrier précédent :
    // il forçait `Math.max(base, serverHint)` avec `base` démarrant à 8s —
    // donc même quand le serveur répondait "réessaie dans 1s" (le cas le
    // PLUS fréquent, voir ci-dessous), le client attendait quand même au
    // moins 8s par construction. Le vrai goulot n'était pas le nombre de
    // tentatives mais ce plancher artificiel.
    // Changement de fond CÔTÉ SERVEUR (api/football.js, computeRetryAfterSeconds) :
    // l'en-tête Retry-After n'est plus un "15" fixe et deviné, mais calculé
    // sur le VRAI état Redis — la cause la plus fréquente de blocage est le
    // verrou d'espacement (SPACING_MS, 6s max, voir reserveQuota), presque
    // toujours déjà bien entamé → le serveur annonce maintenant souvent 1 à
    // 3s, pas 15. Ici : on FAIT CONFIANCE à ce chiffre directement (plancher
    // minimal 500ms pour ne jamais marteler à 0ms), au lieu de l'écraser avec
    // un calendrier fixe choisi à l'aveugle — donc le cas courant (simple
    // contention passagère) se résout maintenant en 1 à quelques secondes,
    // au plus proche de "la seconde" honnêtement atteignable. Le calendrier
    // [1s, 3s, 6s, 10s] ne sert plus que de repli pour une erreur SANS hint
    // serveur (coupure réseau, pas un vrai 429/403 de notre proxy).
    // Honnêteté, inchangée depuis le fix précédent : un vrai blocage 403
    // prolongé (anti-abus FD.org, jusqu'à 300s/5min, voir DOWN_TTL_FORBIDDEN
    // — rare, distinct d'une simple contention) reste honnêtement annoncé
    // par le serveur (plus de mensonge à 15s dans ce cas non plus) — le
    // client attend alors réellement ce que le serveur demande, jamais plus,
    // jamais moins ; aucune solution ne peut raccourcir ce cas précis sans
    // soit mal informer l'utilisateur, soit relever MINUTE_CAP (risque de
    // suspension déjà documenté à plusieurs reprises, jamais fait sans
    // accord explicite de l'utilisateur).
    retry: 4,
    retryDelay: (attempt, error) => {
      const serverHint = Number(error?.retryAfterMs)
      if (Number.isFinite(serverHint) && serverHint > 0) return Math.max(500, serverHint)
      return [1_000, 3_000, 6_000, 10_000][attempt] ?? 10_000
    },
    enabled: !!compId,
  })

  // ⚠️ AJOUT (04/11, bug trouvé en reproduisant en direct — vérifié sur la prod,
  // navigateur SANS aucun cache — needsScorersCatchUp calculait bien "il faut
  // rattraper", mais le classement affichait quand même encore l'ancien total
  // 13h après la fin des matchs, alors que FD.org lui-même était déjà à jour
  // depuis le matin, confirmé par un fetch brut) : changer `hasMatchToday` (donc
  // `staleTime` ci-dessus) ne déclenche RIEN tout seul en React Query — une
  // query déjà montée ne se refetch jamais automatiquement juste parce qu'elle
  // redevient "stale" entre deux renders ; il faut un vrai déclencheur (montage,
  // focus, refetchInterval, ou un refetch() explicite), et aucun des trois
  // n'existe ici. `needsScorersCatchUp` (Classement.jsx) pouvait donc très bien
  // calculer "il faut rattraper" sans que ça ne déclenche jamais le moindre
  // nouveau fetch tant que le composant restait monté. Même trou, en fait, pour
  // la transition "normale" (un match vient tout juste de commencer alors que
  // Classement est déjà ouvert) — jamais remarqué avant car on remonte presque
  // toujours le composant entre-temps (changement de compétition, navigation).
  // refetch() explicite sur le FRONT MONTANT de hasMatchToday (false→true) :
  // couvre les deux cas (vraie fenêtre live ET rattrapage) avec le même
  // mécanisme, sans rien changer quand hasMatchToday reste stable ou redescend.
  // 04/11 : `hasMatchToday` = « une mise à jour est due » (scorersUpdateDue). Vérification : si le
  // total de buts du classement n'a pas bougé après ce refetch, UN seul nouvel essai 10min plus
  // tard (le cache serveur de 5min a pu servir une copie d'avant la fin des matchs).
  const prevHasMatchToday = useRef(hasMatchToday)
  const retryTimer = useRef(null)
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => {
    if (hasMatchToday && !prevHasMatchToday.current) {
      const total = d => (d ?? []).reduce((n, x) => n + (x.goals || 0), 0)
      const before = total(dataRef.current)
      refetch().then(res => {
        if (total(res?.data) === before && !retryTimer.current) {
          retryTimer.current = setTimeout(() => { retryTimer.current = null; refetch() }, 10 * 60_000)
        }
      }).catch(() => {})
    }
    prevHasMatchToday.current = hasMatchToday
  }, [hasMatchToday, refetch])
  useEffect(() => () => { clearTimeout(retryTimer.current); retryTimer.current = null }, [])

  return {
    scorers: data ?? [],
    loading: isLoading,
    // Voir classifyFetchError (utils/fetchErrors.js).
    error:   classifyFetchError(error?.message),
  }
}
