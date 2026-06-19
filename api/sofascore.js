// Proxy SofaScore — headers navigateur pour éviter les blocages
export default async function handler(req, res) {
  const path = req.query.path

  if (!path) return res.status(400).json({ error: 'Paramètre path manquant' })
  if (!/^[a-zA-Z0-9\/\-_.]+$/.test(path)) return res.status(400).json({ error: 'Chemin invalide' })

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)

  try {
    const url = `https://api.sofascore.com/api/v1/${path}`

    const response = await fetch(url, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer':         'https://www.sofascore.com/',
        'Origin':          'https://www.sofascore.com',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Cache-Control':   'no-cache',
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) return res.status(response.status).json({ error: `SofaScore a répondu ${response.status}` })

    const body = await response.text()
    res.status(200)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'public, max-age=30')
       .send(body)
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'SofaScore timeout (>8s)' })
    res.status(500).json({ error: err.message })
  }
}
