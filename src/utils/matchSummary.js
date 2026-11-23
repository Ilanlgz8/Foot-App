// Phrase qui résume un match (22/11, image à partager) — fabriquée UNIQUEMENT à partir des buts et
// des cartons rouges qu'on a déjà : jamais d'IA, jamais d'info inventée. Quand il n'y a rien de
// remarquable, la phrase reste simple (« Victoire 2-0 de Lens. »).
// goals : [{ side: 'home'|'away', name, minute, ownGoal, penaltyKick }] — `side` = équipe qui
// MARQUE (un csc est déjà compté pour l'équipe qui en profite, comme ESPN).

export function minuteValue(m) {
  const s = String(m ?? '').replace(/'/g, '')
  const [a, b] = s.split('+')
  const n = parseInt(a, 10)
  return Number.isFinite(n) ? n + (parseInt(b, 10) || 0) / 100 : 999
}
const ord = n => `${Math.floor(n)}${Math.floor(n) === 1 ? 're' : 'e'}`

export function buildMatchSummary({ homeName, awayName, hs, as, goals = [], isFinished = true }) {
  if (hs == null || as == null) return null
  const sorted = [...goals].sort((a, b) => minuteValue(a.minute) - minuteValue(b.minute))
  const named = sorted.filter(g => !g.ownGoal && g.name)
  const counts = new Map()
  for (const g of named) counts.set(`${g.side}|${g.name}`, (counts.get(`${g.side}|${g.name}`) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const feat = top && top[1] >= 2
    ? `${top[1] >= 3 ? 'Triplé' : 'Doublé'} de ${shortName(top[0].split('|')[1])}.`
    : ''

  if (!isFinished) {
    if (hs === as) return hs === 0 ? 'Toujours 0-0 pour l\'instant.' : `Égalité ${hs}-${as} pour l'instant.`
    const lead = hs > as ? homeName : awayName
    return `${lead} mène ${Math.max(hs, as)}-${Math.min(hs, as)}.${feat ? ' ' + feat : ''}`
  }

  if (hs === as) {
    if (hs === 0) return `Pas de but entre ${homeName} et ${awayName}.`
    return `${homeName} et ${awayName} se quittent sur un nul (${hs}-${as}).${feat ? ' ' + feat : ''}`
  }
  const homeWins = hs > as
  const W = homeWins ? homeName : awayName
  const L = homeWins ? awayName : homeName
  const score = `${Math.max(hs, as)}-${Math.min(hs, as)}`
  const winSide = homeWins ? 'home' : 'away'
  const first = sorted[0]
  let main
  if (first && first.side !== winSide) {
    const m = minuteValue(first.minute)
    main = m <= 15 && m < 999 ? `Mené dès la ${ord(m)}, ${W} renverse ${L}.` : `Mené au score, ${W} renverse ${L}.`
  } else if (Math.abs(hs - as) >= 3) {
    main = `${W} s'impose largement face à ${L} (${score}).`
  } else {
    const winning = sorted.filter(g => g.side === winSide)
    const decisive = winning[Math.min(hs, as)] // le but qui donne l'avantage définitif
    const dm = decisive ? minuteValue(decisive.minute) : 0
    main = Math.abs(hs - as) === 1 && dm >= 85 && dm < 999
      ? `${W} arrache la victoire face à ${L} en fin de match (${score}).`
      : `Victoire ${score} de ${W} face à ${L}.`
  }
  return feat ? `${main} ${feat}` : main
}

// « A. Mille » → « Mille » (le prénom abrégé alourdit la phrase).
function shortName(n) {
  const s = String(n ?? '').trim()
  return s.replace(/^[A-ZÀ-Ý]\.\s+/, '')
}
