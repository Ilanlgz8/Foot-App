// Détail d'un match terminé : buteurs, cartons, score mi-temps, arbitres, stade.
// Endpoint football-data.org : GET /v4/matches/{id}
// Cache localStorage 24h — les données d'un match terminé ne changent jamais.
//
// Exports additionnels :
//   useLineups(match) — compositions via ESPN summary
//   useH2H(match)     — confrontations directes via FD.org
import { useQuery } from '@tanstack/react-query'
import { readCache, getCacheSavedAt, writeCache } from './localCache'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { COMP_ESPN, fuzzyTeam } from './useLiveMinute'

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
// état supplémentaire à gérer. Plafonné à MAX_EMPTY_RETRIES : au-delà, la
// donnée n'existe probablement simplement pas côté source (ex: FIFA n'a
// jamais eu ce match précis) — retenter indéfiniment ne ferait que gaspiller
// du quota API pour rien. Ne tourne QUE tant que le composant qui utilise le
// hook est monté (comportement standard refetchInterval de React Query) —
// jamais de sweep en arrière-plan pour des matchs que personne ne regarde.
const EMPTY_RETRY_INTERVAL_MS = 30_000
const MAX_EMPTY_RETRIES       = 10   // ~5min de tentatives avant d'abandonner

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

function parseEspnRoster(roster) {
  if (!roster) return null
  const rawColor = roster.team?.color ?? ''
  const color    = /^[0-9a-fA-F]{6}$/.test(rawColor) ? `#${rawColor}` : '#1e40af'
  const rawAlt   = roster.team?.alternateColor ?? ''
  const altColor = /^[0-9a-fA-F]{6}$/.test(rawAlt) ? `#${rawAlt}` : '#ffffff'

  const mapAthlete = a => ({
    name:         a.athlete?.displayName ?? a.displayName ?? '?',
    shortName:    a.athlete?.shortName ?? a.shortName ?? a.athlete?.displayName ?? '?',
    number:       a.athlete?.jersey ?? a.jersey ?? '',
    position:     (a.athlete?.position?.abbreviation ?? a.position?.abbreviation ?? '').toUpperCase(),
    positionName: a.athlete?.position?.name ?? a.position?.name ?? '',
    order:        a.order ?? 99,
  })

  const all = roster.athletes ?? roster.roster ?? []

  // ESPN utilise `a.starter` (boolean) pour clubs, mais pour certains tournois
  // le champ peut être absent. Si aucun starter explicite, on prend les 11 premiers
  // triés par order (ils sont déjà ordonnés titulaires en premier dans l'API).
  const explicitStarters = all.filter(a => a.starter === true)
  const hasExplicit = explicitStarters.length > 0

  const sorted = [...all].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  const starters = hasExplicit
    ? explicitStarters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(mapAthlete)
    : sorted.slice(0, 11).map(mapAthlete)
  const subs = hasExplicit
    ? all.filter(a => !a.starter).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(mapAthlete)
    : sorted.slice(11).map(mapAthlete)

  return {
    name:      roster.team?.displayName ?? '?',
    shortName: roster.team?.abbreviation ?? roster.team?.displayName ?? '?',
    color,
    altColor,
    formation: roster.formation ?? '',
    starters,
    subs,
  }
}

export function useLineups(match) {
  const compId     = match?.competition?.id
  const slug       = COMP_ESPN[compId]
  const date       = matchDateStr(match)
  const fdHome     = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway     = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''
  const isFifaComp = slug === 'fifa.world'   // WC 2026

  return useQuery({
    queryKey: ['lineups2', match?.id, slug, date],
    enabled:  !!match?.id && !!slug && !!date,
    staleTime: 2 * 60_000,        // retry rapide si données absentes (live)
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
            if (data?.home?.starters?.length) return { home: data.home, away: data.away }
          }
        } catch {}
        // FIFA Redis vide/absent → on tombe sur ESPN ci-dessous
      }

      // ── ESPN (toutes compétitions, WC en fallback après FIFA) ─────────────────

      // Étape 1 : trouver l'event ID (mapping partagé d'abord, voir findEspnEventId)
      const { eventId } = await findEspnEventId(slug, match, fdHome, fdAway)
      if (!eventId) return null

      // Étape 2 : summary pour les rosters + formations — fdMatchId transmis
      // pour mémoriser le mapping côté serveur (voir api/espn.js)
      const sumRes = await fetch(`/espn?slug=${slug}&eventId=${eventId}&fdMatchId=${match.id}`)
      if (!sumRes.ok) return null
      const summary = await sumRes.json()

      let rosters = summary.rosters ?? []
      // WC ESPN : rosters parfois absents de summary.rosters, présents dans header.competitions
      if (rosters.length === 0) {
        const competitors = summary.header?.competitions?.[0]?.competitors ?? []
        if (competitors.length >= 1) {
          rosters = competitors.map(c => ({
            team:       c.team,
            athletes:   c.roster ?? c.athletes ?? [],
            formation:  c.formation ?? '',
          }))
        }
      }

      if (rosters.length < 1) return null

      // Identifier home/away
      let homeIdx = 0
      if (rosters.length >= 2) {
        const name0 = rosters[0]?.team?.displayName ?? ''
        homeIdx = fuzzyTeam(fdHome, name0) ? 0 : 1
      }
      const awayIdx = 1 - homeIdx

      const home = parseEspnRoster(rosters[homeIdx])
      const away = parseEspnRoster(rosters[awayIdx] ?? rosters[0])
      if (!home?.starters?.length) return null

      return { home, away }
    },
  })
}

// ── useEspnMatchStats ──────────────────────────────────────────────────────────
// Stats d'un match terminé via ESPN : scoreboard (date) → event ID → summary.
// Ne nécessite pas Redis. Couvre toutes les compétitions dans COMP_ESPN.
// Retourne le même format que useFifaStats : { home, away } avec poss/shots/etc.

export function useEspnMatchStats(match) {
  const compId = match?.competition?.id
  const slug   = COMP_ESPN[compId]
  const date   = matchDateStr(match)
  const fdHome = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''

  return useQuery({
    queryKey:  ['espnMatchStats2', match?.id],
    enabled:   !!match?.id && !!slug && !!date,
    staleTime: 30 * 60_000,
    // Retente tant que vide (ex: ESPN pas encore fini de publier son résumé
    // juste après le coup de sifflet) — voir retryWhileEmpty plus haut.
    refetchInterval: q => retryWhileEmpty(q, d => d == null),
    retry: 1,
    queryFn: async () => {
      // 1. Event ID — mapping partagé d'abord, repli scoreboard+fuzzy match
      // sinon (voir findEspnEventId ci-dessus). boardComp (stats scoreboard,
      // filet de sécurité "3." plus bas) n'est renseigné que si le repli
      // complet a été utilisé — sans conséquence, voir commentaire sur
      // findEspnEventId.
      const { eventId, boardComp } = await findEspnEventId(slug, match, fdHome, fdAway)
      if (!eventId) return null

      // 2. Summary complet — fdMatchId transmis pour mémoriser le mapping
      // côté serveur (voir api/espn.js), au bénéfice de tous les autres
      // utilisateurs/appareils ensuite.
      const sumRes = await fetch(`/espn?slug=${slug}&eventId=${eventId}&fdMatchId=${match.id}`)
      if (!sumRes.ok) return null
      const summary = await sumRes.json()

      // 3. Stats — normalement depuis boxscore.teams, mais pour la CM ESPN
      // laisse souvent boxscore.teams vide et place les stats dans
      // header.competitions[0].competitors[].statistics à la place (même
      // faille WC que pour les rosters ci-dessous — déjà gérée pour les buts/
      // cartons/stats des matchs terminés dans useEspnMatchDetail.js, mais PAS
      // ici : c'est CE hook qui alimente le fallback stats de MpMatchStats
      // (page Résultat), donc ce trou privait concrètement l'utilisateur de la
      // possession/tirs/etc. dès que ni FIFA ni boxscore ne répondaient —
      // exactement le bug rapporté ("pas les stats si j'ai pas suivi en live").
      const getStat = (team, ...names) => {
        for (const n of names) {
          const s = (team?.statistics ?? []).find(st => st.name === n)
          if (s) { const v = parseFloat(s.displayValue); return isNaN(v) ? null : v }
        }
        return null
      }
      // BUG CORRIGÉ (constat utilisateur : "en résultat/live j'ai pas grand
      // chose en stats qui s'affiche") : ce hook alimente MpMatchStats (page
      // Résultat, matchs terminés) via fifaStatsToRows — cette dernière sait
      // déjà afficher 19 lignes (Passes, Tacles, Interceptions, Centres,
      // Longs ballons, Dégagements, Tirs contrés, Arrêts, Cartons rouges…,
      // voir MatchModal.jsx), MAIS mapStats() ici n'en extrayait que 7
      // (Possession/Tirs/Tirs cadrés/Corners/Fautes/Hors-jeux/Jaunes) — les
      // 12 autres étaient donc TOUJOURS vides pour un match terminé, alors
      // qu'ESPN les fournit (même endpoint /summary, mêmes noms de champs
      // que useEspnSummaryStats dans MatchModal.jsx, déjà utilisé en LIVE).
      // Même extraction ici désormais (passPct/tacklePct/etc recalculés à la
      // main depuis les 2 compteurs bruts — les champs "*Pct" d'ESPN sont un
      // ratio 0-1 arrondi, pas un vrai pourcentage, voir MatchModal.jsx) :
      // une seule logique d'extraction, plus de divergence entre live et
      // terminé.
      const pct = (made, total) => (made != null && total != null && total > 0)
        ? Math.round((made / total) * 100)
        : null
      const mapStats = (team) => {
        const totalPasses    = getStat(team, 'totalPasses')
        const accuratePasses = getStat(team, 'accuratePasses')
        const totalTackles   = getStat(team, 'totalTackles')
        const okTackles      = getStat(team, 'effectiveTackles')
        const totalCrosses   = getStat(team, 'totalCrosses')
        const okCrosses      = getStat(team, 'accurateCrosses')
        const totalLongBalls = getStat(team, 'totalLongBalls')
        const okLongBalls    = getStat(team, 'accurateLongBalls')
        return {
          poss:          getStat(team, 'possessionPct'),
          shots:         getStat(team, 'totalShots', 'shotsTotal', 'shots'),
          shotsOnTarget: getStat(team, 'shotsOnTarget', 'shotsOnGoal', 'onGoal'),
          corners:       getStat(team, 'wonCorners', 'cornerKicks', 'corners'),
          passes:        totalPasses,
          passPct:       pct(accuratePasses, totalPasses),
          tackles:       totalTackles,
          tacklePct:     pct(okTackles, totalTackles),
          interceptions: getStat(team, 'interceptions'),
          crosses:       totalCrosses,
          crossPct:      pct(okCrosses, totalCrosses),
          longBalls:     totalLongBalls,
          longBallPct:   pct(okLongBalls, totalLongBalls),
          clearances:    getStat(team, 'totalClearance', 'effectiveClearance'),
          blockedShots:  getStat(team, 'blockedShots'),
          saves:         getStat(team, 'saves'),
          fouls:         getStat(team, 'fouls', 'foulsCommitted'),
          offsides:      getStat(team, 'offsides', 'offside'),
          yellowCards:   getStat(team, 'yellowCards'),
          redCards:      getStat(team, 'redCards'),
        }
      }

      const boxTeams = summary.boxscore?.teams ?? []
      let homeTeam = boxTeams.find(t => t.homeAway === 'home')
      let awayTeam = boxTeams.find(t => t.homeAway === 'away')

      let stats    = { home: mapStats(homeTeam), away: mapStats(awayTeam) }
      let hasData  = Object.values(stats.home ?? {}).some(v => v != null)

      if (!hasData) {
        const competitors = summary.header?.competitions?.[0]?.competitors ?? []
        const hc = competitors.find(c => c.homeAway === 'home')
        const ac = competitors.find(c => c.homeAway === 'away')
        if (hc || ac) {
          stats   = { home: mapStats(hc), away: mapStats(ac) }
          hasData = Object.values(stats.home ?? {}).some(v => v != null)
        }
      }
      // ⚠️ BUG CORRIGÉ (constat utilisateur : "stats fausses/manquantes" sur un
      // match CM 2026 précis — vérifié en comparant scoreboard et summary sur
      // ce match : boxscore.teams ET header.competitions étaient TOUS LES DEUX
      // vides côté summary, alors que le SCOREBOARD (Passe 1, `boardComp`,
      // déjà en main) avait les stats complètes — possession/tirs/corners —
      // pour les deux équipes). Même filet de sécurité que useEspnMatchDetail.js
      // : on retombe sur boardComp avant d'abandonner, sans fetch en plus.
      if (!hasData && boardComp) {
        const competitors = boardComp.competitors ?? []
        const hc = competitors.find(c => c.homeAway === 'home')
        const ac = competitors.find(c => c.homeAway === 'away')
        if (hc || ac) {
          stats   = { home: mapStats(hc), away: mapStats(ac) }
          hasData = Object.values(stats.home ?? {}).some(v => v != null)
        }
      }
      // ⚠️ RÉGRESSION CORRIGÉE (constat utilisateur : stats dispos pour certains
      // matchs terminés mais pas d'autres, incohérent) : vérifié avec un vrai
      // payload ESPN réel — pour la CM, summary.boxscore.teams[].statistics ne
      // contient QUE 4 stats cumulées tournoi (goalDifference/totalGoals/
      // goalAssists/goalsConceded, jamais possession/tirs/etc), et summary.header
      // n'existe carrément pas. Les VRAIES stats du match ne sont donc quasiment
      // jamais dispo que via le scoreboard (boardComp) — MAIS boardComp n'est
      // renseigné que si findEspnEventId a dû faire la recherche complète (voir
      // son commentaire). Dès qu'UN SEUL appareil a résolu le mapping Redis une
      // fois (espnMap, TTL 60j), TOUS les appels suivants prenaient le chemin
      // rapide et boardComp restait null POUR TOUJOURS pour ce match — hasData
      // restait donc bloqué à false en permanence, même si le match a de vraies
      // stats disponibles côté ESPN. On ne le savait pas au moment du fix
      // précédent (493c82a) : le coût de cet appel scoreboard supplémentaire
      // était jugé "sans conséquence" à tort. Ici, dernier recours uniquement
      // quand tout le reste a échoué ET que boardComp n'a jamais été tenté —
      // un seul fetch de plus, seulement dans ce cas précis.
      if (!hasData && !boardComp) {
        try {
          const events = await fetchEspnEventsDual(slug, match)
          for (const evt of events) {
            const comp  = evt.competitions?.[0]
            const hc = comp?.competitors?.find(c => c.homeAway === 'home')
            const ac = comp?.competitors?.find(c => c.homeAway === 'away')
            if (!hc || !ac) continue
            const espnHome = hc.team?.displayName ?? hc.team?.name ?? ''
            const espnAway = ac.team?.displayName ?? ac.team?.name ?? ''
            if (fuzzyTeam(fdHome, espnHome) && fuzzyTeam(fdAway, espnAway)) {
              stats   = { home: mapStats(hc), away: mapStats(ac) }
              hasData = Object.values(stats.home ?? {}).some(v => v != null)
              break
            }
          }
        } catch { /* pas bloquant — on retombe sur le return null ci-dessous */ }
      }
      if (!hasData) return null

      // 4. Lineups depuis rosters si disponibles (ESPN ne les retourne pas toujours pour WC)
      let lineups = null
      let rosters = summary.rosters ?? []
      // WC : rosters absents de summary.rosters, présents dans header.competitions
      // (même fallback que useLineups/useProbableLineups plus haut — manquait
      // ici, ce qui privait ComposTab d'une de ses 3 sources pour la CM).
      if (rosters.length === 0) {
        const competitors = summary.header?.competitions?.[0]?.competitors ?? []
        if (competitors.length >= 1) {
          rosters = competitors.map(c => ({
            team:      c.team,
            athletes:  c.roster ?? c.athletes ?? [],
            formation: c.formation ?? '',
          }))
        }
      }
      if (rosters.length >= 1) {
        const name0 = rosters[0]?.team?.displayName ?? ''
        const homeIdx = fuzzyTeam(fdHome, name0) ? 0 : 1
        const home = parseEspnRoster(rosters[homeIdx])
        const away = parseEspnRoster(rosters[1 - homeIdx] ?? rosters[0])
        if (home?.starters?.length) lineups = { home, away }
      }

      return { stats, lineups }
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

          // 2. Summary ESPN → rosters du match précédent
          const sumRes = await fetch(`/espn?slug=${slug}&eventId=${eventId}`)
          if (!sumRes.ok) return null
          const summary = await sumRes.json()

          let rosters = summary.rosters ?? []
          // WC fallback : rosters dans header.competitions (pas dans summary.rosters)
          if (rosters.length === 0) {
            const competitors = summary.header?.competitions?.[0]?.competitors ?? []
            if (competitors.length >= 1) {
              rosters = competitors.map(c => ({
                team:      c.team,
                athletes:  c.roster ?? c.athletes ?? [],
                formation: c.formation ?? '',
              }))
            }
          }
          if (!rosters.length) return null

          // 3. Extraire le roster de l'équipe concernée
          const wasHome  = prevMatch.homeTeam?.id === teamId
          const teamName = wasHome ? fdH : fdA
          const name0    = rosters[0]?.team?.displayName ?? ''
          const idx      = fuzzyTeam(teamName, name0) ? 0 : 1
          const roster   = parseEspnRoster(rosters[idx] ?? rosters[0])
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
    staleTime: live ? 30_000 : 30 * 60_000,   // live: 30s, fini: 30min
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
    staleTime: 60 * 60_000,   // stade/affluence ne changent jamais après le coup d'envoi
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
        const v = evt.venue ?? comp?.venue
        return {
          name:       v?.fullName ?? null,
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
