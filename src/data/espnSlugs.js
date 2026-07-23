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
  // Euro — ajouté pour couvrir la même compétition que COMPETITIONS/EC dans
  // competitions.js. ⚠️ id 2018 = meilleur souvenir de la valeur numérique
  // football-data.org pour "European Championship", PAS vérifié en direct
  // contre un vrai payload FD.org (pas de clé API dispo pour tester depuis
  // cet environnement) — à confirmer au premier vrai match Euro live si le
  // matching FD.org↔ESPN semble décalé (impact limité : juste l'enrichissement
  // live via fifa-live.js, pas le Programme/Résultats/Classement de base qui
  // utilisent le code string 'EC', pas cet id numérique).
  2018: 'uefa.euro',
}

// ⚠️ AJOUT (constat utilisateur : "est-ce qu'on aura bien les matchs en live
// pour la Coupe de France, la Copa del Rey, etc." — réponse : le score/statut
// basique oui, mais AUCUNE notif push) : ESPN_SLUGS ci-dessus (dérivé de
// ESPN_SLUG_BY_COMP_ID) est ce que le cron (api/cron-goals.js, cf-worker/
// src/index.js) parcourt pour détecter but/carton/mi-temps/fin et envoyer
// les push — les coupes nationales (Coupe de France/Copa del Rey/FA Cup,
// voir DOMESTIC_CUPS dans competitions.js) et NL/CAN/COPA (voir
// ESPN_SOURCED_COMPS dans useMatchs.js) n'y ont jamais eu d'entrée : ces
// compétitions étaient invisibles pour le cron, donc 0 notif envoyée, tout en
// s'affichant normalement (à un rythme plus lent) en Programme/Résultats/Live
// côté client (chemin de fetch totalement différent, voir espnAdapter.js).
// Volontairement PAS ajoutées à ESPN_SLUG_BY_COMP_ID ci-dessus : cette table
// est indexée par le VRAI id numérique football-data.org, utilisée ailleurs
// (api/fifa-live.js, useLiveMinute.js/COMP_ESPN) pour faire correspondre un
// match football-data.org à l'event ESPN correspondant par nom d'équipe — un
// usage différent, avec un vrai risque de casser ce matching (fragile, voir
// tout l'historique CLAUDE.md dessus) si on y glisse des id synthétiques qui
// ne représentent pas de vrais matchs football-data.org. Liste séparée,
// fusionnée uniquement dans le tableau à plat que le cron parcourt (aucun
// besoin d'id précis à cet endroit, voir commentaire au-dessus de ESPN_SLUGS
// dans cron-goals.js/cf-worker).
export const EXTRA_NOTIFY_SLUGS = [
  'uefa.nations',          // Ligue des Nations
  'caf.nations',           // CAN
  'conmebol.america',      // Copa America
  'fra.coupe_de_france',   // Coupe de France
  'esp.copa_del_rey',      // Copa del Rey
  'eng.fa',                // FA Cup
]
