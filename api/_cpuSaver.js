// Frein d'urgence CPU (19/11, après la suspension du projet pour dépassement du « Fluid Active CPU »).
// Variable d'environnement Vercel CPU_SAVER=1 (Settings → Environment Variables, puis Redeploy) :
// caches allongés sur les appels les plus coûteux, sans rien couper dans l'app. Effets :
//   • calendriers ESPN : cache CDN ×4, mois en cours gardé en mémoire ×4 ;
//   • matchs du jour ESPN : cache CDN 40 s → 120 s ;
//   • direct (fifa-live) : scoreboard ESPN 8 s → 20 s, résumé (stats) 30 s → 120 s, résultat partagé
//     entre spectateurs 8 s → 20 s. Le téléphone continue d'interroger toutes les 15 s ; un but peut
//     simplement apparaître jusqu'à ~20 s plus tard au lieu de ~8 s. Les notifs (Worker) ne changent pas.
// Retirer la variable (ou la mettre à 0) puis Redeploy pour revenir au réglage normal.
export const CPU_SAVER = process.env.CPU_SAVER === '1'
export const saver = (normal, eco) => (CPU_SAVER ? eco : normal)
