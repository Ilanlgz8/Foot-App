// Proxy serveur vers api-football.com (v3.football.api-sports.io)
// La clé APIFOOTBALL_KEY est ajoutée côté serveur — jamais envoyée au navigateur.
// Retransmet x-quota-remaining pour que le client puisse gérer le fallback.

exports.handler = async (event) => {
  try {
    const qs = event.rawQuery ? `?${event.rawQuery}` : ''
    const url = `https://v3.football.api-sports.io/fixtures${qs}`

    const res = await fetch(url, {
      headers: {
        'x-apisports-key': process.env.APIFOOTBALL_KEY,
      },
    })

    const body = await res.text()
    const remaining = res.headers.get('x-ratelimit-requests-remaining') ?? null

    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        ...(remaining !== null ? { 'x-quota-remaining': remaining } : {}),
      },
      body,
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
