// Ligue 2 : numéros de journée (12/11, demande utilisateur : « on s'y retrouve pas » avec des
// matchs rangés par date). ESPN (source du direct) ne donne PAS la journée ; la FFF, si
// (compétition « L2 » de son API, même source que la Ligue 3). On rapproche donc chaque match
// ESPN de son match FFF — même créneau (± 36 h) et noms d'équipes les plus proches — et on lui
// recopie sa journée. Le direct, les compos et la page match restent ceux d'ESPN.
// En plus : les matchs FFF hors de la fenêtre ESPN (plus de 30 jours en arrière, ou trop loin
// devant) sont ajoutés, pour avoir toute la saison dans Programme et Résultats.
// Échec FFF (réseau, API changée) → la liste ESPN est rendue telle quelle, rangée par date.
import { fetchFffCompetition } from './ligue3Parse'

// Compétition « L2 » saison 2026 (relevée le 12/11 sur /api/compets/452035). À mettre à jour en
// août, comme L3_CP_NO.
export const L2_CP_NO = 452035

let memo = null
let memoAt = 0
let inflight = null
const MEMO_MS = 10 * 60_000

async function getFffLigue2() {
  if (memo && Date.now() - memoAt < MEMO_MS) return memo
  if (inflight) return inflight
  inflight = fetchFffCompetition(L2_CP_NO, fetch, 20_000)
    .then(r => { memo = r.matches; memoAt = Date.now(); return memo })
    .finally(() => { inflight = null })
  return inflight
}

// Mots qui ne distinguent pas un club (sigles, « stade », « foot »…) — retirés avant comparaison.
const FILLER = new Set([
  'fc', 'as', 'sc', 'us', 'usl', 'af', 'hsc', 'fco', 'mfc', 'usco', 'ea', 'ac', 'rc', 'sm', 'og', 'ogc',
  'foot', 'football', 'club', 'stade', 'olympique', 'de', 'du', 'd', 'la', 'le', 'les', 'l', 's', 'sur', 'st', 'saint',
])

export function normTeam(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w && !FILLER.has(w) && !/^\d+$/.test(w))
    .join(' ')
}

function trigrams(s) {
  const t = ` ${s} `
  const out = new Set()
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3))
  return out
}

export function nameSim(a, b) {
  const A = trigrams(normTeam(a))
  const B = trigrams(normTeam(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

const teamSim = (espnTeam, fffTeam) =>
  Math.max(nameSim(espnTeam?.name, fffTeam?.name), nameSim(espnTeam?.shortName, fffTeam?.name))

export function enrichLigue2(espnMatches, fffMatches) {
  if (!Array.isArray(fffMatches) || fffMatches.length === 0) return espnMatches
  const WINDOW = 36 * 3600_000

  // Toutes les paires plausibles, puis attribution gloutonne de la meilleure (chaque match
  // FFF ne sert qu'une fois).
  const pairs = []
  espnMatches.forEach((m, i) => {
    const t = Date.parse(m.utcDate)
    fffMatches.forEach((f, j) => {
      const dt = Math.abs(Date.parse(f.utcDate) - t)
      if (!(dt <= WINDOW)) return
      const score = teamSim(m.homeTeam, f.homeTeam) + teamSim(m.awayTeam, f.awayTeam) - dt / (WINDOW * 10)
      if (score >= 0.45) pairs.push({ i, j, score })
    })
  })
  pairs.sort((a, b) => b.score - a.score)
  const espnTo = new Map()
  const usedF = new Set()
  for (const p of pairs) {
    if (espnTo.has(p.i) || usedF.has(p.j)) continue
    espnTo.set(p.i, p.j)
    usedF.add(p.j)
  }

  // Équipe FFF → équipe ESPN (nom, logo, id) apprise sur les matchs rapprochés.
  const teamMap = new Map()
  const out = espnMatches.map((m, i) => {
    const j = espnTo.get(i)
    if (j == null) return m
    const f = fffMatches[j]
    teamMap.set(f.homeTeam.id, m.homeTeam)
    teamMap.set(f.awayTeam.id, m.awayTeam)
    return { ...m, matchday: f.matchday ?? m.matchday ?? null }
  })

  // Matchs FFF en dehors de la fenêtre ESPN : toute la saison dans Programme/Résultats.
  const times = espnMatches.map(m => Date.parse(m.utcDate)).filter(Number.isFinite)
  if (times.length === 0) return out
  const first = Math.min(...times) - WINDOW
  const last = Math.max(...times) + WINDOW
  const comp = espnMatches[0]?.competition
  const now = Date.now()
  fffMatches.forEach((f, j) => {
    if (usedF.has(j)) return
    const t = Date.parse(f.utcDate)
    if (!Number.isFinite(t) || (t >= first && t <= last)) return
    const finished = f.status === 'FINISHED'
    if (!finished && t <= now) return // passé sans score : on ne sait rien de fiable
    out.push({
      ...f,
      id: `fff-${f.id}`,
      status: finished ? 'FINISHED' : 'TIMED',
      homeTeam: teamMap.get(f.homeTeam.id) ?? f.homeTeam,
      awayTeam: teamMap.get(f.awayTeam.id) ?? f.awayTeam,
      competition: comp ?? f.competition,
      _noDetail: true,
    })
  })
  return out
}

export async function enrichLigue2Safe(espnMatches) {
  try {
    return enrichLigue2(espnMatches, await getFffLigue2())
  } catch {
    return espnMatches
  }
}
