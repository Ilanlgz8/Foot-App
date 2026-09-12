# StatFootix — PWA Football

React + Vite + Vercel. Déployé sur `https://statfootix.vercel.app`.

## Stack
- **Frontend** : React 18, Vite, React Router, React Query, vite-plugin-pwa (Workbox)
- **APIs** : ESPN (primaire, live), football-data.org (matchs/classements). api-football (compos) **désactivé définitivement** (`PERMANENTLY_DISABLED` dans `api/apifootball.js` — compte suspendu à répétition, ESPN/FD.org couvrent déjà l'essentiel en fallback). xG retiré (`api/fifa-live.js`) : jamais présent en pratique dans le boxscore ESPN, aucune intégration FotMob n'a jamais existé malgré une ancienne mention ici
- **Backend Vercel** : `/api/*` serverless functions (12/12 — limite dure Hobby, plus aucun slot libre : tout nouvel endpoint doit être fusionné dans un fichier existant)
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
- `CF_ACCOUNT_ID`, `CF_AI_API_TOKEN` — Cloudflare Workers AI (Assistant IA, `api/apifootball.js` mode `ask`). Même compte Cloudflare que `cf-worker/` : ID de compte visible dans le dashboard Cloudflare (barre latérale droite) ; token créé dans dashboard Cloudflare → "Manage Account" → "Account API Tokens" → "Create Token" → template "Workers AI" (ou permission personnalisée "Account.Workers AI: Read/Edit")

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

## Conventions
- Noms français partout dans l'UI
- `translateTeam(name)` pour tout nom d'équipe affiché
- Pas de `sofascore` dans les noms de hooks/variables (remplacé par apifootball)
- CSS variables : `--bg`, `--fg`, couleurs rouges `#ef4444`
