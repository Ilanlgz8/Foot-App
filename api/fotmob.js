// Proxy FotMob — utilisé uniquement pour les xG live.
// ?date=YYYYMMDD  → scoreboard du jour (pour trouver l'ID FotMob)
// ?matchId=XXX    → détails du match (xG inclus)
//
// Mode diagnostic (xG invisible en live, signalé par l'utilisateur) :
// ?debug=1&secret=CRON_SECRET en plus de date ou matchId → au lieu du passthrough
// brut, renvoie le statut HTTP réel de FotMob, un extrait du corps, la liste des
// matchs/équipes trouvés (date) ou le résultat de extractXG (matchId). Pas de
// fonction serverless séparée (limite 12 fonctions sur le plan Hobby Vercel déjà
// atteinte) — ce mode vit dans ce fichier existant. À retirer une fois le
// diagnostic terminé si on veut nettoyer.

const FOTMOB_BASE = 'https://www.fotmob.com/api'

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Referer':         'https://www.fotmob.com/',
  'Origin':          'https://www.fotmob.com',
}

function normTeam(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|afc|cf|sc|sporting|club|united|city|real|atletico|athletico|manchester|paris|saint)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractXGDebug(data) {
  const attempts = []

  const teams = data?.header?.teams ?? []
  const hXg1 = parseFloat(teams[0]?.xg)
  const aXg1 = parseFloat(teams[1]?.xg)
  attempts.push({ path: 'header.teams[].xg', found: !isNaN(hXg1) && !isNaN(aXg1), home: teams[0]?.xg, away: teams[1]?.xg })

  const statGroups = data?.content?.stats?.Periods?.All?.stats ?? []
  let path2Found = null
  for (const s of statGroups) {
    const title = (s.title ?? s.type ?? '').toLowerCase()
    if (title.includes('expected') || title.includes('xg')) {
      path2Found = { title: s.title ?? s.type, homeValue: s.homeValue ?? s.home, awayValue: s.awayValue ?? s.away }
    }
  }
  attempts.push({ path: 'content.stats.Periods.All.stats', found: !!path2Found, detail: path2Found, statGroupTitles: statGroups.map(s => s.title ?? s.type) })

  const ib = data?.content?.matchFacts?.infoBox?.expectedGoals
  attempts.push({ path: 'content.matchFacts.infoBox.expectedGoals', found: !!ib, detail: ib ?? null })

  return attempts
}

async function handleDebug(req, res, date, matchId) {
  const secret = req.headers['x-cron-secret'] ?? req.query.secret ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' })
  }

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)

  try {
    if (date) {
      const isoDate = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`
      const urlsToTry = [
        `${FOTMOB_BASE}/matches?date=${date}`,
        `${FOTMOB_BASE}/matches?date=${isoDate}`,
      ]
      const results = []
      for (const url of urlsToTry) {
        try {
          const r = await fetch(url, { headers: HEADERS, signal: controller.signal })
          const bodyText = await r.text()
          let parsed = null
          try { parsed = JSON.parse(bodyText) } catch {}
          const leagues = parsed?.leagues ?? []
          const allMatches = leagues.flatMap(l => (l.matches ?? []).map(m => ({
            id: m.id,
            home: m.home?.longName ?? m.home?.name ?? null,
            away: m.away?.longName ?? m.away?.name ?? null,
            homeNorm: normTeam(m.home?.longName ?? m.home?.name ?? ''),
            awayNorm: normTeam(m.away?.longName ?? m.away?.name ?? ''),
          })))
          results.push({
            url, httpStatus: r.status, ok: r.ok,
            bodySnippet: bodyText.slice(0, 300),
            leaguesCount: leagues.length,
            matchesFound: allMatches.length,
            matches: allMatches.slice(0, 40),
          })
          if (r.ok) break
        } catch (e) {
          results.push({ url, error: e.message })
        }
      }
      clearTimeout(timeoutId)
      return res.status(200).json({ ok: true, mode: 'matches', date, results })
    }

    const url = `${FOTMOB_BASE}/matchDetails?matchId=${matchId}`
    const r = await fetch(url, { headers: HEADERS, signal: controller.signal })
    const bodyText = await r.text()
    clearTimeout(timeoutId)
    let parsed = null
    try { parsed = JSON.parse(bodyText) } catch {}
    const xgAttempts = parsed ? extractXGDebug(parsed) : null
    return res.status(200).json({
      ok: true, mode: 'matchDetails', matchId,
      httpStatus: r.status, httpOk: r.ok,
      bodySnippet: bodyText.slice(0, 500),
      xgAttempts,
    })
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'FotMob timeout (>8s)' })
    return res.status(500).json({ error: err.message })
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { date, matchId, debug } = req.query

  if (!date && !matchId) return res.status(400).json({ error: 'Paramètre date ou matchId requis' })
  if (date   && !/^\d{8}$/.test(date))         return res.status(400).json({ error: 'Format date invalide (YYYYMMDD)' })
  if (matchId && !/^\d+$/.test(matchId))        return res.status(400).json({ error: 'matchId invalide' })

  if (debug) return handleDebug(req, res, date, matchId)

  // FotMob accepte deux formats de date selon la version de l'API :
  // - YYYYMMDD (ancien)  → /api/matches?date=20260625
  // - YYYY-MM-DD (nouveau) → /api/matches?date=2026-06-25
  // On essaie les deux si le premier retourne 404.
  const isoDate = date ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` : null

  const urlsToTry = date
    ? [
        `${FOTMOB_BASE}/matches?date=${date}`,
        `${FOTMOB_BASE}/matches?date=${isoDate}`,
      ]
    : [`${FOTMOB_BASE}/matchDetails?matchId=${matchId}`]

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 8_000)

  try {
    let lastStatus = 404
    for (const url of urlsToTry) {
      const r = await fetch(url, { headers: HEADERS, signal: controller.signal })
      if (r.ok) {
        clearTimeout(timeoutId)
        const body = await r.text()
        return res.status(200)
           .setHeader('Content-Type', 'application/json')
           .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, s-maxage=0')
           .setHeader('Pragma', 'no-cache')
           .send(body)
      }
      lastStatus = r.status
    }
    clearTimeout(timeoutId)
    return res.status(lastStatus).json({ error: `FotMob a répondu ${lastStatus}` })
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'FotMob timeout (>8s)' })
    res.status(500).json({ error: err.message })
  }
}
