// Nom de groupe affiché en français (12/11, constat utilisateur : « GROUP A1 » sans e, et des
// codes A1/B2 incompréhensibles). Sources : football-data.org « GROUP_A », ESPN « Group A » ou,
// pour la Ligue des Nations, « Group A1 » = Ligue A, groupe 1.
export function formatGroupName(raw = '') {
  const s = String(raw ?? '').trim()
  const nl = /^group[\s_]*([A-D])[\s_]*(\d)$/i.exec(s)
  if (nl) return `Ligue ${nl[1].toUpperCase()} · Groupe ${nl[2]}`
  const g = /^group[\s_]*(.+)$/i.exec(s)
  if (g) return `Groupe ${g[1].replace(/_/g, ' ').trim()}`
  return s.replace(/_/g, ' ')
}
