// Proxy football-data.org
// Appelé via /api/football?apiPath=/v4/PATH&...query params...
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

    const body = await response.text()
    res.status(response.status)
       .setHeader('Content-Type', 'application/json')
       .send(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
