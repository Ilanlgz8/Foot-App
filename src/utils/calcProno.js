/**
 * calcProno — calcule les probabilités 1/X/2 à partir de la forme récente.
 *
 * @param {string[]} homeForm  ex: ['W','D','L','W','W']
 * @param {string[]} awayForm  ex: ['L','W','W','D','L']
 * @returns {{ home: number, draw: number, away: number }}  entiers %, somme = 100
 */
export function calcProno(homeForm, awayForm) {
  const strength = form => {
    if (!form?.length) return 1.5   // neutre (sur 3 pts max/match)
    const pts = form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)
    return pts / form.length        // 0 – 3
  }

  // Avantage domicile ~+0.4 pt
  const h = strength(homeForm) + 0.4
  const a = strength(awayForm)
  const draw = 1.5   // poids match nul constant

  const total = h + a + draw
  let home = Math.round((h    / total) * 100)
  let away = Math.round((a    / total) * 100)
  let nul  = 100 - home - away   // absorbe l'arrondi

  // Clamp : chaque outcome min 5%
  if (home < 5) { home = 5;  nul  = 100 - home - away }
  if (away < 5) { away = 5;  nul  = 100 - home - away }
  if (nul  < 5) { nul  = 5;  home = 100 - nul  - away }

  return { home, draw: nul, away }
}
