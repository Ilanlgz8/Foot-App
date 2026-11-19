#!/usr/bin/env node
// Banc d'essai Elo + fatigue (EXPÉRIMENTAL, rien n'est branché dans l'app).
// Compare sur une saison terminée : modèle actuel / + Elo / + Elo + fatigue.
// Usage : npx vite-node scripts/backtest-elo.mjs PL 2024
//         (codes : PL FL1 PD BL1 SA ; saison = année de début)
// Requêtes football-data.org : 2 (championnat N, championnat N-1 pour
// initialiser l'Elo « chaud ») ; attente automatique si le quota (10/min) saute.
// Elo « froid » = sans saison précédente. Fatigue écartée le 19/11 (testée sur
// PL/FL1/PD/SA 2024 : légèrement moins bonne partout, même sans Elo).
import { readFileSync } from 'node:fs'
import { calcPronoAdvanced } from '../src/utils/calcProno.js'
import { finalScore, outcomeForTeam } from '../src/utils/matchUtils.js'
import { buildEloTable, eloProbs, blendWithElo } from '../src/utils/elo.js'

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

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function fetchSeason(code, yr, retry = true) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?season=${yr}`,
    { headers: { 'X-Auth-Token': API_KEY } })
  if (res.status === 429 && retry) {
    console.log('  quota football-data.org atteint, nouvel essai dans 65 s...')
    await sleep(65000)
    return fetchSeason(code, yr, false)
  }
  if (!res.ok) throw new Error(`${code} ${yr} : HTTP ${res.status}`)
  return ((await res.json()).matches ?? [])
    .filter(m => m.status === 'FINISHED')
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
}
async function tryFetch(code, yr) {
  try { return await fetchSeason(code, yr) }
  catch (e) { console.log(`  (ignoré : ${e.message})`); return [] }
}

// Elo : EXACTEMENT le code de l'app (src/utils/elo.js), pour que le test mesure ce qui tourne.

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
  console.log(`Récupération ${comp} ${season} et ${comp} ${season - 1}...`)
  const cur = await fetchSeason(comp, season)
  const prev = await tryFetch(comp, season - 1)
  const cl = []  // fatigue écartée (19/11 : moins bon sur les 4 championnats)
  const allComps = [...cur, ...cl].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))

  const W_ELO = [0, 0.35, 0.5, 0.65, 0.8, 1]
  const variants = []
  for (const w of W_ELO) for (const mode of w ? (prev.length ? ['chaud', 'froid'] : ['froid']) : ['—'])
    variants.push({ w, mode, f: 0, brier: 0, ll: 0, fav: 0 })
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
      const RW = buildEloTable(prev, cur, date), RC = buildEloTable([], cur, date)
      const eW = eloProbs(RW.get(h), RW.get(a))
      const eC = eloProbs(RC.get(h), RC.get(a))
      const th = tired(restDays(h, date, allComps)), ta = tired(restDays(a, date, allComps))
      for (const v of variants) {
        const e = v.mode === 'froid' ? eC : eW
        const bl = v.w ? blendWithElo(base, e, v.w) : base
        let p = norm({ home: bl.home / 100, draw: bl.draw / 100, away: bl.away / 100 })
        const shift = v.f * (th - ta)  // >0 : domicile plus fatigué
        p = norm({ home: Math.max(0.01, p.home - shift), draw: p.draw, away: Math.max(0.01, p.away + shift) })
        v.brier += ['home', 'draw', 'away'].reduce((s, k) => s + (p[k] - (k === act ? 1 : 0)) ** 2, 0)
        v.ll += -Math.log(Math.max(1e-9, p[act]))
        const fav = p.home >= p.draw && p.home >= p.away ? 'home' : p.away >= p.draw ? 'away' : 'draw'
        if (fav === act) v.fav++
      }
      n++
    }
  }

  if (!n) { console.log('Pas assez de matchs.'); return }
  const ref = variants[0]
  console.log(`\n${n} matchs évalués (${comp} ${season}). Plus bas = mieux pour Brier et log loss.\n`)
  console.log('poids Elo  Elo départ  Brier    log loss  favori ok   gain vs actuel (log loss)')
  for (const v of variants) {
    const gain = (ref.ll - v.ll) / n
    console.log(`${String(Math.round(v.w * 100)).padStart(6)} %  ${v.mode.padEnd(10)}  ${(v.brier / n).toFixed(4)}   ${(v.ll / n).toFixed(4)}    ${((v.fav / n) * 100).toFixed(1).padStart(5)} %    ${gain >= 0 ? '+' : ''}${gain.toFixed(4)}`)
  }
  console.log('\nLigne "0 %" = modèle actuel de l\'app. Un gain vaut la peine s\'il se répète sur plusieurs championnats.')
}
run().catch(e => { console.error('Erreur :', e.message); process.exit(1) })
