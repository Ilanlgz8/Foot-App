// probaCurve — enregistre côté serveur (api/pulse.js, action 'sample' —
// fusionné avec le pouls collectif pour rester sous la limite de 12
// Serverless Functions du plan Hobby Vercel) un échantillon de la
// proba de victoire en direct (calcLiveProno) une fois par minute de match,
// pour tracer la "courbe de bascule" une fois le match terminé (voir
// <ProbaCurve>). Agrégé côté serveur (Redis, dédupliqué par minute) plutôt
// qu'en localStorage : n'importe quel utilisateur consultant le match
// terminé voit la courbe, même s'il n'a pas suivi CE match en direct
// lui-même — un autre spectateur l'aura fait à sa place.
//
// Dédup en mémoire (pas besoin de persister davantage) : évite un POST par
// poll pour une minute déjà envoyée durant cette session.
const sentMinutes = new Map() // matchId -> Set<number>

function parseMinuteToNumber(minute) {
  if (minute == null) return null
  if (typeof minute === 'number') return minute
  const m = /^(\d+)/.exec(minute)
  return m ? parseInt(m[1], 10) : null
}

export function recordProbaSample(matchId, minute, prono) {
  if (!matchId || !prono) return
  const min = parseMinuteToNumber(minute)
  if (min == null || min < 0 || min > 130) return

  const key  = String(matchId)
  const seen = sentMinutes.get(key) ?? new Set()
  if (seen.has(min)) return
  seen.add(min)
  sentMinutes.set(key, seen)

  fetch('/api/pulse', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ matchId: key, action: 'sample', minute: min, home: prono.home, draw: prono.draw, away: prono.away }),
  }).catch(() => {
    // Échec silencieux : simple enregistrement d'arrière-plan, un autre
    // spectateur du même match complétera probablement l'échantillon
    // manquant au poll suivant.
    seen.delete(min)
  })
}
