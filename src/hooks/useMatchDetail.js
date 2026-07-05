// Détail d'un match terminé : buteurs, cartons, score mi-temps, arbitres, stade.
// Endpoint football-data.org : GET /v4/matches/{id}
// Cache localStorage 24h — les données d'un match terminé ne changent jamais.
//
// Exports additionnels :
//   useLineups(match) — compositions via ESPN summary
//   useH2H(match)     — confrontations directes via FD.org
import { useQuery } from '@tanstack/react-query'
import { readCache, readCacheStale, getCacheSavedAt, writeCache } from './localCache'
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

// ── useLineups ─────────────────────────────────────────────────────────────────
// Source : ESPN summary pour les ligues club.
//          FIFA API (/api/fifa-lineups) pour WC 2026 (espnSlug='fifa', compId=2000).
// Disponible pour les compétitions dans COMP_ESPN uniquement.

function matchDateStr(match) {
  if (!match?.utcDate) return null
  const d = new Date(match.utcDate)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
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
    refetchInterval: q => !q.state.data?.home?.starters?.length ? 90_000 : false,
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

      // Étape 1 : trouver l'event ID via le scoreboard
      const sbRes = await fetch(`/espn?slug=${slug}&dates=${date}`)
      if (!sbRes.ok) return null
      const sb = await sbRes.json()

      let eventId = null
      for (const evt of sb.events ?? []) {
        const comp  = evt.competitions?.[0]
        const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
        const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
        if (!homeC || !awayC) continue
        const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
        const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
        if (fuzzyTeam(fdHome, espnHome) && fuzzyTeam(fdAway, espnAway)) {
          eventId = evt.id
          break
        }
      }
      if (!eventId) return null

      // Étape 2 : summary pour les rosters + formations
      const sumRes = await fetch(`/espn?slug=${slug}&eventId=${eventId}`)
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
    retry: 1,
    queryFn: async () => {
      // 1. Scoreboard → event ID
      const sbRes = await fetch(`/espn?slug=${slug}&dates=${date}`)
      if (!sbRes.ok) return null
      const sb = await sbRes.json()

      let eventId = null
      for (const evt of sb.events ?? []) {
        const comp  = evt.competitions?.[0]
        const homeC = comp?.competitors?.find(c => c.homeAway === 'home')
        const awayC = comp?.competitors?.find(c => c.homeAway === 'away')
        if (!homeC || !awayC) continue
        const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
        const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
        if (fuzzyTeam(fdHome, espnHome) && fuzzyTeam(fdAway, espnAway)) {
          eventId = evt.id
          break
        }
      }
      if (!eventId) return null

      // 2. Summary complet
      const sumRes = await fetch(`/espn?slug=${slug}&eventId=${eventId}`)
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
      const mapStats = (team) => ({
        poss:          getStat(team, 'possessionPct'),
        shots:         getStat(team, 'totalShots', 'shotsTotal', 'shots'),
        shotsOnTarget: getStat(team, 'shotsOnTarget', 'shotsOnGoal', 'onGoal'),
        corners:       getStat(team, 'cornerKicks', 'corners'),
        fouls:         getStat(team, 'fouls', 'foulsCommitted'),
        offside:       getStat(team, 'offsides', 'offside'),
        yellowCards:   getStat(team, 'yellowCards'),
      })

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
        const date = matchDateStr(prevMatch)
        const fdH  = prevMatch.homeTeam?.name ?? prevMatch.homeTeam?.shortName ?? ''
        const fdA  = prevMatch.awayTeam?.name ?? prevMatch.awayTeam?.shortName ?? ''

        try {
          // 1. Scoreboard ESPN → trouver l'event ID du match précédent
          const sbRes = await fetch(`/espn?slug=${slug}&dates=${date}`)
          if (!sbRes.ok) return null
          const sb = await sbRes.json()

          let eventId = null
          for (const evt of sb.events ?? []) {
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
    refetchInterval: (enabled && live) ? 45_000 : false,
    retry: 2,
    retryDelay: 3_000,
    queryFn: async () => {
      const url = `/api/fifa-lineups?fdMatchId=${match.id}`
        + `&home=${encodeURIComponent(fdHome)}`
        + `&away=${encodeURIComponent(fdAway)}`
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json()
      const s = data?.stats
      if (!s?.home && !s?.away) return null

      // Mapper vers le format attendu par ESPNStats
      const mapTeam = (t) => ({
        poss:          t?.possession       ?? null,
        shots:         t?.shots            ?? null,
        shotsOnTarget: t?.shotsOnTarget    ?? null,
        corners:       t?.corners          ?? null,
        fouls:         t?.fouls            ?? null,
        offside:       t?.offside          ?? null,
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
