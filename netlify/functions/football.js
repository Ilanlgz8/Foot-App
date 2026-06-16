// Proxy serveur vers football-data.org
// La clé API est ajoutée ici, côté serveur — jamais envoyée au navigateur

exports.handler = async (event) => {
  try {
    // event.path = "/api/v4/competitions/PL/matches" (chemin original avant la redirection)
    const apiPath = event.path.replace(/^\/api/, '') // "/v4/competitions/PL/matches"
    const qs = event.rawQuery ? `?${event.rawQuery}` : ''
    const url = `https://api.football-data.org${apiPath}${qs}`

    const res = await fetch(url, {
      headers: { 'X-Auth-Token': process.env.API_KEY }
    })

    const body = await res.text()

    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body,
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
