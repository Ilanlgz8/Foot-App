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
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/cron-goals/, /^\/news$/, /^\/espn$/, /^\/apifootball$/],
          // Nouveau SW prend le contrôle immédiatement → pas besoin de vider le cache Safari
          skipWaiting: true,
          clientsClaim: true,
          // Injecte les handlers push dans le SW généré par workbox
          // sw-push.js est un fichier vanilla JS pur (pas d'import) → compatible generateSW
          importScripts: ['/sw-push.js'],
          runtimeCaching: [
            // Fonts Google → cache long, jamais de fetch inutile
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: { cacheName: 'google-fonts', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
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
        // Proxy football-data.org : la clé est ajoutée ici côté serveur Vite, pas dans le bundle
        '/api': {
          target: 'https://api.football-data.org',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          headers: { 'X-Auth-Token': env.API_KEY },
        },
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
