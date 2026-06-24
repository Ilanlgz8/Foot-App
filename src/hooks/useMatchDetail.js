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
    name:         a.athlete?.displayName ?? '?',
    shortName:    a.athlete?.shortName ?? a.athlete?.displayName ?? '?',
    number:       a.athlete?.jersey ?? '',
    position:     (a.athlete?.position?.abbreviation ?? '').toUpperCase(),
    positionName: a.athlete?.position?.name ?? '',
    order:        a.order ?? 99,
  })

  const all = roster.athletes ?? []
  return {
    name:      roster.team?.displayName ?? '?',
    shortName: roster.team?.abbreviation ?? roster.team?.displayName ?? '?',
    color,
    altColor,
    formation: roster.formation ?? '',
    starters:  all.filter(a => a.starter).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(mapAthlete),
    subs:      all.filter(a => !a.starter).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(mapAthlete),
  }
}

export function useLineups(match) {
  const compId     = match?.competition?.id
  const slug       = COMP_ESPN[compId]
  const date       = matchDateStr(match)
  const fdHome     = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway     = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''
  const isFifaComp = slug === 'fifa.world'   // WC 2026 → source FIFA directement

  return useQuery({
    queryKey: ['lineups', match?.id, slug, date],
    enabled:  !!match?.id && !!slug && !!date,
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: async () => {

      // ── WC 2026 : compositions via API FIFA ──────────────────────────────────
      // ESPN ne retourne pas les rosters pour les matchs WC via son summary endpoint.
      // On utilise /api/fifa-lineups qui lit les IDs FIFA depuis Redis et fetch
      // https://api.fifa.com/api/v3/matchlineup/{comp}/{season}/{stage}/{match}.
      if (isFifaComp) {
        const url = `/api/fifa-lineups?fdMatchId=${match.id}`
          + `&home=${encodeURIComponent(fdHome)}`
          + `&away=${encodeURIComponent(fdAway)}`
        const res = await fetch(url)
        if (!res.ok) return null
        const data = await res.json()
        // Valider que les starters existent avant de retourner
        if (!data?.home?.starters?.length) return null
        return { home: data.home, away: data.away }
      }

      // ── Autres compétitions : source ESPN (existant) ─────────────────────────

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

      const rosters = summary.rosters ?? []
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
    queryKey:  ['espnMatchStats', match?.id],
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
// Compos probables pour un match à venir : dernier XI connu de chaque équipe
// depuis leur match précédent dans compMatches (via /api/fifa-lineups → Redis).

export function useProbableLineups(match, compMatches) {
  const homeId = match?.homeTeam?.id
  const awayId = match?.awayTeam?.id

  return useQuery({
    queryKey:  ['probableLineups', match?.id, (compMatches ?? []).length],
    enabled:   !!match?.id && !!(compMatches?.length),
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      // Derniers matchs terminés pour chaque équipe
      const sorted = [...compMatches].sort(
        (a, b) => new Date(b.utcDate) - new Date(a.utcDate)
      )
      const lastHomeMatch = sorted.find(m =>
        m.homeTeam?.id === homeId || m.awayTeam?.id === homeId
      )
      const lastAwayMatch = sorted.find(m =>
        m.homeTeam?.id === awayId || m.awayTeam?.id === awayId
      )

      const fetchTeamLineup = async (lastMatch, teamId) => {
        if (!lastMatch) return null
        const h = lastMatch.homeTeam?.name ?? lastMatch.homeTeam?.shortName ?? ''
        const a = lastMatch.awayTeam?.name ?? lastMatch.awayTeam?.shortName ?? ''
        try {
          const res = await fetch(
            `/api/fifa-lineups?fdMatchId=${lastMatch.id}&home=${encodeURIComponent(h)}&away=${encodeURIComponent(a)}`
          )
          if (!res.ok) return null
          const data = await res.json()
          const wasHome   = lastMatch.homeTeam?.id === teamId
          const lineup    = wasHome ? data.home : data.away
          if (!lineup?.starters?.length) return null
          const opponent  = wasHome
            ? (lastMatch.awayTeam?.shortName ?? lastMatch.awayTeam?.name ?? '?')
            : (lastMatch.homeTeam?.shortName ?? lastMatch.homeTeam?.name ?? '?')
          return { ...lineup, fromMatch: { date: lastMatch.utcDate, opponent } }
        } catch { return null }
      }

      const [homeLineup, awayLineup] = await Promise.all([
        fetchTeamLineup(lastHomeMatch, homeId),
        fetchTeamLineup(lastAwayMatch, awayId),
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
      const res = await fetch(`/api/football?apiPath=%2Fv4%2Fmatches%2F${match.id}%2Fhead2head&limit=10`)
      if (!res.ok) return null
      const json = await res.json()
      return json.matches ?? []
    },
  })
}
