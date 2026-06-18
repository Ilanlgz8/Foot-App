// Minuterie Web Worker — non throttlée même quand l'onglet est en arrière-plan.
// Le navigateur limite setInterval à ~1min sur le main thread pour les onglets inactifs.
// Un Worker tourne dans un thread séparé sans cette restriction.
// Il envoie un 'tick' toutes les 15s → le main thread exécute pollESPN.
setInterval(() => postMessage('tick'), 15_000)
