import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
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
    }
  }
})

const persister = createSyncStoragePersister({
  storage: window.localStorage
})

createRoot(document.getElementById('root')).render(
  <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </PersistQueryClientProvider>
)
