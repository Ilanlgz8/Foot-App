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

## Conventions
- Noms français partout dans l'UI
- `translateTeam(name)` pour tout nom d'équipe affiché
- Pas de `sofascore` dans les noms de hooks/variables (remplacé par apifootball)
- CSS variables : `--bg`, `--fg`, couleurs rouges `#ef4444`
