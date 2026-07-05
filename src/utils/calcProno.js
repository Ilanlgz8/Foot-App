// Force d'une équipe sur sa forme récente (0-3, comme des points/match).
function strength(form) {
  if (!form?.length) return 1.5   // neutre (sur 3 pts max/match)
  const pts = form.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)
  return pts / form.length
}

// Convertit 3 poids bruts (home, away, draw) en pourcentages entiers qui
// somment à 100, avec un plancher de 5% par issue (jamais 0% affiché).
function distribute(h, a, draw) {
  const total = h + a + draw
  let home = Math.round((h    / total) * 100)
  let away = Math.round((a    / total) * 100)
  let nul  = 100 - home - away   // absorbe l'arrondi

  if (home < 5) { home = 5;  nul  = 100 - home - away }
  if (away < 5) { away = 5;  nul  = 100 - home - away }
  if (nul  < 5) { nul  = 5;  home = 100 - nul  - away }

  return { home, draw: nul, away }
}

/**
 * calcProno — calcule les probabilités 1/X/2 à partir de la forme récente.
 *
 * @param {string[]} homeForm  ex: ['W','D','L','W','W']
 * @param {string[]} awayForm  ex: ['L','W','W','D','L']
 * @returns {{ home: number, draw: number, away: number }}  entiers %, somme = 100
 */
export function calcProno(homeForm, awayForm) {
  const h = strength(homeForm) + 0.4   // avantage domicile ~+0.4 pt
  const a = strength(awayForm)
  return distribute(h, a, 1.5)         // poids match nul constant
}

// calcMinute() (matchUtils.js) ne renvoie jamais un nombre brut — toujours
// une string formatée ("45+2'") ou un des labels spéciaux documentés ici.
// On en extrait une minute approximative utilisable pour calcLiveProno.
function parseMinuteValue(minute) {
  if (minute == null)        return 0
  if (typeof minute === 'number') return minute
  if (minute === 'Débute')   return 0
  if (minute === 'MT')       return 45
  if (minute === 'Pause')    return 90   // pause avant prolongations
  if (minute === 'Prolongation') return 105
  if (minute === 'TAB')      return 120
  const m = /^(\d+)/.exec(minute)
  return m ? parseInt(m[1], 10) : 45     // fallback neutre si format inconnu
}

/**
 * calcLiveProno — même proba 1/X/2 que calcProno, mais réévaluée en direct
 * selon le score réel et le temps restant. Ce n'est PAS un modèle xG (aucune
 * donnée de tir dispo côté free tier) : c'est une pondération qui fait
 * simplement glisser le curseur du pronostic pré-match (forme récente) vers
 * "le résultat actuel tel quel" à mesure que le temps restant diminue — un
 * peu comme le ferait n'importe quel supporter qui regarde le chrono.
 *
 * @param {string[]} homeForm
 * @param {string[]} awayForm
 * @param {number|null} homeGoals  score domicile en direct
 * @param {number|null} awayGoals  score extérieur en direct
 * @param {string|number|null} minute  retour brut de calcMinute(match)
 */
export function calcLiveProno(homeForm, awayForm, homeGoals, awayGoals, minute) {
  const pre  = calcProno(homeForm, awayForm)
  const diff = (homeGoals ?? 0) - (awayGoals ?? 0)

  const min           = parseMinuteValue(minute)
  const totalDuration = min > 90 ? 120 : 90
  const remaining     = Math.min(1, Math.max(0, (totalDuration - min) / totalDuration))

  // Distribution "si l'arbitre sifflait la fin maintenant" — jamais 100%
  // (un but égalisateur/renversant reste possible même en fin de match).
  // Cas d'égalité : biaisé selon qui était favori au pré-match plutôt qu'un
  // 50/50 arbitraire.
  let now
  if (diff > 0)      now = { home: 90, draw: 8,  away: 2  }
  else if (diff < 0) now = { home: 2,  draw: 8,  away: 90 }
  else {
    const favorHome = pre.home >= pre.away
    now = favorHome
      ? { home: 27, draw: 55, away: 18 }
      : { home: 18, draw: 55, away: 27 }
  }

  // Blend : à la mi-temps (remaining ~0.5) les deux comptent autant, en fin
  // de match "now" écrase le prior, au coup d'envoi (remaining=1) diff vaut
  // toujours 0 donc pre === now de toute façon.
  const home = pre.home * remaining + now.home * (1 - remaining)
  const draw = pre.draw * remaining + now.draw * (1 - remaining)
  const away = pre.away * remaining + now.away * (1 - remaining)

  return distribute(home, away, draw)
}
