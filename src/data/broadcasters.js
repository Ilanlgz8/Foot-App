// src/data/broadcasters.js
// Diffuseur TV connu pour un match — UNIQUEMENT des infos vérifiées
// publiquement, jamais devinées. Mieux vaut ne rien afficher que d'inventer.
//
// ⚠️ ÉTENDU (28/08, demande utilisateur : "montre où regarder le match", pas
// juste les cas gratuits) : ce fichier ne couvrait avant QUE la Coupe du
// Monde 2026 sur M6 (demi-finales/petite finale/finale, seul cas gratuit
// certain à 100%). Recherche faite le 28/08 (sources : megazap.fr "Droits TV
// Football 2026/2027", article du 07/08/2026, + Maxifoot/Selectra/Goal.com,
// toutes concordantes) pour la saison 2026-2027 en France :
//
//  - Ligue 1        → Ligue 1+ (intégralité des 306 matchs, diffuseur unique)
//  - Premier League  → CANAL+ (intégralité, droits UEFA+PL conservés par Canal+)
//  - Ligue des Champions/Europa/Conférence/Supercoupe UEFA → CANAL+
//  - La Liga         → DAZN + Disney+ (co-diffusion intégrale des 380 matchs,
//                       commentaire français via ESPN sur Disney+)
//  - Bundesliga      → beIN Sports
//  - Serie A         → DAZN
//  - CAN 2027        → beIN Sports
//
// ⚠️ Volontairement PAS codées (pas de source fiable donnant une règle
// certaine à 100% match par match, même logique que le WC hors demi/finale) :
//  - Ligue des Nations : seulement "plusieurs affiches" sur La chaîne
//    L'Équipe — sélection éditoriale, pas toutes les rencontres.
//  - Coupe de France : beIN Sports seulement "à partir des 32es de finale"
//    — nécessiterait de connaître le tour de CHAQUE match, pas disponible ici.
//  - Copa America, Euro (pas d'édition dans la fenêtre actuelle), FA Cup,
//    Trophée des Champions, Community Shield : aucune source fiable trouvée
//    au moment de cette recherche.
//
// Droits TV valables pour une saison/édition donnée — à revérifier si jamais
// pris en défaut (le marché s'est beaucoup fragmenté pour 2026-2027, un
// nouvel appel d'offres UEFA est déjà prévu fin 2026 pour après 2026-2027).
const FREE_M6_STAGES = new Set(['SEMI_FINALS', 'THIRD_PLACE', 'FINAL'])

// Diffuseur payant par code compétition — couverture INTÉGRALE confirmée
// (pas de sélection partielle de matchs), donc sûr à afficher sans connaître
// le détail de la programmation.
const PAID_BY_COMP = {
  FL1:  { name: 'Ligue 1+' },
  PL:   { name: 'CANAL+' },
  CL:   { name: 'CANAL+' },
  UEL:  { name: 'CANAL+' },
  UECL: { name: 'CANAL+' },
  USC:  { name: 'CANAL+' },
  PD:   { name: 'DAZN / Disney+' },
  BL1:  { name: 'beIN Sports' },
  SA:   { name: 'DAZN' },
  CAN:  { name: 'beIN Sports' },
}

/**
 * Retourne { name, url, free } si on a une info FIABLE de diffusion pour ce
 * match, sinon null (jamais d'invention). `free: true` uniquement pour le
 * cas M6/Coupe du Monde, seul diffuseur gratuit confirmé — le reste est un
 * accès payant (abonnement), affiché comme simple info pratique, pas comme
 * une offre gratuite.
 */
export function getBroadcaster(match) {
  const isWC = match?.competition?.id === 2000 || match?.competition?.code === 'WC'
  if (isWC) {
    if (!FREE_M6_STAGES.has(match?.stage)) return null
    return { name: 'M6', url: 'https://www.6play.fr/m6', free: true }
  }
  const compCode = match?.competition?.code
  const paid = compCode ? PAID_BY_COMP[compCode] : null
  if (!paid) return null
  return { name: paid.name, url: null, free: false }
}

// ⚠️ Conservé pour compat (nom historique) — WatchBadge.jsx utilise
// désormais getBroadcaster ci-dessus, plus général.
export function getFreeBroadcaster(match) {
  const b = getBroadcaster(match)
  return b?.free ? b : null
}
