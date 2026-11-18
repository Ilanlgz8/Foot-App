// Mémoire de la cote d'avant-match de chaque match (19/11) — point de départ du direct.
// Module à part (aucune dépendance) : utilisé par useMatchOdds (calcul) et useLiveMinute (cote
// publiée par le Worker), sans tirer tout le code des pages de match dans le démarrage de l'app.
// ── Mémoire partagée de la dernière cote de marché d'avant-match ─────────────────────────────────
const LS_KEY = 'sf_pregameOdds'
const KEEP_MS = 2 * 24 * 3600 * 1000
let memo = null
function store() {
  if (memo) return memo
  memo = {}
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      const now = Date.now()
      for (const [id, v] of Object.entries(raw)) if (v?.at && now - v.at < KEEP_MS) memo[id] = v
    }
  } catch { /* stockage indisponible : mémoire seule */ }
  return memo
}
// source : 'display' = cote AFFICHÉE avant le match sur ce téléphone (référence, toujours prioritaire),
// 'server' = cote d'avant-match relevée par le Worker (`po`, la même pour toutes les apps),
// 'fallback' = cote de marché lue après le coup d'envoi (dernier recours, remplacée par 'server').
const RANK = { fallback: 0, server: 1, display: 2 }
export function rememberPregameOdds(matchId, odds, source = 'display') {
  if (!matchId || !odds?.pct) return
  const s = store()
  const prev = s[matchId]
  if (prev && (RANK[prev.source ?? 'display'] ?? 2) > (RANK[source] ?? 2)) return
  if (prev && prev.source === source && prev.pct?.home === odds.pct.home && prev.pct?.away === odds.pct.away
      && prev.pct?.draw === odds.pct.draw && prev.decimal?.home === odds.decimal?.home) return
  s[matchId] = { pct: odds.pct, decimal: odds.decimal ?? null, source, at: Date.now() }
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* plein : mémoire seule */ }
}
// Cote d'avant-match publiée par le Worker : [domicile, nul, extérieur] en cotes décimales.
export function rememberServerPregameOdds(matchId, po) {
  if (!Array.isArray(po) || po.length !== 3 || po.some(x => !(x > 1))) return
  const [h, d, a] = po
  const ph = 1 / h, pd = 1 / d, pa = 1 / a, sum = ph + pd + pa
  rememberPregameOdds(matchId, {
    pct: { home: (ph / sum) * 100, draw: (pd / sum) * 100, away: (pa / sum) * 100 },
    decimal: { home: h, draw: d, away: a },
  }, 'server')
}
export function recallPregamePct(matchId) {
  return store()[matchId]?.pct ?? null
}
export function recallPregame(matchId) {
  return store()[matchId] ?? null
}

