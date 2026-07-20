// Récupère les détails ESPN d'un match terminé (buteurs + stats) à la demande.
//
// Stratégie en 2 passes :
//   1. Scoreboard (dates=YYYYMMDD) → trouve l'event + son ID ESPN
//   2. Summary (?eventId=XXX)      → détails complets : buts, stats, possession
//
// Le summary ESPN est la seule source fiable de buts pour les matchs passés.
// FD.org ne fournit pas de buts pour toutes les compétitions sur le free tier.

import { useQuery } from '@tanstack/react-query'
import { COMP_ESPN, fuzzyTeam } from './useLiveMinute'

// ⚠️ AJOUT (constat utilisateur : "pour les cartons jaune seulement ça met
// le prénom en entier au lieu de la première lettre du prénom avec un point
// comme les buts et cartons rouges") : les buts + cartons rouges viennent de
// comp.details, où l'objet athlete a fiablement un `shortName` déjà abrégé
// ("B. Embolo") fourni par ESPN. Les cartons jaunes viennent d'un endroit
// différent (json.commentary[].play, voir plus bas) où l'objet athlete n'a
// pas toujours ce même champ rempli — le code retombait alors sur
// `displayName` (nom complet, "Breel Embolo") sans jamais l'abréger,
// d'où l'incohérence visuelle. Ce helper abrège nous-mêmes le prénom
// ("Breel Embolo" → "B. Embolo") quand shortName manque, pour un rendu
// identique aux buts/rouges quelle que soit la donnée réellement fournie par
// ESPN à cet endroit précis.
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
const EMPTY_RETRY_INTERVAL_MS = 30_000
const MAX_EMPTY_RETRIES       = 10   // ~5min avant d'abandonner

function initialName(full) {
  if (!full) return null
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return full
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

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

/** Extrait buts + cartons + stats à partir d'un objet "competition" ESPN (même
 *  forme dans le scoreboard ET le summary : { competitors, details }). Séparé
 *  de extractFromSummary() ci-dessous pour pouvoir l'appliquer aussi bien au
 *  `comp` du scoreboard (Passe 1, déjà en main) qu'à celui du summary
 *  (Passe 2) — voir queryFn plus bas pour pourquoi c'est nécessaire. */
function extractDetails(comp, homeTeamId, commentary) {
  const homeC = (comp?.competitors ?? []).find(c => c.homeAway === 'home') ??
                (comp?.competitors ?? []).find(c => c.team?.id === homeTeamId)
  const awayC = (comp?.competitors ?? []).find(c => c.homeAway === 'away') ??
                (comp?.competitors ?? []).find(c => c.team?.id !== homeTeamId)

  // ── Buts + cartons ──────────────────────────────────────────────────────
  // ⚠️ BUG CORRIGÉ (constat utilisateur : timeline vide pour des matchs
  // jamais suivis en direct — confirmé via une page de diagnostic dédiée,
  // dump JSON réel à l'appui sur un match CM 2026) : la structure réelle des
  // entrées de comp.details N'A JAMAIS de champ `type` — ni `type.id`, ni
  // `type.text`. Chaque entrée porte directement des flags booléens :
  //   scoringPlay: true/false   → c'est un but ou non
  //   redCard:     true/false   → carton rouge (si false ET pas un but, on
  //                                en déduit un carton jaune — comp.details
  //                                ne contient QUE des buts et des cartons,
  //                                vérifié sur le dump : 5 entrées pour un
  //                                match à 4 buts + 1 carton, aucun 6e type
  //                                d'événement mêlé)
  //   ownGoal, penaltyKick      → qualificatifs du but
  // L'ancien code cherchait `d.type?.id === '57'` (but) / `'93'|'94'`
  // (carton) — des champs qui n'ont jamais existé dans cette réponse, d'où
  // 0 résultat à chaque fois pour tout match retombant sur ce chemin (summary
  // post-match, PAS le snapshot live confirmFt() — ce qui explique pourquoi
  // seuls les matchs jamais suivis en direct étaient touchés).
  const scorers = []
  const cards = []
  for (const d of (comp?.details ?? [])) {
    const teamSide = d.team?.id === homeC?.team?.id ? 'home' : 'away'
    // BUG CORRIGÉ (constat utilisateur : noms de joueurs affichés "?" dans le
    // déroulement du match — vérifié sur un vrai payload ESPN, finale CM 2026
    // Espagne-Argentine) : le champ réel est `athletesInvolved[0]`, PAS
    // `participants[0].athlete` — ce dernier n'existe jamais dans cette
    // réponse, donc `ath` était toujours `undefined` et `name` retombait
    // systématiquement sur '?'. Le "filet de sécurité" plus bas (qui, lui,
    // utilise déjà `athletesInvolved`) ne se déclenchait jamais pour corriger
    // ça : il n'agit que si `scorers`/`cards` sont VIDES, or cette boucle
    // remplissait déjà les tableaux (avec des noms '?'), donc sa condition de
    // déclenchement n'était jamais remplie.
    const ath = d.participants?.[0]?.athlete ?? d.athletesInvolved?.[0]
    const name = ath?.shortName ?? ath?.displayName ?? '?'
    const minute = d.clock?.displayValue ?? ''
    if (d.scoringPlay === true) {
      scorers.push({ name, minute, team: teamSide, ownGoal: d.ownGoal ?? false, penaltyKick: d.penaltyKick ?? false })
    } else {
      cards.push({ name, minute, team: teamSide, red: d.redCard === true })
    }
  }

  // ── Cartons JAUNES ───────────────────────────────────────────────────────
  // ⚠️ BUG CORRIGÉ (constat utilisateur : buts + cartons rouges OK, jaunes
  // absents — vérifié via DebugEspn.jsx sur un vrai match CM 2026) :
  // comp.details ne contient QUE les buts et les cartons ROUGES — ESPN ne
  // met jamais les jaunes à cet endroit. Ils sont ailleurs : dans
  // json.commentary[i].play, avec un vrai champ `type.id === '94'`
  // ("Yellow Card") cette fois (contrairement à comp.details qui n'a jamais
  // eu de champ `type`, voir plus haut). Preuve concrète obtenue en dump
  // direct : Breel Embolo (Suisse), carton jaune, 44e minute.
  // On ne prend QUE les jaunes ici — les rouges restent sourcés depuis
  // comp.details ci-dessus (déjà fiable) pour ne pas les compter en double.
  // `commentary` n'existe que sur la réponse summary (pas sur le scoreboard) —
  // undefined dans ce 2e cas, la boucle ne fait simplement rien.
  for (const c of (commentary ?? [])) {
    const play = c.play
    if (play?.type?.id !== '94') continue
    const ath = play.participants?.[0]?.athlete
    cards.push({
      name:   ath?.shortName ?? initialName(ath?.displayName) ?? '?',
      minute: play.clock?.displayValue ?? c.time?.displayValue ?? '',
      team:   fuzzyTeam(homeC?.team?.displayName ?? '', play.team?.displayName ?? '') ? 'home' : 'away',
      red:    false,
    })
  }

  // Filet de sécurité : si jamais une compétition renvoie encore l'ancien
  // format à base de `type` (jamais observé en pratique, mais coût nul à
  // garder en fallback), on complète avec cette détection historique.
  if (scorers.length === 0 && cards.length === 0) {
    for (const d of (comp?.details ?? [])) {
      const id = String(d.type?.id ?? '')
      if (d.type?.text === 'Goal' || id === '57') {
        const ath = d.athletesInvolved?.[0]
        scorers.push({
          name: ath?.shortName ?? ath?.displayName ?? '?', minute: d.clock?.displayValue ?? '',
          team: d.team?.id === homeC?.team?.id ? 'home' : 'away',
          ownGoal: d.ownGoal ?? false, penaltyKick: d.penaltyKick ?? false,
        })
      } else if (id === '93' || id === '94') {
        const ath = d.athletesInvolved?.[0]
        cards.push({
          name: ath?.shortName ?? ath?.displayName ?? '?', minute: d.clock?.displayValue ?? '',
          team: d.team?.id === homeC?.team?.id ? 'home' : 'away', red: d.redCard === true || id === '93',
        })
      }
    }
  }

  // ── Stats ──
  // ⚠️ Le scoreboard (Passe 1) et le summary (Passe 2) n'utilisent pas
  // exactement les mêmes noms de champ pour la même stat (constaté en
  // vérifiant les deux réponses côte à côte sur un vrai match CM 2026) :
  // le scoreboard nomme les corners "wonCorners", le summary "corners" —
  // on accepte les deux noms pour que extractDetails() fonctionne pareil
  // quel que soit le `comp` (scoreboard ou summary) qu'on lui passe.
  const getStat = (c, ...names) => {
    if (!c) return null
    const found = (c.statistics ?? []).find(s => names.includes(s.name))
    return found != null ? (parseFloat(found.displayValue) || 0) : null
  }
  const homePoss = getStat(homeC, 'possessionPct')
  const awayPoss = getStat(awayC, 'possessionPct')

  return {
    scorers,
    cards,
    // offsides (pluriel) — fifaStatsToRows (MatchModal.jsx) lit `h.offsides`/
    // `a.offsides` ; un champ `offside` (singulier) ici serait toujours
    // silencieusement ignoré (même bug corrigé côté useFifaStats).
    stats: (homePoss !== null || awayPoss !== null) ? {
      home: { poss: homePoss, shots: getStat(homeC, 'totalShots'), shotsOnTarget: getStat(homeC, 'shotsOnTarget'), corners: getStat(homeC, 'corners', 'wonCorners'), fouls: getStat(homeC, 'fouls', 'foulsCommitted'), offsides: getStat(homeC, 'offsides') },
      away: { poss: awayPoss, shots: getStat(awayC, 'totalShots'), shotsOnTarget: getStat(awayC, 'shotsOnTarget'), corners: getStat(awayC, 'corners', 'wonCorners'), fouls: getStat(awayC, 'fouls', 'foulsCommitted'), offsides: getStat(awayC, 'offsides') },
    } : null,
  }
}

/** Passe 2 : extrait buts + stats depuis la réponse summary ESPN. */
function extractFromSummary(json, homeTeamId) {
  const comp = json.header?.competitions?.[0] ?? json.competitions?.[0]
  return extractDetails(comp, homeTeamId, json.commentary)
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
      const res2 = await fetch(`/espn?slug=${slug}&eventId=${found.eventId}`)
      const summaryResult = res2.ok ? extractFromSummary(await res2.json(), found.homeTeamId) : null

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
      const boardResult = extractDetails(found.comp, found.homeTeamId)
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

