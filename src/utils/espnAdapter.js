// ── Adaptateur ESPN → format "FD.org-like" ────────────────────────────────
//
// Ligue des Nations (NL), CAN (CAN) et Copa America (COPA) ne sont PAS
// couvertes par football-data.org en free tier (vérifié sur
// https://www.football-data.org/coverage — seules 12 compétitions y sont
// incluses, dont le Mondial et l'Euro mais pas ces 3-là). ESPN les couvre
// toutes via son API non-officielle (déjà utilisée ailleurs dans l'app pour
// le live — voir api/espn.js, useLiveMinute.js, useEspnMatchDetail.js).
//
// Plutôt que d'apprendre à chaque composant à lire DEUX formats de match
// différents, ce fichier convertit UNE FOIS un event ESPN vers exactement la
// même forme d'objet que celle renvoyée par football-data.org
// ({id, utcDate, status, matchday, stage, group, competition, homeTeam,
// awayTeam, score}) — tout le reste de l'app (Match.jsx, Resultat.jsx,
// MatchModal.jsx, calcProno, etc.) fonctionne alors sans aucune modification.
//
// Portée volontairement réduite pour cette 1ère version (à faire évoluer si
// besoin) :
//   - Pas de matchday/stage/group : ESPN n'expose pas proprement la structure
//     de groupe dans son scoreboard pour ces compétitions → pas d'onglet
//     "Poules" ni de tableau à élimination directe pour NL/CAN/COPA pour
//     l'instant (Programme + Résultats seulement).
//   - Pas de score.penalties : ESPN ne distingue pas clairement le score
//     120min du score final en cas de tirs au but sur ces flux (contrairement
//     à FD.org, voir finalScore() dans matchUtils.js) — impact limité (rare
//     en phase de groupes/qualifs, qui constituent l'essentiel du calendrier
//     de ces compétitions).
import { readCacheStale, writeCache } from '../hooks/localCache'
import { COMPETITIONS, DOMESTIC_CUPS } from '../data/competitions'

// Id numérique synthétique par compétition ESPN — négatif pour ne jamais
// entrer en collision avec un vrai id football-data.org (tous positifs, ex:
// WC=2000, EC=2018). Nécessaire car groupByComp() (ResultPanel.jsx) et
// d'autres endroits de l'app regroupent/comparent les matchs par
// match.competition.id : un id null pour TOUTES ces compétitions les aurait
// fait fusionner ensemble dans un seul groupe "Autre".
const SYNTHETIC_COMP_ID = { NL: -1, CAN: -2, COPA: -3, FL1_CUP: -101, PD_CUP: -102, PL_CUP: -103 }

// Statut ESPN → statut FD.org-like utilisé partout ailleurs dans l'app.
const ESPN_STATUS_MAP = {
  STATUS_SCHEDULED:   'TIMED',
  STATUS_IN_PROGRESS: 'IN_PLAY',
  STATUS_HALFTIME:    'PAUSED',
  STATUS_END_PERIOD:  'IN_PLAY',
  STATUS_EXTRA_TIME:  'IN_PLAY',
  STATUS_OVERTIME:    'IN_PLAY',
  STATUS_SHOOTOUT:    'IN_PLAY',
  STATUS_FINAL:       'FINISHED',
  STATUS_FULL_TIME:   'FINISHED',
  STATUS_FINAL_AET:   'FINISHED',
  STATUS_FINAL_PEN:   'FINISHED',
  STATUS_POSTPONED:   'POSTPONED',
  STATUS_CANCELED:    'CANCELLED',
}

function mapStatus(espnStatusName) {
  return ESPN_STATUS_MAP[espnStatusName] ?? 'SCHEDULED'
}

function pad2(n) { return String(n).padStart(2, '0') }
function fmtDate(d) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` }

// Fenêtre glissante large plutôt que des dates de tournoi exactes (non
// vérifiables/invariables pour NL/CAN/COPA, contrairement au Mondial dont on
// connaît l'édition 2026 à l'avance) — filtrage par statut fait côté client
// après coup. ESPN supporte les plages de dates (confirmé par test direct).
const DAYS_BACK    = 60
const DAYS_FORWARD = 150

function windowRange() {
  const now   = new Date()
  const start = new Date(now); start.setDate(start.getDate() - DAYS_BACK)
  const end   = new Date(now); end.setDate(end.getDate() + DAYS_FORWARD)
  return `${fmtDate(start)}-${fmtDate(end)}`
}

// `overrides` permet aux coupes nationales (voir fetchEspnCupMatches
// ci-dessous) de garder le CODE du championnat parent (pour rester dans son
// onglet/filtre existant, ex: 'FL1') tout en affichant un NOM différent sur
// les cards ("Coupe de France" plutôt que "Ligue 1") — voir isCup, utilisé
// par MatchRow/ResultRow pour afficher un petit badge distinctif.
function normalizeEvent(event, compCode, overrides = {}) {
  const comp = event?.competitions?.[0]
  if (!comp) return null

  const status = mapStatus(comp.status?.type?.name)
  const home = comp.competitors?.find(c => c.homeAway === 'home')
  const away = comp.competitors?.find(c => c.homeAway === 'away')
  if (!home || !away) return null

  const played = status === 'IN_PLAY' || status === 'PAUSED' || status === 'FINISHED'
  const homeScore = played && home.score != null ? parseInt(home.score, 10) : null
  const awayScore = played && away.score != null ? parseInt(away.score, 10) : null

  return {
    id: `espn-${overrides.idPrefix ?? compCode}-${event.id}`,
    utcDate: event.date,
    status,
    matchday: null,
    stage: null,
    group: null,
    isCup: overrides.isCup ?? false,
    competition: {
      id: overrides.compId ?? SYNTHETIC_COMP_ID[compCode] ?? null,
      code: compCode,
      name: overrides.compName ?? COMPETITIONS.find(c => c.id === compCode)?.name ?? compCode,
    },
    homeTeam: {
      id: home.team?.id ?? null,
      name: home.team?.displayName ?? home.team?.name ?? '?',
      shortName: home.team?.shortDisplayName ?? home.team?.name ?? '?',
      crest: home.team?.logo ?? null,
    },
    awayTeam: {
      id: away.team?.id ?? null,
      name: away.team?.displayName ?? away.team?.name ?? '?',
      shortName: away.team?.shortDisplayName ?? away.team?.name ?? '?',
      crest: away.team?.logo ?? null,
    },
    score: {
      fullTime: { home: homeScore, away: awayScore },
      halfTime: { home: null, away: null },
      duration: 'REGULAR',
      penalties: { home: null, away: null },
    },
  }
}

const ESPN_MATCHES_TTL = 2 * 60 * 1000 // 2min — aligné sur le TTL FINISHED existant (matches change vite en live)

// Récupère TOUS les matchs (peu importe le statut) d'une compétition ESPN sur
// la fenêtre glissante — un seul fetch réseau, filtré ensuite par statut côté
// appelant (useMatchs.js). Cache local partagé entre l'onglet Programme et
// l'onglet Résultats pour éviter un double appel réseau simultané.
export async function fetchEspnCompMatches(compCode, slug) {
  const cacheKey = `matches_espn_${compCode}`
  if (!slug) return []
  try {
    const res = await fetch(`/espn?slug=${slug}&dates=${windowRange()}`)
    if (!res.ok) return readCacheStale(cacheKey) ?? []
    const json = await res.json()
    const matches = (json.events ?? [])
      .map(e => normalizeEvent(e, compCode))
      .filter(Boolean)
    if (matches.length > 0) writeCache(cacheKey, matches, ESPN_MATCHES_TTL)
    return matches.length > 0 ? matches : (readCacheStale(cacheKey) ?? [])
  } catch {
    return readCacheStale(cacheKey) ?? []
  }
}

// Coupe nationale d'un championnat parent (Coupe de France pour FL1, Copa del
// Rey pour PD, FA Cup pour PL — voir DOMESTIC_CUPS dans competitions.js).
// Les matchs renvoyés gardent competition.code = parentCode (pour rester
// filtrés dans l'onglet du championnat parent, voir useMatchs.js) mais
// competition.name = nom de la coupe + isCup:true, pour le relabeling sur les
// cards de match.
export async function fetchEspnCupMatches(parentCode) {
  const cup = DOMESTIC_CUPS[parentCode]
  if (!cup) return []
  const cacheKey = `matches_espn_cup_${parentCode}`
  try {
    const res = await fetch(`/espn?slug=${cup.slug}&dates=${windowRange()}`)
    if (!res.ok) return readCacheStale(cacheKey) ?? []
    const json = await res.json()
    const matches = (json.events ?? [])
      .map(e => normalizeEvent(e, parentCode, {
        idPrefix: `${parentCode}-cup`,
        isCup: true,
        compId: SYNTHETIC_COMP_ID[`${parentCode}_CUP`] ?? null,
        compName: cup.name,
      }))
      .filter(Boolean)
    if (matches.length > 0) writeCache(cacheKey, matches, ESPN_MATCHES_TTL)
    return matches.length > 0 ? matches : (readCacheStale(cacheKey) ?? [])
  } catch {
    return readCacheStale(cacheKey) ?? []
  }
}
