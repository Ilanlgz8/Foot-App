
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Auto-reload quand le SW prend le contrôle (skipWaiting + clientsClaim)
// → plus besoin de vider le cache Safari après chaque déploiement
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  })

  // Le check natif du navigateur ne se déclenche que sur une vraie navigation.
  // Ouvrir la PWA depuis l'icône (retour au premier plan depuis le fond) n'en
  // est pas toujours une → sans ceci, une PWA restée "en veille" peut ne
  // jamais découvrir qu'une nouvelle version est dispo. On force la vérif
  // à chaque passage au premier plan (via le header Cache-Control: no-cache
  // posé sur /sw.js côté vercel.json, sw.js est toujours revalidé ici).
  const checkForUpdate = () => navigator.serviceWorker.getRegistration().then(reg => reg?.update())

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })

  // ⚠️ AJOUT (constat utilisateur : app iOS installée sur l'écran d'accueil,
  // laissée ouverte plusieurs heures sans être vraiment fermée/rouverte —
  // "j'ai pas les nouveaux articles, ça fait 6h") : sur iOS en mode standalone,
  // visibilitychange ne suffit pas toujours (l'app peut rester "visible" en
  // arrière-plan léger sans déclencher l'événement, ou l'event est raté selon
  // la version iOS) — sans second filet, une session ouverte longtemps peut ne
  // jamais revérifier une nouvelle version tant qu'elle n'est pas vraiment
  // tuée puis relancée. Vérif périodique tant que l'app est au premier plan :
  // coût nul (un simple fetch conditionnel de sw.js, déjà no-cache), et
  // rattrape ce cas sans dépendre d'un événement qui peut ne pas se déclencher.
  setInterval(() => {
    if (document.visibilityState === 'visible') checkForUpdate()
  }, 10 * 60 * 1000) // 10min
}
import { BrowserRouter } from 'react-router-dom'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // garde en cache 24h dans localStorage
      retry: false,
      refetchOnWindowFocus: false,
      // 'always' → RQ ne met jamais les requêtes en pause à cause du réseau
      // Fix iOS PWA : au cold start, RQ peut détecter "offline" et bloquer les fetches silencieusement
      networkMode: 'always',
      // Refetch dès que le réseau revient (online event iOS)
      refetchOnReconnect: true,
    }
  }
})

const persister = createSyncStoragePersister({
  storage: window.localStorage
})

// ⚠️ BUG TROUVÉ DE NOUVEAU (constat utilisateur, même symptôme que le
// correctif ci-dessus mais un autre jour : "toujours pas les buteurs" alors
// que la donnée ESPN est vérifiée bonne en direct sur l'API — fermer/rouvrir
// l'app ne suffit pas, voir l'explication complète juste au-dessus) : le
// correctif du 2026-07-15 (fallback scoreboard→summary dans
// useEspnMatchDetail.js ET useEspnMatchStats) change la donnée renvoyée par
// ces deux requêtes déjà potentiellement en cache avec un résultat vide
// persisté AVANT ce correctif — sans bump du buster, ce vide serait resservi
// jusqu'à 24h malgré le fix déployé. Toujours incrémenter ce buster à chaque
// correctif qui touche la logique/forme d'une requête déjà en cache.
const CACHE_BUSTER = 'v4-2026-07-15-espn-scoreboard-fallback'

createRoot(document.getElementById('root')).render(
  <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, buster: CACHE_BUSTER }}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </PersistQueryClientProvider>
)
