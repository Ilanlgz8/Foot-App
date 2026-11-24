// Rappel du matin (10h, notif aux abonnés qui suivent l'une des deux équipes) — texte du message.
// 24/11 (demande utilisateur) : au lieu d'un message fixe, le fait le plus intéressant du match,
// toujours tiré des vraies données (jamais inventé : une donnée manquante = règle sautée), sans
// emoji ni cotes. Partagé : utilisé par le Worker Cloudflare (cf-worker/src/index.js,
// morningReminders) ; fonctions pures, testées dans morningMessage.test.js.
//
// Ordre des règles (la première qui colle gagne) :
//  1. Classico : les deux équipes sont dans la liste des « grands » (clubs ou sélections) ;
//  2. Coupe : compétition à élimination directe (coupes nationales) ou supercoupe ;
//  3. Choc au sommet : les deux dans le top 4 du classement, 3 points d'écart ou moins ;
//  4. Série : l'équipe suivie a gagné ses 5 derniers matchs (forme ESPN « WWWWW ») ;
//  5. Sinon : « Jour de match pour <équipe> ».
// Le titre peut dépendre de l'équipe suivie → deux variantes (home / away), choisies par
// api/cron-goals.js selon l'équipe favorite de chaque abonné.
import { getBroadcaster } from '../data/broadcasters.js'

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// « Grands » clubs (noms ESPN, plusieurs variantes) : un match entre deux d'entre eux = classico.
// Volontairement court (demande utilisateur : PSG-OM, Real-Barça, City-Arsenal oui ; pas les
// derbys locaux type Liverpool-Everton).
const BIG = [
  ['paris saint germain', 'psg', 'paris sg'], ['marseille', 'olympique de marseille'], ['lyon', 'olympique lyonnais'],
  ['real madrid'], ['barcelona', 'fc barcelona', 'barcelone'], ['atletico madrid', 'atletico de madrid', 'atletico'],
  ['manchester city', 'man city'], ['arsenal'], ['liverpool'], ['manchester united', 'man utd', 'man united'],
  ['chelsea'], ['tottenham hotspur', 'tottenham', 'spurs'],
  ['internazionale', 'inter milan', 'inter'], ['ac milan', 'milan'], ['juventus'], ['napoli', 'naples'],
  ['bayern munich', 'bayern munchen', 'bayern'], ['borussia dortmund', 'dortmund'], ['bayer leverkusen', 'leverkusen'],
  // sélections
  ['france'], ['brazil', 'bresil'], ['argentina', 'argentine'], ['spain', 'espagne'], ['england', 'angleterre'],
  ['germany', 'allemagne'], ['italy', 'italie'], ['portugal'], ['netherlands', 'pays bas'],
].map(list => new Set(list))
export function bigIndex(...names) {
  const ns = names.map(norm).filter(Boolean)
  return BIG.findIndex(set => ns.some(n => set.has(n)))
}
export function isClassico(home, away) {
  const h = bigIndex(...home.names), a = bigIndex(...away.names)
  return h >= 0 && a >= 0 && h !== a
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
const CUP_SLUGS = new Set(['fra.coupe_de_france', 'esp.copa_del_rey', 'eng.fa', 'ita.coppa_italia', 'ger.dfb_pokal'])
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
const SP = '  ' // deux espaces : « Paris SG  21:00  Nantes » (format choisi par l'utilisateur)

/**
 * @param {object} p
 *  p.slug, p.utcDate, p.hhmm ('21:00')
 *  p.home / p.away : { name (affiché, FR), names: [variantes brutes ESPN…], rank?, points?, form? ('WWDLW') }
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
  if (CUP_SLUGS.has(slug)) return { kind: 'cup', ...perTeam(n => `${n} joue sa qualification ce soir`, [comp ? `${comp}. Le vainqueur passe au tour suivant.` : null, chan ? `À regarder sur ${chan}` : null].filter(Boolean).join('\n')) }
  // 3. Choc au sommet
  if (hasRanks && home.rank <= 4 && away.rank <= 4 && Number.isFinite(home.points) && Number.isFinite(away.points)) {
    const d = Math.abs(home.points - away.points)
    if (d <= 3) {
      const ecart = d === 0 ? 'à égalité de points' : `${d} point${d > 1 ? 's' : ''} d'écart`
      return { kind: 'top', ...both('Choc au sommet ce soir', `${ord(home.rank)} contre ${ord(away.rank)} en ${comp}, ${ecart}.`) }
    }
  }
  // 4. Série (par équipe suivie) ; 5. repli
  const streak = t => typeof t.form === 'string' && t.form.length >= 5 && /^W+$/.test(t.form.slice(-5))
  const pick = t => (streak(t)
    ? { title: `${t.name} reste sur 5 victoires`, body: [line1, infoLine].filter(Boolean).join('\n') }
    : { title: `Jour de match pour ${t.name}`, body: [line1, infoLine].filter(Boolean).join('\n') })
  return { kind: 'default', home: pick(home), away: pick(away) }
}
