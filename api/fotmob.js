// Proxy FotMob — utilisé uniquement pour les xG live.
// ?date=YYYYMMDD  → scoreboard du jour (pour trouver l'ID FotMob)
// ?matchId=XXX    → détails du match (xG inclus)

const FOTMOB_BASE = 'https://www.fotmob.com/api'

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Referer':         'https://www.fotmob.com/',
  'Origin':          'https://www.fotmob.com',
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { date, matchId } = req.query

  if (!date && !matchId) return res.status(400).json({ error: 'Paramètre date ou matchId requis' })
  if (date   && !/^\d{8}$/.test(date))         return res.status(400).json({ error: 'Format date invalide (YYYYMMDD)' })
  if (matchId && !/^\d+$/.test(matchId))        return res.status(400).json({ error: 'matchId invalide' })

  const url = date
    ? `${FOTMOB_BASE}/matches?date=${date}`
    : `${FOTMOB_BASE}/matchDetails?matchId=${matchId}`

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)

  try {
    const r = await fetch(url, { headers: HEADERS, signal: controller.signal })
    clearTimeout(timeoutId)

    if (!r.ok) return res.status(r.status).json({ error: `FotMob a répondu ${r.status}` })

    const body = await r.text()
    res.status(200)
       .setHeader('Content-Type', 'application/json')
       .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, s-maxage=0')
       .setHeader('Pragma', 'no-cache')
       .send(body)
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'FotMob timeout (>8s)' })
    res.status(500).json({ error: err.message })
  }
}
