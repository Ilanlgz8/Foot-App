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
//
// ⚠️ RELEVÉ UNE 3e FOIS, 30s → 45s (10/09, constat utilisateur : "244K
// commandes Upstash en 10 jours", plafond gratuit 500K/MOIS — vérifié sur
// upstash.com/pricing, trajectoire ~730K/mois au rythme observé). Ce tick
// déclenche un appel /api/fifa-live PAR CLIENT connecté à /live, qui coûte
// au moins quelques commandes Redis (voir FRESH_TTL, fifa-live.js) même sur
// le chemin le moins cher — le poste le plus proportionnel au nombre de
// spectateurs simultanés de toute l'app. Même logique et même garde-fou que
// les 2 réductions précédentes (10s→20s→30s, Fluid Active CPU) : Ably
// compense toujours la fraîcheur perçue sur les matchs suivis par plusieurs
// personnes, donc pas de perte perceptible attendue pour un gain direct sur
// le volume de commandes Redis.
setInterval(() => postMessage('tick'), 45_000)
