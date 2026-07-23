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
//   - Pas de matchday/group : ESPN n'expose pas proprement la structure de
//     groupe dans son scoreboard pour ces compétitions → pas d'onglet
//     "Poules" pour NL/CAN/COPA pour l'instant (Programme + Résultats
//     seulement). `stage` EST par contre détecté (voir mapEspnStage) via
//     event.season.slug — ça permet le tableau à élimination directe pour
//     les coupes nationales (voir fetchEspnCupMatches + useCupKnockout) et,
//     accessoirement, un regroupement "Demi-finales"/"Finale" plus propre
//     que le fallback par jour pour NL/CAN/COPA si leurs phases finales
//     utilisent la même convention de nommage (pas vérifié, sans impact si
//     faux : retombe simplement sur le regroupement par jour existant).
//   - Pas de score.penalties : ESPN ne distingue pas clairement le score
//     120min du score final en cas de tirs au but sur ces flux (contrairement
//     à FD.org, voir finalScore() dans matchUtils.js) — un match de coupe
//     décidé aux tab peut donc afficher un score à égalité dans le tableau
//     (le gagnant reste correct via winner/advance ESPN, mais pas exposé ici
//     pour l'instant).
import { readCacheStale, writeCache } from '../hooks/localCache'
import { COMPETITIONS, DOMESTIC_CUPS } from '../data/competitions'
import { countryFlagUrl } from '../data/countryFlags'

// Compétitions sélections nationales sourcées ESPN — voir countryFlags.js :
// on remplace le blason ESPN (marge interne variable selon le pays, ne peut
// pas être compensée par un simple zoom CSS uniforme) par un drapeau
// flagcdn.com bord-à-bord quand on a le code du pays. Les coupes nationales
// (FL1/PD/PL) sont des clubs, jamais concernées.
const NATIONAL_TEAM_ESPN_COMPS = new Set(['NL', 'CAN', 'COPA'])

// Id numérique synthétique par compétition ESPN — négatif pour ne jamais
// entrer en collision avec un vrai id football-data.org (tous positifs, ex:
// WC=2000, EC=2018). Nécessaire car groupByComp() (ResultPanel.jsx) et
// d'autres endroits de l'app regroupent/comparent les matchs par
// match.competition.id : un id null pour TOUTES ces compétitions les aurait
// fait fusionner ensemble dans un seul groupe "Autre".
const SYNTHETIC_COMP_ID = {
  NL: -1, CAN: -2, COPA: -3, UEL: -4, UECL: -5,
  FL1_CUP: -101, PD_CUP: -102, PL_CUP: -103,
}

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

// event.season.slug → stage FD.org-like (même enum que useWcKnockout.js :
// LAST_32/LAST_16/QUARTER_FINALS/SEMI_FINALS/THIRD_PLACE/FINAL), pour pouvoir
// réutiliser TEL QUEL le moteur de tableau à élimination directe existant
// (voir useCupKnockout dans useWcKnockout.js). Valeurs vérifiées en direct
// sur de vrais matchs ESPN : "third-round" (FA Cup), "semifinals" (Coupe de
// France, Copa del Rey), "final" (Copa del Rey), "round-of-32" (Copa del
// Rey). Les tours antérieurs (round-1, round-2... qualifs amateurs) ne
// matchent volontairement rien ici → stage reste null → pas dans le tableau
// à élimination directe, mais toujours visibles dans Programme/Résultats
// (regroupés par jour, voir groupRounds() dans useMatchs.js). C'est ce qui
// fait naturellement démarrer le tableau au moment où les clubs pros entrent
// en lice, sans logique de coupure spécifique à coder par compétition.
const CUP_STAGE_MAP = {
  roundof32:      'LAST_32',
  roundof16:      'LAST_16',
  quarterfinal:   'QUARTER_FINALS',
  quarterfinals:  'QUARTER_FINALS',
  semifinal:      'SEMI_FINALS',
  semifinals:     'SEMI_FINALS',
  final:          'FINAL',
  thirdplace:     'THIRD_PLACE',
  thirdplacematch: 'THIRD_PLACE',
}
function mapEspnStage(seasonSlug) {
  if (!seasonSlug) return null
  const norm = seasonSlug.toLowerCase().replace(/[-\s]/g, '')
  return CUP_STAGE_MAP[norm] ?? null
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

  // ESPN indique directement qui a été éliminé/qualifié via winner/advance
  // (fiable même quand le score affiché est à égalité après tirs au but,
  // contrairement à une simple comparaison home>away — voir getWinnerTeamId
  // dans useWcKnockout.js, qui préfère ce champ dès qu'il est présent).
  let winnerTeamId = null
  if (home.winner === true) winnerTeamId = home.team?.id ?? null
  else if (away.winner === true) winnerTeamId = away.team?.id ?? null

  // Même info, mais dans la convention football-data.org (score.winner :
  // 'HOME_TEAM'/'AWAY_TEAM'/'DRAW') — voir outcomeForTeam() dans
  // matchUtils.js, qui s'en sert en priorité (plus fiable qu'une comparaison
  // de score numérique, notamment pour les tirs au but).
  let scoreWinner = null
  if (status === 'FINISHED') {
    scoreWinner = home.winner === true ? 'HOME_TEAM' : away.winner === true ? 'AWAY_TEAM' : 'DRAW'
  }

  const isNationalTeamEspnComp = NATIONAL_TEAM_ESPN_COMPS.has(compCode)
  const homeName = home.team?.displayName ?? home.team?.name ?? '?'
  const awayName = away.team?.displayName ?? away.team?.name ?? '?'
  const homeCrest = (isNationalTeamEspnComp && countryFlagUrl(homeName)) || home.team?.logo || null
  const awayCrest = (isNationalTeamEspnComp && countryFlagUrl(awayName)) || away.team?.logo || null

  return {
    id: `espn-${overrides.idPrefix ?? compCode}-${event.id}`,
    utcDate: event.date,
    status,
    matchday: null,
    stage: mapEspnStage(event.season?.slug),
    group: null,
    winnerTeamId,
    isCup: overrides.isCup ?? false,
    competition: {
      id: overrides.compId ?? SYNTHETIC_COMP_ID[compCode] ?? null,
      code: compCode,
      name: overrides.compName ?? COMPETITIONS.find(c => c.id === compCode)?.name ?? compCode,
    },
    homeTeam: {
      id: home.team?.id ?? null,
      name: homeName,
      shortName: home.team?.shortDisplayName ?? home.team?.name ?? '?',
      crest: homeCrest,
    },
    awayTeam: {
      id: away.team?.id ?? null,
      name: awayName,
      shortName: away.team?.shortDisplayName ?? away.team?.name ?? '?',
      crest: awayCrest,
    },
    score: {
      winner: scoreWinner,
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
    // ⚠️ BUG CORRIGÉ (retour utilisateur : l'onglet "Phase finale" d'une coupe
    // nationale — ex. Coupe de France — restait actif/cliquable alors qu'aucun
    // match de la NOUVELLE saison n'était encore programmé). L'ancien code
    // retombait sur le cache périmé dès que `matches` était vide — y compris
    // quand ESPN répond correctement (200 OK) avec `events: []` parce que la
    // saison en cours vient de se terminer et que la suivante n'a pas encore
    // démarré. Ce cache périmé contenait alors les matchs de la saison
    // PRÉCÉDENTE (déjà terminée, tableau complet), ce qui faisait croire à
    // useCupKnockout() qu'un vrai tableau existait déjà pour la saison
    // actuelle — l'onglet ne se désactivait jamais. Le repli sur le cache
    // périmé ne doit servir qu'en cas d'ÉCHEC réel de la requête (catch /
    // !res.ok, voir plus haut/bas) — un fetch réussi qui renvoie 0 match est
    // une vraie information (rien de programmé pour l'instant), pas une
    // panne : on la fait remonter telle quelle.
    writeCache(cacheKey, matches, ESPN_MATCHES_TTL)
    return matches
  } catch {
    return readCacheStale(cacheKey) ?? []
  }
}
