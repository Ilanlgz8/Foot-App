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
  .lmp__heroTintC` dans `LiveMatchPage.css`, gardé identique comme toujours) : remplacement du
  `radial-gradient` par une couleur plate `rgba(0,0,0,0.22)` en 1er calque — une couleur unie
  (sans direction ni fondu) posée comme calque `background` couvre uniformément TOUTE la surface
  de la carte, contrairement à un `radial-gradient` qui est structurellement concentré autour de
  son centre. Opacité légèrement réduite (32%→22%) par rapport au voile centré précédent : un
  assombrissement uniforme sur 100% de la carte à la même opacité qu'un voile concentré sur ~20%
  du centre aurait rendu l'ensemble trop sombre, y compris les 2 paliers noirs des coins déjà
  bien noirs — 22% reste un voile "léger" perceptible partout sans écraser le fondu déjà validé.
  Le dégradé linéaire principal (2e calque, noir→orange sombre→orange vif→orange sombre→noir)
  reste inchangé. 360 tests + lint (33 erreurs pré-existantes, Pronos.jsx, inchangé) + build
  vérifiés. Honnêteté : rendu jamais vu en direct avant ce déploiement (juste lecture du CSS) — à
  confirmer par l'utilisateur. Portée : UEL uniquement (UECL non mentionné, comme toutes les
  itérations précédentes de ce dégradé).

## Conventions
- Noms français partout dans l'UI
- `translateTeam(name)` pour tout nom d'équipe affiché
- Pas de `sofascore` dans les noms de hooks/variables (remplacé par apifootball)
- CSS variables : `--bg`, `--fg`, couleurs rouges `#ef4444`
