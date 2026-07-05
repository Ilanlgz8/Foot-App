// ── Mapping id football-data.org → slug ESPN ──────────────────────────────────
// Utilisé côté serveur par api/fifa-live.js (matching FD.org ↔ ESPN) et
// api/cron-goals.js (liste des slugs à parcourir). Fichier séparé de
// src/data/competitions.js volontairement : ce dernier importe des assets
// (logos SVG/PNG) qui ne se bundlent pas de la même façon côté fonctions
// serverless Vercel — ce fichier reste pure donnée, sans aucun import, pour
// être importable sans risque des deux côtés (client ET api/*.js).
//
// ⚠️ INCOHÉRENCE CORRIGÉE : ce mapping existait en double — une copie dans
// api/fifa-live.js (avec les id FD.org) et une autre dans api/cron-goals.js
// (simple tableau de slugs, sans id — cron n'en a pas besoin, il boucle sur
// tous les matchs ESPN sans les rattacher à un match FD.org précis). Les deux
// copies devaient être maintenues manuellement synchronisées — risque réel
// d'oubli si une compétition est ajoutée un jour dans un fichier sans penser
// à l'autre. Une seule source ici désormais ; cron-goals.js dérive son
// tableau de slugs via Object.values(ESPN_SLUG_BY_COMP_ID).
//
// Inclut Europa League (2146) et Conference League (2048) : suivies pour les
// notifs/scores live (ESPN/FIFA) mais sans intégration football-data.org
// dans l'app (pas de classement/programme dédié) — d'où leur absence de
// COMPETITION_ESPN_SLUG/COMPETITIONS dans competitions.js, qui ne couvrent
// que les compétitions sélectionnables dans l'UI.
export const ESPN_SLUG_BY_COMP_ID = {
  2000: 'fifa.world',       // WC 2026
  2015: 'fra.1',
  2021: 'eng.1',
  2014: 'esp.1',
  2002: 'ger.1',
  2019: 'ita.1',
  2001: 'uefa.champions',
  2146: 'uefa.europa',
  2048: 'uefa.europa.conf',
}
