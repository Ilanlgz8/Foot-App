// Minuterie Web Worker — non throttlée même quand l'onglet est en arrière-plan.
// Le navigateur limite setInterval à ~1min sur le main thread pour les onglets inactifs.
// Un Worker tourne dans un thread séparé sans cette restriction.
//
// ⚠️ RÉDUIT UNE 2e FOIS (constat utilisateur : Fluid Active CPU Vercel Hobby
// déjà dépassé — 4h13/4h — et ce DÉJÀ avant le passage 10s→20s fait plus tôt
// aujourd'hui, ce qui veut dire que 20s ne suffit probablement pas non plus
// vu le volume d'utilisateurs simultanés restant sur le Mondial (demi-
// finales et finale encore à venir). Chaque tick = une invocation de
// fonction Vercel (/api/fifa-live) PAR CLIENT connecté — le plus gros poste
// de calcul actif de toute l'app avec beaucoup de monde en live simultané,
// largement plus déterminant que le cron (1 invocation/min, TOUS
// utilisateurs confondus, contre 1 invocation/tick PAR client ici). Passé à
// 30s. Un dépassement du quota gratuit peut mettre TOUT le projet en pause
// (pas juste le ralentir) jusqu'à 30 jours ou passage payant — donc mieux
// vaut une fraîcheur un peu réduite qu'un site à l'arrêt en plein match.
// Compensé par Ably (voir useLiveMinute.js) qui réveille immédiatement un
// client dès qu'un AUTRE utilisateur détecte un changement — la fraîcheur
// perçue reste correcte sur les matchs suivis par plusieurs personnes
// malgré ce tick plus lent.
setInterval(() => postMessage('tick'), 30_000)
