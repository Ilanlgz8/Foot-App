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

  // ── Une "passe" = un cycle complet fetch ESPN + traitement de tous les
  // événements, identique à ce que faisait cet endpoint avant (une seule
  // fois par appel cron-job.org, donc au mieux toutes les 60s). Extrait en
  // fonction pour pouvoir être rejouée PLUSIEURS fois au sein du même appel
  // (voir boucle interne juste après la définition) — c'est ça qui réduit le
  // délai réel sans dépendre d'un cron plus fréquent que 60s (cron-job.org
  // ne descend jamais sous la minute, même sur un plan payant).
  async function runOnePass() {
    const log      = []
    let notifsSent = 0
    const now       = new Date()
    const today     = dateStr(now)
    const yesterday = dateStr(new Date(now - 86_400_000))

  // Fetch tous les slugs ESPN en parallèle (aujourd'hui + hier pour les matchs tardifs)
  const allResults = await Promise.allSettled(
    ESPN_SLUGS.flatMap(slug => [
      fetchEspnEvents(slug, today,     log).then(evts => evts.map(e => ({ slug, evt: e }))),
      fetchEspnEvents(slug, yesterday, log).then(evts => evts.map(e => ({ slug, evt: e }))),
    ])
  )

  const allEvents = allResults.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  // ⚠️ Ces 2 lignes de diagnostic (total events / matches FIFA live) étaient
  // loggées à CHAQUE passe, identiques la plupart du temps — ça remplissait le
  // buffer glissant `cron:goals:logHistory` (1000 lignes) de bruit sans intérêt
  // en ~1h30-2h (constat : un but signalé par l'utilisateur n'était déjà plus
  // dans l'historique au moment où il l'a vérifié). Le nombre d'events est de
  // toute façon déjà visible dans la ligne "[pass N] notifs=X events=Y" ajoutée
  // par la boucle multi-passes plus bas — pas la peine de le dupliquer ici.
  // Retiré de la persistance pour laisser la place à des lignes réellement
  // utiles (KO/but/mi-temps/fin) sur une fenêtre de temps plus longue.

  // FIFA live — fetché une seule fois, utilisé pour accélérer la détection WC (voir plus bas)
  const hasWc = allEvents.some(({ slug }) => slug === 'fifa.world')
  const fifaLiveMatches = hasWc ? await fetchFifaLiveMatches(log) : []

  for (const { slug, evt } of allEvents) {
   // ⚠️ Durcissement : avant, une erreur inattendue sur UN SEUL match (donnée
   // ESPN malformée, champ manquant non prévu...) faisait planter TOUT le
   // reste de la boucle — donc tous les autres matchs de cette passe, y
   // compris ceux dont la notif était sur le point de partir. Avec la boucle
   // interne (plusieurs passes par appel, voir plus bas), une passe entière
   // perdue pèse un peu plus qu'avant sur le total. Un try/catch par match
   // isole le problème : un match cassé est loggé et ignoré, les autres
   // continuent d'être traités normalement dans la même passe.
   try {
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

    // 🔴 Coup d'envoi — basé sur la confirmation RÉELLE (statut LIVE_ESPN, déjà
    // corrigé par le fifa-override ci-dessus pour compenser le lag ESPN connu
    // sur le Mondial), plutôt que sur l'heure programmée (evt.date).
    // ⚠️ Avant : notifiait dès l'heure prévue dépassée, même si le coup
    // d'envoi réel avait du retard (VAR, retard d'équipe...) — décalage
    // signalé par l'utilisateur, symétrique au bug corrigé côté affichage
    // client (calcMinute affichait "1'" avant la vraie confirmation ESPN,
    // voir useLiveMinute.js/matchUtils.js). Même correctif appliqué ici pour
    // rester cohérent : la notif part exactement quand le match passe "Débute"
    // → minute réelle côté client. sendDeduped() garantit un envoi unique par
    // match, peu importe le nombre de polls où LIVE_ESPN.has(status) reste vrai.
    const notPostponed = status !== 'STATUS_POSTPONED' && status !== 'STATUS_CANCELED'
    if (LIVE_ESPN.has(status) && notPostponed) {
      // TTL de dédup à 6h : marge de sécurité pour un match prolongation+tab
      // (peut dépasser 3h depuis le coup d'envoi).
      const sent = await sendDeduped(`push:espn:ko:${eventId}`,
        { title: "🔴 Coup d'envoi !", body: `${homeTeam} – ${awayTeam}`, url: '/live' }, slug, log, 6 * 3600)
      if (sent > 0) { notifsSent++; log.push(`[espn:${slug}:${eventId}] KO (confirmé ESPN)`) }
    }

    const stateKey  = `cron:espn:${eventId}`
    let   prevState = null
    try { prevState = await kv.get(stateKey) } catch {}
    const [prevStatus = null, prevScore = null] = prevState ? prevState.split('|') : []

    // Sauvegarder état courant (TTL 12h)
    try { await kv.set(stateKey, `${status}|${score}`, { ex: 12 * 3600 }) } catch {}

    // Premier poll → baseline, pas de notif de changement d'état (le KO est
    // déjà géré ci-dessus, indépendamment de prevState). On initialise aussi
    // le compteur "buts déjà notifiés" (goalTrack, voir bloc But ci-dessous)
    // sur le score de départ, pour ne jamais déclencher un rattrapage
    // rétroactif sur des buts antérieurs au premier poll de ce match.
    if (prevState === null) {
      log.push(`[espn:${slug}:${eventId}] baseline ${status}|${score}`)
      try { await kv.set(`goalTrack:${eventId}`, JSON.stringify({ home, away, pendingSince: {} }), { ex: 12 * 3600 }) } catch {}
      continue
    }

    // ⚽ But — approche "toujours complète, quitte à attendre un peu" (choix
    // explicite de l'utilisateur, en alternative à l'envoi immédiat parfois
    // générique). Au lieu de notifier dès que le score diffère du poll
    // précédent, on compare le score actuel à un compteur persistant "buts
    // déjà notifiés par camp" (goalTrack:${eventId}) : si comp.details n'a pas
    // encore le nom du buteur, on RETENTE aux polls suivants (jusqu'à 5 min)
    // au lieu d'envoyer tout de suite un "⚽ But !" générique définitif —
    // sendDeduped() garde son rôle habituel (une seule notif par but), le
    // compteur sert uniquement à décider QUAND l'appeler.
    //
    // ⚠️ BUG CORRIGÉ (constat utilisateur : Maroc-Canada, 2 buts marocains,
    // aucune notif reçue) : quand le score d'un même camp montait de PLUS DE 1
    // entre deux passes (ex: 0 → 2 directement, deux buts marqués dans le même
    // intervalle de poll — plausible avec ~8-36s entre passes), l'ancien code
    // ne traitait qu'UNE seule "side" par camp (peu importe l'écart), envoyait
    // UNE SEULE notif (celle du dernier buteur connu), puis faisait sauter le
    // compteur directement à la nouvelle valeur (`track[side] = home`) — ce qui
    // marquait silencieusement les DEUX buts comme "déjà notifiés" alors qu'un
    // seul push avait réellement été envoyé. Fix : on compare le compteur déjà
    // notifié (track[side]) au nombre RÉEL de buts attendus (home/away), et on
    // boucle un but à la fois (while) — un envoi par but manquant, chacun avec
    // son propre scorer (goalScorers[n]) s'il est déjà connu côté ESPN, sinon
    // on s'arrête à ce but précis et on retente au poll suivant (les buts
    // suivants, eux, restent bloqués derrière tant que celui-ci n'est pas résolu
    // — comportement voulu : préserve l'ordre chronologique d'envoi).
    //
    // Effet de bord corrigé au passage : pendingSince était un champ UNIQUE
    // partagé pour tout le match, donc faux si les DEUX équipes attendaient
    // un buteur en même temps (le délai de l'une écrasait celui de l'autre).
    // Passé en objet { home, away } pour être vraiment indépendant par camp.
    //
    // Exclusion conservée de l'ancienne logique : un changement de score alors
    // qu'on était DÉJÀ en mi-temps au poll précédent ET qu'on y est toujours
    // (vraie pause, aucun but possible) = correction tardive de données ESPN,
    // pas un but réel → absorbé silencieusement dans le compteur, jamais notifié.
    const steadyHalftime = prevStatus === 'STATUS_HALFTIME' && status === 'STATUS_HALFTIME'
    if (LIVE_ESPN.has(prevStatus) || LIVE_ESPN.has(status) || FINAL_ESPN.has(status)) {
      const trackKey = `goalTrack:${eventId}`
      let track = null
      try { track = await kv.get(trackKey) } catch {}
      track = track ? (typeof track === 'string' ? JSON.parse(track) : track) : { home, away, pendingSince: {} }
      // Migration douce : anciennes entrées Redis avec pendingSince en number/null
      if (!track.pendingSince || typeof track.pendingSince !== 'object') track.pendingSince = {}

      const sides = []
      if (home > track.home) sides.push('home')
      if (away > track.away) sides.push('away')

      let trackChanged = false
      // Une fois le match final, plus de nouveau poll utile à attendre pour ce
      // match (il sort bientôt de la fenêtre today/yesterday) → on résout tout
      // de suite avec ce qu'on a, plutôt que de laisser un but en attente
      // indéfiniment sans jamais pouvoir le rattraper.
      const forceNow = FINAL_ESPN.has(status)

      for (const side of sides) {
        const targetCount = side === 'home' ? home : away

        if (steadyHalftime) {
          track[side] = targetCount
          trackChanged = true
          continue
        }

        const scoringTeam = side === 'home' ? homeTeam : awayTeam
        const goalScorers = extractEspnScorers(comp, homeC.team?.id)
          .filter(g => g.team === side)
          .sort((a, b) => parseMin(a.minute) - parseMin(b.minute))

        const pendingSince  = track.pendingSince[side] ?? Date.now()
        const waitedTooLong = forceNow || (Date.now() - pendingSince > 5 * 60_000)

        // Un but à la fois — tant que track[side] < targetCount, il reste au
        // moins un but réel non notifié.
        while (track[side] < targetCount) {
          const goalIndex = track[side] // 0 = 1er but de ce camp, 1 = 2e, etc.
          const scorer     = goalScorers[goalIndex] ?? null

          if (!scorer && !waitedTooLong) {
            if (!track.pendingSince[side]) { track.pendingSince[side] = pendingSince; trackChanged = true }
            log.push(`[espn:${slug}:${eventId}] BUT ${side} en attente du buteur (${goalIndex + 1}/${targetCount})`)
            break // ce but (et les suivants) retentera au prochain poll
          }

          // Format "But pour {équipe} (joueur[, pen/csc]) minute'" — même
          // convention (nom + ", pen"/", csc" entre parenthèses) que
          // generateRecap() plus haut dans ce fichier, pour rester cohérent.
          // Fallback générique uniquement si le délai de 5 min est dépassé sans
          // qu'ESPN n'ait jamais rattaché de buteur (rare, mais mieux que de ne
          // jamais notifier ce but).
          const scorerSuffix = scorer ? (scorer.ownGoal ? ', csc' : scorer.penaltyKick ? ', pen' : '') : ''
          const minuteText   = scorer ? minuteLabel(scorer.minute) : ''
          const goalTitle    = scorer
            ? `⚽ But pour ${scoringTeam} (${scorer.name}${scorerSuffix})${minuteText ? ` ${minuteText}` : ''}`
            : '⚽ But !'

          log.push(`[espn:${slug}:${eventId}] BUT ${side} ${goalIndex + 1}/${targetCount}${scorer ? '' : ' (générique, délai dépassé)'}`)

          // Clé de dédup basée sur "le Nème but de ce camp dans ce match" —
          // stable et unique même si 2 buts du même camp partagent le même
          // score de départ/arrivée entre deux passes (contrairement à
          // l'ancienne clé basée sur le score complet, qui ne pouvait pas
          // distinguer 2 buts consécutifs du même camp).
          const sent = await sendDeduped(`push:espn:goal:${eventId}:${side}:${goalIndex + 1}`,
            { title: goalTitle, body: `${homeTeam} ${scoreStr} ${awayTeam}`, url: '/live', matchId: eventId, tag: `goal-${eventId}-${side}-${goalIndex + 1}` }, slug, log)
          if (sent > 0) notifsSent++

          track[side]++
          track.pendingSince[side] = null
          trackChanged = true
        }
      }

      if (trackChanged) {
        try { await kv.set(trackKey, JSON.stringify(track), { ex: 12 * 3600 }) } catch {}
      }
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
   } catch (e) {
     log.push(`[espn:${slug}:${evt?.id ?? '?'}] ERREUR match ignoré : ${e.message}`)
   }
  }

    return { notifsSent, events: allEvents.length, log }
  }

  // ── Boucle interne : plusieurs passes par appel cron-job.org ────────────
  // ⚠️ cron-job.org ne descend jamais sous 1 appel/minute (vérifié — limite
  // dure de leur service, même sur un plan payant) : impossible d'aller plus
  // vite en augmentant la fréquence du cron externe. En revanche, RIEN
  // n'empêche CET appel de faire plusieurs passes ESPN à l'intérieur de lui-
  // même avant de répondre — c'est ce qu'on fait ici, gratuitement, sans
  // nouvelle infra. Seule contrainte réelle : le plan gratuit de cron-job.org
  // coupe la connexion après 30s d'exécution (leur FAQ), donc on reste
  // volontairement sous cette limite (BUDGET_MS) par sécurité — sur un
  // compte "Sustaining Member" payant chez eux (limite plus haute), BUDGET_MS
  // peut être augmenté sans toucher au reste du code.
  //
  // ⚠️ IMPORTANT pour comprendre le vrai gain : le pire délai n'est PAS
  // POLL_INTERVAL_MS (l'écart entre les passes internes), il est dominé par
  // le "trou mort" entre la DERNIÈRE passe d'un appel et la 1ère passe de
  // l'appel suivant (60s plus tard) = environ (60 - BUDGET_MS). Faire plus de
  // passes internes rapprochées n'aide quasiment pas le pire cas si
  // BUDGET_MS reste petit — le vrai levier, c'est de pousser BUDGET_MS aussi
  // près que possible des 30s de cron-job.org. Avec BUDGET_MS=26s : passes
  // à peu près à 0/8/16/24s, trou mort ≈ 60-24 = 36s → pire cas ≈ 35-36s
  // (au lieu de 60s avant, et 48s avec une 1ère version moins bien réglée
  // de cette boucle qui ne poussait pas assez BUDGET_MS).
  const BUDGET_MS         = 26_000  // le plus proche possible des 30s de cron-job.org (marge de 4s)
  const POLL_INTERVAL_MS  = 8_000   // passes rapprochées → réduit surtout le délai MOYEN, pas le pire cas
  const loopStart = Date.now()
  const allLogs   = []
  let totalNotifs = 0
  let totalEvents = 0
  let passes      = 0

  while (true) {
    const passStart = Date.now()
    // ⚠️ Durcissement : si runOnePass() lève une erreur inattendue AVANT même
    // d'entrer dans la boucle par-match (ex: le fetch ESPN groupé plante), on
    // ne veut pas perdre TOUTE la réponse HTTP (et donc que cron-job.org voie
    // un échec/timeout au lieu d'un 200 avec le détail de l'erreur). On log
    // et on arrête proprement la boucle plutôt que de laisser l'exception
    // remonter jusqu'au handler (qui n'a pas de try/catch englobant).
    try {
      const result = await runOnePass()
      totalNotifs += result.notifsSent
      totalEvents  = result.events
      allLogs.push(`[pass ${passes + 1}] notifs=${result.notifsSent} events=${result.events}`, ...result.log)
      passes++
    } catch (e) {
      allLogs.push(`[pass ${passes + 1}] ERREUR passe entière : ${e.message}`)
      break
    }

    const elapsedTotal = Date.now() - loopStart
    const remaining    = BUDGET_MS - elapsedTotal
    if (remaining <= POLL_INTERVAL_MS) break // pas assez de marge pour une passe de plus
    const elapsedPass = Date.now() - passStart
    await new Promise(r => setTimeout(r, Math.max(0, POLL_INTERVAL_MS - elapsedPass)))
  }

  // Résultat détaillé de CETTE exécution — utile pour /api/debug-push (voir
  // marqueur lastRun plus haut) : distingue "0 notif car rien à notifier" de
  // "le cron ne tourne plus du tout".
  try {
    await kv.set('cron:goals:lastResult', JSON.stringify({
      at: Date.now(), events: totalEvents, notifsSent: totalNotifs, passes,
    }), { ex: 7 * 24 * 3600 })
  } catch {}

  // ⚠️ Historique persistant des logs (constat utilisateur : notifs de but/fin
  // de match manquées sans qu'on puisse voir a posteriori ce qui s'est passé
  // côté serveur — jusqu'ici, `log` n'existait que dans la réponse HTTP de
  // CET appel précis, jamais consultable après coup). On empile chaque ligne
  // (préfixée d'un horodatage) dans une liste Redis glissante, exposée par
  // /api/debug-push, pour pouvoir diagnostiquer un incident après qu'il se
  // soit produit plutôt que de deviner sans preuve.
  try {
    if (allLogs.length) {
      const stamped = allLogs.map(l => `${new Date().toISOString()} ${l}`)
      await kv.rpush('cron:goals:logHistory', ...stamped)
      // Cap relevé 1000 → 4000 : avec le bruit en moins (voir ci-dessus), une
      // ligne "[pass N] notifs=X events=Y" par passe (~3-4/min) consomme
      // beaucoup moins vite le buffer — vise plusieurs heures d'historique
      // au lieu d'1h30-2h, pour pouvoir vérifier un incident signalé après coup.
      await kv.ltrim('cron:goals:logHistory', -4000, -1)
      await kv.expire('cron:goals:logHistory', 24 * 3600)
    }
  } catch {}

  return res.status(200).json({
    ok: true,
    slugs: ESPN_SLUGS.length,
    passes,
    events: totalEvents,
    notifsSent: totalNotifs,
    log: allLogs,
  })
}
