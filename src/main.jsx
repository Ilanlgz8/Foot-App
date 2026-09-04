
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { checkAppVersion } from './utils/appUpdate'

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

// ⚠️ AJOUT (04/09, utilisateur : "pourquoi sur mon tel en PWA je vois encore
// comme avant ?") : tout ce qui précède dépend du navigateur qui redécouvre un
// nouveau /sw.js. Ça n'a pas suffi une seule fois de la session — il a fallu
// purger le service worker à la main après chaque déploiement. Cette
// vérification-ci ne dépend d'aucun mécanisme de service worker : elle compare
// le bundle qui tourne à celui que le serveur sert. Voir appUpdate.js.
const runningAsset = import.meta.url
const runVersionCheck = () => {
  if (document.visibilityState === 'visible') checkAppVersion(runningAsset)
}
document.addEventListener('visibilitychange', runVersionCheck)
window.addEventListener('focus', runVersionCheck)
// Au démarrage, mais pas avant que React ait eu le temps de monter : recharger
// pendant le tout premier rendu donnerait un écran qui clignote.
setTimeout(runVersionCheck, 4000)
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { removeOldestQuery } from '@tanstack/query-persist-client-core'
import { purgeExpiredCache } from './hooks/localCache'

// ⚠️ AJOUT (question utilisateur : "on aura assez de place pour garder tout
// ce qu'on met en cache ?") : le cache disque par match (lineups_*/stats_*,
// voir useMatchDetail.js) n'a, contrairement au blob React Query ci-dessous,
// aucun nettoyage automatique — une entrée expirée n'est supprimée que si on
// la relit précisément après coup. Purge une fois au lancement, coût
// négligeable (scan local, pas de réseau), borne la croissance à la fenêtre
// de TTL réellement active plutôt qu'à tout l'historique jamais consulté.
purgeExpiredCache()

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
// v12 : useScorers.js (constat utilisateur : "aucun buteur disponible" sur
// La Liga/Serie A alors que football-data.org a bien de vraies données,
// confirmé par appel réel direct sur l'API déployée) — un échec transitoire
// (timeout backend FD.org, reproduit plusieurs fois précisément sur ces 2
// compétitions à limit=500) n'était pas distingué d'un vrai "0 buteur" et
// pouvait être persisté tel quel jusqu'à 24h (NO_MATCH_STALE_MS). Corrigé
// côté hook (tryFetch lève désormais sur tout échec, repli limit=100 avant
// d'abandonner) — ce bump vide tout résultat "[]" déjà persisté pour ce
// query key précis suite à ce bug, pour repartir sur un vrai fetch propre.
// v13 : 2e bug useScorers.js trouvé le même jour (constat utilisateur :
// "aucun buteur" sur La Liga/Serie A malgré le fix v12) — le catch englobant
// avalait un 429 (budget FD.org partagé) sans jamais le relancer, écrivant un
// faux [] au lieu d'afficher "Veuillez patienter quelques instants" comme le
// fait déjà useStandings.js. Corrigé (`throw err` en dernier recours, aligné
// sur useStandings.js). Bump pour vider tout faux [] déjà écrit sous ce
// mécanisme avant le fix.
const CACHE_BUSTER = 'v13-2026-08-28-fix-scorers-429-swallowed'

// ══════════════════════════════════════════════════════════════════════
// FILET ANTI-ÉCRAN BLANC (02/09, constat utilisateur : "pourquoi j'ai un
// écran blanc quand je lance l'app ?", toujours présent après réinstallation
// de la PWA — donc sans rapport avec le cache du service worker).
//
// L'ErrorBoundary (App.jsx) ne couvre QUE les erreurs de rendu d'une app déjà
// montée. Si quelque chose échoue AVANT — un module qui ne charge pas, une
// donnée persistée illisible, une API non supportée par le navigateur — React
// ne monte jamais et l'écran reste vide, sans le moindre message. C'est
// exactement ce que décrit l'utilisateur, et c'est aussi ce qui m'empêchait
// de diagnostiquer à distance : aucune information ne remonte.
//
// Ce filet affiche l'erreur réelle à l'écran et propose de repartir propre.
// Le bouton vide TOUT le stockage du site (localStorage, sessionStorage,
// caches du service worker) : le cache React Query persisté et les caches par
// match survivent à une réinstallation de la PWA, ils font donc partie des
// suspects qu'une réinstallation seule n'élimine pas.
function showBootError(err) {
  const root = document.getElementById('root')
  if (!root || root.childElementCount > 0) return   // l'app tourne, rien à faire
  const msg = (err && (err.message || err.reason?.message || String(err))) || 'Erreur inconnue'
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;background:#0a0a0d;color:#fff;font-family:system-ui,sans-serif;text-align:center">
      <div style="font-size:19px;font-weight:700">StatFootix n'a pas pu démarrer</div>
      <div style="font-size:13px;color:#9aa3bb;max-width:340px;line-height:1.5">Voici l'erreur exacte, utile pour la corriger :</div>
      <code style="font-size:12px;color:#ff9aa2;background:rgba(255,255,255,.06);padding:10px 12px;border-radius:8px;max-width:340px;word-break:break-word">${String(msg).slice(0, 300)}</code>
      <button id="sfReset" style="margin-top:6px;padding:11px 18px;border-radius:22px;border:1px solid rgba(255,255,255,.2);background:#ef4444;color:#fff;font-size:14px;font-weight:700;font-family:inherit">Vider les données et relancer</button>
    </div>`
  document.getElementById('sfReset')?.addEventListener('click', async () => {
    try { localStorage.clear() } catch { /* stockage inaccessible */ }
    try { sessionStorage.clear() } catch { /* idem */ }
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
      const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
      await Promise.all(regs.map(r => r.unregister()))
    } catch { /* pas de SW/caches : rien à nettoyer */ }
    location.reload()
  })
}

// Un module qui ne charge pas remonte en `error`, une promesse rejetée au
// démarrage en `unhandledrejection` — les deux mènent au même écran vide.
window.addEventListener('error', e => showBootError(e.error ?? e))
window.addEventListener('unhandledrejection', e => showBootError(e.reason))
// Filet de dernier recours : si rien n'a levé d'erreur mais que React n'a
// toujours rien monté au bout de 8s, c'est un blocage silencieux.
setTimeout(() => showBootError(new Error('L\'application n\'a pas fini de démarrer (aucune erreur remontée).')), 8000)

try {
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
} catch (err) {
  // Échec synchrone du montage (persister illisible, API manquante...) :
  // sans ce catch, la page resterait blanche sans aucune explication.
  showBootError(err)
}
