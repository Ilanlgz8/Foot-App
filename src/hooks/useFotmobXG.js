// useFotmobXG — Expected goals (xG) via FotMob.
// Stratégie en 2 passes :
//   1. /api/fotmob?date=YYYYMMDD  → trouve l'ID FotMob par fuzzy match d'équipes
//   2. /api/fotmob?matchId=XXX    → détails du match → extrait xG home/away
//
// Polling toutes les 60s pendant le live. Désactivé si match pas commencé ou terminé.

import { useQuery } from '@tanstack/react-query'

function matchDateStr(match) {
  if (!match?.utcDate) return null
  const d = new Date(match.utcDate)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

// Normalise un nom d'équipe pour la comparaison (lowercase, sans accents, sans FC/AFC/etc.)
function normTeam(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|afc|cf|sc|sporting|club|united|city|real|atletico|athletico|manchester|paris|saint)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function fuzzyMatch(a, b) {
  const na = normTeam(a), nb = normTeam(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  // Jaccard sur les mots
  const wa = new Set(na.split(' ').filter(Boolean))
  const wb = new Set(nb.split(' ').filter(Boolean))
  const inter = [...wa].filter(w => wb.has(w)).length
  const union = new Set([...wa, ...wb]).size
  return union > 0 && inter / union >= 0.5
}

// Extrait le xG home/away depuis la réponse /matchDetails FotMob.
// FotMob peut changer sa structure — on essaie plusieurs chemins.
function extractXG(data) {
  if (!data) return null

  // Chemin 1 : header.teams[0/1].xg (souvent présent dès le début du match)
  const teams = data.header?.teams ?? []
  const hXg1 = parseFloat(teams[0]?.xg)
  const aXg1 = parseFloat(teams[1]?.xg)
  if (!isNaN(hXg1) && !isNaN(aXg1)) return { home: hXg1, away: aXg1 }

  // Chemin 2 : content.stats.Periods.All.stats → "Expected goals (xG)"
  const statGroups = data.content?.stats?.Periods?.All?.stats ?? []
  for (const s of statGroups) {
    const title = (s.title ?? s.type ?? '').toLowerCase()
    if (title.includes('expected') || title.includes('xg')) {
      const h = parseFloat(s.homeValue ?? s.home)
      const a = parseFloat(s.awayValue ?? s.away)
      if (!isNaN(h) && !isNaN(a)) return { home: h, away: a }
    }
  }

  // Chemin 3 : content.matchFacts.infoBox.expectedGoals
  const ib = data.content?.matchFacts?.infoBox?.expectedGoals
  if (ib) {
    const h = parseFloat(ib.homeValue ?? ib.home)
    const a = parseFloat(ib.awayValue ?? ib.away)
    if (!isNaN(h) && !isNaN(a)) return { home: h, away: a }
  }

  return null
}

export function useFotmobXG(match) {
  const isLive = match?.status === 'IN_PLAY' || match?.status === 'PAUSED'
  const date   = matchDateStr(match)
  const fdHome = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''

  // ── Passe 1 : scoreboard → ID FotMob ────────────────────────────────────────
  const { data: fotmobMatchId } = useQuery({
    queryKey: ['fotmobId', date, fdHome, fdAway],
    enabled:  isLive && !!date && !!fdHome && !!fdAway,
    staleTime: 10 * 60_000,  // stable : l'ID ne change pas en cours de match
    retry: 1,
    queryFn: async () => {
      const res = await fetch(`/api/fotmob?date=${date}`)
      if (!res.ok) return null
      const data = await res.json()

      for (const league of data.leagues ?? []) {
        for (const m of league.matches ?? []) {
          const fotHome = m.home?.longName ?? m.home?.name ?? ''
          const fotAway = m.away?.longName ?? m.away?.name ?? ''
          if (fuzzyMatch(fdHome, fotHome) && fuzzyMatch(fdAway, fotAway)) {
            return String(m.id)
          }
        }
      }
      return null
    },
  })

  // ── Passe 2 : détails match → xG ────────────────────────────────────────────
  const { data: xg } = useQuery({
    queryKey: ['fotmobXG', fotmobMatchId],
    enabled:  isLive && !!fotmobMatchId,
    staleTime: 55_000,
    refetchInterval: 60_000,  // refresh toutes les 60s en live
    retry: 1,
    queryFn: async () => {
      const res = await fetch(`/api/fotmob?matchId=${fotmobMatchId}`)
      if (!res.ok) return null
      const data = await res.json()
      return extractXG(data)
    },
  })

  return xg ?? null  // { home: 1.34, away: 0.67 } ou null
}
