#!/usr/bin/env node
// Banc d'essai Elo + fatigue (EXPÉRIMENTAL, rien n'est branché dans l'app).
// Compare sur une saison terminée : modèle actuel / + Elo / + Elo + fatigue.
// Usage : npx vite-node scripts/backtest-elo.mjs PL 2024
//         (codes : PL FL1 PD BL1 SA ; saison = année de début)
// Requêtes football-data.org : 3 (championnat N, championnat N-1 pour
// initialiser l'Elo, Ligue des champions N pour la fatigue) — sous la limite
// gratuite de 10/min.
import { readFileSync } from 'node:fs'
import { calcPronoAdvanced } from '../src/utils/calcProno.js'
import { finalScore, outcomeForTeam } from '../src/utils/matchUtils.js'

try {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
  }
} catch {}
const API_KEY = process.env.FOOTBALL_DATA_API_KEY || process.env.API_KEY
if (!API_KEY) { console.error('Clé API manquante (.env.local)'); process.exit(1) }

const comp = process.argv[2] || 'PL'
const season = Number(process.argv[3] || new Date().getFullYear() - 1)

async function fetchSeason(code, yr) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?season=${yr}`,
    { headers: { 'X-Auth-Token': API_KEY } })
  if (!res.ok) throw new Error(`${code} ${yr} : HTTP ${res.status}`)
  return ((await res.json()).matches ?? [])
    .filter(m => m.status === 'FINISHED')
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
}
async function tryFetch(code, yr) {
  try { return await fetchSeason(code, yr) }
  catch (e) { console.log(`  (ignoré : ${e.message})`); return [] }
}

// ── Elo ──────────────────────────────────────────────────────────────
const ELO_K = 20, ELO_HOME = 60
function eloUpdate(R, m) {
  const h = m.homeTeam.id, a = m.awayTeam.id
  const fs = finalScore(m.score)
  if (fs.home == null) return
  const rh = R.get(h) ?? 1500, ra = R.get(a) ?? 1500
  const exp = 1 / (1 + 10 ** (-(rh + ELO_HOME - ra) / 400))
  const res = fs.home > fs.away ? 1 : fs.home < fs.away ? 0 : 0.5
  const gd = Math.abs(fs.home - fs.away)
  const mult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8
  const d = ELO_K * mult * (res - exp)
  R.set(h, rh + d); R.set(a, ra - d)
}
// Elo → 1X2. Le nul est le plus probable quand les équipes sont proches.
function eloProbs(rh, ra) {
  const e = 1 / (1 + 10 ** (-(rh + ELO_HOME - ra) / 400))
  const draw = Math.max(0.12, 0.30 - 0.5 * Math.abs(e - 0.5) ** 1.3)
  return { home: Math.max(0.02, e - draw / 2), draw, away: Math.max(0.02, 1 - e - draw / 2) }
}

// ── Fatigue : jours de repos depuis le dernier match (toutes compétitions) ──
function restDays(teamId, date, allMatches) {
  let last = null
  for (const m of allMatches) {
    const d = new Date(m.utcDate)
    if (d >= date) break
    if (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId) last = d
  }
  return last ? (date - last) / 86400000 : 7
}
// Moins de 4 jours de repos = pénalité, croissante jusqu'à 2 jours.
const tired = r => Math.max(0, Math.min(1, (4 - r) / 2))

function norm(p) { const s = p.home + p.draw + p.away; return { home: p.home / s, draw: p.draw / s, away: p.away / s } }
function recentForm(id, list, before) {
  return list.filter(m => new Date(m.utcDate) < before && (m.homeTeam?.id === id || m.awayTeam?.id === id))
    .slice(-5).map(m => outcomeForTeam(m, id)).filter(Boolean)
}

async function run() {
  console.log(`Récupération ${comp} ${season}, ${comp} ${season - 1}, CL ${season}...`)
  const cur = await fetchSeason(comp, season)
  const prev = await tryFetch(comp, season - 1)
  const cl = comp === 'CL' ? [] : await tryFetch('CL', season)
  const allComps = [...cur, ...cl].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))

  // Elo initial : saison précédente, puis compression vers 1500 (1/3) ;
  // promus = moyenne des 3 plus faibles.
  const R = new Map()
  for (const m of prev) eloUpdate(R, m)
  for (const [k, v] of R) R.set(k, 1500 + (v - 1500) * 2 / 3)
  const weakest = [...R.values()].sort((a, b) => a - b).slice(0, 3)
  const promoted = weakest.length ? weakest.reduce((s, x) => s + x, 0) / weakest.length : 1500
  for (const m of cur) for (const id of [m.homeTeam.id, m.awayTeam.id]) if (!R.has(id)) R.set(id, promoted)

  const W_ELO = [0, 0.2, 0.35, 0.5]
  const F_PTS = [0, 0.03, 0.05]          // points de proba retirés à l'équipe fatiguée
  const variants = []
  for (const w of W_ELO) for (const f of F_PTS) variants.push({ w, f, brier: 0, ll: 0, fav: 0 })
  let n = 0

  for (const m of cur) {
    const date = new Date(m.utcDate)
    const prior = cur.filter(x => new Date(x.utcDate) < date)
    const fs = finalScore(m.score)
    const act = fs.home > fs.away ? 'home' : fs.home < fs.away ? 'away' : 'draw'
    if (prior.length >= 10) {
      const h = m.homeTeam.id, a = m.awayTeam.id
      const base = calcPronoAdvanced(h, a, prior, recentForm(h, cur, date), recentForm(a, cur, date))
      const b = norm({ home: base.home / 100, draw: base.draw / 100, away: base.away / 100 })
      const e = eloProbs(R.get(h), R.get(a))
      const th = tired(restDays(h, date, allComps)), ta = tired(restDays(a, date, allComps))
      for (const v of variants) {
        let p = { home: b.home * (1 - v.w) + e.home * v.w, draw: b.draw * (1 - v.w) + e.draw * v.w, away: b.away * (1 - v.w) + e.away * v.w }
        const shift = v.f * (th - ta)  // >0 : domicile plus fatigué
        p = norm({ home: Math.max(0.01, p.home - shift), draw: p.draw, away: Math.max(0.01, p.away + shift) })
        v.brier += ['home', 'draw', 'away'].reduce((s, k) => s + (p[k] - (k === act ? 1 : 0)) ** 2, 0)
        v.ll += -Math.log(Math.max(1e-9, p[act]))
        const fav = p.home >= p.draw && p.home >= p.away ? 'home' : p.away >= p.draw ? 'away' : 'draw'
        if (fav === act) v.fav++
      }
      n++
    }
    eloUpdate(R, m)
  }

  if (!n) { console.log('Pas assez de matchs.'); return }
  const ref = variants[0]
  console.log(`\n${n} matchs évalués (${comp} ${season}). Plus bas = mieux pour Brier et log loss.\n`)
  console.log('poids Elo  fatigue  Brier    log loss  favori ok   gain vs actuel (log loss)')
  for (const v of variants) {
    const gain = (ref.ll - v.ll) / n
    console.log(`${String(Math.round(v.w * 100)).padStart(6)} %  ${String(v.f * 100).padStart(5)} pt  ${(v.brier / n).toFixed(4)}   ${(v.ll / n).toFixed(4)}    ${((v.fav / n) * 100).toFixed(1).padStart(5)} %    ${gain >= 0 ? '+' : ''}${gain.toFixed(4)}`)
  }
  console.log('\nLigne "0 % / 0 pt" = modèle actuel de l\'app. Un gain vaut la peine s\'il se répète sur plusieurs championnats.')
}
run().catch(e => { console.error('Erreur :', e.message); process.exit(1) })
