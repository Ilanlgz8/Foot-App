// Ligue 3 côté client — voir src/utils/ligue3Parse.js pour la source (API FFF) et ses limites.
// Une seule requête (/espn?l3=1, en cache CDN 15 min) sert les 3 pages : Programme, Résultats
// et Classement. Dédoublonnée ici pour que les 3 hooks d'une même page ne la tirent qu'une fois.

export const L3_ID = 'L3'

let inflight = null
let memo = null
let memoAt = 0
const MEMO_MS = 60_000

export async function fetchLigue3() {
  if (memo && Date.now() - memoAt < MEMO_MS) return memo
  if (inflight) return inflight
  inflight = (async () => {
    const r = await fetch('/espn?l3=1')
    if (!r.ok) throw new Error(`Erreur API: ${r.status}`)
    const j = await r.json()
    if (!Array.isArray(j?.matches)) throw new Error('Erreur API')
    memo = j
    memoAt = Date.now()
    return j
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

// Coup d'envoi passé mais score pas encore publié par la FFF (~1 h 30 à 2 h après la fin) :
// ni « à venir » (Programme) ni « terminé » (Résultats). Pas de faux direct : le match
// disparaît du Programme au coup d'envoi et arrive dans Résultats quand la FFF publie le score.
export function l3Status(m, now = Date.now()) {
  if (m.status === 'FINISHED') return 'FINISHED'
  if (m.postponed) return 'POSTPONED'
  const ko = Date.parse(m.utcDate)
  if (Number.isFinite(ko) && ko <= now) return 'AWAITING_RESULT'
  return 'TIMED'
}

export async function fetchLigue3Matches() {
  const { matches } = await fetchLigue3()
  const now = Date.now()
  return matches.map(m => ({ ...m, status: l3Status(m, now), _noDetail: true }))
}

export async function fetchLigue3Standings() {
  const { table } = await fetchLigue3()
  return { table: table ?? [], groups: [] }
}

// Forme récente (5 derniers matchs de championnat) par id d'équipe, au format attendu par
// StandingsTable (formMap) : ['W','D','L', …] du plus ancien au plus récent.
export function buildLigue3FormMap(finishedMatches) {
  const byTeam = {}
  const sorted = [...(finishedMatches ?? [])]
    .filter(m => m.status === 'FINISHED')
    .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
  for (const m of sorted) {
    const hs = m.score?.fullTime?.home
    const as = m.score?.fullTime?.away
    if (hs == null || as == null) continue
    const h = hs > as ? 'W' : hs < as ? 'L' : 'D'
    const a = hs > as ? 'L' : hs < as ? 'W' : 'D'
    if (m.homeTeam?.id != null) (byTeam[m.homeTeam.id] ??= []).push(h)
    if (m.awayTeam?.id != null) (byTeam[m.awayTeam.id] ??= []).push(a)
  }
  for (const id of Object.keys(byTeam)) byTeam[id] = byTeam[id].slice(-5)
  return byTeam
}
