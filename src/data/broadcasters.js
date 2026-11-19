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
// ⚠️ MIS À JOUR (19/11, sources Maxifoot 2026-27, Ozap, Afrik-Foot) : Ligue 2 et Coupe de France (dès
// les 32es) → beIN ; Ligue 3 → Ligue 1+ ; DFB-Pokal et FA Cup → beIN ; Copa del Rey et Coppa Italia →
// DAZN ; matchs de l'équipe de France (Ligue des nations, éliminatoires de l'Euro) → TF1 ; éliminatoires
// CAN → beIN pour les sélections annoncées. Le bloc ci-dessous (28/08) est l'état d'alors.
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
  FL2:  { name: 'beIN Sports' },   // 19/11 : beIN, 100 % des matchs en exclusivité, contrat 2024-2029 (vérifié)
  L3:   { name: 'Ligue 1+' },      // 19/11 : Ligue 1+ diffuse la Ligue 1 et la Ligue 3 (Maxifoot, droits 2026-27)
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
// Coupes nationales (19/11, vérifié Maxifoot « où suivre le foot en 2026-2027 ») : un match de coupe
// porte le code du CHAMPIONNAT (FL1, PD…) avec isCup — avant ce correctif, une rencontre de Coupe de
// France affichait donc « Ligue 1+ » et une Copa del Rey « DAZN / Disney+ », à tort.
const PAID_BY_CUP = {
  FL1: { name: 'beIN Sports', fromMonth: 12 }, // Coupe de France : beIN, à partir des 32es de finale (décembre)
  BL1: { name: 'beIN Sports' },                // DFB-Pokal
  PL:  { name: 'beIN Sports' },                // FA Cup
  PD:  { name: 'DAZN' },                       // Copa del Rey
  SA:  { name: 'DAZN' },                       // Coppa Italia
}

// Sélections (19/11, vérifié) : TF1 a l'exclusivité de TOUS les matchs de l'équipe de France jusqu'en 2028
// (Ligue des nations, amicaux, éliminatoires de l'Euro 2028), en clair. Les autres rencontres : pas de
// règle sûre match par match → rien.
const isFrance = t => /^france$/i.test(String(t?.name ?? t?.shortName ?? '').trim())
// Éliminatoires CAN 2027 : beIN Sports seul en France, mais une sélection de matchs — tous ceux de ces
// sélections sont annoncés (Afrik-Foot) ; les autres : rien plutôt qu'un diffuseur peut-être faux.
const CANQ_BEIN_TEAMS = /^(morocco|maroc|algeria|alg[ée]rie|tunisia|tunisie|senegal|s[ée]n[ée]gal|ivory coast|c[ôo]te d.ivoire|cameroon|cameroun|dr congo|congo dr|rd congo|democratic republic of (the )?congo)$/i
const teamIn = (re, m) => [m?.homeTeam, m?.awayTeam].some(t => re.test(String(t?.name ?? t?.shortName ?? '').trim()))

export function getBroadcaster(match) {
  const isWC = match?.competition?.id === 2000 || match?.competition?.code === 'WC'
  if (isWC) {
    if (!FREE_M6_STAGES.has(match?.stage)) return null
    return { name: 'M6', url: 'https://www.6play.fr/m6', free: true }
  }
  const compCode = match?.competition?.code
  if (compCode === 'NL' || compCode === 'ECQ') {
    return (isFrance(match?.homeTeam) || isFrance(match?.awayTeam)) ? { name: 'TF1', url: null, free: true } : null
  }
  if (compCode === 'CANQ') {
    return teamIn(CANQ_BEIN_TEAMS, match) ? { name: 'beIN Sports', url: null, free: false } : null
  }
  if (match?.isCup) {
    const cup = compCode ? PAID_BY_CUP[compCode] : null
    if (!cup) return null
    if (cup.fromMonth) {
      const mo = new Date(match?.utcDate).getMonth() + 1
      if (!(mo >= cup.fromMonth || mo <= 6)) return null   // décembre → juin
    }
    return { name: cup.name, url: null, free: false }
  }
  const paid = compCode ? PAID_BY_COMP[compCode] : null
  if (!paid) return null
  return { name: paid.name, url: null, free: false }
}

export function getFreeBroadcaster(match) {
  const b = getBroadcaster(match)
  return b?.free ? b : null
}
