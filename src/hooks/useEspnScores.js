// Scores en temps réel via l'API non-officielle ESPN.
// Priorité sur football-data.org (délai ~1min) — ESPN a un délai < 10s.
// Fallback automatique : si ESPN échoue, retourne {} et le composant utilise football-data.org.
//
// Mapping des compétitions football-data.org → slugs ESPN :
//   FL1 → fra.1       (Ligue 1)
//   PL  → eng.1       (Premier League)
//   PD  → esp.1       (La Liga)
//   BL1 → ger.1       (Bundesliga)
//   SA  → ita.1       (Serie A)
//   CL  → uefa.champions
//   WC  → fifa.world

import { useQuery } from '@tanstack/react-query'

const ESPN_SLUG = {
  FL1: 'fra.1',
  PL:  'eng.1',
  PD:  'esp.1',
  BL1: 'ger.1',
  SA:  'ita.1',
  CL:  'uefa.champions',
  WC:  'fifa.world',
}

function normalize(name = '') {
  return name.toLowerCase()
    .replace(/[àáâ]/g, 'a')
    .replace(/[éèê]/g, 'e')
    .trim()
}

/**
 * Associe un event ESPN à un de nos matchs football-data.org par noms d'équipes.
 */
function matchEvent(espnEvent, matches) {
  const comp        = espnEvent.competitions?.[0]
  if (!comp) return null

  const competitors = comp.competitors ?? []
  const home = competitors.find(c => c.homeAway === 'home')
  const away = competitors.find(c => c.homeAway === 'away')
  if (!home || !away) return null

  const espnHome = normalize(home.team?.displayName ?? '')
  const espnAway = normalize(away.team?.displayName ?? '')

  const found = matches.find(m => {
    const h = normalize(m.homeTeam?.name ?? m.homeTeam?.shortName ?? '')
    const a = normalize(m.awayTeam?.name ?? m.awayTeam?.shortName ?? '')
    const homeOk = h.startsWith(espnHome.slice(0, 5)) || espnHome.startsWith(h.slice(0, 5))
    const awayOk = a.startsWith(espnAway.slice(0, 5)) || espnAway.startsWith(a.slice(0, 5))
    return homeOk && awayOk
  })

  if (!found) return null

  return {
    matchId: found.id,
    home:    parseInt(home.score ?? '0', 10),
    away:    parseInt(away.score ?? '0', 10),
  }
}

async function fetchEspnScores(liveMatches) {
  // Déterminer les slugs ESPN nécessaires pour les compétitions en cours
  const slugsNeeded = new Set()
  for (const match of liveMatches) {
    const slug = ESPN_SLUG[match.competition?.code]
    if (slug) slugsNeeded.add(slug)
  }

  if (slugsNeeded.size === 0) return {}

  // Fetcher toutes les compétitions en parallèle
  const fetchSlug = async (slug) => {
    try {
      const res = await fetch(`/espn?slug=${slug}`)
      if (!res.ok) return []
      const json = await res.json()
      return json.events ?? []
    } catch {
      return [] // ESPN plante → on ignore silencieusement
    }
  }

  const results  = await Promise.all([...slugsNeeded].map(fetchSlug))
  const allEvents = results.flat()

  // Construire la map { matchId → { home, away } }
  const scores = {}
  for (const event of allEvents) {
    const result = matchEvent(event, liveMatches)
    if (result) {
      scores[result.matchId] = { home: result.home, away: result.away }
    }
  }

  return scores
}

/**
 * Hook qui retourne les scores ESPN en temps réel pour les matchs live.
 * Retourne {} si ESPN est indisponible (fallback silencieux sur football-data.org).
 *
 * @param {Array} liveMatches — matchs IN_PLAY ou PAUSED depuis useLiveMatches
 * @returns {{ [matchId]: { home: number, away: number } }}
 */
export function useEspnScores(liveMatches) {
  const matchIds = liveMatches.map(m => m.id).join(',')

  const { data } = useQuery({
    queryKey:       ['espnScores', matchIds],
    queryFn:        () => fetchEspnScores(liveMatches),
    enabled:        liveMatches.length > 0,
    refetchInterval: 10_000,   // poll ESPN toutes les 10s pendant les matchs live
    staleTime:        8_000,
    retry:           false,    // pas de retry — on passe direct au fallback
  })

  return data ?? {}
}
