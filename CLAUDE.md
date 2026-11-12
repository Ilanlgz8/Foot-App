# StatFootix — PWA Football

React + Vite + Vercel. Déployé sur `https://statfootix.vercel.app`.

## Stack
- **Frontend** : React 18, Vite, React Router, React Query, vite-plugin-pwa (Workbox)
- **APIs** : ESPN (primaire, live), football-data.org (matchs/classements). api-football (compos) **désactivé définitivement** (`PERMANENTLY_DISABLED` dans `api/apifootball.js` — compte suspendu à répétition, ESPN/FD.org couvrent déjà l'essentiel en fallback). xG retiré (`api/fifa-live.js`) : jamais présent en pratique dans le boxscore ESPN, aucune intégration FotMob n'a jamais existé malgré une ancienne mention ici
- **Backend Vercel** : `/api/*` serverless functions (12/12 — limite dure Hobby, plus aucun slot libre : tout nouvel endpoint doit être fusionné dans un fichier existant)
- **Push notifs** : Web Push VAPID via `web-push`, subscriptions dans Upstash Redis (KV)
- **Cache scoreboard ESPN** (`api/espn.js`, clés `espn:sb:*`) : sur Turso (SQLite distribué,
  `src/utils/tursoCache.js`) si `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` sont configurées côté
  Vercel, sinon repli automatique sur Upstash Redis — voir l'entrée du 01/10 dans Problèmes
  connus/résolus. Rate-limit, H2H, news... restent sur Redis côté Vercel.
- **État du Worker Cloudflare** (`cf-worker/src/index.js`, polling+notifs — voir plus bas) : sur
  Turso aussi (`cf-worker/src/tursoKv.js`, MÊME base Turso `statfootix` que ci-dessus, tables
  différentes) si `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` sont configurées comme SECRETS
  Cloudflare (`wrangler secret put`, voir `cf-worker/wrangler.toml`), sinon repli intégral sur
  Redis — voir l'entrée du 01/10 "Migration de l'état du Worker Cloudflare vers Turso". Couvre
  TOUT l'état de ce fichier, y compris les verrous anti-doublon but/carton/KO/FT (émulation SQL
  de l'atomicité SET NX de Redis, choix assumé par l'utilisateur après mise en garde explicite
  sur le risque — voir cette même entrée pour le détail).
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

### Assistant IA (Pronos)
- `Pronos.jsx` — switcher top-level `mode` (`pronos`/`ia`, 2 boutons tout en haut de la page, indépendant de `activeTab`) ; Assistant accessible sans rejoindre de groupe
- `AiAssistant.jsx` — chat foot uniquement (règles, historique, clubs, joueurs, tactique). **Remplace l'ancien Simulateur** (confrontation hypothétique 2 équipes, score exact simulé) — retiré le 28/08 après 2 réécritures du modèle statistique qui donnait encore trop souvent des scores plats (1-1), demande explicite utilisateur de passer à une IA plutôt que continuer à bricoler le modèle
- Backend : `api/apifootball.js` mode `ask` (POST `{mode:'ask', question}`) — fichier déjà mort en pratique (`PERMANENTLY_DISABLED`, voir Stack), slot réutilisé sans toucher son comportement GET existant (12/12 fonctions, aucun autre slot libre)
- Modèle : Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`), REST API (`api.cloudflare.com/client/v4/accounts/{id}/ai/run/...`), même compte Cloudflare que `cf-worker/`. Gratuit jusqu'à 10 000 neurones/jour (~15-25 réponses) — **aucun fallback payant** au-delà, erreur claire côté client une fois le quota atteint (cohérent avec le reste de l'app, 100% APIs gratuites)
- Rate limit Redis : cap global 15/jour + cap 3/jour/IP (`ai:ask:day:*` dans Upstash), reset 00:00 UTC
- System prompt scope strictement le foot et interdit explicitement d'inventer un score/classement — le modèle n'a AUCUN accès aux données live de l'app (rappelé aussi dans l'UI, `AI_NOTE`)
- `api/h2h.js` + `src/data/fdcoukTeamNames.js` — H2H multi-années (jusqu'à 6 saisons), football-data.co.uk (site distinct de football-data.org, CSV statiques sans clé API), utilisé par l'onglet H2H réel d'un match (`useH2HRows`, `MatchModal.jsx`, opt-in `extendedH2H`). Limite honnête : fichiers PAR championnat national, aucune confrontation européenne (ex. PSG-Bayern) n'y figure jamais

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
  apifootball.js  — PERMANENTLY_DISABLED pour les compos (voir Stack) + mode
                    `ask` fusionné (Assistant IA foot, Cloudflare Workers AI,
                    voir Architecture clé > Assistant IA)
  pulse.js        — (fusion pulse+curve) prono/courbe post-match
  news.js         — agrégateur RSS, cache Redis 5min
  h2h.js          — H2H multi-années même championnat (football-data.co.uk,
                    CSV statiques sans clé, voir Architecture clé > Assistant IA)
  (12/12 — dernier slot libre utilisé, plus aucune marge : tout nouvel
  endpoint doit être fusionné dans un fichier existant)

public/
  sw-push.js      — service worker push handler (vanilla JS, importé par Workbox)

cf-worker/
  src/index.js    — Worker Cloudflare : polling ESPN + détection, appelle /api/cron-goals
                    (mode notify) uniquement quand il y a vraiment un événement à notifier
  src/tursoKv.js  — adaptateur Turso (01/10) réimplémentant le sous-ensemble @upstash/redis
                    utilisé par index.js (get/set/mget/del/sadd/srem/scard/rpush/lpop/ltrim/
                    pipeline, y compris l'émulation SET NX pour les verrous anti-doublon) —
                    utilisé si TURSO_DATABASE_URL/TURSO_AUTH_TOKEN sont configurées comme
                    secrets Cloudflare, sinon repli intégral sur Redis (voir wrangler.toml)
  wrangler.toml   — Cron Trigger toutes les minutes + liste des secrets (dont Turso, optionnel)
  README.md       — procédure de déploiement/vérification/rollback
```

## Env vars Vercel (toutes configurées)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `CRON_SECRET` — header `x-cron-secret` requis pour `/cron-goals` et `/debug-push`
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — Upstash Redis
- `FOOTBALL_DATA_API_KEY` — football-data.org
- `API_FOOTBALL_KEY` — api-football (clé toujours présente mais inutilisée, voir `PERMANENTLY_DISABLED`)
- `ABLY_API_KEY` — pub/sub temps quasi réel (token borné généré via `/api/vapid-key?ably=1`)
- `CF_ACCOUNT_ID`, `CF_AI_API_TOKEN` — Cloudflare Workers AI (Assistant IA, `api/apifootball.js` mode `ask`). Même compte Cloudflare que `cf-worker/` : ID de compte visible dans le dashboard Cloudflare (barre latérale droite) ; token créé dans dashboard Cloudflare → "Manage Account" → "Account API Tokens" → "Create Token" → template "Workers AI" (ou permission personnalisée "Account.Workers AI: Read/Edit")
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — base Turso `statfootix` (AWS EU West Ireland), configurées côté Vercel ET comme secrets Cloudflare (`wrangler secret put`). Côté Vercel : cache scoreboard ESPN (`espn_cache`) et lecture des publications du Worker (`worker_kv`, `workerKvGet`). Côté Worker : tout son état (`worker_kv`/`worker_set`/`worker_queue`). Le reste (rate-limit, H2H, news, pronos, abonnements push) reste sur Upstash Redis. Jeton : dashboard Turso → base → « Create Token » (affiché une seule fois).

## État actuel (10/11) — à lire avant toute modification
Historique complet de chaque problème/correction : `docs/HISTORIQUE.md` (déplacé d'ici le 10/11).

### Principe : le serveur décide, l'app affiche
- **Worker Cloudflare** (`cf-worker/`, plan GRATUIT obligatoire — refus de payer : ≤ 10 ms CPU visés, ≤ 50 sous-requêtes/passe, 1 passe/min). Interroge ESPN via `/api/espn` (ESPN bloque Cloudflare), détecte buts/cartons/fins, envoie les notifs via `/api/cron-goals?mode=notify`.
- **`pub:all`** (Turso `worker_kv`, écrit au plus 1×/passe si l'empreinte change ou > 2 min) : `live.events` (état officiel par événement ESPN, `final` = fin confirmée) + `feed` (matchs d'aujourd'hui/hier par compétition, champs réduits). Lu par `api/fifa-live.js` (`serverState` joint à chaque réponse) et `api/espn.js?feed=1` (Accueil).
- **App** : `serverStateVerdict` (utils/serverLiveState.js) — un match suivi par le serveur n'utilise plus les garde-fous locaux (`isServerManaged` dans useLiveMinute.js) ; fin locale seulement si le serveur ne répond plus 10 min. L'ancienne logique locale reste pour les matchs non suivis par le serveur.
- **Accueil, matchs du jour** : `fetchEspnPortionFromFeed` (1 requête) si le flux est frais, sinon ancienne méthode (~20 calendriers).

### Rythme des appels (économie validée par mesures)
- Worker, couple compétition+date « au repos » (que des matchs à > 3 h ou finis depuis > 3 h) : revérifié 2 min sur 30 ; à < 3 h d'un coup d'envoi : toutes les 2 min (parité) ; en direct : chaque minute. Préchauffage FD (`warmFdCache`) : toutes les 30 min s'il n'y a rien en direct, sinon toutes les 4 min.
- Worker, classement + buteurs (`warm:plan`, `warmLiveCompetitions`) : pendant les matchs d'un championnat FL1/PL/PD/BL1/SA/CL → classement toutes les 4 min, buteurs toutes les 8 min ; 1 h après le dernier passage en direct → une mise à jour finale. TTL serveur (`api/football.js`) : classement 5 min, buteurs 10 min.
- App : matchs du jour toutes les 2 min si un match est en direct / commence dans < 3 h / a commencé il y a < 3 h ; sinon 30 min. Page Classement ouverte pendant un match de la compétition : classement 5 min, buteurs 10 min.
- Mesures (10/11) : Worker ~15-16 ms CPU médian (avant 30), 0 erreur ; Vercel ~5 min CPU/jour (avant 12-16), limite Hobby 4 h / 30 jours glissants (au-delà : projet mis en pause).

### Stockage côté app
- `localCache.js` : moteur IndexedDB (`statfootix-store`) + copie mémoire, chargé avant le 1er rendu. Copies de secours `matches_espn_*` et liste « à venir » gardées 24 h (`KEEP_STALE_FOR`).
- Cache React Query : IndexedDB (`statfootix-rq`, `utils/rqIdbStorage.js`, persisteur asynchrone).
- `storageGuard.js` (1er import de main.jsx) : libère de la place si localStorage est plein (quota iOS ~5 Mo).
- Client Turso du Worker : `cf-worker/src/tursoHttp.js` (HTTP pipeline v2, requêtes simultanées regroupées), validé par `cf-worker/scripts/test-turso-http.mjs`.

### Règles métier à respecter
- **Forme récente par compétition** : championnat sous `formMap[id]`, coupe nationale sous `formMap['cup:'+id]` → toujours lire via `formKey(match, id)` (useTeamForm.js). Classement : forme sur le seul championnat (`leagueFormMap`, StandingsTable).
- **Ids** : ESPN et football-data.org ont des ids différents qui peuvent coïncider → toujours résoudre via `resolveFdTeamId(..., { strict: true })` sur des matchs football-data.org avant de lire une table rangée par id FD (bugs « forme d'un autre club »).
- Classement FD en retard sur les matchs : `catchUpStandings` (standingsLive.js).
- Tirs au but : score 120 min + `penalties` séparés (ESPN `shootoutScore`) ; un match TERMINÉ dans la liste garde son score, jamais `mergeScore` (gonflé par les tab).
- Mi-temps : `halftimeLabel` (utils/halftimeCountdown.js) partagé par les cards. Après la 120e, jamais « Prolongation » (`overrunLabel`).
- Pronos : écrits d'abord en local (`pronos_my_preds`), renvoyés jusqu'à confirmation (usePronosGroup.js).
- Heures des matchs : police Lexend 700 (index.css, bloc « HEURES ») ; scores : Inter 900.

### Temporaire (à retirer quand tout est stable)
- `LiveDiag.jsx` (5 taps sur « En direct ») + `utils/reloadTrace.js` (journal des relances) + diagnostics `window.__sfAllComps` / `__sfEspnWin`.
- Journal de l'ancienne logique du direct (`noteLegacyFt` → `sf_legacy_ft`, useLiveMinute.js, affiché dans LiveDiag) : chaque fin de match décidée par le TÉLÉPHONE (garde-fous 1-4, double confirmation locale, repli 10 min). S'il reste vide pendant une semaine de matchs, désactiver ces chemins (code gardé) — étape prévue après validation.

### Déploiement
- App : push sur `main` → Vercel. Dire à l'utilisateur de recharger l'app 2 fois.
- Worker : l'utilisateur lance lui-même `cd cf-worker && npm run deploy` ; retour arrière `npx wrangler rollback`.
- Observability Cloudflare activée (gratuit) : CPU réel par passe.

- **Ligue 3 (12/11)** : source = API publique FFF (`api-dofa.fff.fr`, sans clé ; ESPN/FD ne l'ont pas). `src/utils/ligue3Parse.js` (serveur, mode `/espn?l3=1`, cache CDN 15 min) + `src/utils/ligue3.js` (client). Visible SEULEMENT dans Programme/Résultats/Classement via `PAGE_COMPETITIONS` (competitions.js) — jamais dans `COMPETITIONS` (Accueil, Tous les matchs, direct, notifs, Worker), car la FFF publie le score ~2 h après le match (pas de direct). Pas de buteurs, pas de page détail (`_noDetail`). ⚠️ `L3_CP_NO` change chaque saison (à mettre à jour en août).

## Conventions
- Noms français partout dans l'UI
- `translateTeam(name)` pour tout nom d'équipe affiché
- Pas de `sofascore` dans les noms de hooks/variables (remplacé par apifootball)
- CSS variables : `--bg`, `--fg`, couleurs rouges `#ef4444`
- Coupe de France (12/11, vérifié) : ESPN publie le calendrier des tours régionaux (7e tour) mais jamais leurs scores (matchs restés `pre`) ; scores à partir des 32es de finale (décembre), comme la saison dernière. Résultats affiche une note dans la vue coupe vide. Copa del Rey : scores bien publiés dès le 1er tour.
- « Tous les matchs » (Live.jsx) : sans aucun match aujourd'hui, saut automatique au prochain jour de matchs (comme quand tous les matchs du jour sont finis), sauf si l'utilisateur a choisi un jour.
