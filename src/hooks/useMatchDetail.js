// Détail d'un match terminé : buteurs, cartons, score mi-temps, arbitres, stade.
// Endpoint football-data.org : GET /v4/matches/{id}
// Cache localStorage 24h — les données d'un match terminé ne changent jamais.
//
// Exports additionnels :
//   useLineups(match) — compositions via ESPN summary
//   useH2H(match)     — confrontations directes via FD.org
import { useQuery } from '@tanstack/react-query'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
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
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            24 * 60 * 60 * 1000,
    retry:                false,
  })

  return { detail: data ?? null, loading: isLoading }
}

// ── useLineups ─────────────────────────────────────────────────────────────────
// Source : ESPN summary (scoreboard → summary?event=)
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
  const compId = match?.competition?.id
  const slug   = COMP_ESPN[compId]
  const date   = matchDateStr(match)
  const fdHome = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''

  return useQuery({
    queryKey: ['lineups', match?.id, slug, date],
    enabled:  !!match?.id && !!slug && !!date,
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: async () => {
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

// ── useH2H ─────────────────────────────────────────────────────────────────────
// Source : FD.org /matches/{id}/head2head

export function useH2H(match) {
  return useQuery({
    queryKey: ['h2h-fd', match?.id],
    enabled:  !!match?.id,
    staleTime: 60 * 60_000,
    retry: 1,
    queryFn: async () => {
      const res = await fetch(`/api/football?path=matches/${match.id}/head2head&limit=10`)
      if (!res.ok) return null
      const json = await res.json()
      return json.matches ?? []
    },
  })
}
