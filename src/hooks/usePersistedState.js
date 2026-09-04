/**
 * usePersistedState — remplaçant direct de useState qui persiste sa valeur
 * dans sessionStorage.
 *
 * Pourquoi : App.jsx remonte tout le contenu de la page à chaque changement
 * de route (`key={location.pathname}`, voulu pour l'animation de transition
 * entre pages). Une conséquence secondaire : toute page avec un état de
 * navigation local (journée/tour sélectionné, onglet, vue, recherche...)
 * repart de zéro si on la quitte (ex: clic sur un match) puis qu'on y revient
 * (bouton retour) — même si on n'a fait qu'aller-retour. Constaté sur
 * Resultat.jsx ("Par journée" revenait toujours à la 1ère journée au lieu de
 * celle consultée) puis sur Match.jsx (pareil avec les tours à élimination
 * directe, 16e/8e...). Plutôt que dupliquer le même bout de code
 * sessionStorage dans chaque page, ce hook centralise le pattern.
 *
 * Usage : identique à useState, juste une clé en plus.
 *   const [currentIndex, setCurrentIndex] = usePersistedState('match_round_idx', 0)
 *
 * ⚠️ Une seule instance par clé à la fois doit être montée (pas de clé
 * partagée entre deux composants affichés simultanément).
 */
/**
 * ⚠️ AJOUT `ttlMs` (04/09, bug signalé par l'utilisateur : "dans Programme la
 * Ligue 1 on est à la 8e journée alors que normalement on est à la 3e, et
 * dans Résultats on est à la 1ère").
 *
 * Diagnostic : les deux pages sont JUSTES en session vierge (vérifié en
 * production, elles affichaient bien la journée 3 toutes les deux). Ce qui
 * était faux, c'est la position MÉMORISÉE ici. sessionStorage vit aussi
 * longtemps que l'onglet — et une PWA installée n'est presque jamais fermée
 * pour de bon : elle est mise en arrière-plan. La "session" de l'utilisateur
 * dure donc des jours, et il retombait sur la journée qu'il avait consultée
 * la dernière fois, pas sur la journée en cours.
 *
 * Le besoin d'origine reste valable — garder sa place en revenant d'une fiche
 * match (App.jsx remonte la page à chaque changement de route) — mais il ne
 * dure que le temps d'un aller-retour, pas plusieurs jours. `ttlMs` borne
 * donc cette mémoire : passé le délai, la valeur est ignorée et la page
 * repart sur son défaut (= la journée courante, recalculée à partir des
 * données).
 *
 * Une valeur écrite AVANT cet ajout n'a pas d'horodatage : elle est traitée
 * comme périmée. C'est volontaire — on ne peut pas dater ce qu'on n'a pas
 * daté, et ça purge du même coup l'état bloqué des utilisateurs actuels au
 * premier lancement après la mise à jour.
 *
 * Sans `ttlMs`, comportement strictement inchangé (préférences délibérées :
 * championnat sélectionné, mode d'affichage…).
 */
import { useState, useEffect } from 'react'

/**
 * Lecture / écriture extraites en fonctions PURES (exportées uniquement pour
 * être testées directement : le projet n'embarque pas @testing-library/react,
 * et cette logique — la seule qui puisse se tromper ici — n'a de toute façon
 * besoin d'aucun rendu React pour être vérifiée).
 */
export function readPersisted(raw, defaultValue, ttlMs, now = Date.now()) {
  if (raw == null) return defaultValue
  let parsed
  try { parsed = JSON.parse(raw) } catch { return defaultValue }
  if (ttlMs == null) return parsed
  // Forme horodatée : { __v: valeur, __t: timestamp }
  const dated = parsed != null && typeof parsed === 'object' && '__t' in parsed
  if (!dated) return defaultValue                       // écrite avant l'ajout du TTL
  if (now - parsed.__t > ttlMs) return defaultValue
  return parsed.__v
}

export function serializePersisted(state, ttlMs, now = Date.now()) {
  return JSON.stringify(ttlMs == null ? state : { __v: state, __t: now })
}

export function usePersistedState(key, defaultValue, ttlMs = null) {
  const [state, setState] = useState(() => {
    try {
      return readPersisted(sessionStorage.getItem(key), defaultValue, ttlMs)
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try { sessionStorage.setItem(key, serializePersisted(state, ttlMs)) } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return [state, setState]
}

/** Durée de vie d'une position de navigation (journée/tour/jour affiché).
 *  30 min : très large pour un aller-retour vers une fiche match, très court
 *  devant la durée réelle d'une "session" de PWA installée. */
export const NAV_POSITION_TTL = 30 * 60 * 1000
