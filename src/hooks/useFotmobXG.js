// useFotmobXG — Expected goals (xG) via FotMob.
// Stratégie en 2 passes :
//   1. /api/fotmob?date=YYYYMMDD  → trouve l'ID FotMob par fuzzy match d'équipes
//   2. /api/fotmob?matchId=XXX    → détails du match → extrait xG home/away
//
// Polling toutes les 60s pendant le live. Désactivé si match pas commencé ou terminé.

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

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

// ── Lineup FotMob ──────────────────────────────────────────────────────────────

const FOT_POS = { GK:1,GoalKeeper:1, DF:2,Defender:2,CB:2,LB:2,RB:2, MF:3,Midfielder:3,CM:3,DM:3,AM:3, FW:4,Forward:4,CF:4,LW:4,RW:4,ST:4,AML:3,AMR:3,AMC:3,DMC:3 }
const FOT_POS_MAP = { 1:'GK', 2:'DEF', 3:'MID', 4:'FWD' }

function extractFotmobLineup(data) {
  if (!data) return null

  // FotMob change parfois la structure — on essaie plusieurs chemins
  const rawLup = data.content?.lineup

  // Chemin A : content.lineup.homeTeam / awayTeam (structure commune)
  // Chemin B : content.lineup.lineup.homeTeam / awayTeam (double imbrication)
  const lup = rawLup?.homeTeam ? rawLup : (rawLup?.lineup ?? null)
  if (!lup) return null

  // Aplatir les joueurs selon la structure retournée
  // Cas 1 : td.players = [{isFirstEleven, name, shirt, role, ...}]
  // Cas 2 : td.lineup  = [[player, ...], [...], ...] (lignes de jeu) — flatten
  // Cas 3 : td.players = {starters:[], bench:[]} — objet pas tableau
  const flatPlayers = (td) => {
    if (!td) return []
    const src = td.players ?? td.lineup ?? td.starters ?? []
    if (Array.isArray(src) && src.length > 0) {
      if (Array.isArray(src[0])) return src.flat()  // tableau de tableaux (lignes)
      return src
    }
    // starters séparés des remplaçants dans deux tableaux distincts
    const starters = td.startXI ?? td.starters ?? []
    const bench    = td.bench ?? td.substitutes ?? []
    return [...starters.map(p => ({...p, isFirstEleven: true})), ...bench]
  }

  const mapTeam = (td) => {
    if (!td) return null
    const all = flatPlayers(td)
    if (!all.length) return null
    const starters = all.filter(p => p.isFirstEleven || p.starter || p.positionId != null && p.positionRowIndex != null)
    // Si aucun marqueur starter, prendre les 11 premiers
    const finalStart = starters.length >= 7 ? starters : all.slice(0, 11)
    const finalSubs  = starters.length >= 7 ? all.filter(p => !(p.isFirstEleven || p.starter)) : all.slice(11)
    const mapP = (p, i) => ({
      name:      p.name ?? p.fullName ?? p.shortName ?? '?',
      shortName: p.shortName ?? p.usualName ?? (p.name ?? '?').split(' ').pop(),
      number:    p.shirt ?? p.number ?? p.jerseyNumber ?? '',
      position:  FOT_POS_MAP[FOT_POS[p.role ?? p.positionId ?? ''] ?? 0] ?? p.role ?? '',
      order:     i,
    })
    if (!finalStart.length) return null
    return {
      name:      td.title ?? td.name ?? td.teamName ?? '',
      shortName: td.shortTitle ?? td.shortName ?? td.title ?? '',
      color:     '#1e293b',
      altColor:  '#ffffff',
      formation: td.formation ?? td.tacticalFormation ?? '',
      starters:  finalStart.map(mapP),
      subs:      finalSubs.map(mapP),
    }
  }

  const home = mapTeam(lup.homeTeam ?? lup.home)
  const away = mapTeam(lup.awayTeam ?? lup.away)
  if (!home?.starters?.length) return null
  return { home, away }
}

// Hook interne : résout l'ID FotMob pour un match (générique — réutilisé partout)
function useFotmobMatchId(match) {
  const date   = matchDateStr(match)
  const fdHome = match?.homeTeam?.name ?? match?.homeTeam?.shortName ?? ''
  const fdAway = match?.awayTeam?.name ?? match?.awayTeam?.shortName ?? ''

  return useQuery({
    queryKey:  ['fotmobId', match?.id, date],
    enabled:   !!match?.id && !!date && !!fdHome,
    staleTime: 24 * 60 * 60_000,  // stable 24h
    retry: 1,
    queryFn: async () => {
      const res = await fetch(`/api/fotmob?date=${date}`)
      if (!res.ok) return null
      const data = await res.json()
      for (const league of data.leagues ?? []) {
        for (const m of league.matches ?? []) {
          const fh = m.home?.longName ?? m.home?.name ?? ''
          const fa = m.away?.longName ?? m.away?.name ?? ''
          if (fuzzyMatch(fdHome, fh) && fuzzyMatch(fdAway, fa)) return String(m.id)
        }
      }
      return null
    },
  })
}

/**
 * Compos d'un match terminé ou live via FotMob.
 * Utilisé pour WC 2026 où ESPN/api-football sont moins fiables.
 */
export function useFotmobLineup(match) {
  const { data: fotmobId, isLoading: idLoading } = useFotmobMatchId(match)

  const query = useQuery({
    queryKey:  ['fotmobLineup', fotmobId],
    enabled:   !!fotmobId,
    staleTime: 7 * 24 * 60 * 60_000,  // lineup stable 7 jours
    retry: 1,
    queryFn: async () => {
      const res = await fetch(`/api/fotmob?matchId=${fotmobId}`)
      if (!res.ok) return null
      const data = await res.json()
      // DEBUG temporaire — vérifier la structure FotMob dans la console
      console.log('[FotmobLineup] keys:', Object.keys(data?.content ?? {}))
      const lup = data?.content?.lineup
      if (lup) console.log('[FotmobLineup] lineup keys:', Object.keys(lup), '| homeTeam keys:', Object.keys(lup.homeTeam ?? lup.home ?? lup.lineup?.homeTeam ?? {}))
      return extractFotmobLineup(data)
    },
  })

  return { data: query.data ?? null, isLoading: idLoading || query.isLoading }
}

/**
 * Compos probables via FotMob — dernier XI connu de chaque équipe.
 * Zéro quota, pas de clé API, fonctionne pour WC 2026.
 */
export function useFotmobProbableLineups(match, compMatches) {
  const homeId = match?.homeTeam?.id
  const awayId = match?.awayTeam?.id

  const [lastHomeMatch, lastAwayMatch] = useMemo(() => {
    if (!compMatches?.length || !homeId || !awayId) return [null, null]
    const sorted = [...compMatches]
      .filter(m => m.status === 'FINISHED')
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    return [
      sorted.find(m => m.homeTeam?.id === homeId || m.awayTeam?.id === homeId) ?? null,
      sorted.find(m => m.homeTeam?.id === awayId || m.awayTeam?.id === awayId) ?? null,
    ]
  }, [compMatches, homeId, awayId])

  const { data: homeLineups, isLoading: hl } = useFotmobLineup(lastHomeMatch)
  const { data: awayLineups, isLoading: al } = useFotmobLineup(lastAwayMatch)

  const home = useMemo(() => {
    if (!homeLineups || !lastHomeMatch) return null
    const wasHome = lastHomeMatch.homeTeam?.id === homeId
    const roster  = wasHome ? homeLineups.home : homeLineups.away
    if (!roster?.starters?.length) return null
    const opp = wasHome
      ? (lastHomeMatch.awayTeam?.shortName ?? lastHomeMatch.awayTeam?.name ?? '?')
      : (lastHomeMatch.homeTeam?.shortName ?? lastHomeMatch.homeTeam?.name ?? '?')
    return { ...roster, fromMatch: { date: lastHomeMatch.utcDate, opponent: opp } }
  }, [homeLineups, lastHomeMatch, homeId])

  const away = useMemo(() => {
    if (!awayLineups || !lastAwayMatch) return null
    const wasHome = lastAwayMatch.homeTeam?.id === awayId
    const roster  = wasHome ? awayLineups.home : awayLineups.away
    if (!roster?.starters?.length) return null
    const opp = wasHome
      ? (lastAwayMatch.awayTeam?.shortName ?? lastAwayMatch.awayTeam?.name ?? '?')
      : (lastAwayMatch.homeTeam?.shortName ?? lastAwayMatch.homeTeam?.name ?? '?')
    return { ...roster, fromMatch: { date: lastAwayMatch.utcDate, opponent: opp } }
  }, [awayLineups, lastAwayMatch, awayId])

  return {
    data: (home || away) ? { home, away } : null,
    isLoading: hl || al,
  }
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
