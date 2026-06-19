// Proxy football-data.org — catch-all Vercel pour /api/v4/**
export default async function handler(req, res) {
  try {
    const { path: segments } = req.query
    const parts   = Array.isArray(segments) ? segments : [segments]
    const apiPath = '/' + parts.join('/')

    // Utiliser le query string brut de req.url pour éviter le re-encodage des virgules
    // (new URLSearchParams encoderait competitions=CL,PL → CL%2CPL, rejeté par football-data.org)
    const qsStart = (req.url ?? '').indexOf('?')
    const qs      = qsStart >= 0 ? req.url.slice(qsStart) : ''
    const url     = `https://api.football-data.org${apiPath}${qs}`

    console.log('[fd-proxy] req.url:', req.url)
    console.log('[fd-proxy] apiPath:', apiPath, '| qs:', qs)
    console.log('[fd-proxy] API_KEY set:', !!process.env.API_KEY)
    console.log('[fd-proxy] target:', url)

    if (!process.env.API_KEY) {
      return res.status(500).json({ error: 'API_KEY not configured on Vercel' })
    }

    const response = await fetch(url, {
      headers: { 'X-Auth-Token': process.env.API_KEY },
    })

    console.log('[fd-proxy] status:', response.status)

    const body = await response.text()
    res.status(response.status)
       .setHeader('Content-Type', 'application/json')
       .send(body)
  } catch (err) {
    console.error('[fd-proxy] ERROR:', err)
    res.status(500).json({ error: err.message })
  }
}
