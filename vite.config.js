import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// loadEnv charge toutes les variables de .env.local côté Node (pas dans le bundle navigateur)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
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
            const base = `/apis/site/v2/sports/soccer/${slug}/scoreboard`
            return dates ? `${base}?dates=${dates}` : base
          },
        },
        // Proxy SofaScore : /sofascore?path=... → api.sofascore.com (pas de clé requise)
        // En prod, géré par netlify/functions/sofascore.js.
        '/sofascore': {
          target: 'https://api.sofascore.com',
          changeOrigin: true,
          rewrite: (path) => {
            const qs     = path.includes('?') ? path.split('?')[1] : ''
            const params = new URLSearchParams(qs)
            const sfPath = params.get('path') ?? ''
            return `/api/v1/${sfPath}`
          },
          headers: {
            'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer':         'https://www.sofascore.com/',
            'Origin':          'https://www.sofascore.com',
            'Accept':          'application/json, text/plain, */*',
            'Accept-Language': 'fr-FR,fr;q=0.9',
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
