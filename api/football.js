// Proxy serveur vers football-data.org
// La clé API est ajoutée ici, côté serveur — jamais envoyée au navigateur.
//
// En prod (Vercel) : appelé via le rewrite /api/v4/:path* → /api/football?apiPath=/v4/:path*
// En dev local : le proxy Vite gère directement /api/* (voir vite.config.js)

module.exports = async (req, res) => {
  try {
    const { apiPath, ...rest } = req.query
    const path = apiPath ?? '/'
    const qs   = new URLSearchParams(rest).toString()
    const url  = `https://api.football-data.org${path}${qs ? '?' + qs : ''}`

    const response = await fetch(url, {
      headers: { 'X-Auth-Token': process.env.API_KEY },
    })

    const body = await response.text()
    res
      .status(response.status)
      .setHeader('Content-Type', 'application/json')
      .send(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
