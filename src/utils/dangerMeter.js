// dangerMeter — "pression du moment" en direct : qui est en train de
// pousser LÀ maintenant, à ne pas confondre avec calcLiveProno (qui répond
// à "qui va gagner au final"). Complémentaire, pas un remplacement.
//
// Pas de vrai flux d'événements horodatés côté free tier (ESPN ne renvoie
// que des totaux cumulés à chaque poll) → approximation assumée : à chaque
// nouveau relevé de stats, on calcule le delta depuis le relevé précédent
// (tirs, tirs cadrés, corners gagnés depuis le dernier poll) et on l'ajoute
// à un score qui décroît avec le temps (moyenne mobile à décroissance
// exponentielle, demi-vie ≈ 2 minutes) — un but marqué dans les 2 dernières
// minutes pèse donc plus qu'un corner obtenu il y a 15 minutes.
//
// État gardé HORS React (Map en mémoire, même logique que
// matchStateTracker.js/liveTracker.js) pour survivre aux remounts de
// composant (changement d'onglet, navigation) sans perdre l'historique
// récent en cours de match.

const state = new Map() // matchId -> { home, away, prevStats, lastPct }

const DECAY_PER_UPDATE = 0.955 // demi-vie ≈ 2min à un rythme de poll ~8s

function clampDelta(cur, prev) {
  if (typeof cur !== 'number' || typeof prev !== 'number') return 0
  const d = cur - prev
  return d > 0 ? d : 0 // jamais négatif (correction de donnée éventuelle ignorée)
}

function statsEqual(a, b) {
  if (!a || !b) return false
  return a.home?.shots === b.home?.shots
    && a.home?.shotsOnTarget === b.home?.shotsOnTarget
    && a.home?.corners === b.home?.corners
    && a.away?.shots === b.away?.shots
    && a.away?.shotsOnTarget === b.away?.shotsOnTarget
    && a.away?.corners === b.away?.corners
}

/**
 * @param {string|number} matchId
 * @param {{home:{shots,shotsOnTarget,corners}, away:{shots,shotsOnTarget,corners}}|null} stats
 * @returns {{homePct:number, awayPct:number, hasSignal:boolean}|null}
 */
export function updateDangerMeter(matchId, stats) {
  if (!matchId || !stats?.home || !stats?.away) return null
  const key = String(matchId)
  const prior = state.get(key) ?? {
    home: 0, away: 0, prevStats: null,
    lastPct: { homePct: 50, awayPct: 50, hasSignal: false },
  }

  // Rien de nouveau depuis le dernier appel (même relevé de stats, ex.
  // re-render sans nouveau poll) → ne pas ré-appliquer la décroissance.
  if (statsEqual(prior.prevStats, stats)) return prior.lastPct

  let home = prior.home * DECAY_PER_UPDATE
  let away = prior.away * DECAY_PER_UPDATE

  if (prior.prevStats) {
    home += clampDelta(stats.home.shots, prior.prevStats.home?.shots) * 1
          + clampDelta(stats.home.shotsOnTarget, prior.prevStats.home?.shotsOnTarget) * 2
          + clampDelta(stats.home.corners, prior.prevStats.home?.corners) * 1
    away += clampDelta(stats.away.shots, prior.prevStats.away?.shots) * 1
          + clampDelta(stats.away.shotsOnTarget, prior.prevStats.away?.shotsOnTarget) * 2
          + clampDelta(stats.away.corners, prior.prevStats.away?.corners) * 1
  }

  const total = home + away
  const pct = {
    homePct:   total > 0.01 ? Math.round((home / total) * 100) : 50,
    awayPct:   total > 0.01 ? Math.round((away / total) * 100) : 50,
    hasSignal: total > 0.01,
  }

  state.set(key, { home, away, prevStats: stats, lastPct: pct })
  return pct
}
