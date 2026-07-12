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

function espnDate(match, offsetDays = 0) {
  if (!match?.utcDate) return null
  const d = new Date(match.utcDate)
  if (offsetDays) d.setUTCDate(d.getUTCDate() + offsetDays)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Passe 1 : trouve l'event ESPN dans le scoreboard et retourne { eventId, homeTeamId }. */
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
      return { eventId: evt.id, homeTeamId: homeC.team?.id }
    }
  }
  return null
}

/** Passe 2 : extrait buts + stats depuis la réponse summary ESPN. */
function extractFromSummary(json, homeTeamId) {
  const comp  = json.header?.competitions?.[0] ?? json.competitions?.[0]
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
    const ath = d.participants?.[0]?.athlete
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
  for (const c of (json.commentary ?? [])) {
    const play = c.play
    if (play?.type?.id !== '94') continue
    const ath = play.participants?.[0]?.athlete
    cards.push({
      name:   ath?.shortName ?? ath?.displayName ?? '?',
      minute: play.clock?.displayValue ?? c.time?.displayValue ?? '',
      team:   fuzzyTeam(homeC?.team?.displayName ?? '', play.team?.displayName ?? '') ? 'home' : 'away',
      red:    false,
    })
  }

  // Filet de sécurité : si jamais une compétition renvoie encore l'ancien
  // format à base de `type` (jamais observé en pratique, mais coût nul à
  // garder en fallback), on complète avec cette détection historique.
  if (scorers.length === 0 && cards.length === 0) {
    for (const play of json.plays ?? []) {
      if (play.type?.id !== '57' && play.scoringPlay !== true) continue
      const ath = play.participants?.[0]?.athlete ?? play.athletes?.[0]
      scorers.push({
        name:        ath?.shortName ?? ath?.displayName ?? '?',
        minute:      play.clock?.displayValue ?? '',
        team:        play.team?.id === homeC?.team?.id ? 'home' : 'away',
        ownGoal:     play.ownGoal     ?? false,
        penaltyKick: play.penaltyKick ?? false,
      })
    }
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
  const getStat = (c, name) => {
    if (!c) return null
    const found = (c.statistics ?? []).find(s => s.name === name)
    return found != null ? (parseFloat(found.displayValue) || 0) : null
  }
  const homePoss = getStat(homeC, 'possessionPct')
  const awayPoss = getStat(awayC, 'possessionPct')

  return {
    scorers,
    cards,
    stats: (homePoss !== null || awayPoss !== null) ? {
      home: { poss: homePoss, shots: getStat(homeC, 'totalShots'), shotsOnTarget: getStat(homeC, 'shotsOnTarget'), corners: getStat(homeC, 'corners'), fouls: getStat(homeC, 'fouls'), offside: getStat(homeC, 'offsides') },
      away: { poss: awayPoss, shots: getStat(awayC, 'totalShots'), shotsOnTarget: getStat(awayC, 'shotsOnTarget'), corners: getStat(awayC, 'corners'), fouls: getStat(awayC, 'fouls'), offside: getStat(awayC, 'offsides') },
    } : null,
  }
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
      if (!res2.ok) return null
      const summary = await res2.json()

      const result = extractFromSummary(summary, found.homeTeamId)

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
    staleTime: (query) => {
      const d = query.state.data
      const empty = d == null || (d.scorers.length === 0 && d.cards.length === 0 && d.stats === null)
      return empty ? 2 * 60_000 : 60 * 60_000
    },
    retry:     1,
    retryDelay: 2_000,
  })

  return { espnData: data ?? null, loading: isLoading }
}

