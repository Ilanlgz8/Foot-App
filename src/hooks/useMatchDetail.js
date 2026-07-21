// Détail d'un match terminé : buteurs, cartons, score mi-temps, arbitres, stade.
// Endpoint football-data.org : GET /v4/matches/{id}
// Cache localStorage 24h — les données d'un match terminé ne changent jamais.
//
// Exports additionnels :
//   useLineups(match) — compositions via ESPN summary
//   useH2H(match)     — confrontations directes via FD.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readCache, getCacheSavedAt, writeCache } from './localCache'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { COMP_ESPN, fuzzyTeam } from './useLiveMinute'
// Depuis la compaction du cache ESPN (voir api/espn.js/espnSummaryParse.js) :
// /espn?eventId=... renvoie directement { scorers, cards, stats, lineups }
// déjà parsés — extractMatchDetails ne sert plus ici que pour le repli
// scoreboard brut (boardComp, jamais mis en cache compact).
import { extractMatchDetails } from '../utils/espnSummaryParse'

export function useMatchDetail(matchId) {
  const key = `matchdetail_${matchId}`

  const { data, isLoading } = useQuery({
    queryKey: ['matchDetail', matchId],
    queryFn: async () => {
      const res = await fdFetch(fdUrl(`/api/v4/matches/${matchId}`))
      if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      writeCache(key, json, 24 * 60 * 60 * 1000)
      return json
    },
    enabled:              !!matchId,
    // readCache (pas readCacheStale) : on ignore les entrées expirées.
    // Un match fetché en live avec goals:[] ne doit pas bloquer le re-fetch.
    initialData:          readCache(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            2 * 60 * 60 * 1000,   // 2h (pas 24h)
    retry:                1,
    retryDelay:           2_000,
  })

  return { detail: data ?? null, loading: isLoading }
}

// ── Retente automatique tant que les données sont absentes ─────────────────
// Retour utilisateur : "pour toutes les données qu'on met en cache, si on a
// pas la donnée à afficher, on retente plusieurs fois tant qu'on l'a pas,
// avec une limite (1 tentative toutes les 30s)" — la donnée peut
// légitimement apparaître un peu après coup (ESPN qui finalise son résumé
// post-match, FIFA qui republie après un blip d'indispo — voir la finale CM
// 2026, constat utilisateur), sans que l'utilisateur ait besoin de recharger
// la page. `dataUpdateCount` (React Query) compte les fetchs RÉUSSIS (y
// compris ceux qui reviennent vides) — sert de compteur de tentatives sans
// état supplémentaire à gérer. Ne tourne QUE tant que le composant qui
// utilise le hook est monté (comportement standard refetchInterval de React
// Query) — jamais de sweep en arrière-plan pour des matchs que personne ne
// regarde.
//
// ⚠️ BUG CORRIGÉ (constat utilisateur : "ça disparaît au bout de 5min alors
// que c'est censé être en cache permanent") : l'ancien plafond (10 × 30s =
// 5min) était bien trop court pour un match à très fort trafic (la finale
// CM 2026) — ESPN peut mettre bien plus de 5min à finir de publier compos et
// stats complètes, et une fois ce plafond atteint, React Query arrête
// DÉFINITIVEMENT de réessayer. Pire : cet état "abandonné, vide" est lui-même
// persisté dans le cache localStorage (voir main.jsx) — même un rechargement
// complet de la page ne redonnait pas une vraie nouvelle chance avant
// l'expiration du staleTime. Le cache SERVEUR (Redis, voir api/espn.js et
// api/fifa-lineups.js) reste par ailleurs bel et bien permanent — c'est
// uniquement le plafond CÔTÉ CLIENT qui abandonnait trop tôt. Remonté à 1h
// (120 tentatives) : coût réel négligeable (lecture Redis côté serveur,
// quasi gratuite tant que la donnée manque encore vraiment), largement
// suffisant pour couvrir le pire cas observé.
const EMPTY_RETRY_INTERVAL_MS = 30_000
const MAX_EMPTY_RETRIES       = 120   // ~1h avant d'abandonner (était 5min)

function retryWhileEmpty(query, isEmpty) {
  if (!isEmpty(query.state.data)) return false
  return query.state.dataUpdateCount >= MAX_EMPTY_RETRIES ? false : EMPTY_RETRY_INTERVAL_MS
}

// ── useLineups ─────────────────────────────────────────────────────────────────
// Source : ESPN summary pour les ligues club.
//          FIFA API (/api/fifa-lineups) pour WC 2026 (espnSlug='fifa', compId=2000).
// Disponible pour les compétitions dans COMP_ESPN uniquement.

function matchDateStr(match, offsetDays = 0) {
  if (!match?.utcDate) return null
  const d = new Date(match.utcDate)
  if (offsetDays) d.setUTCDate(d.getUTCDate() + offsetDays)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

// ⚠️ ESPN groupe son scoreboard par date CALENDAIRE LOCALE du stade, pas par
// date UTC (voir même commentaire dans useEspnMatchDetail.js) — un match tard
// le soir (fréquent, notamment CM en Amérique) peut apparaître dans le
// scoreboard ESPN de la VEILLE alors que son utcDate FD.org est déjà le jour
// suivant. Sans ce double appel, useEspnMatchStats/useLineups/
// useProbableLineups ne trouvaient parfois jamais l'event ESPN pour un match
// pas suivi en direct (le seul cas où on tombe sur ce chemin à froid) → stats/
// compos manquantes uniquement pour les utilisateurs n'ayant pas regardé le
// match jusqu'au bout (constat utilisateur). Interroge toujours date + date-1
// et fusionne, au lieu de deviner laquelle est la bonne.
async function fetchEspnEventsDual(slug, match) {
  const [res1, res2] = await Promise.all([
    fetch(`/espn?slug=${slug}&dates=${matchDateStr(match, 0)}`),
    fetch(`/espn?slug=${slug}&dates=${matchDateStr(match, -1)}`),
  ])
  const [board1, board2] = await Promise.all([
    res1.ok ? res1.json() : null,
    res2.ok ? res2.json() : null,
  ])
  return [...(board1?.events ?? []), ...(board2?.events ?? [])]
}

// ⚠️ AJOUT (retour utilisateur : stats/déroulement d'un match terminé parfois
// manquants ou incomplets, "des fois ça marche, des fois pas") : useLineups
// et useEspnMatchStats retrouvaient CHACUN, à CHAQUE appel, l'eventId ESPN en
// interrogeant le scoreboard du jour et en comparant les noms d'équipe
// (fetchEspnEventsDual + fuzzy match ci-dessous) — refait de zéro par chaque
// appareil de chaque utilisateur, jamais partagé, et fragile pour un vieux
// match qu'ESPN ne liste plus forcément aussi facilement sur son scoreboard.
// findEspnEventId() tente d'abord le mapping Redis partagé (voir api/espn.js,
// mode lookupMap) — dès qu'UN SEUL appareil a déjà résolu ce match une fois,
// tous les autres ensuite sautent cette recherche fragile. Si le mapping est
// inconnu (1ère fois pour ce match) ou la lecture échoue, on retombe
// EXACTEMENT sur l'ancienne recherche (fetchEspnEventsDual + fuzzy match,
// inchangée) — zéro régression possible, ce chemin rapide ne fait
// qu'accélérer/fiabiliser le cas déjà courant, jamais le seul moyen d'obtenir
// un résultat. boardComp (stats du scoreboard, filet de sécurité déjà en
// place dans useEspnMatchStats) n'est renseigné QUE quand la recherche
// complète a été utilisée — normal et sans conséquence : boardComp ne sert
// que de 3e repli, voir plus bas.
async function findEspnEventId(slug, match, fdHome, fdAway) {
  try {
    const mapRes = await fetch(`/espn?slug=${slug}&lookupMap=1&fdMatchId=${match.id}`)
    if (mapRes.ok) {
      const { eventId: mappedId } = await mapRes.json()
      if (mappedId) return { eventId: String(mappedId), boardComp: null }
    }
  } catch {}

  // Repli : recherche complète par scoreboard + nom d'équipe (comportement historique)
  // ⚠️ BUG CORRIGÉ (constat utilisateur, capture réseau à l'appui : "compo
  // jamais dispo" sur un match où le serveur a pourtant bien les données) :
  // contrairement à l'appel lookupMap juste au-dessus, ce fetchEspnEventsDual
  // n'était protégé par AUCUN try/catch. Un simple raté réseau ici (visible en
  // vrai : le 1er essai s'arrêtait net juste après le 404 FIFA, sans jamais
  // atteindre l'appel ESPN suivant, alors qu'un 2e essai quelques dizaines de
  // secondes plus tard passait sans problème) fait planter toute la promesse
  // de useLineups/useEspnMatchStats d'un coup — la requête React Query part
  // directement en erreur (isLoading redevient false très vite, sans données)
  // au lieu de retomber proprement sur "eventId introuvable pour l'instant".
  // Même style défensif que le bloc lookupMap ci-dessus : un raté ici ne doit
  // jamais faire s'effondrer toute la résolution, juste passer au repli
  // suivant (ou à la prochaine tentative de retryWhileEmpty).
  try {
    const events = await fetchEspnEventsDual(slug, match)
    for (const evt of events) {
      const comp  = evt.competitions?.[0]
      const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
      const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
      if (!homeC || !awayC) continue
      const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
      const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
      if (fuzzyTeam(fdHome, espnHome) && fuzzyTeam(fdAway, espnAway)) {
        return { eventId: evt.id, boardComp: comp }
      }
    }
  } catch {}
  return { eventId: null, boardComp: null }
}

// ── useEspnPregameOdds ───────────────────────────────────────────────────────
// Cote de marché réelle via le scoreboard ESPN, pour TOUTES les compétitions
// COMP_ESPN (pas seulement la CM — élargi après vérification plus poussée,
// voir plus bas). Pré-match UNIQUEMENT : c'est un instantané figé avant le
// coup d'envoi (champs open/close de ligne), pas un flux qui bouge pendant
// le match — le seul provider "*Live Odds*" repéré est explicitement exclu
// (voir SKIP_PROVIDERS).
//
// ⚠️ Plusieurs bookmakers cohabitent dans comp.odds[], PAS tous fiables au
// même degré (vérifié en direct sur un vrai match Bournemouth-Leicester) :
//   - "Bet 365" (provider id 2000) : format fractionnaire dans un champ
//     nommé "odds"/"drawOdds" imbriqué différemment, et une cote "1/33"
//     largement hors normes pour ce match précis — écarté, pas assez fiable.
//   - "ESPN BET" (provider id 58) : moneyLine américain direct et cohérent
//     pour les 3 issues (homeTeamOdds.moneyLine / awayTeamOdds.moneyLine /
//     drawOdds.moneyLine), même format que ce qu'on utilisait déjà pour la
//     CM — RETENU.
//   - "DraftKings" (provider id 100) : seul provider présent pour la CM
//     (jamais vu "ESPN BET" là-bas) — retenu en repli, format un peu
//     différent (moneyline.{home,away,draw}.close.odds).
//   - "ESPN BET - Live Odds" (provider id 59) : cote EN DIRECT (ex. vue à
//     "-20000" en fin de match, quasi 100% de proba implicite) — exclu, ce
//     hook ne veut QUE la ligne pré-match.
// Garde-fou supplémentaire (somme des probabilités implicites hors plage
// 95%-130%) : filet de sécurité si jamais un autre provider mal identifié
// passait entre les mailles.
//
// Retourne { decimal: {home,draw,away}, pct: {home,draw,away} } ou null
// (absent/format inattendu/hors plage plausible) — l'appelant (MatchPoster.jsx)
// retombe alors sur calcProno, AUCUN changement côté calcProno.js ni
// Pronos.jsx (jeu de pronostics entre amis, doit rester sur un modèle interne
// cohérent, pas une donnée externe qui peut manquer).
const ODDS_PROVIDER_PRIORITY = ['ESPN BET', 'DraftKings']
const ODDS_PROVIDER_SKIP     = p => /live/i.test(p ?? '')

function americanToDecimal(american) {
  const v = parseFloat(american)
  if (isNaN(v) || v === 0) return null
  return v > 0 ? 1 + v / 100 : 1 + 100 / Math.abs(v)
}

// Deux formats rencontrés selon le provider (voir commentaire au-dessus) —
// on essaie les deux, sans hypothèse sur lequel s'applique à quel provider
// (plus robuste si ESPN change un format un jour).
function extractMoneylines(oddsEntry) {
  // Format "DraftKings" : moneyline.{home,away,draw}.close.odds (string "+135")
  const ml = oddsEntry?.moneyline
  if (ml?.home?.close?.odds != null || ml?.home?.open?.odds != null) {
    return {
      home: ml.home?.close?.odds ?? ml.home?.open?.odds,
      away: ml.away?.close?.odds ?? ml.away?.open?.odds,
      draw: ml.draw?.close?.odds ?? ml.draw?.open?.odds ?? oddsEntry?.drawOdds?.moneyLine,
    }
  }
  // Format "ESPN BET" : {home,away}TeamOdds.moneyLine (nombre direct) + drawOdds.moneyLine
  if (oddsEntry?.homeTeamOdds?.moneyLine != null || oddsEntry?.awayTeamOdds?.moneyLine != null) {
    return {
      home: oddsEntry.homeTeamOdds?.moneyLine,
      away: oddsEntry.awayTeamOdds?.moneyLine,
      draw: oddsEntry.drawOdds?.moneyLine,
    }
  }
  return null
}

export function useEspnPregameOdds(match, enabled = true) {
  const compId = match?.competition?.id
  const slug   = COMP_ESPN[compId]
  const date   = matchDateStr(match)
  const fdHome = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''

  return useQuery({
    queryKey:  ['espnPregameOdds', match?.id],
    enabled:   enabled && !!slug && !!match?.id && !!date,
    staleTime: 15 * 60_000,   // pré-match, ligne quasi figée à l'approche du coup d'envoi
    retry: 1,
    queryFn: async () => {
      const events = await fetchEspnEventsDual(slug, match)
      for (const evt of events) {
        const comp  = evt.competitions?.[0]
        const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
        const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
        if (!homeC || !awayC) continue
        const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
        const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
        if (!fuzzyTeam(fdHome, espnHome) || !fuzzyTeam(fdAway, espnAway)) continue

        const oddsList = (comp?.odds ?? []).filter(o => !ODDS_PROVIDER_SKIP(o?.provider?.name))
        // Provider préféré d'abord (ESPN BET, puis DraftKings), sinon
        // n'importe quel provider restant (mieux qu'aucune cote, toujours
        // filtré par le garde-fou plus bas avant d'être affiché).
        const ordered = [
          ...ODDS_PROVIDER_PRIORITY.flatMap(name => oddsList.filter(o => o?.provider?.name === name)),
          ...oddsList.filter(o => !ODDS_PROVIDER_PRIORITY.includes(o?.provider?.name)),
        ]

        for (const entry of ordered) {
          const ml = extractMoneylines(entry)
          if (!ml) continue
          const homeOdds = americanToDecimal(ml.home)
          const awayOdds = americanToDecimal(ml.away)
          const drawOdds = americanToDecimal(ml.draw)
          if (!homeOdds || !awayOdds || !drawOdds) continue

          // Probabilité implicite (marge bookmaker déjà incluse dans une
          // vraie cote marché, contrairement à notre modèle) — sert à
          // déterminer le favori/l'intensité du liseré, pas la cote
          // AFFICHÉE (voir decimal).
          const pHome = 1 / homeOdds, pDraw = 1 / drawOdds, pAway = 1 / awayOdds
          const sum   = pHome + pDraw + pAway
          // Garde-fou anti-mauvais-marché (voir commentaire plus haut) —
          // une vraie cote 1X2 a une marge raisonnable (95%-130%) ; en
          // dehors, on passe au provider suivant plutôt que d'afficher
          // n'importe quoi.
          if (sum < 0.95 || sum > 1.3) continue

          return {
            decimal: { home: homeOdds, draw: drawOdds, away: awayOdds },
            pct:     { home: (pHome / sum) * 100, draw: (pDraw / sum) * 100, away: (pAway / sum) * 100 },
          }
        }
        return null
      }
      return null
    },
  })
}

// ⚠️ BUG CORRIGÉ (constat utilisateur : "ça marche une fois sur dix",
// capture réseau à l'appui — rafales de 429 sur ESPN) : useLineups ET
// useEspnMatchStats résolvaient CHACUN, de leur côté, le même eventId ESPN
// (findEspnEventId — lookupMap puis repli scoreboard) PUIS refetchaient
// CHACUN le même /espn?eventId=... — alors qu'ils ont besoin EXACTEMENT de
// la même réponse serveur (summary.lineups pour l'un, summary.stats pour
// l'autre, un seul et même objet JSON). Pour UNE SEULE ouverture de match,
// ça faisait donc jusqu'à 2x lookupMap + 2x summary = 4 requêtes ESPN pour
// une donnée strictement identique récupérée 2 fois — le plafond de 60/min
// par IP (voir api/espn.js) se prenait donc 2x plus vite qu'il n'aurait dû,
// avant même de compter le reste de l'app (scoreboard live, autres onglets,
// useProbableLineups...). queryClient.fetchQuery() avec la MÊME clé de
// cache dans les 2 hooks ci-dessous : React Query dédup nativement les
// appels concurrents à la même clé (une seule requête réseau réellement
// envoyée même si les 2 hooks la déclenchent au même instant) ET met en
// cache le résultat (staleTime aligné sur isFinished, même raisonnement que
// les hooks eux-mêmes) — 2x moins de requêtes ESPN pour un résultat
// strictement identique.
// ⚠️ BUG CORRIGÉ (constat utilisateur : "quand on n'a pas réussi à avoir les
// données à un moment, ça ne retry jamais, même après avoir fermé et rouvert
// l'app" — pour stats live/compo spécifiquement, pas le déroulement qui lui
// avait déjà ce correctif, voir staleTime dynamique dans
// useEspnMatchDetail.js) : `isFinished ? Infinity : 30_000` s'appliquait
// AVEUGLÉMENT, y compris quand le résultat est un ÉCHEC (eventId introuvable
// dans le scoreboard à cet instant, ou summary vide) — un match terminé dont
// la 1ère tentative échoue se retrouvait alors mis en cache comme "frais pour
// toujours", identique à un vrai succès. Conséquence concrète : le
// refetchInterval (retryWhileEmpty) de useLineups/useEspnMatchStats continue
// bien de se déclencher toutes les 30s comme prévu, mais chaque tentative
// retombe sur CE MÊME résultat vide en cache (staleTime Infinity = jamais
// re-fetché), sans jamais retaper ESPN — un retry qui tourne dans le vide.
// Et comme cette clé ('espnSummaryShared') n'est PAS exclue de la
// persistance localStorage (voir UNPERSISTED_QUERY_KEYS, main.jsx), cet état
// figé survit même à une fermeture complète de l'app. Fix : ne considérer
// "frais pour toujours" que si le résultat contient VRAIMENT quelque chose
// (eventId + summary trouvés) — sinon 30s, pour qu'un résultat vide ait une
// vraie chance d'être re-tenté, exactement le même principe déjà appliqué à
// isEspnDetailEmpty()/staleTime dynamique dans useEspnMatchDetail.js.
async function fetchSharedEspnSummary(queryClient, match, slug, fdHome, fdAway, isFinished) {
  return queryClient.fetchQuery({
    queryKey:  ['espnSummaryShared', match?.id, slug],
    staleTime: (query) => {
      const d = query.state.data
      const empty = !d?.eventId || !d?.summary
      return (isFinished && !empty) ? Infinity : 30_000
    },
    gcTime:    1000 * 60 * 60 * 24,
    queryFn: async () => {
      const { eventId, boardComp } = await findEspnEventId(slug, match, fdHome, fdAway)
      if (!eventId) return { eventId: null, boardComp: null, summary: null }
      const sumRes = await fetch(`/espn?slug=${slug}&eventId=${eventId}&fdMatchId=${match.id}`)
      const summary = sumRes.ok ? await sumRes.json() : null
      return { eventId, boardComp, summary }
    },
  })
}

// ⚠️ BUG CORRIGÉ (constat utilisateur, très précis : "le déroulement et les
// stats live restent en cache après avoir fermé l'app, mais la compo doit
// TOUJOURS refaire un appel réseau à chaque réouverture") : le déroulement
// (useEspnMatchDetail.js) et les stats (via getEspnData/foot_espn_${id} dans
// MatchModal.jsx, écrit par confirmFt() dans useLiveMinute.js) ont chacun
// leur PROPRE instantané localStorage indépendant du cache React Query — et
// c'est justement CE mécanisme, pas la persistance React Query, qui leur
// permet de survivre à une fermeture complète de l'app (voir
// UNPERSISTED_QUERY_KEYS dans main.jsx : lineups2/espnMatchStats2 ont été
// délibérément EXCLUS du blob React Query persisté, pour éviter le crash de
// quota localStorage découvert plus tôt aujourd'hui). Cette exclusion était
// justifiée, mais elle laissait les compos avec AUCUN filet de secours local
// — contrairement aux stats/déroulement, l'instantané `foot_espn_${id}`
// (voir espnScoresCache dans useLiveMinute.js) ne contient d'ailleurs même
// pas de champ `lineups`, il n'a jamais été conçu pour ça.
// Solution : un cache disque DÉDIÉ par match (readCache/writeCache, MÊME
// utilitaire déjà utilisé sans souci par useTeamForm.js/useMatchs.js — une
// entrée localStorage PAR CLÉ, pas un blob unique qui grossit sans limite,
// donc aucun risque de reproduire le crash de quota d'aujourd'hui). TTL très
// long (90j) pour un match terminé (la compo ne change jamais), court pour
// un match en cours (peut encore changer). Résultat : une compo déjà vue une
// fois s'affiche INSTANTANÉMENT au prochain lancement de l'app, sans aucun
// appel réseau — exactement le même comportement que le déroulement/stats.
const LINEUPS_DISK_TTL_FINISHED = 90 * 24 * 3600 * 1000
const LINEUPS_DISK_TTL_LIVE     = 5 * 60_000

export function useLineups(match, isFinished = false) {
  const compId     = match?.competition?.id
  const slug       = COMP_ESPN[compId]
  const date       = matchDateStr(match)
  const fdHome     = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway     = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''
  const isFifaComp = slug === 'fifa.world'   // WC 2026
  const queryClient = useQueryClient()
  const diskCacheKey = `lineups_${match?.id}`

  return useQuery({
    queryKey: ['lineups2', match?.id, slug, date],
    enabled:  !!match?.id && !!slug && !!date,
    // Voir le commentaire sur LINEUPS_DISK_TTL_FINISHED ci-dessus : lu au
    // montage, sert de donnée immédiate tant qu'un vrai fetch réseau n'a pas
    // encore répondu (ou jamais, si staleTime Infinity ci-dessous la
    // considère déjà fraîche pour un match terminé — aucun appel réseau du
    // tout dans ce cas).
    initialData:          readCache(diskCacheKey) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(diskCacheKey),
    // ⚠️ AJOUT (constat utilisateur : "le match est terminé, la compo va pas
    // changer, pas des appels à chaque fois") : une compo publiée pour un
    // match TERMINÉ ne change plus jamais (le cache serveur, voir
    // api/fifa-lineups.js et api/espn.js, est déjà permanent pour ce cas) —
    // 2min de staleTime forçait quand même un refetch réseau à chaque
    // remontage du composant (retour sur la page, réouverture de la modale),
    // même si la réponse allait être identique. `Infinity` : ne redemande
    // plus jamais tant que React Query garde cette entrée en mémoire/cache
    // (gcTime 24h, voir main.jsx) — et depuis initialData ci-dessus, même
    // pas au tout premier montage si le disque a déjà la donnée. Un match
    // encore EN COURS/À VENIR garde le staleTime court (compo pas encore
    // publiée, ou pourrait changer).
    staleTime: isFinished ? Infinity : 2 * 60_000,
    // Plafonné (voir retryWhileEmpty) — avant, ce refetchInterval tournait
    // à 90s SANS AUCUNE limite : un match qui n'a jamais eu de compo publiée
    // (compétition mal couverte, ou match FIFA jamais résolu) le retentait
    // indéfiniment tant que la page restait ouverte.
    refetchInterval: q => retryWhileEmpty(q, d => !d?.home?.starters?.length),
    retry: 2,
    queryFn: async () => {

      // ── WC 2026 : essayer FIFA Redis en premier ──────────────────────────────
      if (isFifaComp) {
        try {
          const url = `/api/fifa-lineups?fdMatchId=${match.id}`
            + `&home=${encodeURIComponent(fdHome)}`
            + `&away=${encodeURIComponent(fdAway)}`
            + `&utcDate=${encodeURIComponent(match.utcDate ?? '')}`
          const res = await fetch(url)
          if (res.ok) {
            const data = await res.json()
            if (data?.home?.starters?.length) {
              const result = { home: data.home, away: data.away }
              writeCache(diskCacheKey, result, isFinished ? LINEUPS_DISK_TTL_FINISHED : LINEUPS_DISK_TTL_LIVE)
              return result
            }
          }
        } catch {}
        // FIFA Redis vide/absent → on tombe sur ESPN ci-dessous
      }

      // ── ESPN (toutes compétitions, WC en fallback après FIFA) ─────────────────
      // Résolution eventId + fetch summary PARTAGÉS avec useEspnMatchStats
      // (voir fetchSharedEspnSummary ci-dessus) — une seule requête réseau
      // réelle même si les 2 hooks sont montés en même temps pour ce match.
      const { eventId, summary } = await fetchSharedEspnSummary(queryClient, match, slug, fdHome, fdAway, isFinished)
      if (!eventId || !summary) return null

      if (!summary?.lineups?.home?.starters?.length) return null
      writeCache(diskCacheKey, summary.lineups, isFinished ? LINEUPS_DISK_TTL_FINISHED : LINEUPS_DISK_TTL_LIVE)
      return summary.lineups
    },
  })
}

// ── useEspnMatchStats ──────────────────────────────────────────────────────────
// Stats d'un match terminé via ESPN : scoreboard (date) → event ID → summary.
// Ne nécessite pas Redis. Couvre toutes les compétitions dans COMP_ESPN.
// Retourne le même format que useFifaStats : { home, away } avec poss/shots/etc.

export function useEspnMatchStats(match, isFinished = false) {
  const compId = match?.competition?.id
  const slug   = COMP_ESPN[compId]
  const date   = matchDateStr(match)
  const fdHome = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''
  const queryClient = useQueryClient()
  // Même cache disque par clé que useLineups (voir LINEUPS_DISK_TTL_* et le
  // commentaire juste au-dessus) — stats2 est lui aussi exclu du blob React
  // Query persisté (UNPERSISTED_QUERY_KEYS, main.jsx), donc lui aussi perdu
  // à chaque fermeture d'app sans ce filet.
  const diskCacheKey = `stats_${match?.id}`

  return useQuery({
    queryKey:  ['espnMatchStats2', match?.id],
    enabled:   !!match?.id && !!slug && !!date,
    initialData:          readCache(diskCacheKey) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(diskCacheKey),
    // Match terminé : stats définitives, ne changent plus jamais (même
    // raisonnement que useLineups juste au-dessus) — Infinity au lieu de
    // 30min pour ne plus jamais redemander inutilement.
    staleTime: isFinished ? Infinity : 30 * 60_000,
    // Retente tant que vide (ex: ESPN pas encore fini de publier son résumé
    // juste après le coup de sifflet) — voir retryWhileEmpty plus haut.
    refetchInterval: q => retryWhileEmpty(q, d => d == null),
    retry: 1,
    queryFn: async () => {
      // 1. Event ID + summary — PARTAGÉS avec useLineups (voir
      // fetchSharedEspnSummary plus haut) : une seule requête réseau réelle
      // même si les 2 hooks sont montés en même temps pour ce match.
      // boardComp (stats scoreboard, filet de sécurité "3." plus bas) n'est
      // renseigné que si le repli complet (scoreboard+fuzzy) a été utilisé
      // — sans conséquence, voir commentaire sur findEspnEventId.
      const { eventId, boardComp, summary } = await fetchSharedEspnSummary(queryClient, match, slug, fdHome, fdAway, isFinished)
      if (!eventId || !summary) return null

      // 3. Stats — le serveur renvoie déjà summary.stats compacté et
      // pré-extrait (voir compactEspnSummary/extractTeamStats dans
      // espnSummaryParse.js, les 19 mêmes champs que ceux affichés par
      // fifaStatsToRows dans MatchModal.jsx). Plus besoin de parser
      // boxscore.teams/header.competitions ici — le serveur l'a déjà fait.
      let stats   = summary.stats
      let hasData = !!stats

      // ⚠️ Filet de sécurité conservé (constat utilisateur : "stats fausses/
      // manquantes" sur un match CM 2026 précis) : le summary ESPN peut être
      // vide alors que le SCOREBOARD (Passe 1, `boardComp`, déjà en main) a
      // les stats complètes. extractMatchDetails (partagé avec le serveur)
      // fait la même extraction sur le `comp` brut du scoreboard.
      if (!hasData && boardComp) {
        const boardResult = extractMatchDetails(boardComp)
        if (boardResult.stats) { stats = boardResult.stats; hasData = true }
      }
      // Dernier recours : le mapping rapide Redis a déjà résolu l'eventId
      // (boardComp jamais rempli) ET le summary compacté n'a rien — on
      // retente une recherche scoreboard complète (un seul fetch de plus,
      // seulement dans ce cas précis).
      if (!hasData && !boardComp) {
        try {
          const events = await fetchEspnEventsDual(slug, match)
          for (const evt of events) {
            const comp = evt.competitions?.[0]
            const hc = comp?.competitors?.find(c => c.homeAway === 'home')
            const ac = comp?.competitors?.find(c => c.homeAway === 'away')
            if (!hc || !ac) continue
            const espnHome = hc.team?.displayName ?? hc.team?.name ?? ''
            const espnAway = ac.team?.displayName ?? ac.team?.name ?? ''
            if (fuzzyTeam(fdHome, espnHome) && fuzzyTeam(fdAway, espnAway)) {
              const boardResult = extractMatchDetails(comp)
              if (boardResult.stats) { stats = boardResult.stats; hasData = true }
              break
            }
          }
        } catch { /* pas bloquant — on retombe sur le return null ci-dessous */ }
      }
      if (!hasData) return null

      // 4. Lineups — déjà résolus côté serveur (summary.lineups), null si
      // ESPN n'en a pas publié pour ce match.
      const lineups = summary.lineups ?? null

      const result = { stats, lineups }
      // Voir le commentaire sur LINEUPS_PENDING_TTL dans api/espn.js : même
      // prudence côté disque ici — un TTL long (90j) ne doit s'appliquer que
      // si la compo est VRAIMENT là. Sinon on garde un TTL court même pour un
      // match terminé, pour qu'un prochain lancement de l'app ait une vraie
      // chance de retomber sur une compo entre-temps publiée par ESPN, au
      // lieu de rester bloqué sur ce `lineups: null` pour 90 jours.
      const hasLineups = !!lineups?.home?.starters?.length
      writeCache(diskCacheKey, result, (isFinished && hasLineups) ? LINEUPS_DISK_TTL_FINISHED : LINEUPS_DISK_TTL_LIVE)
      return result
    },
  })
}

// ── useProbableLineups ─────────────────────────────────────────────────────────
// Compos probables : dernier XI connu de chaque équipe via ESPN summary.
// Zéro quota — ESPN est gratuit et illimité.
// Fonctionne pour toutes les compétitions dans COMP_ESPN.

export function useProbableLineups(match, compMatches) {
  const homeId = match?.homeTeam?.id
  const awayId = match?.awayTeam?.id
  const slug   = COMP_ESPN[match?.competition?.id]   // ex: 'fifa.world'

  return useQuery({
    queryKey:  ['probableLineups3', match?.id, (compMatches ?? []).length],
    enabled:   !!match?.id && !!(compMatches?.length) && !!slug,
    staleTime: 30 * 60_000,
    retry: 0,
    queryFn: async () => {
      // Trouver le dernier match terminé de chaque équipe dans les données FD.org
      const sorted = [...compMatches]
        .filter(m => m.status === 'FINISHED')
        .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))

      const lastHome = sorted.find(m =>
        m.homeTeam?.id === homeId || m.awayTeam?.id === homeId
      )
      const lastAway = sorted.find(m =>
        m.homeTeam?.id === awayId || m.awayTeam?.id === awayId
      )

      // Fetch rosters ESPN pour un match précédent
      const fetchEspnLineup = async (prevMatch, teamId) => {
        if (!prevMatch) return null
        const fdH  = prevMatch.homeTeam?.name ?? prevMatch.homeTeam?.shortName ?? ''
        const fdA  = prevMatch.awayTeam?.name ?? prevMatch.awayTeam?.shortName ?? ''

        try {
          // 1. Scoreboard ESPN → trouver l'event ID du match précédent
          // (double date, voir fetchEspnEventsDual)
          const events = await fetchEspnEventsDual(slug, prevMatch)

          let eventId = null
          for (const evt of events) {
            const comp  = evt.competitions?.[0]
            const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
            const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
            if (!homeC || !awayC) continue
            const espnH = homeC.team?.displayName ?? homeC.team?.name ?? ''
            const espnA = awayC.team?.displayName ?? awayC.team?.name ?? ''
            if (fuzzyTeam(fdH, espnH) && fuzzyTeam(fdA, espnA)) {
              eventId = evt.id
              break
            }
          }
          if (!eventId) return null

          // 2. Summary ESPN → rosters du match précédent, déjà résolus
          // home/away par ID côté serveur (summary.lineups.home/away, voir
          // compactEspnSummary/extractLineups dans espnSummaryParse.js) —
          // plus besoin de fuzzy-match/parseEspnRoster ici.
          const sumRes = await fetch(`/espn?slug=${slug}&eventId=${eventId}`)
          if (!sumRes.ok) return null
          const summary = await sumRes.json()
          if (!summary?.lineups) return null

          // 3. Extraire le roster de l'équipe concernée
          const wasHome = prevMatch.homeTeam?.id === teamId
          const roster  = wasHome ? summary.lineups.home : summary.lineups.away
          if (!roster?.starters?.length) return null

          const opponent = wasHome
            ? (prevMatch.awayTeam?.shortName ?? prevMatch.awayTeam?.name ?? '?')
            : (prevMatch.homeTeam?.shortName ?? prevMatch.homeTeam?.name ?? '?')

          return { ...roster, fromMatch: { date: prevMatch.utcDate, opponent } }
        } catch { return null }
      }

      const [homeLineup, awayLineup] = await Promise.all([
        fetchEspnLineup(lastHome, homeId),
        fetchEspnLineup(lastAway, awayId),
      ])
      if (!homeLineup && !awayLineup) return null
      return { home: homeLineup, away: awayLineup }
    },
  })
}

// ── useFifaStats ───────────────────────────────────────────────────────────────
// Statistiques live FIFA pour WC 2026.
// Appelle /api/fifa-lineups (même endpoint que useLineups) — React Query déduplique.
// Retourne { home, away } au format ESPNStats : { poss, shots, shotsOnTarget, corners, fouls, offside }

export function useFifaStats(match, enabled = true, live = true) {
  const fdHome = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''

  return useQuery({
    queryKey: ['fifaStats', match?.id],
    enabled:  enabled && !!match?.id,
    // live: 30s (les stats évoluent) — fini: Infinity, ne redemande plus
    // jamais (stats définitives, même raisonnement que useLineups/
    // useEspnMatchStats ci-dessus).
    staleTime: live ? 30_000 : Infinity,
    // Live : poll 45s inchangé (déjà rapide, indépendant de la donnée reçue).
    // Fini : pas de poll normalement (30min de staleTime suffit une fois les
    // stats obtenues), SAUF si toujours vide — l'API FIFA peut avoir eu un
    // blip juste après un gros match (constat utilisateur, finale CM 2026 :
    // stats FIFA absentes précisément sur les 2 matchs les plus regardés du
    // tournoi) — retente alors tant que vide, plafonné (retryWhileEmpty).
    refetchInterval: q => {
      if (!enabled) return false
      if (live) return 45_000
      return retryWhileEmpty(q, d => !d?.home && !d?.away)
    },
    retry: 2,
    retryDelay: 3_000,
    queryFn: async () => {
      // Retour d'arrière-plan récent (voir useLiveMinute.js onVisible) : on
      // contourne le cache Redis serveur (120s) pour ne pas réafficher les
      // mêmes stats périmées qu'avant la mise en arrière-plan.
      const forceFresh = typeof window !== 'undefined'
        && window.__liveStatsForceFreshUntil
        && Date.now() < window.__liveStatsForceFreshUntil
      // finished=1 (quand live=false) : indique au serveur que ce match est
      // terminé, pour qu'il garde les stats en cache longtemps au lieu de
      // 120s (voir STATS_FINISHED_TTL dans api/fifa-lineups.js) — c'est
      // précisément ce qui manquait pour un match vieux d'une semaine+
      // ("Statistiques indisponibles" : chaque consultation retentait un
      // fetch live vers l'API FIFA, qui ne sert plus forcément un vieux match).
      const url = `/api/fifa-lineups?fdMatchId=${match.id}`
        + `&home=${encodeURIComponent(fdHome)}`
        + `&away=${encodeURIComponent(fdAway)}`
        + (forceFresh ? '&forceFresh=1' : '')
        + (!live ? '&finished=1' : '')
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json()
      const s = data?.stats
      if (!s?.home && !s?.away) return null

      // Mapper vers le format attendu par ESPNStats
      // ⚠️ BUG CORRIGÉ (constat utilisateur : "Hors-jeux" jamais affiché pour
      // un match CM alors que la donnée existe) : fifaStatsToRows() (voir
      // MatchModal.jsx) lit `h.offsides`/`a.offsides` (pluriel) — ce mapping
      // écrivait `offside` (singulier), donc toujours undefined pour ce champ
      // précis, silencieusement filtré par fifaStatsToRows.
      const mapTeam = (t) => ({
        poss:          t?.possession       ?? null,
        shots:         t?.shots            ?? null,
        shotsOnTarget: t?.shotsOnTarget    ?? null,
        corners:       t?.corners          ?? null,
        fouls:         t?.fouls            ?? null,
        offsides:      t?.offside          ?? null,
      })
      return { home: mapTeam(s.home), away: mapTeam(s.away) }
    },
  })
}

// ── useFdLineups ───────────────────────────────────────────────────────────────
// Extrait les compositions depuis les données football-data.org déjà fetchées
// par useMatchDetail (/v4/matches/{id}). Zéro appel supplémentaire — React Query
// déduplique la requête si useMatchDetail est déjà monté avec le même matchId.
// Retourne null si le match n'a pas encore de lineup (à venir ou non publié).

// football-data.org renvoie parfois une catégorie générique (Goalkeeper/
// Defender/Midfielder/Offence...) et parfois un poste précis (Centre-Back,
// Left Winger, Defensive Midfield...) selon les données dispo pour le joueur.
// On mappe aussi les postes précis vers les codes détaillés (CB/LB/RB/CDM...)
// déjà reconnus par POS_LABEL/posCat/laneWeight dans LineupPitch.jsx — ainsi
// ces postes profitent de la même traduction FR fine (et du bon placement
// gauche/droite) que les autres sources, au lieu de rester vides et invisibles.
const FD_POS = {
  // ── Génériques ──
  Goalkeeper: 'GK',
  Defender:   'DEF',
  Defence:    'DEF',
  Midfielder: 'MID',
  Midfield:   'MID',
  Offence:    'FWD',  // football-data.org utilise "Offence" pour les attaquants
  Forward:    'FWD',
  Attacker:   'FWD',
  // ── Détaillés (schéma connu de l'API football-data.org v4) ──
  'Centre-Back':       'CB',
  'Left-Back':          'LB',
  'Right-Back':         'RB',
  'Sweeper':            'SW',
  'Central Midfield':   'CM',
  'Defensive Midfield': 'CDM',
  'Attacking Midfield': 'CAM',
  'Left Midfield':      'LM',
  'Right Midfield':     'RM',
  'Left-Wing Back':     'LWB',
  'Right-Wing Back':    'RWB',
  'Left Winger':        'LW',
  'Right Winger':       'RW',
  'Centre-Forward':     'CF',
  'Second Striker':     'SS',
  'Striker':            'ST',
}

// ⚠️ BUG CORRIGÉ (constat utilisateur : compo officielle mal placée alors que
// la compo probable — même écran, même code de placement — était correcte).
// FD_POS n'est qu'une liste d'égalités EXACTES : tout libellé de poste renvoyé
// par football-data.org qui n'y figure pas EXACTEMENT (ex: variante de
// casse/ponctuation, sélection nationale utilisant un intitulé différent d'un
// club, poste rare jamais rencontré côté clubs européens) retombait sur ''
// (FD_POS[p.position] ?? '') — et posCat('')/laneWeight('') dans
// LineupPitch.jsx classent tout poste vide en MILIEU CENTRAL par défaut, quel
// que soit le vrai poste du joueur (un défenseur ou attaquant avec un libellé
// non reconnu s'affichait donc au milieu du terrain). La compo probable, elle,
// vient toujours d'ESPN (parseEspnRoster, codes GK/DEF/MID/FWD génériques
// beaucoup plus stables) — jamais de ce problème.
// Fix : même principe de généralisation déjà appliqué à laneWeight/depthWeight
// dans LineupPitch.jsx (mots-clés plutôt que liste figée) — si le libellé exact
// n'est pas connu, on déduit la catégorie par mot-clé (back/defence → DEF,
// midfield → MID, wing/forward/striker/attack → FWD) et le couloir par
// "left"/"right" dans le texte, au lieu de perdre toute l'info.
function mapFdPosition(raw) {
  if (!raw) return ''
  const exact = FD_POS[raw]
  if (exact) return exact
  const low     = raw.toLowerCase()
  const isLeft  = /\bleft\b/.test(low)
  const isRight = /\bright\b/.test(low)
  if (/goalkeeper|keeper/.test(low)) return 'GK'
  if (/wing.?back/.test(low))        return isLeft ? 'LWB' : isRight ? 'RWB' : 'DEF'
  if (/back|defen[cs]e|defender|sweeper/.test(low)) return isLeft ? 'LB' : isRight ? 'RB' : 'DEF'
  if (/midfield/.test(low))          return isLeft ? 'LM'  : isRight ? 'RM'  : 'MID'
  if (/wing(er)?|forward|striker|attack/.test(low)) return isLeft ? 'LW' : isRight ? 'RW' : 'FWD'
  return ''
}

export function useFdLineups(match) {
  const { detail, loading } = useMatchDetail(match?.id)

  const mapPlayer = (p, i) => ({
    name:         p.name ?? '?',
    shortName:    p.name ?? '?',
    number:       p.shirtNumber ?? '',
    position:     mapFdPosition(p.position),
    positionName: p.position ?? '',
    order:        i,
  })

  const mapTeam = (team) => {
    if (!team?.lineup?.length) return null
    return {
      name:      team.name ?? '?',
      shortName: team.tla ?? team.name ?? '?',
      color:     '#1e40af',
      altColor:  '#ffffff',
      formation: team.formation ?? '',
      starters:  (team.lineup ?? []).map(mapPlayer),
      subs:      (team.bench  ?? []).map(mapPlayer),
    }
  }

  const home = mapTeam(detail?.homeTeam)
  const away = mapTeam(detail?.awayTeam)
  const data = home?.starters?.length ? { home, away } : null
  return { data, isLoading: loading }
}

// ── useH2H ─────────────────────────────────────────────────────────────────────
// Source : FD.org /matches/{id}/head2head

export function useH2H(match) {
  return useQuery({
    queryKey: ['h2h-fd', match?.id],
    enabled:  !!match?.id,
    staleTime: 60 * 60_000,
    retry: 1,
    queryFn: async () => {
      const res = await fetch(`/api/football?apiPath=%2Fv4%2Fmatches%2F${match.id}%2Fhead2head&limit=20`)
      if (!res.ok) return null
      const json = await res.json()
      return json.matches ?? []
    },
  })
}

// ── useMatchInfo ─────────────────────────────────────────────────────────────
// "Infos du match" (LiveMatchPage.jsx, petit bouton "i") : stade + ville +
// affluence (ESPN — absent du summary déjà utilisé ailleurs, uniquement dans
// le scoreboard, d'où un fetch dédié) et arbitre (football-data.org, déjà
// chargé via useMatchDetail — React Query déduplique si déjà monté ailleurs
// pour ce match, aucun fetch en plus dans ce cas).
// Chargé UNIQUEMENT à la demande (enabled=false tant que le panneau n'est
// pas ouvert) — jamais préchargé pour toute une liste de matchs.
export function useMatchInfo(match, enabled = true) {
  const compId = match?.competition?.id
  const slug   = COMP_ESPN[compId]
  const fdHome = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''
  const { detail } = useMatchDetail(match?.id)

  const { data: venue, isLoading } = useQuery({
    queryKey:  ['matchVenueInfo', match?.id],
    enabled:   enabled && !!match?.id && !!slug,
    // Match trouvé : le stade/la ville ne changent jamais → Infinity (jamais
    // redemandé). Rien trouvé : voir retryWhileEmpty plus bas — avant, un
    // staleTime fixe de 60min pouvait bloquer un échec initial (match pas
    // encore listé côté ESPN à l'instant précis de l'ouverture du panneau)
    // pendant une heure entière avant de retenter.
    staleTime: q => (q.state.data ? Infinity : 0),
    refetchInterval: q => retryWhileEmpty(q, d => d == null),
    retry: 1,
    queryFn: async () => {
      const events = await fetchEspnEventsDual(slug, match)
      for (const evt of events) {
        const comp  = evt.competitions?.[0]
        const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
        const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
        if (!homeC || !awayC) continue
        const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
        const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
        if (!fuzzyTeam(fdHome, espnHome) || !fuzzyTeam(fdAway, espnAway)) continue
        // ⚠️ BUG CORRIGÉ (constat utilisateur : "y'a que le nom de l'arbitre,
        // rien d'autre" — panneau infos du match) : le scoreboard ESPN a DEUX
        // objets venue différents — `evt.venue` (niveau event, seulement
        // `displayName`, JAMAIS de `fullName` ni d'adresse — vérifié sur un
        // vrai payload) et `comp.venue` (niveau compétition, `fullName` +
        // `address.city/country` complets). `evt.venue ?? comp?.venue`
        // prenait TOUJOURS le premier (quasi toujours présent, donc `??`
        // passait rarement au second) puis lisait `v.fullName` — qui
        // n'existe que sur `comp.venue` → toujours `null`, donc "Stade"
        // jamais affiché quel que soit le moment. Priorité inversée (le plus
        // complet d'abord) + repli sur `displayName` si jamais `fullName`
        // manque aussi côté comp.
        const v = comp?.venue ?? evt.venue
        return {
          name:       v?.fullName ?? v?.displayName ?? null,
          city:       v?.address?.city ?? null,
          country:    v?.address?.country ?? null,
          attendance: comp?.attendance || null,
        }
      }
      return null
    },
  })

  const referees = (detail?.referees ?? []).filter(r => r.type === 'REFEREE' && r.name)

  return { venue: venue ?? null, referees, isLoading }
}
