// Récupère les détails ESPN d'un match terminé (buteurs + stats) à la demande.
//
// Stratégie en 2 passes :
//   1. Scoreboard (dates=YYYYMMDD) → trouve l'event + son ID ESPN
//   2. Summary (?eventId=XXX)      → détails complets : buts, stats, possession
//
// Le summary ESPN est la seule source fiable de buts pour les matchs passés.
// FD.org ne fournit pas de buts pour toutes les compétitions sur le free tier.
//
// ⚠️ Depuis la compaction du cache ESPN (voir api/espn.js/espnSummaryParse.js
// — demande utilisateur : "les stats doivent rester en cache sans jamais
// disparaître", sans faire exploser le stockage Redis) : la Passe 2 (summary)
// renvoie déjà { scorers, cards, stats, lineups } directement — plus besoin
// de parser le JSON ESPN brut ici. extractMatchDetails (partagé avec le
// serveur, voir src/utils/espnSummaryParse.js) ne sert plus que pour la
// Passe 1 (scoreboard, jamais mis en cache, toujours au format ESPN natif).
import { useQuery } from '@tanstack/react-query'
import { COMP_ESPN, fuzzyTeam } from './useLiveMinute'
import { extractMatchDetails } from '../utils/espnSummaryParse'

// Résultat vide/inexploitable : soit l'event n'a pas été trouvé (`null`),
// soit trouvé mais ESPN n'a encore rien publié comme plays/details/stats.
function isEspnDetailEmpty(d) {
  return d == null || (d.scorers.length === 0 && d.cards.length === 0 && d.stats === null)
}

// Retente automatique tant que vide (retour utilisateur : "on retente
// plusieurs fois tant qu'on a pas la donnée, plafonné à 1 tentative/30s") —
// ESPN peut mettre quelques minutes à publier son résumé complet après le
// coup de sifflet final. `dataUpdateCount` (fetchs réussis, y compris vides)
// sert de compteur de tentatives sans état supplémentaire à gérer.
//
// ⚠️ BUG CORRIGÉ (constat utilisateur : "ça disparaît au bout de 5min alors
// que c'est censé être en cache permanent") : l'ancien plafond (10 × 30s =
// 5min) donnait l'IMPRESSION d'une perte de données alors qu'en réalité rien
// n'avait jamais fini de charger — sur un match à très fort trafic (la
// finale CM, largement le match le plus consulté du tournoi), ESPN peut
// mettre BIEN plus de 5min à finir de publier son résumé complet (rosters +
// stats + détails), et une fois ce plafond atteint, la query arrête
// DÉFINITIVEMENT de réessayer (React Query ne relance plus refetchInterval)
// — pire, cet état "abandonné, vide" est lui-même persisté dans le cache
// localStorage (voir main.jsx), donc même un rechargement complet de la page
// ne redonnait pas une vraie nouvelle chance avant l'expiration du staleTime.
// Le cache SERVEUR (Redis, voir api/espn.js) reste par ailleurs bel et bien
// permanent — c'est uniquement le CÔTÉ CLIENT qui abandonnait trop tôt.
// Plafond remonté à 1h (120 tentatives) : le coût réel d'une tentative en
// trop est négligeable (lecture Redis côté serveur, quasi gratuite — un vrai
// appel ESPN ne se déclenche que si la donnée manque encore réellement), et
// couvre très largement le pire cas observé.
const EMPTY_RETRY_INTERVAL_MS = 30_000
const MAX_EMPTY_RETRIES       = 120   // ~1h avant d'abandonner (était 5min)

function espnDate(match, offsetDays = 0) {
  if (!match?.utcDate) return null
  const d = new Date(match.utcDate)
  if (offsetDays) d.setUTCDate(d.getUTCDate() + offsetDays)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Passe 1 : trouve l'event ESPN dans le scoreboard et retourne { eventId, homeTeamId, comp }. */
function findEspnEvent(json, match) {
  for (const evt of json.events ?? []) {
    const comp  = evt.competitions?.[0]
    if (!comp) continue
    const homeC = (comp.competitors ?? []).find(c => c.homeAway === 'home')
    const awayC = (comp.competitors ?? []).find(c => c.homeAway === 'away')
    if (!homeC || !awayC) continue
    const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
    const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
    const fdHome   = match.homeTeam?.name ?? match.homeTeam?.shortName ?? ''
    const fdAway   = match.awayTeam?.name ?? match.awayTeam?.shortName ?? ''
    if (fuzzyTeam(fdHome, espnHome) && fuzzyTeam(fdAway, espnAway)) {
      // `comp` (l'objet competition du SCOREBOARD, pas du summary) remonté
      // avec — voir pourquoi juste en dessous (extractDetails).
      return { eventId: evt.id, homeTeamId: homeC.team?.id, comp }
    }
  }
  return null
}

export function useEspnMatchDetail(match, compId, enabled = true) {
  const slug = COMP_ESPN[compId] ?? COMP_ESPN[match?.competition?.id] ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['espnMatchDetail', match?.id, slug],
    queryFn: async () => {
      if (!slug || !match) return null

      // ── Passe 1 : scoreboard → event ID ──
      //
      // ⚠️ ESPN groupe son scoreboard par date CALENDAIRE LOCALE du stade, pas
      // par date UTC — beaucoup de matchs de ce Mondial (Amérique du Nord) se
      // jouent en soirée locale, ce qui fait "rouler" leur utcDate au
      // lendemain UTC (vérifié : un match à 02h00 UTC apparaît dans le
      // scoreboard ESPN de la veille). On interroge donc TOUJOURS la date UTC
      // ET la veille, et on fusionne les events — tous les fuseaux du tournoi
      // sont en retard sur UTC, jamais en avance.
      // ⚠️ BUG CORRIGÉ (constat utilisateur : "pas de buteurs/stats si j'ai
      // pas suivi le match jusqu'au bout") : le raccourci "isMatchToday" ci-
      // dessous faisait un seul appel SANS date explicite pour un match du
      // jour, en s'en remettant au "aujourd'hui" par défaut d'ESPN — qui peut
      // différer du "aujourd'hui" UTC de l'app pour la même raison de fuseau
      // ci-dessus, et qui n'avait alors AUCUN filet de sécurité (pas de
      // 2e appel -1 jour) contrairement à la branche "non-today". Ce chemin à
      // froid n'est emprunté QUE quand cachedEspn est vide, c'est-à-dire
      // précisément quand l'utilisateur n'a pas suivi le match en direct —
      // reproduit exactement le bug rapporté. Toujours utiliser le double
      // appel daté, plus fiable, coût négligeable (1 requête HTTP de plus,
      // uniquement pour un match déjà terminé).
      const [sbRes1, sbRes2] = await Promise.all([
        fetch(`/espn?slug=${slug}&dates=${espnDate(match, 0)}`),
        fetch(`/espn?slug=${slug}&dates=${espnDate(match, -1)}`),
      ])
      const [board1, board2] = await Promise.all([
        sbRes1.ok ? sbRes1.json() : null,
        sbRes2.ok ? sbRes2.json() : null,
      ])
      const events = [...(board1?.events ?? []), ...(board2?.events ?? [])]

      const found = findEspnEvent({ events }, match)
      if (!found) return null   // match non trouvé dans le scoreboard

      // ── Passe 2 : summary → buts + stats complets ──
      // /espn?eventId=... renvoie désormais directement le JSON compact
      // { scorers, cards, stats, lineups } (voir api/espn.js/
      // espnSummaryParse.js) — plus besoin de le parser ici, le serveur l'a
      // déjà fait (et mis en cache tel quel).
      const res2 = await fetch(`/espn?slug=${slug}&eventId=${found.eventId}`)
      const summaryResult = res2.ok ? await res2.json() : null

      // ⚠️ BUG CORRIGÉ (constat utilisateur, vrai payload vérifié sur la
      // finale CM 2026 Espagne-Argentine) : l'ancienne logique choisissait
      // ENTIÈREMENT summaryResult OU ENTIÈREMENT boardResult, jamais un mix.
      // Or sur ce match précis, le summary a bien les STATS
      // (header.competitions[0].competitors[].statistics) mais PAS les
      // buts/cartons (header.competitions[0].details vide/absent côté
      // summary) — alors que le SCOREBOARD (Passe 1, `found.comp`, déjà en
      // main) a les buts/cartons complets ET correctement nommés. Comme
      // `summaryResult.stats !== null` suffisait à retenir summaryResult EN
      // BLOC, ses scorers/cards vides écrasaient les bons du scoreboard —
      // la timeline retombait alors sur l'ancien snapshot localStorage
      // (confirmFt, potentiellement figé avec des '?' si ESPN n'avait pas
      // encore publié les noms au moment exact de la fin du match, voir
      // MatchPage.jsx ligne ~167). Fusion CHAMP PAR CHAMP désormais : chaque
      // champ (scorers/cards/stats) prend le summary s'il est non vide,
      // sinon le scoreboard — sans coût réseau supplémentaire, `found.comp`
      // est déjà en mémoire depuis la Passe 1.
      const boardResult = extractMatchDetails(found.comp, found.homeTeamId)
      const result = {
        scorers: summaryResult?.scorers?.length ? summaryResult.scorers : boardResult.scorers,
        cards:   summaryResult?.cards?.length   ? summaryResult.cards   : boardResult.cards,
        stats:   summaryResult?.stats ?? boardResult.stats,
      }

      // ⚠️ BUG CORRIGÉ (constat utilisateur : timeline vide sur les 2 derniers
      // matchs consultés juste après leur fin, alors que les buts existaient
      // bien côté ESPN quelques minutes plus tard) : ESPN peut mettre
      // quelques minutes à publier les plays/details complets après le coup
      // de sifflet final — l'event est trouvé, le fetch réussit, mais
      // scorers/cards sont encore vides à cet instant précis. Persister ce
      // résultat vide dans le localStorage écrasait potentiellement un
      // meilleur snapshot confirmFt(), ET restait comme fallback permanent
      // même après qu'ESPN ait fini de publier. Même garde-fou que
      // hasUsefulData() côté serveur (api/espn.js) : on ne persiste que si le
      // résultat contient vraiment quelque chose.
      const isUseful = result.scorers.length > 0 || result.cards.length > 0 || result.stats !== null
      if (isUseful) {
        try { localStorage.setItem(`foot_espn_${match.id}`, JSON.stringify(result)) } catch { /* quota localStorage plein, tant pis */ }
      }

      return result
    },
    enabled:   enabled && !!slug && !!match?.id,
    // staleTime dynamique : un résultat VIDE (event trouvé mais ESPN n'a pas
    // encore publié les plays/details) OU NUL (event pas trouvé dans le
    // scoreboard à cet instant — même cause possible : ESPN pas encore à
    // jour) ne reste "frais" que 2 min → un simple retour sur la page relance
    // le fetch et se corrige tout seul dès qu'ESPN a publié. Un résultat
    // COMPLET reste frais 1h (match terminé, données stables, pas de refetch
    // inutile).
    // ⚠️ BUG CORRIGÉ dans ce correctif même (constat utilisateur : toujours
    // vide après fermeture/réouverture) : `d && d.scorers...` traitait `d ===
    // null` comme "falsy" → retombait sur la branche 1h par erreur au lieu de
    // 2 min. `d == null` (avec ==, pas ===) couvre explicitement null ET
    // undefined comme "pas de résultat exploitable, retry vite".
    staleTime: (query) => isEspnDetailEmpty(query.state.data) ? 2 * 60_000 : 60 * 60_000,
    refetchInterval: (query) => {
      if (!isEspnDetailEmpty(query.state.data)) return false
      return query.state.dataUpdateCount >= MAX_EMPTY_RETRIES ? false : EMPTY_RETRY_INTERVAL_MS
    },
    retry:     1,
    retryDelay: 2_000,
  })

  return { espnData: data ?? null, loading: isLoading }
}

