// Proxy football-data.org — catch-all Vercel pour /api/v4/**
export default async function handler(req, res) {
  try {
    const { path: segments, ...rest } = req.query
    const parts   = Array.isArray(segments) ? segments : [segments]
    const apiPath = '/v4/' + parts.join('/')
    const qs      = new URLSearchParams(rest).toString()
    const url     = `https://api.football-data.org${apiPath}${qs ? '?' + qs : ''}`

    const response = await fetch(url, {
      headers: { 'X-Auth-Token': process.env.API_KEY ?? '' },
    })

    const body = await response.text()
    res.status(response.status)
       .setHeader('Content-Type', 'application/json')
       .send(body)
  } catch (err) {
    console.error('[football proxy]', err)
    res.status(500).json({ error: err.message })
  }
}
