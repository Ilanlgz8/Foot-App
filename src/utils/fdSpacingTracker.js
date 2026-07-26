// ⚠️ AJOUT (26/07, constat utilisateur : "on devra attendre 6 secondes pour
// chaque truc c chiant un peu nn ?" — suite au fix du stagger 2s/4s
// insuffisant dans Classement.jsx/MatchModal.jsx/MatchPage.jsx/
// LiveMatchPage.jsx) : le fix précédent utilisait un délai FIXE (6s/12s)
// imposé à l'aveugle à chaque appelant, même quand ce n'était pas
// nécessaire.
//
// ⚠️ CORRIGÉ (même jour, quelques minutes plus tard — auto-relecture après
// une question de l'utilisateur "t sur que c bien ce qu'on a fait") : une
// 1ère version de ce module marquait un simple TIMESTAMP *après* avoir lu
// le header X-Cache de la réponse (donc après le `await fetch(...)`).
// Vérifié par une simulation directe avec @tanstack/query-core (2 hooks
// dans le même composant, comme Classement.jsx) : la partie SYNCHRONE de
// chaque queryFn (avant son propre `await`) s'exécute quasiment au même
// instant pour tous les hooks d'un même composant (à 1-2ms d'écart, dans
// l'ordre de déclaration des hooks) — donc le hook voisin lisait ce
// timestamp AVANT que le 1er hook ait fini son fetch et l'ait posé,
// systématiquement dans le cas qu'on cherche justement à protéger (1ère
// visite, tous les hooks démarrent en même temps). Résultat : plus aucune
// protection réelle dans le cas courant, silencieusement.
//
// Cette version enregistre une PROMESSE (pas un timestamp) dès le début du
// fetch — le hook voisin peut alors réellement ATTENDRE la réponse avant de
// décider s'il doit patienter, au lieu de deviner sur un état pas encore à
// jour. Revérifié par la même simulation (avec une vraie latence réseau
// simulée, 100-150ms) : le hook voisin attend bien la réponse du 1er hook,
// n'ajoute une pause SEULEMENT si ce 1er hook a vraiment tapé FD.org (pas
// juste servi une copie cache serveur, voir X-Cache), et seulement le temps
// qui reste réellement avant l'expiration du verrou serveur. La boucle de
// re-vérification (voir waitForFdSpacing) gère aussi le cas à 3 hooks
// (Classement.jsx : standings→teamForm→scorers) — si un 2e appel réel a été
// enregistré pendant l'attente du 1er, on attend aussi celui-là avant de
// continuer, plutôt que de foncer dessus.
let currentAttempt = null
let currentAttemptStartedAt = 0

// Appelé par le hook qui lance un vrai fetch FD.org, JUSTE AVANT de
// l'attendre (donc avant même de savoir si la réponse sera "fresh" ou
// servie depuis le cache serveur) — `freshPromise` doit résoudre en
// `true`/`false` une fois la réponse arrivée (jamais rejeter : les hooks
// voisins ne doivent pas planter si CET appel échoue).
export function registerFdCallAttempt(freshPromise) {
  currentAttempt = freshPromise
  currentAttemptStartedAt = Date.now()
}

// spacingMs doit rester alignée sur SPACING_MS côté serveur (6s tant que
// MINUTE_CAP=10, voir api/football.js) — même valeur codée en dur ailleurs
// dans l'app (wcEcGate.js, useMatchs.js, useTeamForm.js, useScorers.js).
export async function waitForFdSpacing(spacingMs = 6_000) {
  for (let i = 0; i < 5; i++) {
    const attempt   = currentAttempt
    const startedAt = currentAttemptStartedAt
    if (!attempt) return   // aucun appel voisin en cours/récent — rien à attendre

    let fresh
    try { fresh = await attempt } catch { return }

    if (fresh) {
      const remaining = spacingMs - (Date.now() - startedAt)
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining))
    }

    // Un appel PLUS RÉCENT a été enregistré pendant qu'on attendait
    // celui-ci (cas à 3 hooks, ex: scorers attend standings PUIS
    // teamForm) — on reboucle pour l'attendre aussi, sinon on fonce dessus.
    if (currentAttempt === attempt) return
  }
}
