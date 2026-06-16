// Proxy vers l'API non-officielle ESPN (site.api.espn.com)
// Pas de clé API requise — utilisé uniquement pour les scores live en temps réel.
// Paramètre attendu : ?slug=fra.1 (ou eng.1, esp.1, ger.1, ita.1, uefa.champions, fifa.world)

exports.handler = async (event) => {
  const slug = event.queryStringParameters?.slug
  if (!slug) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Paramètre slug manquant' }),
    }
  }

  // Whitelist des slugs autorisés (sécurité minimale)
  const ALLOWED_SLUGS = new Set([
    'fra.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1',
    'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
    'fifa.world',
  ])

  if (!ALLOWED_SLUGS.has(slug)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Slug non autorisé' }),
    }
  }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`
    const res = await fetch(url)

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: `ESPN a répondu ${res.status}` }),
      }
    }

    const body = await res.text()
    return {
      statusCode: 200,
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
