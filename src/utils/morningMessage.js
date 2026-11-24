// Rappel du matin (10h, notif aux abonnés qui suivent l'une des deux équipes) — texte du message.
// 24/11 (demande utilisateur) : au lieu d'un message fixe, le fait le plus intéressant du match,
// toujours tiré des vraies données (jamais inventé : une donnée manquante = règle sautée), sans
// emoji ni cotes. Partagé : utilisé par le Worker Cloudflare (cf-worker/src/index.js,
// morningReminders) ; fonctions pures, testées dans morningMessage.test.js.
//
// Ordre des règles (la première qui colle gagne) :
//  1. Classico : PSG-OM, Real-Barça, City-Arsenal, Inter-Milan, Bayern-Dortmund (et rien d'autre) ;
//  2. Coupe / phase finale européenne : le tour en jeu (« joue sa place en quarts ») d'après le
//     calendrier ESPN de la compétition ; supercoupe = un trophée ;
//  3. Choc au sommet : les deux dans le top 4 du classement, 3 points d'écart ou moins ;
//  4. Enjeu au classement pour l'équipe suivie : avec une victoire, elle passe en tête / monte sur
//     le podium / sort de la zone rouge (calcul sur le classement du matin, égalités ignorées) ;
//  5. Série : l'équipe suivie a gagné ses 5 derniers matchs (forme ESPN « WWWWW ») ;
//  6. Sinon : « Jour de match pour <équipe> ».
// Le titre peut dépendre de l'équipe suivie → deux variantes (home / away), choisies par
// api/cron-goals.js selon l'équipe favorite de chaque abonné.
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

const ord = n => (n === 1 ? '1er' : `${n}e`)

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

// Enjeu au classement si l'équipe gagne (classement du matin ; une égalité de points = pas d'annonce,
// la différence de buts déciderait). table : [{ id, position, points }]
export function stakeIfWin(table, teamId) {
  if (!Array.isArray(table) || !table.length || teamId == null) return null
  const rows = table.filter(r => Number.isFinite(r?.position) && Number.isFinite(r?.points)).sort((a, b) => a.position - b.position)
  const me = rows.find(r => String(r.id) === String(teamId))
  if (!me) return null
  const after = me.points + 3
  const others = rows.filter(r => String(r.id) !== String(teamId))
  const ahead = others.filter(r => r.points >= after).length           // équipes encore devant ou à égalité
  const newPos = ahead + 1
  const tied = others.some(r => r.points === after)
  if (tied) return null
  const n = rows.length
  if (me.position > 1 && newPos === 1) return 'lead'
  if (me.position > 3 && newPos <= 3) return 'podium'
  if (n >= 10 && me.position > n - 3 && newPos <= n - 3) return 'safe'
  return null
}
const SP = '  ' // deux espaces : « Paris SG  21:00  Nantes » (format choisi par l'utilisateur)

/**
 * @param {object} p
 *  p.slug, p.utcDate, p.hhmm ('21:00'), p.roundLabel? (libellé ESPN du tour), p.table? ([{ id, position, points }])
 *  p.home / p.away : { id?, name (affiché, FR), names: [variantes brutes ESPN…], rank?, points?, form? ('WWDLW') }
 * @returns {{ home: {title, body}, away: {title, body}, kind }}
 */
export function buildMorningMessage(p) {
  const { slug, hhmm, home, away } = p
  const comp = COMP_NAMES[slug] ?? null
  const chan = channelFor(slug, home.names?.[0] ?? home.name, away.names?.[0] ?? away.name, p.utcDate)
  const line1 = `${home.name}${SP}${hhmm}${SP}${away.name}`
  const infoLine = [comp, chan ? `À regarder sur ${chan}` : null].filter(Boolean).join(' · ')
  const hasRanks = Number.isFinite(home.rank) && Number.isFinite(away.rank)
  const rankLine = hasRanks && comp ? `${ord(home.rank)} contre ${ord(away.rank)} en ${comp}.` : null
  const both = (title, l2) => {
    const body = [line1, l2].filter(Boolean).join('\n')
    return { home: { title, body }, away: { title, body } }
  }
  const perTeam = (fn, l2) => ({
    home: { title: fn(home.name), body: [line1, l2].filter(Boolean).join('\n') },
    away: { title: fn(away.name), body: [line1, l2].filter(Boolean).join('\n') },
  })

  // 1. Classico
  if (isClassico(home, away)) return { kind: 'classico', ...both("C'est le classico ce soir", rankLine ?? infoLine) }
  // 2. Coupe / supercoupe
  if (SUPER_CUP_SLUGS.has(slug)) return { kind: 'cup', ...perTeam(n => `${n} joue un trophée ce soir`, infoLine) }
  const round = roundInfo(p.roundLabel)
  if (round && (CUP_SLUGS.has(slug) || KO_SLUGS.has(slug))) {
    const title = round.next ? (n => `${n} joue sa place en ${round.next} ce soir`) : (n => `${n} joue la finale ce soir`)
    return { kind: 'cup', ...perTeam(title, [comp ? `${comp}, ${round.name}` : null, chan ? `À regarder sur ${chan}` : null].filter(Boolean).join(' · ')) }
  }
  if (CUP_SLUGS.has(slug)) return { kind: 'cup', ...perTeam(n => `${n} joue sa qualification ce soir`, [comp ? `${comp}. Le vainqueur passe au tour suivant.` : null, chan ? `À regarder sur ${chan}` : null].filter(Boolean).join('\n')) }
  // 3. Choc au sommet
  if (hasRanks && home.rank <= 4 && away.rank <= 4 && Number.isFinite(home.points) && Number.isFinite(away.points)) {
    const d = Math.abs(home.points - away.points)
    if (d <= 3) {
      const ecart = d === 0 ? 'à égalité de points' : `${d} point${d > 1 ? 's' : ''} d'écart`
      return { kind: 'top', ...both('Choc au sommet ce soir', `${ord(home.rank)} contre ${ord(away.rank)} en ${comp}, ${ecart}.`) }
    }
  }
  // 4. Enjeu au classement ; 5. série ; 6. repli — par équipe suivie
  const STAKE = { lead: n => `Une victoire et ${n} passe en tête`, podium: n => `Une victoire et ${n} monte sur le podium`, safe: n => `Une victoire et ${n} sort de la zone rouge` }
  const streak = t => typeof t.form === 'string' && t.form.length >= 5 && /^W+$/.test(t.form.slice(-5))
  const placeLine = t => (Number.isFinite(t.rank) && comp ? [`${ord(t.rank)} de ${comp}`, chan ? `À regarder sur ${chan}` : null].filter(Boolean).join(' · ') : infoLine)
  let kind = 'default'
  const pick = t => {
    const stake = LEAGUE_SLUGS.has(slug) ? stakeIfWin(p.table, t.id) : null
    if (stake) { kind = 'stake'; return { title: STAKE[stake](t.name), body: [line1, placeLine(t)].filter(Boolean).join('\n') } }
    if (streak(t)) return { title: `${t.name} reste sur 5 victoires`, body: [line1, infoLine].filter(Boolean).join('\n') }
    return { title: `Jour de match pour ${t.name}`, body: [line1, infoLine].filter(Boolean).join('\n') }
  }
  const h = pick(home), a = pick(away)
  return { kind, home: h, away: a }
}
