// Ligue 3 (12/11, demande utilisateur : « l'intégralité de la Ligue 3 avec programme,
// classement et résultats seulement, pas dans Tous les matchs ni en direct »).
//
// Source : l'API publique de la FFF (api-dofa.fff.fr, celle qui alimente fff.fr), sans clé.
// ESPN et football-data.org ne couvrent pas la Ligue 3 (vérifié le 12/11 : `fra.3` → 400 chez
// ESPN). Limite connue et assumée : PAS de direct — la FFF publie le score final ~1 h 30 à 2 h
// après le coup de sifflet (mesuré sur la 12e journée : Rouen–Bastia 14h45, score publié 18h30).
// C'est pour ça que la Ligue 3 n'existe QUE dans Programme/Résultats/Classement
// (PAGE_ONLY_COMPETITIONS, competitions.js) et jamais dans COMPETITIONS (Accueil, Tous les
// matchs, direct, notifications, Worker).
//
// ⚠️ API non documentée publiquement : si la FFF la change, seule la Ligue 3 est touchée
// (le client retombe sur son dernier cache, voir useMatches/useStandings).

export const FFF_API = 'https://api-dofa.fff.fr'
// Compétition « L3 », saison 2026 (= 2026-27), poule unique. Numéro relevé le 12/11 sur l'API
// (/api/clubs/3225/resultat → competition.cp_no). Change à chaque saison : à mettre à jour en
// août (sinon l'API renvoie la saison précédente ou rien).
export const L3_CP_NO = 452039
const POULE_PATH = `/api/compets/${L3_CP_NO}/phases/1/poules/1`

// Décalage pour que les ids d'équipes FFF (cl_no, petits entiers) ne croisent jamais un id
// football-data.org ou ESPN dans les caches/maps de l'app.
export const L3_TEAM_ID_OFFSET = 90_000_000

// Noms d'affichage (la FFF donne des noms courts en MAJUSCULES, parfois des sigles : « QRM »,
// « FCVB », « FBBP »). Clé = cl_no FFF. Club inconnu (promu la saison prochaine) → prettyName.
const L3_TEAM_NAMES = {
  3051:   'La Roche VF',
  184:    'FC Rouen',
  217:    'SM Caen',
  656:    'FC Versailles',
  358:    'Amiens SC',
  410:    'US Concarneau',
  253:    'AS Cannes',
  151722: 'Le Puy Foot',
  9753:   'FC Fleury 91',
  21305:  'Thionville Lusitanos',
  8738:   'Paris 13 Atletico',
  14293:  'Quevilly-Rouen',
  3225:   'SC Bastia',
  2421:   'US Orléans',
  366:    'Valenciennes FC',
  2174:   'FC Villefranche',
  1626:   'SC Aubagne',
  2193:   'Bourg-Péronnas',
}

const KEEP_UPPER = new Set(['FC', 'SC', 'US', 'AS', 'SM', 'VF', 'AC', 'RC', 'SCF', 'UF', 'ES', 'OGC', 'AJ', 'EA'])
export function prettyName(raw) {
  return String(raw ?? '')
    .trim()
    .split(/\s+/)
    .map(w => (KEEP_UPPER.has(w) || /\d/.test(w)) ? w : w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

export function teamName(clNo, raw) {
  return L3_TEAM_NAMES[clNo] ?? prettyName(raw)
}

// "2026-11-07T00:00:00+00:00" + "14H45" (heure de Paris) → ISO UTC. Le décalage Paris (UTC+1 ou
// +2 selon l'heure d'été) est calculé pour la date du match via Intl, pas codé en dur.
export function parisToUtc(dateStr, timeStr) {
  const day = String(dateStr ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const m = /^(\d{1,2})H(\d{2})$/i.exec(String(timeStr ?? '').trim())
  const hh = m ? Number(m[1]) : 0
  const mm = m ? Number(m[2]) : 0
  const [y, mo, d] = day.split('-').map(Number)
  // 1re estimation en considérant l'heure comme UTC, puis correction par le décalage réel de Paris
  const guess = Date.UTC(y, mo - 1, d, hh, mm)
  const offsetMin = parisOffsetMinutes(guess)
  return new Date(guess - offsetMin * 60_000).toISOString()
}

function parisOffsetMinutes(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ts))
  const get = t => Number(parts.find(p => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - ts) / 60_000)
}

function team(side) {
  const clNo = side?.club?.cl_no
  const name = teamName(clNo, side?.short_name)
  return {
    id: clNo != null ? L3_TEAM_ID_OFFSET + clNo : null,
    name,
    shortName: name,
    tla: null,
    crest: side?.club?.logo ?? null,
  }
}

// Match FFF → format football-data.org utilisé partout dans l'app. Le statut n'est que
// FINISHED (score publié) ou TIMED : « coup d'envoi passé, score pas encore publié » est
// calculé au moment de l'affichage (l3Status, src/utils/ligue3.js), pas figé dans le cache.
export function normalizeFffMatch(m) {
  const hs = m?.home_score
  const as = m?.away_score
  const finished = hs != null && as != null
  return {
    id: m.ma_no,
    utcDate: parisToUtc(m.date, m.time),
    status: finished ? 'FINISHED' : 'TIMED',
    matchday: m.poule_journee?.number ?? null,
    stage: 'REGULAR_SEASON',
    homeTeam: team(m.home),
    awayTeam: team(m.away),
    score: {
      winner: finished ? (hs > as ? 'HOME_TEAM' : as > hs ? 'AWAY_TEAM' : 'DRAW') : null,
      duration: 'REGULAR',
      fullTime: { home: finished ? hs : null, away: finished ? as : null },
      halfTime: { home: null, away: null },
    },
    competition: { id: 'L3', code: 'L3', name: 'Ligue 3' },
    venue: m.terrain?.name ?? null,
    postponed: !!m.seems_postponed,
  }
}

export function normalizeFffStandings(rows) {
  return [...(rows ?? [])]
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .map(r => {
      const clNo = r.equipe?.club?.cl_no
      const name = teamName(clNo, r.equipe?.short_name)
      return {
        position: r.rank,
        team: { id: clNo != null ? L3_TEAM_ID_OFFSET + clNo : null, name, shortName: name, crest: null },
        playedGames: r.total_games_count ?? 0,
        won: r.won_games_count ?? 0,
        draw: r.draw_games_count ?? 0,
        lost: r.lost_games_count ?? 0,
        points: r.point_count ?? 0,
        goalsFor: r.goals_for_count ?? 0,
        goalsAgainst: r.goals_against_count ?? 0,
        goalDifference: r.goals_diff ?? 0,
      }
    })
}

async function getJson(fetchImpl, path, timeoutMs) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    // Uniquement l'en-tête `accept` (autorisé en CORS sans requête préalable) : l'appel part
    // du navigateur de l'utilisateur, voir fetchLigue3 (src/utils/ligue3.js).
    // `sf=` : l'API FFF passe par un cache qui garde l'en-tête CORS du PREMIER site à avoir
    // demandé une adresse (constaté le 12/11 : `matchs?page=1`, déjà demandée ailleurs, refusée
    // depuis StatFootix ; la même avec `&sf=…` passe). Une adresse propre à l'app, qui change
    // toutes les 10 min, évite ce piège — et reste partagée entre utilisateurs de l'app.
    const sep = path.includes('?') ? '&' : '?'
    const url = `${FFF_API}${path}${sep}sf=${Math.floor(Date.now() / 600_000)}`
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/ld+json' } })
    if (!r.ok) throw new Error(`FFF ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

// Saison complète (306 matchs, 30 par page côté FFF → ~11 pages en parallèle) + classement.
// ~12 requêtes légères (~3 s au total), mises en cache côté client (src/utils/ligue3.js).
export async function fetchLigue3FromFff(fetchImpl = fetch, timeoutMs = 20_000) {
  const first = await getJson(fetchImpl, `${POULE_PATH}/matchs?page=1`, timeoutMs)
  const total = first['hydra:totalItems'] ?? 0
  const perPage = (first['hydra:member'] ?? []).length || 30
  const pages = Math.min(20, Math.ceil(total / perPage))
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      getJson(fetchImpl, `${POULE_PATH}/matchs?page=${i + 2}`, timeoutMs)),
  )
  const classement = await getJson(fetchImpl, `${POULE_PATH}/classement_journees`, timeoutMs)

  const seen = new Set()
  const matches = []
  for (const page of [first, ...rest]) {
    for (const m of page['hydra:member'] ?? []) {
      if (m?.ma_no == null || seen.has(m.ma_no)) continue
      seen.add(m.ma_no)
      matches.push(normalizeFffMatch(m))
    }
  }

  // Logos : le classement FFF n'en donne pas, on les reprend des matchs.
  const crestById = {}
  for (const m of matches) {
    if (m.homeTeam.id != null && m.homeTeam.crest) crestById[m.homeTeam.id] = m.homeTeam.crest
    if (m.awayTeam.id != null && m.awayTeam.crest) crestById[m.awayTeam.id] = m.awayTeam.crest
  }
  const table = normalizeFffStandings(classement['hydra:member']).map(r => ({
    ...r, team: { ...r.team, crest: crestById[r.team.id] ?? null },
  }))

  return { matches, table, complete: matches.length === total }
}
