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
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — **PAS ENCORE AJOUTÉES côté Vercel
  au moment de l'implémentation (01/10)**, voir l'entrée du 01/10 "Migration du
  cache scoreboard ESPN vers Turso" dans Problèmes connus/résolus. Turso =
  base SQLite distribuée (compte créé par l'utilisateur sur turso.tech, base
  `statfootix`, région AWS EU West Ireland), utilisée pour le cache scoreboard
  ESPN (`espn:sb:*`, `api/espn.js`) ET, si les MÊMES 2 valeurs sont en plus
  configurées comme secrets CLOUDFLARE (`wrangler secret put`, voir
  `cf-worker/wrangler.toml`), pour l'état du Worker Cloudflare (`cf-worker/
  src/tursoKv.js` — voir l'entrée du 01/10 "Migration de l'état du Worker
  Cloudflare vers Turso") — tout le reste (rate-limit, H2H, news côté Vercel)
  reste sur Upstash Redis. Tant que ces 2 variables sont
  absentes côté Vercel, `isTursoConfigured()` (`src/utils/tursoCache.js`) renvoie `false`
  et le code retombe intégralement sur l'ancien chemin Redis, inchangé —
  aucune régression si elles ne sont jamais ajoutées, juste pas de gain.
  `TURSO_DATABASE_URL` : URL `libsql://...` visible dans le dashboard Turso,
  page de la base → bouton "Connect". `TURSO_AUTH_TOKEN` : généré depuis ce
  même panneau ("Create Token") — ⚠️ valeur secrète, à copier UNE SEULE FOIS
  à la création (Turso ne la réaffiche jamais ensuite ; en créer une nouvelle
  si perdue).

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
- 🔍 Suite immédiate du point ci-dessus (23/07, même jour) : confirmé — le 403 persistait
  IDENTIQUE après le retour à 5/min, remonté à 8/min de nouveau (demande explicite utilisateur).
  Analyse d'un screenshot Network (fenêtre de capture ~30s) : seuls 3 vrais appels FD.org avaient
  atteint le serveur sur cette fenêtre, cohérent avec l'espacement 12s — le verrou d'espacement
  fonctionnait donc correctement, ce n'était pas une rafale non maîtrisée côté serveur. Conclusion
  la plus probable : le compte est bloqué par FD.org au niveau COMPTE, indépendamment du débit —
  même des appels bien en dessous des 10/min officiels recevaient un vrai 403. Ni 5/min ni 8/min
  n'a donc d'effet sur un blocage déjà actif ; le curseur MINUTE_CAP influence seulement le risque
  qu'un NOUVEAU blocage se déclenche une fois le compte débloqué. Bug annexe trouvé et corrigé au
  passage : `api/football.js` posait un `Cache-Control` public (même TTL qu'une réponse OK) sur
  les réponses d'erreur (403/429) faute de copie stale — le navigateur les rejouait ensuite depuis
  son disk cache, donnant une fausse impression de "spam" dans l'onglet Network alors qu'aucune
  requête réelle ne repartait. Corrigé (`no-store` sur tout ce qui n'est pas 2xx).
  Théorie utilisateur non confirmée à ce stade : rafale spécifique au lancement desktop. Le code
  vérifié (fetchTodayMatches lance bien 3 appels FD.org simultanés par jour × jusqu'à 7 jours dans
  useRecentDaysMatches) ne le supporte pas directement — le verrou d'espacement Redis sérialise
  déjà tout ça à 1 appel réel/12s (ou 7,5s à 8/min) peu importe combien sont "en attente" côté
  client, donc FD.org ne voit jamais plus qu'1 appel/fenêtre sur le fil réseau. Piste alternative
  identifiée mais pas vérifiée (nécessite un test utilisateur, pas accessible depuis cet
  environnement) : le cache React Query est persisté dans `localStorage` (voir main.jsx) — une PWA
  mobile installée reste ouverte/persistante longtemps (localStorage survit), alors qu'un onglet
  Opera desktop ouvert à chaque fois peut repartir plus souvent d'un `localStorage` vide (nettoyage
  au fermeture du navigateur, navigation privée...) → davantage de clés FD.org "jamais vues"
  (donc sans repli stale possible) à chaque lancement desktop. Non confirmé, à vérifier côté
  utilisateur (réglages Opera : effacement des données à la fermeture / fenêtre privée ?).
- ⚠️ "from StatFootix" dans notifs : comportement Chrome non modifiable
- 🔍 Notifs app fermée : architecture VAPID ok, à vérifier via /api/debug-push?secret=...
- 🔍 Erreur 401 sur /cron-goals : CRON_SECRET absent ou mauvais dans cron-job.org
- ✅ Simulateur (Pronos) toujours 1-1/scores plats malgré 2 réécritures du modèle le même jour
  (28/08) : vérifié avec de vraies données production (PL 2024-25, ex. Liverpool-Ipswich →
  λ≈1.84/0.93, donc le modèle POUVAIT diverger de 1-1 avec assez de données) — pas de bug
  mathématique trouvé dans le modèle lui-même. Demande explicite utilisateur : remplacer plutôt
  que continuer à corriger. Simulateur entièrement retiré, remplacé par un Assistant IA foot
  (voir Architecture clé > Assistant IA) — `useCrossCompH2H.js` et `PronosSimulateur.jsx`
  supprimés, exports `calcProno.js` ajoutés pour l'occasion (buildGoalModel, clampLambda,
  shrinkRatio, poissonPmf, MIN_TEAM_SPLITS, H2H_WEIGHT_*) revertis en non-exportés (plus aucun
  appelant externe).
- 🔍 Assistant IA (CF_ACCOUNT_ID/CF_AI_API_TOKEN) : env vars pas encore configurées sur Vercel
  au moment de l'implémentation (28/08) — tant qu'elles sont absentes, `handleAsk` renvoie une
  500 "pas encore configuré côté serveur" (dégradation propre, pas de crash). Voir Env vars
  Vercel ci-dessus pour la procédure de création du token.
- ✅ Commandes Upstash trop proches du plafond gratuit (500K/mois, constat utilisateur "244K en
  10 jours", 10/09) : 3 correctifs cumulés, du moins au plus risqué. (1) `FRESH_TTL` (cache
  partagé fifa-live.js) 12→18s, poll client `espnTimerWorker.js` 30→45s (3e réduction, voir son
  commentaire) — coût par spectateur simultané de `/live`. (2) Poste le plus lourd identifié :
  le pipeline Redis par match du cron (`cf-worker/src/index.js`), 6-8 commandes/match/minute
  MÊME pipelinées (Upstash facture chaque commande d'un pipeline individuellement, pas le
  pipeline comme un tout). Séparé en lectures (`cron:espn`/`goalTrack`/`cardTrack`/`finalDone`/
  `recap` regroupées en 1 seul MGET — facturé comme 1 SEULE commande quel que soit le nombre de
  clés, même principe déjà en place ailleurs dans ce fichier pour `cron:anyLive`/`cron:liveSlugs`/
  les flags `noMatch`) et écritures (`SET...NX` sur le verrou but/dédup KO/1ère confirmation FT —
  laissées INCHANGÉES, commande par commande : leur garantie d'atomicité ne survivrait pas à une
  fusion en un seul objet JSON sans script Lua, risque jugé disproportionné sur le fichier le
  plus sensible de l'app). Gain : ~6-8 → ~3-4 commandes/match/minute (match en cours), 1 seule
  pour un match déjà clos qui traîne encore dans le scoreboard ESPN (avant : le pipeline complet
  était quand même payé). Tests/lint/build vérifiés inchangés ; pas de test dédié sur le câblage
  Redis du Worker lui-même (aucune infra de test dans `cf-worker/`, seule la logique pure de
  détection est testée via `liveDetection.test.js`) — à surveiller sur le dashboard Upstash dans
  les jours suivant le déploiement plutôt que garanti à 100% a priori.
- ✅ Notifs reçues "bien après le match", ou toutes d'un coup en rouvrant le navigateur après une
  absence (constat utilisateur, 10/09) : cause la plus probable — un service de push (FCM/Mozilla/
  Apple) garde un message en attente pour un appareil injoignable (navigateur fermé) et le délivre
  d'un coup à la reconnexion. TTL d'envoi (`webpush.sendNotification`, `api/cron-goals.js`)
  raccourci 3600→1200s (20min) pour qu'un service de push abandonne plus vite. Garde-fou
  complémentaire côté CLIENT (le vrai filet de sécurité, indépendant de la cause exacte) : chaque
  payload embarque désormais `ts` (horodatage réel de l'envoi, posé dans `sendPushToMatch`, seul
  endroit qui appelle vraiment `webpush.sendNotification`) ; `public/sw-push.js` ignore
  silencieusement toute notif reçue plus de 20min après son `ts` au lieu de l'afficher hors
  contexte. Honnêteté : pas d'accès aux logs de production (`CRON_SECRET` non disponible dans cet
  environnement) pour confirmer que c'est EXACTEMENT ce mécanisme qui explique l'incident "hier en
  Ligue des Champions" mentionné par l'utilisateur — le garde-fou `ts` protège contre ce symptôme
  précis quelle qu'en soit la cause exacte, mais un futur diagnostic plus précis nécessitera
  `/api/debug-push?secret=...&match=...` (logs des dernières 24h, déjà en place).
- ✅ Côtes live "trop méchantes" en fin de match à égalité (constat utilisateur, 10/09 : "les
  côtes montent trop vite" en approchant de la fin, exemple donné non littéral "~0,20/min à
  partir de la 75e, 2 à 5/min à partir de la 90e") : vérifié numériquement sur `calcLiveProno`
  (`src/utils/calcProno.js`) — un match fictif 0-0 (favori pré-match 57%) tombait à 24% dès la
  75e et à 2% dès la 89e, l'essentiel de la chute concentré dans le dernier quart d'heure. Cause
  racine : `remaining` (fraction de temps restant) décroît linéairement avec la minute, mais son
  effet sur la probabilité Poisson "plus aucun but d'ici la fin" est exponentiel — la vitesse de
  variation du pronostic est donc structurellement plus forte en fin de match, même à rythme de
  jeu constant. Deux correctifs cumulés, tous deux dans `calcLiveProno` : (1) `remainingEased =
  remaining^0.6` (exposant < 1, uniquement pour la mise à l'échelle des λ dans la projection
  Poisson) — étale la bascule sur une plus grande partie de la 2e mi-temps, tout en préservant la
  convergence exacte vers 0 en toute fin de match (aucun changement au résultat final, seulement
  au chemin pour y arriver). (2) Bug annexe trouvé au passage : `parseMinuteValue` ne retenait
  que la base de "90+X'"/"120+X'" (le "+X" temps additionnel était ignoré) — `remaining` tombait
  donc à 0 (traité comme la fin du match) dès l'affichage de "90'", et restait FIGÉ tout le reste
  du vrai temps additionnel jusqu'au coup de sifflet, un saut brutal plutôt qu'une continuité.
  Corrigé via `endOfMatchStoppage()` + `STOPPAGE_BUFFER` (8min, choisi par raisonnement — le vrai
  total de temps additionnel n'est jamais connu à l'avance côté données dispo ici) : `remaining`
  est maintenant une fonction réellement continue de la minute affichée, du coup d'envoi jusqu'au
  vrai coup de sifflet final, sans palier au moment où l'affichage bascule sur le temps
  additionnel. Re-vérifié après les 2 correctifs combinés : même match fictif, favori à 41%
  (75e), 29% (90e pile), puis 2% seulement une fois le temps additionnel réellement écoulé
  (90+7/8) — la bascule brutale existe toujours en toute fin (statistiquement fondée), mais
  repoussée à la fin du temps additionnel plutôt qu'anticipée dès la 75e. 78 tests existants de
  `calcProno.test.js` (dont les invariants stricts sur le nul qui écrase en fin de match à
  égalité, le garde-fou anti-victoire-plus-probable-que-nul, etc.) toujours verts sans
  modification — aucune régression sur les scénarios déjà audités. Honnêteté : `0.6` et `8min`
  sont des choix raisonnés, pas backtestés sur de vrais matchs en direct (aucun backtest live
  n'existe à ce jour pour `calcLiveProno`, même limite déjà documentée pour `LIVE_LAMBDA_SHRINK`
  plus bas dans le fichier) — à ajuster si le retour utilisateur indique encore trop/pas assez de
  mouvement.
- ✅ 4 matchs Ligue des Champions démarrant à la même minute restés bloqués sur "Débute" (constat
  utilisateur, 10/09, persistant après 3 fermetures/réouvertures complètes de la PWA — donc pas un
  simple glitch réseau, un vrai bug déterministe) : root cause trouvée dans `api/fifa-live.js` —
  le matching FD.org↔ESPN (par nom d'équipe, aucun id commun entre les deux sources) se faisait un
  match à la fois, DANS L'ORDRE du tableau `matches`. Un match dont le fuzzy-match strict (les 2
  côtés) échouait (variante de nom) retombait sur un repli plus faible (1 seul côté + horaire ESPN
  à ±10min, déjà ajouté lors d'un incident précédent) — et pouvait revendiquer l'event ESPN d'un
  AUTRE match plus loin dans le tableau qui, lui, aurait matché PARFAITEMENT en strict. Ce dernier
  se retrouvait alors sans event disponible, bloqué indéfiniment (déterministe : mêmes données en
  entrée à chaque poll → même collision, ne se corrige jamais toute seule — le déblocage constaté
  n'est arrivé qu'une fois qu'un facteur externe, ex. un des matchs changeant d'état, a changé les
  candidats ESPN disponibles). Risque maximal quand PLUSIEURS matchs partagent exactement le même
  horaire (le repli ±10min devient alors peu discriminant) — le cas typique d'une journée de poule
  où tous les matchs d'un groupe démarrent à la même heure (LDC/Europa/Conference). Corrigé :
  résolution en 3 passes de confiance décroissante sur TOUS les matchs à la fois (id exact → fuzzy
  strict 2 côtés → repli 1 côté+horaire), chaque passe ne pouvant revendiquer un event que parmi
  ceux encore libres après la précédente — un match plus fiable ne peut plus se faire voler son
  event par un match moins fiable traité avant lui, quel que soit l'ordre du tableau. Vérifié
  numériquement (scénario reproduit avec 2 matchs fictifs partageant un mot dans leur nom : l'ancien
  algo laissait bien un match sans event tout en donnant à l'autre les mauvaises données, le nouvel
  algo résout les deux correctement) + suite de tests complète (356 tests) et build toujours verts.
  Honnêteté : aucun test dédié n'existe pour `api/fifa-live.js` (fichier serverless, jamais couvert
  par vitest jusqu'ici) — la vérification s'est faite par une simulation ad-hoc de l'algorithme
  exact, pas par un test permanent ajouté au dépôt.
- ✅ Logo Ligue des Champions qui met un moment à s'afficher en PWA mobile (constat utilisateur,
  10/09, "ça vient de s'afficher mais c'est quand même un bug") : `ldc.png` (`src/assets/leagues/`)
  pesait 396KB pour 900×843px — de très loin le plus gros fichier du dossier (le 2e plus gros,
  coupe-du-monde.png, fait 233KB ; la plupart des logos de championnats font 5-70KB) alors qu'il
  est affiché en petit badge partout dans l'app, jamais en grand. Sur une connexion mobile plus
  lente, ce poids explique un vrai délai visible avant que le logo apparaisse. Redimensionné à
  360×337px (largement suffisant même en Retina/3x pour tout affichage réel de l'app) → 101KB
  (-74%), qualité visuelle inchangée à l'œil (vérifié par comparaison visuelle avant/après).
- ✅ Barre du bas (`.sfTabbar`) toujours détachée du viewport après un cycle arrière-plan→scroll
  (constat utilisateur, 10/09, 3e signalement — capture d'écran à l'appui montrant la barre
  affichée EN PLEIN MILIEU de la page, entre deux cartes de match, comme un bloc normal du flux au
  lieu d'une barre fixe) — les 2 correctifs précédents (filet `unstickBody`, `App.jsx` ; couche GPU
  dédiée + nudge, `navbar.css`) n'ont pas suffi durablement. Audit complet de la chaîne de parents
  DOM de `.sfTabbar` (Navbar → LiveProvider → 2× ErrorBoundary → #root) : aucun transform/filter/
  will-change/contain permanent trouvé dans l'état actuel du code — mais ce projet a DÉJÀ eu
  exactement cette classe de bug une fois ailleurs (voir `App.css`, `.page-transition`, fix du
  05/09) : un `animation-fill-mode: both` laissait un `transform` résiduel EN PERMANENCE sur un
  conteneur, ce qui en fait le bloc conteneur de TOUS ses descendants en `position: fixed` (ils
  s'ancrent alors sur ce conteneur au lieu du viewport — exactement le symptôme "barre au milieu
  de la page"). Plutôt que traquer un transform précis une 3e fois (les 2 tentatives précédentes
  n'ont pas identifié la vraie cause avec certitude), fix structurel : la barre du bas est
  désormais rendue via un **portail React directement dans `<body>`** (`createPortal`, voir
  `src/components/navbar.jsx`) au lieu d'être un descendant de `#root` — son parent DOM réel n'est
  plus jamais affecté par un transform/filter ajouté N'IMPORTE OÙ dans l'arbre de l'app (aujourd'hui
  ou dans une future fonctionnalité), l'immunise structurellement contre toute cette classe de bug
  au lieu de patcher un cas précis. Le contexte React (routing, données live) reste inchangé — un
  portail ne déplace que l'emplacement DOM, pas la position dans l'arbre React. `z-index` inchangé
  (60) : ni `#root` ni `body` n'établissent de contexte d'empilement propre, donc la comparaison
  reste globale, aucune régression de superposition attendue. 356 tests + lint + build vérifiés
  inchangés. Honnêteté : je n'ai pas pu reproduire le bug moi-même dans cet environnement (aucun
  accès à un vrai appareil mobile/PWA) — cette 3e tentative répare la classe de bug la plus
  probable identifiée par audit de code et par précédent réel dans ce même projet, pas une
  reproduction confirmée en direct ; à valider par l'utilisateur sur son téléphone.
- ✅ Barre du bas TOUJOURS détachée malgré le passage en portail (constat utilisateur, 10/09,
  "ça le fait encore" juste après le déploiement du fix précédent) — vérifié en production
  (DevTools/JS distant) que le portail est bien actif : `.sfTabbar` est bien un enfant direct
  RÉEL de `<body>`, `position: fixed` bien appliqué. Écarte donc avec certitude toute cause liée
  à un ancêtre transformé (déjà la cible des 2 tentatives précédentes) — 3 tentatives ciblées de
  suite (verrou body, couche GPU+nudge, portail) n'ont pas trouvé la vraie cause. Changement
  d'approche : au lieu de deviner un 4e déclencheur précis, watchdog (`App.jsx`) qui vérifie
  l'état RÉEL et OBSERVABLE de la barre en continu (toutes les secondes + à chaque scroll/retour
  au premier plan) — un `position: fixed` correctement rendu colle TOUJOURS son bord bas
  exactement au bord bas du viewport visuel courant (`rect.bottom === window.innerHeight`, fiable
  quel que soit l'état de la barre d'adresse mobile) ; un écart détecté force un recalcul en
  retirant puis réappliquant `position` elle-même. Vérifié RÉELLEMENT en direct sur la prod
  (`statfootix.vercel.app`, pas juste en local) : décrochage simulé par script (position forcée à
  `static`, la barre partait bien à 1005px alors que le viewport ne fait que 837px, reproduisant
  fidèlement le symptôme signalé) → le watchdog détecte et répare en un seul cycle, la barre
  revient exactement à `bottom: 837px = window.innerHeight`. Corrige le symptôme observable quelle
  que soit sa cause exacte (jamais identifiée avec certitude malgré 3 audits), au lieu de parier
  sur un nouveau déclencheur. 356 tests + lint + build inchangés. Honnêteté : le test ci-dessus
  vérifie que le MÉCANISME DE RÉPARATION fonctionne (simulation fidèle du symptôme rapporté), pas
  qu'il se déclenchera au bon moment sur un vrai décrochage spontané en conditions réelles — à
  confirmer par l'utilisateur sur son téléphone.
- ✅ Barre du bas ENCORE détachée malgré le watchdog, confirmé identique sur "iphone pwa" (constat
  utilisateur, 10/09, "nn toujours pas bg .." puis confirmation explicite "iphone pwa et c comme
  avant les symptome" — donc bien le même symptôme, pas un nouveau, sur un vrai appareil réel).
  Cette confirmation a permis de trouver un vrai trou logique dans le watchdog de la tentative
  précédente plutôt que de deviner une 5e cause : il réparait sur CHAQUE `scroll` (via
  `requestAnimationFrame`, donc quasiment à chaque frame pendant un geste de scroll), en comparant
  `rect.bottom` à `window.innerHeight` — or sur iOS Safari, `window.innerHeight` change en continu
  PENDANT l'animation native de la barre d'adresse qui se masque/affiche au scroll (comportement
  normal, déjà géré nativement par WebKit pour `position: fixed`). Une mesure prise au mauvais
  instant de cette animation suffisait à déclencher la "réparation" du watchdog — qui force
  elle-même un reflow synchrone (retire puis réapplique `position` sur la barre). Répétée à
  quasiment chaque frame de CHAQUE scroll sur mobile, cette réparation est la cause la plus
  probable du symptôme observé : le watchdog de la tentative précédente provoquait probablement
  lui-même le flash qu'il était censé corriger, plutôt que de réparer un vrai bug résiduel.
  Corrigé (`App.jsx`) : plus aucune réparation déclenchée par le scroll (retiré entièrement). Le
  filet de sécurité ne reste actif que sur les transitions arrière-plan → premier plan
  (`visibilitychange`/`pageshow`, seul moment où le bug ORIGINAL — perte de couche GPU après mise
  en arrière-plan — a un sens réel, réparation immédiate) et un intervalle lent (3s au lieu d'1s)
  qui exige DEUX mesures consécutives en dérive avant d'agir (une dérive isolée est presque
  toujours une animation de barre d'adresse en cours, pas un vrai décrochage). Utilise
  `window.visualViewport?.height` quand disponible plutôt que `window.innerHeight` : c'est l'API
  conçue spécifiquement pour refléter le viewport réellement visible sur mobile, indépendante de
  l'animation de la barre d'adresse. Lint + build vérifiés propres. Honnêteté : je n'ai toujours
  aucun accès à un vrai iPhone depuis cet environnement — cette fois la théorie n'est pas une
  nouvelle cause devinée au hasard mais un vrai trou de logique trouvé dans le code du fix
  précédent une fois la confirmation "même symptôme, vrai iPhone PWA" obtenue ; reste à confirmer
  par l'utilisateur que ça règle vraiment le problème cette fois.
- ✅ Notifs "Fin de match" reçues pour les matchs DE LA VEILLE, en pleine soirée (constat
  utilisateur, 11/09 : "hier soir j'ai reçu les notifs de fin de match des matchs de la veille")
  — root cause trouvée dans `cf-worker/src/index.js` : `FINAL_DONE_TTL` (verrou `finalDone:
  {eventId}`, seul garde-fou empêchant de retraiter un match déjà clos) était fixé à 26h,
  supposé couvrir "le reste de la journée + marge". Sous-estimé : `slugDatePairs` (voir
  `runOnePass`) fetch CHAQUE passe le scoreboard ESPN "today" ET "yesterday" pour chaque
  compétition — un match fini tôt le Jour 1 reste donc visible dans le fetch "today" tout le
  reste du Jour 1 (~24h), PUIS dans "yesterday" tout le Jour 2 suivant (~24h de plus), soit
  jusqu'à ~48h au pire, pas "le reste de la journée". Une fois `finalDoneKey` expiré (et le
  cache d'état par-match, 12h, expiré lui aussi) pendant que ce match traîne encore dans un
  fetch, le Worker le voit comme "FINAL pour la 1ère fois" : contrairement à l'ancien schéma
  Vercel (`api/cron-goals.js`, fallback manuel désormais inactif) qui exige une vraie transition
  LIVE→FINAL entre 2 passes et ne peut donc jamais redémarrer tout seul, ce Worker confirme un FT
  sur 2 passes "FINAL" consécutives au même score (`isFinalConfirmed`) — un match qui réapparaît
  juste comme "FINAL" y suffit très bien, sans avoir eu besoin de le voir LIVE d'abord. Il envoie
  alors une VRAIE notif neuve (`ts` à l'instant présent), qui échappe totalement au garde-fou
  côté client déjà en place (`sw-push.js`, ignore les notifs de plus de 20min par rapport à LEUR
  PROPRE `ts` — inutile ici puisque ce `ts` est frais, ce n'est pas une notif ancienne délivrée en
  retard, mais une notif neuve pour un événement ancien). 26h expirant typiquement en soirée le
  lendemain d'un match du soir colle exactement au symptôme rapporté. Corrigé : `FINAL_DONE_TTL`
  26h → 54h (marge confortable au-delà du pire cas ~48h). Honnêteté : ce correctif est dans
  `cf-worker/`, un Worker Cloudflare déployé SÉPARÉMENT de Vercel (`npm run deploy` depuis ce
  dossier, voir `cf-worker/README.md`) — je n'ai pas d'accès authentifié à `wrangler`/Cloudflare
  depuis cet environnement pour déployer moi-même ; le code est poussé sur le repo mais reste
  inactif en production tant que l'utilisateur ne lance pas le déploiement manuellement.
- ✅ Risque annexe trouvé en répondant à une question utilisateur (11/09 : "si une notif part pas
  pendant un match, si le match est fini je recevrai pas de notif de ce match ?") — bonne
  intuition, un vrai trou existait dans `cf-worker/src/index.js` : les blocs de retry "but" et
  "carton rouge" (`track[side]`/`cardTrack[side]` n'avancent QUE si l'envoi réussit, déjà corrigé
  pour un bug antérieur — voir historique) n'étaient retentés que tant que `LIVE_ESPN.has(prevStatus)
  || isLive` était vrai — c'est-à-dire pendant le direct, PLUS une seule passe supplémentaire (le
  temps que `prevStatus` rattrape le passage à FINAL). Au-delà (dès que `prevStatus` lui-même
  devient FINAL, ce qui arrive pile à la passe qui confirme le FT et pose `finalDoneKey`), un but
  ou carton resté non envoyé après 2 échecs consécutifs (~2min de panne Vercel/réseau) n'était
  plus jamais retenté — perdu silencieusement, sans erreur visible, alors que la notif "Fin de
  match" elle-même partait normalement (chemin séparé). Corrigé : condition élargie à `||
  isFinalNow` sur les deux blocs — sans risque, `alreadyDone` (vérifié en tête de boucle) protège
  déjà totalement contre tout retraitement d'un match réellement clos, cet ajout ne fait que
  retarder le moment où on arrête de retenter, jamais le dépasser. Fenêtre de risque avant ce fix :
  étroite (il fallait 2 échecs consécutifs d'envoi Vercel dans les ~2 dernières minutes d'un
  match précis) mais réelle. 356 tests + lint inchangés. Même limite de déploiement que le point
  ci-dessus : ce fix vit dans `cf-worker/`, à déployer manuellement (`npm run deploy`).
- ✅ Garde-fou supplémentaire ajouté suite à une remarque utilisateur pertinente (11/09 : "c juste
  pour les notifs qu'il faut enlever le fait d'envoyer les notifs [...] quand le match est déjà
  terminé, ça sert à rien") — après les 2 fixes ci-dessus (TTL 54h + retry élargi), tous deux basés
  sur des verrous Redis à durée de vie fixe, l'utilisateur a raison de vouloir quelque chose de plus
  direct. Ajout dans `cf-worker/src/index.js` : `STALE_MATCH_MS` (6h) — avant tout traitement d'un
  match, compare `evt.date` (coup d'envoi, fourni par ESPN) à maintenant ; si l'écart dépasse 6h,
  le match est sauté purement et simplement (`continue`), SANS AUCUN accès Redis (juste une
  comparaison de date, donc gratuit en performance, peut tourner à chaque passe sans souci de
  budget). 6h couvre très largement le plus long match possible (90min + prolongations + tirs au
  but + un gros retard), tout en étant bien en dessous de la fenêtre ~48h où un match peut
  réapparaître dans les fetchs ESPN. Ne remplace PAS `FINAL_DONE_TTL`/`alreadyDoneIds` (toujours
  utiles pour éviter de retraiter inutilement les matchs récents déjà clos, le cas normal) — s'ajoute
  comme dernier rempart indépendant de tout état Redis : même si un futur bug de verrou/TTL
  réapparaissait pour une raison différente de celle déjà corrigée, un match visiblement trop vieux
  ne pourra plus jamais générer de notif. Vérifié par un test numérique ad-hoc (2h → pas sauté,
  30h → sauté) + 356 tests + lint inchangés. Même limite de déploiement que les 2 points
  ci-dessus : à déployer manuellement (`npm run deploy` depuis `cf-worker/`).
- ✅ Choix produit adopté suite à une proposition utilisateur (11/09 : "quand l'app reçoit que le
  match est terminé [...] on n'autorise pas les notifs qui étaient bloquées de ce match, on les
  jette") — remplace, pour les notifs but/carton rouge, l'approche "retenter plus longtemps"
  ajoutée juste avant (élargissement `isFinalNow`) par une approche plus simple demandée par
  l'utilisateur : ABANDONNER plutôt que retenter, dès que le match vient d'être confirmé terminé.
  Dans `cf-worker/src/index.js`, les 2 blocs de retry (but + carton rouge) vérifient maintenant
  `isFinalConfirmed` (déjà calculé plus haut, vrai seulement à la passe qui confirme le FT) au
  moment d'un échec d'envoi : si vrai, `track[side]`/`cardTrack[side]` avance quand même (comme si
  envoyé) au lieu de rester bloqué à retenter — le but/carton concerné n'est alors jamais notifié
  individuellement. Différent de `STALE_MATCH_MS` (protège contre un match vieux de PLUSIEURS
  HEURES) : ici c'est la fin du match, la même minute — choix produit assumé de préférer NE RIEN
  envoyer plutôt qu'un but notifié après-coup une fois le score déjà scellé. L'essentiel (score
  final exact via la notif "Fin de match" elle-même) reste correct dans tous les cas ; seul le
  détail "but de X à la Ye minute" de ce but précis serait perdu, sciemment, dans le scénario rare
  où son envoi échoue PILE à la passe de confirmation du FT. La notif "Fin de match" elle-même
  N'EST PAS concernée par ce changement — elle continue d'être retentée (bornée par
  `STALE_MATCH_MS`, 6h) plutôt qu'abandonnée : contrairement à un but individuel, c'est la seule
  notif qui informe vraiment du résultat, la perdre serait un vrai recul, pas juste un détail en
  moins. 356 tests + lint inchangés. Même limite de déploiement que les points ci-dessus.
- ✅ "Match du jour" affichait Valence-Séville alors que Rennes-Marseille était objectivement plus
  attendu (constat utilisateur, 11/09) : root cause dans `src/utils/matchDuJour.js` — Séville
  était dans `BIG_TEAMS` (2 points) au même titre que Marseille, et Rennes/Valence étaient tous
  deux dans `NOTABLE_TEAMS` (1 point) → Rennes-Marseille (1+2=3) et Valence-Séville (1+2=3)
  tombaient EXACTEMENT à égalité, départagés uniquement par le coup d'envoi le plus tardif
  (`electBest`), un critère purement horaire sans lien avec "quel match est le plus attendu".
  L'ajout initial de Séville dans BIG_TEAMS (02/09) reposait sur un palmarès réel (7 Ligues
  Europa) mais plus étroit que celui des autres clubs de ce tier (champions nationaux/finalistes
  C1) — objectivement un cran en dessous en termes d'affiche générale auprès du grand public.
  Déplacé vers `NOTABLE_TEAMS` (1 point, au lieu d'un retrait pur et simple — le palmarès reste
  réel, juste pas au niveau du 1er tier). Avec ce changement, Rennes-Marseille (1+2=3) devance
  désormais clairement Valence-Séville (1+1=2), quelle que soit l'heure de coup d'envoi. Test
  dédié ajouté (`matchDuJour.test.js`) reproduisant exactement ce cas ; 1 test existant ajusté
  (utilisait Séville comme exemple générique de "gros club à 2 points", remplacé par Atlético
  Madrid qui reste à ce tier) — 357 tests + lint + build vérifiés. Honnêteté : comme documenté
  dans le fichier depuis le début, `BIG_TEAMS`/`NOTABLE_TEAMS` restent des listes CURÉES (aucune
  donnée de popularité/enjeu réelle disponible sans appel API supplémentaire), donc un jugement
  assumé, pas un score objectif — à réajuster au prochain cas qui semble à côté de la plaque.
- ✅ Emojis KO/mi-temps/reprise des notifs push "pas ouf" (constat utilisateur, 11/09 : "c des
  emoji de telephone quoi") : 🔴 (coup d'envoi), ⏸ (mi-temps) et ▶️ (reprise) sont littéralement
  les icônes de contrôle média (enregistrer/pause/lecture) du Control Center iPhone — pas des
  symboles foot, d'où l'impression "téléphone" plutôt que sport. Remplacés dans `api/cron-goals.js`
  ET `cf-worker/src/index.js` (les 2 implémentations, gardées identiques) : ⏳ (sablier — pause
  dans le temps) pour la mi-temps, 🏃 (joueur qui repart) pour la reprise. 🔴 pour le coup d'envoi
  gardé tel quel (demande explicite utilisateur juste après : "laisse en rouge") — un essai vers
  🟢 (feu vert) a été fait puis reverté dans la foulée. But/carton rouge/fin de match (⚽/🟥/🏁)
  n'avaient pas ce problème (déjà des symboles clairement sportifs), inchangés. Lint + 357 tests +
  build vérifiés. Même limite de déploiement que les points notifs ci-dessus : la partie
  `cf-worker/` nécessite `npm run deploy` manuel ; la partie `api/cron-goals.js` (fallback
  historique, pas le chemin actif) se déploie automatiquement avec le reste de l'app via Vercel.
- ✅ Titre "Coup d'envoi" encadré de 2 points rouges (demande utilisateur, 11/09) : `"🔴 Coup
  d'envoi !"` → `"🔴 Coup d'envoi 🔴"` (le "!" retiré au profit de la symétrie visuelle des 2
  emoji, choix assumé) dans `api/cron-goals.js` ET `cf-worker/src/index.js`.
- ✅ Emoji "Reprise" revu ensemble avec l'utilisateur (11/09) : 4 options proposées (🏃 le choix
  précédent, 🔄, ⏱️, ⚡) — ⚡ choisi. `"🏃 Reprise !"` → `"⚡ Reprise !"` dans les 2 fichiers.
  Lint + 357 tests + build vérifiés à chaque étape.
- ✅ Emoji "Mi-temps" revu ensemble avec l'utilisateur (11/09, plusieurs allers-retours : 3 lots
  d'options proposées, les 2 premiers jugés "trop loin"/"on s'éloigne trop" par l'utilisateur,
  puis passage à `🟡 Mi-temps` (point jaune, cohérent avec 🔴 KO / ⚡ Reprise) — mais l'utilisateur
  est revenu dessus juste après ("j'aime pas... j'hésite entre les deux [sablier/horloge]"),
  confirmé explicitement vouloir le sablier une fois la question reposée directement) : retour
  final à `⏳ Mi-temps` dans `api/cron-goals.js` ET `cf-worker/src/index.js` (annule le point
  jaune du commit précédent). 357 tests + lint vérifiés à chaque étape.

- ✅ Barre du bas ENCORE décollée, 6e signalement (constat utilisateur, 11/09, capture d'écran à
  l'appui : la barre apparaît EN PLEIN MILIEU de la page — entre les cartes de résultats Ligue des
  Champions et le bloc "Dernières actualités" — malgré les 5 tentatives précédentes : filet body,
  couche GPU, portail React, watchdog avec réparation, watchdog affiné sans trigger scroll). Audit
  complet refait de zéro plutôt que de deviner une 6e cause (2 agents de recherche dédiés, lecture
  intégrale de `navbar.jsx`, `navbar.css`, du watchdog `App.jsx`, et grep exhaustif de tout ce qui
  touche à `.sfTabbar`/`body`) : root cause la plus probable trouvée, jamais auditée jusqu'ici —
  6 endroits du code (`Match.jsx`, `Resultat.jsx`, `Classement.jsx` ×2, `Footer.jsx`,
  `GroupModal.jsx`) posent le pattern classique de scroll-lock iOS sur un dropdown/modal ouvert :
  `document.body.style.position = 'fixed'; top = -scrollY px`. Ce pattern existait déjà AVANT le
  passage de `.sfTabbar` en portail direct dans `<body>` (10/09) — mais depuis ce portail,
  `.sfTabbar` est un ENFANT DIRECT de `<body>`, et Safari iOS a un comportement non conforme à la
  spec CSS documenté sur ce cas précis : quand `<body>` lui-même passe en `position:fixed` avec un
  `top` négatif dynamique, certains rendus WebKit répercutent ce décalage sur les descendants
  `position:fixed` de `<body>` au lieu de les laisser ancrés au viewport (la spec dit que seuls
  transform/filter/perspective/will-change/contain sur un ancêtre doivent casser `position:fixed`
  — pas un simple `position:fixed` — mais c'est une régression connue de Safari). Résultat :
  ouvrir n'importe lequel des 6 dropdowns/modals après avoir scrollé décale visuellement
  `.sfTabbar` de `-scrollY` px — collant exactement au symptôme rapporté, et contrairement aux 5
  tentatives précédentes, **reproductible à la demande** (pas besoin d'un cycle arrière-plan/
  premier-plan). Corrigé : nouveau fichier `src/utils/scrollLock.js` (`lockBodyScroll()`,
  factorise les 6 copies quasi identiques) qui pose `position:fixed`/`top` sur `#root` (le
  conteneur de tout le contenu applicatif React) au lieu de `<body>` — `#root` est un FRÈRE de
  `.sfTabbar` dans le DOM (portail direct dans body), jamais un ancêtre, donc structurellement
  insensible à ce que `#root` fait. `<body>` garde seulement `overflow:hidden` (inoffensif pour
  `position:fixed`, bloque juste le scroll de fond). Vérifié qu'aucune règle CSS statique du
  projet ne pose déjà `transform`/`filter`/`contain` sur `#root` (grep exhaustif, `theme-v2.css`/
  `index.css`/`LiveMatchPage.css` n'utilisent `#root` que comme préfixe de spécificité sur des
  descendants) — donc rien qui casserait à son tour `position:fixed` posé dynamiquement dessus.
  357 tests + lint + build vérifiés (1 erreur lint pré-existante dans `Classement.jsx` ligne 212,
  confirmée sans lien avec ce fix via `git stash`, non touchée). Honnêteté : toujours aucun accès
  à un vrai iPhone/PWA depuis cet environnement pour reproduire le bug moi-même — mais c'est la
  première piste concrète, reproductible à la demande (pas seulement en théorie), qui explique le
  symptôme EXACT de la capture d'écran (position figée à `-scrollY`, pas un décrochage aléatoire) ;
  à confirmer par l'utilisateur sur son téléphone après déploiement Vercel (automatique, contrairement
  aux fixes `cf-worker/` — pas de `npm run deploy` manuel nécessaire pour celui-ci).

- ✅ Barre du bas ENCORE décollée, 7e signalement (constat utilisateur, 11/09, juste après le
  déploiement confirmé du fix scroll-lock #root — "s'est encore décollé", bundle live vérifié en
  direct via le navigateur intégré : `index-DpnRwcE_.js` bien identique au build local du commit
  précédent, donc le fix scroll-lock ÉTAIT réellement en prod, la piste "déploiement pas encore
  actif" est écartée avec certitude cette fois). Nouvelle théorie, jamais testée jusqu'ici, ET un
  vrai bug de logique trouvé au passage dans le watchdog lui-même — pas juste une 7e cause devinée
  au hasard. Théorie : si le décrochage est un désync de PEINTURE (la couche compositée à l'écran
  reste visuellement figée après un cycle arrière-plan→premier plan) plutôt qu'un désync de LAYOUT,
  `getBoundingClientRect()` (utilisé par TOUS les watchdogs géométriques des tentatives 4/5/6)
  continue de renvoyer la position CORRECTE — le layout n'a jamais été faux, seul l'écran affiche
  autre chose. Ça expliquerait pourquoi aucun watchdog géométrique n'a jamais rien détecté
  d'anormal en 3 tentatives. Suspect direct : `transform: translateZ(0)` + `will-change:
  transform` posés le 10/09 sur `.sfTabbar` (`navbar.css`) pour forcer une couche GPU dédiée — le
  "correctif standard" documenté pour ce type de décrochage, mais aussi précisément le mécanisme
  qui expose ce genre de bug de compositing sur iOS Safari (un élément promu sur sa propre couche
  peut se désynchroniser de cette couche après un cycle arrière-plan/premier-plan). Retiré. En
  parallèle, vrai bug de logique trouvé dans le watchdog (`App.jsx`, indépendant de la théorie
  ci-dessus, solide à 100%) : `onResume` posait `driftStreak = 2` puis appelait `check()` — mais
  `check()` RECALCULE la dérive à cet instant et écrase `driftStreak` à 0 si cette mesure est
  ≤4px, AVANT même de regarder la valeur "2" qu'onResume venait de poser. Dans le scénario "désync
  de peinture" (layout correct, donc drift mesuré ≈0), ce filet ne réparait JAMAIS rien — du code
  mort pour exactement le cas qu'il était censé traiter en priorité (le retour au premier plan).
  Corrigé (`App.jsx`) : `onResume` force désormais une réparation INCONDITIONNELLE (reflow/repaint
  forcé via toggle `position`), indépendante de toute mesure de dérive, à chaque retour au premier
  plan. Le watchdog périodique (3s, 2 mesures consécutives) reste actif en complément pour un vrai
  décrochage de LAYOUT sans cycle arrière-plan/premier-plan. 357 tests + lint + build vérifiés.
  Honnêteté : toujours aucun accès à un vrai iPhone/PWA pour reproduire — mais cette fois la
  correction adresse un TROU DE LOGIQUE concret et démontrable dans le code existant (pas une
  hypothèse externe non vérifiable), ce qui est plus solide que les tentatives purement théoriques ;
  à confirmer par l'utilisateur sur son téléphone après ce déploiement (automatique via Vercel).
- 🔍 Premier vrai diagnostic confirmé par l'utilisateur (11/09, question posée directement — "tu
  fais quoi juste avant que ça arrive ?" — réponse : "je revenais d'arrière-plan") : le
  déclencheur est bien un retour d'arrière-plan, PAS un scroll isolé ni l'ouverture d'un
  dropdown/modal. Ça valide directement la cible du fix de la 7e tentative (`onResume` dans
  `App.jsx`, déclenché sur `visibilitychange`/`pageshow`) — c'est exactement le chemin de code
  déjà corrigé (réparation inconditionnelle, plus de dépendance à une mesure de dérive qui pouvait
  être faussement à 0 en cas de désync de peinture). Reste à confirmer si ce fix (déployé) suffit
  maintenant que le scénario déclencheur est identifié avec certitude — première fois dans cette
  série de tentatives qu'on a une confirmation du "quand", pas seulement du "quoi".
- ✅ Détail décisif obtenu (11/09, question posée directement — "à quoi ça ressemble visuellement
  quand ça se décolle ?" — réponse utilisateur : "y'a une épaisseur noire en dessous [de la barre]
  quand elle se décolle"). Premier détail visuel PRÉCIS obtenu en 8 signalements — jusqu'ici on
  savait "la barre est mal placée", jamais exactement COMMENT. Un bandeau noir qui apparaît SOUS
  la barre au moment du décrochage est la signature d'un mécanisme précis et bien documenté,
  différent de toutes les théories précédentes (compositing/peinture, ancêtre transformé,
  scroll-lock) : le viewport de LAYOUT (`window.innerHeight`, sur lequel `position:fixed;
  bottom:0` s'ancre nativement) et le viewport VISUEL réel (`visualViewport.height`) divergent
  quand la barre d'outils Safari se masque/affiche — en PWA standalone particulièrement, ce
  réajustement n'est pas toujours instantané/fiable. Le résultat : un espace entre le bas de la
  barre et le vrai bas de l'écran, qui apparaît noir (fond de page nu, sans le dégradé de la barre
  par-dessus) — exactement la description de l'utilisateur. Aucune des 7 tentatives précédentes ne
  corrigeait CET écart précis : les watchdogs géométriques (tentatives 4/5/7) ne réparaient
  qu'APRÈS COUP (toutes les 3s, ou au retour d'arrière-plan), jamais PENDANT que l'écart existe.
  Fix (`App.jsx`, nouvel effect séparé, complémentaire aux watchdogs existants — ne les remplace
  pas) : synchronisation active via l'API `window.visualViewport` (conçue précisément pour ce cas),
  qui décale la barre d'un `translateY` égal à l'écart mesuré (`window.innerHeight - (vv.height +
  vv.offsetTop)`), recalculé à CHAQUE évènement `resize`/`scroll` de `visualViewport` — déclenchés
  EN TEMPS RÉEL pendant l'animation de la barre d'adresse, contrairement aux watchdogs précédents
  qui ne vérifiaient qu'à intervalle fixe. 357 tests + lint + build vérifiés. Honnêteté : toujours
  aucun accès à un vrai iPhone/PWA — mais c'est la 1re fois dans cette série qu'un détail visuel
  PRÉCIS du symptôme (pas juste "ça se décolle") pointe vers un mécanisme documenté et spécifique,
  plutôt qu'une hypothèse générique parmi plusieurs possibles ; à confirmer par l'utilisateur.

- ✅ LaLiga et Bundesliga passées en "mode peinture" comme UEL/UECL (demande explicite, 12/09 :
  "tu pourrais faire pareil pour les cards de bundesliga et laliga aussi ?") : `tint`/`tint2`/
  `tint3`/`tintSoft`/`tintStops`/`tintSilverText` (dégradé linéaire à zones, plusieurs fois affiné
  par le passé — historique gardé en commentaire) remplacés par `tintTheme: 'pd'`/`'bl1'` dans
  `src/data/competitions.js`, avec les blocs CSS dédiés `.poster--theme-pd`/`-bl1` (`accueil.css`)
  et `.lmp__hero--theme-pd`/`-bl1` (`LiveMatchPage.css`), sur le modèle exact de `.poster--theme-
  uel`/`-uecl` (5 taches noires au même gabarit + taches de couleur floutées). Couleurs reprises
  TELLES QUELLES de l'ancienne recette, pas inventées : LaLiga rouge `#b3242b` + or `#e0b040`,
  Bundesliga rouge de marque `#e30613`. `TINT_THEME_CAMP_COLORS` (carte "Match du jour") mis à
  jour avec ces 2 nouvelles entrées. Honnêteté / écart assumé : le "un peu de blanc" demandé le
  05/09 pour Bundesliga n'a PAS été repris dans cette version peinture — un ancien essai de blob
  blanc flouté sur cette même compétition avait donné un rendu "rosé délavé" (le blanc se diluant
  dans le rouge, voir l'historique dans `competitions.js`) ; par prudence, gardé noir+rouge
  uniquement plutôt que retester à l'identique un échec déjà documenté. 357 tests + lint + build
  vérifiés (fonctionnement automatique : ces champs ne sont lus qu'en présence, leur suppression
  désactive proprement l'ancienne recette sans toucher au JS, même mécanisme que UCL/UEL/UECL/WC/
  NL/CAN déjà en mode peinture).

- ✅ Serie A passée en "mode peinture" avec bleu/vert/blanc (demande explicite, 12/09 : "fait
  aussi pour la serie a avec un bleu vert et blanc") : `tint`/`tintLight`/`tint2`/`tint3`/
  `tintSoft`/`tintStops`/`tintPearl` remplacés par `tintTheme: 'sa'` dans `competitions.js`, blocs
  CSS `.poster--theme-sa` (`accueil.css`) et `.lmp__hero--theme-sa` (`LiveMatchPage.css`). Structure
  reprise de `.poster--theme-nl` (grands calques flous, base sombre) plutôt que du gabarit UEL/
  UECL/PD/BL1 (5 taches noires) : aucune demande de noir cette fois, et NL avait déjà prouvé que
  le blanc se mélange bien en mode peinture tant qu'il n'est pas associé au rouge (contrairement à
  l'échec documenté sur Bundesliga, rouge+blanc = rosé délavé). Bleus repris de l'ancienne recette
  Serie A déjà validée (`#0a5f7a`/`#0d97ab`/`#3bb3c7`) ; vert `#16a34a` choisi par cohérence
  esthétique, honnêteté : aucun vert n'existait dans l'identité Serie A sur ce site avant cette
  demande, pas un pixel repris d'un logo officiel comme pour d'autres thèmes (UEL/UECL/CAN/WC).
  `TINT_THEME_CAMP_COLORS` mis à jour (`sa: ['#0d97ab', '#16a34a']`). 357 tests + lint + build
  vérifiés, vérifié aussi en direct sur la prod (navigateur intégré, cartes LaLiga/Bundesliga du
  point précédent confirmées visuellement identiques au rendu attendu).

- ✅ Un peu de blanc rajouté au mode peinture Bundesliga (12/09, demande explicite juste après le
  point précédent : "juste pour la bundesliga rajoute un peu de blanc") — reversal assumé d'un
  choix de prudence que j'avais moi-même proposé de reconsidérer. La tache rouge la plus sombre
  et la moins visible du gabarit (`#5c0209`, 90% 32%) est remplacée par une tache BLANCHE dans
  `.poster--theme-bl1` (`accueil.css` + `.lmp__hero--theme-bl1` dans `LiveMatchPage.css`, gardés
  identiques comme toujours), volontairement petite et resserrée (fondu vers transparent à 42%
  au lieu de 52%) pour rester un "peu" de blanc, pas une masse. Honnêteté : l'échec documenté
  "rosé délavé" (voir l'historique du 05/09 dans `competitions.js`) concernait l'ANCIENNE recette
  en dégradé LINÉAIRE continu, où le blanc se mélange progressivement au rouge sur toute une
  zone — ici la structure est des taches radiales DISCRÈTES et floutées, chacune avec son propre
  point de fondu, un mécanisme déjà éprouvé sans souci sur NL/WC (mais jamais testé aux côtés du
  rouge avant ce changement précis) — pas de garantie à 100% que le rendu final plaira davantage,
  mais la demande explicite de l'utilisateur prime sur la prudence initiale. 357 tests + lint +
  build vérifiés inchangés (changement CSS + commentaire uniquement, aucune logique touchée).

- ✅ Blanc du mode peinture Bundesliga densifié, même jour (12/09, demande explicite juste après
  le point précédent : "rajoute un peu plus de tache blanche [...] au moins 4 autre je pense un
  peu dispercé") : 4 taches rouges supplémentaires converties en blanc dans `.poster--theme-bl1`
  (`accueil.css` + `.lmp__hero--theme-bl1` dans `LiveMatchPage.css`) — positions choisies pour
  être DISPERSÉES aux 4 coins de la carte (30% 55%, 76% 72%, 50% 14%, 14% 82%) plutôt que
  regroupées, chacune gardée petite/resserrée (fondu à 40-42%, même logique que la 1ère tache
  blanche du point précédent) pour rester "un peu" de blanc réparti et non une masse continue.
  2 taches rouges conservées (60% 30%, 65% 96%) pour ne pas perdre l'identité rouge de marque —
  bilan : 5 blanches / 5 noires / 2 rouges. 357 tests + lint + build vérifiés inchangés.

- ✅ Rééquilibrage noir/rouge du mode peinture Bundesliga, même jour (12/09, demande explicite :
  "met + de rouge a la place du noir en bas a droite [...] garde le noir en haut a gauche") : les
  2 taches noires du gabarit qui tombaient en bas/bas-droite de la carte (92% 58% et 42% 92%)
  converties en rouge (`#c41230`/`#8a0410`) dans `.poster--theme-bl1` (`accueil.css` +
  `.lmp__hero--theme-bl1` dans `LiveMatchPage.css`) — la tache noire du coin haut-gauche (15% 15%,
  explicitement demandée à garder) et les 2 autres taches noires restantes (8% 48%, 82% 10% — ni
  en bas ni à droite) inchangées. Bilan final : 3 noires / 4 rouges / 5 blanches. 357 tests + lint
  + build vérifiés inchangés (changement CSS + commentaire uniquement).

- ✅ Rouge encore renforcé au mode peinture Bundesliga, même jour (12/09, demande explicite :
  "en bas au milieu et en haut a droite et au milieu aussi rajoute du rouge c la couleur primaire
  du championnat") : les 2 dernières taches noires du gabarit autres que le coin haut-gauche (8%
  48% — au milieu verticalement de la carte — et 82% 10% — haut-droite) converties vers le rouge
  de marque `#e30613` dans `.poster--theme-bl1` (`accueil.css` + `.lmp__hero--theme-bl1` dans
  `LiveMatchPage.css`). La tache "bas milieu" (42% 92%, déjà rouge depuis le point précédent)
  éclaircie de `#8a0410` (rouge très sombre) vers ce même `#e30613`, pour que ce soit bien LE
  rouge primaire de la Bundesliga qui domine plutôt qu'une nuance sombre annexe. Seule la tache du
  coin haut-gauche (15% 15%) reste noire, demandée explicitement à garder à 2 reprises maintenant.
  Bilan final : 1 noire / 6 rouges / 5 blanches. 357 tests + lint + build vérifiés inchangés.

- ✅ Ligue 1 et Premier League passées en "mode peinture", même jour (12/09, constat utilisateur :
  "pour la ligue 1 et la premiere league [...] y'a que une couleur c fade") — ces 2 compétitions
  étaient encore sur l'ANCIENNE recette (dégradé linéaire à zones `tint`/`tint2`/`tint3`, plusieurs
  fois retravaillée par le passé), contrairement à UEL/UECL/LaLiga/Bundesliga/Serie A/UCL/NL/WC/CAN
  déjà en mode peinture (taches radiales floutées) — d'où l'impression de "fade" en comparaison.
  Palette choisie avec l'utilisateur via question directe (2 options par compétition) : Ligue 1 en
  bleu + blanc uniquement (`tintTheme: 'fl1'`), Premier League en violet + rose/magenta
  (`tintTheme: 'pl'`, l'utilisateur a choisi cette option plutôt que "violet + blanc"). Structure
  reprise de `.poster--theme-nl`/`-sa` (8 grands calques flous, pas de gabarit à taches noires —
  aucun noir demandé pour l'une ou l'autre). Couleurs de marque déjà validées reprises telles
  quelles : bleu Ligue 1 `#085dfe`, violet PL `#8a1d92`/`#37003c`. Honnêteté : le rose/magenta PL
  (`#d6006d`/`#ff2e9e`) n'est PAS une couleur de marque officielle vérifiée à la source — accent
  choisi par cohérence avec le violet, même principe assumé que le vert Serie A. `tintLight: true`
  conservé sur les 2 (texte "Terminé"/minute en blanc, toujours pertinent sur ces fonds saturés).
  `TINT_THEME_CAMP_COLORS` mis à jour (`fl1`, `pl`). 357 tests + lint + build vérifiés
  (fonctionnement automatique : suppression propre de l'ancienne recette, même mécanisme que les
  autres passages en mode peinture).

- ✅ Bug trouvé et corrigé le même jour (12/09, constat utilisateur : "pourquoi c pas la même
  couleur dans livematchpage et matchpage et resultatpage la ? j'ai l'impression que c plus
  foncé" — précisé ensuite : concernait uniquement Ligue 1 et Premier League) : lors du passage en
  mode peinture ci-dessus, le champ `tint` d'origine (`'#085dfe'` pour FL1, `'#8a1d92'` pour PL)
  avait été OUBLIÉ dans `competitions.js` — contrairement à PD/BL1/SA où il avait bien été
  entièrement retiré. `comp?.tint` restant truthy, `MatchPage.jsx`/`LiveMatchPage.jsx` ajoutaient
  encore la classe `lmp__hero--tinted` en plus de `lmp__hero--theme-fl1`/`-pl` — or la règle CSS
  de l'ANCIEN mécanisme, `.lmp__hero--tinted.lmp__hero--lightTint .lmp__heroTintC` (3 classes),
  est plus SPÉCIFIQUE que celle du nouveau mode peinture, `.lmp__hero--theme-fl1 .lmp__heroTintC`
  (2 classes) — elle reprenait donc la main sur ces 2 pages précises et affichait l'ancien voile
  nacré blanc générique à la place du bleu/blanc ou violet/magenta voulu, quel que soit l'ordre
  des règles dans le fichier (la spécificité CSS prime toujours sur l'ordre). Les cartes de
  l'Accueil/Résultats (`MatchPoster.jsx`) n'étaient PAS touchées par ce bug précis : leur mode
  peinture vit sur une classe différente (`.poster__bg--gradient`) que celle utilisée par
  l'ancien mécanisme lightTint (`.poster__bg--gradientTri`), pas de collision de spécificité sur
  ce layer-là. Vérifié en direct sur la prod (navigateur intégré) : `className` du hero contenait
  bien `lmp__hero--tinted` en trop sur `/match/espn-FL1-...`, confirmé par lecture du
  `backgroundImage` calculé (c'était bien le motif nacré générique, pas notre dégradé bleu/blanc).
  Corrigé : `tint` supprimé pour les 2 compétitions, `tintLight` conservé (toujours utile pour le
  texte blanc, indépendant de ce bug). 357 tests + lint + build vérifiés inchangés.

- ✅ Rose/magenta retiré du mode peinture Premier League, même jour (12/09, reconsidération
  utilisateur juste après le fix ci-dessus : "pour la premiere league c mieux si c du blanc pluto
  que le rose bizarre la nn ?") — revient sur le choix explicite fait plus tôt via question directe
  ("violet + rose/magenta" plutôt que l'option "Recommandé" violet + blanc). Dans
  `.poster--theme-pl` (`accueil.css`) et `.lmp__hero--theme-pl` (`LiveMatchPage.css`, gardé
  identique comme toujours) : les 2 taches `#d6006d`/`#ff2e9e` remplacées par du blanc `#ffffff`,
  la 3e tache magenta (60% 92%) reconvertie en `#b330c0` (déjà présent dans le même dégradé) pour
  ne laisser aucun rose isolé. `TINT_THEME_CAMP_COLORS.pl` mis à jour (`['#8a1d92', '#37003c']` au
  lieu de `['#8a1d92', '#d6006d']`) pour ne plus référencer le magenta retiré. Le violet de marque
  (`#8a1d92`/`#37003c`) est inchangé. 357 tests + lint + build vérifiés inchangés (changement CSS +
  commentaires uniquement, aucune logique touchée).

- ✅ Forme des taches blanches PL retravaillée, même jour (12/09, retour utilisateur juste après :
  "ça fait un point blanc [...] tu peux pas faire pluto des chose diformes [...] sans forme
  apparente") : un seul `radial-gradient` produit toujours un rond/une ellipse bien définie, d'où
  l'effet "point" plutôt qu'une tache de peinture. Dans `.poster--theme-pl` (`accueil.css`) et
  `.lmp__hero--theme-pl` (`LiveMatchPage.css`, gardé identique) : chacune des 2 taches blanches
  éclatée en 2 petites ellipses de tailles/ratios différents, centres décalés de quelques % l'un
  de l'autre — une fois combinées et floutées (`blur(22px)` déjà en place), elles fusionnent en
  une forme asymétrique sans contour circulaire net. Honnêteté : `radial-gradient` seul ne permet
  pas de dessiner une forme réellement libre/organique — approximation par superposition
  d'ellipses, pas une vraie tache "sans forme" comme de la vraie peinture ; à ajuster si le rendu
  ressemble encore trop à un rond après vérification visuelle. 357 tests + lint + build vérifiés
  inchangés (changement CSS + commentaire uniquement).

- ✅ Blanc réduit en petites touches sur Premier League ET Ligue 1, même jour (12/09, retour
  utilisateur : "enlève le blanc en fait pour la premiere league ca va pas ou met des toute
  petite touche de blanc mais petit pareil pour la ligue 1") — le découpage en 2 ellipses par
  tache (tentative précédente, pour casser l'effet "point") n'a pas suffi. Choix fait : garder du
  blanc mais en réduisant fortement la taille plutôt que continuer à retoucher la forme. PL
  (`.poster--theme-pl` + `.lmp__hero--theme-pl`) : retour à 1 seule ellipse par emplacement (plus
  simple que le découpage précédent), taille ~14-16%/22-24% (contre 34-42% avant), fondu resserré
  à 36-38%. Ligue 1 (`.poster--theme-fl1` + `.lmp__hero--theme-fl1`) : même traitement sur ses 2
  taches blanches existantes (38%/62% et 38%/60%, la même taille que les taches de couleur
  principales jusqu'ici) → réduites à ~15-16%/23-24%, mêmes positions inchangées. `accueil.css`
  et `LiveMatchPage.css` gardés identiques comme toujours pour les 2 compétitions. 357 tests +
  lint + build vérifiés inchangés (changement CSS + commentaires uniquement).

- ✅ Noir entièrement retiré du mode peinture Bundesliga, même jour (12/09, demande explicite :
  "met que rouge et blanc pas de noir et beaucoup de rouge et du blanc [...] très doux tres
  fins") — revient sur le "garder le noir en haut à gauche" demandé 2 fois plus tôt dans la
  journée (voir les 2 points ci-dessus). La dernière tache noire (15% 15%) passe au rouge de
  marque `#e30613` dans `.poster--theme-bl1` (`accueil.css`) et `.lmp__hero--theme-bl1`
  (`LiveMatchPage.css`, gardé identique) : 7 taches rouges au total, 0 noire. Les 5 taches
  blanches réduites ET adoucies pour rester "très doux très fins" plutôt que des blocs nets :
  taille divisée par ~2 (14-16%/20-22% contre 22-46% avant, même principe de réduction que PL/
  Ligue 1 ci-dessus) ET couleur passée de `#ffffff` opaque à `rgba(255,255,255,0.5-0.55)`
  (semi-transparent) — la baisse d'opacité en plus de la taille est ce qui donne le rendu "doux"
  spécifiquement demandé ici (différent de PL/Ligue 1, restés en blanc opaque). `TINT_THEME_
  CAMP_COLORS.bl1` mis à jour (`#000000` → `#c41230`, rouge déjà présent dans le dégradé) pour ne
  plus référencer le noir retiré. 357 tests + lint + build vérifiés inchangés (changement CSS +
  commentaires uniquement).

- ✅ "Forme récente" fausse sur certaines cards Accueil (constat utilisateur, 12/09 : "certaines
  équipe n'avait pas la bonne forme récente exemple aston villa il y'a que un losange vert alors
  que normalement elle a joué trois match") : investigation en direct via le navigateur intégré
  (React DevTools, lecture des props RÉELLEMENT reçues par `MatchPoster` sur la carte en question)
  — preuve formelle que la carte recevait `compMatches` CORRECT (les 3 vrais matchs de Villa
  cette saison : Brighton 4-0 Villa, Villa 0-1 Arsenal, Hull 0-0 Villa → L/L/D) mais un
  `formMap['58']` (id football-data.org d'Aston Villa) FAUX (`['W']`, un seul résultat qui ne
  correspond même pas au début de la vraie séquence) — alors que les deux viennent pourtant du
  MÊME objet `{formMap, matches}` renvoyé par une seule requête `fetchTeamForm('PL')`
  (`useTeamForm.js`, `formMap = buildFormMap(matches)`), donc censés être TOUJOURS cohérents
  entre eux. Vérifications qui ont permis d'écarter les pistes les plus évidentes : un test
  isolé (vitest) rejouant `resolveFdTeamId`+`buildFormMap` sur les vraies données extraites du
  cache donne le bon résultat (`['L','L','D']`) — donc pas un bug de logique encore actif
  aujourd'hui. `queryClient.getQueryData(['teamForm2','PL','cur'])` ET le blob persisté
  (`REACT_QUERY_OFFLINE_CACHE`, voir `PersistQueryClientProvider` dans `main.jsx`) contenaient
  eux DÉJÀ la bonne valeur au moment du test, y compris après un rechargement complet de la page
  — la donnée s'était donc autocorrigée entre-temps (un refetch en arrière-plan a fini par
  écraser la mauvaise valeur), mais la carte déjà affichée à l'écran, elle, ne s'est jamais mise
  à jour avec cette correction. Honnêteté : cause précise de l'écriture initiale de `['W']` non
  confirmée à 100% (aucun accès aux logs d'un fetch passé pour savoir QUAND/POURQUOI ça s'est
  produit) — l'hypothèse la plus crédible est la même famille de bug déjà documentée le 16/08
  (Deportivo) : un match de coupe (Community Shield en tout début de saison, sourcé ESPN) mal
  résolu vers le mauvais id FD.org via `resolveFdTeamId` contre un `leagueMatches` encore quasi
  vide, une valeur fausse restée ensuite figée dans le cache PERSISTÉ (`gcTime` 24h) plus
  longtemps qu'un simple cycle de `FORM_STALE` (2min) n'aurait dû le permettre. Remède appliqué
  (`src/main.jsx`), cohérent avec le mécanisme déjà en place dans ce fichier pour exactement ce
  type de symptôme (voir l'historique `CACHE_BUSTER` v11/v12/v13) : bump du buster
  (`v13-...` → `v14-2026-09-12-fix-forme-recente-cache-fige`) pour purger IMMÉDIATEMENT toute
  entrée `teamForm2` déjà persistée chez les utilisateurs actuels, plutôt que de compter sur un
  refetch futur dont le délai n'est pas garanti. Si le même symptôme réapparaît sur une AUTRE
  équipe après ce déploiement, ce sera le signe qu'un vrai bug de logique est encore actif (pas
  juste un résidu de cache) et qu'il faudra creuser `resolveFdTeamId`/`cupMatches` plus
  profondément (`useTeamForm.js`). 357 tests + lint + build vérifiés inchangés (bump de constante
  uniquement, aucune logique touchée).

- 🔍 Barre du bas ENCORE décollée, 9e signalement (constat utilisateur, 12/09 : "j'ai encore le
  bug de la navbar en bas la elle se decollent frr quand je reviens d'arriere plan j'en peu
  plus") — même symptôme, même déclencheur (retour d'arrière-plan) que la 7e tentative, qui
  ciblait pourtant déjà exactement ce cas avec une réparation "inconditionnelle". Honnêteté
  d'abord : toujours aucun accès à un vrai iPhone/PWA depuis cet environnement pour observer le
  bug ni confirmer une cause précise — ce correctif rend la réparation existante plus difficile à
  manquer pour WebKit, ce n'est pas une nouvelle certitude. Changements (`App.jsx`, watchdog
  retour-arrière-plan) : (1) `repair()` passait par un simple toggle de `position` (fixed→static→
  fixed), qui force un reflow mais pas forcément un vrai repaint de la couche de compositing ; un
  toggle `display: none` → reflow → display d'origine AVANT le toggle de position détruit
  complètement la couche de l'élément avant de la reconstruire, un cran au-dessus. (2) Ajout d'un
  micro-scroll aller-retour (1px) après la réparation — technique documentée pour forcer WebKit à
  resynchroniser les éléments `position: fixed` avec le viewport visuel après un cycle arrière-
  plan/premier-plan. (3) `onResume` déclenche maintenant la réparation en 2 PASSES (immédiate +
  100ms plus tard), au cas où la 1re passe arrive avant que le cycle interne de resynchronisation
  d'iOS ne soit terminé — hypothèse pour expliquer pourquoi une réparation immédiate seule (7e
  tentative) a pu échouer silencieusement. 357 tests + lint + build vérifiés inchangés. Si le
  symptôme persiste malgré ces 3 renforts cumulés, la piste la plus utile pour la suite n'est plus
  de deviner une 10e cause théorique mais d'obtenir une preuve visuelle directe (capture d'écran/
  vidéo de l'instant où ça se décolle) — demandé à l'utilisateur.

- 🔍 Changement de stratégie sur la barre du bas décollée (12/09, retour utilisateur après la 9e
  tentative : "bah oui mais faudrait savoir en fait parce que la ça fait jsp combien de fois qu'on
  essaie de réparer ça") — remarque juste : 9 tentatives basées sur des théories (compositing,
  ancêtre transformé, scroll-lock, écart viewport visuel...) sans jamais avoir pu observer le bug
  moi-même sur un vrai appareil depuis cet environnement. Plutôt qu'une 10e théorie devinée à
  l'aveugle, ajout d'un petit outil de MESURE réelle : `src/components/NavDebugHUD.jsx`, monté en
  permanence dans `App.jsx` mais invisible par défaut — activé une fois via `.../?navdebug=1`
  (persiste en localStorage, `.../?navdebug=0` pour désactiver). Affiche en direct (3x/seconde,
  encart discret en haut à gauche, `pointer-events: none`) : viewport de layout (`innerH`) vs
  viewport visuel réel (`vvH`/`vvTop`), l'écart entre les deux (`gap`, ce que la 8e tentative
  essaie de combler), la position réelle du bas de la barre (`barBottom`), le `transform`/
  `position` CSS réellement appliqués à `.sfTabbar`, et `scrollY`. Objectif : au prochain
  décrochage, une capture d'écran de cet encart donne les VRAIES valeurs au moment exact du bug —
  permet de savoir laquelle des 9 théories déjà tentées était juste (ou pas) au lieu de continuer
  à empiler des correctifs sur des hypothèses non vérifiées. 357 tests + lint + build vérifiés
  (1 erreur lint introduite puis corrigée : `setState` dans un `useEffect` plutôt qu'un
  initialiseur `useState` paresseux, même pattern déjà utilisé ailleurs dans l'app). Honnêteté :
  cet ajout ne corrige rien en soi, c'est un outil de diagnostic — la vraie correction dépendra de
  ce que montrera la prochaine capture d'écran de l'utilisateur.

- ✅ Écran blanc "rien dessus" signalé par l'utilisateur (12/09, Opera desktop, juste après avoir
  ouvert le lien `?navdebug=1`) — reproduit EN DIRECT dans le navigateur intégré en testant ce
  même lien juste après plusieurs déploiements rapprochés : console montrant "Failed to load
  module script... MIME type text/html" — le bundle JS d'entrée référencé par le `index.html` en
  cache n'existait plus sur le serveur (purgé par un déploiement plus récent), et la réponse
  reçue à la place était l'`index.html` lui-même (repli SPA de Vercel sur un chemin inconnu),
  d'où le mauvais type MIME. Confirmé root cause : après avoir vidé le service worker + les
  caches Workbox (`html-navigations` notamment) à la main, la page se remettait à charger
  normalement. Contexte : `vite.config.js` a DÉJÀ une protection dédiée à cette classe de bug
  (NetworkFirst 3s sur les navigations + `cleanupOutdatedCaches`, voir son historique 04/09) —
  mais elle suppose que la requête réseau du HTML aboutit OU échoue franchement (vraiment hors
  ligne). Trou non couvert jusqu'ici : le réseau qui échoue À TEMPS (3s dépassées, ex. VPN/
  bloqueur intégré d'Opera ajoutant de la latence) fait retomber sur le HTML encore en cache —
  qui peut référencer un bundle déjà purgé entre-temps par `cleanupOutdatedCaches` (justement
  censé éviter ce genre de résidu). Plus grave : le filet anti-écran-blanc déjà en place
  (`main.jsx`, `showBootError`) ne peut RIEN faire ici — il vit DANS le module d'entrée
  (`src/main.jsx`) lui-même ; si CE module échoue à charger, aucun JS de l'app ne tourne jamais
  pour afficher quoi que ce soit, y compris ce filet. Corrigé (`index.html`) : ajout d'un script
  classique (PAS un module — donc toujours exécuté même si le `<script type="module">` suivant
  échoue) qui écoute les erreurs de chargement de ressource en phase de CAPTURE sur `window`
  (les erreurs de ressource ne remontent pas en bulles) ; sur une erreur de script, purge le
  service worker + tous les caches puis recharge une seule fois (garde `sessionStorage` anti-
  boucle, effacé dès que `main.jsx` s'exécute avec succès — voir son tout début — pour ne pas
  rester bloqué "déjà tenté" après un incident réseau ponctuel résolu). Complémentaire à la
  protection NetworkFirst existante, pas un remplacement : celle-ci réduit la fréquence du
  problème, celle-là est le vrai filet de dernier recours quand il se produit quand même. 357
  tests + lint + build vérifiés inchangés (fichier HTML + petit ajout `main.jsx`, aucune logique
  React touchée). Honnêteté : je n'ai pas pu confirmer que c'est EXACTEMENT ce qui s'est passé
  sur l'Opera de l'utilisateur (pas de logs de sa session) — mais j'ai reproduit un vrai
  mécanisme identique en conditions réelles (pas une hypothèse théorique), avec le même symptôme
  exact ("écran blanc, rien dessus") et la même erreur console précise.

- ✅ ROOT CAUSE TROUVÉE ET CONFIRMÉE pour la barre du bas décollée (12/09, 10e signalement — mais
  cette fois avec une VRAIE capture d'écran de `NavDebugHUD.jsx` au moment exact du décrochage,
  pas une théorie) : `gap:335`, `innerH:509` sur la capture — une hauteur de layout ~509px est
  bien trop petite pour un écran de téléphone plein écran (donc `visualViewport.height` calculé
  au même instant était lui aussi faussé, ~174px déduit). Cette mesure a clairement été prise
  pendant une fenêtre où le navigateur n'avait pas encore les vraies dimensions (juste après un
  retour d'arrière-plan). Le vrai coupable : la 8e tentative elle-même (`App.jsx`, sync
  `visualViewport`, 11/09) — censée corriger un petit "bandeau noir" de quelques pixels sous la
  barre, elle n'avait AUCUN garde-fou contre une mesure aberrante, et a donc appliqué
  `transform: translateY(-335px)` au pied de la lettre — arrachant littéralement la barre de
  335px vers le haut, en plein milieu de la liste de matchs. C'est EXACTEMENT le symptôme "barre
  en plein milieu de la page" déjà rapporté plusieurs fois (dont le 6e signalement) : la 8e
  tentative, une correction censée AIDER, était en réalité elle-même la cause du symptôme le
  plus visible et le plus rapporté de toute cette série. Corrigé (`App.jsx`) : la correction
  `translateY` n'est appliquée que si l'écart mesuré est PLAUSIBLE pour une vraie barre d'outils
  mobile (`MAX_PLAUSIBLE_GAP = 60px`, marge large) — une valeur aberrante comme 335px est ignorée
  et le `transform` est explicitement nettoyé (`''`) plutôt que laissé tel quel, pour ne jamais
  rester bloqué sur une correction déjà appliquée à tort. 357 tests + lint + build vérifiés
  inchangés. C'est la première fois dans cette série de 10 tentatives qu'une cause est confirmée
  par une MESURE RÉELLE capturée au bon moment plutôt que déduite par audit de code ou théorie —
  directement rendu possible par l'outil de diagnostic ajouté juste avant (constat utilisateur
  après la 9e tentative : "faudrait savoir en fait"). À confirmer par l'utilisateur sur un
  nouveau cycle arrière-plan/premier-plan après ce déploiement.

- ✅ Compensation `translateY` retirée ENTIÈREMENT, 11e round, même bug (12/09, retour utilisateur
  immédiat après le clamp `MAX_PLAUSIBLE_GAP` ci-dessus : "ok mais faut pas qui bouge d'un pixel
  tu vois faut vraiment qu'il soit fixe quoi") — exigence explicite et sans ambiguïté : AUCUN
  mouvement, même petit et "plausible" (le clamp limitait les dégâts à 60px max, mais tout gap
  mesuré entre 0.5 et 60px continuait de déplacer réellement la barre). Décision : l'effet de
  synchronisation `visualViewport` de la 8e tentative (`App.jsx`, celui qui a directement causé
  le bug du point précédent) est retiré en entier, pas juste re-clampé plus fort — tant que ce
  code existe, une compensation par transform reste possible et donc un mouvement reste possible.
  La barre repose maintenant entièrement sur `position: fixed; bottom: 0` NATIF (aucun JS
  n'applique plus jamais de `transform` dessus) + le filet de réparation existant pour le vrai
  déclencheur connu (retour d'arrière-plan, watchdog `onResume`, 7e/9e tentatives) — ce filet ne
  pose lui non plus aucun transform permanent, il force un reflow (toggle `display`/`position`,
  toujours remis à l'état d'origine) puis laisse WebKit recalculer nativement. 357 tests + lint
  (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés. Honnêteté : le "bandeau noir
  sous la barre" qui avait motivé la 8e tentative (11/09) n'a jamais été confirmé par une mesure
  réelle (contrairement au bug qu'elle a ensuite elle-même causé, lui bien confirmé) — si ce
  symptôme précis revient, il faudra un mécanisme borné dans le temps (actif seulement pendant
  l'animation de la barre d'adresse) plutôt qu'un transform permanent comme celui qu'on vient de
  retirer. Toujours aucun accès à un vrai iPhone/PWA depuis cet environnement — à confirmer par
  l'utilisateur que la barre ne bouge plus du tout, y compris sur un cycle arrière-plan/premier-
  plan.

- ✅ Outil de diagnostic `NavDebugHUD` retiré (12/09, demande explicite : "enleve le truc
  maintenant en haut a gauche la pour le debug d la navbar") — sa mission est terminée : il a
  servi à obtenir la preuve réelle (`gap:335`/`innerH:509`) qui a permis de trouver puis
  d'éliminer entièrement la cause du décrochage (voir les 2 points ci-dessus). Retiré : le
  composant `src/components/NavDebugHUD.jsx` (fichier supprimé), son montage dans `App.jsx`
  (`<NavDebugHUD />` + import), et le geste de 5 taps sur le logo dans `navbar.jsx`
  (`handleBrandTap`/`brandTapCount`/`brandTapTimer`, plus aucun listener n'écoutant l'événement
  `navdebug:toggle` qu'il émettait) — nettoyage complet plutôt qu'un simple masquage, pour ne pas
  laisser du code mort. Le tap sur le logo redevient un lien de navigation simple vers l'Accueil,
  comportement inchangé sinon. 357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé)
  + build vérifiés.

- ✅ "Forme récente" fausse pour un club jouant dans ≥2 compétitions le même
  jour sur l'Accueil (constat utilisateur, 12/09 : "le real madrid a joué
  quatre match déjà et la sur la card dans accueil ya que un losange vert
  [...] alors que lorsque l'on va dans livematchpage [...] y'a bien quatre
  losange [...] ça le fait pas à toutes les équipes") — bug DIFFÉRENT du bug
  Aston Villa (celui-là était un résidu de cache figé, voir plus haut) : root
  cause confirmée EN DIRECT sur la prod (navigateur intégré, lecture des
  props réelles via fiber React sur la carte Real Madrid-Rayo, Liga) dans
  `useTeamFormMulti` (`useTeamForm.js`) — le `formMap` fusionné toutes
  compétitions confondues faisait `Object.assign(formMap, ...)` PAR CODE DE
  COMPÉTITION, dans l'ordre de `codes` : pour un club jouant dans 2
  compétitions affichées le même jour sur l'Accueil (Real Madrid : Liga `PD`
  ET Ligue des Champions `CL`), le formMap de la compétition traitée EN
  DERNIER (ici `CL`, tout début de phase de ligue, 1 seul résultat) ÉCRASAIT
  intégralement celui de la compétition traitée avant (`PD`, Liga+Copa del
  Rey fusionnées, 4 résultats) — quelle que soit la compétition du match
  réellement affiché sur la carte. Vérifié : `accueilFormMapForHome` valait
  `['W']` alors que `matchesByComp.PD` contenait bien 45 matchs Liga. N'af-
  fecte QUE les clubs dans ≥2 compétitions affichées simultanément (explique
  "ça le fait pas à toutes les équipes" — un club dans une seule compétition
  n'a jamais de collision d'id, donc jamais d'écrasement). MatchPage/
  LiveMatchPage n'ont jamais ce bug : ils appellent `useTeamForm(compCode)`
  pour UNE SEULE compétition à la fois (jamais de fusion). Corrigé
  (`useTeamForm.js`) : nouveau champ `formMapByComp` retourné par
  `useTeamFormMulti` — le formMap de CHAQUE compétition exposé séparément,
  jamais fusionné entre elles (au lieu de tenter une fusion "intelligente"
  des tableaux, qui n'aurait pas de sens sportif clair entre forme Liga et
  forme C1 d'un même club, et risquerait de réintroduire le bug Deportivo du
  16/08 sur le repli saison précédente). `Accueil.jsx`/`MatchCard.jsx`/
  `Pronos.jsx` piochent désormais `formMapByComp[match.competition.code]`
  pour choisir la forme d'un match précis — demande explicite de
  l'utilisateur ("faut lié les deux [...] que dans accueil les card herite
  des donnee [...] de matchpage ou livematchpage") : la carte Accueil affiche
  maintenant EXACTEMENT la même donnée que MatchPage/LiveMatchPage pour ce
  même match, par construction (même fonction `fetchTeamForm`, même queryKey
  React Query, même cache). Ce bug touchait aussi `Pronos.jsx` (même
  `matchProno()` utilisait le formMap fusionné) — donc potentiellement le %
  de pronostic affiché, pas seulement l'affichage visuel des losanges,
  corrigé au même endroit. `formMap` (fusionné) reste exporté par
  `useTeamFormMulti` pour compat mais n'est plus consommé par aucun
  appelant. 357 tests + lint (33 erreurs pré-existantes, Pronos.jsx,
  inchangé) + build vérifiés. Honnêteté : pas de test automatisé dédié
  ajouté pour ce fix précis (la collision nécessite un vrai mock React Query
  multi-compétitions, jugé disproportionné vs. la vérification déjà faite en
  direct sur la prod avec de vraies données) — à reconfirmer par
  l'utilisateur sur la carte Real Madrid après déploiement.

- ✅ Minute du match en rouge sur Serie A (LiveMatchPage), demandée en blanc
  (12/09, demande explicite : "pour la serie a dans livematchpage met la
  minute du match ne blanc plutot que rouge") — en fait une RÉGRESSION du
  passage en mode peinture de Serie A le même jour (voir plus haut) : Serie A
  avait déjà `tintLight: true` avant ce passage (demande du 06/09, "Terminé"
  en blanc pour Ligue 1/Premier League/Serie A) mais le switch vers
  `tintTheme: 'sa'` a remplacé TOUS les anciens champs (`tint`/`tintLight`/
  `tint2`/`tint3`/`tintSoft`/`tintStops`/`tintPearl`) sans reprendre
  `tintLight` — contrairement à Premier League, passée en mode peinture le
  même jour mais où `tintLight: true` avait bien été explicitement ajouté à
  côté de `tintTheme: 'pl'`. Remis (`competitions.js`, `SA.tintLight = true`)
  — `tintTheme` et `tintLight` sont deux classes CSS indépendantes appliquées
  ensemble sur le hero (`LiveMatchPage.jsx`/`MatchPage.jsx`/`MatchPoster.jsx`),
  aucun conflit entre les deux. Effet de bord assumé et cohérent, comme pour
  Premier League à l'époque : le "Terminé" repasse aussi en blanc, et l'effet
  s'applique aussi à MatchPage et aux cards Accueil (même flag partagé), pas
  seulement LiveMatchPage — cohérent avec la demande initiale du 06/09.
  357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build
  vérifiés inchangés (changement de données + commentaire uniquement).

- 🔍 Barre du bas ENCORE décollée, 12e signalement (constat utilisateur, 12/09, juste après le
  retrait complet de la compensation `transform` du 11e round : "j'ai encore eu le bug de la
  navbar du bas décollé"). Question posée directement pour la première fois sur CE point précis
  ("à quoi ça ressemble visuellement cette fois ?") — réponse : "c comme si elle se décolle e
  après quand je scroll vers le bas elle monte et inversement" — c'est-à-dire que la barre SUIT
  le sens du scroll (monte quand on scroll vers le bas, descend quand on scroll vers le haut),
  exactement comme le ferait un élément normal du flux de page (le contenu remonte à l'écran
  quand on scroll vers le bas). Description DIFFÉRENTE de tous les signalements précédents
  ("barre au milieu de la page", "bandeau noir sous la barre") — c'est la signature du bug
  WebKit/iOS Safari le plus ancien et le mieux documenté sur les éléments `position: fixed` :
  sans couche de compositing dédiée, un élément fixed peut visiblement "glisser" avec le contenu
  pendant le geste de scroll (le navigateur n'arrive pas à le repeindre indépendamment du reste
  de la page assez vite), avant de se re-caler une fois le scroll arrêté. Le correctif standard
  pour CE bug précis (promotion sur une couche GPU dédiée, `transform`/`will-change`) est
  justement ce qui avait été retiré le 11/09 (7e tentative) sur la base d'une AUTRE théorie
  jamais confirmée (désync de peinture après retour d'arrière-plan) — cette théorie n'ayant
  jamais eu de preuve directe, il est plausible que son retrait ait réintroduit ce bug plus
  ancien et mieux documenté. Corrigé (`navbar.css`) : `will-change: transform` remis sur
  `.sfTabbar`, SEUL — sans `transform: translateZ(0)` littéral comme avant le 11/09 — pour
  demander à WebKit une couche de compositing dédiée sans jamais poser de valeur de transform
  réelle qui pourrait rester "figée" (l'hypothèse du 11/09). Le filet de sécurité retour
  arrière-plan (`App.jsx`, `repair()` via toggle `display:none`) reste actif en complément,
  indépendant de cette couche. 357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé)
  + build vérifiés inchangés. Honnêteté : toujours aucun accès à un vrai iPhone/PWA depuis cet
  environnement pour reproduire ou confirmer — mais c'est la première fois en 12 signalements
  qu'une description visuelle précise ("suit le sens du scroll") pointe sans ambiguïté vers un
  mécanisme WebKit spécifique et documenté plutôt qu'une hypothèse générique parmi plusieurs
  possibles ; si le symptôme persiste malgré ce remous en arrière, ce sera un signal fort que ce
  n'est PAS (ou plus) un problème de couche de compositing, et qu'il faudra chercher ailleurs
  (ex. un vrai conteneur de scroll créé quelque part, cf. le fix `overflow-x: clip` du 05/09 pour
  l'axe horizontal — jamais vérifié pour un équivalent vertical). À confirmer par l'utilisateur
  sur son téléphone après déploiement.

- ✅ Effet flou retiré de TOUTES les cards "mode peinture" (constat utilisateur, 12/09 : "ce qui
  me deplai c l'effet flou [...] entre le sombre et le blanc la c flou j'aime pas" — précisé via
  question directe : concerne bien TOUTES les compétitions en mode peinture, pas une en
  particulier, et la direction demandée est "zones nettes, pas de flou du tout" plutôt qu'un
  flou réduit ou un retrait du blanc). Chaque thème (`ucl`/`nl`/`fl1`/`pl`/`wc`/`uel`/`uecl`/
  `pd`/`bl1`/`sa`/`can`) empile plusieurs `radial-gradient` (taches de couleur, chacune avec son
  propre fondu `transparent` intégré au gradient) puis applique un `filter: blur(20-22px)
  saturate(1.3-1.4)` PAR-DESSUS tout le calque — c'est ce filtre qui donnait l'aspect "laiteux"/
  flou aux transitions entre zones sombres et blanches que l'utilisateur n'aimait pas. Retiré
  (`blur(Npx)` seul, `saturate` conservé pour la vivacité des couleurs) dans `accueil.css` (cards
  Accueil/Résultats, 10 règles `.poster--theme-*`) ET `LiveMatchPage.css` (hero MatchPage +
  LiveMatchPage, partagé par les 2 pages — voir `MatchPage.jsx` qui importe ce fichier et réutilise
  les mêmes classes `.lmp__hero--theme-*`, 10 règles). Chaque `radial-gradient` a déjà son propre
  fondu vers `transparent` dans ses stops (`0% couleur → 55-60% transparent`) : sans le filtre
  `blur()` par-dessus, les zones restent des taches à bords nets mais pas des cercles durs
  agressifs — exactement la demande "zones nettes, pas de flou". Vérifié que `filter: blur(60px)`
  sur `.accueil__backdrop` (halo décoratif de fond de page, sans lien avec les cards) et les 2
  `backdrop-filter: blur(6px)` (verre dépoli d'un autre composant) n'ont pas été touchés — seuls
  les 20 `filter: blur(Npx) saturate(...)` des règles `--theme-*` l'ont été. `inset: -20px` sur
  les calques (posé à l'origine pour éviter qu'un bord flouté "voie" du vide et s'assombrisse)
  laissé inchangé : inoffensif sans blur, aucun artefact de bord introduit par sa présence.
  357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés
  (changement CSS uniquement, aucune logique touchée). Honnêteté : rendu jamais vu en direct sur
  un vrai appareil avant ce déploiement (juste la lecture du CSS résultant) — à confirmer par
  l'utilisateur que le rendu "net" lui plaît davantage que l'ancien flou, pas juste différent.

- ✅ Points blancs retirés des cards "mode peinture" NL/FL1/PL/BL1/SA (constat utilisateur, 12/09,
  juste après le retrait du flou ci-dessus : "y'a toujours le flou mais bon et enlève moi tout
  ces points blancs la c une horreur"). Sur le flou résiduel : honnêteté d'abord, le retrait du
  `filter: blur()` (point précédent) enlève le flou ajouté PAR-DESSUS le calque, mais chaque
  `radial-gradient` a lui-même un fondu progressif intégré vers `transparent` (`0% couleur → 55-
  60% transparent`) — cette dégradation propre au gradient donne encore un aspect doux/vaporeux
  aux bords, distinct du `blur()` déjà retiré. Pas retouché ici (l'utilisateur a dit "mais bon",
  pas demandé de correction) — si le rendu doit vraiment devenir dur/net, il faudrait resserrer
  ces stops (ex. ajouter un palier de couleur pleine avant le fondu) en plus, à faire si demandé.
  Sur les points blancs (la demande ferme cette fois) : retiré tous les `radial-gradient` blancs
  (`#ffffff` / `rgba(255,255,255,...)`) des 5 thèmes qui en avaient — NL (1), FL1 (2), PL (2),
  BL1 (5), SA (1) — dans `accueil.css` ET `LiveMatchPage.css` (mêmes lignes, mêmes thèmes, les 2
  fichiers gardés identiques comme toujours). WC/UEL/UECL/PD/CAN n'en avaient aucun (inchangés).
  Le mécanisme de "voile nacré" séparé de la Ligue des Champions (`.poster--theme-ucl
  .poster__bg--gradientTri`, halos blancs très larges et peu opaques en `mix-blend-mode: screen`,
  PAS des points, un ancien mécanisme différent de la recette mode-peinture) volontairement laissé
  intact — jamais mentionné dans les retours de l'utilisateur sur ce sujet, mécanisme visuel
  différent (sheen ambiant vs points solides), pas touché pour ne rien casser sans demande.
  Bilan par thème après retrait : NL et SA restent multicolores (bleu/rouge/vert/or pour NL,
  bleu/vert/teal pour SA) — aucun risque de rendu fade. FL1 et PL passent à 6 taches de couleur
  chacun (plus de blanc du tout, conforme à la demande). Point d'honnêteté à surveiller : BL1
  n'avait plus que du rouge en dehors de ses 5 taches blanches (voir historique du jour) — les
  retirer laisse Bundesliga avec 7 taches, toutes rouges (une seule couleur), le même symptôme
  "y'a qu'une couleur c'est fade" qui avait initialement motivé le passage en mode peinture de
  Ligue 1/Premier League — pas corrigé ici puisque non demandé, mais probable prochain retour si
  le rendu Bundesliga semble monochrome à l'usage. 357 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés inchangés (CSS uniquement).

- ✅ Noir retiré du mode peinture LaLiga (13/09, question utilisateur : "regarde le jaune et le
  rouge et tout paraissent flou c le noir qui fait ça ? sinon on enlève le noir hein") — LaLiga
  (`tintTheme: 'pd'`) est le seul thème correspondant exactement à "le jaune et le rouge" (rouge
  `#b3242b`/`#c22d34`/`#7a1a1f` + or `#e0b040`/`#f0c766`/`#c9932e`, palette de marque) ET au
  gabarit à 5 taches noires partagé avec UEL/UECL. Réponse à la question posée : oui, plausible —
  chaque tache a son propre fondu vers `transparent` sur une bonne partie de son rayon (`0% →
  55-60% transparent`) ; là où une tache NOIRE et une tache rouge/or se chevauchent dans leur
  zone de fondu, le mélange traverse des teintes grises/brunes intermédiaires avant d'atteindre
  la couleur pleine — un effet de transition trouble différent du `filter: blur()` déjà retiré
  (points précédents), mais qui peut se lire visuellement comme "flou" du même œil. Pas une
  certitude absolue (pas de mesure de contraste faite, juste un raisonnement sur le mécanisme des
  dégradés) mais une explication technique cohérente avec ce qui est observé. Corrigé comme
  demandé ("sinon on enlève le noir") : les 5 taches `#000000` de `.poster--theme-pd`
  (`accueil.css`) et `.lmp__hero--theme-pd` (`LiveMatchPage.css`, gardé identique comme toujours)
  remplacées par des nuances déjà présentes dans la palette LaLiga (or/rouge alternés :
  `#e0b040`/`#b3242b`/`#c9932e`/`#7a1a1f`/`#f0c766`) plutôt que par de nouvelles couleurs —
  répartition équilibrée après ce changement : 6 taches rouge / 6 taches or, aucune noire. Même
  principe déjà appliqué à la Bundesliga plus tôt (retrait du noir, voir plus haut). UEL/UECL
  (même gabarit à 5 taches noires, mais couleurs orange/vert — pas "jaune et rouge") volontairement
  NON touchés : la question portait précisément sur cette combinaison de couleurs, pas sur le
  gabarit en général — si le même effet de flou perçu se retrouve sur UEL/UECL, ce sera à
  confirmer séparément plutôt que supposé. 357 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés inchangés (CSS uniquement).

- ✅ Refonte complète de LaLiga/Ligue 1/Premier League/Bundesliga, abandon du "mode peinture"
  pour ces 4 compétitions (13/09, demande explicite et sans ambiguïté : "on va reprendre de zéro
  [...] pour la liga tu met jaune rouge en dégradé proprement et couleur bien vive bien présente
  pareil pour la ligue 1 que du bleu avec une légère touche de blanc qui vient apporter un effet
  brillant et premiere league violet clair et blanc pareil et la bundesliga rouge avec du blanc
  en dégradé avec plus de rouge que de blanc") — après plusieurs allers-retours ratés sur le
  "mode peinture" (taches radiales floutées : flou jugé désagréable, points blancs "une horreur",
  noir donnant un aspect trouble sur LaLiga, voir les 3 points juste au-dessus), demande de
  repartir sur un principe entièrement différent : un DÉGRADÉ LINÉAIRE propre à 2 couleurs par
  compétition plutôt qu'un empilement de taches radiales. Remplacé entièrement (`accueil.css` ET
  `LiveMatchPage.css`, mêmes 2 fichiers gardés identiques comme toujours) :
  - LaLiga (`.poster--theme-pd`) : `linear-gradient(135deg, #e0b040 0-32%, #b3242b 52-100%)` —
    or et rouge de marque, chacun en PALIER (zone à 100% de la couleur, pas juste un point de
    départ) avant une transition courte (32-52%) plutôt qu'un dégradé étalé sur toute la carte —
    c'est ce qui rend les 2 couleurs "bien vives, bien présentes" plutôt que diluées.
  - Ligue 1 (`.poster--theme-fl1`) : `linear-gradient(135deg, #4d94ff 0%, #085dfe 45%, #04225c
    100%)` — bleu SEUL (3 nuances de la même couleur pour le relief, aucune 2e couleur de marque)
    + un calque séparé, discret, `radial-gradient(rgba(255,255,255,0.24)...)` posé en HAUT à
    gauche pour la "légère touche de blanc qui apporte un effet brillant" demandée — un reflet
    léger, pas une zone blanche pleine comme avant.
  - Premier League (`.poster--theme-pl`) : `linear-gradient(135deg, #ffffff 0-18%, #b565c4 42%,
    #8a1d92 68-100%)` — blanc en palier au coin (donnant le "clair" demandé) qui bascule vers un
    violet clair intermédiaire (`#b565c4`, nouvelle nuance, pas dans la palette validée jusqu'ici
    — choisie pour la transition, pas mesurée sur un logo officiel) puis le violet de marque
    `#8a1d92` en palier. Honnêteté : "violet clair" a été interprété comme la présence de blanc +
    une nuance de violet plus claire que le violet de marque sombre déjà utilisé, pas un violet
    de marque alternatif vérifié.
  - Bundesliga (`.poster--theme-bl1`) : `linear-gradient(135deg, #8a0410 0%, #e30613 38-76%,
    #ffffff 100%)` — rouge (sombre puis vif) en palier sur 76% du dégradé, blanc seulement sur
    les derniers 24% ("plus de rouge que de blanc" demandé). Point d'honnêteté important, déjà
    documenté une fois dans ce fichier (voir plus haut, "rosé délavé") : un dégradé LINÉAIRE
    continu rouge→blanc traverse nécessairement une zone rose/saumon dans sa transition — c'est
    justement le mécanisme qui avait donné un résultat jugé raté sur cette même compétition il y
    a plusieurs semaines. Le risque n'est PAS éliminé ici (contrairement aux taches radiales
    discrètes qui l'avaient contourné), seulement réduit en resserrant la transition à une plage
    courte (38-76% pleinement rouge, transition uniquement sur les 24% final) plutôt qu'un dégradé
    continu sur 100% de la carte — la zone rose existe toujours mais occupe une portion plus
    réduite et plus proche du bord. Demande explicite de l'utilisateur malgré cet historique connu
    (le risque lui avait été signalé dans une réponse précédente) — à vérifier à l'usage, pas de
    garantie que ce soit suffisant.
  `filter: saturate(...)` retiré des 4 (n'avait plus de sens sur un dégradé linéaire aux couleurs
  déjà pleines, contrairement aux taches radiales qui en avaient besoin après le flou). `inset:
  -20px` (marge anti-bord-sombre du flou) repassé à `inset: 0` pour les 4 (plus besoin sans flou,
  et un dégradé à 135deg calé sur la vraie boîte de l'élément est plus prévisible qu'un dégradé
  calé sur une boîte élargie de 20px). Fond de repli `#root .lmp__hero--theme-pd/-bl1/-fl1/-pl`
  (utilisé si le calque `.lmp__heroTintC` ne couvre pas 100% de la zone, filet de sécurité déjà en
  place) mis à jour vers une couleur de la nouvelle palette de chaque thème (au lieu de l'ancien
  quasi-noir `#141414`/`#050b22`/`#1a0016`, qui aurait juré avec le nouveau rendu). `TINT_THEME_
  CAMP_COLORS` (carte "Match du jour") non touché : toutes les couleurs de marque utilisées restent
  les mêmes hex, seule leur composition change. UEL/UECL/SA/NL/WC/CAN/UCL non touchés (pas
  mentionnés dans la demande, gardent leur mode peinture à taches radiales). 357 tests + lint
  (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés (CSS uniquement).

- ✅ Ajustement du dégradé LaLiga juste redessiné (13/09, demande explicite : "pour la liga
  rajoute du noir stp en haut a gauche et le jaune t'en met seulement en bas a droite et du jaune
  un peu plus fonc") — itération sur `.poster--theme-pd` (`accueil.css`) et
  `.lmp__hero--theme-pd .lmp__heroTintC` (`LiveMatchPage.css`, gardé identique comme toujours),
  qui venait tout juste d'être réécrit en dégradé linéaire à 2 couleurs (or→rouge, voir le point
  juste au-dessus). Reversal assumé du retrait du noir demandé plus tôt dans la journée sur ce
  même thème (voir "Noir retiré du mode peinture LaLiga" plus haut) — l'utilisateur redemande
  explicitement du noir, cette fois positionné, pas en taches réparties. Le dégradé passe de 2 à
  3 couleurs en paliers : `linear-gradient(135deg, #000000 0-20%, #b3242b 40-72%, #c9932e 100%)`
  — noir en palier plein dans le coin haut-gauche (0-20%, direction 135deg part bien du coin
  haut-gauche), rouge de marque au milieu (40-72%, toujours bien présent), or SEULEMENT dans le
  dernier palier proche du coin bas-droite (100%, transition 72-100% uniquement) — plus aucune
  zone or en dehors de ce coin, conforme à "seulement en bas à droite". Jaune assombri : `#e0b040`
  → `#c9932e` (déjà présent dans l'historique de palette LaLiga de ce fichier, un ton plus foncé/
  cuivré que l'or clair précédent) plutôt qu'une nouvelle teinte inventée. 357 tests + lint
  (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés (CSS uniquement).

- ✅ 3 ajustements groupés le même jour (13/09, demande explicite unique : "pour la premiere
  league inverse les couleur et le violet met que du violet clair rosé stp et la bundesliga
  rajoute du blanc en haut a gauche aussi et la serie a enlève le noir") :
  - Premier League (`.poster--theme-pl` / `.lmp__hero--theme-pl .lmp__heroTintC`) : le violet de
    marque foncé (`#8a1d92`/`#37003c`, présent depuis le passage en mode peinture du 12/09) est
    entièrement retiré du dégradé — remplacé par une seule teinte de violet clair rosé
    (`#da70d6`, orchidée) demandée explicitement ("que du violet clair rosé"), plus aucune nuance
    sombre. Ordre inversé comme demandé : `linear-gradient(135deg, #da70d6 0-32%, #ffffff
    62-100%)` — le violet est maintenant au coin haut-gauche (135deg part de ce coin), le blanc
    au coin bas-droite (c'était l'inverse juste avant, voir "Refonte complète..." plus haut).
    `TINT_THEME_CAMP_COLORS.pl` (`competitions.js`) mis à jour (`['#da70d6', '#ffffff']`, ancien
    violet foncé retiré, plus aucune référence à une couleur absente du dégradé). Fond de repli
    `#root .lmp__hero--theme-pl` passé de `#8a1d92` à `#da70d6`, cohérent avec la nouvelle
    palette. Honnêteté : `#da70d6` (orchidée) est un choix de teinte "clair rosé" cohérent avec la
    demande, pas une couleur de marque Premier League officielle vérifiée à la source (aucune ne
    l'est dans cette teinte précise).
  - Bundesliga (`.poster--theme-bl1` / `.lmp__hero--theme-bl1 .lmp__heroTintC`) : ajout d'un
    calque `radial-gradient` discret de blanc semi-transparent (`rgba(255,255,255,0.22)`) au coin
    haut-gauche (15% 15%, fondu à 60%), PAR-DESSUS le dégradé linéaire rouge→blanc déjà existant
    (inchangé) — "aussi" dans la demande interprété comme additif : le blanc du dégradé principal
    (coin bas-droite, "plus de rouge que de blanc") reste en place, ce nouveau calque ajoute
    seulement une touche de blanc en plus au coin opposé, même mécanisme déjà utilisé pour la
    "légère touche de blanc qui apporte un effet brillant" de Ligue 1 (voir "Refonte complète..."
    plus haut) — cohérence de méthode entre les 2 thèmes.
  - Serie A (`.poster--theme-sa` / `.lmp__hero--theme-sa .lmp__heroTintC`) : Serie A n'avait en
    réalité JAMAIS de `#000000` littéral (contrairement à PD/BL1/UEL/UECL) — son fond de repli
    (`#071620`) et une de ses 7 taches radiales (`#073b4c`, coin haut-droite) sont des bleu-marine
    TRÈS sombres, visuellement quasi indiscernables du noir à l'œil, la cause la plus probable de
    la perception "il y a du noir" de l'utilisateur. Éclaircis vers un bleu-marine clairement
    identifiable comme bleu : fond de repli `#071620` → `#0b3a4d`, tache `#073b4c` → `#0d5a73` —
    les 6 autres couleurs (bleus/verts/teal déjà validés) inchangées, palette "bleu vert et blanc"
    toujours respectée. Honnêteté : pas de certitude à 100% que c'était CES 2 couleurs précises
    qui donnaient l'impression de noir (aucune vraie valeur `#000000`/quasi-noir `#0a0a0a` n'existe
    dans ce thème, contrairement aux autres où retirer "le noir" visait une couleur littéralement
    noire) — c'est l'interprétation la plus probable vu qu'aucun autre candidat plus sombre
    n'existe dans ce thème. 357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) +
    build vérifiés inchangés pour les 3 changements (CSS + `competitions.js`, aucune logique
    touchée).

- ✅ Rééquilibrage blanc Bundesliga/Premier League, même jour (13/09, demande explicite : "met +
  de blanc dans bundesliga et moins de blanc dans premiere league stp") — ajustement direct des 2
  thèmes juste retouchés au point précédent :
  - Bundesliga (`.poster--theme-bl1` / `.lmp__hero--theme-bl1 .lmp__heroTintC`) : la touche de
    blanc haut-gauche ajoutée juste avant est agrandie et renforcée (`45% 40%` → `58% 52%`,
    opacité `0.22` → `0.36`, fondu repoussé `60%` → `62%`) ET le palier rouge du dégradé principal
    raccourci (`#e30613` tenait jusqu'à 76% → maintenant 64%), laissant la transition vers le
    blanc du coin bas-droite commencer plus tôt — plus de surface blanche au total sans faire
    disparaître le rouge, qui reste dominant sur l'essentiel de la carte (0-64%).
  - Premier League (`.poster--theme-pl` / `.lmp__hero--theme-pl .lmp__heroTintC`) : effet inverse
    — le palier violet clair rosé (`#da70d6`) est allongé (32% → 58%) et le blanc repoussé plus
    loin dans le dégradé (`62-100%` → `84-100%`), réduisant sa zone de ~38% à ~16% du dégradé.
    `TINT_THEME_CAMP_COLORS`/fonds de repli non touchés (mêmes couleurs, seules leurs PROPORTIONS
    dans le dégradé changent) — aucune modification nécessaire. 357 tests + lint (33 erreurs
    pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés (CSS uniquement).

- ✅ Violet Premier League assombri, même jour (13/09, demande explicite : "pour la premiere
  league met un violet + foncé") — `.poster--theme-pl` (`accueil.css`) et `.lmp__hero--theme-pl
  .lmp__heroTintC` (`LiveMatchPage.css`, gardé identique) : la teinte `#da70d6` (orchidée claire,
  choisie au point précédent pour "violet clair rosé") remplacée par `#9932cc` (orchidée foncée,
  couleur nommée CSS standard "darkorchid") — même position dans le dégradé (0-58%), même blanc
  (84-100%), seule la teinte change. Fond de repli `#root .lmp__hero--theme-pl` et `TINT_THEME_
  CAMP_COLORS.pl` (`competitions.js`) mis à jour en cohérence (`#da70d6` → `#9932cc`). 357 tests +
  lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés (CSS +
  `competitions.js`, aucune logique touchée).

- ✅ Violet Premier League re-assombri vers la couleur de marque, même jour (13/09, demande
  explicite juste après le point précédent : "encore + foncé comme la couleur du logo officielle
  tu vois") — `#9932cc` (darkorchid, couleur nommée CSS générique choisie au point précédent pour
  "un violet + foncé") remplacé par `#37003c` dans `.poster--theme-pl` (`accueil.css`) et
  `.lmp__hero--theme-pl .lmp__heroTintC` (`LiveMatchPage.css`, gardé identique) — même position
  dans le dégradé (0-58%), même blanc (84-100%). Honnêteté sur le choix : `#37003c` n'est pas
  une nouvelle mesure de pixel sur le logo officiel actuel (pas d'accès à une image du logo dans
  cet environnement pour ce faire), mais réutilise le violet de marque déjà établi et documenté
  dans ce même fichier AVANT le passage en mode peinture du 12/09 (ancien champ `tint2` de PL,
  qualifié à l'époque de "violet foncé de marque") — plus fiable qu'inventer une nouvelle teinte,
  cohérent avec la demande de coller à la vraie couleur du logo plutôt qu'un violet générique.
  Fond de repli `#root .lmp__hero--theme-pl` et `TINT_THEME_CAMP_COLORS.pl` (`competitions.js`)
  mis à jour en cohérence. 357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) +
  build vérifiés inchangés (CSS + `competitions.js`, aucune logique touchée).

- ✅ Transition violet→blanc PL lissée, même jour (13/09, retour utilisateur juste après le
  passage à `#37003c` : "le problème c que le dégradé est moche la car on passe d'un violet
  foncé au blanc ça fait une vrai coupure") — root cause : `#37003c` est un violet TRÈS sombre
  (proche du noir), passer directement de ce ton à blanc pur sur une seule zone de transition
  (58-84%) traverse un gris-mauve terne perçu comme une coupure nette plutôt qu'un fondu, le même
  type de problème déjà rencontré et documenté sur cette page pour d'autres combinaisons foncé↔
  clair (voir "rosé délavé" Bundesliga, "effet trouble" noir+or LaLiga). Corrigé
  (`.poster--theme-pl` dans `accueil.css` + `.lmp__hero--theme-pl .lmp__heroTintC` dans
  `LiveMatchPage.css`, gardé identique) : ajout d'une teinte violette intermédiaire, `#b565c4`
  (déjà utilisée et documentée comme "violet clair intermédiaire" dans une version précédente de
  ce thème, voir "Refonte complète..." plus haut — réutilisation d'une teinte déjà établie plutôt
  qu'une nouvelle invention) — le dégradé passe maintenant en 2 étapes progressives : `#37003c`
  (plateau 0-42%) → `#b565c4` (pont à 66%) → `#ffffff` (plateau 90-100%), au lieu d'un seul saut
  direct foncé→blanc. Chaque étape reste dans une gamme de violet cohérente (foncé → clair →
  blanc) plutôt qu'un aplat sombre suivi d'un blanc immédiat. `TINT_THEME_CAMP_COLORS.pl` non
  touché (toujours `['#37003c', '#ffffff']`, les 2 couleurs dominantes restent identiques, seule
  la transition entre elles est adoucie). 357 tests + lint (33 erreurs pré-existantes, Pronos.jsx,
  inchangé) + build vérifiés inchangés (CSS uniquement). Honnêteté : rendu jamais vu en direct
  avant ce déploiement (juste lecture du CSS) — à confirmer par l'utilisateur que la coupure a
  bien disparu, pas seulement déplacée.

- ✅ Dégradé Premier League restructuré en radial (violet dominant, blanc aux
  bords), même jour (13/09, demande explicite, en alternative au dégradé
  linéaire diagonal qui venait d'être lissé : "au pire met que du violet
  foncé et genre vers les bord autour tu met du blanc genre pour pas que ce
  soit que du violet") — changement structurel, pas juste une couleur :
  `.poster--theme-pl .poster__bg--gradient` (`accueil.css`) et
  `.lmp__hero--theme-pl .lmp__heroTintC` (`LiveMatchPage.css`, gardé
  identique comme toujours) passent d'un `linear-gradient(135deg, ...)`
  diagonal à un `radial-gradient(145% 145% at 50% 50%, ...)` centré : violet
  de marque `#37003c` en plateau plein sur 0-68% (donc sur l'essentiel du
  centre/de la surface de la carte, "que du violet foncé" comme demandé),
  pont `#b565c4` (déjà utilisé et documenté juste avant comme "violet clair
  intermédiaire", pas une nouvelle teinte) à 86%, blanc uniquement dans le
  dernier anneau 86-100% — donc repoussé vers les bords/coins extrêmes
  ("vers les bord autour") plutôt que dans un coin diagonal comme avant. Le
  pont violet-clair est conservé exprès pour ne pas réintroduire la même
  "coupure" nette violet foncé→blanc que l'utilisateur venait de signaler sur
  la version linéaire — juste appliqué en anneau vers l'extérieur plutôt
  qu'en diagonale. `145% 145%` (rayon plus grand que la boîte) garantit que
  même les coins (les points les plus excentrés d'un radial centré) restent
  bien couverts par le dégradé jusqu'au blanc, pas seulement les bords
  horizontaux/verticaux. Fond de repli `#root .lmp__hero--theme-pl` et
  `TINT_THEME_CAMP_COLORS.pl` (`competitions.js`) non touchés : toujours
  `#37003c`/`['#37003c', '#ffffff']`, les 2 couleurs dominantes du thème ne
  changent pas, seule leur disposition spatiale change (radial inversé au
  lieu de diagonale). 357 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés inchangés (CSS uniquement).
  Honnêteté : rendu jamais vu en direct sur un vrai appareil avant ce
  déploiement (juste lecture du CSS résultant) — un radial centré à 50% 50%
  donne un effet proche d'un halo/vignette inversée (violet au milieu, blanc
  aux 4 coins ET aux 4 bords à parts à peu près égales), pas un simple
  "liseré" fin uniquement sur le contour ; à confirmer que ce rendu correspond
  bien à l'intention de "vers les bord autour", sinon une variante avec un
  anneau blanc plus fin (transition resserrée, ex. 92-100% au lieu de
  86-100%) serait le prochain ajustement naturel.

- ✅ Transition noir→rouge LaLiga lissée, même jour (13/09, demande explicite : "pour la liga le
  degradé est pas terribl entre le noir et le rouge") — même famille de problème que la "coupure"
  déjà documentée et corrigée sur Premier League (voir point juste au-dessus) : le dégradé LaLiga
  passait directement d'un plateau noir plein (0-20%) à un plateau rouge plein (40-72%) sur une
  seule zone de transition, sans étape intermédiaire — traverse une teinte brune/rougeâtre trouble
  plutôt qu'un fondu propre. Corrigé (`.poster--theme-pd` dans `accueil.css` + `.lmp__hero--theme-
  pd .lmp__heroTintC` dans `LiveMatchPage.css`, gardé identique) : ajout d'un pont `#7a1a1f`
  (rouge très sombre déjà présent dans l'historique de palette LaLiga de ce fichier, réutilisé
  plutôt qu'inventé) à 30%, entre la fin du plateau noir (18%, légèrement raccourci) et le début
  du plateau rouge vif (42%, légèrement repoussé) — le dégradé passe maintenant en 2 étapes
  (noir → rouge sombre → rouge vif) au lieu d'un seul saut direct. Le palier or final (72-100%)
  non touché. `TINT_THEME_CAMP_COLORS`/fond de repli non touchés (couleurs dominantes inchangées,
  seule la transition entre elles est adoucie, même principe que le fix PL juste avant). 357 tests
  + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés (CSS
  uniquement). Honnêteté : rendu jamais vu en direct avant ce déploiement (juste lecture du CSS)
  — à confirmer par l'utilisateur que la coupure a bien disparu.

- ✅ Violet Premier League éclairci, même jour (13/09, demande explicite : "pour la premiere leagu
  le violet un peu moins foncé stp") — `#37003c` (violet très sombre, quasi noir, dominant du
  dégradé radial juste mis en place) remplacé par `#8a1d92` dans `.poster--theme-pl .poster__bg--
  gradient` (`accueil.css`) et `.lmp__hero--theme-pl .lmp__heroTintC` (`LiveMatchPage.css`, gardé
  identique) — même position dans le dégradé (plateau 0-68%), même pont `#b565c4` (86%) et même
  blanc (100%) aux bords, seule la teinte dominante change. Réutilisation d'une couleur déjà
  établie plutôt qu'une invention : `#8a1d92` est l'ancien `tint` de Premier League (violet de
  marque plus vif que `#37003c`, qui était son `tint2`), documenté dans ce même fichier avant le
  passage en mode peinture du 12/09. Fond de repli `#root .lmp__hero--theme-pl` et
  `TINT_THEME_CAMP_COLORS.pl` (`competitions.js`) mis à jour en cohérence (`#37003c` → `#8a1d92`).
  357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés
  (CSS + `competitions.js`, aucune logique touchée).

- ✅ Vert réduit sur Serie A, même jour (13/09, demande explicite : "pour la seriea met moins de
  vert stp") — le dégradé Serie A (mode peinture, 7 taches radiales) comptait 3 taches vertes
  (`#16a34a` à 30% 75%, `#4ade80` à 40% 45%, `#0f7a37` à 60% 90%) sur 7. Corrigé
  (`.poster--theme-sa` dans `accueil.css` + `.lmp__hero--theme-sa .lmp__heroTintC` dans
  `LiveMatchPage.css`, gardé identique) : 2 des 3 taches vertes (`#16a34a` et `#0f7a37`)
  converties vers des bleus déjà présents dans ce même dégradé (`#0d5a73`/`#0a5f7a`, réutilisés
  plutôt qu'inventés) — ne reste plus qu'une seule tache verte (`#4ade80`) sur 7, contre 3 avant.
  Palette "bleu vert et blanc" (demande d'origine du 12/09) toujours respectée, juste rééquilibrée
  vers le bleu. `TINT_THEME_CAMP_COLORS.sa` (`competitions.js`) mis à jour (`#16a34a` → `#4ade80`,
  pour continuer à référencer une couleur encore présente dans le dégradé plutôt qu'une couleur
  retirée). 357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés
  inchangés (CSS + `competitions.js`, aucune logique touchée).

- ✅ Refonte complète de Serie A, abandon du "mode peinture" pour cette compétition, même jour
  (13/09, demande explicite : "fond bleu nuit avec degradé bleu serie a et quelque accent cyan a
  faible opacité et un peu de blanc pour la card de la serie a stp essaie ça") — Serie A était le
  dernier des thèmes redessinés encore sur l'ancien mécanisme "mode peinture" (7 taches radiales
  + `filter: saturate()`), après que LaLiga/Ligue 1/Premier League/Bundesliga soient déjà passées
  au dégradé linéaire propre plus tôt dans la journée (voir "Refonte complète..." plus haut).
  Remplacé entièrement (`.poster--theme-sa` dans `accueil.css` + `.lmp__hero--theme-sa
  .lmp__heroTintC` dans `LiveMatchPage.css`, gardé identique comme toujours) par :
  `linear-gradient(135deg, #041c2c 0%, #0b3a4d 50%, #0d5a73 100%)` comme fond principal (bleu
  nuit → bleu Serie A, demande "fond bleu nuit avec degradé bleu serie a"), plus 2 calques
  discrets par-dessus : 2 taches `radial-gradient` cyan à faible opacité
  (`rgba(59,179,199,0.28)`/`rgba(59,179,199,0.18)`, coin haut-droite et bas-droite — "quelque
  accent cyan a faible opacité") et 1 touche de blanc semi-transparent au coin haut-gauche
  (`rgba(255,255,255,0.16)` — "un peu de blanc"), même mécanisme déjà utilisé pour la "légère
  touche de blanc" de Ligue 1. Toutes les couleurs réutilisées de la palette Serie A déjà établie
  dans ce fichier (aucune invention) : `#041c2c`/`#0b3a4d` déjà le fond de repli, `#0d5a73`/
  `#0a5f7a` déjà dans l'ancien dégradé, `#3bb3c7` (converti en `rgba` pour l'opacité) déjà la
  tache cyan la plus claire de l'ancienne recette. `filter: saturate(1.4)` retiré (n'a plus de
  sens sur un dégradé linéaire aux couleurs déjà pleines, même raisonnement que pour les 4 autres
  refontes du jour) ; `inset: -20px` → `inset: 0` (plus besoin de marge anti-bord-flou sans blur).
  Plus aucun vert dans ce thème (cohérent avec la demande, qui ne mentionne plus que bleu/cyan/
  blanc). `TINT_THEME_CAMP_COLORS.sa` (`competitions.js`) mis à jour (`['#0d97ab', '#4ade80']` →
  `['#0b3a4d', '#3bb3c7']`, pour refléter les 2 couleurs réellement dominantes du nouveau thème).
  Fond de repli `#root .lmp__hero--theme-sa` inchangé (`#0b3a4d`, coïncide déjà avec la couleur
  médiane du nouveau dégradé, aucune mise à jour nécessaire). 357 tests + lint (33 erreurs
  pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés (CSS + `competitions.js`,
  aucune logique touchée). Honnêteté : rendu jamais vu en direct sur un vrai appareil avant ce
  déploiement (juste lecture du CSS résultant) — à confirmer par l'utilisateur.

- ✅ Minute/"Terminé" Bundesliga passée en blanc (14/09, demande explicite : "pour la bundeliga
  met les minutes la en blanc stp dans livematchpage et resultat match et tout la") — ajout de
  `tintLight: true` dans `competitions.js` à côté de `tintTheme: 'bl1'` (déjà présent), même
  mécanisme que PL/Serie A (voir historique du 06/09) : `comp?.tintLight` ajoute la classe
  `lmp__hero--lightTint` (`LiveMatchPage.jsx`/`MatchPage.jsx`) qui met le texte de la minute
  live et "Terminé" en blanc (`.lmp__hero--lightTint .lmp__heroMinute`/`.lmp__hero--lightTint
  .lmp__heroWhenLabel--ft`, `LiveMatchPage.css`) — s'applique automatiquement à LiveMatchPage ET
  MatchPage (même composant/classes partagés). Vérifié avant d'appliquer (via agent dédié) que ça
  ne réintroduit PAS le bug du 12/09 (collision de spécificité CSS causée par un champ `tint`
  résiduel qui ajoutait `lmp__hero--tinted` en plus) : Bundesliga n'a AUCUN champ `tint` (que
  `tintTheme`/`tintLight`), donc cette classe n'est jamais ajoutée — même situation saine que PL/
  SA, qui utilisent déjà exactement cette combinaison sans souci. Sur les cards Accueil/Résultats,
  aucun changement nécessaire : `.poster__min-label` (minute live) est déjà en blanc opaque
  inconditionnellement pour TOUTES les compétitions (décision du 04/09, indépendante de
  `tintLight`), et `.poster__env-label` ("Terminé") est déjà en blanc quasi-plein par défaut —
  seul le voile nacré décoratif (non concerné par cette demande) dépend de `tintLight` sur les
  cards, et nécessite en plus `tint` (absent ici) pour s'activer. 357 tests + lint (33 erreurs
  pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés (changement de données +
  commentaire uniquement, aucune logique touchée).

- 🔍 Barre du bas TOUJOURS décollée, 13e signalement (14/09, retour utilisateur : "toujours
  problème avec la navbar du bas [...] faut qu'elle ne bouge en aucun cas") — après 12 tentatives
  (portail body, couches GPU ajoutées/retirées/ré-ajoutées partiellement, scroll-lock #root,
  watchdogs géométriques, sync visualViewport ajoutée PUIS retirée après avoir causé une vraie
  régression mesurée), décision honnête : pas une 14e théorie nouvelle inventée au hasard, mais la
  correction directe du dernier COMPROMIS non-éprouvé encore en place. Le 12e signalement avait
  déjà donné la description la plus précise obtenue à ce jour ("elle se décolle et quand je scroll
  vers le bas elle monte et inversement" = la barre glisse AVEC le scroll) — signature exacte et
  bien documentée du bug WebKit "position:fixed sans couche de compositing dédiée". Le correctif
  standard pour CE bug précis (`transform: translateZ(0)`) avait été posé le 10/09 puis retiré le
  11/09 sur la base d'une AUTRE théorie ("désync de peinture après retour d'arrière-plan") qui n'a,
  elle, jamais été confirmée par aucune preuve concrète — seulement `will-change: transform` SEUL
  avait été remis en compromis, en pariant que ça suffirait sans le risque supposé de la théorie du
  11/09. Le symptôme identique persistant malgré ce compromis est la preuve que `will-change` seul
  ne garantit pas la promotion de couche sur toutes les versions de WebKit (le spec CSS ne
  l'exige pas, contrairement à `transform` qui EST la promotion). Corrigé (`navbar.css`,
  `.sfTabbar`) : `transform: translateZ(0)` restauré EN PLUS de `will-change: transform` (+
  préfixes `-webkit-`, + `backface-visibility: hidden` pour renforcer la promotion de couche sur
  WebKit). Différence assumée avec le `translateY(-gap)` de la 8e/10e tentative (celui qui AVAIT
  causé une vraie régression) : ici la valeur est FIXE (`translateZ(0)`, jamais recalculée par du
  JS), donc structurellement incapable de "sauter" à une valeur aberrante comme `-335px` — le
  risque qui avait fait abandonner toute compensation par transform ne s'applique pas à une
  valeur constante. Le watchdog retour-arrière-plan (`App.jsx`, `repair()`) reste actif en
  complément, cible un déclencheur différent (retour d'arrière-plan, pas glissement pendant le
  scroll). 357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés
  inchangés (CSS uniquement). Honnêteté totale, comme à chaque tentative précédente : toujours
  aucun accès à un vrai iPhone/PWA depuis cet environnement pour reproduire ou confirmer avant
  déploiement — mais contrairement à plusieurs tentatives précédentes, celle-ci ne devine pas une
  nouvelle cause : elle corrige un compromis dont on a maintenant la preuve qu'il était
  insuffisant, en appliquant le correctif standard et documenté pour la signature EXACTE du bug
  déjà décrite deux fois par l'utilisateur. Si le symptôme persiste malgré ça, ce sera un signal
  fort que la cause n'est PAS (ou plus) un problème de couche de compositing — et il faudra alors
  sérieusement envisager un changement structurel plus profond (ex. remplacer position:fixed par
  une mise en page en colonne flex pleine hauteur avec un seul conteneur de scroll interne, qui
  élimine la classe de bug entière plutôt que de la contourner) plutôt qu'un 14e ajustement CSS —
  option volontairement pas prise cette fois car elle demanderait de retoucher le modèle de scroll
  de toute l'app (restauration de position au retour arrière, `window.scrollTo`, tous les
  scroll-locks de modals) et risquerait d'introduire de nouvelles régressions ailleurs, pour un
  bug pas encore confirmé comme nécessitant ce niveau de changement.

- ✅ Barre du bas décollée, 14e signalement, REFONTE STRUCTURELLE (14/09, retour utilisateur
  immédiat après la 13e tentative confirmée déployée : "la navbar s'est encore decoller" — puis,
  à la question directe "as-tu complètement fermé l'app et rouverte depuis ce déploiement ?",
  confirmation explicite "Oui, complètement fermée et rouverte") : cette confirmation écarte avec
  certitude la piste "cache PWA obsolète" (la 13e tentative — `transform: translateZ(0)` +
  `will-change: transform` — a été revérifiée en direct sur la prod, bien déployée) ET la piste
  "couche de compositing manquante" elle-même, désormais réfutée par une preuve réelle plutôt
  qu'une hypothèse non testée. Décision assumée : après 13 tentatives successives (portail body,
  couches GPU ajoutées/retirées/ré-ajoutées, watchdogs géométriques à intervalle, réparation au
  retour d'arrière-plan en 1 puis 2 passes, sync visualViewport ajoutée puis retirée après avoir
  elle-même causé une régression mesurée, scroll-lock déplacé de `<body>` à `#root`...) toutes
  centrées sur le maintien de `.sfTabbar` en `position: fixed` ancrée au viewport, il ne s'agit
  plus de deviner une 15e cause précise mais d'éliminer la classe de bug entière. Recherche
  préalable (avant tout code) : grep exhaustif de tout l'usage de `window.scrollY`/
  `window.scrollTo`/`IntersectionObserver`/`position: sticky` dans `src/` pour évaluer le risque
  d'un changement structurel du modèle de scroll — usage bien plus limité que redouté (seuls
  `App.jsx` et `scrollLock.js` en dépendaient réellement ; le `window.scrollTo` trouvé dans
  `Match.jsx` n'était qu'un commentaire historique, pas du code actif ; aucun `IntersectionObserver`
  réel dans le code applicatif ; les `position: sticky` existants — sidebars Programme/Résultats/
  Classement, en-têtes de tableau — restent valides à l'identique car ils redeviennent relatifs à
  `.appScroll`, leur nouvel ancêtre défilant, exactement comme ils l'étaient avant vis-à-vis du
  document).
  Changement (`src/components/navbar.jsx`, `navbar.css`, `src/App.jsx`, `src/App.css`,
  `src/utils/scrollLock.js`) : toute l'app tient désormais dans `.appShell`, une colonne flex de
  hauteur EXACTEMENT égale au viewport (`100dvh`, repli `100vh`) — header (`Navbar`, désormais
  export par défaut réduit au seul `<header>`) et barre du bas (`BottomTabBar`, nouvel export
  nommé du même fichier) sont 2 éléments de flux `flex: 0 0 auto` à ses 2 extrémités, plus jamais
  `position: fixed` pour la barre du bas ni portail dans `<body>` (retiré, n'a plus lieu d'être).
  Entre les deux, `.appScroll` (`flex: 1 1 auto; min-height: 0; overflow-y: auto`) est le SEUL
  conteneur qui défile dans toute l'app — bannières, routes, footer vivent dedans. `.sfTabbar` ne
  peut structurellement plus "se décoller" : sa position découle uniquement du layout flex natif,
  recalculé par le navigateur comme n'importe quel autre élément de page, sans aucun mécanisme de
  positionnement `position: fixed` que WebKit pourrait désynchroniser (compositing, glissement au
  scroll, écart viewport visuel/layout, ancêtre transformé — toute cette classe de bugs devient
  sans objet). `App.jsx` : la sauvegarde/restauration de position de scroll (retour arrière) vise
  désormais `appScrollRef.current.scrollTop` au lieu de `window.scrollY`/`window.scrollTo`. Les
  ~220 lignes cumulées des 9 tentatives de watchdog `.sfTabbar` (portail, couches GPU, réparation
  au retour d'arrière-plan) sont retirées en entier (code devenu obsolète, pas juste inutile) —
  remplacées par un seul filet de sécurité, plus simple et sans risque WebKit : si `.appScroll`
  reste verrouillé (`overflow: hidden`, posé par `scrollLock.js` pendant un modal/dropdown ouvert)
  après un retour d'arrière-plan où iOS aurait gelé le nettoyage React avant qu'il ne s'exécute, il
  est libéré de force. `scrollLock.js` réécrit entièrement : posait auparavant `position: fixed` +
  `top: -scrollY` sur `#root` (fix du 11/09, lui-même une protection contre une régression Safari
  n'ayant plus lieu d'être puisque `.sfTabbar` n'est plus `position: fixed`) — remplacé par un
  simple `overflow: hidden` sur `.appScroll`, sans aucune restauration manuelle de position au
  déverrouillage (`scrollTop` reste intact nativement tant qu'on ne le touche pas). Les 6 appelants
  (`Match.jsx`, `Resultat.jsx`, `Classement.jsx` ×2, `Footer.jsx`, `GroupModal.jsx`) n'ont nécessité
  AUCUNE modification : ils appellent déjà tous `lockBodyScroll()` via l'API partagée existante,
  jamais de logique dupliquée localement — vérifié par grep avant de considérer le refactor sûr.
  Effet de bord positif non demandé, découvert en auditant le CSS existant : aucune règle du
  projet ne réservait d'espace (`padding-bottom`) pour compenser l'ancienne barre flottante — le
  bas de chaque page (Footer compris) était donc potentiellement partiellement masqué derrière
  `.sfTabbar` jusqu'ici (jamais signalé par l'utilisateur, probablement peu visible en pratique) ;
  avec la barre en flux normal, ce chevauchement disparaît structurellement, sans rien avoir eu à
  ajouter exprès. 357 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build
  vérifiés inchangés. Honnêteté : toujours aucun accès à un vrai iPhone/PWA depuis cet
  environnement pour reproduire ou confirmer avant déploiement — mais contrairement aux 13
  tentatives précédentes (qui corrigeaient toutes un symptôme précis d'un mécanisme conservé), ce
  changement retire le mécanisme problématique lui-même (`position: fixed` pour la barre du bas) :
  la classe de bug ne peut plus se produire par construction, ce qui est une garantie plus forte
  qu'un correctif ciblé, même si le rendu visuel final (déjà revu par lecture du CSS résultant,
  jamais vu en direct) reste à confirmer par l'utilisateur après ce déploiement.

- ✅ Accueil complètement vide ("j'ai plus rien [...] les match resultat de hier et les match a
  venir") juste après le déploiement du découpage serveur ESPN en tranches ≤7j (15/09, voir plus
  haut) : root cause — le seuil de 7j mesuré ce jour-là n'était pas stable. Re-testé en direct sur
  la prod (16/09) : ESPN rejetait désormais (400) même une plage de 2 jours
  (`dates=20260916-20260917`), alors qu'une date UNIQUE sans tiret (`dates=20260916`) réussissait
  toujours (200 OK, vraies données). Le découpage par tranches de 7j de la veille produisait donc
  encore des tranches qui échouaient TOUTES — `mergeScoreboardChunks` renvoyait `ok:false` sur
  tous les grands championnats (CL/PL/esp.1/ger.1/ita.1/UEL confirmés en 502 via Network), d'où
  l'écran vide constaté. Honnêteté : pas de certitude sur la cause exacte de ce durcissement
  (nouvelle règle ESPN, ou séquelle de mes propres tests en rafale du 15/09 déjà documentés comme
  ayant déclenché un 403 — impossible à distinguer depuis cet environnement) — mais peu importe la
  cause, le format qui reste fiable est clair et vérifié. Corrigé (`api/espn.js`,
  `splitScoreboardRange`) : le découpage se fait maintenant en DATES INDIVIDUELLES sans tiret
  (`ESPN_SCOREBOARD_MAX_RANGE_DAYS` retiré, remplacé par un découpage jour par jour systématique
  dès qu'un tiret est présent), le seul format qui n'a jamais échoué lors des tests du jour. Pour
  compenser le nombre de tranches bien plus élevé (jusqu'à ~76 au lieu de ~31 pour la même
  fenêtre) sans dépasser le temps d'exécution Vercel : `CHUNK_GROUP_SIZE` 5→6 et
  `CHUNK_GROUP_DELAY_MS` 200→150 (`fetchScoreboardChunksStaggered`), `maxDuration` 20→30
  (`vercel.json`), et surtout la fenêtre demandée par le client réduite (`espnAdapter.js`,
  `DAYS_BACK`/`DAYS_FORWARD` : 60/150 → 30/45, soit 210j → 75j au total) — garde une marge x4-5 sur
  les 2 vrais besoins connus de l'app (7j pour les résultats récents, 30j pour "prochain jour avec
  un match" dans Accueil), compromis assumé sur la profondeur de forme récente d'une équipe très
  peu active et la portée de recherche pour un tournoi sporadique (NL/CAN/COPA), pour restaurer une
  app qui fonctionne plutôt que garder une couverture plus large mais cassée. Le mécanisme de repli
  déjà en place (502 si toutes les tranches échouent, jamais un faux 200 vide — voir le fix du
  15/09) reste inchangé, il a d'ailleurs fonctionné comme prévu pendant cet incident (aucune donnée
  fausse affichée, juste vide, le filet client de repli sur cache périmé n'a pas pu s'activer faute
  de cache jamais chauffé sur une fenêtre aussi large). 360 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés. Honnêteté finale : toujours pas de garantie à 100% que
  ESPN ne durcira pas encore sa position sur les dates simples elles-mêmes à l'avenir — c'est
  cependant le format historiquement le plus basique et le plus utilisé de son API, donc le pari
  le plus sûr disponible ; à surveiller si un nouveau signalement d'Accueil vide survient malgré ce
  correctif.

- ✅ Taches orange (UEL) / verte (UECL) rendues nettes (16/09, demande explicite : "faudrait que
  les taches orange et verte ne soit pas flou [...] faudrait que ce soit net") : le `filter:
  blur()` global avait déjà été retiré de tous les thèmes mode-peinture le 12/09, mais chaque
  `radial-gradient` fond directement de sa couleur pleine (0%) vers `transparent` sur un large
  rayon — ce fondu intégré au gradient lui-même donne un aspect doux/vaporeux, indépendant du
  `blur()` déjà retiré (déjà noté dans l'entrée du 12/09, non corrigé à l'époque faute de demande
  précise). Corrigé (`accueil.css` + `LiveMatchPage.css`, gardés identiques comme toujours) :
  ajout d'un palier de couleur pleine avant le fondu (~50% du rayon d'origine) sur les 7 taches
  ORANGE (UEL) / VERTE (UECL) uniquement — les 5 taches noires partagées avec le même gabarit
  (LaLiga/Bundesliga) non touchées, la demande visait spécifiquement les couleurs distinctives de
  ces 2 ligues. Position/taille/couleur de chaque tache inchangées, seule la courbe de fondu
  interne est resserrée. 360 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) +
  build vérifiés. Honnêteté : rendu jamais vu en direct sur un vrai appareil avant ce déploiement
  (juste lecture du CSS résultant) — si le rendu reste perçu comme pas assez net, l'étape suivante
  serait de resserrer encore le palier (ex. 60-65% du rayon au lieu de 50%).

- ✅ UEL/UECL : abandon du "mode peinture", dégradé linéaire noir→couleur→noir (16/09, retour
  utilisateur immédiat après le point précédent : "la c moche enlève les tache orange et verte et
  fait un degradé entre le noir et orange et noir et vert stp comme les autre et a la fin en bas a
  droite remet un peu de noir vite fait") — reversal du resserrement des bords fait juste avant :
  le problème n'était pas la netteté des taches mais le principe même des taches radiales pour ces
  2 thèmes. Même mouvement que LaLiga/Ligue 1/Premier League/Bundesliga le 13/09 ("Refonte
  complète...", voir plus haut) : les 12 `radial-gradient` (5 noires + 7 colorées) remplacés par
  UN SEUL `linear-gradient(135deg, ...)` à 3 zones dans `accueil.css` et `LiveMatchPage.css`
  (gardés identiques comme toujours) — noir en plateau au coin haut-gauche (0-16%), la couleur de
  marque domine l'essentiel de la carte (orange `#e6742a`/`#c8551a` pour UEL, vert `#3fae52`/
  `#2f8a3e` pour UECL, 30-80%), puis un petit retour de noir au coin bas-droite (92-100%, "un peu
  de noir vite fait" comme demandé) — 3 zones plutôt que 2 pour respecter précisément les 2 volets
  de la demande. Ponts de transition (`#8a3c14` orange sombre, `#1c4a26` vert sombre) réutilisés
  de l'ancienne palette de taches (aucune couleur inventée), même principe que les ponts noir→
  rouge de LaLiga (`#7a1a1f`) pour éviter la "coupure" nette déjà documentée par le passé sur
  d'autres thèmes. `filter: saturate(...)` retiré et `inset: -20px` → `inset: 0` (même
  raisonnement que les 4 autres refontes linéaires du 13/09 : plus de sens sans flou/taches).
  Fond de repli `#root .lmp__hero--theme-uel`/`-uecl` mis à jour de l'ancien quasi-noir `#141414`
  vers la couleur dominante de chaque thème (`#c8551a`/`#2f8a3e`), même convention que PD/BL1.
  `TINT_THEME_CAMP_COLORS.uel`/`.uecl` (`competitions.js`) déjà corrects (`['#c8551a', '#000000']`/
  `['#2f8a3e', '#000000']`) — aucune modification nécessaire, les 2 couleurs dominantes du nouveau
  dégradé (couleur + noir) y figuraient déjà. 360 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés. Honnêteté : rendu jamais vu en direct sur un vrai
  appareil avant ce déploiement (juste lecture du CSS résultant) — à confirmer par l'utilisateur.

- ✅ UEL : rééquilibrage noir/orange du dégradé linéaire tout juste posé (16/09, retour utilisateur
  immédiat : "y'a pas assez de noir et trop de orange bg") — `.poster--theme-uel .poster__bg--
  gradient` (`accueil.css`) et `.lmp__hero--theme-uel .lmp__heroTintC` (`LiveMatchPage.css`, gardé
  identique comme toujours) : plateau noir élargi (0-16% → 0-30%), plateau orange plein resserré
  (46-80% → 52-68%, plus étroit qu'avant) et plateau noir final élargi (97-100% → 92-100%) — noir
  passe d'environ 19% à environ 38% du dégradé, orange plein réduit d'environ 34% à environ 16%.
  Ponts de transition `#8a3c14` (orange sombre, déjà utilisé) conservés aux mêmes rôles pour éviter
  de réintroduire une coupure nette noir→orange déjà documentée sur d'autres thèmes (LaLiga,
  Premier League). Portée : uniquement UEL — la demande ne mentionnait que "orange", pas "vert"
  (UECL), donc UECL n'a volontairement pas été touché malgré la structure identique ; si le même
  déséquilibre est constaté sur UECL, ce sera à traiter séparément plutôt que supposé. 360 tests +
  lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés.

- ✅ UEL : orange plus foncé + dégradé vraiment fondu (16/09, retour utilisateur juste après le
  point précédent : "orange + foncé et fait un meilleur degradé que ça stp que ce soit fondu la c
  moche et pas beau") — root cause du "pas fondu" : le dégradé précédent empilait 2 PLATEAUX de
  couleur pleine (noir 0-30%, orange plein 52-68%) reliés par de COURTES zones de transition
  (30-42%, 68-82%) — un mélange de paliers plats et de pentes raides, pas un fondu continu.
  Refait de zéro (`.poster--theme-uel .poster__bg--gradient` dans `accueil.css` +
  `.lmp__hero--theme-uel .lmp__heroTintC` dans `LiveMatchPage.css`, gardé identique comme
  toujours) en un dégradé à 5 points SEULS, sans aucun plateau (chaque stop est un point unique,
  pas une plage) : `linear-gradient(135deg, #000000 0%, #8a3c14 38%, #c8551a 56%, #8a3c14 74%,
  #000000 100%)` — noir aux 2 extrémités, monte en continu vers l'orange sombre `#8a3c14` puis le
  pic orange à 56%, puis redescend symétriquement vers le noir — une seule pente ininterrompue
  d'un bout à l'autre, plus aucune rupture plat→pente. Orange assombri comme demandé : le pic
  utilise désormais `#c8551a` (déjà dans la palette UEL, plus sombre que l'ancien pic `#e6742a`
  qui a été entièrement retiré du dégradé) — plus aucune trace du orange vif d'origine. Aucune
  couleur inventée : les 3 teintes (`#000000`/`#8a3c14`/`#c8551a`) étaient déjà toutes les 3 dans
  la palette UEL établie. `TINT_THEME_CAMP_COLORS.uel` (déjà `['#c8551a', '#000000']`) reste
  cohérent sans modification. 360 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) +
  build vérifiés, ET vérifié en direct sur la prod (navigateur intégré, lecture du CSS déployé
  après déploiement Vercel) que le nouveau dégradé était bien servi. Portée : UEL uniquement, même
  raisonnement que le point précédent (UECL non mentionné, non touché).

- ✅ UEL : noir remis en quantité visible tout en gardant le fondu, même jour (16/09, retour
  utilisateur juste après le point précédent : "ouais mais la y'a pratiquement pas de noir enft")
  — root cause : le dégradé à 5 points uniques (aucun palier, chaque stop un simple point) rendait
  bien un fondu continu comme demandé, mais sans AUCUNE zone plate en noir pur, le noir n'occupait
  quasiment aucune surface réelle de la carte — dès les premiers % après 0%, la couleur remontait
  déjà vers l'orange sombre. Corrigé (`.poster--theme-uel .poster__bg--gradient` dans
  `accueil.css` + `.lmp__hero--theme-uel .lmp__heroTintC` dans `LiveMatchPage.css`, gardé
  identique comme toujours) : réintroduction de 2 COURTS paliers noirs, uniquement dans les 2
  coins extrêmes (0-14% et 86-100%, ~14% chacun) — juste assez pour que le noir soit clairement
  visible dans les coins — puis une seule pente continue ininterrompue entre les deux (14% → 36%
  → 54% pic → 72% → 86%, aucun autre palier, aucune couleur plate au milieu) : `linear-
  gradient(135deg, #000000 0%, #000000 14%, #8a3c14 36%, #c8551a 54%, #8a3c14 72%, #000000 86%,
  #000000 100%)`. Différence assumée avec la version jugée "moche" un peu plus tôt : celle-là avait
  3 paliers plats (noir 30%, orange plein 16%, noir 8%) reliés par des rampes courtes et abruptes —
  ici il n'y a QUE 2 petits paliers, confinés aux coins, et le milieu entier (14-86%, 72% de la
  carte) reste une seule pente continue sans aucune couleur plate — le compromis vise à donner assez
  de noir visible sans recréer l'effet trapèze/coupures signalé juste avant. Mêmes 3 teintes déjà
  établies (`#000000`/`#8a3c14`/`#c8551a`), aucune couleur inventée. 360 tests + lint (33 erreurs
  pré-existantes, Pronos.jsx, inchangé) + build vérifiés. Honnêteté : rendu jamais vu en direct
  avant ce déploiement (juste lecture du CSS) — à confirmer par l'utilisateur que l'équilibre
  noir/fondu convient cette fois. Portée : UEL uniquement (UECL non mentionné).

- ✅ UEL : touche de noir léger ajoutée AU MILIEU du dégradé, même jour (16/09, demande explicite :
  "essaie de mettre un peu de noir mais leger au milieu pour que le orange soit vrm foncé") —
  contrairement aux itérations précédentes qui modifiaient les POINTS du dégradé linéaire lui-même
  (paliers noirs aux coins), cette demande vise le CENTRE de la carte, où le dégradé linéaire
  culmine sur l'orange le plus vif (`#c8551a` à 54%) — y ajouter un point noir directement dans la
  liste de stops aurait cassé la pente continue déjà validée juste avant ("ouais mais la c bien").
  Solution reprise d'un mécanisme déjà utilisé ailleurs dans ce fichier pour ce type de "petite
  touche" (voir Bundesliga/Ligue 1/Serie A, `radial-gradient` en calque additionnel plutôt que
  modification du dégradé principal) : un second calque `radial-gradient(60% 55% at 50% 50%,
  rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.32) 18%, transparent 60%)` empilé PAR-DESSUS le dégradé linéaire
  existant (inchangé, `.poster--theme-uel .poster__bg--gradient` dans `accueil.css` +
  `.lmp__hero--theme-uel .lmp__heroTintC` dans `LiveMatchPage.css`, gardé identique comme toujours)
  — un voile noir semi-transparent (32%, donc "léger", pas un noir plein) centré sur la carte,
  fondant en douceur vers transparent (aucune coupure nette, cohérent avec le fondu déjà en place).
  Effet : assombrit l'orange au centre sans retoucher les 2 paliers noirs des coins ni la continuité
  de la pente déjà validée — répond précisément à "que le orange soit vrm foncé" en assombrissant
  la zone la plus vive plutôt qu'en ajoutant un nouveau point de couleur dans le dégradé principal.
  360 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés. Honnêteté :
  rendu jamais vu en direct avant ce déploiement (juste lecture du CSS) — à confirmer par
  l'utilisateur. Portée : UEL uniquement (UECL non mentionné).

- ✅ UEL : voile noir étendu à TOUTE la carte, même jour (16/09, retour utilisateur immédiat après
  le point précédent : "met en partout ps juste au milieu tu vois") — le `radial-gradient` centré
  du point précédent concentrait le voile noir sur le centre de la carte, avec un fondu vers
  transparent dès 60% du rayon (donc quasiment aucun effet sur les bords/coins). Corrigé
  (`.poster--theme-uel .poster__bg--gradient` dans `accueil.css` + `.lmp__hero--theme-uel
  .lmp__heroTintC` dans `LiveMatchPage.css`, gardé identique comme toujours), en 2 temps : (1)
  1re tentative — remplacement du `radial-gradient` par une couleur plate `rgba(0,0,0,0.22)` en
  1er calque du `background`. Bug trouvé juste après build (`dist/assets/*.css` inspecté avant
  déploiement) : une couleur unie n'est PAS une valeur valide pour un calque non-final du
  raccourci `background` (la spec CSS impose qu'un `background-color` seul n'apparaisse que dans
  le DERNIER calque) — le minifier CSS de Vite transformait silencieusement `rgba(0,0,0,.22)` en
  `0 0` (une position invalide comme image), annulant complètement l'effet, sans erreur de build
  visible. (2) Corrigé avant tout déploiement : `linear-gradient(rgba(0,0,0,0.22),
  rgba(0,0,0,0.22))` à la place — un dégradé de la même couleur vers elle-même EST une image
  valide, minifie proprement (`linear-gradient(#00000038,#00000038)`, vérifié dans le CSS buildé)
  et couvre uniformément toute la surface de la carte, contrairement au `radial-gradient`
  structurellement concentré sur son centre. Opacité 22% (contre 32% pour le voile centré
  précédent) : un assombrissement uniforme sur 100% de la carte à la même opacité que le voile
  concentré sur ~20% du centre aurait rendu l'ensemble trop sombre, y compris les 2 paliers noirs
  des coins déjà bien noirs. Le dégradé linéaire principal (2e calque, noir→orange sombre→orange
  vif→orange sombre→noir) reste inchangé. 360 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés (le 2e build confirmant le calque correctement présent
  dans le CSS minifié, contrairement au 1er). Honnêteté : rendu jamais vu en direct sur un vrai
  appareil avant déploiement (seule la lecture du CSS résultant a été possible depuis cet
  environnement) — à confirmer par l'utilisateur. Portée : UEL uniquement (UECL non mentionné,
  comme toutes les itérations précédentes de ce dégradé).

- ✅ UECL alignée sur la structure finale de UEL (16/09, constat utilisateur : "la ligue conference
  league y'a pas assez de noir et t'as pas fait exactement comme l'europa league") — vérification
  du constat : exacte, UECL n'avait reçu QUE le tout premier passage "mode peinture → dégradé
  linéaire" du 16/09 (noir 0-16% / vert 30-92% en 2 nuances / noir 97-100%), mais n'avait PAS suivi
  les 5 itérations suivantes faites sur UEL le même jour (rééquilibrage noir/couleur, refonte en
  pente continue à 5 points sans palier, réintroduction de 2 courts paliers noirs aux coins, voile
  noir centré, puis voile noir étendu à toute la carte) — chaque fois documenté explicitement
  "Portée : UEL uniquement (UECL non mentionné)", donc UECL était restée figée sur une version
  largement antérieure et moins riche en noir que celle de UEL. Corrigé (`.poster--theme-uecl
  .poster__bg--gradient` dans `accueil.css` + `.lmp__hero--theme-uecl .lmp__heroTintC` dans
  `LiveMatchPage.css`, gardé identique comme toujours) : structure copiée À L'IDENTIQUE de la
  version UEL actuelle (2 calques — voile noir uniforme `linear-gradient(rgba(0,0,0,0.22),
  rgba(0,0,0,0.22))` sur toute la carte + dégradé linéaire à 2 paliers noirs des coins (0-14% et
  86-100%) reliés par une seule pente continue sans palier intermédiaire), mêmes % exacts — seules
  les couleurs changent : `#1c4a26` (vert sombre) et `#2f8a3e` (vert vif) à la place de `#8a3c14`/
  `#c8551a`, toutes deux déjà présentes dans l'ancienne palette UECL de ce fichier (aucune couleur
  inventée). `TINT_THEME_CAMP_COLORS.uecl` (`competitions.js`) déjà `['#2f8a3e', '#000000']` —
  aucune modification nécessaire, cohérent avec les 2 couleurs du nouveau dégradé. 360 tests +
  lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés, y compris le CSS
  minifié inspecté avant déploiement pour confirmer que le voile noir (calque non-final) reste
  bien un `linear-gradient` valide et non une couleur plate invalide (même bug que celui trouvé et
  corrigé sur UEL juste avant, évité ici dès le départ). Honnêteté : rendu jamais vu en direct
  avant déploiement (juste lecture du CSS) — à confirmer par l'utilisateur.

- ✅ Logo UECL remplacé par la version transparente officielle + contour blanc retiré
  (16/09, demande explicite avec image jointe : "remplace ce logo stp par lui la et aussi
  et dasn matchpage et tout la y'a du contour blanc enlève ça stp") : l'ancien
  `src/assets/leagues/conference-league.png` (204×192) était le lockup complet UEFA
  Europa Conference League sur un carré NOIR plein (fond opaque baké dans le fichier) —
  l'image fournie par l'utilisateur est la version officielle TRANSPARENTE du même logo
  (trophée + texte en blanc, arcs en vert `#22c55e`-like, fond réellement transparent,
  RGBA vérifié). Remplacé le fichier (redimensionné 2138×2160 → 360×364, ratio conservé,
  alpha préservé) sous le MÊME nom de fichier — aucun changement de code nécessaire
  (`competitions.js` importe déjà `conference-league.png`, un seul import, un seul
  usage). En parallèle, retiré le fond blanc (`background: rgba(var(--white-rgb),0.94)`)
  et l'ombre (`box-shadow`) de `.lmp__heroCompIcon` (`LiveMatchPage.css`, pastille du
  logo de compétition en haut à gauche du hero — partagée par MatchPage ET
  LiveMatchPage, qui importe ce même fichier CSS) : la nouvelle image, transparente et
  déjà lisible en blanc/vert, n'avait plus besoin d'une plaque blanche derrière (qui
  donnait justement l'effet de "contour blanc" signalé, un carré blanc visible autour du
  logo). Honnêteté : ce fond blanc existait aussi pour garder lisibles d'AUTRES logos de
  compétition dont le tracé est sombre sur fond transparent (voir le commentaire
  équivalent dans `accueil.css` pour `.accueil__mdjLeagueIcon`, la même pastille sur la
  carte "Match du jour" de l'Accueil — celle-ci N'A PAS été touchée, la demande ne
  nommait que MatchPage/LiveMatchPage) — son retrait sur le hero MatchPage/LiveMatchPage
  est une demande explicite, pas une garantie que chaque logo de compétition y reste
  aussi lisible qu'avant ; à signaler si un logo précis devient difficile à voir sur ce
  panneau. 360 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build
  vérifiés (fichier image + CSS uniquement, aucune logique touchée).

- ✅ Logo UECL recadré sur l'icône seule, trop petit dans le badge (16/09, retour utilisateur
  juste après le remplacement du logo officiel transparent : "le logo est peit on le voit pas
  comment on pourrait faire ?") : root cause trouvée par analyse du canal alpha (PIL/NumPy) de
  l'image source fournie par l'utilisateur (2138×2160) — le fichier remplacé le matin même
  contenait tout le lockup officiel (icône trophée+arcs ET le texte "UEFA Europa Conference
  League" en dessous), avec l'icône n'occupant qu'environ 38% de la hauteur totale de l'image
  (lignes 279-1108 sur 2160, le reste étant le texte). Dans le badge `.lmp__heroCompIcon`
  (hauteur fixe 20px, `object-fit: contain`), c'est la hauteur TOTALE de l'image qui est
  contrainte à 20px — l'icône réelle se retrouvait donc réduite à ~7-8px de haut, quasi
  invisible, alors que l'espace texte transparent en dessous ne servait à rien dans ce contexte
  d'affichage en petit badge. Corrigé : recadrage de l'image source sur le bloc icône uniquement
  (trophée blanc + 2 arcs verts, boîte `647,239 → 1492,1148` avec marge, calculée par détection
  automatique du contenu opaque), redimensionné à 390×420 (alpha/transparence préservée),
  sauvegardé sous le même nom de fichier `src/assets/leagues/conference-league.png` — aucun
  changement de code nécessaire (import unique dans `competitions.js`, propagé automatiquement à
  MatchPage/LiveMatchPage/carte "Match du jour"/switcher de compétition). Vérifié visuellement
  avant déploiement (composite sur fond sombre : icône bien nette, trophée blanc + arcs verts,
  fond transparent intact) ET en direct sur la prod après déploiement (navigateur intégré, taille
  du fichier déployé 390×420/35KB confirmée identique au fichier local, capture d'écran sur la
  bannière de sélection de compétition Ligue Europa Conférence — logo clairement visible et
  reconnaissable, contrairement à avant). 360 tests + lint (33 erreurs pré-existantes, Pronos.jsx,
  inchangé) + build vérifiés (fichier image uniquement, aucune logique touchée).

- ✅ Logo UEL recadré sur le ballon seul, même fix que UECL (16/09, demande explicite juste après :
  "pareil pour l'europa league") : `europa-league.png` (181×148) avait exactement le même défaut
  que l'ancien fichier UECL — tout le lockup (ballon UEFA + wordmark complet "UEFA EUROPA LEAGUE"
  sur 3 lignes) empilé verticalement, MAIS avec une différence par rapport à UECL : ce fichier n'a
  jamais eu de version transparente fournie par l'utilisateur, c'est un PNG opaque avec un fond
  NOIR PLEIN baké dans l'image (pas de canal alpha) — donc la détection de contenu ne pouvait pas
  se faire par transparence (comme pour UECL) mais par luminosité (pixels non-noirs = ballon/
  texte). Analyse (PIL/NumPy, somme RGB par ligne) : le ballon occupe les lignes 5-72 sur 148
  (~46% de la hauteur), suivi d'un espace vide (73-79) puis "UEFA" (80-101) puis un espace
  (102-104) puis "EUROPA LEAGUE" (105-122) puis encore du texte (126-138) — dans le badge 20px,
  le ballon réel occupait donc moins de la moitié de l'espace disponible, le reste perdu sur du
  texte devenu illisible à cette taille. Corrigé : recadré sur le ballon seul (boîte cols 58-126 /
  lignes 5-72, marge de 6px, détection automatique du contenu non-noir), redimensionné à 304×300
  (LANCZOS) — fond noir plein CONSERVÉ (contrairement à UECL, ce fichier n'avait pas de version
  transparente disponible pour repartir dessus ; le badge flotte donc comme un carré noir avec le
  ballon dedans, cohérent avec le style déjà en place pour ce logo précis avant ce fix). Honnêteté
  sur la résolution : le fichier source ne mesurait que 181×148 au départ (le ballon natif ~68×68
  px) — pas de version haute résolution disponible dans le dépôt ni fournie par l'utilisateur pour
  ce logo (contrairement à UECL où l'utilisateur avait uploadé un 2138×2160) ; le résultat reste
  net à la taille d'affichage réelle du badge (20px, jusqu'à ~60px en Retina 3x, bien en dessous
  des 68px natifs du crop), mais serait visiblement pixelisé si jamais affiché plus grand un jour.
  Même fichier/import, aucun changement de code nécessaire (import unique dans `competitions.js`,
  propagé automatiquement à MatchPage/LiveMatchPage/carte "Match du jour"/switcher de compétition).
  Vérifié en direct sur la prod après déploiement (taille du fichier déployé 304×300/56KB
  confirmée identique au fichier local, capture d'écran sur la bannière de sélection de
  compétition Ligue Europa — ballon orange/noir clairement visible et reconnaissable, contrairement
  à avant). 360 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés
  (fichier image uniquement, aucune logique touchée).

- ✅ Logo UEL remplacé par la version officielle transparente fournie par l'utilisateur (16/09,
  image jointe juste après le fix précédent) : le fichier fourni (447×447) montrait visuellement
  un fond "transparent" (damier gris caractéristique) — mais l'analyse PIL/NumPy a révélé que ce
  damier était en réalité BAKÉ dans les pixels (canal alpha uniforme à 255 partout, aucune vraie
  transparence) — probablement une capture/export d'un aperçu de transparence plutôt que le
  fichier PNG réellement transparent. Corrigé par chroma-key avant tout recadrage : tout pixel
  gris neutre (R≈G≈B, tolérance ±6) et sombre (<60) reconverti en alpha=0 — le damier utilise
  exactement 2 nuances de gris (23-40), vérifié sans aucun chevauchement avec le blanc du trophée
  (255) ni l'orange des arcs avant application (0 pixel de recouvrement mesuré). Recadré ensuite
  sur le bloc trophée+arcs uniquement (lignes 39-232 sur 447, avant le texte "UEFA EUROPA LEAGUE"
  qui suit, même principe que tous les recadrages précédents de ce fichier), marge 14px,
  redimensionné à 380×420 (LANCZOS). Résultat nettement plus net que la version juste posée
  quelques minutes avant (source native 447×447 contre 181×148 pour l'ancien fichier basse
  résolution) — le point d'honnêteté noté dans l'entrée précédente ("pas de version haute
  résolution disponible") ne s'applique donc plus. Fond réellement transparent cette fois (pas de
  carré noir comme avant), cohérent avec le style déjà appliqué à UECL le matin même. Vérifié
  visuellement avant déploiement (composite sur fond sombre : trophée blanc + arcs orange nets,
  aucun résidu de damier) ET en direct sur la prod après déploiement (taille du fichier déployé
  380×420/76KB confirmée identique au fichier local, capture d'écran sur la carte Accueil "Ligue
  Europa" — logo bien net, fond transparent, aucun carré/damier visible). Même fichier/import,
  aucun changement de code nécessaire. 360 tests + lint (33 erreurs pré-existantes, Pronos.jsx,
  inchangé) + build vérifiés (fichier image uniquement, aucune logique touchée).

- ✅ Dropdown Classement complété (26/09, constat utilisateur : "dans la page classement y'a pas
  toutes les competition dans le dropdown") : `NO_STANDINGS_COMPS` excluait NL/CAN/COPA/UEL/UECL
  par prudence depuis l'origine, en confondant avec une limite réelle mais différente (le
  scoreboard ESPN, utilisé pour Programme/Résultats, n'expose pas proprement la structure de
  groupe) — jamais vérifié en direct pour l'endpoint DÉDIÉ aux classements
  (`/apis/v2/sports/soccer/{slug}/standings`, `compactEspnStandings`). Testé en direct pour les 5 :
  toutes renvoient un vrai classement structuré. Retirées de `NO_STANDINGS_COMPS` (ne reste que
  USC/TDC/CS, un seul match par an). Complété au même moment `BIG_TEAMS`/`NOTABLE_TEAMS`
  (`matchDuJour.js`) pour ces compétitions et d'autres championnats domestiques déjà présents
  (Porto/Feyenoord, Brest, Brighton, Real Sociedad/Girona, Union Berlin, Bologne, Uruguay/
  Colombie/Chili/Équateur/Paraguay/Pérou pour la Copa America) — demande explicite utilisateur
  ("faut mettre les meilleures equipe a chaque fois"). NL renommée "UEFA Nations League" (nom
  officiel complet, orthographe corrigée en "Nations" pluriel). 374 tests (+15) + lint + build
  vérifiés à chaque étape.

- ❌ Buteurs ESPN pour NL/CAN/COPA/UEL/UECL, AJOUTÉS PUIS RETIRÉS LE MÊME JOUR (26/09) : suite au
  dropdown Classement ci-dessus, demande utilisateur explicite ("y'a pas... le classement des
  meilleurs buteur dans ligue des nations et les autres competition aussi") — ces 5 compétitions
  n'ont aucune couverture football-data.org pour les buteurs, gap documenté de longue
  date (`/leaders` ESPN et TheSportsDB `lookuptopscorers.php` déjà testés vides par le passé).
  Plutôt que de répéter ce constat, revérifié en direct : un endpoint DIFFÉRENT jamais essayé,
  `/apis/site/v2/sports/soccer/{slug}/statistics` (`goalsLeaders`), renvoyait bien des noms/buts
  plausibles pour 4 des 5 (UECL vide) — câblé de bout en bout (`compactEspnScorers`,
  `espnSummaryParse.js`, mode `scorers=1` dans `api/espn.js`, branche ESPN dans `useScorers.js`,
  bouton "Buteurs" affiché pour ces 5 dans `Classement.jsx`) et déployé, avec vérification live
  positive (Haaland 4 buts affiché sur UEFA Nations League). Quelques minutes plus tard, retour
  utilisateur PRÉCIS et vérifiable : "c impossible que halland il est 4 buts et joao felix 2 vu
  que y'avait meme pas 4 buts et 1 but au portugal seulement". Recroisé en direct avec les VRAIS
  totaux d'ÉQUIPE du même ESPN (`/apis/v2/sports/soccer/uefa.nations/standings`) : Portugal
  gamesPlayed=1, pointsFor=1 (1 seul but marqué au total cette saison) alors que João Félix SEUL
  était affiché à 2 buts — impossible. Même schéma pour la Norvège (3 buts d'équipe au total vs
  Haaland 4 + Oscar Bobb 2 = 6 à eux deux) et pour l'Allemagne/le Danemark/la Serbie/le Kosovo
  (mêmes écarts, un joueur affiché à plus de buts que toute son équipe n'en a marqué). Cause la
  plus probable (`seasonType: 14105`, un identifiant ESPN interne inhabituel, ni 1/2/3 comme un
  vrai type de phase de saison) : cet endpoint `/statistics` renvoie vraisemblablement un cumul
  HISTORIQUE/ALL-TIME de la compétition (toutes éditions de la Ligue des Nations confondues, par
  exemple), pas un classement de la saison/édition affichée — aucun paramètre de filtrage par
  saison/édition trouvé pour le corriger sur cet endpoint. Entièrement retiré plutôt que corrigé
  (pas de fix fiable trouvé) : `compactEspnScorers` + ses tests supprimés (`espnSummaryParse.js`/
  `.test.js`), mode `scorers=1` supprimé (`api/espn.js`), branche ESPN supprimée
  (`useScorers.js`, retour à `NO_SCORERS_COMPS` — renommé depuis `ESPN_SOURCED_SCORERS_COMPS`),
  bouton "Buteurs" recaché pour ces 5 comps (`Classement.jsx`) avec un filet qui repasse
  automatiquement en vue "Classement" si l'utilisateur y était resté (persisté en
  sessionStorage). Leçon retenue et documentée dans le code : une vérification "ça renvoie des
  noms et des chiffres plausibles" ne suffit PAS à confirmer qu'une donnée est correcte — il faut
  la recouper contre une autre source (ici, les propres standings d'ESPN) avant de la considérer
  fiable, pas seulement constater qu'elle a l'air de fonctionner. 370 tests (-4, les tests
  compactEspnScorers retirés) + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build
  vérifiés. Classement de groupe (`NO_STANDINGS_COMPS`, point ci-dessus) et renommage NL restent
  en place, non concernés par ce retrait — seuls les buteurs de ces 5 comps sont affectés.

- 🔍 Buteurs "fait maison" pour la Ligue des Nations, EN PAUSE — bloqué par le quota Upstash
  épuisé, pas un bug de code (26/09) : suite au retrait des buteurs ESPN ci-dessus (données
  fausses confirmées), demande explicite utilisateur de calculer les buteurs nous-mêmes en
  agrégeant les vrais événements de but match par match plutôt que de faire confiance à un
  endpoint agrégé d'ESPN. Faisabilité validée en direct : `header.competitions[0].details` de
  `/apis/site/v2/sports/soccer/{slug}/summary?event={id}` (endpoint PAR MATCH, différent de
  `/statistics`) donne le détail but par but (buteur, passeur, minute, csc) — vérifié à 100%
  exact sur Norvège 3-2 Danemark (401861046) : buts extraits (Bobb 14', Haaland 18', Damsgaard
  25', Højlund 60', Haaland 74') correspondent exactement au vrai score et aux vrais événements.
  Nouvelle fonction `extractGoalsFromSummary()` (`src/utils/espnSummaryParse.js`, 4 tests dédiés)
  + nouveau mode `computedScorers=1` dans `api/espn.js` : scanne le scoreboard ESPN jour par jour
  (réutilise `readCachedChunks`/`fetchScoreboardChunksStaggered`/`mergeScoreboardChunks` déjà en
  place, aucune duplication), détecte les matchs nouvellement terminés, fetch leur summary,
  agrège buts/passes par joueur (`aggregateGoals`), cache le résultat par match de façon
  permanente dans Redis (`espn:ownscorers:event:*`) + un pointeur `meta` (`scannedThrough`,
  `doneEventIds`) pour ne rescanner que l'incrément à chaque appel — même philosophie de cache
  incrémental que le reste du fichier. Nouveau champ `HOMEMADE_SCORERS_COMPS` (`competitions.js`,
  NL uniquement pour l'instant — CAN/COPA/UEL/UECL restent dans `NO_SCORERS_COMPS`, extension
  explicitement pas encore demandée par l'utilisateur, qui a choisi ce périmètre pilote via
  question directe). 2 vrais bugs trouvés et corrigés AVANT toute confirmation live définitive :
  (1) `group.forEach(id => doneIds.add(id))` marquait TOUS les ids d'un groupe comme "traités"
  même quand `fetchEventSummaryGoals` échouait (null) — un simple raté réseau/timeout excluait
  alors ce match DÉFINITIVEMENT du calcul (`doneEventIds` persiste en Redis, jamais rescanné) ;
  corrigé pour ne marquer "done" que les ids dont le fetch a réellement réussi. (2) le
  `kv.mget` d'agrégation finale lisait un format de clé différent de celui utilisé à l'écriture
  après un bump de version — corrigé. Testé en direct via `?debug=1` (instrumentation temporaire,
  toujours en place à ce stade car le diagnostic n'est pas encore terminé) : les 2 bugs ci-dessus
  étaient bien réels, mais une fois corrigés, `goalListsNonEmpty` restait à 0 alors que CHAQUE
  match scanné affichait "status:ok" avec de vrais buts calculés (ex. 7 buts sur un match) — piste
  suivante : `kv.set` était en fire-and-forget (`.catch(()=>{})` sans `await`), donc le `kv.mget`
  de la même requête pouvait partir avant que l'écriture soit réellement posée ; corrigé (`await`
  ajouté) + bump de version (v2→v3) pour forcer un rescan propre des matchs déjà "pollués" par le
  bug précédent (déjà marqués done avec un cache vide, jamais rescannés sinon). Toujours 0 après
  ce fix : le `catch` autour de `kv.set` avalait l'erreur SANS la logger, donc le "status:ok" du
  debug ne prouvait que le succès du fetch ESPN, pas de l'écriture Redis — ajout d'un champ
  `writeError` pour voir le message d'exception réel, bump v3→v4 pour forcer un nouveau rescan.
  **Root cause réelle enfin confirmée, en toutes lettres dans `writeError` sur les 21 événements
  scannés** : `UpstashError: Command failed: ERR max requests limit exceeded. Limit: 500000,
  Usage: 500000` — le quota MENSUEL Redis Upstash gratuit (500 000 commandes) est intégralement
  épuisé au moment de ce test. Aucun rapport avec le code de cette fonctionnalité : les 2 bugs
  trouvés et corrigés ci-dessus étaient réels et corrects, mais avec ce quota à 500000/500000,
  TOUTE commande Redis échoue actuellement pour TOUTE l'app (pas seulement cette fonctionnalité) —
  déjà pressenti comme un risque le 10/09 ("Commandes Upstash trop proches du plafond gratuit"),
  désormais confirmé effectivement atteint. Implication large, pas juste ce ticket : tant que ce
  quota reste épuisé, tout ce qui dépend de Redis dans l'app tourne en mode dégradé silencieux
  (chaque fonction a déjà un `catch` de repli, donc pas de crash visible, mais probablement plus
  de cache du tout — fast-path live, budget/circuit-breaker football-data.org, subscriptions push,
  etc. — jusqu'au reset mensuel du quota Upstash ou une mise à niveau de plan, aucune des deux
  actions n'étant faisable depuis cet environnement). Le code de cette fonctionnalité (bugs 1+2
  corrigés, `await` ajouté, clés en `v4`) est considéré CORRECT et prêt — la vérification finale
  (confirmer un vrai classement buteurs non-vide, ex. Haaland à 2 buts) ne pourra se faire qu'une
  fois le quota Upstash disponible à nouveau. Instrumentation debug (`?debug=1`, `writeError`)
  volontairement laissée en place pour l'instant plutôt que retirée immédiatement, le temps de
  cette vérification post-reset. 374 tests + lint (33 erreurs pré-existantes, inchangé) + build
  vérifiés à chaque étape de ce chantier.

- ✅ Match Copa del Rey affiché à 18h jamais passé "en direct" ni "terminé" (constat utilisateur,
  26/09 : "il est 20h15 c toujours pas lancer en mode live [...] soit on les enlève soit on les
  met mais un truc qui fonctionne") : root cause confirmée en DIRECT sur l'API ESPN au moment même
  du signalement (`/api/espn?slug=esp.copa_del_rey&dates=20260926`) — les 5 matchs du jour,
  y compris un dont le coup d'envoi théorique (18:00Z) était déjà passé de 15+ minutes au moment
  du test, affichaient TOUS encore `STATUS_SCHEDULED` côté ESPN LUI-MÊME. Écarté avec certitude un
  bug de cache/polling côté app : la fenêtre "aujourd'hui" n'est jamais mise en cache serveur
  (`scoreboardChunkTtl` renvoie `null` pour les dates dans la fenêtre live, voir `api/espn.js`),
  donc ce test a bien tapé ESPN en direct, pas une copie périmée. Tous les matchs concernés
  partagent `event.season.slug === 'qualifying-round'` — le tour de qualification amateur/régional
  (clubs de divisions très inférieures, ex. "CD Tedeón", "Anaitasuna", "Atlético Calatayud") qui
  précède l'entrée des clubs professionnels en Round 1 (6 octobre pour cette édition). Conclusion :
  ESPN ne fournit tout simplement AUCUN suivi live/fin de match fiable pour ce tour précis — déjà
  pressenti dans un commentaire existant d'`espnAdapter.js` ("tours antérieurs... qualifs
  amateurs"), mais jusqu'ici seulement documenté pour l'absence de TABLEAU à élimination directe
  (`mapEspnStage` renvoie `null`), jamais identifié comme cassant aussi le statut live lui-même.
  Aucune alternative gratuite connue ne couvre mieux ces qualifs amateurs (même limite déjà
  documentée pour d'autres gaps ESPN dans ce fichier) — pas de "vrai fix" de statut possible côté
  source. Choix fait entre les 2 options posées par l'utilisateur : RETRAIT plutôt que garder un
  affichage cassé, cohérent avec toutes les décisions précédentes de ce projet face à un vrai gap
  de données (TheSportsDB, buteurs ESPN NL/CAN/COPA/UEL/UECL). Corrigé (`src/utils/espnAdapter.js`,
  `fetchEspnCupMatches`) : nouveau filtre `isUntrackedCupQualifyingRound()` sur
  `event.season?.slug` (regex `qualif|preliminary`, insensible à la casse pour couvrir d'éventuelles
  variantes de nommage ESPN) — exclut ces matchs À LA SOURCE, avant `normalizeEvent`, donc
  invisibles partout où `fetchEspnCupMatches` est consommé (Accueil, Programme, Résultats). Portée
  volontairement élargie aux 3 coupes nationales (FL1/PD/PL, voir `DOMESTIC_CUPS`) et pas seulement
  Copa del Rey : Coupe de France et FA Cup ont très probablement le même trou de couverture sur
  leurs propres tours de qualification amateurs (même pyramide à rounds préliminaires régionaux
  avant l'entrée des clubs pros), pas vérifié en direct pour ces 2-là faute de match en cours au
  moment du test, mais le mécanisme ESPN en cause n'a aucune raison de différer par compétition.
  Effet : Copa del Rey n'affichera plus AUCUN match tant que le tournoi reste au stade qualificatif
  (jusqu'au 6 octobre pour cette édition) — attendu et voulu, pas une régression : il n'y avait de
  toute façon rien d'exploitable à montrer. Les matchs réapparaîtront normalement dès l'entrée en
  lice des clubs pros (Round 1), où ESPN suit le direct sans problème comme pour n'importe quel
  autre match pro déjà couvert par ce fichier. 374 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés. Honnêteté : pas de test automatisé dédié ajouté (aucune
  infra de test n'existe pour `espnAdapter.js` à ce jour, contrairement à `liveDetection.js`/
  `calcProno.js`) — la vérification s'est faite par un appel réel à l'API ESPN en production au
  moment exact de l'incident, pas par une simulation ad-hoc ; à confirmer par l'utilisateur que la
  compétition reste cohérente (rien affiché) jusqu'au 6 octobre, puis qu'un vrai match Round 1
  passe bien en direct normalement le moment venu.

- ✅ FAILLE SÉCURITÉ RÉELLE TROUVÉE ET CORRIGÉE : SSRF + fuite possible de la clé
  API football-data.org (`api/football.js`), suite à un audit sécurité complet
  demandé par l'utilisateur (28/09 : "est ce que l'app est sécurisé côté back
  end et front end [...] honnetement") — audit mené sur TOUS les fichiers
  `api/*.js` qui construisent une URL sortante avec un bout fourni par le
  client. Root cause confirmée par un test réel en sandbox (`node -e`, pas une
  supposition) : `fdPath` (= `req.query.apiPath`, endpoint public sans
  authentification) était concaténé DIRECTEMENT après le hostname
  (`` `https://api.football-data.org${fdPath}...` ``) sans AUCUNE validation —
  contrairement à `api/espn.js` (whitelist `ALLOWED_SLUGS`) et
  `api/apifootball.js` (regex stricte sur `endpoint`), qui ont déjà cette
  protection depuis longtemps. Une valeur comme `apiPath=@evil.example.com/x`
  donne l'URL finale `https://api.football-data.org@evil.example.com/x` — le
  parseur WHATWG URL utilisé en interne par `fetch()` interprète alors
  `api.football-data.org` comme des identifiants HTTP Basic-Auth (userinfo) et
  `evil.example.com` comme le VRAI hôte de connexion. Vérifié en direct dans
  le sandbox (`new URL('https://api.football-data.org' + '@evil.example.com/x')
  .hostname` → `evil.example.com`, confirmé). Conséquence concrète : le header
  `X-Auth-Token` (la vraie clé API football-data.org, un secret serveur)
  serait envoyé à ce serveur attaquant au lieu de football-data.org — un seul
  appel HTTP bien formé suffit à exfiltrer la clé, sans avoir besoin
  d'attendre ou de deviner quoi que ce soit. Le seul garde-fou en place
  (rate-limit 30/min/IP) ne protège PAS contre ça : un seul appel suffit.
  Corrigé : `fdPath` doit désormais matcher strictement `/^\/v4\/[a-zA-Z0-9/_-]*$/`
  (chemin commençant par `/v4/`, uniquement lettres/chiffres/`/`/`-`/`_`,
  aucun `@`/`.`/`:`/espace possible) avant toute construction d'URL — sinon
  400 immédiat. Vérifié que ce format couvre exactement tous les usages
  légitimes de l'app (`src/utils/fdFetch.js`, seul appelant, construit
  toujours `apiPath=/v4/...`) et bloque explicitement le payload d'attaque
  ainsi que des variantes (path traversal encodé, deux-points, etc.) — testé
  avec une liste de cas en sandbox avant déploiement. 374 tests + lint (33
  erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés. Reste du
  périmètre audité (aucun autre problème de cette classe trouvé) : `api/
  cron-goals.js`, `api/fifa-live.js` (slugs ESPN internes, jamais depuis
  `req.query`), `api/fifa-lineups.js` (URLs FIFA construites uniquement avec
  des IDs découverts en interne — `utcDate`/`home`/`away` du client ne
  servent qu'à un matching de nom, jamais concaténés dans une URL),
  `api/apifootball.js` (le chemin GET/fixtures a bien une regex qui bloque
  déjà `@`, ET ce code est de toute façon mort en pratique —
  `PERMANENTLY_DISABLED`, voir plus haut ; le mode `ask` actif appelle un hôte
  Cloudflare fixe sans jamais y insérer de donnée utilisateur dans l'URL),
  `api/debug-push.js`/`api/vapid-key.js` (aucune construction d'URL sortante
  à partir du client). Autres constats de l'audit, moins critiques, non
  corrigés à ce stade faute de demande explicite : aucun header
  Content-Security-Policy configuré (`vercel.json`) — risque limité en
  pratique (aucun `dangerouslySetInnerHTML`/`eval`/`new Function` trouvé nulle
  part dans `src/`) mais une vraie couche de défense en moins ; `api/
  subscribe.js` laisse passer une requête sans header `Origin` du tout
  (`if (!origin) return true`, pensé pour les appels serveur-à-serveur
  légitimes) — n'affaiblit pas la protection CSRF navigateur réelle, mais
  n'arrête pas un script/curl direct (déjà mitigé par le rate-limit 20/h/IP +
  validation stricte du payload sur cet endpoint précis). Contexte qui limite
  la portée globale d'une faille sur ce projet : AUCUN système de
  compte/authentification n'existe dans toute l'app (confirmé par grep
  exhaustif `password|login|signin|auth0|jwt|bcrypt` → 0 résultat) — aucune
  donnée personnelle utilisateur, aucun mot de passe, aucune donnée bancaire
  à voler ; les seules "identités" sont un ID anonyme généré côté client
  (`usePronosGroup.js`, localStorage) et des abonnements Web Push anonymes
  (URL + clés de chiffrement, aucune IP/PII stockée). Le vrai risque ici
  n'était donc pas une fuite de données utilisateur mais bien la clé API
  backend elle-même (rachat/abus du quota football-data.org par un tiers).

- ✅ Les 2 constats mineurs de l'audit sécurité ci-dessus, corrigés le jour même sur demande
  explicite de l'utilisateur ("vaut mieux faire les deux trucs que tu as dites") :
  1. **Header Content-Security-Policy ajouté** (`vercel.json`) : n'existait pas du tout avant.
     Whitelist construite en auditant TOUTES les sources externes réellement utilisées par le
     front (grep exhaustif `src/`, config `runtimeCaching` du service worker dans
     `vite.config.js`, contenu de `index.html`) plutôt que copiée d'un template générique :
     `script-src 'self' 'sha256-...'` (le hash correspond EXACTEMENT au petit script classique
     du filet anti-écran-blanc dans `index.html` — voir son commentaire — pas de `'unsafe-
     inline'` sur script-src, la protection XSS la plus importante de CSP reste donc pleine ;
     ⚠️ si ce script inline est un jour modifié, le hash doit être recalculé sinon CSP le
     bloquera silencieusement — commande : `node -e "const c=require('fs').readFileSync
     ('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];console.log('sha256-'+
     require('crypto').createHash('sha256').update(c).digest('base64'))"`), `style-src 'self'
     'unsafe-inline' https://fonts.googleapis.com` (`'unsafe-inline'` gardé ici car
     `showBootError` dans `main.jsx` — le MÊME filet anti-écran-blanc — injecte des attributs
     `style=""` littéraux via `innerHTML` pour son UI de secours ; un style injecté est un
     risque bien moindre qu'un script injecté, compromis assumé plutôt que casser ce filet
     critique), `img-src`/`connect-src` limités aux domaines réellement appelés (blasons
     `crests.football-data.org`, repli logos `a.espncdn.com`, drapeaux `flagcdn.com`, photos
     joueurs `upload.wikimedia.org`, Ably `*.ably.io`/`*.ably-realtime.com` pour le temps quasi
     réel), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`/`form-action 'self'`.
     ESPN (`site.api.espn.com`) volontairement PAS dans `connect-src` : vérifié par grep que le
     front n'appelle jamais ESPN en direct (uniquement via `/api/espn`, même origine) — la règle
     `NetworkOnly` sur ce domaine dans `vite.config.js` est un filet de sécurité déjà en place
     côté service worker, pas la preuve d'un vrai appel direct.
  2. **Faille CSRF basique corrigée** (`api/subscribe.js`, `isAllowedOrigin`) : l'ancien `if
     (!origin) return true` (pensé pour un hypothétique appel serveur-à-serveur) laissait passer
     n'importe quel script/curl sans header Origin. Vérifié par grep qu'AUCUN appelant serveur
     légitime n'existe pour cet endpoint (seul `usePushNotifications.js` côté client l'appelle) —
     et qu'un vrai navigateur envoie TOUJOURS un Origin sur une requête POST, même same-origin
     (comportement standard `fetch()`). Retiré le passthrough (`if (!origin) return false`) :
     aucun usage réel cassé, seuls les scripts directs sans navigateur sont désormais bloqués à
     la source plutôt que seulement freinés par le rate-limit (20/h/IP, toujours en place en
     complément). 374 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build +
     `vercel.json` validé comme JSON syntaxiquement correct — vérifiés pour les 2 correctifs.
     Honnêteté : le rendu réel du site avec ce nouveau CSP n'a pas pu être vérifié en direct sur
     un vrai navigateur depuis cet environnement (pas d'accès à Chrome/Safari réel) — la
     whitelist a été construite par audit de code exhaustif, pas par observation d'erreurs
     console CSP réelles ; si un élément de l'UI cesse de charger une image/police/connexion
     après ce déploiement (console navigateur : "Refused to ... because it violates the following
     Content Security Policy directive"), c'est très probablement un domaine externe utilisé par
     l'app mais manqué par cet audit — à signaler pour l'ajouter à la whitelist plutôt que
     retirer tout le header.

- ✅ 3e passe de l'audit sécurité : dépendance `react-router-dom` vulnérable, suite à la question
  directe de l'utilisateur (28/09 : "ok donc la toute l'app est sécurisé a 100% de ce qu'on
  pourrait faire ?") — question honnête qui a motivé un dernier contrôle jamais fait jusqu'ici
  dans cet audit : `npm audit` sur les dépendances elles-mêmes (les 2 passes précédentes
  n'auditaient que le CODE écrit pour ce projet, pas les paquets tiers utilisés). Résultat réel :
  `react-router-dom@7.16.0` (celui installé) tombait dans la plage vulnérable (6.0.0-7.18.1) de 5
  CVE réelles et documentées (GHSA) — open redirect via backslash dans `<Link>`/`useNavigate`,
  XSS par validation de protocole manquante (mode RSC), injection de constructeur arbitraire via
  `deserializeErrors()` (hydratation SSR), déni de service via matching de route inefficace, et
  contournement CSRF permettant d'exécuter une action avant la réponse 400 (mode RSC). Portée
  réelle pour CE projet : StatFootix n'utilise ni le SSR ni le mode RSC de React Router (SPA Vite
  classique, `createBrowserRouter`/`<Routes>` standard) — plusieurs de ces CVE ne s'appliquent
  donc probablement pas en pratique ici, mais pas de certitude à 100% sans auditer le code
  interne de la librairie elle-même (hors de portée raisonnable) ; le risque de déni de service
  par route mal matchée, lui, s'applique à n'importe quel usage. Corrigé par simple mise à jour
  (`package.json`) : `7.16.0` → `7.18.4` (dernière version publiée, contient tous les correctifs
  — vérifié via `npm view react-router-dom@latest version`), `npm audit --omit=dev` confirme
  `0 vulnérabilité` sur les dépendances de PRODUCTION après ce bump (celles qui finissent dans le
  bundle envoyé au navigateur ou tournent dans les fonctions serverless Vercel). 374 tests + lint
  (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés inchangés après la mise à
  jour — aucune API cassée, seule la version bouge. Honnêteté complète sur ce qui RESTE, réponse
  factuelle à la question "100%" : `npm audit` (sans `--omit=dev`) trouve encore 8 vulnérabilités
  dans des dépendances de DÉVELOPPEMENT (vitest/postcss/browserslist/nanoid/fast-uri/brace-
  expansion, utilisées uniquement par les outils de build/test sur cette machine) — vérifié
  qu'aucune d'elles n'est une dépendance de production (`npm audit --omit=dev` les exclut
  entièrement) : elles ne tournent jamais dans le navigateur de l'utilisateur ni dans les
  fonctions Vercel déployées, donc sans risque réel pour l'app en production, seulement pour cet
  environnement de build lui-même — pas corrigées à ce stade (aucune ne concerne du code exposé
  publiquement), mais existent et seraient à mettre à jour un jour pour la propreté. Au-delà de
  ce que le code peut garantir : la sécurité des COMPTES eux-mêmes (Vercel, GitHub, Upstash,
  Cloudflare, football-data.org) — mots de passe, 2FA, qui a accès — n'est ni auditable ni
  modifiable depuis cet environnement, c'est un point aveugle total de cet audit. Une clé API
  qui a été vulnérable un temps (voir le fix SSRF plus haut) mériterait d'être régénérée par
  précaution (aucune preuve qu'elle ait été exploitée, mais aucune preuve du contraire non plus
  faute d'accès aux logs football-data.org) — décision et action laissées à l'utilisateur,
  jamais faisable depuis ce sandbox.

- ✅ Police du score/heure/cotes qui change au retour d'arrière-plan et ne revient jamais à la
  normale (constat utilisateur, 29/09 : "je reviens d'arrière-plan [...] la police et tout ils
  ont changé et ça s'est pas remis comme avant depuis" — sur iPhone PWA). Piste initiale écartée
  après vérification en direct sur le site déployé (navigateur intégré, lecture des computed
  styles réels) : PAS un vieux cache PWA périmé — le site sert bien la bonne version (Inter 900
  pour score/heure depuis début septembre, choix déjà documenté ; Russo One pour les cotes,
  inchangé), et le mécanisme dédié à ce type de problème (`checkAppVersion`, `src/utils/
  appUpdate.js`, ajouté le 04/09) compare les bundles JS/CSS déployés à ceux réellement chargés —
  mais ne peut RIEN détecter ici : le bundle n'a pas changé, seul l'état RUNTIME des polices déjà
  chargées a changé après la mise en arrière-plan. Cause la plus probable, un bug WebKit
  documenté (pas vérifiable à 100% sans accès à un vrai iPhone depuis cet environnement, mais
  cohérent avec le déclencheur EXACT rapporté — au retour d'arrière-plan, jamais spontané) : iOS
  évince de la mémoire les polices web déjà chargées (Chakra Petch/Archivo Black/Orbitron/Russo
  One/Bebas Neue, chargées via Google Fonts dans `index.html`) pendant une mise en arrière-plan
  prolongée (pression mémoire) — et comme cette app ne recharge jamais la page pour revenir au
  premier plan (SPA), rien ne redemande ensuite ces polices : elles restent bloquées sur leur
  repli (system-ui/sans-serif) indéfiniment, jusqu'à un vrai rechargement complet — expliquant à
  la fois le déclencheur précis (retour d'arrière-plan) ET la persistance ("ça s'est pas remis
  comme avant depuis", puisque rien dans l'app ne redemande spontanément ces polices en
  fonctionnement normal). Corrigé (`src/App.jsx`, nouvel effect) : à chaque retour au premier
  plan (`visibilitychange`/`pageshow`, mêmes événements déjà utilisés par le filet `unstickScroll`
  juste au-dessus dans le même fichier), appel explicite de `document.fonts.load()` sur chaque
  police/graisse réellement utilisée par l'app. Si la police est toujours en mémoire, l'appel est
  résolu immédiatement sans coût réseau ; si elle a été évincée, ça force son rechargement — et
  une fois chargée, le navigateur réaffiche automatiquement tout le texte concerné (comportement
  standard de la Font Loading API), sans avoir besoin d'un rechargement de page complet (donc pas
  de flash/clignotement comme un `window.location.reload()` en aurait causé). 374 tests + lint (33
  erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés. Honnêteté : toujours aucun accès
  à un vrai iPhone/PWA depuis cet environnement pour reproduire ou confirmer avant déploiement —
  le diagnostic s'appuie sur une vérification réelle qui a écarté la piste cache (pas juste une
  supposition) et sur un mécanisme WebKit connu qui correspond précisément au déclencheur décrit,
  mais reste à confirmer par l'utilisateur sur son téléphone après ce déploiement (automatique via
  Vercel, pas de `npm run deploy` manuel nécessaire pour celui-ci).

- ✅ Cote pré-match qui saute brutalement pile au coup d'envoi (constat utilisateur, 29/09 :
  "pourquoi quand le match il commence tu changes la côte des que le match commence au lieu de
  laisser la côte et après monter ou baisser [...] en fonction du score de cartons rouge ou de
  minutes du match ?") — le garde-fou existait déjà en théorie (`calcLiveProno`, `if (diff === 0
  && remaining === 1) return pre` — au coup d'envoi exact, le direct EST censé renvoyer
  exactement la même valeur que le pré-match, voir son commentaire), mais un vrai trou l'annule
  dans un cas précis. Root cause dans `useEspnPregameOdds` (`useMatchDetail.js`) : ce hook exclut
  explicitement tout provider dont le nom matche `/live/i` (`ODDS_PROVIDER_SKIP`) — ESPN publie
  souvent une ligne "*Live Odds*" séparée une fois le match commencé, remplaçant la ligne
  pré-match dans `comp.odds[]`. Pile au moment où `isLive` bascule à `true`, si ESPN a déjà
  relabellisé la ligne, `espnOdds` retombe à `null` — `marketPre` transmis à `calcLiveProno`
  devient alors `null`, et `pre` (le point de départ du direct) se recalcule via le prior interne
  `calcPronoAdvanced` au lieu de la vraie cote de marché affichée une seconde plus tôt : un vrai
  saut de valeur, pas une variation légitime liée au jeu. Corrigé (`MatchPoster.jsx`,
  `MatchDuJourCard.jsx`, les 2 endroits qui réinjectent déjà `marketPre`) : la dernière cote de
  marché pré-match valide vue est désormais figée dans un state local, et c'est CETTE valeur figée
  (pas `espnOdds` en direct, qui peut disparaître) qui sert de point de départ à `calcLiveProno` —
  mise à jour PENDANT le rendu (pattern officiel React "Adjusting state when a prop changes",
  comparaison de référence `espnOdds !== prevEspnOdds`) plutôt que dans un `useEffect`, pour éviter
  la règle lint `react-hooks/set-state-in-effect` (repérée en cours de route : un premier essai via
  `useRef` a aussi été écarté, la règle `react-hooks/refs` interdisant toute lecture/écriture de
  `.current` pendant le rendu — les deux règles n'existaient pas encore la dernière fois qu'un
  `useRef` similaire avait été ajouté ailleurs dans ce projet). Une fois figée, la cote ne peut
  plus jamais sauter à la transition pré-match → live ; le direct continue ensuite de bouger
  normalement selon le score/les cartons rouges/la minute, exactement le mécanisme Poisson déjà en
  place dans `calcLiveProno` (inchangé). `MatchModal.jsx` (LiveStatsTab, page LiveMatchPage) laissé
  tel quel : son `useEspnPregameOdds(match, isLive)` n'est activé QU'une fois le match en direct
  (jamais pré-match), donc n'a pas la même fenêtre pour figer une valeur AVANT le coup d'envoi —
  il dépend du cache localStorage partagé (`espnOdds_${match.id}`, déjà écrit par MatchPoster.jsx/
  MatchDuJourCard.jsx si l'utilisateur a vu la card Accueil avant), un filet différent, pas corrigé
  ici faute de demande précise sur ce point. 374 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés. Honnêteté : rendu jamais vu en direct sur un vrai
  coup d'envoi avant ce déploiement (mécanisme ESPN de relabellisation "Live Odds" déjà documenté
  dans le commentaire existant de `useEspnPregameOdds`, mais pas re-vérifié en direct au moment
  exact d'un vrai coup d'envoi depuis cet environnement) — à confirmer par l'utilisateur sur son
  prochain match suivi dès le coup d'envoi.

- ✅ "Forme récente" (losanges) totalement absente sous les équipes pour les matchs d'aujourd'hui,
  malgré des équipes ayant bien joué (constat utilisateur, 29/09 : "on voit pas la forme recente
  sous les equipes la les losanges [...] surtout qu'ils ont tous joué des matchs") — reproduit en
  direct sur la prod (navigateur intégré) : le jour du signalement était un jour de trêve
  internationale (Ligue des Nations, Espagne-Croatie/Finlande-Biélorussie), aucune carte
  "Aujourd'hui" n'affichait de losange. Root cause dans `useTeamFormMulti` (`useTeamForm.js`) :
  la protection anti-collision ajoutée le 16/08 pour le bug Deportivo (voir plus haut) — résoudre
  chaque équipe d'une compétition ESPN-only (NL/CAN/COPA/UEL/UECL/TDC/CS/USC) PAR NOM contre
  `fdTeamPool` (les matchs de club FD.org affichés le même jour), et DROPPER ENTIÈREMENT le match
  si AUCUN des 2 côtés ne se résout — a un sens pour UEL/UECL (compétitions de CLUBS, qui
  recoupent normalement les championnats domestiques) mais aucun pour NL/CAN/COPA (compétitions
  d'ÉQUIPES NATIONALES) : l'Espagne ou la Croatie ne "matchent" jamais un nom de club, et un jour
  de trêve internationale, `fdTeamPool` est de toute façon VIDE (aucun championnat club ne joue).
  Résultat : 100% des matchs de Ligue des Nations échouaient la résolution des DEUX côtés, étaient
  filtrés hors de `resolvedMatches`, et `formMapByComp['NL']` (la table réellement consommée par
  Accueil/MatchPoster/MatchDuJourCard depuis le fix du 12/09) restait vide en PERMANENCE pour
  cette compétition — pas un bug occasionnel, un vide garanti à chaque journée internationale.
  Corrigé (`useTeamForm.js`, `useTeamFormMulti`) : `formMapByComp` (indexée par compétition,
  jamais fusionnée avec une autre) garde désormais TOUJOURS le match, avec repli sur l'id ESPN
  natif de chaque équipe quand la résolution par nom échoue — sans risque de collision propre à
  cette table précise, contrairement au `formMap` legacy fusionné (partagé entre compétitions).
  Ce dernier (plus consommé par aucun appelant réel depuis le 12/09, gardé pour compat) reste
  protégé À L'IDENTIQUE qu'avant : seuls les matchs où AU MOINS un des 2 camps a été identifié
  avec certitude par nom y entrent encore, pour ne jamais réintroduire le bug Deportivo sur cette
  table-là. 374 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build vérifiés.
  Honnêteté : aucun test automatisé dédié ajouté pour cette logique de résolution précise (même
  choix que documenté dans `useTeamForm.test.js` — la résolution par nom réutilise
  `resolveFdTeamId`, déjà testée séparément dans `matchUtils.test.js`, et `useTeamFormMulti`
  lui-même nécessiterait de mocker react-query pour être testé unitairement, jugé disproportionné
  ici) — vérifié par lecture exhaustive du code et par reproduction visuelle en direct sur la prod
  (capture d'écran confirmant l'absence de losange sur la carte Finlande-Biélorussie au moment du
  signalement) plutôt que par un test permanent ajouté au dépôt ; à reconfirmer par l'utilisateur
  sur son prochain jour de Ligue des Nations après ce déploiement.

- ✅ Cotes plus "en gras comme avant" + heure du "Match du jour" dans une police différente
  (constat utilisateur, 29/09, plusieurs allers-retours : d'abord "la police et tout ils ont
  changé", puis précisé "les chiffre des côtes ne sont plus en gras comme avant et l'heure du
  match du jour etait d'une police differente") — root cause DIFFÉRENTE du fix "font-eviction au
  retour d'arrière-plan" posé plus tôt le même jour (`App.jsx`, `document.fonts.load()`), qui
  restait un correctif préventif raisonnable mais jamais confirmé comme LA cause exacte. Audit du
  CSS en direct sur la prod (navigateur intégré, `getComputedStyle`) : les cotes (`.poster__prono-
  pillVal`) demandent bien `font-family: "Russo One"` et l'heure du Match du jour
  (`.accueil__mdjClock .accueil__mdjBigNum`, règle `index.css`) demande bien `Orbitron` — les deux
  RENDUS CORRECTEMENT à l'instant du test, donc pas un bug permanent, mais Russo One n'a NATURELLEMENT
  qu'une seule graisse (400) qui a déjà un tracé très épais par nature — si cette police échoue à
  charger, le repli `sans-serif` à la même graisse 400 rend un texte visiblement bien plus fin :
  exactement la plainte "plus en gras". Cause structurelle trouvée dans `vite.config.js`
  (`runtimeCaching`, règle `google-fonts`) : `expiration: { maxEntries: 10 }` sur un `CacheFirst`
  — largement insuffisant pour les 6 familles demandées en une seule requête CSS2 (Chakra Petch ×2
  graisses, Archivo ×2, Archivo Black, Orbitron, Russo One, Bebas Neue = 8 combos famille+graisse),
  chacun décliné par Google Fonts en PLUSIEURS blocs `@font-face` par sous-ensemble unicode (latin/
  latin-ext/vietnamese/…) — entre ~25 et ~45 fichiers réels à mettre en cache, bien au-delà de 10.
  Workbox (`ExpirationPlugin`) purge les entrées les plus anciennes dès que ce plafond est dépassé,
  y compris des polices DÉJÀ activement utilisées (Orbitron, Russo One) simplement parce qu'un
  sous-ensemble d'une AUTRE police est arrivé après elles dans le cache — contredisant directement
  l'intention du commentaire d'origine ("cache long, jamais de fetch inutile"). Une fois évincée
  du cache SW, un refetch réseau est retenté au prochain besoin ; s'il échoue ou traîne (reprise
  d'arrière-plan, réseau capricieux au mauvais moment), le texte reste sur son repli système tant
  qu'aucun retry ne réussit. Corrigé (`vite.config.js`) : `maxEntries` 10 → 60 (marge large,
  couvre confortablement les ~25-45 fichiers réels + marge pour une future police). Le fix
  `document.fonts.load()` du matin (`App.jsx`) reste en place en complément, sans risque — les 2
  corrections sont indépendantes et cumulables (l'un couvre une éviction mémoire runtime côté
  WebKit, l'autre une éviction du cache Workbox côté service worker). 374 tests + lint (33 erreurs
  pré-existantes, Pronos.jsx, inchangé) + build vérifiés, y compris `dist/sw.js` généré inspecté
  pour confirmer `maxEntries:60` bien présent dans le service worker buildé. Honnêteté : je n'ai
  pas pu compter avec certitude absolue le nombre EXACT de fichiers de police réellement servis
  par Google Fonts pour ce jeu de familles précis (la tentative de récupérer la vraie feuille CSS2
  avec un user-agent iPhone réel depuis cet environnement a échoué — `fetch` bloqué par la CSP de
  l'app depuis le navigateur intégré, et l'outil `web_fetch` du sandbox ne relaie pas de vrai
  user-agent, renvoyant un repli TrueType d'ancien navigateur avec un seul bloc plutôt que le vrai
  découpage moderne par sous-ensemble) — l'estimation ~25-45 fichiers s'appuie sur le comportement
  public bien documenté de l'API Google Fonts CSS2 pour des familles latines, pas sur une mesure
  directe confirmée dans cet environnement ; mais que ce soit 25 ou 45, les deux dépassent
  largement l'ancien plafond de 10, donc le mécanisme de purge excessive reste vérifié avec
  certitude, seul le chiffre exact ne l'est pas. Toujours aucun accès à un vrai iPhone/PWA pour
  confirmer que ce fix règle définitivement le symptôme — à confirmer par l'utilisateur.

- ✅ Fix `maxEntries` ci-dessus jugé sans effet visible par l'utilisateur, même jour (29/09,
  retour immédiat : "bah nn tu vois bien que ça n'a rien changer la") — remarque juste, root
  cause d'un trou dans le raisonnement précédent : Workbox réutilise un cache existant PAR SON
  NOM (`cacheName: 'google-fonts'`) — changer uniquement `maxEntries` dans la config ne vide
  jamais le cache déjà présent sur l'appareil de l'utilisateur, il continue de tourner tel quel,
  déjà tronqué à 10 entrées, avec les mêmes fichiers de police déjà évincés AVANT ce déploiement.
  Remonter le plafond empêche seulement de FUTURES évictions une fois que le cache se
  repeuplerait naturellement — un processus lent et non garanti, pas un correctif qui se voit
  "immédiatement" comme je l'avais annoncé à tort. Corrigé (`vite.config.js`) : `cacheName`
  renommé `'google-fonts'` → `'google-fonts-v2'` — Workbox traite ça comme un cache TOUT NEUF,
  forçant un premier refetch réseau propre de chaque police au prochain besoin, qui se retrouve
  ensuite dans un cache à 60 entrées ne purgeant plus rien. L'ancien cache orphelin `google-fonts`
  est supprimé automatiquement par `cleanupOutdatedCaches` (déjà actif dans ce fichier, mécanisme
  éprouvé — même principe que le `CACHE_BUSTER` de React Query documenté plus haut pour un
  symptôme similaire, "cache figé qui ne se répare jamais tout seul"). Vérifié dans le build local
  (`dist/sw.js`) avant déploiement : `"google-fonts-v2",plugins:[new s.ExpirationPlugin({maxEntries:
  60,...})]` bien présent. 374 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) +
  build vérifiés. Honnêteté : comme pour le fix précédent, aucun accès à un vrai iPhone/PWA pour
  confirmer en direct — mais cette fois le mécanisme corrige un vrai trou de raisonnement (renommer
  le cache est ce qui rend le changement réellement observable, pas juste "correct en théorie")
  plutôt que de re-proposer la même action sous une forme différente ; l'utilisateur devra fermer
  complètement l'app puis la rouvrir pour que le nouveau service worker prenne la main
  (`skipWaiting`/`clientsClaim` déjà actifs, mais une PWA déjà ouverte ne bascule pas seule sur un
  nouveau SW tant qu'elle n'est pas rechargée) avant que les polices ne se rechargent proprement.

- ✅ Faux départ écarté puis vrai filet ajouté, même jour (29/09, suite du symptôme cotes/heure
  Match du jour) : l'utilisateur a insisté ("c'était pas comme ça avant [...] tu le fais exprès")
  et a fini par fournir 2 vraies captures d'écran de son iPhone à 5 jours d'écart (24/09 13:40 et
  29/09 10:03) montrant une police visiblement différente sur les mêmes éléments. Vérifié par
  `git log --since=2026-09-24 -- accueil.css index.css matchModal.css LiveMatchPage.css` : UN
  SEUL commit CSS dans cette fenêtre (repositionnement de nom d'équipe, sans rapport) — aucune
  règle `font-family`/`font-weight` de ces éléments n'a changé entre les 2 captures. Confirme que
  ce n'est PAS une régression introduite par un déploiement précis (ni les 2 fixes du jour même,
  déjà tentés avant ces captures) : un vrai problème RUNTIME, intermittent, propre à l'appareil.
  Testé et écarté avec certitude aujourd'hui : blocage réseau/CSP/bloqueur de pub (l'utilisateur a
  tapé l'URL Google Fonts directement dans Safari, le vrai CSS `@font-face` avec les bonnes URLs
  woff2 est revenu) ; cache PWA/service worker (reproduit identique en Safari normal ET navigation
  privée, où le SW ne joue pas le même rôle) ; police visible dans un navigateur de test frais
  (vérifié en direct via le navigateur intégré : rendu correct, `document.fonts.check()` à `true`
  pour les 3 polices). Le fix `document.fonts.load()` posé ce matin (visibilitychange/pageshow,
  voir juste au-dessus) reste déployé et confirmé (bundle vérifié en direct) mais n'a pas suffi à
  éliminer le symptôme constaté sur les captures — cause probable : ces 2 événements ne se
  déclenchent pas de façon fiable en PWA standalone iOS (limite déjà documentée dans ce fichier
  pour d'autres watchdogs, ex. la barre du bas). Renforcé (`App.jsx`) : `reloadFonts()` appelé
  aussi une fois au montage (pas seulement sur les événements), + un `setInterval` de 2min tant
  que l'app est au premier plan, filet indépendant de tout événement — même principe déjà éprouvé
  dans `main.jsx` pour le check de mise à jour du SW (justifié par le même constat "iOS standalone
  ne déclenche pas toujours `visibilitychange`"). 374 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés. Honnêteté totale : je ne peux toujours pas reproduire ce
  bug moi-même (mon navigateur de test rend correctement dès le premier chargement) — cet ajout
  est un filet raisonnable et de faible risque pour un mécanisme déjà plausible, PAS une nouvelle
  certitude sur la cause exacte ; si le symptôme persiste malgré ce renfort, la piste la plus
  fiable restante — jamais essayée faute d'accès à l'appareil — est un vrai reset du cache Safari
  pour le domaine (Réglages > Safari > Avancé > Données de sites Web > statfootix.vercel.app >
  Supprimer), pour éliminer tout état runtime WebKit persistant qu'aucun mécanisme côté app ne
  peut atteindre depuis l'extérieur.

- ✅ "Stats saison" ET "forme récente" absentes pour les matchs du jour, constat utilisateur le
  jour même où la 2e journée du tout nouveau cycle 2026-27 de Ligue des Nations se jouait (29/09,
  matchday 2, 27-29/09 — Espagne-Croatie, Finlande-Biélorussie...) : root cause confirmée via le
  vrai calendrier UEFA (recherche web, Wikipédia) — l'édition précédente de la Ligue des Nations
  s'est terminée en juin 2025 (Finals), la nouvelle n'a repris que le 24/09/2026 : un écart de
  ~15 MOIS entre 2 matchs de CETTE compétition pour une équipe déjà éliminée du groupe précédent.
  `fetchTeamForm` (`useTeamForm.js`) source NL/CAN/COPA/UEL/UECL/TDC/CS/USC via ESPN
  (`fetchEspnCompMatches`, `espnAdapter.js`) avec une fenêtre glissante `DAYS_BACK`/`DAYS_FORWARD`
  — réduite à 30j/45j le 16/09 pour un tout autre incident (timeout Vercel sur les 5 grands
  championnats club) — bien trop courte pour capter le dernier match RÉEL de ces compétitions
  sporadiques : "stats saison" (`MpSeasonStats`/`PreMatchSection`) et "forme récente"
  (`formMapByComp`) dépendent tous les deux du MÊME `compMatches` vide → même symptôme, même
  cause, pas 2 bugs séparés. Corrigé (`espnAdapter.js`) : fenêtre élargie à 400j EN ARRIÈRE
  UNIQUEMENT pour les 8 slugs dédiés à ces compétitions sporadiques (`uefa.nations`,
  `caf.nations`, `conmebol.america`, `uefa.europa`, `uefa.europa.conf`, `uefa.super_cup`,
  `fra.super_cup`, `eng.charity`) — jamais partagés avec les 5 grands championnats club ni la C1
  (`COMPETITION_ESPN_SLUG`, `competitions.js`), donc AUCUN risque de réintroduire le problème de
  timeout du 16/09 (qui concernait le découpage de plage pour des slugs à fort trafic) : le 1er
  chargement à froid de ces 8 slugs peut être plus lent, mais dégrade proprement sur la copie
  cache existante (`readCacheStale`) plutôt que de planter, et les tranches passées sont mises en
  cache très longtemps une fois obtenues (coût payé une seule fois). Honnêteté, 2 limites
  assumées : (1) 400j ne couvre pas TOUS les cas — une équipe reléguée en Ligue D ou éliminée très
  tôt peut avoir un écart de plus de 400j entre 2 matchs de cette compétition précise ; (2) limite
  plus profonde, pas corrigée ici : pour ces compétitions ESPN-only, "forme récente" ne compte QUE
  les matchs de la MÊME compétition (jamais les amicaux/qualifs d'une autre compétition de la même
  équipe nationale, qui seraient les vrais "5 derniers matchs" dans la réalité) — contrairement aux
  clubs, où la Coupe de France compte déjà dans la forme Ligue 1 depuis le 27/07. Élargir la
  fenêtre aide surtout les cas où le dernier match DE CETTE COMPÉTITION est encore dans les 400j
  (ex. dès la 2e journée d'un nouveau cycle NL, comme le jour du signalement — chaque équipe a
  déjà 1 résultat, la vraie journée 1, 3-5j plus tôt) — un vrai historique "5 sur 5" pour une
  compétition qui vient de commencer n'existe simplement pas encore, ce n'est pas un bug restant.
  Fusionner plusieurs compétitions ESPN pour une même équipe nationale (comme pour les clubs)
  serait le vrai fix complet, plus gros chantier, pas fait ici faute de demande explicite en ce
  sens. 374 tests + lint + build vérifiés inchangés (changement isolé à `espnAdapter.js`, aucune
  autre logique touchée). Honnêteté finale : pas d'accès à un vrai iPhone/PWA ni à l'API ESPN en
  direct depuis cet environnement pour confirmer le rendu final après déploiement — le diagnostic
  s'appuie sur le calendrier UEFA réel (vérifié via recherche web) et la lecture exhaustive du code
  existant (dont plusieurs commentaires antérieurs documentant déjà ce compromis comme "accepté"),
  pas sur une reproduction live ; à confirmer par l'utilisateur sur son prochain match international.

- ✅ ROOT CAUSE TROUVÉE ET CORRIGÉE : "Fluid Active CPU" Vercel en forte hausse anormale ces
  derniers jours (constat utilisateur, 30/09, capture d'écran du dashboard Vercel Observability
  à l'appui — question initiale "ça a un lien avec Upstash ?", réponse : pas directement, mais
  en creusant la vraie cause s'est révélée liée à l'incident Upstash déjà documenté le 26/09).
  Root cause : le mode `computedScorers=1` (`api/espn.js`, buteurs "faits maison" pour la Ligue
  des Nations, voir l'entrée "EN PAUSE" du 26/09) gate son scan complet (35 jours d'historique +
  fetch du résumé de chaque match terminé) derrière `isFresh` — `meta` lu via `kv.get`, censé
  rester "frais" 10min (`HOMEMADE_SCORERS_FRESH_MS`) une fois un scan réussi. Mais tant que le
  quota mensuel Upstash reste épuisé (confirmé le 26/09, `writeError` explicite dans les logs),
  CE `kv.get` échoue systématiquement — l'ancien code traitait alors `meta` comme `null` ("jamais
  scanné") au lieu de "Redis en panne", ce qui déclenchait un scan COMPLET à CHAQUE appel, sans
  jamais pouvoir persister le résultat ensuite (le `kv.set` qui suit échoue lui aussi, avalé
  silencieusement par son propre `.catch(()=>{})`) — un travail CPU intégralement gaspillé, REFAIT
  DE ZÉRO toutes les 10min PAR VISITEUR de l'onglet Buteurs Ligue des Nations, en pleine période de
  matchday (24-29/09). Corrigé (`api/espn.js`) : nouveau flag `redisDown`, distinct de `meta ===
  null` — si le `kv.get` initial lève une exception (Redis indisponible/quota dépassé), le code
  abandonne IMMÉDIATEMENT (`isFresh = true` forcé) avant le moindre fetch ESPN, plutôt que de
  refaire un scan qui ne pourra de toute façon jamais être mis en cache. Le classement buteurs NL
  reste vide dans ce cas (comme actuellement, aucune régression fonctionnelle — c'était déjà vide
  avant ce fix, pour la même raison), mais sans plus consommer un seul cycle CPU inutile pour y
  arriver. 374 tests + lint + build vérifiés inchangés (changement isolé à `api/espn.js`, 2 lignes
  de logique + commentaire). Honnêteté : je ne peux pas confirmer avec certitude à 100% que c'est
  CE mécanisme précis qui explique la totalité des "50min en quelques jours" constatés (pas
  d'accès aux logs de durée par fonction Vercel depuis cet environnement pour le chiffrer
  exactement) — mais c'est un vrai bug de boucle de travail gaspillé, confirmé par lecture directe
  du code et cohérent dans le temps (actif depuis le 26/09, exactement la fenêtre "quelques jours"
  mentionnée), corrigé indépendamment du chiffre exact. À surveiller sur le dashboard Vercel dans
  les jours suivant ce déploiement — la baisse de CPU sera la confirmation la plus fiable.

- ✅ Classement buteurs "fait maison" de la Ligue des Nations RETIRÉ ENTIÈREMENT (30/09, demande
  explicite utilisateur juste après le fix CPU ci-dessus : "bah autant supp le classement buteur
  de la lique des nation ça sert a rien y'a rien qui s'affiche") — décision juste et cohérente :
  le mécanisme lui-même fonctionnait bien (vérifié exact sur Norvège 3-2 Danemark le 24/09, et le
  bug de gaspillage CPU venait d'être trouvé et corrigé le jour même), mais tant que le quota
  mensuel Upstash reste épuisé (confirmé le 26/09, `writeError` explicite dans les logs), le `kv.get`
  initial de ce mode échoue systématiquement — `redisDown` fait alors abandonner IMMÉDIATEMENT
  avant tout fetch ESPN (c'est justement le fix du jour), donc plus aucun match ne peut jamais être
  marqué "scanné" et le classement reste vide indéfiniment, pour n'importe quel visiteur, tant que
  ce quota n'est pas réinitialisé ou augmenté. Un classement qui n'affiche jamais rien n'a aucune
  valeur : mieux vaut le retirer proprement que le garder pour rien, même corrigé côté CPU.
  Retiré (pas juste désactivé, pour ne pas laisser de code mort) : `src/data/competitions.js`
  (`NL` déplacée de `HOMEMADE_SCORERS_COMPS`, supprimée, vers `NO_SCORERS_COMPS` — rejoint
  CAN/COPA/UEL/UECL, aucune des 5 n'a de source de buteurs fiable actuellement) ; `useScorers.js`
  (branche `HOMEMADE_SCORERS_COMPS`/fetch `computedScorers=1` retirée, import nettoyé) ; `api/
  espn.js` (le mode `computedScorers=1` entier supprimé — `fetchEventSummaryGoals`,
  `aggregateGoals`, `isEventFinished`, les constantes `HOMEMADE_SCORERS_FRESH_MS`/
  `HOMEMADE_SCORERS_INITIAL_LOOKBACK_DAYS`, et l'import `extractGoalsFromSummary` — `ymd`/
  `parseYmd`/`CHUNK_GROUP_SIZE`/`CHUNK_GROUP_DELAY_MS` conservés, encore utilisés par le mode
  scoreboard) ; `src/utils/espnSummaryParse.js` (`extractGoalsFromSummary` supprimée, plus aucun
  appelant) + ses 4 tests dédiés (`espnSummaryParse.test.js`). `Classement.jsx` n'a nécessité
  AUCUNE modification : son bouton "Buteurs" et son repli de vue (`view === 'buteurs' &&
  NO_STANDINGS_COMPS...`) sont déjà entièrement pilotés par `NO_SCORERS_COMPS`, jamais par
  `HOMEMADE_SCORERS_COMPS` directement — NL a donc automatiquement récupéré le comportement
  "bouton caché" déjà en place pour CAN/COPA/UEL/UECL, sans rien à toucher là. 370 tests (-4, les
  tests `extractGoalsFromSummary` retirés) + lint (clean sur tous les fichiers touchés) + build
  vérifiés. Le code n'est pas perdu : disponible dans l'historique git (commit du 26/09 pour
  l'ajout initial, du 30/09 pour le fix CPU) si le calcul maison doit être repris un jour, une fois
  le quota Upstash résolu (reset mensuel ou upgrade de plan) — pas faisable depuis cet
  environnement.

- ✅ PLUS GROSSE CAUSE du pic "Fluid Active CPU" trouvée et corrigée, suite à l'insistance
  justifiée de l'utilisateur (30/09 : "faut vrm que la conso baisse considerablement hein" juste
  après le fix buteurs NL/retrait — bonne intuition, ce fix-là n'était PAS le principal coupable)
  : `readCachedChunks` (`api/espn.js`) ne distingue pas "vrai cache miss" de "Redis indisponible"
  — un simple `catch` silencieux qui, tant que le quota Upstash reste épuisé (confirmé le 26/09),
  fait retomber TOUTES les tranches d'une fenêtre en fetch ESPN réel, pour chaque requête non
  absorbée par le cache Edge 90s. Combiné à l'élargissement du 29/09 (400j+60j pour les 8 slugs
  sporadiques NL/CAN/COPA/UEL/UECL/TDC/CS/USC, pour corriger "stats saison"/"forme récente"
  absentes) : jusqu'à ~460 tranches à fetcher RÉELLEMENT sur ESPN à CHAQUE cycle de cache Edge
  (~toutes les 90s tant qu'il y a du trafic Ligue des Nations, en pleine journée internationale
  au moment du signalement) — plus de 6x le volume du défaut normal (~75 tranches, 30j+45j),
  largement suffisant pour expliquer la majorité du pic CPU, bien plus que le bug buteurs déjà
  corrigé juste avant (qui ne touchait qu'un onglet niche, celui-ci touche TOUTE consultation
  Accueil/Programme/Résultats de ces 8 compétitions). Honnêteté : je n'ai pas de chiffre exact
  Vercel pour confirmer la part précise de chaque cause (pas d'accès aux logs de durée par
  fonction depuis cet environnement) — mais le mécanisme est confirmé par lecture directe du code
  (le `catch {}` de `readCachedChunks` ne fait bien aucune distinction), et le calcul de volume
  (6x) est vérifiable arithmétiquement. Corrigé (`api/espn.js`) : `MAX_FETCH_CHUNKS` (60) — plafond
  DUR sur le nombre de tranches réellement envoyées à ESPN en une seule exécution, quelle que soit
  la largeur de la fenêtre demandée et indépendamment de la cause (Redis en panne, fenêtre large,
  ou les deux) — protège structurellement contre CE scénario ET contre toute combinaison future du
  même genre, sans avoir besoin de deviner l'état de Redis à l'avance. Quand le nombre de tranches
  à fetcher dépasse ce plafond, seules les plus PROCHES d'aujourd'hui sont gardées (triées par
  distance absolue) — la partie la plus utile (forme récente/prochain match) est préservée, les
  tranches lointaines sont sacrifiées en premier plutôt qu'un tronquage arbitraire. 60 couvre
  confortablement le besoin normal (~75j pour les grands championnats, déjà servi en 1 seule fois
  avant ce plafond) sans jamais dépasser une fraction du budget d'exécution (`maxDuration: 30`,
  vercel.json) même à froid total. 370 tests + lint (clean) + build vérifiés. Risque annexe du
  même type repéré mais PAS corrigé dans cette passe (périmètre différent, pas confirmé comme
  actif au moment du signalement) : `api/fifa-live.js` a un verrou de calcul partagé
  (`fm:computelock`) qui, si `kv.set` échoue (Redis en panne), traite la requête COMME SI elle
  avait le verrou (`lockAcquired = true`) — pendant un vrai match live très suivi ET un Redis en
  panne en même temps, chaque spectateur referait le pipeline complet au lieu d'un seul calcul
  partagé, un retour au coût "1 par spectateur" que ce verrou existe justement pour éviter (voir
  son historique du 10/09). Pas corrigé ici car conditionné à un match live en cours au moment où
  Redis est indisponible — combinaison non confirmée comme active au moment de ce diagnostic,
  contrairement au chunking ESPN qui touchait N'IMPORTE QUELLE consultation Accueil/Programme à
  tout moment. À traiter si un futur pic CPU coïncide avec un jour de match ET une nouvelle
  coupure Redis.

- ✅ 2e passe de l'audit CPU, suite à la demande explicite de l'utilisateur (30/09 : "regarde ce
  qui consomme beaucoup le fluid activ cpu et comment on peut arranger ça en trouvant une
  meilleure solution stp") — après le fix `MAX_FETCH_CHUNKS` (api/espn.js, voir juste au-dessus),
  audit complet de TOUS les autres `api/*.js` pour d'autres risques du même type (travail non
  borné qui s'aggrave quand Redis est en panne ou qui n'a jamais eu de plafond). Lu en entier
  `api/fifa-live.js` (déjà audité) puis délégué un audit dédié des fichiers restants
  (cron-goals.js, football.js, h2h.js, news.js, pulse.js, fifa-lineups.js, apifootball.js,
  subscribe.js, debug-push.js, vapid-key.js). 2 vrais risques trouvés et corrigés :
  1. **`api/cron-goals.js` — le plus concret des deux.** N'importe quel appel avec le bon
     `CRON_SECRET` mais SANS `body.mode==='notify'` retombait AUTOMATIQUEMENT dans l'ancien mode
     complet (polling de TOUS les slugs ESPN, potentiellement plusieurs passes) — exactement le
     code qui avait fait dépasser le plafond CPU une 1ère fois le 08/07, avant la migration vers
     le Worker Cloudflare. Rien ne distinguait "appelé par le Worker (mode notify, bon marché)"
     de "appelé par un ancien schedule cron-job.org resté actif par erreur" — les deux n'ont
     besoin que du même secret. Vérifié par lecture directe du code (`vercel.json` ne contient
     aucun `crons` natif, confirmant que seul cron-job.org — config EXTERNE, invisible depuis ce
     dépôt — a pu historiquement appeler cet endpoint en continu) ET par lecture complète de
     `cf-worker/src/index.js` : le Worker n'appelle JAMAIS ce mode complet, uniquement
     `mode:'notify'` (2 call-sites, `notifyVercel()`/`pushLiveTicker()`, tous les deux en POST
     avec ce mode) — donc gater le mode complet ne casse rien du chemin actif actuel. Risque réel
     et plausible, pas juste théorique : si l'ancien schedule cron-job.org n'a jamais été
     désactivé côté cron-job.org au moment de la migration vers le Worker (aucun moyen de le
     vérifier depuis cet environnement, c'est une config externe), il continuerait de taper cet
     endpoint 1440×/jour avec le mode complet, coûteux, à l'insu de tout le monde. Corrigé
     (`api/cron-goals.js`) : le mode complet exige désormais explicitement `?legacy=1` (ou
     `body.legacy===true` en POST) EN PLUS du secret — sans ça, 400 clair au lieu de déclencher
     le polling complet. Le fallback manuel documenté ("si le Worker Cloudflare est en panne")
     reste entièrement possible, juste plus jamais accidentel.
  2. **`api/news.js`** : seul proxy de toute l'app sans AUCUNE limite de débit par IP
     (contrairement à espn.js/fifa-live.js/fifa-lineups.js/h2h.js, tous déjà à 30-60/min/IP) — sur
     cache-miss OU panne Redis (`catch {}` silencieux autour de `redis.get`), CHAQUE appel refait
     le fetch+parse réel des 4 flux RSS, sans aucun plafond de fréquence. Risque actif dès
     maintenant, pas seulement théorique : le quota Upstash reste épuisé (confirmé le 26/09), donc
     le cache Redis 5min de ce fichier est aujourd'hui cassé en pratique — un simple curl/bot en
     boucle (ou même un usage normal un peu insistant) peut déclencher un nombre illimité de ces
     cycles fetch+parse. Corrigé : même pattern `ratelimit:*` 30/min/IP déjà utilisé partout
     ailleurs dans l'app (repris tel quel de `fifa-lineups.js`).
  Risques audités et jugés SANS danger réel, pour référence (aucune modification nécessaire) :
  `api/h2h.js` (CSV parsing borné à 6 saisons, déjà cache long + rate-limité 30/min/IP — un léger
  défaut trouvé, `kv.get` non protégé par try/catch contrairement à son `kv.set`, fait échouer
  proprement en 500 plutôt que de redéclencher un travail coûteux, donc pas un risque CPU) ;
  `api/fifa-lineups.js` (~10 fetchs FIFA bornés par match, déjà rate-limité, IDs mis en cache
  définitivement une fois résolus) ; `api/football.js`/`pulse.js`/`api/subscribe.js`/
  `api/vapid-key.js` (tous bornés : 1 seul appel amont ou opérations Redis O(1), déjà
  rate-limités ou protégés par CRON_SECRET) ; `api/apifootball.js` (mode GET mort en pratique,
  `PERMANENTLY_DISABLED`, voir Stack) ; `api/debug-push.js` (lit un historique Redis en entier,
  mais protégé par CRON_SECRET et appelé manuellement — négligeable). Le risque déjà identifié
  mais volontairement pas corrigé dans la passe précédente (`fm:computelock` de `fifa-live.js`,
  fail-open si Redis tombe PENDANT un match très suivi) reste dans le même état : pas confirmé
  comme actif, à traiter si un futur pic CPU coïncide avec un jour de match ET une coupure Redis.
  370 tests + lint (clean sur les 2 fichiers touchés) + build vérifiés. Honnêteté : je ne peux
  toujours pas mesurer avec certitude la part exacte de CHAQUE mécanisme (cron-goals legacy vs.
  news.js vs. le fix MAX_FETCH_CHUNKS déjà posé) dans le pic CPU observé par l'utilisateur — pas
  d'accès aux logs de durée par fonction Vercel depuis cet environnement — mais les 2 corrections
  de cette passe sont des vrais bugs structurels (un chemin de code coûteux atteignable sans
  garde-fou explicite, dans les deux cas), pas des optimisations spéculatives, donc utiles
  indépendamment de leur part exacte dans le total constaté. Si le CPU reste élevé après ce
  déploiement ET qu'un ancien schedule cron-job.org existait bien, ce fix devrait le rendre
  immédiatement visible (l'ancien schedule recevra désormais des 400 au lieu de tourner en
  silence) — vérifiable sur le dashboard Vercel (logs de `/cron-goals`) dans les prochaines
  minutes après déploiement plutôt que d'attendre un futur cycle de facturation.

- ✅ 3e passe, côté Upstash cette fois (30/09, demande explicite de rester à 100% gratuit : "oui
  mais en version gratuite moi je veux pas payer pour le moment") — recherche faite (agent dédié)
  sur les vraies alternatives : Upstash Fixed 250MB/10$/mois = commandes ILLIMITÉES (la seule
  solution qui règle le problème avec certitude), Vercel Hobby confirmé bloquant réellement les
  fonctions 30 jours en cas de dépassement CPU (pas juste une facturation), Cloudflare KV écarté
  comme remplaçant de Redis pour le dédup/verrous (1000 écritures/jour gratuit, largement en
  dessous du rythme actuel, et pas d'atomicité `SET NX` équivalente). L'utilisateur ayant choisi de
  rester gratuit, optimisation supplémentaire trouvée et appliquée dans `api/fifa-live.js` — le
  fichier le PLUS sollicité de l'app (chaque spectateur d'un match en direct l'appelle toutes les
  30-45s, voir `espnTimerWorker.js`) : son coût PLANCHER (payé à CHAQUE appel, même quand le
  fast-path évite tout le reste) faisait 2 commandes Redis séparées — `kv.mget` sur les clés
  `fm:match:*` PUIS, plus loin, `kv.get('fm:freshbatch')` pour vérifier le fast-path — alors
  qu'Upstash facture un MGET comme 1 SEULE commande quel que soit le nombre de clés qu'il touche.
  Fusionnées en un seul `kv.mget(...matchKeys, 'fm:freshbatch')` : 1 commande au lieu de 2, sur le
  chemin le plus emprunté de toute l'app — un client qui suit un match 1h à 30s/poll passe de 120
  à 60 commandes rien que sur ce plancher. 2e économie trouvée au même endroit : la persistance en
  fin de pipeline refaisait un `kv.get('fm:freshbatch')` juste avant d'écrire (lecture-fusion pour
  ne pas écraser les ids d'un autre match) — remplacé par la réutilisation de la valeur déjà lue en
  DÉBUT de requête, 1 commande de moins à chaque fois que le pipeline complet s'exécute. Sûr dans
  l'immense majorité des cas (le verrou `fm:computelock` garantit qu'un seul client à la fois
  exécute cette section) ; seule exception rare et bénigne documentée dans le code : 2 appels
  `forceFresh` concurrents (retour d'arrière-plan sur 2 matchs différents en même temps) pourraient
  se marcher dessus sur ce marqueur de fraîcheur précis — jamais de donnée fausse affichée, juste
  le fast-path indisponible quelques secondes de plus pour l'un des deux. 370 tests + lint (clean)
  + build vérifiés. Honnêteté : ce fix réduit le coût structurel mais ne peut pas garantir à 100%
  de ne plus jamais dépasser le quota gratuit si le trafic grossit encore (aucun code ne peut
  compenser indéfiniment une croissance d'audience sur un plan à commandes limitées) — la seule
  garantie absolue reste le forfait Upstash Fixed payant, refusé pour l'instant par choix de
  l'utilisateur. Pistes plus lourdes identifiées mais PAS entreprises (gains plus importants,
  changement structurel plus risqué, nécessitant un déploiement manuel `cf-worker/`) : déplacer
  les clés de suivi interne du cron (`cron:liveIds`/`goalTrack`/`cardTrack`/`finalDone`/`recap`,
  actuellement sur Upstash) vers le stockage propre de Cloudflare (Durable Objects, gratuit,
  jamais compté dans le quota Upstash puisque le Worker tourne déjà sur Cloudflare) — retirerait de
  l'addition Upstash le plus gros consommateur 24/7/365 (poll chaque minute, toute l'année) sans
  rien changer pour Vercel ; non fait à ce stade faute de demande explicite et vu l'ampleur du
  chantier (migration complète du câblage Redis du Worker, tests dédiés à écrire pour une infra qui
  n'en a aucune aujourd'hui).

- ✅ Cote pré-match qui saute au coup d'envoi : fix du 29/09 étendu à LiveMatchPage (constat
  utilisateur, 30/09, confirmé après vérification directe : "les côtes dans accueil etait pas les
  memes que dans livematch page") — le fix du 29/09 ("Cote pré-match qui saute brutalement pile au
  coup d'envoi") n'avait été appliqué qu'aux cards Accueil (`MatchPoster.jsx`/`MatchDuJourCard.jsx`),
  explicitement documenté comme non fait pour `LiveStatsTab` (`MatchModal.jsx`, partagé par
  MatchPage/LiveMatchPage) faute de demande précise à l'époque — confirmé maintenant comme un vrai
  écart visible, pas juste une limite théorique. 2 défauts cumulés trouvés dans `LiveStatsTab` :
  (1) `useEspnPregameOdds(match, isLive)` n'était activé QUE pendant le direct (jamais avant le
  coup d'envoi), donc ne pouvait jamais capter la vraie cote de marché AVANT que le match commence
  — contrairement à l'Accueil (`!isFinished`, actif pré-match ET en live) ; (2) `marketPre:
  espnOdds?.pct ?? null` lisait la valeur EN DIRECT sans la figer — dès qu'ESPN relabellise la
  ligne en "*Live Odds*" (filtrée par `ODDS_PROVIDER_SKIP`), `espnOdds` retombe à `null` et le
  calcul retombe sur le prior interne, une valeur différente de celle affichée sur l'Accueil pour
  le même match, exactement le même symptôme que le fix du 29/09 visait déjà à éliminer. Corrigé
  (`MatchModal.jsx`, `LiveStatsTab`) en reprenant EXACTEMENT le mécanisme déjà éprouvé de
  `MatchPoster.jsx` : `enabled: !isFinished` (calculé via un nouveau `isFinished = match.status
  === 'FINISHED'` local à ce composant) + state figé sur la dernière valeur valide vue
  (`lastPregameOdds`/`prevEspnOdds`, mis à jour PENDANT le rendu via la comparaison `espnOdds !==
  prevEspnOdds`, même pattern React officiel "Adjusting state when a prop changes" que l'Accueil,
  mêmes raisons déjà documentées côté `MatchPoster.jsx` pour écarter `useEffect`/`useRef`) —
  `marketPre` utilise maintenant `lastPregameOdds?.pct` au lieu de `espnOdds?.pct` en direct.
  Comme `LiveStatsTab` est partagé par `MatchPage.jsx` ET `LiveMatchPage.jsx`, les deux bénéficient
  du fix en un seul endroit. 370 tests + lint (5 erreurs pré-existantes `react-refresh/only-export-
  components` sur ce fichier, sans lien avec ce changement, confirmées identiques via `git stash`
  avant/après) + build vérifiés. Honnêteté : rendu jamais revu en direct sur un vrai coup d'envoi
  après ce déploiement (même limite que le fix du 29/09 dont celui-ci est l'extension directe) — à
  confirmer par l'utilisateur que les cotes Accueil et LiveMatchPage restent bien identiques pour
  un même match, y compris pile au moment du coup d'envoi.

- ✅ ROOT CAUSE TROUVÉE ET CORRIGÉE : "+1200 commandes Upstash en 10min alors qu'aucun match
  n'est en cours" (constat utilisateur, 01/10, suivi en quasi temps réel sur le dashboard Upstash
  — un vrai signal mesuré, pas une impression). Root cause trouvée par lecture directe du code
  (`api/espn.js`), pas une hypothèse : `SCOREBOARD_PAST_CHUNK_TTL` (24h) s'appliquait À TOUT le
  passé, y compris les tranches les plus anciennes — alors qu'un résultat de match FINISHED d'il y
  a plusieurs mois ne changera plus jamais. Combiné à l'élargissement du 29/09 à 400 jours en
  arrière pour 8 compétitions sporadiques (NL/CAN/COPA/UEL/UECL/TDC/CS/USC, fix "forme récente"/
  "stats saison" absentes), ça voulait dire que TOUT ce passé lointain (jusqu'à 60 tranches par
  requête, `MAX_FETCH_CHUNKS`) expirait et devait être intégralement RÉÉCRIT chaque jour, pour
  toujours — un coût qui ne se stabilise jamais, grandit avec le temps, contrairement à l'esprit
  d'un "cache long" pour du passé immuable. Écriture faite tranche par tranche en fire-and-forget
  (`fetchScoreboardChunk`, `kv.set` individuel) : jusqu'à 60 commandes d'écriture RÉELLES à chaque
  cache-miss — et Upstash facture chaque SET individuellement, même groupé en pipeline (pas de
  gain possible en les regroupant, leçon déjà apprise le 10/09 sur ce même fichier pour les
  verrous but/carton du Worker) donc la seule vraie économie possible était de réduire le nombre
  de fois où cette réécriture se déclenche, pas sa forme. Corrigé (`api/espn.js`,
  `scoreboardChunkTtl`) : au-delà de 10 jours dans le passé, le TTL passe à 90 jours au lieu de
  24h (`SCOREBOARD_OLD_PAST_CHUNK_TTL`) — un résultat vieux de plusieurs mois n'a structurellement
  aucune raison d'être revérifié tous les jours. Le passé RÉCENT (≤10j, le plus consulté en
  pratique — "résultats récents"/"forme récente" classique) garde son cache 24h inchangé, aucun
  risque de servir une donnée trop datée pour ce qui est réellement regardé souvent. 370 tests +
  lint + build vérifiés, déployé immédiatement vu l'urgence du signal. Honnêteté : je n'ai aucun
  accès au dashboard Upstash depuis cet environnement pour confirmer après coup que le rythme de
  commandes a bien chuté (seule l'utilisateur peut le voir) — mais la mécanique du bug est
  confirmée par lecture directe du code (pas une supposition) et le calcul d'impact (jusqu'à 60
  écritures/requête pour du passé qui ne change jamais, répété chaque jour sur une fenêtre de 400j
  × 8 compétitions) est cohérent avec l'ampleur du signal rapporté (+1200 en 10min). 90 jours
  choisi par raisonnement (largement au-delà du moindre délai de correction disciplinaire tardive
  connu) plutôt que mesuré empiriquement — à ajuster si un besoin de récupérer une correction très
  ancienne se présentait un jour (cas extrêmement rare).

- ✅ TTL passé ancien encore rallongé 90j→365j, même sujet, le jour même (01/10, remarque juste de
  l'utilisateur juste après le fix ci-dessus : "pourquoi on garde pas en cache les données des
  match terminé pour la forme recente etc en cache longtemps vu que ça bougera pas a part des que
  l'equipe rejoue un match la ça va s'ajouter au donnée en cache tu vois ce que je veux dire") —
  remarque techniquement juste, qui a mis le doigt sur le fait que même 90 jours restait arbitraire
  pour une donnée structurellement IMMUABLE : chaque jour est une clé de cache séparée
  (`espn:sb:{competition}:{YYYYMMDD}`) — un nouveau match d'une équipe ne touche JAMAIS les
  anciennes clés, c'est déjà 100% additif par construction (confirmé en lisant `splitScoreboardRange`/
  `fetchScoreboardChunk`), pas un "recalcul en bloc" qui justifierait une réécriture périodique.
  Seule vraie raison de ne pas garder indéfiniment : le cas rare d'une correction tardive (décision
  disciplinaire, forfait requalifié après coup, review a posteriori) — risque minime comparé au
  coût de tout réécrire en boucle tous les 90 jours pour rien. Remonté (`api/espn.js`,
  `SCOREBOARD_OLD_PAST_CHUNK_TTL`) à 365 jours (quasi permanent en pratique, pas littéralement
  infini — garde un filet pour qu'une compétition un jour retirée de `ALLOWED_SLUGS` ne laisse pas
  une clé orpheline en Redis pour toujours). Le passé RÉCENT (≤10j) garde son cache 24h inchangé,
  seul le passé déjà vieux de plus de 10 jours est concerné. 370 tests + lint + build vérifiés.
  Honnêteté : même limite que le fix précédent — aucun accès au dashboard Upstash depuis cet
  environnement pour confirmer après coup la baisse réelle du rythme de commandes, seule
  l'utilisateur peut l'observer sur les prochains jours ; 365j reste un choix de raisonnement
  (marge large sur le délai de correction disciplinaire le plus tardif connu), pas une valeur
  mesurée empiriquement sur un vrai cas de correction tardive survenu dans ce projet.

- ✅ Migration du cache scoreboard ESPN vers Turso, nouveau composant d'infra
  (01/10, suite à "j'ai pris 800 comands upstach en 1H30" alors qu'aucun
  visiteur n'était sur l'app, puis demande explicite de l'utilisateur de
  chercher "une meilleure solution [...] qui peut revolutionner cette logique
  de cache" plutôt que d'empiler encore des rustines de TTL) : les 2 fixes du
  même jour (TTL 90j→365j, `MAX_FETCH_CHUNKS`) réduisent la fréquence des
  réécritures mais ne changent pas le fond du problème — ce cache reste
  facturé par COMMANDE Redis (lecture ET écriture), avec un plafond gratuit
  fixe (500K/mois) qui ne grandit jamais avec le trafic. Recherche faite
  (comparaison Cloudflare D1 vs Turso, voir leurs limites gratuites
  respectives) : **Turso** choisi — SQLite distribué, facturé par LIGNE
  (500M lectures/mois + 10M écritures/mois gratuit, soft cap pay-as-you-go
  plutôt qu'un blocage dur), directement accessible en HTTP depuis une
  fonction serverless Vercel via `@libsql/client` (`npm install`, vérifié
  0 nouvelle vulnérabilité de production via `npm audit --omit=dev`) — sans
  avoir besoin d'un hop supplémentaire par un Worker Cloudflare comme
  l'aurait exigé D1. Portée volontairement ÉTROITE, décidée après une 1re
  tentative plus large (migrer aussi l'état Redis du Worker Cloudflare vers
  Durable Objects) investiguée puis ABANDONNÉE le même jour en cours de
  route : lecture de `cf-worker/src/index.js` a révélé une dépendance
  profonde à des primitives propres à Redis (MGET multi-clés en 1 commande,
  verrous atomiques `SET NX`, `SCARD`/`SREM`, TTL natif par clé) qui ne se
  transposent pas proprement sur le modèle de stockage par objet des Durable
  Objects — risque jugé disproportionné face au système de notifications
  live déjà fragile et péniblement stabilisé (~30 itérations documentées
  plus haut dans ce fichier), pour un gain devenu plus petit une fois les 2
  fixes TTL/MAX_FETCH_CHUNKS déjà déployés. Décision network via
  `AskUserQuestion`, confirmée par l'utilisateur ("ah donc en gros ça vaut
  pas le coup de changer en mode ?" → "ok") : cf-worker/ reste intégralement
  sur Redis, aucun changement. Seul le cache scoreboard ESPN (`espn:sb:*`,
  `api/espn.js`) bascule — rate-limit, cache summary/standings ESPN, et tout
  le reste de l'app (notifs, live, H2H, news...) restent sur Redis, ce profil
  (écritures fréquentes/courte durée de vie, verrous atomiques) étant au
  contraire le point fort de Redis, pas de Turso.
  Implémentation (`src/utils/tursoCache.js`, nouveau fichier) : wrapper
  générique `mget(keys)`/`set(key, value, ttlSeconds)` + `isTursoConfigured()`
  au-dessus de `@libsql/client`, table unique `espn_cache (key TEXT PRIMARY
  KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)` créée à la volée
  (`CREATE TABLE IF NOT EXISTS`, idempotent, appelé au 1er accès réel plutôt
  qu'au chargement du module). TTL géré à la main (`expires_at` en secondes
  epoch, filtré à la lecture) — SQLite n'a pas d'expiration native comme
  Redis ; les lignes expirées non lues restent en base sans purge
  périodique, poids négligeable (quelques Ko/ligne, quota 5 Go) sans impact
  sur le quota de lectures/écritures qui est le seul vrai sujet ici. Bascule
  **conditionnelle et sans risque** : `isTursoConfigured()` vérifie la
  présence de `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` — tant qu'elles ne sont
  pas ajoutées côté Vercel (pas encore fait au moment de l'implémentation,
  voir Env vars Vercel plus haut), `readCachedChunks`/`fetchScoreboardChunk`
  (`api/espn.js`) retombent intégralement sur l'ancien chemin `kv.mget`/
  `kv.set` (Redis), strictement inchangé — déploiement possible sans aucune
  régression même avant que l'utilisateur n'ajoute les 2 variables, bascule
  automatique dès qu'elles le sont, sans redéploiement de code nécessaire.
  Transition assumée : les clés déjà en cache côté Redis au moment de la
  bascule ne sont PAS migrées vers Turso (pas de script de migration de
  données) — un cache-miss ponctuel la première fois que Turso prend le
  relais pour chaque tranche, re-remplie normalement au prochain vrai fetch
  ESPN, sans donnée fausse ni incident, juste un léger réchauffement à froid.
  Setup effectué par l'utilisateur (compte turso.tech, base `statfootix`,
  région AWS EU West Ireland, option "concurrent writes/Rust rewrite"
  laissée désactivée sur mon conseil — inutile pour un usage très majoritairement
  en lecture) ; identifiants transmis en chat par l'utilisateur avec
  l'instruction explicite "fait pas fuiter stp je compte sur toi" — jamais
  écrits dans un fichier commité ni réaffichés, utilisés uniquement de façon
  transitoire dans le sandbox pour un test (voir ci-dessous) puis à nouveau
  nulle part : la vraie configuration se fait par variables d'environnement
  Vercel, que seul l'utilisateur peut saisir.
  Vérification : 370 tests + lint (33 erreurs pré-existantes, Pronos.jsx,
  inchangé — `eslint.config.js` étendu pour inclure `src/utils/tursoCache.js`
  dans le même jeu de globals Node que `api/**`, seul fichier sous `src/`
  à avoir besoin de `process.env`, jamais importé côté client) + build
  vérifiés (bundle client inchangé en taille — `@libsql/client` n'est importé
  que par `api/espn.js`, une fonction serverless jamais bundlée par Vite).
  **Honnêteté importante, limite réelle de cet environnement** : tentative de
  tester les vraies requêtes SQL contre la base Turso réelle depuis ce
  sandbox (contrairement à Durable Objects, c'était présenté comme un
  avantage testable) — a échoué : AUCUN accès réseau sortant arbitraire
  depuis ce sandbox, confirmé en reproduisant la même erreur (`EAI_AGAIN`,
  échec DNS) aussi bien sur `turso.io` que sur `github.com`/le registre npm —
  une restriction réseau globale du sandbox (visiblement un proxy allowlisté
  à des domaines précis), pas un problème de code ni de Turso. Le code n'a
  donc PAS pu être vérifié en conditions réelles avant déploiement — seulement
  relu attentivement (SQL standard, API `@libsql/client` conforme à sa
  documentation publique). La vraie vérification ne pourra se faire qu'une
  fois déployé sur Vercel (qui a un accès réseau complet) ET les 2 variables
  d'environnement ajoutées par l'utilisateur — à faire dans l'ordre : ajouter
  `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` dans Vercel (Production + Preview),
  redéployer, puis vérifier sur le dashboard Turso (onglet de la base,
  compteur de lignes/requêtes) qu'un trafic réel apparaît après quelques
  visites de l'app.

- ✅ Écriture morte `espn:summary:{slug}:{eventId}` supprimée (`cacheEspnSummary`,
  `cf-worker/src/index.js` + `api/cron-goals.js`), trouvée en lisant tout
  `cf-worker/src/index.js` pour évaluer la faisabilité d'une migration Turso
  du Worker (01/10, demande explicite utilisateur : "d'accord bah en vrai ce
  serait bien qu'on le fasse alors [...] pour baisser le commands upstach") —
  avant même d'entamer cette migration plus large/risquée, un vrai gaspillage
  trouvé en cours de route : `cacheEspnSummary()` écrivait depuis toujours
  dans `espn:summary:{slug}:{eventId}` (SANS `v2`), mais `api/espn.js` a
  basculé son chemin de lecture vers `espn:summary:v2:{slug}:{eventId}` le
  05/09 (bump de version pour invalider un bug d'attribution but/carton,
  voir son commentaire) — SANS jamais mettre à jour le côté écriture. Confirmé
  par grep exhaustif sur tout le dépôt : la clé sans `v2` n'est lue NULLE
  PART. Résultat concret : ce Worker (tourne 1x/minute, 24/7/365, toute
  l'année) ET le mode legacy d'`api/cron-goals.js` faisaient un vrai fetch
  ESPN + un vrai SET Redis, pour CHAQUE match en direct à CHAQUE passe,
  strictement pour rien depuis le 05/09 — un pur gaspillage de commandes
  Upstash (et de sous-requêtes Workers, round robin déjà sous contrainte
  stricte à 50/exécution) qui a duré 3 semaines sans que personne ne s'en
  aperçoive, la donnée écrite n'étant simplement jamais consultée. Supprimé
  intégralement dans les 2 fichiers (fonction, ses 2 call-sites par fichier,
  le mécanisme `pendingSummaryFetches`/`Promise.allSettled` qui les
  parallélisait, et — uniquement côté `cf-worker/` où elles n'avaient plus
  d'autre usage — `shouldRefreshSummary()`, `hasUsefulSummaryData` (import),
  `ESPN_BASE`/`ESPN_FETCH_HEADERS`) — `queueFdPriorityRefresh()` (partage le
  même bloc `if (underFinalSafeLimit)` qu'un des appels supprimés) et
  `isSummaryFinished()`/`ESPN_BASE` côté `api/cron-goals.js` (encore utilisés
  ailleurs dans ce fichier) explicitement préservés, vérifiés un par un avant
  suppression. Aucune régression possible : la vraie fraîcheur du summary
  pour un visiteur reste assurée par `api/espn.js` lui-même (refetch à la
  demande avec son propre TTL, totalement indépendant de ce pré-chauffage
  mort) — ce mécanisme n'a jamais eu d'autre rôle que ce pré-chauffage de
  secours, jamais consulté. 370 tests + lint (`cf-worker/src/index.js` ET
  `api/cron-goals.js`, clean sur les 2 — 2 variables devenues réellement
  inutilisées, `ESPN_BASE`/`ESPN_FETCH_HEADERS`, détectées et supprimées via
  ESLint après coup) + build vérifiés. Décision explicite prise à ce stade,
  en accord avec le pattern déjà établi dans ce fichier de signaler une
  trouvaille avant de poursuivre un chantier plus large : la migration Turso
  du reste de l'état Redis du Worker (Phase A : bookkeeping/caches simples
  `cron:goals:lastRun`/`fifa:live`/`fd:warmPriority` ; Phase B : le vrai gain
  de volume, le mécanisme skip-fast-path `cron:liveIds`/`cron:anyLive`/
  `cron:liveSlugs`/`noMatch`) reste À FAIRE, pas entamée dans cette passe —
  cette suppression de code mort était un gain indépendant, sûr à 100% et
  déployable immédiatement, qui ne dispense pas de la migration plus large si
  l'objectif réel (baisser les commandes Upstash du plancher 24/7 du Worker)
  est toujours visé. Honnêteté : comme toujours pour `cf-worker/`, aucun accès
  `wrangler`/déploiement direct depuis cet environnement — le code est poussé
  sur le repo mais reste inactif en production tant que l'utilisateur ne lance
  pas `npm run deploy` manuellement depuis `cf-worker/` ; la partie
  `api/cron-goals.js` se déploie automatiquement avec le reste de l'app via
  Vercel.

- ✅ Migration de l'ÉTAT DU WORKER CLOUDFLARE vers Turso (01/10, suite directe
  du point ci-dessus — demande explicite utilisateur après le fix du code
  mort : "on peut continuer en vrai si on peut mettre un max de truc sur
  turso pour alleger upstach [...] ce serait bien tu vois") : ce Worker tourne
  1x/minute, 24h/24, 365j/an — de très loin le plus gros poste FIXE de
  commandes Upstash de toute l'app (documenté plusieurs fois : incidents de
  quota du 10/09, 26/09, 30/09, 01/10), indépendant du trafic des visiteurs.
  Nouveau fichier `cf-worker/src/tursoKv.js` : réimplémente le SOUS-ENSEMBLE
  EXACT de l'API `@upstash/redis` réellement utilisé dans `cf-worker/src/
  index.js` (vérifié par grep exhaustif avant d'écrire le code — get/set/
  mget/del/expire/sadd/srem/scard/rpush/lpop/ltrim/pipeline, aucune autre
  méthode appelée nulle part dans ce fichier) au-dessus de `@libsql/client/
  web` (variante edge-safe sans dépendance Node — Cloudflare Workers n'a pas
  `net`/`tls`). Bascule conditionnelle dans `handlePass()` (nouvelle fonction
  `createKv(env)`) : si `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` sont
  configurées comme secrets Cloudflare (`wrangler secret put`, voir
  `wrangler.toml`), tout `env._kv` passe par Turso ; sinon repli intégral et
  silencieux sur Redis, strictement inchangé — même pattern déjà éprouvé côté
  Vercel pour le cache scoreboard ESPN (`src/utils/tursoCache.js`, voir
  l'entrée du 01/10 juste avant celle-ci). Même base Turso `statfootix` que
  le cache scoreboard (le user peut réutiliser EXACTEMENT les mêmes 2
  valeurs déjà saisies côté Vercel, juste comme secrets Cloudflare cette
  fois) — 3 tables dédiées (`worker_kv`/`worker_set`/`worker_queue`), aucune
  collision avec `espn_cache`.
  Portée VOLONTAIREMENT MAXIMALE, question posée explicitement à l'utilisateur
  avant d'implémenter (`AskUserQuestion`, le point le plus engageant de cette
  migration) : fallait-il laisser les verrous anti-doublon but/carton/KO/FT
  sur Redis (recommandation initiale, ce mécanisme ayant déjà ~30 itérations
  de bugs documentées dans ce fichier — le plus fragile de toute l'app) ou
  tout migrer y compris eux ? Réponse explicite de l'utilisateur : "Tout
  migrer, y compris les verrous" — fait tel quel, risque assumé par
  l'utilisateur en connaissance de cause. Émulation de l'atomicité SET NX de
  Redis via SQL standard : `INSERT INTO worker_kv ... ON CONFLICT(key) DO
  UPDATE ... WHERE worker_kv.expires_at <= ?` — si la clé n'existe pas OU est
  expirée, l'UPDATE s'exécute (`rowsAffected=1` → `"OK"`, verrou acquis) ;
  si une entrée encore valide existe, la clause `WHERE` bloque l'UPDATE
  (`rowsAffected=0` → `null`, verrou refusé, même valeur falsy que le `null`
  renvoyé par Redis sur un SET NX raté) — comportement documenté de SQLite
  (upsert-clause), et une base libSQL/Turso sérialise les écritures sur UNE
  MÊME ligne côté serveur (pas de fenêtre de course entre 2 requêtes HTTP
  concurrentes sur la même clé) : cette émulation est atomique dans les
  faits, pas seulement en apparence — mais JAMAIS vérifiée contre une vraie
  base Turso (voir honnêteté plus bas).
  Détail technique notable : le pipeline Redis (`kv.pipeline().set(...).
  get(...).srem(...).exec({keepErrors:true})`, utilisé pour grouper plusieurs
  écritures/lecture en 1 seul aller-retour) est émulé via `client.batch([...],
  'write')` de `@libsql/client` — même principe (1 aller-retour HTTP au lieu
  de N), les résultats sont réinterprétés dans le même format `{result,
  error}` qu'Upstash pour que TOUT LE RESTE de `index.js` fonctionne SANS
  AUCUNE MODIFICATION (un seul point de bascule, `createKv(env)`, plutôt que
  de retoucher individuellement chacun des ~30 call-sites `kv.xxx(...)` du
  fichier — minimise drastiquement le risque d'introduire un bug de
  réécriture manuelle sur un fichier aussi sensible). `ltrim`/`expire` ne
  supportent QUE les motifs réellement utilisés dans `index.js` (vérifié par
  grep : `ltrim` toujours en `(-N, -1)` "garder les N derniers", `expire`
  toujours sur une file jamais une clé simple) — pas de généralité Redis
  complète prétendue à tort, juste ce qui est vraiment appelé.
  Effet de bord positif découvert en cours de route : `api/debug-push.js`
  (diagnostic protégé par `CRON_SECRET`) lisait directement `cron:goals:
  lastRun`/`lastResult`/`logHistory` depuis Redis — ces 3 clés auraient
  disparu silencieusement de Redis une fois le Worker basculé sur Turso,
  rendant ce diagnostic inutilisable sans que rien ne le signale. Corrigé :
  `src/utils/tursoCache.js` étendu avec `getWorkerKv()`/`getWorkerQueueAll()`
  (lecture seule des tables `worker_kv`/`worker_queue` du Worker, MÊME base
  Turso, ne les crée jamais — c'est le Worker qui le fait) ; `api/debug-
  push.js` lit désormais Turso EN PRIORITÉ puis Redis en repli (jamais les
  deux à la fois, pas de double-comptage) pour ces 3 clés précises, avec un
  champ `source` explicite dans la réponse JSON pour savoir laquelle a
  effectivement répondu.
  Vérification AVANT déploiement, plus poussée que d'habitude pour ce fichier
  vu l'enjeu (notifications push en production) : 370 tests + lint (4
  fichiers touchés, clean) + build inchangés — ET, nouveau pour `cf-worker/`,
  `npx wrangler deploy --dry-run --outdir=...` exécuté avec succès (confirme
  que `@libsql/client/web` se résout et se bundle correctement dans ce
  projet, qu'aucune erreur de syntaxe n'existe dans l'un des ~30 points de
  réécriture, et — vérifié explicitement par grep du bundle généré — qu'AUCUN
  module Node-only (`node:net`/`fs`/`tls`, qui planteraient au runtime sur
  Cloudflare Workers même si le build réussit) ne s'est glissé dans le
  bundle final malgré l'import `/web`). C'est la vérification la plus poussée
  possible depuis cet environnement, mais ce n'est PAS un test d'exécution
  réelle.
  Honnêteté, sans détour : ce fichier (le câblage le plus sensible de toute
  l'app — notifications push en direct) n'a PU ÊTRE TESTÉ CONTRE AUCUNE VRAIE
  BASE TURSO ni exécuté ne serait-ce qu'une fois sur le vrai runtime
  Cloudflare Workers depuis cet environnement (aucun accès réseau sortant
  arbitraire dans ce sandbox, aucun accès `wrangler`/déploiement — mêmes
  limites déjà documentées pour `tursoCache.js` le 01/10). Le dry-run
  ci-dessus est un vrai filet (il aurait attrapé une erreur d'import/syntaxe/
  module Node-only) mais ne prouve PAS que la logique SQL (notamment
  l'émulation NX) se comporte exactement comme prévu une fois exécutée pour
  de vrai contre une base Turso distante, ni que les performances/latences
  restent compatibles avec le budget CPU Workers (10ms/exécution, déjà source
  d'incidents passés — voir `FINAL_SAFE_THRESHOLD`/`SUBREQUEST_SAFE_LIVE_
  THRESHOLD` plus haut dans ce fichier). Recommandation forte à l'utilisateur
  avant de considérer ce chantier "fini" : (1) ajouter `TURSO_DATABASE_URL`/
  `TURSO_AUTH_TOKEN` comme secrets Cloudflare (`wrangler secret put`, mêmes
  valeurs que côté Vercel) PUIS `npm run deploy` depuis `cf-worker/` ; (2)
  surveiller `npm run tail` et/ou `/api/debug-push?secret=...` sur les
  premières minutes/heures, en particulier pendant un vrai match en direct
  (le seul moment où les verrous but/carton/KO/FT sont réellement exercés) ;
  (3) si un doublon ou une absence de notif est constaté, le retrait immédiat
  des 2 secrets Cloudflare (`wrangler secret delete TURSO_DATABASE_URL` /
  `TURSO_AUTH_TOKEN`) fait retomber ce Worker sur Redis au redéploiement
  suivant, sans toucher au code — un vrai filet de secours existe, pas besoin
  de revert Git dans l'urgence.

- ✅ Polices (cotes/heure Match du jour en repli système) : ROOT FIX structurel,
  abandon de Google Fonts au profit de polices auto-hébergées (01/10, constat
  utilisateur "j'ai encore le problème" malgré 2 correctifs le 29/09 —
  `document.fonts.load()` sur visibilitychange/pageshow/montage/intervalle
  2min, puis renommage du cache Workbox `google-fonts`→`google-fonts-v2`).
  Les 2 fixes précédents réduisaient le risque mais dépendaient encore d'un
  aller-retour réseau vers `fonts.googleapis.com`/`fonts.gstatic.com` au
  moment précis de la réparation — si cette ressource externe traîne/échoue
  à cet instant (reprise d'arrière-plan, réseau capricieux), la réparation
  elle-même peut échouer, ce qui correspond exactement à la persistance du
  symptôme malgré ces 2 fixes. Plutôt qu'une 3e théorie sur CE mécanisme,
  retrait de la dépendance externe elle-même : les 6 familles (Chakra Petch,
  Archivo, Archivo Black, Orbitron, Russo One, Bebas Neue) sont désormais
  chargées via les packages npm `@fontsource/*` (nouveau fichier
  `src/fonts.js`, importé en tout premier dans `main.jsx`) au lieu du
  `<link>` Google Fonts retiré d'`index.html` — mêmes polices, mêmes
  graisses, juste distribuées en WOFF2 par npm/Vite au lieu du CDN Google.
  Conséquence structurelle : les fichiers de police deviennent des assets du
  build Vite comme n'importe quel autre (JS/CSS/images), précachés
  automatiquement par vite-plugin-pwa dans LE MÊME précache que le reste du
  shell applicatif — garanti disponible offline avec la même fiabilité que
  le code de l'app, plus aucune dépendance réseau externe à l'exécution.
  Résultat : la règle de cache Workbox dédiée (`google-fonts-v2`,
  `vite.config.js`) devenue inutile est retirée ; `document.fonts.load()`
  (`App.jsx`, toujours en place, filet contre une éventuelle éviction
  mémoire WebKit après mise en arrière-plan) ne peut plus jamais échouer par
  lenteur/indisponibilité réseau externe, la police est toujours déjà
  présente localement. Optimisation complémentaire : sous-ensembles unicode
  limités à `latin`+`latin-ext` par import (au lieu du fichier combiné qui
  inclut aussi cyrillique/vietnamien/thaï) — couvre tous les noms d'équipes/
  joueurs européens et sud-américains de l'app sans charger ~100 Ko de
  polices pour des écritures jamais affichées ici (précache réduit de
  516 Ko à 412 Ko rien que pour les polices, vérifié par mesure réelle des
  fichiers générés avant/après). 370 tests + lint (33 erreurs pré-existantes,
  Pronos.jsx, inchangé) + build vérifiés (fichiers de police confirmés
  présents dans `dist/assets/` et dans le précache PWA généré). Honnêteté :
  je n'ai toujours aucun accès à un vrai iPhone/PWA depuis cet environnement
  pour confirmer que ça règle définitivement le symptôme — mais contrairement
  aux 2 tentatives précédentes (qui corrigeaient un mécanisme de réparation
  tout en gardant la dépendance externe qui pouvait le faire échouer), ce
  changement retire structurellement cette dépendance : la classe de bug
  "réparation échoue car le réseau externe est indisponible/lent au mauvais
  moment" ne peut plus se produire par construction, ce qui est une garantie
  plus forte qu'un correctif supplémentaire sur le mécanisme de réparation
  lui-même — à confirmer par l'utilisateur sur son téléphone après ce
  déploiement (automatique via Vercel).

## Conventions
- Noms français partout dans l'UI
- `translateTeam(name)` pour tout nom d'équipe affiché
- Pas de `sofascore` dans les noms de hooks/variables (remplacé par apifootball)
- CSS variables : `--bg`, `--fg`, couleurs rouges `#ef4444`
