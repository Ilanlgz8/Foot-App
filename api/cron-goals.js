// api/cron/goals.js
// Appelé par cron-job.org toutes les minutes.
// Source : ESPN (primaire — couvre WC 2026 via 'fifa.world' + toutes ligues club)
//          FIFA live (couche rapide additionnelle, WC uniquement — voir plus bas)
//
// Détecte et notifie :
//   ⚽ But         — score change pendant un match en cours
//   🔴 Coup d'envoi — match démarre
//   ⏸  Mi-temps    — pause mi-temps
//   ▶️  Reprise     — reprise 2ème MT
//   🏁 Fin de match — match terminé
//
// ⚠️ FIX retard notif WC (~10min) : ESPN a un lag connu sur le slug 'fifa.world'
// (le statut scoreboard ESPN met du temps à passer SCHEDULED → IN_PROGRESS).
// api/fifa-live.js contourne déjà ça côté affichage live en croisant avec l'API
// FIFA officielle. On applique la même logique ici, uniquement pour les matchs WC :
// si ESPN dit encore SCHEDULED mais que FIFA confirme Period=1 (match démarré),
// on utilise le statut FIFA → notif coup d'envoi immédiate au lieu d'attendre ESPN.
//
// Sécurité : header "x-cron-secret" ou param ?secret= doit matcher CRON_SECRET.

import { Redis } from '@upstash/redis'
import webpush   from 'web-push'
import { TEAM_NAMES_FR } from '../src/data/teamNames.js'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

// ── Config ESPN ────────────────────────────────────────────────────────────────
const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer'
// WC 2026 via 'fifa.world' + toutes compétitions club couvertes par l'app
const ESPN_SLUGS = [
  'fifa.world',          // WC 2026 — ESPN couvre le WC, statuts fiables
  'fra.1',
  'eng.1',
  'esp.1',
  'ger.1',
  'ita.1',
  'uefa.champions',
  'uefa.europa',
  'uefa.europa.conf',
]

const LIVE_ESPN  = new Set([
  'STATUS_IN_PROGRESS',
  'STATUS_HALFTIME',
  'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME',
  'STATUS_OVERTIME',
  'STATUS_SHOOTOUT',
])
// ⚠️ BUG CORRIGÉ : un match à élimination directe décidé en prolongation ou
// aux tirs au but ne renvoie JAMAIS 'STATUS_FINAL' côté ESPN — il renvoie
// 'STATUS_FINAL_AET' ou 'STATUS_FINAL_PEN' (statuts déjà identifiés et gérés
// côté client, voir useLiveMinute.js). Comme ces deux valeurs manquaient ici,
// FINAL_ESPN.has(status) restait FAUX indéfiniment pour ces matchs : la notif
// "Fin de match" ne partait jamais, ET la notif "Coup d'envoi" (dont la
// condition est justement "tant que le statut n'est pas final") continuait
// de se redéclencher à chaque expiration de sa clé de dédup (3h) — d'où des
// notifs de coup d'envoi reçues des heures après la fin réelle du match,
// pour n'importe quel match de phase à élimination directe allant en
// prolongation/tab (constat utilisateur, en pleine phase à élimination
// directe du Mondial).
const FINAL_ESPN = new Set([
  'STATUS_FINAL', 'STATUS_FULL_TIME',
  'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
])

// ── FIFA live — couche rapide WC (même cache Redis que api/fifa-live.js) ───────
const FIFA_LIVE_URL = 'https://api.fifa.com/api/v3/live/football'

function normalizeFifa(name = '') {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function fuzzyTeamFifa(a, b) {
  const na = normalizeFifa(a), nb = normalizeFifa(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true
  const wa = na.match(/[a-z]{4,}/g) ?? []
  const wb = nb.match(/[a-z]{4,}/g) ?? []
  return wa.some(x => wb.some(y => x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))))
}

function fifaTeamNamesAll(team) {
  return (team?.TeamName ?? []).map(t => t.Description).filter(Boolean)
}

// MatchStatus : 0=pas commencé 1=en cours 3=terminé
// Period      : 0=pré-match 1=1èreMT 2=2èmeMT 3=pause MT 4=Prol MT1 5=pause Prol 6=Prol MT2 7=TAB 8=FT
// ⚠️ Volontairement PAS de mapping vers STATUS_FINAL ici : FIFA peut retourner un
// faux statut "terminé" lors de transitions normales (VAR, mi-temps) — même limite
// documentée côté client (useLiveMinute.js) contre les faux FT. On ne l'utilise donc
// que pour accélérer la détection du coup d'envoi et de la mi-temps, jamais la fin.
function fifaEffectiveStatus(m) {
  if (m.MatchStatus !== 1 || m.Period === 0) return null
  if (m.Period === 3 || m.Period === 5) return 'STATUS_HALFTIME'
  return 'STATUS_IN_PROGRESS'
}

async function fetchFifaLiveMatches(log) {
  try {
    const cached = await kv.get('fifa:live')
    if (cached) {
      const data = typeof cached === 'string' ? JSON.parse(cached) : cached
      return data ?? []
    }
  } catch {}
  try {
    const res = await fetch(FIFA_LIVE_URL, {
      headers: { Accept: 'application/json' },
      signal:  AbortSignal.timeout(6_000),
    })
    if (!res.ok) { log.push(`[fifa:live] http=${res.status}`); return [] }
    const json = await res.json()
    const data = json.Results ?? []
    try { await kv.set('fifa:live', JSON.stringify(data), { ex: 6 }) } catch {}
    return data
  } catch (e) {
    log.push(`[fifa:live] error=${e.message}`)
    return []
  }
}

// ── Traduction noms ESPN → français ───────────────────────────────────────────
// ⚠️ BUG CORRIGÉ : cette table ne couvrait que les CLUBS (Ligue 1, Premier
// League...) — aucune entrée pour les équipes NATIONALES. Résultat concret :
// pendant la Coupe du Monde, toutes les notifs push affichaient les noms de
// pays en anglais ("Argentina 1-0 Cape Verde" au lieu de "Argentine 1-0
// Cap-Vert"), alors que le reste de l'app traduit déjà systématiquement via
// translateTeam()/TEAM_NAMES_FR (src/data/teamNames.js) — jamais réutilisé
// ici jusqu'à présent. TEAM_NAMES_FR couvre justement les pays (section
// "Euro / Nations" + "Coupe du monde", clés = nom anglais ESPN, ex:
// "Argentina" → "Argentine") : on l'ajoute en repli, sans toucher à la table
// clubs ci-dessous (clés ESPN différentes, gardées séparées).
const TEAM_FR_CLUBS = {
  // Ligue 1
  'Paris Saint-Germain': 'Paris SG', 'PSG': 'Paris SG',
  'Olympique de Marseille': 'Marseille', 'Olympique Lyonnais': 'Lyon',
  'AS Monaco': 'Monaco', 'LOSC Lille': 'Lille', 'OGC Nice': 'Nice',
  'Stade Rennais': 'Rennes', 'RC Lens': 'Lens', 'Toulouse FC': 'Toulouse',
  'Stade Brestois': 'Brest', 'Nantes': 'Nantes', 'RC Strasbourg': 'Strasbourg',
  'Angers SCO': 'Angers', 'Le Havre AC': 'Le Havre',
  // Premier League
  'Manchester City': 'Man. City', 'Manchester United': 'Man. United',
  'Arsenal': 'Arsenal', 'Liverpool': 'Liverpool', 'Chelsea': 'Chelsea',
  'Tottenham Hotspur': 'Tottenham', 'Newcastle United': 'Newcastle',
  'Aston Villa': 'Aston Villa', 'Brighton & Hove Albion': 'Brighton',
  'West Ham United': 'West Ham', 'Wolverhampton Wanderers': 'Wolves',
  'Crystal Palace': 'C. Palace', 'Nottingham Forest': 'Nott. Forest',
  'Fulham': 'Fulham', 'Brentford': 'Brentford', 'Everton': 'Everton',
  // La Liga
  'Real Madrid': 'Real Madrid', 'FC Barcelona': 'Barcelone', 'Barcelona': 'Barcelone',
  'Atletico Madrid': 'Atl. Madrid', 'Athletic Bilbao': 'Ath. Bilbao',
  'Real Sociedad': 'R. Sociedad', 'Villarreal': 'Villarreal',
  'Sevilla': 'Séville', 'Real Betis': 'Betis', 'Valencia': 'Valence',
  'Rayo Vallecano': 'Rayo', 'Girona': 'Girona',
  // Bundesliga
  'Bayern Munich': 'Bayern', 'Borussia Dortmund': 'Dortmund',
  'RB Leipzig': 'Leipzig', 'Bayer Leverkusen': 'Leverkusen',
  'Eintracht Frankfurt': 'Frankfurt', 'Borussia Mönchengladbach': "M'gladbach",
  'Werder Bremen': 'Werder', 'Union Berlin': 'Union Berlin',
  // Serie A
  'Internazionale': 'Inter', 'Inter Milan': 'Inter',
  'AC Milan': 'Milan', 'Juventus': 'Juventus', 'Napoli': 'Naples',
  'AS Roma': 'Rome', 'Lazio': 'Lazio', 'Atalanta': 'Atalanta',
  // Divers
  'PSV Eindhoven': 'PSV', 'Club Brugge': 'Bruges', 'Ajax': 'Ajax',
  'Porto': 'Porto', 'Benfica': 'Benfica',
}

function t(name) { return TEAM_FR_CLUBS[name] ?? TEAM_NAMES_FR[name] ?? name }

// Même format que espnMinuteLabel() côté client (MatchModal.jsx) — dupliqué
// volontairement (fonction pure de 2 lignes : pas la peine d'importer tout un
// composant React dans une fonction serverless pour ça). ESPN renvoie le
// clock au format "MM:SS" (ex: "34:00"), jamais directement "34'".
function minuteLabel(raw) {
  const base = String(raw ?? '').split(':')[0]
  return base ? `${base}'` : ''
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function dateStr(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function setupVapid() {
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); return true }
  catch { return false }
}

async function fetchEspnEvents(slug, date, log) {
  try {
    const r = await fetch(`${ESPN_BASE}/${slug}/scoreboard?dates=${date}`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!r.ok) { log.push(`[espn:${slug}] status=${r.status}`); return [] }
    const j = await r.json()
    return j.events ?? []
  } catch (e) {
    log.push(`[espn:${slug}] error=${e.message}`)
    return []
  }
}

// ── Push helpers ───────────────────────────────────────────────────────────────

// Un abonné sans `comps` (ou liste vide) = pas de filtre configuré → reçoit
// tout, comportement historique préservé pour ne rien casser pour les
// utilisateurs existants. Un abonné avec des championnats suivis ne reçoit
// que les notifs des matchs de ces championnats (comparaison sur le slug
// ESPN, identique à celui utilisé pour boucler sur les matchs ci-dessous —
// plus simple et plus fiable qu'un matching par nom d'équipe/traduction).
function matchesFavorite(subComps, slug) {
  if (!Array.isArray(subComps) || subComps.length === 0) return true
  if (!slug) return true
  return subComps.includes(slug)
}

// Variante stricte pour le ticker live : contrairement aux notifs classiques
// (KO/mi-temps/but/FT, où l'absence de filtre = tout recevoir, comportement
// historique préservé), un abonné SANS championnat suivi ne doit PAS recevoir
// de ticker en direct pour chaque match — sinon ça spamme tout le monde à
// chaque minute pour chaque match en cours dans le monde entier.
function matchesFavoriteStrict(subComps, slug) {
  if (!Array.isArray(subComps) || subComps.length === 0) return false
  if (!slug) return false
  return subComps.includes(slug)
}

async function sendPushToMatch(payload, slug, options = {}, log = null) {
  let subs = []
  try { subs = (await kv.smembers('push:subscriptions')) ?? [] } catch { return 0 }
  if (!subs.length) return 0

  const matcher = options.onlyFavorites ? matchesFavoriteStrict : matchesFavorite
  const payloadStr = JSON.stringify(payload)
  const stale = []
  let sent = 0
  let failed = 0

  await Promise.allSettled(subs.map(async subRaw => {
    let sub
    try { sub = typeof subRaw === 'string' ? JSON.parse(subRaw) : subRaw }
    catch { stale.push(subRaw); return }
    if (!matcher(sub.comps, slug)) return
    try {
      // urgency: 'high' — sans ça, les services de push (notamment Apple sur
      // iOS, largement majoritaire chez nos abonnés) peuvent différer la
      // livraison en arrière-plan/économie d'énergie, ce qui correspond
      // exactement au symptôme observé (notifs de but rares et imprévisibles,
      // alors qu'il n'y en a que ~0-10 par match — pas un problème de volume).
      await webpush.sendNotification(sub, payloadStr, {
        TTL: options.ttl ?? 3600,
        urgency: options.urgency ?? 'normal',
      })
      sent++
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        stale.push(typeof subRaw === 'string' ? subRaw : JSON.stringify(subRaw))
      } else {
        // Avant : erreur silencieusement ignorée (aucune trace) → impossible de
        // savoir pourquoi une notif n'arrive pas chez un abonné donné. On log
        // désormais le statusCode/message pour pouvoir diagnostiquer via le log
        // renvoyé par ce endpoint (visible dans les logs Vercel du cron).
        failed++
        log?.push(`[push:fail] status=${err.statusCode ?? '?'} msg=${err.message ?? err}`)
      }
    }
  }))

  if (stale.length) {
    try { await Promise.all(stale.map(s => kv.srem('push:subscriptions', s))) } catch {}
  }
  // Log systématique (avant : seulement si échec) — permet de distinguer "le
  // serveur a bien envoyé et le service de push a accepté" (sent=X, rien à
  // corriger côté code, la suite dépend d'Apple/Google/l'OS du téléphone) de
  // "le serveur n'a même pas réussi à envoyer" (failed>0, cause visible).
  log?.push(`[push] sent=${sent} failed=${failed} stale=${stale.length} total=${subs.length}`)
  return sent
}

async function sendDeduped(dedupKey, payload, slug, log = null, ttl = 3 * 3600) {
  try {
    const already = await kv.get(dedupKey)
    if (already) return 0
    await kv.set(dedupKey, '1', { ex: ttl })
  } catch { return 0 }
  // urgency 'high' : ces notifs (KO/but/mi-temps/reprise/fin) sont rares et
  // importantes — priorité max pour limiter les retards/pertes en arrière-plan.
  return sendPushToMatch(payload, slug, { urgency: 'high' }, log)
}

// ── Capture proactive du summary ESPN (compos + stats + événements) ────────────
// Root cause du "pas de compo/stats si je n'ai pas suivi le match en direct" :
// avant, la donnée summary ESPN n'était récupérée QUE quand un utilisateur
// ouvrait la page du match (via api/espn.js) — si personne ne l'a fait
// pendant que ESPN avait encore la donnée dispo, elle n'était jamais
// capturée. Ici, à CHAQUE match en direct détecté par le cron (donc pour
// TOUS les matchs, suivis ou non par qui que ce soit), on la récupère et on
// l'écrit dans le même cache Redis partagé que api/espn.js (même clé) — donc
// n'importe quel utilisateur consultant "Résultats" plus tard la retrouve,
// même s'il n'a jamais ouvert le match en direct.
const SUMMARY_CACHE_TTL = 7 * 24 * 3600  // 7j — même durée que api/espn.js

function hasUsefulSummaryData(json) {
  const hasRosters  = Array.isArray(json?.rosters) && json.rosters.length > 0
  const hasBoxscore = Array.isArray(json?.boxscore?.teams) && json.boxscore.teams.length > 0
  // ⚠️ BUG CORRIGÉ (même fix que api/espn.js) : pour la Coupe du Monde, ESPN
  // met les compos dans header.competitions[0].competitors[].roster, PAS dans
  // json.rosters (déjà géré côté client dans useLineups/useEspnMatchStats).
  // Cette fonction ne le vérifiait pas → la capture proactive censée éviter
  // "pas de compo si je n'ai pas suivi le match en direct" (voir commentaire
  // au-dessus) ne se déclenchait en réalité JAMAIS pour un match de CM, alors
  // que c'est justement la compétition concernée. Constat concret : Maroc-
  // Canada affichait "Compos non disponibles" alors que l'app avait déjà
  // récupéré les compos des deux équipes à un moment donné — jamais
  // sauvegardées faute de ce check.
  const competitors  = json?.header?.competitions?.[0]?.competitors ?? []
  const hasHeaderRoster = competitors.some(c => Array.isArray(c?.roster) && c.roster.length > 0)
  return hasRosters || hasBoxscore || hasHeaderRoster
}

async function cacheEspnSummary(slug, eventId, log) {
  try {
    const url = `${ESPN_BASE}/${slug}/summary?event=${eventId}`
    const res = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      signal:  AbortSignal.timeout(6_000),
    })
    if (!res.ok) return
    const body = await res.text()
    const parsed = JSON.parse(body)
    if (!hasUsefulSummaryData(parsed)) return
    await kv.set(`espn:summary:${slug}:${eventId}`, body, { ex: SUMMARY_CACHE_TTL })
  } catch (e) {
    log.push(`[espn-summary-cache:${slug}:${eventId}] error=${e.message}`)
  }
}

// ── Résumé auto de match (recap) ────────────────────────────────────────────
// Moteur de phrases déterministe (pas de LLM) : gratuit, ne peut jamais
// échouer/timeout, toujours cohérent avec les vraies données du match.
// Extraction identique à api/fifa-live.js (dupliquée volontairement — même
// raison que hasUsefulData/hasUsefulSummaryData : fonctions Vercel séparées).
//
// comp.details vient directement du scoreboard ESPN (evt.competitions[0]),
// déjà fetché dans la boucle principale — zéro appel réseau supplémentaire.
function extractEspnScorers(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const txt = (d.type?.text ?? '').toLowerCase()
      const id  = String(d.type?.id ?? '')
      return txt.includes('goal') || txt === 'penaltykick' || id === '57' || id === '58' || id === '72'
    })
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      const txt = (d.type?.text ?? '').toLowerCase()
      return {
        name:        ath?.shortName ?? ath?.displayName ?? '?',
        minute:      d.clock?.displayValue ?? '',
        team:        d.team?.id === homeTeamId ? 'home' : 'away',
        ownGoal:     d.ownGoal ?? txt.includes('own') ?? false,
        penaltyKick: d.penaltyKick ?? txt.includes('penalty') ?? false,
      }
    })
}

function extractEspnCards(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const id = String(d.type?.id ?? '')
      return id === '93' || id === '94'
    })
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      return {
        name:   ath?.shortName ?? ath?.displayName ?? '?',
        minute: d.clock?.displayValue ?? '',
        team:   d.team?.id === homeTeamId ? 'home' : 'away',
        red:    d.redCard === true || String(d.type?.id) === '93',
      }
    })
}

const RECAP_TTL = 60 * 24 * 3600  // 60j — largement de quoi couvrir une compétition + consultation après coup

function parseMin(m) { return parseInt(String(m ?? '').replace(/[^\d]/g, ''), 10) || 0 }

/**
 * Génère un résumé de 2-4 phrases en français à partir des events réels du match.
 * Retourne null si les données sont trop incomplètes pour être fiables (aucun
 * scénario inventé, aucune approximation présentée comme un fait).
 */
function generateRecap({ homeTeam, awayTeam, home, away, scorers, cards }) {
  if (home == null || away == null) return null

  const diff    = Math.abs(home - away)
  const total   = home + away
  const winner  = home > away ? 'home' : away > home ? 'away' : null
  const winnerName = winner === 'home' ? homeTeam : winner === 'away' ? awayTeam : null
  const loserName  = winner === 'home' ? awayTeam : winner === 'away' ? homeTeam : null

  let intro
  if (winner === null) {
    intro = total === 0
      ? `${homeTeam} et ${awayTeam} n'ont pas réussi à se départager (0-0).`
      : `${homeTeam} et ${awayTeam} se quittent sur un match nul (${home}-${away}).`
  } else if (diff >= 3) {
    intro = `${winnerName} s'impose largement face à ${loserName} (${home}-${away}).`
  } else if (diff === 2) {
    intro = `${winnerName} prend le dessus sur ${loserName} (${home}-${away}).`
  } else {
    intro = `${winnerName} s'impose de justesse face à ${loserName} (${home}-${away}).`
  }

  const sortedGoals = [...(scorers ?? [])].sort((a, b) => parseMin(a.minute) - parseMin(b.minute))

  // But décisif tardif (>= 80e, dans une victoire à 1 but d'écart)
  const lastGoal = sortedGoals[sortedGoals.length - 1]
  if (winner && diff === 1 && lastGoal && parseMin(lastGoal.minute) >= 80 && lastGoal.team === winner) {
    intro += ` Le but décisif est tombé tardivement, à la ${lastGoal.minute}.`
  }

  // Remontée : l'équipe qui a ouvert le score n'est pas celle qui gagne
  if (winner && sortedGoals.length >= 2 && sortedGoals[0].team !== winner) {
    intro += ` ${winnerName} a renversé la situation après avoir été mené.`
  }

  if (total >= 5) {
    intro += ' Un match spectaculaire, riche en buts.'
  }

  let scorersLine = ''
  if (sortedGoals.length) {
    const label = g => `${g.name} (${g.minute}${g.ownGoal ? ', csc' : g.penaltyKick ? ', pen' : ''})`
    scorersLine = `Buteurs : ${sortedGoals.map(label).join(', ')}.`
  }

  const reds = (cards ?? []).filter(c => c.red)
  let cardsLine = ''
  if (reds.length === 1) {
    const teamName = reds[0].team === 'home' ? homeTeam : awayTeam
    cardsLine = `${teamName} a terminé la rencontre à 10 après le carton rouge de ${reds[0].name} (${reds[0].minute}).`
  } else if (reds.length > 1) {
    cardsLine = `La rencontre a été marquée par ${reds.length} exclusions.`
  }

  return [intro, scorersLine, cardsLine].filter(Boolean).join(' ')
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const secret     = req.headers['x-cron-secret'] ?? req.query.secret ?? ''
  const bearerAuth = req.headers['authorization'] ?? ''
  // Accepte : header x-cron-secret (cron-job.org), ?secret= (debug),
  //           ou Authorization: Bearer <CRON_SECRET> (Vercel Cron natif)
  const authorized =
    process.env.CRON_SECRET && (
      secret        === process.env.CRON_SECRET ||
      bearerAuth    === `Bearer ${process.env.CRON_SECRET}`
    )
  if (!authorized)
    return res.status(401).json({ error: 'Non autorisé' })

  if (!setupVapid())
    return res.status(503).json({ error: 'VAPID non configuré' })

  // Marqueur "dernière exécution" — lu par /api/debug-push pour vérifier que
  // cron-job.org appelle bien cet endpoint chaque minute. Avant ce fix,
  // aucune trace de la dernière exécution réelle n'existait nulle part :
  // impossible de distinguer "le cron tourne mais rien à notifier" de
  // "cron-job.org a arrêté d'appeler cet endpoint" (secret expiré, job
  // désactivé côté cron-job.org...) — cause plausible de notifs manquantes
  // non détectable depuis le code de l'app seul.
  try { await kv.set('cron:goals:lastRun', Date.now(), { ex: 7 * 24 * 3600 }) } catch {}

  const now       = new Date()
  const today     = dateStr(now)
  const yesterday = dateStr(new Date(now - 86_400_000))
  let notifsSent  = 0
  const log       = []

  // Fetch tous les slugs ESPN en parallèle (aujourd'hui + hier pour les matchs tardifs)
  const allResults = await Promise.allSettled(
    ESPN_SLUGS.flatMap(slug => [
      fetchEspnEvents(slug, today,     log).then(evts => evts.map(e => ({ slug, evt: e }))),
      fetchEspnEvents(slug, yesterday, log).then(evts => evts.map(e => ({ slug, evt: e }))),
    ])
  )

  const allEvents = allResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  log.push(`[espn] total events=${allEvents.length}`)

  // FIFA live — fetché une seule fois, utilisé pour accélérer la détection WC (voir plus bas)
  const hasWc = allEvents.some(({ slug }) => slug === 'fifa.world')
  const fifaLiveMatches = hasWc ? await fetchFifaLiveMatches(log) : []
  // Diagnostic temporaire (retard notif coup d'envoi signalé encore présent malgré
  // le fix fifa-override ci-dessous) : si cette ligne montre matches=0 à chaque
  // appel pendant qu'un match WC est en cours, ça veut dire que fetchFifaLiveMatches
  // échoue silencieusement (voir son catch) et que le fix ne se déclenche jamais —
  // exactement le même type de panne que l'API FotMob (voir useFotmobXG, retiré).
  if (hasWc) log.push(`[fifa:live] matches=${fifaLiveMatches.length}`)

  for (const { slug, evt } of allEvents) {
    const comp = evt.competitions?.[0]
    if (!comp) continue

    let   status   = comp.status?.type?.name ?? ''
    const homeC    = comp.competitors?.find(c => c.homeAway === 'home')
    const awayC    = comp.competitors?.find(c => c.homeAway === 'away')
    if (!homeC || !awayC) continue

    let   home     = parseInt(homeC.score ?? '0', 10) || 0
    let   away     = parseInt(awayC.score ?? '0', 10) || 0
    const homeTeam = t(homeC.team?.shortDisplayName ?? homeC.team?.displayName ?? '?')
    const awayTeam = t(awayC.team?.shortDisplayName ?? awayC.team?.displayName ?? '?')
    const eventId  = evt.id

    // Diagnostic temporaire : vérifie si comp.status.displayClock (l'horloge)
    // avance déjà pendant que status reste bloqué sur SCHEDULED après l'heure
    // programmée — ça dira si la minute/clock ESPN est une donnée indépendante
    // du statut (auquel cas la détecter serait utile) ou si elle vient du même
    // flux et est donc bloquée en même temps (auquel cas ça n'aiderait pas).
    if (slug === 'fifa.world' && status === 'STATUS_SCHEDULED' && evt.date && Date.now() >= new Date(evt.date).getTime()) {
      log.push(`[espn:${slug}:${eventId}] SCHEDULED mais heure passée — displayClock="${comp.status?.displayClock ?? ''}"`)
    }

    // ── FIX retard notif WC : ESPN lag ~10min sur le statut du slug 'fifa.world' ──
    // Si ESPN dit encore SCHEDULED mais que l'API FIFA officielle confirme que le
    // match a commencé (Period != 0), on bascule immédiatement en IN_PROGRESS →
    // notif coup d'envoi (et détection de buts) sans attendre ESPN.
    if (slug === 'fifa.world' && fifaLiveMatches.length > 0) {
      const rawHome = homeC.team?.displayName ?? homeC.team?.shortDisplayName ?? ''
      const rawAway = awayC.team?.displayName ?? awayC.team?.shortDisplayName ?? ''
      const fifaMatch = fifaLiveMatches.find(m => {
        const homeNames = fifaTeamNamesAll(m.HomeTeam)
        const awayNames = fifaTeamNamesAll(m.AwayTeam)
        return homeNames.some(n => fuzzyTeamFifa(rawHome, n)) && awayNames.some(n => fuzzyTeamFifa(rawAway, n))
      })
      // Diagnostic temporaire : si le match ESPN est encore SCHEDULED après
      // l'heure prévue mais qu'aucun match FIFA ne matche, on veut voir
      // EXACTEMENT les noms comparés pour savoir si c'est un problème de
      // matching de noms (ESPN "X" vs FIFA "Y" jamais reconnus comme pareils)
      // plutôt que de deviner un correctif au hasard.
      if (!fifaMatch && status === 'STATUS_SCHEDULED' && evt.date && Date.now() >= new Date(evt.date).getTime()) {
        const fifaAllNames = fifaLiveMatches.map(m =>
          `[${fifaTeamNamesAll(m.HomeTeam).join('/')} vs ${fifaTeamNamesAll(m.AwayTeam).join('/')}]`
        ).join(' ')
        log.push(`[fifa-match-fail:${eventId}] ESPN="${rawHome}" vs "${rawAway}" — FIFA dispo: ${fifaAllNames || '(aucun)'}`)
      }
      if (fifaMatch) {
        const fifaStatus = fifaEffectiveStatus(fifaMatch)
        if (status === 'STATUS_SCHEDULED' && fifaStatus) {
          status = fifaStatus
          log.push(`[fifa-override:${eventId}] ESPN=SCHEDULED → FIFA=${fifaStatus} (KO anticipé)`)
        } else if (status === 'STATUS_IN_PROGRESS' && fifaStatus === 'STATUS_HALFTIME') {
          // ESPN n'a pas encore basculé sur la pause → FIFA la confirme plus vite.
          // (Jamais l'inverse : on ne fait pas confiance à FIFA pour repasser
          // HALFTIME → IN_PROGRESS ni pour déclarer une fin de match.)
          status = 'STATUS_HALFTIME'
          log.push(`[fifa-override:${eventId}] ESPN=IN_PROGRESS → FIFA=HALFTIME (mi-temps anticipée)`)
        }
        const fh = fifaMatch.HomeTeam?.Score
        const fa = fifaMatch.AwayTeam?.Score
        if (typeof fh === 'number') home = Math.max(home, fh)
        if (typeof fa === 'number') away = Math.max(away, fa)
      }
    }

    const score    = `${home}-${away}`
    const scoreStr = `${home} – ${away}`

    // Capture proactive compos/stats/événements pendant que le match est en
    // direct — voir cacheEspnSummary() plus haut. Tourne pour CHAQUE match
    // live à CHAQUE poll (1/min), suivi ou non par un utilisateur.
    if (LIVE_ESPN.has(status)) {
      await cacheEspnSummary(slug, eventId, log)
    }

    // 🔴 Coup d'envoi — basé sur l'heure de coup d'envoi PROGRAMMÉE (evt.date),
    // pas sur le statut "live" ESPN qui a un lag connu (~10min sur le slug WC,
    // voir fifa-override plus haut). evt.date est une donnée fixe connue à
    // l'avance, sans lag possible : dès qu'elle est dépassée, on notifie —
    // beaucoup plus simple et fiable que de dépendre d'une 2e API externe
    // (FIFA) pour accélérer la détection du statut live. sendDeduped()
    // garantit qu'on n'envoie qu'une seule fois par match (clé Redis dédiée).
    const kickoffAt     = evt.date ? new Date(evt.date).getTime() : null
    const kickoffPassed = kickoffAt != null && Date.now() >= kickoffAt
    const notPostponed  = status !== 'STATUS_POSTPONED' && status !== 'STATUS_CANCELED'
    if (kickoffPassed && notPostponed && !FINAL_ESPN.has(status)) {
      // TTL de dédup à 6h (au lieu du défaut 3h) : cette notif se redéclenche
      // tant que le match n'est pas détecté "final" — avec le fix FINAL_ESPN
      // ci-dessus ça ne devrait plus arriver, mais 6h laisse une marge de
      // sécurité si un statut ESPN imprévu (autre variante FINAL_*) passait
      // encore à travers, plutôt que de retomber sur 3h qui peut être trop
      // court pour un match prolongation+tab (jusqu'à ~3h).
      const sent = await sendDeduped(`push:espn:ko:${eventId}`,
        { title: "🔴 Coup d'envoi !", body: `${homeTeam} – ${awayTeam}`, url: '/live' }, slug, log, 6 * 3600)
      if (sent > 0) { notifsSent++; log.push(`[espn:${slug}:${eventId}] KO (heure programmée)`) }
    }

    const stateKey  = `cron:espn:${eventId}`
    let   prevState = null
    try { prevState = await kv.get(stateKey) } catch {}
    const [prevStatus = null, prevScore = null] = prevState ? prevState.split('|') : []

    // Sauvegarder état courant (TTL 12h)
    try { await kv.set(stateKey, `${status}|${score}`, { ex: 12 * 3600 }) } catch {}

    // Premier poll → baseline, pas de notif de changement d'état (le KO est
    // déjà géré ci-dessus, indépendamment de prevState).
    if (prevState === null) {
      log.push(`[espn:${slug}:${eventId}] baseline ${status}|${score}`)
      continue
    }

    // ⚽ But — score différent du poll précédent, alors que le match était en
    // direct au poll précédent. Volontairement PAS restreint au statut ACTUEL
    // encore "en direct" (ancien bug) : un but marqué en toute fin de mi-temps
    // ou de match additionnelle peut, sur le même poll (1/min), coïncider avec
    // le passage déjà détecté à STATUS_HALFTIME/STATUS_FINAL côté ESPN — dans
    // ce cas l'ancienne condition (LIVE_ESPN.has(status) && status !==
    // 'STATUS_HALFTIME') supprimait purement et simplement la notif de but,
    // alors que c'est justement le cas le plus fréquent (but à la 45e+/90e+).
    // Seule exclusion légitime : un changement de score alors qu'on était DÉJÀ
    // en mi-temps au poll précédent ET qu'on y est toujours (vraie pause,
    // aucun but possible) — ça correspond à une correction tardive de données
    // ESPN, pas un but réel.
    const steadyHalftime = prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME'
    if (
      LIVE_ESPN.has(prevStatus) &&
      !steadyHalftime &&
      prevScore !== null &&
      prevScore !== score
    ) {
      log.push(`[espn:${slug}:${eventId}] BUT ${prevScore} → ${score}`)

      // ⚠️ BUG CORRIGÉ : la notif de but n'affichait jamais le buteur ("But !"
      // générique) alors que comp.details (déjà fetché à chaque poll) contient
      // les buts détaillés — extractEspnScorers() plus haut dans ce fichier
      // s'en sert déjà pour générer le résumé de fin de match, jamais réutilisé
      // ici. On identifie le camp qui vient de marquer (score qui a augmenté)
      // et on prend son dernier but connu (le plus tardif) = celui qui vient
      // d'arriver. Fallback silencieux sur le titre générique si ESPN n'a pas
      // encore mis à jour comp.details (arrive parfois quelques secondes après
      // le changement de score) — jamais bloquant pour l'envoi de la notif.
      const [prevHome, prevAway] = (prevScore ?? '0-0').split('-').map(n => parseInt(n, 10) || 0)
      const scoringSide  = home > prevHome ? 'home' : away > prevAway ? 'away' : null
      const scoringTeam  = scoringSide === 'home' ? homeTeam : scoringSide === 'away' ? awayTeam : null
      const goalScorers  = scoringSide ? extractEspnScorers(comp, homeC.team?.id).filter(g => g.team === scoringSide) : []
      const lastScorer   = goalScorers.sort((a, b) => parseMin(a.minute) - parseMin(b.minute)).pop()
      // Format "But pour {équipe} (joueur[, pen/csc]) minute'" — même convention
      // (nom + ", pen"/", csc" entre parenthèses) que generateRecap() plus haut
      // dans ce fichier, pour rester cohérent. Fallback générique si ESPN n'a
      // pas encore mis à jour comp.details au moment exact du poll (quelques
      // secondes de décalage possible) — jamais bloquant pour l'envoi.
      const scorerSuffix = lastScorer ? (lastScorer.ownGoal ? ', csc' : lastScorer.penaltyKick ? ', pen' : '') : ''
      const minuteText   = lastScorer ? minuteLabel(lastScorer.minute) : ''
      const goalTitle    = (lastScorer && scoringTeam)
        ? `⚽ But pour ${scoringTeam} (${lastScorer.name}${scorerSuffix})${minuteText ? ` ${minuteText}` : ''}`
        : '⚽ But !'

      // tag explicite et UNIQUE par but (inclut le score) : sans ça, sw-push.js
      // retombe sur un tag par défaut basé uniquement sur matchId, donc PARTAGÉ
      // entre tous les buts d'un même match. Un 2e but réutiliserait alors le
      // même tag que le 1er — sur certaines plateformes (iOS notamment), la
      // notif ne prévient pas forcément l'utilisateur de la même façon la 2e
      // fois (le natif traite ça comme un remplacement, pas un nouvel avertissement,
      // selon comment le swipe/lecture du 1er a été géré). Un tag unique par but
      // supprime totalement ce risque : chaque but est une notif indépendante,
      // jamais un remplacement silencieux d'une précédente.
      const sent = await sendDeduped(`push:espn:goal:${eventId}:${score}`,
        { title: goalTitle, body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live', matchId: eventId, tag: `goal-${eventId}-${score}` }, slug, log)
      if (sent > 0) notifsSent++
    }

    // ⏸ Mi-temps
    if (LIVE_ESPN.has(prevStatus) && prevStatus !== 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME') {
      log.push(`[espn:${slug}:${eventId}] mi-temps`)
      const sent = await sendDeduped(`push:espn:ht:${eventId}`,
        { title: '⏸ Mi-temps', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, log)
      if (sent > 0) notifsSent++
    }

    // ▶️ Reprise 2ème MT
    if (prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_IN_PROGRESS') {
      log.push(`[espn:${slug}:${eventId}] reprise`)
      const sent = await sendDeduped(`push:espn:2h:${eventId}`,
        { title: '▶️ Reprise !', body: `2ème MT · ${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, log)
      if (sent > 0) notifsSent++
    }

    // 🏁 Fin de match — garde anti-faux FT : ESPN STATUS_FINAL est fiable, on le prend tel quel
    if (LIVE_ESPN.has(prevStatus) && FINAL_ESPN.has(status)) {
      log.push(`[espn:${slug}:${eventId}] FT`)
      const sent = await sendDeduped(`push:espn:ft:${eventId}`,
        { title: '🏁 Fin de match', body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live' }, slug, log)
      if (sent > 0) notifsSent++
      // Capture finale — le boxscore/évènements se stabilisent parfois
      // quelques secondes après le sifflet final (corrections tardives).
      await cacheEspnSummary(slug, eventId, log)
    }

    // 📝 Résumé auto — tant qu'aucun recap n'est stocké pour ce match terminé,
    // on retente à chaque poll (1/min). Nécessaire car comp.details (buteurs/
    // cartons) peut arriver quelques dizaines de secondes après le FT — un
    // essai unique au moment exact de la transition manquerait parfois un but
    // tardif. S'arrête naturellement quand cron:espn:${eventId} expire (12h,
    // voir stateKey plus haut) : le match sort alors de la boucle de rattrapage.
    if (FINAL_ESPN.has(status)) {
      try {
        const already = await kv.get(`recap:${eventId}`)
        if (!already) {
          const scorers = extractEspnScorers(comp, homeC.team?.id)
          const cards   = extractEspnCards(comp, homeC.team?.id)
          const recap   = generateRecap({ homeTeam, awayTeam, home, away, scorers, cards })
          if (recap) {
            await kv.set(`recap:${eventId}`, recap, { ex: RECAP_TTL })
            log.push(`[recap:${eventId}] généré`)
          }
        }
      } catch (e) {
        log.push(`[recap:${eventId}] error=${e.message}`)
      }
    }

    // 📊 Ticker "score en direct" — uniquement pour les abonnés qui suivent
    // une des deux équipes (jamais envoyé aux abonnés sans filtre configuré,
    // pour ne pas transformer l'app en spam pour tout le monde). Même `tag`
    // à chaque minute → remplace la notif précédente au lieu d'empiler
    // (silent + renotify:false côté SW → pas de nouveau son/vibration).
    if (LIVE_ESPN.has(status)) {
      const minuteLabel = status === 'STATUS_HALFTIME' ? 'Mi-temps' : `${comp.status?.displayClock ?? ''}`.trim()
      await sendPushToMatch(
        {
          title: `${homeTeam} ${scoreStr} ${awayTeam}`,
          body:  minuteLabel ? `⏱ ${minuteLabel}` : 'En direct',
          url:   '/live',
          matchId: eventId,
          tag:     `live-${eventId}`,
          silent:  true,
          renotify: false,
        },
        slug,
        { onlyFavorites: true },
        log,
      )
    }
  }

  // Résultat détaillé de CETTE exécution — utile pour /api/debug-push (voir
  // marqueur lastRun plus haut) : distingue "0 notif car rien à notifier" de
  // "le cron ne tourne plus du tout".
  try {
    await kv.set('cron:goals:lastResult', JSON.stringify({
      at: Date.now(), events: allEvents.length, notifsSent,
    }), { ex: 7 * 24 * 3600 })
  } catch {}

  return res.status(200).json({
    ok: true,
    slugs: ESPN_SLUGS.length,
    events: allEvents.length,
    notifsSent,
    log,
  })
}
