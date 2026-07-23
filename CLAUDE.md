# StatFootix — PWA Football

React + Vite + Vercel. Déployé sur `https://statfootix.vercel.app`.

## Stack
- **Frontend** : React 18, Vite, React Router, React Query, vite-plugin-pwa (Workbox)
- **APIs** : ESPN (primaire, live), football-data.org (matchs/classements). api-football (compos) **désactivé définitivement** (`PERMANENTLY_DISABLED` dans `api/apifootball.js` — compte suspendu à répétition, ESPN/FD.org couvrent déjà l'essentiel en fallback). xG retiré (`api/fifa-live.js`) : jamais présent en pratique dans le boxscore ESPN, aucune intégration FotMob n'a jamais existé malgré une ancienne mention ici
- **Backend Vercel** : `/api/*` serverless functions (11/12 — limite dure Hobby, tout nouvel endpoint doit être fusionné dans un fichier existant, sauf s'il reste un slot libre)
- **Push notifs** : Web Push VAPID via `web-push`, subscriptions dans Upstash Redis (KV)
- **Temps quasi réel** : Ably (pub/sub) — `api/fifa-live.js` publie sur `live-{matchId}` quand un poll détecte un vrai changement ; `useLiveMinute.js` s'abonne et relance son propre poll en réveil (complément du poll, ne le remplace pas)
- **Fast-path cache partagé** (`api/fifa-live.js`) : marqueur `fm:fresh:{id}` (TTL 12s) posé à chaque calcul réel (fetch ESPN/FIFA + matching). Si TOUS les matchs demandés par un client ont ce marqueur encore valide (posé par un AUTRE utilisateur entre-temps), le calcul complet est sauté et le dernier résultat Redis renvoyé directement — le coût CPU par utilisateur baisse quand il y a plus de spectateurs simultanés sur les mêmes matchs, au lieu d'augmenter
- **Cron (polling ESPN + notifs)** : Worker Cloudflare (`cf-worker/`, gratuit, Cron Trigger `* * * * *`) — fait le fetch ESPN + la détection (but/carton/KO/mi-temps/fin) chaque minute, coût CPU quasi nul (le réseau ne compte pas dans le budget CPU Cloudflare). N'appelle `/api/cron-goals` (mode `notify`, voir plus bas) QUE quand un vrai événement est détecté — Vercel ne fait plus que l'envoi push (VAPID + chiffrement par abonné), quelques dizaines de fois/jour de match au lieu de 1440x/jour inconditionnellement. Ancien schéma (cron-job.org → tout sur Vercel 1x/min 24/7) conservé intact en fallback manuel dans le même fichier — voir `cf-worker/README.md` pour le contexte complet et la procédure de déploiement/rollback.
- **Robustesse** : `ErrorBoundary` (`src/components/ErrorBoundary.jsx`) autour de chaque route dans `App.jsx` (keyée par pathname) + une autour de tout le shell — un bug de rendu imprévu dans une page ne fait plus planter toute l'app (navbar comprise), contient les dégâts à la page concernée. Tests unitaires (`vitest`) sur la logique la plus fragile : `src/utils/liveDetection.test.js` (détection ESPN/FIFA, buteurs/cartons, recap — logique partagée entre `api/cron-goals.js` et `cf-worker/`) et `src/utils/calcProno.test.js` (modèle de pronostic).

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
    ErrorBoundary.jsx — filet de sécurité anti-écran-noir, utilisé dans App.jsx
  pages/
    LiveMatchPage.jsx  — page dédiée /live/:matchId
    LiveMatchPage.css
  hooks/
    useLiveMinute.js   — watchdog ESPN (pas de notify, sons retirés)
    useSwipe.js        — swipe tactile
    usePushNotifications.js
    useStandings.js
    useTeamForm.js
    liveTracker.js
    useOnline.js
  context/
    LiveProvider.jsx
  utils/
    notify.js          — fonctions notif avec translateTeam + persistance localStorage
    matchStateTracker.js
    matchUtils.js
    calcProno.js        — modèle de pronostic (voir calcProno.test.js)
    liveDetection.js    — détection ESPN/FIFA PARTAGÉE entre api/cron-goals.js et
                           cf-worker/ (voir liveDetection.test.js) — source unique,
                           ne JAMAIS redupliquer dans l'un des deux sans l'autre
  data/
    teamNames.js       — TEAM_NAMES_FR + translateTeam()
    competitions.js
  App.jsx
  live.css
  matchModal.css

api/
  cron-goals.js   — mode `notify` (appelé par cf-worker/, envoi push uniquement) + mode complet
                    historique (polling ESPN, fallback manuel si le Worker Cloudflare est en panne)
  subscribe.js    — stocke subscriptions dans Redis (rate limit 20/h, check Origin)
  vapid-key.js    — expose la clé VAPID publique (+ token Ably via ?ably=1)
  debug-push.js   — diagnostic : nb subs Redis, VAPID ok (protégé par CRON_SECRET)
  espn.js         — proxy ESPN (scoreboard/summary/recap), rate limit 60/min/IP
  fifa-live.js    — live WC+club (FIFA+ESPN), fast-path cache partagé (voir Stack)
  fifa-lineups.js — compos/stats FIFA (WC), rate limit 30/min/IP (amplification)
  football.js     — proxy football-data.org, budget global 7/min + spacing
  apifootball.js  — PERMANENTLY_DISABLED (voir Stack)
  pulse.js        — (fusion pulse+curve) prono/courbe post-match
  news.js         — agrégateur RSS, cache Redis 5min
  (11/12 — 1 slot libre depuis la suppression de [...path].js, voir "Problèmes connus")

public/
  sw-push.js      — service worker push handler (vanilla JS, importé par Workbox)

cf-worker/
  src/index.js    — Worker Cloudflare : polling ESPN + détection, appelle /api/cron-goals
                    (mode notify) uniquement quand il y a vraiment un événement à notifier
  wrangler.toml   — Cron Trigger toutes les minutes
  README.md       — procédure de déploiement/vérification/rollback
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
  (`espnTimerWorker.js`), fast-path cache partagé dans `api/fifa-live.js` (voir ci-dessus) —
  et surtout, root fix : le polling ESPN 1x/min 24/7 est sorti de Vercel vers un Worker
  Cloudflare gratuit (`cf-worker/`, voir Stack) qui n'appelle Vercel que pour l'envoi push,
  quand il y a vraiment quelque chose à notifier — règle le problème structurellement avant
  la reprise de tous les championnats fin août, pas juste un pansement temporaire
- ✅ Compte football-data.org suspendu à répétition (dernier cas 22/07) : plusieurs causes
  cumulées trouvées et corrigées au fil des incidents — proxy dev Vite `/api` → FD.org direct
  et sans protection (supprimé, voir `vite.config.js`), faille de rafale à la frontière de
  minute dans le budget serveur (corrigée, `api/football.js`), circuit breaker qui ne réagissait
  qu'aux 429 et pas aux 403 (corrigé) — et surtout `api/[...path].js` : un catch-all Vercel
  `/api/v4/**` qui relayait N'IMPORTE QUELLE requête externe (curl, bot, scanner) vers
  football-data.org avec la vraie clé API, SANS authentification, avec son propre budget
  totalement indépendant de celui d'`api/football.js` — donc invisible pour le garde-fou
  principal. Confirmé mort côté front (audit `fdFetch.js` : tout passe déjà par
  `/api/football?apiPath=...`) et supprimé (22/07). S'il y a une nouvelle suspension malgré
  ça, le compte football-data.org lui-même (page "usage"/"limits" sur leur site) reste la
  source la plus fiable pour voir QUELLE requête a déclenché le blocage.
- ✅ Nouvelle suspension FD.org malgré MINUTE_CAP=5 déjà en place (23/07, après recréation
  d'une nouvelle clé/compte) : audit du garde-fou (`api/football.js`) a trouvé un vrai trou —
  quand le budget/circuit breaker bloquait une requête mais qu'AUCUNE copie stale n'existait
  encore pour cette clé précise (typiquement une compétition/endpoint jamais interrogé avant,
  ex. le mini-classement ajouté sur l'Accueil), le code contournait silencieusement tout le
  garde-fou et faisait quand même l'appel réel ("faute de mieux") — MINUTE_CAP n'était donc un
  plafond dur QUE pour les clés déjà vues au moins une fois, jamais pour une requête inédite.
  Corrigé : ce cas renvoie maintenant un vrai 429 (déjà géré côté client partout, message
  "Veuillez patienter quelques instants") au lieu de taper FD.org sans limite. Honnêteté : je
  ne peux pas confirmer avec certitude que c'est CE trou précis qui a causé CETTE suspension
  (pas d'accès aux logs FD.org/Vercel depuis cet environnement) — mais c'est un vrai bug de
  contournement de rate-limit, corrigé indépendamment de la cause exacte.
- ❌ TheSportsDB essayé puis RETIRÉ comme repli classement, même jour (23/07) : ajouté comme 3e
  source (après FD.org puis ESPN) suite à une nouvelle suspension FD.org, mais la clé publique
  gratuite (`3`) plafonne `lookuptable.php` à **5 lignes seulement**, quelle que soit la ligue —
  confirmé par plusieurs appels réels indépendants (Premier League, French Ligue 1, toujours
  exactement 5 équipes). Erreur de vérification initiale : le premier test n'avait comparé que
  le TOP 5 (positions/points corrects) sans jamais vérifier la longueur totale de la liste,
  donc n'avait pas détecté qu'il manquait le reste du classement (zone de relégation comprise).
  Un classement à 5 lignes étant trompeur (pire qu'aucun classement), tout le code a été retiré
  plutôt que corrigé : `COMPETITION_SPORTSDB_LEAGUE`, mode `sportsdbLeague` (`api/espn.js`),
  `compactSportsDbStandings`. `useStandings.js` est revenu à FD.org → ESPN → cache stale. Aucune
  alternative gratuite connue ne couvre non plus les BUTEURS (endpoint `lookuptopscorers.php` de
  TheSportsDB testé vide sur la clé gratuite ; ESPN n'a jamais eu d'endpoint scorers fonctionnel
  non plus) — ce gap reste ouvert, aucun repli disponible pour `useScorers.js` en cas de panne
  FD.org.
- ✅ Piste concrète trouvée pour "suspension FD.org dès que j'ouvre sur mon ordi, jamais sur mon
  tel" (constat utilisateur, 23/07) : le mini-classement sous "Résultats récents" (desktop
  uniquement, `showResultClassement` dans `Accueil.jsx`) appelait `useStandings` → FD.org en
  PLUS des appels déjà communs aux deux versions — un appel FD.org qui n'existait tout
  simplement pas côté mobile. Seule vraie différence de trafic FD.org identifiée entre desktop
  et mobile (le reste — matchs à venir, résultats — est strictement identique). Retiré
  entièrement (widget décoratif secondaire, pas core) plutôt que rattaché à une source
  alternative. Honnêteté : pas de certitude à 100% que c'était LA cause (FD.org ne documente pas
  son vrai seuil de suspension), mais la piste la plus concrète et vérifiable trouvée à ce jour —
  un vrai appel en moins pour un coût fonctionnel minime.
- ✅ `MINUTE_CAP` remonté 5→8/min le 23/07 (demande explicite utilisateur, après mise en garde),
  puis **rollback à 5/min le jour même** : rafale de 403 constatée (screenshot Network navigateur)
  quelques heures après le passage à 8/min — reproduction quasi immédiate du même symptôme que
  l'incident du 20/07 (403 en rafale, circuit breaker `DOWN_TTL_FORBIDDEN` déclenché, résultats/
  classements vides sur l'Accueil). Repli appliqué conformément au plan déjà acté au moment du
  passage à 8/min. Espacement (12s à 5/min) toujours dérivé automatiquement du plafond
  (`SPACING_MS = 60000 / MINUTE_CAP`), aucune rafale possible par construction. Honnêteté :
  coïncidence temporelle forte (suspension le jour même du changement) mais pas de preuve
  formelle (pas d'accès aux logs FD.org depuis cet environnement) — le compte a déjà été
  suspendu par le passé à 5/min sans cause certaine identifiée non plus. Si le 403 persiste
  malgré le retour à 5/min, la cause est probablement ailleurs (voir les pistes déjà explorées
  plus haut : compte lui-même, page "usage"/"limits" FD.org).
- ⚠️ "from StatFootix" dans notifs : comportement Chrome non modifiable
- 🔍 Notifs app fermée : architecture VAPID ok, à vérifier via /api/debug-push?secret=...
- 🔍 Erreur 401 sur /cron-goals : CRON_SECRET absent ou mauvais dans cron-job.org

## Conventions
- Noms français partout dans l'UI
- `translateTeam(name)` pour tout nom d'équipe affiché
- Pas de `sofascore` dans les noms de hooks/variables (remplacé par apifootball)
- CSS variables : `--bg`, `--fg`, couleurs rouges `#ef4444`
