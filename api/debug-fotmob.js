// api/debug-fotmob.js
// Diagnostic temporaire — xG FotMob invisible en live (signalé par l'utilisateur).
// Objectif : voir depuis Vercel (pas depuis un sandbox local) ce que FotMob renvoie
// vraiment, sans deviner. Protégé par CRON_SECRET comme debug-push.js.
//
// GET /api/debug-fotmob?secret=VOTRE_SECRET&date=20260704
//   → teste l'appel "matches" (passe 1 : trouver l'ID FotMob du jour) et liste
//     les matchs + équipes trouvées, pour vérifier le fuzzy match.
//
// GET /api/debug-fotmob?secret=VOTRE_SECRET&matchId=XXXXXXX
//   → teste l'appel "matchDetails" (passe 2) et essaie extractXG dessus, en
//     indiquant quel chemin (1/2/3) a fonctionné ou pourquoi aucun n'a marché.
//
// À SUPPRIMER une fois le diagnostic terminé (fichier temporaire, pas pour la prod).

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

function extractXG(data) {
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

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] ?? req.query.secret ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' })
  }

  const { date, matchId } = req.query
  if (!date && !matchId) {
    return res.status(400).json({ error: 'Paramètre date (YYYYMMDD) ou matchId requis' })
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
            url,
            httpStatus: r.status,
            ok: r.ok,
            bodySnippet: bodyText.slice(0, 300),
            leaguesCount: leagues.length,
            matchesFound: allMatches.length,
            matches: allMatches.slice(0, 40),
          })
          if (r.ok) break // pas besoin d'essayer le 2e format si le 1er marche
        } catch (e) {
          results.push({ url, error: e.message })
        }
      }
      clearTimeout(timeoutId)
      return res.status(200).json({ ok: true, mode: 'matches', date, results })
    }

    // mode matchId
    const url = `${FOTMOB_BASE}/matchDetails?matchId=${matchId}`
    const r = await fetch(url, { headers: HEADERS, signal: controller.signal })
    const bodyText = await r.text()
    clearTimeout(timeoutId)
    let parsed = null
    try { parsed = JSON.parse(bodyText) } catch {}
    const xgAttempts = parsed ? extractXG(parsed) : null
    return res.status(200).json({
      ok: true,
      mode: 'matchDetails',
      matchId,
      httpStatus: r.status,
      httpOk: r.ok,
      bodySnippet: bodyText.slice(0, 500),
      xgAttempts,
    })
  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') return res.status(504).json({ error: 'FotMob timeout (>8s)' })
    return res.status(500).json({ error: err.message })
  }
}
