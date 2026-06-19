// Proxy vers l'API non-officielle SofaScore (api.sofascore.com)
// Pas de clé API requise — injecte les headers navigateur pour éviter les blocages.
// Paramètre attendu :
//   ?path=sport/football/scheduled-events/2024-12-15
//   ?path=event/12345678/lineups
//   ?path=event/12345678/statistics
//   ?path=event/12345678/momentum
//   ?path=event/12345678/h2h
//   ?path=event/12345678/odds/1/all

exports.handler = async (event) => {
  const path = event.queryStringParameters?.path

  if (!path) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Paramètre path manquant' }) }
  }

  // Valider le chemin : alphanumérique + / - _ .
  if (!/^[a-zA-Z0-9\/\-_.]+$/.test(path)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Chemin invalide' }) }
  }

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)

  try {
    const url = `https://api.sofascore.com/api/v1/${path}`

    const res = await fetch(url, {
      headers: {
        'User-Agent':       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer':          'https://www.sofascore.com/',
        'Origin':           'https://www.sofascore.com',
        'Accept':           'application/json, text/plain, */*',
        'Accept-Language':  'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control':    'no-cache',
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: `SofaScore a répondu ${res.status}` }) }
    }

    const body = await res.text()
    return {
      statusCode: 200,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'public, max-age=30',
      },
      body,
    }
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      return { statusCode: 504, body: JSON.stringify({ error: 'SofaScore timeout (>8s)' }) }
    }
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
