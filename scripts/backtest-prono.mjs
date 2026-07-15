#!/usr/bin/env node
// scripts/backtest-prono.mjs
//
// Backtest / calibration du modèle de pronostic (calcPronoAdvanced) contre
// de VRAIS résultats passés — pour répondre à une question honnête restée
// sans réponse jusqu'ici : "quand le modèle dit 60%, l'équipe gagne
// vraiment ~60% du temps ?" On avait des tests unitaires qui vérifient la
// cohérence interne du calcul (ça somme à 100%, le favori est favorisé),
// mais rien qui le compare à des résultats réels. C'est ce script qui
// comble ce trou.
//
// Usage (via vite-node, PAS node directement — les imports du projet
// n'ont pas d'extension .js, ex. import ... from './matchUtils', ce que
// Vite résout mais que le Node natif refuse en ESM strict ; vite-node
// applique la même résolution que Vite/l'app elle-même) :
//   npx vite-node scripts/backtest-prono.mjs [compCode] [season]
//   npx vite-node scripts/backtest-prono.mjs PL 2024
//   npx vite-node scripts/backtest-prono.mjs FR1 2023
//
// Par défaut : PL (Premier League), saison en cours - 1 (saison complète,
// terminée, pour avoir un vrai jeu de test).
//
// ⚠️ Appelle football-data.org DIRECTEMENT (pas via /api/football, le proxy
// Vercel de l'app) — volontaire : le proxy a un budget global de 7 req/min
// PARTAGÉ avec tous les utilisateurs réels de l'app (voir api/football.js),
// le hammer depuis un script de dev risquerait de dégrader l'app en
// production. Ici, un seul call direct à football-data.org (leur endpoint
// /matches renvoie toute une saison en une réponse, pas de pagination
// nécessaire) reste largement sous leur quota free tier (10/min) sans
// aucun risque pour la prod.
//
// Nécessite la clé API football-data.org dans l'environnement (une clé
// existe déjà en local sous API_KEY dans .env.local — repris automatiquement
// si présent) :
//   FOOTBALL_DATA_API_KEY=xxxx npx vite-node scripts/backtest-prono.mjs
// ou simplement, si .env.local est déjà rempli :
//   npx vite-node scripts/backtest-prono.mjs

import { readFileSync } from 'node:fs'
import { calcProno, calcPronoAdvanced } from '../src/utils/calcProno.js'
import { finalScore, outcomeForTeam } from '../src/utils/matchUtils.js'

// Charge .env.local à la main (pas de dépendance dotenv à ajouter juste
// pour ce script) — ne remplace jamais une variable déjà présente dans
// l'environnement (une variable exportée manuellement reste prioritaire).
try {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
  }
} catch {}

const API_KEY = process.env.FOOTBALL_DATA_API_KEY || process.env.API_KEY
if (!API_KEY) {
  console.error('Clé API manquante — export FOOTBALL_DATA_API_KEY=... (ou API_KEY, voir .env.local) avant de lancer ce script.')
  process.exit(1)
}

const compCode = process.argv[2] || 'PL'
const season   = process.argv[3] || String(new Date().getFullYear() - 1)

// ── Fetch ────────────────────────────────────────────────────────────────
async function fetchSeason(code, yr) {
  const url = `https://api.football-data.org/v4/competitions/${code}/matches?season=${yr}`
  const res = await fetch(url, { headers: { 'X-Auth-Token': API_KEY } })
  if (!res.ok) {
    throw new Error(`football-data.org a répondu ${res.status} — vérifie le code compétition/saison ou le quota de la clé.`)
  }
  const json = await res.json()
  return json.matches ?? []
}

// Forme récente (5 derniers résultats W/D/L) d'une équipe, calculée
// UNIQUEMENT à partir de matchs strictement antérieurs à `beforeDate` —
// sans ça, le "backtest" trahirait en donnant au modèle des infos qu'il
// n'aurait jamais eues au moment réel du match (biais de anticipation).
function recentForm(teamId, priorMatches, beforeDate) {
  return priorMatches
    .filter(m => m.status === 'FINISHED' && new Date(m.utcDate) < beforeDate
      && (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId))
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    .slice(0, 5)
    .map(m => outcomeForTeam(m, teamId))
    .filter(Boolean)
    .reverse()
}

function actualOutcome(match) {
  const fs = finalScore(match.score)
  if (fs.home == null || fs.away == null) return null
  if (fs.home > fs.away) return 'home'
  if (fs.home < fs.away) return 'away'
  return 'draw'
}

// ── Backtest ─────────────────────────────────────────────────────────────
async function run() {
  console.log(`Récupération de ${compCode} saison ${season}...`)
  const all = await fetchSeason(compCode, season)
  const finished = all
    .filter(m => m.status === 'FINISHED')
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))

  console.log(`${finished.length} matchs terminés trouvés.\n`)

  let brierSum = 0
  let nScored  = 0
  let correctFavorite = 0
  // Calibration : 10 tranches de probabilité (0-10%, 10-20%, ... 90-100%)
  // pour l'issue "domicile gagne" — dans chaque tranche, la fréquence
  // réelle de victoires domicile devrait être proche du milieu de la
  // tranche si le modèle est bien calibré.
  const buckets = Array.from({ length: 10 }, () => ({ predictedSum: 0, actualWins: 0, n: 0 }))
  let fellBackToBase = 0

  for (const match of finished) {
    const homeId = match.homeTeam?.id
    const awayId = match.awayTeam?.id
    if (homeId == null || awayId == null) continue

    const actual = actualOutcome(match)
    if (!actual) continue

    const matchDate = new Date(match.utcDate)
    const priorMatches = finished.filter(m => new Date(m.utcDate) < matchDate)
    // Pas assez d'historique pour ce match précis → on saute (même seuil
    // que MIN_LEAGUE_GAMES en interne, calcPronoAdvanced retomberait sur
    // calcProno de toute façon, moins intéressant à évaluer ici).
    if (priorMatches.length < 10) continue

    const hForm = recentForm(homeId, finished, matchDate)
    const aForm = recentForm(awayId, finished, matchDate)

    const before = calcProno(hForm, aForm)
    const pred   = calcPronoAdvanced(homeId, awayId, priorMatches, hForm, aForm)
    if (pred.home === before.home && pred.draw === before.draw && pred.away === before.away) {
      fellBackToBase++
    }

    // Brier score multi-classe : somme des (prédit - réel)^2 sur les 3 issues.
    const p = { home: pred.home / 100, draw: pred.draw / 100, away: pred.away / 100 }
    const a = { home: actual === 'home' ? 1 : 0, draw: actual === 'draw' ? 1 : 0, away: actual === 'away' ? 1 : 0 }
    brierSum += (p.home - a.home) ** 2 + (p.draw - a.draw) ** 2 + (p.away - a.away) ** 2
    nScored++

    const favorite = pred.home >= pred.draw && pred.home >= pred.away ? 'home'
      : pred.away >= pred.draw ? 'away' : 'draw'
    if (favorite === actual) correctFavorite++

    const bucketIdx = Math.min(9, Math.floor(pred.home / 10))
    buckets[bucketIdx].predictedSum += pred.home
    buckets[bucketIdx].actualWins   += actual === 'home' ? 1 : 0
    buckets[bucketIdx].n++
  }

  if (nScored === 0) {
    console.log('Pas assez de matchs avec historique suffisant pour évaluer — essaie une saison/compétition avec plus de données.')
    return
  }

  console.log(`── Résultat sur ${nScored} matchs évalués (${fellBackToBase} ont dû retomber sur le modèle de base, pas assez de données saison) ──\n`)
  console.log(`Brier score (multi-classe) : ${(brierSum / nScored).toFixed(4)}`)
  console.log(`  Repères : 0 = parfait, 0.667 = un modèle "33/33/33 toujours" (aucune info), plus bas = mieux.\n`)
  console.log(`Favori du modèle a gagné : ${((correctFavorite / nScored) * 100).toFixed(1)}% des matchs\n`)

  console.log('Calibration (issue "domicile gagne") — % prédit moyen vs % réel observé par tranche :')
  console.log('tranche     n   % prédit moyen   % réel observé   écart')
  buckets.forEach((b, i) => {
    if (b.n === 0) return
    const predAvg = b.predictedSum / b.n
    const realPct = (b.actualWins / b.n) * 100
    const gap = realPct - predAvg
    console.log(
      `${String(i * 10).padStart(3)}-${String(i * 10 + 10).padEnd(3)}%  ${String(b.n).padStart(3)}   `
      + `${predAvg.toFixed(1).padStart(6)}%          ${realPct.toFixed(1).padStart(6)}%        `
      + `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}`
    )
  })
  console.log('\nSi "% réel observé" colle bien à "% prédit moyen" tranche par tranche, le modèle est bien calibré.')
  console.log('Un écart systématique dans un sens (toujours + ou toujours -) indiquerait un biais à corriger.')
}

run().catch(e => { console.error('Erreur :', e.message); process.exit(1) })
