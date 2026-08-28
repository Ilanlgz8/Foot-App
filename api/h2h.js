// api/h2h.js — historique de confrontations directes MULTI-ANNÉES, pour 2
// équipes du MÊME championnat national, via football-data.co.uk.
//
// ⚠️ football-data.co.uk (avec .co.uk) — SITE DIFFÉRENT de football-data.org
// (avec .org, déjà utilisé partout ailleurs dans l'app, voir api/football.js).
// Aucun rapport entre les deux : pas la même clé API (aucune clé requise
// ici), pas le même budget/rate-limit, pas les mêmes noms d'équipe. Choisi
// (28/08, demande utilisateur : "élargir le H2H qu'on a actuellement... une
// source qui permet d'avoir plein de données") après avoir vérifié en direct
// (fetch réel) que football-data.org en compte gratuit ne renvoie QUE la
// saison en cours (confirmé par recherche) — inutilisable pour du H2H
// multi-années. football-data.co.uk expose des fichiers CSV statiques,
// publics, SANS clé API, une saison par fichier, depuis 1993 pour les 5
// grands championnats club (Angleterre/France/Espagne/Allemagne/Italie).
//
// ⚠️ LIMITE IMPORTANTE, honnêtement documentée : ce sont des fichiers PAR
// CHAMPIONNAT NATIONAL (une saison de Ligue 1, une saison de Premier
// League...) — un club français n'apparaît JAMAIS dans le fichier allemand.
// Une confrontation PSG-Bayern (uniquement possible en Ligue des Champions)
// n'existe dans AUCUN de ces fichiers. Ce endpoint ne peut donc répondre
// QUE pour 2 équipes du MÊME championnat (même valeur `comp`) — voir
// FDCOUK_LEAGUE_FILE (src/data/fdcoukTeamNames.js), qui ne couvre QUE les 5
// grands championnats club, jamais CL (compétition européenne, pas un
// championnat national, aucun fichier dédié sur ce site).
//
// Cache Redis PARTAGÉ (comme le reste de l'app) : chaque fichier CSV saison
// n'est téléchargé/parsé qu'UNE SEULE FOIS pour tous les utilisateurs
// confondus, quel que soit le nombre de comparaisons faites ensuite pour ce
// championnat — coût réseau/CPU indépendant du trafic, même principe que le
// fast-path cache d'api/fifa-live.js (voir CLAUDE.md).
import { Redis } from '@upstash/redis'
import { FDCOUK_LEAGUE_FILE, toFdcoukName } from '../src/data/fdcoukTeamNames.js'

let kv = null
function getKv() {
  if (!kv && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  }
  return kv
}

// Combien de saisons passées interroger (saison en cours incluse) — 6 =
// profondeur réelle utile pour un H2H (au-delà, la pertinence sportive
// diminue et le nombre de fichiers à fetch/parser augmente d'autant), tout
// en restant largement dans le raisonnable pour un site sans rate-limit
// documenté (fichiers statiques).
const SEASONS_BACK = 6

// Code saison "2627" = saison démarrant en août de currentYear si on est
// déjà en juillet+ (nouvelle saison démarrée ou imminente), sinon l'année
// précédente — même convention que les URLs football-data.co.uk
// (mmz4281/{code}/...). Calculé dynamiquement (pas de constante à
// maintenir à la main chaque année).
function seasonCodesBack(n) {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  let startYear = m >= 7 ? y : y - 1
  const codes = []
  for (let i = 0; i < n; i++) {
    const endYear = startYear + 1
    codes.push(`${String(startYear).slice(-2)}${String(endYear).slice(-2)}`)
    startYear -= 1
  }
  return codes
}

const CURRENT_SEASON = seasonCodesBack(1)[0]

// Parseur CSV minimal — pas de librairie (pas de champs entre guillemets
// dans ces fichiers, noms d'équipe/arbitre sans virgule, vérifié sur
// plusieurs fichiers réels) : split brut par virgule suffit, on ne lit que
// les colonnes utiles par NOM d'en-tête (l'ordre des colonnes diffère selon
// la ligue/saison, ex. la Bundesliga a des colonnes xG en plus que la
// Ligue 1) plutôt que par position fixe.
function parseSeasonCsv(text) {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const header = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.trim())
  const idx = {
    date: header.indexOf('Date'),
    home: header.indexOf('HomeTeam'),
    away: header.indexOf('AwayTeam'),
    fthg: header.indexOf('FTHG'),
    ftag: header.indexOf('FTAG'),
  }
  if (idx.home < 0 || idx.away < 0 || idx.fthg < 0 || idx.ftag < 0) return []
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    const home = cols[idx.home]?.trim()
    const away = cols[idx.away]?.trim()
    const fthg = Number(cols[idx.fthg])
    const ftag = Number(cols[idx.ftag])
    if (!home || !away || !Number.isFinite(fthg) || !Number.isFinite(ftag)) continue
    rows.push({ date: cols[idx.date]?.trim() ?? null, home, away, homeGoals: fthg, awayGoals: ftag })
  }
  return rows
}

// Une saison TERMINÉE ne change plus jamais (cache long) ; la saison en
// cours peut recevoir de nouveaux matchs chaque semaine (cache court) ;
// l'ABSENCE d'un fichier (saison pas encore publiée par le site — constaté
// en direct pour la Bundesliga 2026-2027 au moment de cet ajout) est aussi
// mise en cache, mais courte : éviter de re-tenter un fetch 404 à chaque
// requête tout en laissant une chance de le retrouver une fois publié.
const SEASON_CACHE_TTL      = 60 * 60 * 24 * 30 // 30j — saison terminée, immuable
const CURRENT_SEASON_TTL    = 60 * 60 * 6       // 6h — saison en cours, nouveaux matchs chaque semaine
const MISSING_SEASON_TTL    = 60 * 60 * 6       // 6h — fichier pas (encore) publié

async function fetchSeason(leagueFile, seasonCode) {
  const cacheKey = `h2h:csv:${leagueFile}:${seasonCode}`
  const kvClient = getKv()
  if (kvClient) {
    const cached = await kvClient.get(cacheKey)
    if (cached != null) return cached
  }
  const url = `https://www.football-data.co.uk/mmz4281/${seasonCode}/${leagueFile}.csv`
  let rows = []
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const text = await res.text()
      rows = parseSeasonCsv(text)
    }
  } catch {
    rows = []
  }
  if (kvClient) {
    const ttl = rows.length === 0 ? MISSING_SEASON_TTL : (seasonCode === CURRENT_SEASON ? CURRENT_SEASON_TTL : SEASON_CACHE_TTL)
    try { await kvClient.set(cacheKey, rows, { ex: ttl }) } catch {}
  }
  return rows
}

export default async function handler(req, res) {
  const ip    = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const kvClient = getKv()
  if (kvClient) {
    const rlKey = `ratelimit:h2h:${ip}`
    try {
      const count = await kvClient.incr(rlKey)
      if (count === 1) await kvClient.expire(rlKey, 60)
      if (count > 30) return res.status(429).json({ error: 'Trop de requêtes' })
    } catch {}
  }

  const { comp, home, away } = req.query
  const leagueFile = comp ? FDCOUK_LEAGUE_FILE[comp] : null
  if (!leagueFile) return res.status(400).json({ error: 'Championnat non couvert (5 grands championnats club uniquement)' })

  const fdcoukHome = toFdcoukName(home)
  const fdcoukAway = toFdcoukName(away)
  if (!fdcoukHome || !fdcoukAway) {
    // Équipe pas (encore) dans la table de correspondance (voir
    // fdcoukTeamNames.js) — dégradation silencieuse, pas une erreur : le
    // client retombe sur le H2H FD.org (saison en cours) déjà en place.
    return res.status(200).json({ meetings: [], reason: 'team-not-mapped' })
  }

  const seasons = seasonCodesBack(SEASONS_BACK)
  const allRows = await Promise.all(seasons.map(s => fetchSeason(leagueFile, s)))

  // Saison en cours volontairement EXCLUE ici : déjà couverte par le H2H
  // FD.org existant (useCrossCompH2H, /v4/teams/{id}/matches) côté appelant
  // — évite de compter le même match 2 fois (FD.org + ce fichier CSV, une
  // fois publié) sans avoir à comparer des dates dans 2 formats différents.
  const meetings = []
  seasons.forEach((season, i) => {
    if (season === CURRENT_SEASON) return
    allRows[i].forEach(m => {
      const isMatch =
        (m.home === fdcoukHome && m.away === fdcoukAway) ||
        (m.home === fdcoukAway && m.away === fdcoukHome)
      if (isMatch) meetings.push({ season, date: m.date, home: m.home, away: m.away, homeGoals: m.homeGoals, awayGoals: m.awayGoals })
    })
  })
  // Plus récent en premier — dates au format JJ/MM/AAAA (football-data.co.uk),
  // reconstruites en AAAA-MM-JJ pour un tri chronologique correct.
  meetings.sort((a, b) => {
    const da = a.date?.split('/').reverse().join('-') ?? ''
    const db = b.date?.split('/').reverse().join('-') ?? ''
    return db.localeCompare(da)
  })

  res.setHeader('Cache-Control', 'public, max-age=3600')
  return res.status(200).json({ meetings, source: 'football-data.co.uk' })
}
