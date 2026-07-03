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
import { useState, useEffect } from 'react'

export function usePersistedState(key, defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw != null ? JSON.parse(raw) : defaultValue
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(state)) } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return [state, setState]
}
