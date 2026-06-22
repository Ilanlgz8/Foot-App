// Proxy football-data.org
// Appelé via /api/football?apiPath=/v4/PATH&...query params...
//
// Cache Vercel edge (s-maxage) par type d'endpoint :
//   FINISHED matches  → 5min  (aligné sur la grace period du widget live)
//   Standings         → 10min (change 1x/jour max)
//   Scorers           → 30min
//   Today's matches   → 60s   (statuts live)
//   SCHEDULED/TIMED   → 5min  (calendrier stable)
//   Match detail      → 1h    (données immuables post-FT)
//   IN_PLAY/PAUSED    → no-store (géré par ESPN/FIFA)

function getCacheControl(fdPath, qs) {
  // Live — pas de cache
  if (qs.includes('status=IN_PLAY') || qs.includes('status=PAUSED')) {
    return 'no-store'
  }
  // Détail d'un match unique — immutable après FT
  if (/^\/v4\/matches\/\d+$/.test(fdPath) && !qs) {
    return 'public, s-maxage=3600, stale-while-revalidate=600'
  }
  // Résultats terminés — 5min (grace period widget live)
  if (qs.includes('status=FINISHED')) {
    return 'public, s-maxage=300, stale-while-revalidate=600'
  }
  // Classements — 10min
  if (fdPath.includes('/standings')) {
    return 'public, s-maxage=600, stale-while-revalidate=120'
  }
  // Buteurs — 30min
  if (fdPath.includes('/scorers')) {
    return 'public, s-maxage=1800, stale-while-revalidate=300'
  }
  // Matchs du jour (plage dateFrom/dateTo) — 60s
  if (qs.includes('dateFrom=') && qs.includes('dateTo=')) {
    return 'public, s-maxage=60, stale-while-revalidate=120'
  }
  // Matchs à venir — 5min
  if (qs.includes('status=SCHEDULED') || qs.includes('status=TIMED')) {
    return 'public, s-maxage=300, stale-while-revalidate=60'
  }
  // Head-to-head et autres — 2min
  return 'public, s-maxage=120, stale-while-revalidate=60'
}

export default async function handler(req, res) {
  // GET uniquement — on ne proxifie pas de mutations vers FD.org avec notre clé API
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  try {
    const { apiPath } = req.query
    const fdPath = apiPath ?? '/'

    // Préserver le query string brut pour éviter le re-encodage des virgules
    // (new URLSearchParams encoderait competitions=CL,PL → CL%2CPL)
    const rawQs = (req.url ?? '').split('?')[1] ?? ''
    const qs = rawQs
      .split('&')
      .filter(p => p && !p.startsWith('apiPath='))
      .join('&')

    const url = `https://api.football-data.org${fdPath}${qs ? '?' + qs : ''}`

    const response = await fetch(url, {
      headers: { 'X-Auth-Token': process.env.API_KEY ?? '' },
    })

    const body      = await response.text()
    const cc        = getCacheControl(fdPath, qs)
    res.status(response.status)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', cc)
       .send(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
