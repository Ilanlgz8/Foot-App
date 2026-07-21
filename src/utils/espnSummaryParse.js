// Extraction ESPN partagée entre le SERVEUR (api/espn.js, mode "eventId" —
// compacte le summary ESPN brut avant de le mettre en cache Redis et de le
// renvoyer au client, voir compactEspnSummary) et le CLIENT (repli sur le
// scoreboard ESPN brut, qui lui reste toujours au format ESPN natif — voir
// api/espn.js mode "scoreboard", jamais mis en cache — utilisé par
// useEspnMatchDetail.js et useMatchDetail.js quand le mapping rapide échoue).
//
// ⚠️ Fonctions PURES, sans dépendance React/DOM/localStorage/Ably — c'est ce
// qui permet de les importer aussi bien depuis src/hooks/*.js (navigateur)
// que depuis api/*.js (Node.js serverless) — même principe déjà en place
// pour src/utils/liveDetection.js (partagé entre cron-goals.js et
// cf-worker/). Ne PAS importer DEPUIS useLiveMinute.js ici : ce fichier tire
// React, react-query, Ably et un Web Worker (`?worker`) — cassé hors
// contexte Vite/navigateur. Le sens inverse est en revanche sûr : useLiveMinute.js
// importe normalize()/fuzzyTeam() DEPUIS ici (voir plus bas) — aucune
// dépendance React/DOM dans ce fichier-ci, rien n'empêche de le lire depuis
// un module qui en a.

// ⚠️ EXPORTÉES (constat audit période creuse : cette paire existait en 3
// copies — ici, useLiveMinute.js à l'identique, ET api/fifa-live.js avec une
// implémentation DIFFÉRENTE qui supprimait les espaces AVANT de découper en
// mots. Conséquence concrète : un nom en 2 mots comme "Ivory Coast" devenait
// un seul bloc "ivorycoast" côté fifa-live.js au lieu de deux mots "ivory"/
// "coast" comparés séparément côté useLiveMinute.js/useMatchDetail.js — même
// opération conceptuelle, résultat de correspondance différent selon le
// fichier. api/fifa-live.js importe désormais celle-ci au lieu de sa propre
// copie divergente ; useLiveMinute.js aussi (voir son propre commentaire),
// pour n'avoir plus qu'une seule version, testée (voir espnSummaryParse.test.js).
export function normalize(name = '') {
  return name.toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[éèêë]/g, 'e')
    .replace(/[ûùüú]/g, 'u').replace(/[îïí]/g, 'i')
    .replace(/[ôöó]/g, 'o').replace(/ç/g, 'c')
    .trim()
}

export function fuzzyTeam(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (!na || !nb) return false
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true
  const wordsA = na.split(/\s+/).filter(w => w.length >= 4)
  const wordsB = nb.split(/\s+/).filter(w => w.length >= 4)
  return wordsA.some(wa =>
    wordsB.some(wb => wa.startsWith(wb.slice(0, 4)) || wb.startsWith(wa.slice(0, 4)))
  )
}

function initialName(full) {
  if (!full) return null
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return full
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

// ── Stats équipe ─────────────────────────────────────────────────────────────
// ⚠️ Unifié depuis 2 implémentations qui avaient dérivé séparément (constat
// pendant cette refonte) : useEspnMatchDetail.js n'extrayait que 6 champs
// (poss/tirs/tirs cadrés/corners/fautes/hors-jeux), useMatchDetail.js
// (useEspnMatchStats) en extrayait 19 (+ passes/tacles/interceptions/
// centres/longs ballons/dégagements/tirs contrés/arrêts/cartons) — la
// version la plus complète est reprise ici pour les deux usages, une seule
// fois. Plusieurs noms de champs candidats par stat : le scoreboard et le
// summary ESPN n'utilisent pas toujours le même nom pour la même donnée
// (constaté en comparant les 2 réponses sur un vrai match CM 2026 — ex.
// "wonCorners" côté scoreboard, "corners" côté summary).
function getStat(team, ...names) {
  if (!team) return null
  const found = (team.statistics ?? []).find(s => names.includes(s.name))
  if (found == null) return null
  const v = parseFloat(found.displayValue)
  return isNaN(v) ? null : v
}

function pct(made, total) {
  return (made != null && total != null && total > 0) ? Math.round((made / total) * 100) : null
}

function extractTeamStats(team) {
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
    // offsides (pluriel) — fifaStatsToRows (MatchModal.jsx) lit
    // `h.offsides`/`a.offsides` ; un champ `offside` (singulier) serait
    // silencieusement ignoré (bug déjà rencontré ailleurs, voir useFifaStats).
    offsides:      getStat(team, 'offsides', 'offside'),
    yellowCards:   getStat(team, 'yellowCards'),
    redCards:      getStat(team, 'redCards'),
  }
}

/** Extrait buts + cartons + stats à partir d'un objet "competition" ESPN (même
 *  forme dans le scoreboard ET le summary : { competitors, details }, +
 *  `commentary` optionnel — n'existe que côté summary). */
export function extractMatchDetails(comp, homeTeamId, commentary) {
  const homeC = (comp?.competitors ?? []).find(c => c.homeAway === 'home') ??
                (comp?.competitors ?? []).find(c => c.team?.id === homeTeamId)
  const awayC = (comp?.competitors ?? []).find(c => c.homeAway === 'away') ??
                (comp?.competitors ?? []).find(c => c.team?.id !== homeTeamId)

  // ── Buts + cartons ──────────────────────────────────────────────────────
  // Les entrées de comp.details portent des flags booléens directs
  // (scoringPlay/redCard/ownGoal/penaltyKick), pas un champ `type` fiable à
  // 100% selon les compétitions (vérifié : présent pour la CM 2026, mais un
  // ancien constat sur une autre compétition ne l'avait jamais trouvé — d'où
  // le filet de sécurité basé sur `type` plus bas, gardé par prudence).
  const scorers = []
  const cards = []
  for (const d of (comp?.details ?? [])) {
    const teamSide = d.team?.id === homeC?.team?.id ? 'home' : 'away'
    const ath = d.participants?.[0]?.athlete ?? d.athletesInvolved?.[0]
    const name = ath?.shortName ?? ath?.displayName ?? '?'
    const minute = d.clock?.displayValue ?? ''
    if (d.scoringPlay === true) {
      scorers.push({ name, minute, team: teamSide, ownGoal: d.ownGoal ?? false, penaltyKick: d.penaltyKick ?? false })
    } else {
      cards.push({ name, minute, team: teamSide, red: d.redCard === true })
    }
  }

  // ── Cartons jaunes (repli commentary) ───────────────────────────────────
  // Filet de sécurité seulement : sur les payloads vérifiés cette session
  // (CM 2026), les jaunes sont déjà dans comp.details ci-dessus (type.id
  // "94" avec scoringPlay:false, redCard:false) — cette boucle ne devrait
  // donc normalement rien ajouter. Gardée par prudence pour une compétition
  // où comp.details n'aurait vraiment que buts+rouges (ancien constat, pas
  // reproduit depuis). `commentary` n'existe que côté summary — undefined
  // côté scoreboard, la boucle ne fait alors simplement rien.
  for (const c of (commentary ?? [])) {
    const play = c.play
    if (play?.type?.id !== '94') continue
    const ath = play.participants?.[0]?.athlete
    const alreadyHave = cards.some(k => k.minute === (play.clock?.displayValue ?? c.time?.displayValue ?? '') && k.name === (ath?.shortName ?? initialName(ath?.displayName) ?? '?'))
    if (alreadyHave) continue
    cards.push({
      name:   ath?.shortName ?? initialName(ath?.displayName) ?? '?',
      minute: play.clock?.displayValue ?? c.time?.displayValue ?? '',
      team:   fuzzyTeam(homeC?.team?.displayName ?? '', play.team?.displayName ?? '') ? 'home' : 'away',
      red:    false,
    })
  }

  // Filet de sécurité historique : ancien format à base de `type.id` sur
  // comp.details lui-même (jamais observé depuis, coût nul à garder).
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

  const homeStats = extractTeamStats(homeC)
  const awayStats = extractTeamStats(awayC)
  const hasStats  = Object.values(homeStats).some(v => v != null) || Object.values(awayStats).some(v => v != null)

  return {
    scorers,
    cards,
    stats: hasStats ? { home: homeStats, away: awayStats } : null,
  }
}

// ── Compos ─────────────────────────────────────────────────────────────────
export function parseEspnRoster(roster) {
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

// Résout les rosters (compos) d'un summary ESPN, home/away déterminés par ID
// (fiable, pas de fuzzy-match par nom nécessaire ici — homeTeamId vient déjà
// de comp.competitors[].homeAway).
function extractLineups(json, comp, homeTeamId) {
  let rosters = json?.rosters ?? []
  // WC : rosters absents de summary.rosters, présents dans comp.competitors[].roster
  if (rosters.length === 0) {
    const competitors = comp?.competitors ?? []
    if (competitors.length >= 1) {
      rosters = competitors.map(c => ({
        team:      c.team,
        athletes:  c.roster ?? c.athletes ?? [],
        formation: c.formation ?? '',
      }))
    }
  }
  if (rosters.length < 1) return null

  let homeIdx = rosters.findIndex(r => String(r.team?.id ?? '') === String(homeTeamId ?? ''))
  if (homeIdx < 0) homeIdx = 0
  const awayIdx = rosters.length >= 2 ? (homeIdx === 0 ? 1 : 0) : homeIdx

  const home = parseEspnRoster(rosters[homeIdx])
  const away = parseEspnRoster(rosters[awayIdx] ?? rosters[0])
  if (!home?.starters?.length) return null
  return { home, away }
}

// ── Compaction summary (serveur) ────────────────────────────────────────────
// Réduit une réponse ESPN /summary brute (~90 Ko — buts/cartons/stats/compos
// utiles, mais aussi cotes, chaînes TV, classements de meilleurs joueurs,
// liens vers les pages joueur/club, photos... jamais lus par l'app) au format
// minimal réellement consommé : { scorers, cards, stats, lineups }. Utilisé
// par api/espn.js pour CE QUI EST MIS EN CACHE ET RENVOYÉ au client (mode
// "eventId") — permet un cache Redis permanent pour un match terminé sans
// jamais s'approcher de la limite de stockage (256 Mo sur le tier gratuit
// Upstash), ~90 Ko/match brut vs ~1-2 Ko compacté.
export function compactEspnSummary(json) {
  const comp = json?.header?.competitions?.[0] ?? json?.competitions?.[0]
  if (!comp) return { scorers: [], cards: [], stats: null, lineups: null }
  const homeC = (comp.competitors ?? []).find(c => c.homeAway === 'home')
  const homeTeamId = homeC?.team?.id
  const { scorers, cards, stats: headerStats } = extractMatchDetails(comp, homeTeamId, json?.commentary)

  // ⚠️ BUG CORRIGÉ (constat utilisateur juste après le déploiement de la
  // compaction : "pas toutes les stats en live") : la version compacte ne
  // lisait les stats QUE depuis comp.competitors[].statistics (header),
  // alors que l'ancienne implémentation (useEspnSummaryStats dans
  // MatchModal.jsx, seule source utilisée pour les stats LIVE club) lisait
  // json.boxscore.teams[].statistics EXCLUSIVEMENT, sans repli sur header —
  // et l'ancien useEspnMatchStats (matchs terminés, useMatchDetail.js)
  // essayait boxscore EN PREMIER, header seulement en repli. Pour les
  // championnats de club, header.competitions[].competitors[].statistics
  // est souvent absent/vide pendant le match — boxscore.teams est la
  // source réellement peuplée. Pour la CM, c'est l'inverse (voir
  // extractMatchDetails). On tente donc boxscore d'abord, header en repli —
  // couvre les deux cas sans rien perdre par rapport aux 2 implémentations
  // d'avant la fusion.
  const boxComp   = { competitors: json?.boxscore?.teams ?? [] }
  const boxStats  = extractMatchDetails(boxComp, homeTeamId).stats
  const stats     = boxStats ?? headerStats

  const lineups = extractLineups(json, comp, homeTeamId)
  return { scorers, cards, stats, lineups }
}
