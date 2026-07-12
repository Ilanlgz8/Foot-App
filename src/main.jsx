import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Auto-reload quand le SW prend le contrôle (skipWaiting + clientsClaim)
// → plus besoin de vider le cache Safari après chaque déploiement
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  })
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

// ⚠️ BUG TROUVÉ (constat utilisateur : "j'ai fermé/rouvert l'app, toujours pas
// les buteurs" — alors que la donnée ESPN est bien là, vérifié en direct sur
// l'API) : le cache React Query est persisté dans le localStorage (gcTime
// 24h) SANS AUCUNE clé de version. Concrètement, si une requête a échoué
// (renvoyé null) AVANT un correctif — ex: useEspnMatchDetail qui ne
// trouvait pas l'event ESPN à cause du bug de date corrigé juste avant —
// ce `null` reste persisté et continue d'être servi tel quel après le
// déploiement du correctif, PENDANT JUSQU'À 24H, même après avoir fermé et
// rouvert l'app (fermer/rouvrir ne vide pas le localStorage). `buster` est
// le mécanisme officiel TanStack Query pour ce cas précis : dès qu'il
// change, TOUT le cache persisté existant est jeté au démarrage, sans
// affecter les vraies données utilisateur (pronos, favoris, etc. — stockées
// ailleurs, pas dans ce cache). À incrémenter à chaque fois qu'un correctif
// touche la logique/forme d'une requête déjà potentiellement mise en cache
// avec une mauvaise valeur.
const CACHE_BUSTER = 'v2-2026-07-12-espn-dual-date-fix'

createRoot(document.getElementById('root')).render(
  <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, buster: CACHE_BUSTER }}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </PersistQueryClientProvider>
)
