// Classement Elo des équipes d'un championnat, mélangé au modèle maison (calcPronoAdvanced) pour les
// matchs SANS cote de bookmaker. Validé le 19/11 par scripts/backtest-elo.mjs (PL/FL1/PD/SA, saisons
// 2023-24 et 2024-25) : avec la saison précédente comme point de départ, poids 65 % → log loss
// meilleur de 0,015 à 0,039 selon le championnat, favori juste plus souvent. Sans saison précédente
// (Elo « froid »), gain plus faible mais positif en moyenne. Fatigue (jours de repos) testée en même
// temps et écartée : légèrement moins bonne partout.
// ⚠️ Ce fichier est utilisé tel quel par le script de test : toute modification doit être re-mesurée.
import { finalScore } from './matchUtils'

export const ELO_K = 20
export const ELO_HOME = 60
export const ELO_WEIGHT = 0.65

function eloUpdate(R, m) {
  const h = m.homeTeam?.id, a = m.awayTeam?.id
  if (h == null || a == null) return
  const fs = finalScore(m.score)
  if (fs.home == null || fs.away == null) return
  const rh = R.get(h) ?? 1500, ra = R.get(a) ?? 1500
  const exp = 1 / (1 + 10 ** (-(rh + ELO_HOME - ra) / 400))
  const res = fs.home > fs.away ? 1 : fs.home < fs.away ? 0 : 0.5
  const gd = Math.abs(fs.home - fs.away)
  const mult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8
  const d = ELO_K * mult * (res - exp)
  R.set(h, rh + d); R.set(a, ra - d)
}

const byDate = (a, b) => new Date(a.utcDate) - new Date(b.utcDate)
const isFinished = m => m?.status === 'FINISHED'

// prevSeason : matchs de la saison précédente du même championnat (vide = Elo « froid »).
// current : matchs de la saison en cours. before : seuls les matchs joués avant cette date comptent.
export function buildEloTable(prevSeason, current, before = null) {
  const R = new Map()
  for (const m of [...(prevSeason ?? [])].filter(isFinished).sort(byDate)) eloUpdate(R, m)
  for (const [k, v] of R) R.set(k, 1500 + (v - 1500) * 2 / 3)
  // Promus (absents de la saison précédente) : niveau moyen des 3 plus faibles.
  const weakest = [...R.values()].sort((x, y) => x - y).slice(0, 3)
  const promoted = weakest.length ? weakest.reduce((s, x) => s + x, 0) / weakest.length : 1500
  for (const m of current ?? []) for (const id of [m.homeTeam?.id, m.awayTeam?.id]) {
    if (id != null && !R.has(id)) R.set(id, promoted)
  }
  const t = before ? new Date(before).getTime() : Infinity
  for (const m of [...(current ?? [])].filter(isFinished).sort(byDate)) {
    if (new Date(m.utcDate).getTime() >= t) break
    eloUpdate(R, m)
  }
  return R
}

// Elo → probabilités 1X2 (0-1). Le nul est le plus probable quand les équipes sont proches.
export function eloProbs(rh, ra, neutralVenue = false) {
  const e = 1 / (1 + 10 ** (-(rh + (neutralVenue ? 0 : ELO_HOME) - ra) / 400))
  const draw = Math.max(0.12, 0.30 - 0.5 * Math.abs(e - 0.5) ** 1.3)
  return { home: Math.max(0.02, e - draw / 2), draw, away: Math.max(0.02, 1 - e - draw / 2) }
}

// Mélange un pronostic en % (home/draw/away, somme 100) avec l'Elo. Renvoie des % entiers, somme 100.
export function blendWithElo(pct, elo, w = ELO_WEIGHT) {
  if (!pct || !elo) return pct
  const s0 = (pct.home + pct.draw + pct.away) || 100
  const mix = k => (pct[k] / s0) * (1 - w) + elo[k] * w
  const raw = { home: mix('home'), draw: mix('draw'), away: mix('away') }
  const s = raw.home + raw.draw + raw.away
  const home = Math.round((raw.home / s) * 100)
  const away = Math.round((raw.away / s) * 100)
  return { ...pct, home, away, draw: 100 - home - away }
}

// Saison précédente tirée d'un historique multi-saisons (h2hHistory, déjà chargé par l'app) :
// les matchs de l'année « juillet → juin » qui précède le début de la saison en cours.
export function previousSeasonOf(current, history) {
  if (!current?.length || !history?.length) return []
  const first = current.reduce((min, m) => (m.utcDate < min ? m.utcDate : min), current[0].utcDate)
  const d = new Date(first)
  const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1
  const from = Date.UTC(y - 1, 6, 1), to = Date.UTC(y, 6, 1)
  const ids = new Set(current.map(m => m.id))
  return history.filter(m => {
    const t = new Date(m.utcDate).getTime()
    return t >= from && t < to && !ids.has(m.id)
  })
}

// Cache par (saison en cours, historique) : une seule construction par jeu de données affiché.
const cache = new WeakMap()
export function eloTableCached(current, history) {
  if (!current?.length) return null
  const key = current
  const hit = cache.get(key)
  if (hit && hit.history === history) return hit.table
  const table = buildEloTable(previousSeasonOf(current, history), current)
  cache.set(key, { history, table })
  return table
}

// Probabilités Elo d'un match, ou null si une des deux équipes est inconnue du championnat.
export function matchEloProbs(table, homeId, awayId, neutralVenue = false) {
  if (!table || homeId == null || awayId == null) return null
  if (!table.has(homeId) || !table.has(awayId)) return null
  return eloProbs(table.get(homeId), table.get(awayId), neutralVenue)
}
