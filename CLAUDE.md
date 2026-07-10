# StatFootix — PWA Football

React + Vite + Vercel. Déployé sur `https://statfootix.vercel.app`.

## Stack
- **Frontend** : React 18, Vite, React Router, React Query, vite-plugin-pwa (Workbox)
- **APIs** : ESPN (primaire, live), football-data.org (matchs/classements). api-football (compos) **désactivé définitivement** (`PERMANENTLY_DISABLED` dans `api/apifootball.js` — compte suspendu à répétition, ESPN/FD.org couvrent déjà l'essentiel en fallback), FotMob (xG)
- **Backend Vercel** : `/api/*` serverless functions (12/12 — limite dure Hobby, tout nouvel endpoint doit être fusionné dans un fichier existant)
- **Push notifs** : Web Push VAPID via `web-push`, subscriptions dans Upstash Redis (KV)
- **Temps quasi réel** : Ably (pub/sub) — `api/fifa-live.js` publie sur `live-{matchId}` quand un poll détecte un vrai changement ; `useLiveMinute.js` s'abonne et relance son propre poll en réveil (complément du poll, ne le remplace pas)
- **Fast-path cache partagé** (`api/fifa-live.js`) : marqueur `fm:fresh:{id}` (TTL 12s) posé à chaque calcul réel (fetch ESPN/FIFA + matching). Si TOUS les matchs demandés par un client ont ce marqueur encore valide (posé par un AUTRE utilisateur entre-temps), le calcul complet est sauté et le dernier résultat Redis renvoyé directement — le coût CPU par utilisateur baisse quand il y a plus de spectateurs simultanés sur les mêmes matchs, au lieu d'augmenter
- **Cron externe** : cron-job.org → `POST /cron-goals` toutes les minutes avec header `x-cron-secret`

## Architecture clé

### Live
- `LiveProvider` (context) — polling ESPN global, survit aux changements de route
- `useLiveMinute.js` — watchdog ESPN, met à jour le state (sons retirés)
- `liveTracker.js` — source de vérité des matchs live (localStorage)
- `matchStateTracker.js` — state machine par match (kickoffAt, pausedAt, ft…)
- Route `/live` → `Live.jsx` (grille de cards) → clic → `/live/:matchId` → `LiveMatchPage.jsx`

### Notifications
- **Source unique** : cron `/api/cron-goals` envoie VAPID push à tous les abonnés Redis
- `useLiveMinute.js` N'APPELLE PLUS les fonctions notify (supprimé pour éviter doublons)
- `notify.js` garde les fonctions comme fallback mais n'est plus appelé en live
- `usePushNotifications.js` — hook d'abonnement, auto-subscribe au 1er lancement, re-sync Redis toutes les 5 min
- `NotificationBell.jsx` — dans la navbar, utilise `usePushNotifications`
- `public/sw-push.js` — handler `push` event dans le service worker (importé via `importScripts`)

### Modal / Onglets
- `MatchModal.jsx` — modal pré-match avec onglets (Stats/Compos/Classement/Prono)
- `useSwipe.js` — swipe tactile fluide avec finger-follow, axis locking, spring-back
- `StandingsTable.jsx` — composant partagé classement (utilisé dans Classement.jsx et MatchModal)
- Swipe classement : détecte la limite de scroll horizontal avant de changer d'onglet

## Fichiers importants
```
src/
  components/
    Live.jsx          — grille des matchs live
    MatchModal.jsx    — modal pré/pendant match (exporte LiveStatsTab, ComposTab, ClassementTab, PronoSection)
    StandingsTable.jsx
    NotificationBell.jsx
    Classement.jsx
    navbar.jsx
  pages/
    LiveMatchPage.jsx  — page dédiée /live/:matchId
    LiveMatchPage.css
  hooks/
    useLiveMinute.js   — watchdog ESPN (pas de notify, sons retirés)
    useSwipe.js        — swipe tactile
    usePushNotifications.js
    useStandings.js
    useTeamForm.js
    useFotmobXG.js
    liveTracker.js
    useOnline.js
  context/
    LiveProvider.jsx
  utils/
    notify.js          — fonctions notif avec translateTeam + persistance localStorage
    matchStateTracker.js
    matchUtils.js
    calcProno.js
  data/
    teamNames.js       — TEAM_NAMES_FR + translateTeam()
    competitions.js
  App.jsx
  live.css
  matchModal.css

api/
  cron-goals.js   — cron ESPN → VAPID push (source unique des notifs)
  subscribe.js    — stocke subscriptions dans Redis (rate limit 20/h)
  vapid-key.js    — expose la clé VAPID publique
  push.js         — endpoint legacy (push manuel avec vérif ESPN)
  debug-push.js   — diagnostic : nb subs Redis, VAPID ok (protégé par CRON_SECRET)
  espn.js
  football.js
  apifootball.js

public/
  sw-push.js      — service worker push handler (vanilla JS, importé par Workbox)
```

## Env vars Vercel (toutes configurées)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `CRON_SECRET` — header `x-cron-secret` requis pour `/cron-goals` et `/debug-push`
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — Upstash Redis
- `FOOTBALL_DATA_API_KEY` — football-data.org
- `API_FOOTBALL_KEY` — api-football (clé toujours présente mais inutilisée, voir `PERMANENTLY_DISABLED`)
- `ABLY_API_KEY` — pub/sub temps quasi réel (token borné généré via `/api/vapid-key?ably=1`)

## Problèmes connus / résolus
- ✅ Doublons notifs : suppression des appels client-side dans useLiveMinute
- ✅ Noms équipes en anglais : translateTeam dans notify.js + map FR dans cron-goals.js
- ✅ Doublons au rechargement : _notified persisté en localStorage (TTL 4h)
- ✅ Re-sync subscription Redis : réduit de 4h → 5min
- ✅ Erreur 429 sur /api/football : budget global Redis (7/min + verrou d'espacement 800ms, tous
  utilisateurs confondus) + copie stale servie en secours dans `api/football.js` — le blocage
  synchrone côté client (`fdFetch.js`) qui causait le "tunnel" ressenti a été supprimé
- ✅ Comptes api-football suspendus à répétition (8 fois) : désactivé définitivement
  (`PERMANENTLY_DISABLED` dans `api/apifootball.js`), ESPN + football-data.org couvrent déjà
  l'essentiel des compos/stats en fallback
- ✅ Fluid Active CPU dépassé (4h/mois Hobby, mail Vercel 08/07) : poll client 10s→30s
  (`espnTimerWorker.js`), `cron-goals.js` rebridé à 1 passe/min (`BUDGET_MS=0`), fast-path
  cache partagé dans `api/fifa-live.js` (voir ci-dessus) pour anticiper la reprise des
  championnats club (plus de compétitions + spectateurs simultanés)
- ⚠️ "from StatFootix" dans notifs : comportement Chrome non modifiable
- 🔍 Notifs app fermée : architecture VAPID ok, à vérifier via /api/debug-push?secret=...
- 🔍 Erreur 401 sur /cron-goals : CRON_SECRET absent ou mauvais dans cron-job.org

## Conventions
- Noms français partout dans l'UI
- `translateTeam(name)` pour tout nom d'équipe affiché
- Pas de `sofascore` dans les noms de hooks/variables (remplacé par apifootball)
- CSS variables : `--bg`, `--fg`, couleurs rouges `#ef4444`
