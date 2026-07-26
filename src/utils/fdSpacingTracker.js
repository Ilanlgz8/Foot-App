// ⚠️ AJOUT (26/07, constat utilisateur : "on devra attendre 6 secondes pour
// chaque truc c chiant un peu nn ?" — suite au fix du stagger 2s/4s
// insuffisant dans Classement.jsx/MatchModal.jsx/MatchPage.jsx/
// LiveMatchPage.jsx) : le fix précédent utilisait un délai FIXE (6s/12s)
// imposé à l'aveugle à chaque appelant, même quand ce n'était pas
// nécessaire (ex: la 1ère requête servait déjà une copie cache côté
// serveur — X-Cache présent — donc n'occupait PAS le verrou d'espacement,
// mais le 2e hook attendait quand même 6s pour rien).
//
// Ce module remplace ce délai fixe par une attente ADAPTATIVE, partagée
// entre les hooks INDÉPENDANTS d'une même page (React Query ne les lie pas
// nativement entre eux) : un hook qui vient de faire un VRAI appel FD.org
// (fresh, voir X-Cache) le signale ici via markFdCallFresh() ; un hook
// voisin qui a besoin de faire son propre appel juste après attend, via
// waitForFdSpacing(), UNIQUEMENT le temps qui reste réellement avant
// l'expiration du verrou serveur (SPACING_MS, voir reserveQuota() dans
// api/football.js) — jamais une attente aveugle, et zéro attente du tout si
// aucun appel frais n'a eu lieu récemment (cache déjà chaud, jour sans
// match, etc. — le cas le plus fréquent en pratique).
//
// Portée volontairement limitée à cet onglet/cette page (variable en
// mémoire, pas de coordination inter-onglets/inter-utilisateurs — le verrou
// serveur, lui, reste global et protège déjà contre ça) : suffisant pour
// éliminer la collision qu'on cherche à corriger ici (2-3 hooks du MÊME
// composant qui se marchent dessus), pas prétendu résoudre un pic de trafic
// multi-utilisateurs.
let lastFreshCallAt = 0

export function markFdCallFresh() {
  lastFreshCallAt = Date.now()
}

// spacingMs doit rester alignée sur SPACING_MS côté serveur (6s tant que
// MINUTE_CAP=10, voir api/football.js) — même valeur codée en dur ailleurs
// dans l'app (wcEcGate.js, useMatchs.js, useTeamForm.js, useScorers.js).
export async function waitForFdSpacing(spacingMs = 6_000) {
  const remaining = spacingMs - (Date.now() - lastFreshCallAt)
  if (remaining > 0) await new Promise(r => setTimeout(r, remaining))
}
