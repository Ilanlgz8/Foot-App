import './WeakNetworkBanner.css'

// ⚠️ AJOUT (demande utilisateur explicite : "rajouter un logo ou un petit
// message au milieu de l'écran quand on capte pas assez niveau 4G/wifi pour
// savoir que l'app n'a pas assez de réseau" — voir useNetworkQuality.js pour
// la détection) : distinct de OfflineBanner (déconnexion TOTALE, en haut de
// l'écran) — celui-ci couvre le cas "techniquement connecté mais trop
// faible/lent pour que les requêtes aboutissent", affiché au centre pour
// rester visible sans bloquer la lecture du contenu (pointer-events: none).
export function WeakNetworkBanner() {
  return (
    <div className="weak-network-banner" role="status" aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 20h.01" />
        <path d="M7 20v-4" />
        <path d="M12 20v-8" />
        <path d="M17 20V8" opacity="0.35" />
        <path d="M22 20V4" opacity="0.2" />
      </svg>
      <span>Réseau faible — les données peuvent être en retard</span>
    </div>
  )
}
