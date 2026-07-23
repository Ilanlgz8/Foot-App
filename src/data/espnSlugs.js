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
// pour la Coupe de France, la Copa del Rey, etc." — réponse initiale : le
// score/statut basique oui, mais AUCUNE notif push) : ESPN_SLUGS (cron,
// api/cron-goals.js/cf-worker) ne couvrait que ESPN_SLUG_BY_COMP_ID (id
// football-data.org réel : PL, FL1, CL, WC...) — les coupes nationales
// (Coupe de France/Copa del Rey/FA Cup, voir DOMESTIC_CUPS dans
// competitions.js) et NL/CAN/COPA (voir ESPN_SOURCED_COMPS dans
// useMatchs.js) n'y avaient jamais d'entrée : invisibles pour le cron (0
// notif), et suivies en direct par le client à un rythme plus lent (2min,
// pas de correspondance avec un event ESPN précis — voir espnNativeSlug plus
// bas pour le fix apporté ensuite).
//
// Ces compétitions n'ont PAS de vrai id football-data.org (sourcées 100%
// ESPN, voir espnAdapter.js/SYNTHETIC_COMP_ID) — impossible de les ajouter
// à ESPN_SLUG_BY_COMP_ID (indexée par cet id précis) sans risquer de casser
// le matching FD.org↔ESPN par nom d'équipe qui s'appuie dessus ailleurs
// (api/fifa-live.js, useLiveMinute.js/COMP_ESPN — fragile, voir tout
// l'historique CLAUDE.md dessus). Deux tables séparées, indexées par le CODE
// de compétition (string, jamais en collision avec les id numériques) :
export const NATIONAL_COMP_SLUGS = {
  NL:   'uefa.nations',       // Ligue des Nations
  CAN:  'caf.nations',        // CAN
  COPA: 'conmebol.america',   // Copa America
}
export const DOMESTIC_CUP_SLUGS = {
  FL1: 'fra.coupe_de_france',  // Coupe de France (code du championnat PARENT)
  PD:  'esp.copa_del_rey',     // Copa del Rey
  PL:  'eng.fa',                // FA Cup
}
// Coupes d'Europe de club, standalone (pas fusionnées dans un championnat
// parent, contrairement à DOMESTIC_CUP_SLUGS) — ajoutées suite à la demande
// utilisateur du 23/07 ("et pour la ligue europa et la ligue conference espn
// prend ça en compte normalement ?"). Les valeurs 2146/2048 existaient déjà
// dans ESPN_SLUG_BY_COMP_ID plus haut (ajoutées avant même une intégration
// complète, pour le cron uniquement) — gardées telles quelles là-bas
// (inertes, aucun vrai match football-data.org n'aura jamais ces id), le
// vrai branchement pour ces matchs passe désormais par ici (code string,
// même mécanisme que NATIONAL_COMP_SLUGS/DOMESTIC_CUP_SLUGS).
export const EUROPEAN_CUP_SLUGS = {
  UEL:  'uefa.europa',
  UECL: 'uefa.europa.conf',
}

// Liste à plat pour le cron (api/cron-goals.js, cf-worker/src/index.js) —
// aucun besoin d'id précis à cet endroit, il parcourt juste tous les slugs.
export const EXTRA_NOTIFY_SLUGS = [
  ...Object.values(NATIONAL_COMP_SLUGS),
  ...Object.values(DOMESTIC_CUP_SLUGS),
  ...Object.values(EUROPEAN_CUP_SLUGS),
]

// ⚠️ AJOUT (suite directe du point ci-dessus, demande utilisateur explicite :
// "mets-les sur le système rapide eux aussi, sans rien casser") : identifie
// le slug ESPN d'un match DÉJÀ sourcé depuis ESPN (id `espn-...`, voir
// espnAdapter.js/normalizeEvent) — utilisé par api/fifa-live.js et
// useLiveMinute.js pour brancher CES matchs précis sur le pipeline de live
// rapide (poll 5-10s, minute réelle, score à jour) SANS toucher au chemin
// existant des matchs football-data.org (fuzzy-match par nom, voir
// api/fifa-live.js) : ces matchs connaissent déjà leur event ESPN exact
// (l'id est intégré dans match.id, voir extraction juste après dans
// api/fifa-live.js) — pas besoin de deviner par nom d'équipe comme pour un
// match football-data.org, donc pas le même risque de régression sur ce
// matching-là, déjà fragile par ailleurs.
export function espnNativeSlug(match) {
  if (!String(match?.id ?? '').startsWith('espn-')) return null
  if (match.isCup) return DOMESTIC_CUP_SLUGS[match.competition?.code] ?? null
  const code = match.competition?.code
  return NATIONAL_COMP_SLUGS[code] ?? EUROPEAN_CUP_SLUGS[code] ?? null
}
