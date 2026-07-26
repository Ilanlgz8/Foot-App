// ⚠️ AJOUT (25/07, constat utilisateur : "10 à 15 appels FD.org juste au
// lancement de l'Accueil, c'est beaucoup trop") : la Coupe du monde et l'Euro
// (WC/EC) sont les 2 SEULES compétitions encore sourcées FD.org qui n'ont
// PAS de fenêtre de match connue à l'avance côté app (contrairement aux
// championnats club, dont la saison est prévisible) — 5 hooks différents
// (useTodayMatches, useUpcomingMatchesAllComps, useWcKnockout, useTeamForm,
// useRecentDaysMatches) partent donc CHACUN de leur côté à la pêche via
// FD.org, avec leur propre cascade de repli, à CHAQUE chargement de
// l'Accueil — alors qu'en ce moment (ni Mondial ni Euro en cours ni proche),
// ces 10-15 appels ne trouvent structurellement RIEN, à chaque fois.
//
// Portillon partagé : UN SEUL vrai appel FD.org (`/v4/matches`, endpoint
// global, filtré par compétitions + fenêtre de dates généreuse) suffit à
// savoir si WC ou EC a ne serait-ce qu'UN match dans cette fenêtre — les 5
// hooks ci-dessus le consultent D'ABORD (fonction JS simple, pas un Hook —
// utilisable depuis leurs fonctions de fetch qui ne sont pas des composants)
// et sautent purement et simplement leur propre appel FD.org si la réponse
// est "non". Résultat caché 24h (le calendrier WC/EC ne bouge pas d'un jour
// à l'autre) et re-vérifié au plus tôt toutes les 6h (pas à chaque montage)
// — dans le pire cas, un vrai tournoi qui démarre est détecté avec au plus
// 6h de retard sur ce portillon, largement avant que le moindre match
// commence (aucun tournoi n'apparaît sans préavis de plusieurs semaines).
//
// Sécurité : en cas de doute (erreur réseau, 429/403, tout premier appel
// jamais fait) → renvoie `true` (comportement inchangé, laisse chaque hook
// faire son propre appel normalement) plutôt que de risquer de cacher un
// vrai tournoi. Ce portillon ne fait donc jamais QUE réduire des appels
// FD.org qui n'auraient rien trouvé — jamais supprimer un vrai match.
//
// ⚠️ BUG CRITIQUE CORRIGÉ (26/07, question utilisateur "au lancement de
// l'app c quoi les requêtes... dis moi tout" — audit demandé, pas un bug
// signalé au préalable) : `hasActivity` comptait N'IMPORTE QUEL match dans
// la fenêtre, y compris ceux déjà `FINISHED` — DAYS_BACK=30 couvrait donc
// tranquillement un Mondial qui vient de se terminer (finale CM 2026 le
// 19/07, vérifié via recherche web — nous sommes le 26/07, soit seulement
// 7 jours après). Conséquence concrète, vérifiée dans le code : le
// portillon répondait "oui, il y a de l'activité" en ce moment précis (le
// Mondial ENTIER, 11/06→19/07, tombe dans les 30 jours en arrière) — donc
// il ne bloquait plus AUCUNE des cascades qu'il est censé filtrer, et les 5
// hooks partaient tous en cascade normalement : environ 20 vrais appels
// FD.org en moins de 20 secondes à chaque lancement à froid de l'app,
// jusqu'à ce que le Mondial sorte enfin de la fenêtre de 30 jours (~19/08).
// Root cause : le portillon avait été conçu et testé UNIQUEMENT en période
// creuse (pas de tournoi récent), jamais revérifié juste après la fin d'un
// vrai Mondial — l'hypothèse "cas quasi permanent hors Mondial/Euro" du
// commentaire d'origine ne tenait déjà plus.
// Fix : DAYS_BACK aligné sur le VRAI besoin le plus large des appelants —
// RESULTS_DAYS_BACK=7 (Accueil.jsx, useRecentDaysMatches) est la fenêtre
// arrière la plus longue réellement consultée (useTodayMatches ne regarde
// qu'aujourd'hui/hier). 7 jours après la finale, le Mondial sort donc de
// cette fenêtre et le portillon redevient protecteur — au prix, en théorie,
// d'un délai possible de quelques heures si un match WC/EC réapparaissait
// pile à J-7/J-8 (cas non réaliste : aucun tournoi ne reprend le lendemain
// de sa propre finale).
import { fdFetch, fdUrl } from './fdFetch'
import { readCacheStale, writeCache, getCacheSavedAt } from '../hooks/localCache'

const GATE_KEY        = 'wcEcActivityGate_v1'
const GATE_DISK_TTL   = 24 * 60 * 60 * 1000 // 24h — survie sur disque (purge)
const GATE_REFRESH_MS = 6 * 60 * 60 * 1000  // 6h — au-delà, on retente un vrai check
const DAYS_BACK        = 7
const DAYS_FORWARD     = 120

function fmtDate(d) { return d.toISOString().slice(0, 10) }

let inFlight = null // dédup si plusieurs hooks appellent en même temps au montage

// ⚠️ AJOUT `fresh` (25/07, même jour, constat utilisateur : "la Coupe du
// monde fait un 429, pas les autres compétitions") : ce portillon fait
// lui-même un vrai appel FD.org (dès que son cache disque a plus de 6h) —
// mais chaque appelant enchaînait IMMÉDIATEMENT son propre vrai appel juste
// après, sans respecter le même verrou d'espacement global (~6s) que TOUT
// LE RESTE de ce fichier applique déjà entre 2 vraies requêtes consécutives.
// Résultat : le portillon lui-même consommait le verrou, et l'appel de
// données qui suivait aussitôt se faisait bloquer par NOTRE PROPRE garde-fou
// serveur (api/football.js) — un vrai 429 auto-infligé, spécifique aux
// hooks WC/EC (les seuls à consulter ce portillon), jamais aux compétitions
// club. Comme pour tryFetchWithMeta ailleurs dans l'app : on expose
// désormais si CET appel précis vient de vraiment taper FD.org, pour que
// l'appelant attende les ~6s restants avant son propre appel si besoin.
export async function shouldQueryWcEcWithMeta() {
  const savedAt = getCacheSavedAt(GATE_KEY)
  const cached  = readCacheStale(GATE_KEY)

  // Cache encore frais (<6h) : on fait confiance sans re-taper FD.org — pas
  // d'appel réel, donc rien à espacer pour l'appelant (`fresh: false`).
  if (cached != null && Date.now() - savedAt < GATE_REFRESH_MS) {
    return { should: cached, fresh: false }
  }

  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const now  = new Date()
      const from = new Date(now); from.setDate(from.getDate() - DAYS_BACK)
      const to   = new Date(now); to.setDate(to.getDate() + DAYS_FORWARD)
      const res  = await fdFetch(fdUrl(
        `/api/v4/matches?competitions=WC,EC&dateFrom=${fmtDate(from)}&dateTo=${fmtDate(to)}`
      ))
      const fresh = !res.headers.get('X-Cache')
      if (!res.ok) return { should: cached ?? true, fresh } // incertain → ne bloque rien
      const json = await res.json()
      const hasActivity = (json.matches ?? []).length > 0
      writeCache(GATE_KEY, hasActivity, GATE_DISK_TTL)
      return { should: hasActivity, fresh }
    } catch {
      return { should: cached ?? true, fresh: false } // incertain → ne bloque rien
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

// Repli simple (booléen seul) pour un appelant qui n'a pas besoin de gérer
// l'espacement lui-même.
export async function shouldQueryWcEc() {
  const { should } = await shouldQueryWcEcWithMeta()
  return should
}
