// Minuterie Web Worker — non throttlée même quand l'onglet est en arrière-plan.
// Le navigateur limite setInterval à ~1min sur le main thread pour les onglets inactifs.
// Un Worker tourne dans un thread séparé sans cette restriction.
//
// ⚠️ BUG CORRIGÉ (constat utilisateur : quota Redis Upstash à 960K/500K
// commandes, largement dépassé) : le tick était à 5s alors que le cache
// Redis serveur (/api/fifa-live.js) ne se rafraîchit lui-même que toutes les
// 6-8s (FIFA_TTL/ESPN_TTL). Concrètement, la majorité des polls à 5s
// retombaient sur EXACTEMENT le même cache que le poll précédent — payant le
// coût Redis (lecture de cache à chaque appel, quel que soit le résultat)
// sans gagner de fraîcheur réelle la plupart du temps. Passé à 10s : environ
// moitié moins d'appels/commandes Redis pour une perte de réactivité
// perçue minime (le score reste interpolé côté client entre deux polls, voir
// interpolateEspnMinute() dans matchUtils.js).
setInterval(() => postMessage('tick'), 10_000)
