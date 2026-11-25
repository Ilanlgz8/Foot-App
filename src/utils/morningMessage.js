// Rappel du matin (10h, notif aux abonnés qui suivent l'une des deux équipes) — texte du message.
// 24/11 (demande utilisateur) : au lieu d'un message fixe, le fait le plus intéressant du match,
// toujours tiré des vraies données (jamais inventé : une donnée manquante = règle sautée), sans
// emoji ni cotes. Partagé : utilisé par le Worker Cloudflare (cf-worker/src/index.js,
// morningReminders) ; fonctions pures, testées dans morningMessage.test.js.
//
// Format (25/11, choisi avec l'utilisateur) :
//   titre  : « Le PSG reçoit Rome en Ligue des champions » (point de vue de l'équipe suivie ;
//            « défie » à l'extérieur ; classico : « C'est le classico : le PSG reçoit l'OM »)
//   ligne 1: « Ce soir à 21:00 · À regarder sur CANAL+ »
//   ligne 2: UNE phrase d'enjeu, la plus forte, et SEULEMENT si elle est sûre — sinon rien :
//     1. sûr mathématiquement (matchs restants de TOUTES les équipes) : champion / relégué / qualifié
//        pour les 8es / au moins les barrages / éliminé ;
//     2. tour de coupe (match unique) : « Une victoire et Lens file en quarts » / remporte la coupe ;
//     3. dépasse une équipe nommée ou prend la tête — seulement si cette équipe ne joue pas
//        aujourd'hui (ou si c'est l'adversaire) ; égalité de points départagée à la différence de buts
//        uniquement là où c'est la règle (LDC, Premier League), sinon pas d'annonce ;
//     4. fait : bilan parfait (« 4 victoires en 4 matchs de LDC ») / invaincu / 5 victoires de suite.
// Le titre et l'enjeu dépendent de l'équipe suivie → variantes home / away, choisies par
// api/cron-goals.js (payloadFor) selon l'équipe favorite de chaque abonné.
import { getBroadcaster } from '../data/broadcasters.js'

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Classicos : UN seul par championnat, liste fixée par l'utilisateur (24/11) — PSG-OM, Real-Barça,
// City-Arsenal, Inter-Milan, Bayern-Dortmund. Rien d'autre (ni derbys locaux, ni sélections).
const CLUBS = {
  psg: ['paris saint germain', 'psg', 'paris sg'], om: ['marseille', 'olympique de marseille', 'om'],
  real: ['real madrid'], barca: ['barcelona', 'fc barcelona', 'barcelone', 'barca'],
  city: ['manchester city', 'man city'], arsenal: ['arsenal'],
  inter: ['internazionale', 'inter milan', 'inter'], milan: ['ac milan', 'milan'],
  bayern: ['bayern munich', 'bayern munchen', 'bayern'], bvb: ['borussia dortmund', 'dortmund'],
}
const CLASSICOS = [['psg', 'om'], ['real', 'barca'], ['city', 'arsenal'], ['inter', 'milan'], ['bayern', 'bvb']]
export function clubKey(...names) {
  const ns = names.map(norm).filter(Boolean)
  return Object.keys(CLUBS).find(k => ns.some(n => CLUBS[k].includes(n))) ?? null
}
export function isClassico(home, away) {
  const h = clubKey(...home.names), a = clubKey(...away.names)
  return !!h && !!a && CLASSICOS.some(([x, y]) => (x === h && y === a) || (x === a && y === h))
}

export const COMP_NAMES = {
  'fra.1': 'Ligue 1', 'fra.2': 'Ligue 2', 'eng.1': 'Premier League', 'esp.1': 'LaLiga', 'ger.1': 'Bundesliga', 'ita.1': 'Serie A',
  'uefa.champions': 'Ligue des champions', 'uefa.europa': 'Ligue Europa', 'uefa.europa.conf': 'Ligue Conférence',
  'fra.coupe_de_france': 'Coupe de France', 'esp.copa_del_rey': 'Copa del Rey', 'eng.fa': 'FA Cup',
  'ita.coppa_italia': 'Coupe d’Italie', 'ger.dfb_pokal': 'Coupe d’Allemagne',
  'fra.super_cup': 'Trophée des champions', 'eng.charity': 'Community Shield', 'esp.super_cup': 'Supercoupe d’Espagne',
  'ita.super_cup': 'Supercoupe d’Italie', 'ger.super_cup': 'Supercoupe d’Allemagne', 'uefa.super_cup': 'Supercoupe UEFA',
  'uefa.nations': 'Ligue des nations', 'uefa.euroq': 'Qualifications Euro', 'caf.nations': 'CAN',
  'caf.nations_qual': 'Qualifications CAN', 'conmebol.america': 'Copa América', 'uefa.euro': 'Euro', 'fifa.world': 'Coupe du monde',
}
const LEAGUE_SLUGS = new Set(['fra.1', 'fra.2', 'eng.1', 'esp.1', 'ger.1', 'ita.1'])
const CUP_SLUGS = new Set(['fra.coupe_de_france', 'esp.copa_del_rey', 'eng.fa', 'ita.coppa_italia', 'ger.dfb_pokal'])
const KO_SLUGS = new Set(['uefa.champions', 'uefa.europa', 'uefa.europa.conf'])
const SUPER_CUP_SLUGS = new Set(['fra.super_cup', 'eng.charity', 'esp.super_cup', 'ita.super_cup', 'ger.super_cup', 'uefa.super_cup'])
// code de compétition de l'app (broadcasters.js) ; cup = coupe nationale du championnat parent
const COMP_CODE = {
  'fra.1': ['FL1'], 'fra.2': ['FL2'], 'eng.1': ['PL'], 'esp.1': ['PD'], 'ger.1': ['BL1'], 'ita.1': ['SA'],
  'uefa.champions': ['CL'], 'uefa.europa': ['UEL'], 'uefa.europa.conf': ['UECL'], 'uefa.super_cup': ['USC'],
  'caf.nations': ['CAN'], 'caf.nations_qual': ['CANQ'], 'uefa.nations': ['NL'], 'uefa.euroq': ['ECQ'],
  'fra.coupe_de_france': ['FL1', true], 'esp.copa_del_rey': ['PD', true], 'eng.fa': ['PL', true],
  'ita.coppa_italia': ['SA', true], 'ger.dfb_pokal': ['BL1', true],
}
export function channelFor(slug, homeName, awayName, utcDate) {
  const c = COMP_CODE[slug]
  if (!c) return null
  try {
    return getBroadcaster({ competition: { code: c[0] }, isCup: !!c[1], utcDate, homeTeam: { name: homeName }, awayTeam: { name: awayName } })?.name ?? null
  } catch { return null }
}

const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const compWithArticle = c => (/^(Trophée|Community)/.test(c) ? `le ${c}` : /^Euro/.test(c) ? `l'${c}` : `la ${c}`)

// Nom avec article pour une phrase (« le PSG », « l'OM »…) ; sinon le nom affiché tel quel.
const ARTICLE = {
  psg: 'le PSG', om: "l'OM", real: 'le Real', barca: 'le Barça', bayern: 'le Bayern', inter: "l'Inter", milan: "l'AC Milan",
  city: 'Manchester City', arsenal: 'Arsenal', bvb: 'Dortmund',
}
const MORE_ARTICLES = [
  [['lyon', 'olympique lyonnais'], "l'OL"], [['atletico madrid', 'atletico de madrid', 'atletico'], "l'Atlético"],
  [['juventus'], 'la Juventus'], [['as roma', 'roma'], "l'AS Rome"],
]
export function phraseName(t) {
  const k = clubKey(...(t.names ?? []))
  if (k && ARTICLE[k]) return ARTICLE[k]
  const ns = (t.names ?? []).map(norm)
  const hit = MORE_ARTICLES.find(([alias]) => ns.some(n => alias.includes(n)))
  return hit ? hit[1] : t.name
}

// Tours à élimination directe (libellés du calendrier ESPN) → [tour joué, tour suivant]
const ROUNDS = [
  [/^round of 64$/i, '32es de finale', '16es'],
  [/^round of 32$/i, '16es de finale', '8es'],
  [/^(rd|round) of 16$/i, '8es de finale', 'quarts'],
  [/^knockout round playoffs?$/i, 'barrages', '8es'],
  [/^quarter-?finals?$/i, 'quarts de finale', 'demies'],
  [/^semi-?finals?$/i, 'demi-finales', 'finale'],
  [/^finals?$/i, 'finale', null],
]
export function roundInfo(label) {
  const r = ROUNDS.find(([re]) => re.test(String(label ?? '').trim()))
  return r ? { name: r[1], next: r[2] } : null
}
// Tour d'un match d'après le calendrier ESPN de la compétition (leagues[0].calendar[].entries)
export function roundFromCalendar(calendar, utcDate) {
  const t = Date.parse(utcDate)
  if (!Number.isFinite(t) || !Array.isArray(calendar)) return null
  for (const block of calendar) for (const e of (block?.entries ?? [])) {
    if (t >= Date.parse(e.startDate) && t < Date.parse(e.endDate)) return e.label ?? null
  }
  return null
}

// Égalité de points départagée à la différence de buts générale : seulement là où c'est sûr.
const GD_TIEBREAK = new Set(['uefa.champions', 'eng.1'])
const RELEGATION_SLOTS = { 'fra.1': 2, 'fra.2': 2, 'ger.1': 2, 'eng.1': 3, 'esp.1': 3, 'ita.1': 3 }
const totalGames = (slug, n) => (slug === 'uefa.champions' ? 8 : 2 * (n - 1))
const sameId = (a, b) => a != null && b != null && String(a) === String(b)

/**
 * Enjeux SÛRS pour l'équipe `teamId` qui joue `oppId` aujourd'hui.
 * table : [{ id, position, points, played, gd, won, lost }] ; playingToday : Set d'ids (toutes les
 * équipes de la compétition qui jouent aujourd'hui).
 * @returns {{ type: string, target?: object } | null}
 */
export function safeStake(slug, table, teamId, oppId, playingToday = new Set()) {
  if (!Array.isArray(table) || table.length < 4) return null
  const rows = table.filter(r => Number.isFinite(r?.points) && Number.isFinite(r?.position)).sort((a, b) => a.position - b.position)
  const me = rows.find(r => sameId(r.id, teamId))
  if (!me) return null
  const n = rows.length
  const total = totalGames(slug, n)
  const others = rows.filter(r => !sameId(r.id, teamId))
  const remaining = r => (Number.isFinite(r.played) ? Math.max(0, total - r.played) : null)
  const myRem = remaining(me)
  const canClinch = myRem != null && myRem >= 1 && others.every(r => remaining(r) != null)
  const win = me.points + 3

  if (canClinch) {
    // max possible de chaque autre équipe si on gagne (l'adversaire perd ce match : 1 match de moins)
    const maxIfWin = r => r.points + 3 * (remaining(r) - (sameId(r.id, oppId) ? 1 : 0))
    const threatsIfWin = others.filter(r => maxIfWin(r) >= win).length          // égalité = menace
    // sur une défaite : notre max, et les équipes déjà sûres de finir devant (l'adversaire prend 3 pts)
    const myMaxIfLoss = me.points + 3 * (myRem - 1)
    const surelyAboveIfLoss = others.filter(r => r.points + (sameId(r.id, oppId) ? 3 : 0) > myMaxIfLoss).length
    if (slug === 'uefa.champions' && n >= 30) {
      if (threatsIfWin <= 7 && me.position > 8) return { type: 'top8' }
      if (threatsIfWin <= 23 && me.position > 24) return { type: 'top24' }
      if (surelyAboveIfLoss >= 24) return { type: 'out' }
    } else if (RELEGATION_SLOTS[slug]) {
      const k = RELEGATION_SLOTS[slug]
      if (threatsIfWin === 0) return { type: 'champion' }
      if (surelyAboveIfLoss >= n - k) return { type: 'relegated' }
      if (me.position > n - k - 3 && threatsIfWin <= n - k - 1) return { type: 'safe' }
    }
  }

  // Dépasser une équipe nommée : la mieux classée qu'on passe à coup sûr avec une victoire.
  const tieOk = GD_TIEBREAK.has(slug)
  const passable = rows.filter(r => r.position < me.position && !sameId(r.id, teamId)).filter(r => {
    if (!sameId(r.id, oppId) && playingToday.has(String(r.id))) return false   // peut encore gagner aujourd'hui
    if (win > r.points) return true
    return tieOk && win === r.points && Number.isFinite(me.gd) && Number.isFinite(r.gd) && me.gd + 1 > r.gd
  })
  if (passable.length) {
    const best = passable[0]                 // le mieux classé
    // « prend la tête » seulement si on passe AUSSI toutes les équipes entre lui et nous (sinon « passe devant »)
    const between = rows.filter(r => r.position < me.position && r.position > best.position)
    const passesAll = between.every(r => passable.includes(r))
    if (best.position === 1 && passesAll) return { type: 'lead' }
    return { type: 'overtake', target: best }
  }
  return null
}

/**
 * @param {object} p
 *  p.slug, p.utcDate, p.hhmm ('21:00'), p.roundLabel? (libellé ESPN du tour)
 *  p.table? ([{ id, position, points, played, gd, won, lost }]), p.playingToday? (Set d'ids)
 *  p.home / p.away : { id?, name (affiché, FR), names: [variantes brutes ESPN…], form? }
 * @returns {{ home: {title, body}, away: {title, body}, kind }}
 */
export function buildMorningMessage(p) {
  const { slug, hhmm, home, away } = p
  const comp = COMP_NAMES[slug] ?? null
  const compShort = slug === 'uefa.champions' ? 'LDC' : comp
  const chan = channelFor(slug, home.names?.[0] ?? home.name, away.names?.[0] ?? away.name, p.utcDate)
  const h = Number(String(hhmm).split(':')[0])
  const when = h >= 18 ? 'Ce soir' : h >= 12 ? 'Cet après-midi' : 'Ce matin'
  const line1 = [`${when} à ${hhmm}`, chan ? `À regarder sur ${chan}` : null].filter(Boolean).join(' · ')
  const round = roundInfo(p.roundLabel)
  const classico = isClassico(home, away)
  const tableByid = id => (Array.isArray(p.table) ? p.table.find(r => sameId(r.id, id)) : null)
  let kind = 'default'

  const forTeam = (me, opp, isHome) => {
    const meN = phraseName(me), oppN = phraseName(opp)
    const verb = isHome ? 'reçoit' : 'défie'
    const where = comp ? (round && !LEAGUE_SLUGS.has(slug) ? ` en ${round.name} de ${comp}` : SUPER_CUP_SLUGS.has(slug) ? ` pour ${compWithArticle(comp)}` : ` en ${comp}`) : ''
    const title = classico ? `C'est le classico : ${meN} ${verb} ${oppN}` : cap(`${meN} ${verb} ${oppN}${where}`)

    // phrase d'enjeu (une seule, la plus forte, seulement si sûre)
    let stake = null
    const singleLegKO = CUP_SLUGS.has(slug) || SUPER_CUP_SLUGS.has(slug) || (round && round.next === null)
    if (round && singleLegKO) {
      stake = round.next ? `Une victoire et ${meN} file en ${round.next}.` : `Une victoire et ${meN} remporte ${comp ? compWithArticle(comp) : 'le titre'}.`
      kind = 'cup'
    } else if (SUPER_CUP_SLUGS.has(slug)) {
      stake = `Un trophée en jeu pour ${meN}.`; kind = 'cup'
    } else if (!round && (LEAGUE_SLUGS.has(slug) || slug === 'uefa.champions')) {
      const st = safeStake(slug, p.table, me.id, opp.id, p.playingToday)
      const S = {
        champion: () => `Une victoire et ${meN} est champion.`,
        relegated: () => `En cas de défaite, ${meN} est relégué.`,
        safe: () => `Une victoire et ${meN} assure son maintien.`,
        top8: () => `Une victoire et ${meN} est qualifié pour les 8es.`,
        top24: () => `Une victoire et ${meN} est assuré de jouer les barrages.`,
        out: () => `En cas de défaite, ${meN} est éliminé.`,
        lead: () => `Une victoire et ${meN} prend la tête.`,
        overtake: t => `Une victoire et ${meN} passe devant ${phraseName({ name: t.name ?? '', names: t.names ?? [t.name] })}.`,
      }
      if (st) { stake = S[st.type](st.target ?? {}); kind = 'stake' }
    }
    if (!stake) {
      const row = tableByid(me.id)
      if (row && Number.isFinite(row.played) && row.played >= 3 && row.won === row.played && compShort) {
        stake = `${row.won} victoires en ${row.played} matchs de ${compShort}.`; kind = 'fact'
      } else if (row && Number.isFinite(row.played) && row.played >= 5 && row.lost === 0 && comp) {
        stake = `Invaincu en ${row.played} matchs de ${compShort}.`; kind = 'fact'
      } else if (typeof me.form === 'string' && /^W{5}$/.test(me.form.slice(-5))) {
        stake = '5 victoires lors des 5 derniers matchs.'; kind = 'fact'
      }
    }
    return { title, body: [line1, stake].filter(Boolean).join('\n') }
  }

  const homeV = forTeam(home, away, true)
  const awayV = forTeam(away, home, false)
  if (classico && kind === 'default') kind = 'classico'
  return { kind, home: homeV, away: awayV }
}
