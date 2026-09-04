import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// loadEnv charge toutes les variables de .env.local côté Node (pas dans le bundle navigateur)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['statfootix.png', 'statfootix.png', 'statfootix.png'],
        manifest: {
          name: 'StatFootix',
          short_name: 'StatFootix',
          description: 'Scores et stats foot en direct',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          icons: [
            { src: '/statfootix.png', sizes: '192x192', type: 'image/png' },
            { src: '/statfootix.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          // ⚠️ `navigateFallback: '/index.html'` RETIRÉ (04/09). C'était la
          // cause racine de "sur mon tel en PWA je vois encore comme avant" :
          // il faisait servir TOUTE navigation par l'index.html du PRÉCACHE,
          // donc celui figé à l'installation du service worker. Or index.html
          // est le seul fichier qui désigne les bundles à charger (leurs noms
          // sont hachés) — servir un index.html périmé, c'est charger
          // indéfiniment l'ancienne app, quel que soit le nombre de
          // déploiements. Reproduit en direct : la page tournait sur
          // index-Do0CXG98.js pendant que le serveur servait index-CacS4bbB.js.
          // Il est remplacé par une route NetworkFirst sur les navigations
          // (voir runtimeCaching plus bas). Il FALLAIT le retirer et pas
          // seulement ajouter la route : workbox enregistre la NavigationRoute
          // de navigateFallback EN PREMIER (vérifié dans le sw.js généré), et
          // comme elle capte toutes les navigations, aucune règle ajoutée
          // après n'aurait jamais été atteinte.
          //
          // Contrepartie assumée : hors ligne, une navigation vers une URL
          // jamais ouverte en ligne depuis l'installation n'a plus de repli et
          // échouera. L'accueil, lui, fonctionne dès la première ouverture en
          // ligne (la route met le HTML en cache au passage). Compromis
          // raisonnable pour une app de scores en direct, qui n'a de toute
          // façon pas grand-chose à montrer sans réseau — et sans commune
          // mesure avec le fait de rester bloqué sur une vieille version.
          //
          // `null` explicite et non simple omission : vite-plugin-pwa réinjecte
          // sa valeur par défaut ('index.html') quand la clé est absente — la
          // première tentative, qui se contentait de supprimer la ligne,
          // laissait la NavigationRoute en place dans le sw.js généré.
          navigateFallback: null,
          // Nouveau SW prend le contrôle immédiatement → pas besoin de vider le cache Safari
          skipWaiting: true,
          clientsClaim: true,
          // ⚠️ AJOUT (constat utilisateur, 02/09 : "pourquoi j'ai un écran
          // blanc quand je lance l'app ?"). Il manquait, et c'est exactement
          // le cas qu'il couvre : sans lui, workbox NE SUPPRIME PAS les
          // anciens précaches à chaque nouvelle version. Ils s'empilent, et
          // une version installée peut se retrouver à servir un index.html
          // gardé en cache qui référence des fichiers JS dont le hash n'existe
          // plus sur le serveur — le module ne charge pas, React ne monte
          // jamais, page blanche. L'ErrorBoundary ne peut rien y faire : il
          // n'attrape que les erreurs de rendu d'une app DÉJÀ montée.
          // Le risque est proportionnel au nombre de déploiements rapprochés
          // (une quinzaine aujourd'hui), ce qui colle au moment où le problème
          // est apparu.
          cleanupOutdatedCaches: true,
          // Injecte les handlers push dans le SW généré par workbox
          // sw-push.js est un fichier vanilla JS pur (pas d'import) → compatible generateSW
          importScripts: ['/sw-push.js'],
          runtimeCaching: [
            // ⚠️ AJOUT (04/09, cause RACINE de "sur mon tel en PWA je vois
            // encore comme avant", reproduite en direct dans un navigateur :
            // la page tournait sur index-Do0CXG98.js pendant que le serveur
            // servait index-CacS4bbB.js, avec un service worker actif).
            //
            // Sans cette règle, une navigation était servie par
            // `navigateFallback` — c'est-à-dire par l'index.html du PRÉCACHE,
            // donc toujours la version figée au moment où le service worker a
            // été installé. Or index.html est le seul fichier qui désigne les
            // bundles à charger (leurs noms sont hachés) : servir un index.html
            // périmé, c'est charger indéfiniment l'ancienne app, même après dix
            // déploiements. Tout le reste du dispositif (skipWaiting,
            // clientsClaim, update() au premier plan) ne sert à rien tant que
            // ce point-là n'est pas réglé : il faut d'abord que le navigateur
            // remarque un nouveau /sw.js, ce qu'une PWA installée peut
            // retarder très longtemps.
            //
            // NetworkFirst inverse la priorité : le HTML est demandé au réseau
            // à chaque ouverture (une requête d'environ 1 Ko), et le précache
            // ne sert plus que de repli — hors ligne, ou si le réseau ne
            // répond pas sous 3 s. On garde donc le fonctionnement hors ligne
            // sans jamais servir une app périmée quand la connexion est là.
            // Le HTML est demandé au réseau à chaque ouverture (environ 1 Ko)
            // et le cache ne sert que de repli, hors ligne ou si le réseau ne
            // répond pas sous 3 s.
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'html-navigations',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 8 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Fonts Google → cache long, jamais de fetch inutile
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: { cacheName: 'google-fonts', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
            },
            // ⚠️ AJOUT (constat utilisateur : "les crest se rechargent à chaque
            // fois qu'on change de page, ça met parfois plusieurs secondes à
            // réapparaître") : blasons de clubs (crests.football-data.org),
            // drapeaux de pays (flagcdn.com) et logos ESPN de repli
            // (a.espncdn.com, NL/CAN/COPA) n'avaient AUCUNE règle de cache
            // côté service worker — chaque affichage repartait donc du cache
            // HTTP par défaut du navigateur (pas garanti, peut être vidé sous
            // pression mémoire, notamment iOS) au lieu d'être servi
            // instantanément par le SW. CacheFirst + longue durée : ces
            // images ne changent jamais une fois publiées (un blason ne
            // change pas en cours de tournoi), donc aucun risque de servir du
            // périmé — uniquement un gain de vitesse/fiabilité.
            {
              urlPattern: /^https:\/\/(crests\.football-data\.org|flagcdn\.com|a\.espncdn\.com)\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'team-crests',
                expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 180 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // ESPN — NetworkOnly : scores toujours en temps réel
            {
              urlPattern: /^https:\/\/site\.api\.espn\.com\/.*/i,
              handler: 'NetworkOnly',
            },
            // API internes (/api, /espn, /apifootball, /news) — NetworkOnly
            // ⚠️  urlPattern reçoit l'URL complète en prod (https://domain.com/api/...)
            //     → utiliser une fonction qui teste pathname plutôt qu'un regex ^/
            {
              urlPattern: ({ url }) =>
                ['/api', '/espn', '/apifootball', '/news'].some(p =>
                  url.pathname.startsWith(p)
                ),
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
    ],
    server: {
      proxy: {
        // ⚠️ SUPPRIMÉ (cause trouvée d'une VRAIE suspension récurrente du compte
        // football-data.org) : ce proxy '/api' → api.football-data.org datait
        // d'avant le refacto fdUrl.js (qui appelle désormais
        // /api/football?apiPath=... côté prod, protégé par MINUTE_CAP=5 +
        // spacing + circuit breaker dans api/football.js). Ce proxy dev, lui,
        // matchait encore tout /api/* et tapait DIRECTEMENT football-data.org
        // avec la vraie clé (.env.local), sans AUCUNE protection — et son
        // rewrite (path.replace(/^\/api/, '')) produisait en plus une route
        // invalide (/football?apiPath=... au lieu de /v4/...) pour le schéma
        // actuel, donc ne renvoyait jamais de vraies données. Concrètement :
        // chaque `npm run dev` envoyait, à chaque hook (useStandings,
        // useMatchs, useScorers, useTeamForm, useWcKnockout...), des requêtes
        // mal formées en rafale directement sur le vrai compte — exactement le
        // profil qu'un système anti-abus suspend. Zéro perte en le retirant :
        // il ne servait déjà à rien (aucune donnée exploitable en dev), il ne
        // faisait que consommer/mettre en danger le quota réel.
        // Proxy GNews : le token est injecté dans l'URL côté serveur Vite
        '/news': {
          target: 'https://gnews.io',
          changeOrigin: true,
          rewrite: (path) => {
            const qs = path.includes('?') ? path.split('?')[1] : ''
            const params = new URLSearchParams(qs)
            params.set('token', env.GNEWS_API_KEY)
            return `/api/v4/search?${params.toString()}`
          },
        },
        // Proxy ESPN : /espn?slug=fra.1[&dates=YYYYMMDD|&eventId=XXX] → site.api.espn.com
        // ?eventId → summary (stats live complètes) ; sinon → scoreboard (scores + statuts).
        // En prod, géré par api/espn.js (Vercel) — ce proxy sert uniquement en dev local.
        '/espn': {
          target: 'https://site.api.espn.com',
          changeOrigin: true,
          rewrite: (path) => {
            const qs      = path.includes('?') ? path.split('?')[1] : ''
            const params  = new URLSearchParams(qs)
            const slug    = params.get('slug') ?? ''
            const eventId = params.get('eventId')
            const dates   = params.get('dates')
            if (eventId) {
              return `/apis/site/v2/sports/soccer/${slug}/summary?event=${eventId}`
            }
            // &limit=100 : voir api/espn.js — sans ce paramètre, ESPN renvoie
            // des noms d'équipe placeholder pour les matchs à élimination
            // directe pas encore "résolus" (bug confirmé en prod).
            const base = `/apis/site/v2/sports/soccer/${slug}/scoreboard`
            return dates ? `${base}?dates=${dates}&limit=100` : `${base}?limit=100`
          },
        },
        // Proxy api-football.com : /apifootball?[_ep=endpoint&]...params... → v3.football.api-sports.io
        // Le param _ep sélectionne l'endpoint (défaut: "fixtures" pour compat ascendante).
        // La clé APIFOOTBALL_KEY est injectée côté serveur Vite (jamais dans le bundle).
        // En prod, géré par netlify/functions/apifootball.js.
        '/apifootball': {
          target: 'https://v3.football.api-sports.io',
          changeOrigin: true,
          rewrite: (path) => {
            const qs = path.includes('?') ? path.split('?')[1] : ''
            const params = new URLSearchParams(qs)
            const ep = params.get('_ep') ?? 'fixtures'
            params.delete('_ep')
            const remaining = params.toString()
            return `/${ep}${remaining ? '?' + remaining : ''}`
          },
          headers: { 'x-apisports-key': env.APIFOOTBALL_KEY },
        },
      },
    },
  }
})
