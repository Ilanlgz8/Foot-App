// Nom d'équipe au-dessus des cotes (19/11) : les noms longs débordaient presque de la carte
// (« CLERMONT FOOT »). Pour les noms de 13 caractères ou plus, on retire seulement les mots
// génériques (Foot, FC, AS, Stade…) : « Clermont Foot » → « Clermont », « VfB Stuttgart » →
// « Stuttgart ». Jamais de mot distinctif retiré (Real, Inter, Manchester… restent) ; si rien de
// générique, le nom reste entier. Le nom sous le logo, lui, ne change pas.
const FILLER = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'rc', 'rcd', 'ogc', 'us', 'usl', 'sv', 'vfb', 'vfl',
  'tsg', 'fsv', '1.', 'cd', 'ud', 'sd', 'club', 'foot', 'football', 'calcio', 'stade',
])
const LONG = 13

export function oddsLabel(name) {
  const s = String(name ?? '').trim()
  if (s.length < LONG) return s
  const kept = s.split(/\s+/).filter(w => !FILLER.has(w.toLowerCase()))
  return kept.length ? kept.join(' ') : s
}
