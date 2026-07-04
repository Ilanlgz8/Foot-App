// api/espn-assists.js
// Classement des passes décisives — source ESPN (remplace api-football).
//
// Contexte : api-football expose bien un endpoint dédié /players/topassists,
// mais son plan gratuit ne couvre pas la saison en cours (2025/2026 refusés,
// "try from 2022 to 2024") — inutilisable pour un classement à jour tant que
// le compte n'est pas passé sur un plan payant. ESPN a la même donnée (page
// publique espn.com/soccer/stats/_/league/{slug}, tableau "Top Assists"
// séparé des buteurs, à jour) mais SANS API JSON publique trouvée pour cette
// donnée précise côté ESPN (contrairement au reste de l'app qui utilise déjà
// leurs vraies APIs JSON) — on doit donc lire/parser cette page HTML.
//
// ⚠️ Fragilité assumée et acceptée explicitement par l'utilisateur : si ESPN
// change la structure de sa page stats, ce parseur peut casser silencieusement
// (renverra alors une liste vide plutôt qu'une erreur bruyante — déjà géré
// gracieusement côté UI, voir Classement.jsx qui masque l'onglet Passeurs
// quand la source ne renvoie rien).
//
// Slugs ESPN identiques à COMPETITION_ESPN_SLUG (src/data/competitions.js) —
// on revalide quand même côté serveur contre une allowlist fixe plutôt que
// de faire confiance à un paramètre de requête ouvert (évite qu'un appelant
// externe force ce proxy à fetcher une URL ESPN arbitraire).
import { Redis } from '@upstash/redis'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

const ALLOWED_SLUGS = new Set([
  'fra.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1', 'uefa.champions', 'fifa.world',
])

const CACHE_TTL = 6 * 3600 // 6h — ESPN indique "Statistics are updated nightly"

// ── Extraction générique d'une table stats ESPN (Top Scorers / Top Assists) ──
// Cible d'abord de vraies balises <tr>/<td> (cas attendu si la page est
// rendue côté serveur avec un tableau HTML classique). Chaque ligne valide
// doit contenir un lien joueur + un lien équipe + au moins 2 cellules
// numériques (P puis la dernière stat de la colonne, buts ou passes selon
// la table).
function extractRows(sectionHtml) {
  const rows = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch
  while ((trMatch = trRe.exec(sectionHtml))) {
    const rowHtml = trMatch[1]
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1])
    if (cells.length < 4) continue

    const nameCell = cells.find(c => /\/soccer\/player\/_\/id\//.test(c))
    const teamCell = cells.find(c => /\/soccer\/(?:team|club)\/_\/id\//.test(c))
    if (!nameCell || !teamCell) continue

    const playerMatch = nameCell.match(/\/soccer\/player\/_\/id\/(\d+)\/[a-z0-9-]+"[^>]*>([^<]+)</i)
    const teamMatch    = teamCell.match(/\/soccer\/(?:team|club)\/_\/id\/(\d+)\/[a-z0-9-]+"[^>]*>([^<]+)</i)
    if (!playerMatch || !teamMatch) continue

    // Dernières cellules numériques de la ligne (P puis G ou A selon la table)
    const numericCells = cells
      .map(c => c.replace(/<[^>]+>/g, '').trim())
      .filter(c => /^\d+$/.test(c))
    if (numericCells.length < 2) continue
    const played = parseInt(numericCells[numericCells.length - 2], 10)
    const stat    = parseInt(numericCells[numericCells.length - 1], 10)

    rows.push({
      playerId:   playerMatch[1],
      playerName: playerMatch[2].trim(),
      teamId:     teamMatch[1],
      teamName:   teamMatch[2].trim(),
      played,
      stat,
    })
  }
  return rows
}

function sliceSection(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker)
  if (start === -1) return ''
  const endSearchFrom = start + startMarker.length
  const end = endMarker ? html.indexOf(endMarker, endSearchFrom) : -1
  return end === -1 ? html.slice(start) : html.slice(start, end)
}

async function fetchAndParse(slug) {
  const url = `https://www.espn.com/soccer/stats/_/league/${slug}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`ESPN stats ${res.status}`)
  const html = await res.text()

  const scorersHtml = sliceSection(html, 'Top Scorers', 'Top Assists')
  const assistsHtml = sliceSection(html, 'Top Assists', 'Glossary')

  const scorerRows = extractRows(scorersHtml)
  const assistRows = extractRows(assistsHtml)

  const goalsByPlayerId = {}
  for (const r of scorerRows) goalsByPlayerId[r.playerId] = r.stat

  const response = assistRows
    .filter(r => r.stat > 0)
    .map(r => ({
      player: { id: r.playerId, name: r.playerName },
      team:   { id: r.teamId, name: r.teamName, shortName: r.teamName, crest: null },
      goals:   goalsByPlayerId[r.playerId] ?? 0,
      assists: r.stat,
    }))
    .sort((a, b) => (b.assists - a.assists) || (b.goals - a.goals))

  return response
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  const slug = String(req.query.slug ?? '')
  if (!ALLOWED_SLUGS.has(slug)) {
    return res.status(400).json({ error: 'Compétition non supportée' })
  }

  const cacheKey = `espnAssists:${slug}`
  try {
    const cached = await kv.get(cacheKey)
    if (cached) {
      res.setHeader('x-cache', 'HIT')
      return res.status(200).json({ response: typeof cached === 'string' ? JSON.parse(cached) : cached })
    }
  } catch { /* Redis down → continue */ }

  try {
    const response = await fetchAndParse(slug)
    try { await kv.set(cacheKey, JSON.stringify(response), { ex: CACHE_TTL }) } catch {}
    res.setHeader('x-cache', 'MISS')
    return res.status(200).json({ response })
  } catch (err) {
    return res.status(200).json({ errors: { espn: err.message }, response: [] })
  }
}
