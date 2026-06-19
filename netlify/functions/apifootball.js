// Proxy serveur vers api-football.com (v3.football.api-sports.io)
// La clé APIFOOTBALL_KEY est ajoutée côté serveur — jamais envoyée au navigateur.
// Retransmet x-quota-remaining pour que le client puisse gérer le fallback.
//
// Paramètre spécial : _ep=<endpoint> (ex: fixtures/lineups, fixtures/headtohead, predictions)
// Si absent, l'endpoint par défaut est "fixtures" (compatibilité ascendante).

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters ?? {}

    // Extraire l'endpoint et construire les params restants
    const { _ep, ...rest } = qs
    const endpoint = _ep ?? 'fixtures'

    // Valider l'endpoint (sécurité basique)
    if (!/^[a-z0-9/_-]+$/i.test(endpoint)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid endpoint' }) }
    }

    const queryStr = new URLSearchParams(rest).toString()
    const url = `https://v3.football.api-sports.io/${endpoint}${queryStr ? `?${queryStr}` : ''}`

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
