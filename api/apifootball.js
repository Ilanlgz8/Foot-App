// Proxy serveur vers api-football.com (v3.football.api-sports.io)
// La clé APIFOOTBALL_KEY est ajoutée côté serveur — jamais envoyée au navigateur.
// Paramètre spécial : _ep=<endpoint> (ex: fixtures, fixtures/lineups, predictions)
// Si absent, l'endpoint par défaut est "fixtures".

module.exports = async (req, res) => {
  try {
    const { _ep, ...rest } = req.query
    const endpoint = _ep ?? 'fixtures'

    if (!/^[a-z0-9/_-]+$/i.test(endpoint)) {
      return res.status(400).json({ error: 'Invalid endpoint' })
    }

    const queryStr = new URLSearchParams(rest).toString()
    const url = `https://v3.football.api-sports.io/${endpoint}${queryStr ? `?${queryStr}` : ''}`

    const response = await fetch(url, {
      headers: { 'x-apisports-key': process.env.APIFOOTBALL_KEY },
    })

    const body      = await response.text()
    const remaining = response.headers.get('x-ratelimit-requests-remaining') ?? null

    res.status(response.status)
      .setHeader('Content-Type', 'application/json')

    if (remaining !== null) res.setHeader('x-quota-remaining', remaining)

    res.send(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
