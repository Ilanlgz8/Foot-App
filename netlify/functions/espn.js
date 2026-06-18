// Proxy vers l'API non-officielle ESPN (site.api.espn.com)
// Pas de clé API requise — utilisé pour les scores live et l'historique daté.
// Paramètres attendus :
//   ?slug=fra.1               → matchs du jour pour cette compétition
//   ?slug=fra.1&dates=20250617 → matchs de la date YYYYMMDD (pour les matchs non suivis en live)

exports.handler = async (event) => {
  const slug  = event.queryStringParameters?.slug
  const dates = event.queryStringParameters?.dates

  if (!slug) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Paramètre slug manquant' }) }
  }

  const ALLOWED_SLUGS = new Set([
    'fra.1', 'eng.1', 'esp.1', 'ger.1', 'ita.1',
    'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
    'fifa.world',
  ])

  if (!ALLOWED_SLUGS.has(slug)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Slug non autorisé' }) }
  }

  if (dates && !/^\d{8}$/.test(dates)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Format dates invalide (YYYYMMDD attendu)' }) }
  }

  // Timeout explicite à 8s pour éviter que Netlify kill la fonction avec un 504 brutal
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)

  try {
    const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`
    
    const url  = dates ? `${base}?dates=${dates}` : base

    const res = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: `ESPN a répondu ${res.status}` }) }
    }

    const body = await res.text()
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
      body,
    }
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      return { statusCode: 504, body: JSON.stringify({ error: 'ESPN timeout (>8s)' }) }
    }
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
