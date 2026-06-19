// Proxy football-data.org (backup — non utilisé en prod, remplacé par api/v4/[...path].js)
export default async function handler(req, res) {
  try {
    const { apiPath, ...rest } = req.query
    const path = apiPath ?? '/'
    const qs   = new URLSearchParams(rest).toString()
    const url  = `https://api.football-data.org${path}${qs ? '?' + qs : ''}`

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
