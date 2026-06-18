// Récupère les détails ESPN d'un match terminé (buteurs + stats) à la demande.
// Utilisé par MatchModal quand les données ne sont pas déjà en localStorage.
// ESPN scoreboard : matchs du jour sans param, matchs d'une date précise avec ?dates=YYYYMMDD.

import { useQuery } from '@tanstack/react-query'
import { COMP_ESPN, normalize, fuzzyTeam } from './useLiveMinute'

/** Retourne la date UTC d'un match au format YYYYMMDD pour le paramètre ESPN. */
function espnDate(match) {
  if (!match?.utcDate) return null
  const d = new Date(match.utcDate)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** Vrai si le match est aujourd'hui (en UTC). */
function isMatchToday(match) {
  if (!match?.utcDate) return false
  const d     = new Date(match.utcDate)
  const today = new Date()
  return (
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth()    === today.getUTCMonth()    &&
    d.getUTCDate()     === today.getUTCDate()
  )
}

/**
 * Extrait les scorers + stats d'un event ESPN correspondant à notre match FD.org.
 */
function extractEspnData(evt, match) {
  const comp  = evt.competitions?.[0]
  if (!comp) return null

  const homeC = (comp.competitors ?? []).find(c => c.homeAway === 'home')
  const awayC = (comp.competitors ?? []).find(c => c.homeAway === 'away')
  if (!homeC || !awayC) return null

  // Vérifier que c'est bien le bon match par noms d'équipes
  const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
  const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
  const fdHome   = match.homeTeam?.name ?? match.homeTeam?.shortName ?? ''
  const fdAway   = match.awayTeam?.name ?? match.awayTeam?.shortName ?? ''
  if (!fuzzyTeam(fdHome, espnHome) || !fuzzyTeam(fdAway, espnAway)) return null

  const scorers = (comp.details ?? [])
    .filter(d => d.type?.text === 'Goal' || d.type?.id === '57')
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      return {
        name:        ath?.shortName ?? ath?.displayName ?? '?',
        minute:      d.clock?.displayValue ?? '',
        team:        d.team?.id === homeC.team?.id ? 'home' : 'away',
        ownGoal:     d.ownGoal     ?? false,
        penaltyKick: d.penaltyKick ?? false,
      }
    })

  const getStat = (c, name) => {
    const found = (c.statistics ?? []).find(s => s.name === name)
    return found != null ? (parseFloat(found.displayValue) || 0) : null
  }
  const homePoss = getStat(homeC, 'possessionPct')
  const awayPoss = getStat(awayC, 'possessionPct')

  return {
    home: parseInt(homeC.score ?? '0', 10),
    away: parseInt(awayC.score ?? '0', 10),
    scorers,
    stats: (homePoss !== null || awayPoss !== null) ? {
      home: { poss: homePoss, shots: getStat(homeC, 'totalShots'), corners: getStat(homeC, 'corners') },
      away: { poss: awayPoss, shots: getStat(awayC, 'totalShots'), corners: getStat(awayC, 'corners') },
    } : null,
  }
}

/**
 * @param {object|null} match  — objet match FD.org (homeTeam, awayTeam, competition)
 * @param {number|null} compId — competition ID FD.org (ex: 2000 pour WC)
 * @param {boolean}     enabled
 */
export function useEspnMatchDetail(match, compId, enabled = true) {
  const slug = COMP_ESPN[compId] ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['espnMatchDetail', match?.id, slug],
    queryFn: async () => {
      if (!slug || !match) return null
      // Pour les matchs pas d'aujourd'hui, on passe ?dates=YYYYMMDD → ESPN retourne
      // le scoreboard de ce jour-là, pas seulement les matchs en cours.
      const dateParam = isMatchToday(match) ? '' : `&dates=${espnDate(match)}`
      const res = await fetch(`/espn?slug=${slug}${dateParam}`)
      if (!res.ok) return null
      const json = await res.json()

      for (const evt of json.events ?? []) {
        const extracted = extractEspnData(evt, match)
        if (extracted) {
          // Persister pour les prochaines ouvertures de modal
          try {
            localStorage.setItem(`foot_espn_${match.id}`, JSON.stringify(extracted))
          } catch {}
          return extracted
        }
      }
      return null
    },
    enabled: enabled && !!slug && !!match?.id,
    staleTime: 5 * 60_000, // 5min — match terminé, données stables
    retry: false,
  })

  return { espnData: data ?? null, loading: isLoading }
}
