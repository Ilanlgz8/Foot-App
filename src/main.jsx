
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
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { removeOldestQuery } from '@tanstack/query-persist-client-core'

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

// ⚠️ BUG CORRIGÉ (constat utilisateur : "les matchs de Ligue 1 gardent bien
// leurs stats/compos, mais pour la Coupe du Monde ça finit par disparaître
// avec le temps, alors que le déroulement du match reste, lui" — distinction
// clé qui a permis de trouver la vraie cause) : `createSyncStoragePersister`
// écrit TOUT le cache React Query (toutes les requêtes actives, gcTime 24h)
// en UN SEUL blob JSON dans localStorage à chaque mise à jour. La CM a
// beaucoup plus de matchs consultés qu'une poignée de matchs de Ligue 1 de
// test, et surtout des payloads bien plus gros par match (compos = ~15
// joueurs par équipe avec nom/poste/numéro, pour les 2 équipes, plus les
// stats détaillées) — ce blob grossit donc bien plus vite pour la CM.
// localStorage a un quota par origine (~5-10 Mo selon navigateurs) : une
// fois dépassé, `localStorage.setItem` lève une erreur (QuotaExceededError)
// et l'écriture entière échoue SILENCIEUSEMENT sans `retry` — la mise à jour
// la plus récente (compos/stats fraîchement récupérées) n'est alors jamais
// sauvegardée, et une revisite plus tard retombe sur une version antérieure
// du blob (voire vide) pour CES requêtes précises. Le "déroulement" (juste
// les buteurs/cartons, un petit tableau) reste lui quasi toujours en dessous
// du point de bascule, d'où l'écart observé entre les deux. `retry:
// removeOldestQuery` (utilitaire officiel TanStack) réessaie l'écriture en
// supprimant la requête la plus ancienne du blob à chaque échec, jusqu'à ce
// que ça rentre — élimination progressive des plus vieux matchs consultés
// plutôt qu'une perte totale/aléatoire de la donnée la plus récente.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  retry: removeOldestQuery,
})

// ⚠️ AJOUT (demande utilisateur : "je veux qu'il n'y ait AUCUN problème,
// même en consultant plusieurs matchs" — traiter la cause plutôt que le
// symptôme) : `retry: removeOldestQuery` ci-dessus est un filet de sécurité
// qui empêche un dépassement de quota de tout casser, mais le blob
// localStorage continue quand même à grossir sans limite tant qu'on ne lui
// dit pas quoi garder. Ces requêtes précises (buteurs/cartons, compos,
// stats détaillées d'un match) sont déjà en cache PERMANENT côté SERVEUR
// (Redis, voir api/espn.js et api/fifa-lineups.js) — un aller-retour vers
// notre propre backend (juste une lecture Redis, quasi instantané, pas un
// vrai appel ESPN) suffit à les retrouver après un rechargement. Les exclure
// de la persistance localStorage règle le problème à la racine plutôt que
// de gérer l'accumulation : elles restent bien en cache MÉMOIRE React Query
// pendant toute la session (navigation instantanée d'un match à l'autre,
// zéro perte de rapidité), seule la sauvegarde disque entre 2 sessions est
// sautée pour CES requêtes précises — celles qui grossissent vraiment vite
// sur une compétition à beaucoup de matchs comme la Coupe du Monde (compos
// = ~15 joueurs par équipe × 2 équipes, en plus des stats détaillées).
// Tout le reste (classements, calendrier du jour, formulaire des équipes...)
// continue d'être persisté normalement : ce sont des listes bornées (une
// entrée par compétition/jour, pas une par match jamais consulté), donc
// aucun risque de croissance illimitée de ce côté-là.
const UNPERSISTED_QUERY_KEYS = new Set([
  'espnMatchDetail',   // déroulement (buteurs/cartons) — useEspnMatchDetail.js
  'espnSummary',       // stats live (MatchModal.jsx)
  'lineups2',          // compos — useLineups
  'espnMatchStats2',   // stats + compos (Résultat) — useEspnMatchStats
  'probableLineups3',  // compos probables — useProbableLineups
  'espnPregameOdds',   // cote pré-match ESPN
  'matchVenueInfo',    // stade/ville/arbitre
  'h2h-fd',            // confrontations directes
  'aflFixtureInfo', 'aflLineups', 'aflStats', 'aflMatchStats', // api-football (désactivé, voir CLAUDE.md, mais même principe si jamais réactivé)
])

// ⚠️ BUG TROUVÉ DE NOUVEAU (constat utilisateur : "j'ai pas autant de stats
// que les autres matchs" sur la finale CM, alors que fermer/rouvrir l'app
// avait déjà été fait — donc pas un problème de bundle JS/SW, voir
// l'explication complète juste au-dessus). Deux correctifs coup sur coup
// (buteurs/cartons vides + fusion FIFA/ESPN des stats) ont changé la forme
// de ce que renvoient useEspnMatchDetail et useEspnMatchStats, MAIS le buster
// n'avait pas été bumpé pour ces deux commits précis — le résultat incomplet
// déjà persisté (jusqu'à 24h, voir gcTime) pour un match aussi consulté que
// la finale continuait donc d'être resservi tel quel, masquant totalement le
// fix côté serveur malgré un vrai reload complet de l'app. Toujours
// incrémenter ce buster à chaque correctif qui touche la logique/forme d'une
// requête déjà en cache — pas juste "des fois", à chaque fois.
// v9 : correctif du plafond de nouvelles tentatives côté client (constat
// utilisateur : "ça disparaît au bout de 5min alors que c'est censé être en
// cache permanent") — useEspnMatchDetail.js et useMatchDetail.js
// abandonnaient DÉFINITIVEMENT après 10 tentatives × 30s (5min) si les
// compos/stats/déroulement n'étaient pas encore dispo, ce qui pouvait
// arriver sur un match à très fort trafic (la finale CM). Pire : cet état
// "abandonné, vide" était lui-même persisté dans le cache localStorage — un
// simple rechargement ne redonnait pas une vraie nouvelle chance. Plafond
// remonté à 1h. Ce bump vide tout état "abandonné" déjà persisté côté
// client suite à ce bug, pour repartir sur un plafond propre.
// v11 : les grosses requêtes par match (compos/stats/déroulement, voir
// UNPERSISTED_QUERY_KEYS ci-dessus) ne sont plus persistées en localStorage
// du tout — élimine la cause racine du quota dépassé (v10 ne faisait que
// gérer le symptôme). Bump pour repartir sur un blob propre.
const CACHE_BUSTER = 'v11-2026-07-20-unpersist-large-match-queries'

createRoot(document.getElementById('root')).render(
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{
      persister,
      buster: CACHE_BUSTER,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
          if (UNPERSISTED_QUERY_KEYS.has(query.queryKey[0])) return false
          return defaultShouldDehydrateQuery(query)
        },
      },
    }}
  >
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </PersistQueryClientProvider>
)
