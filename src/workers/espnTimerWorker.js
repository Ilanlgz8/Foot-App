// Minuterie Web Worker — non throttlée même quand l'onglet est en arrière-plan.
// Le navigateur limite setInterval à ~1min sur le main thread pour les onglets inactifs.
// Un Worker tourne dans un thread séparé sans cette restriction.
//
// ⚠️ RÉDUIT (constat utilisateur : Fluid Active CPU Vercel Hobby déjà à
// 4h13/4h, DÉPASSÉ — un dépassement peut mettre le projet entier EN PAUSE,
// pas juste le ralentir). Chaque tick = une invocation de fonction Vercel
// (/api/fifa-live) PAR CLIENT connecté, le plus gros poste de calcul actif
// de toute l'app avec beaucoup d'utilisateurs en live simultané — largement
// plus déterminant que le cron (1 invocation/min, tous utilisateurs
// confondus, contre 1 invocation/tick PAR client ici). Passé de 10s à 20s :
// moitié moins d'invocations. Compensé par Ably (voir useLiveMinute.js) qui
// réveille immédiatement un client dès qu'un AUTRE utilisateur détecte un
// changement — donc la fraîcheur perçue reste correcte sur les matchs
// suivis par plusieurs personnes malgré ce tick plus lent.
setInterval(() => postMessage('tick'), 20_000)
