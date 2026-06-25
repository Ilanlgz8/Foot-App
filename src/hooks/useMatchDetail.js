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

      // DEBUG WC — à retirer après diagnostic
      if (isFifaComp) {
        const r0 = rosters[0] ?? {}
        console.log('[ESPN WC DEBUG]', {
          rostersLen: rosters.length,
          roster0keys: Object.keys(r0),
          roster0athletesLen: r0.athletes?.length,
          roster0rosterLen: r0.roster?.length,
          roster0playersLen: r0.players?.length,
        })
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

      // 3. Stats depuis boxscore.teams
      const teams    = summary.boxscore?.teams ?? []
      const homeTeam = teams.find(t => t.homeAway === 'home')
      const awayTeam = teams.find(t => t.homeAway === 'away')

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

      const stats = { home: mapStats(homeTeam), away: mapStats(awayTeam) }
      const hasData = Object.values(stats.home ?? {}).some(v => v != null)
      if (!hasData) return null

      // 4. Lineups depuis rosters si disponibles (ESPN ne les retourne pas toujours pour WC)
      let lineups = null
      const rosters = summary.rosters ?? []
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
