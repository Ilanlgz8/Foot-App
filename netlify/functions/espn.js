// Proxy vers l'API non-officielle ESPN (site.api.espn.com)
// Pas de clé API requise — utilisé pour les scores live et l'historique daté.
// Paramètres attendus :
//   ?slug=fra.1               → matchs du jour pour cette compétition
//   ?slug=fra.1&dates=20250617 → matchs de la date YYYYMMDD (pour les matchs non suivis en live)

exports.handler = async (event) => {
  const slug  = event.queryStringParameters?.slug
  const dates = event.queryStringParameters?.dates  // optionnel : YYYYMMDD

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

  // Valider le format dates si présent (YYYYMMDD, 8 chiffres) — évite toute injection
  if (dates && !/^\d{8}$/.test(dates)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Format dates invalide (YYYYMMDD attendu)' }),
    }
  }

  try {
    const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`
    // Cache-busting côté ESPN : évite que leur CDN ou le nôtre serve une réponse périmée
    const bust = `_cb=${Date.now()}`
    const url  = dates ? `${base}?dates=${dates}&${bust}` : `${base}?${bust}`
    const res  = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    })

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: `ESPN a répondu ${res.status}` }),
      }
    }

    const body = await res.text()
    return {
      statusCode: 200,
      // Interdire tout cache CDN/navigateur — les scores live changent en continu
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
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
