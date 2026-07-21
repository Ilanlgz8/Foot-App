import { useState, useEffect } from 'react'

// ⚠️ AJOUT (demande utilisateur explicite : "rajouter un logo ou un petit
// message au milieu de l'écran quand on capte pas assez niveau 4G/wifi pour
// savoir que l'app n'a pas assez de réseau pour mettre à jour les données")
//
// navigator.onLine (voir useOnline.js) ne détecte QUE la déconnexion totale
// (mode avion, wifi coupé) — pas une connexion présente mais trop faible/
// lente pour que les requêtes aboutissent, qui est le cas réellement visé
// ici (4G faible, wifi qui sature). Il n'existe pas d'API navigateur fiable
// et universelle pour mesurer ça directement (navigator.connection existe
// sur Chrome/Android mais PAS sur Safari/iOS, plateforme visiblement très
// utilisée par cette app — voir tous les correctifs iOS PWA dans ce projet).
//
// Signal retenu à la place : les VRAIS échecs réseau déjà observés. fdFetch
// (utils/fdFetch.js) a un timeout dur de 15s — si plusieurs appels de suite
// timeout/échouent réseau en peu de temps, c'est un signe concret et fiable
// que la connexion est trop faible pour l'app en ce moment, peu importe la
// plateforme. reportFetchFailure() est appelé depuis fdFetch ; useWeakNetwork
// expose l'état dérivé pour l'UI. Fenêtre glissante (pas un compteur qui ne
// redescend jamais) : dès que les requêtes recommencent à passer, le signal
// disparaît tout seul en quelques secondes.
const WINDOW_MS = 30_000
const THRESHOLD = 2  // 2 échecs réseau en 30s → signal réseau faible

let recentFailures = []
const listeners = new Set()

function prune() {
  const now = Date.now()
  recentFailures = recentFailures.filter(t => now - t < WINDOW_MS)
}

export function reportFetchFailure() {
  recentFailures.push(Date.now())
  prune()
  listeners.forEach(fn => fn())
}

function isWeak() {
  prune()
  return recentFailures.length >= THRESHOLD
}

export function useWeakNetwork() {
  const [weak, setWeak] = useState(isWeak)

  useEffect(() => {
    const check = () => setWeak(isWeak())
    listeners.add(check)
    // Re-vérifie périodiquement même sans nouvel échec : la fenêtre glissante
    // doit pouvoir repasser à false toute seule une fois les 30s écoulées,
    // pas seulement se déclencher sur un nouvel événement.
    const id = setInterval(check, 5_000)
    return () => { listeners.delete(check); clearInterval(id) }
  }, [])

  return weak
}
