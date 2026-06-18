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
        // Proxy ESPN : /espn?slug=fra.1[&dates=YYYYMMDD] → site.api.espn.com (pas de clé requise)
        // Le param dates est optionnel : sans lui → matchs du jour ; avec lui → matchs de cette date.
        // En prod, géré par netlify/functions/espn.js — ce proxy sert uniquement en dev local.
        '/espn': {
          target: 'https://site.api.espn.com',
          changeOrigin: true,
          rewrite: (path) => {
            const qs     = path.includes('?') ? path.split('?')[1] : ''
            const params = new URLSearchParams(qs)
            const slug   = params.get('slug') ?? ''
            const dates  = params.get('dates')
            const base   = `/apis/site/v2/sports/soccer/${slug}/scoreboard`
            return dates ? `${base}?dates=${dates}` : base
          },
        },
        // Proxy api-football.com : /apifootball?live=all → v3.football.api-sports.io
        // La clé APIFOOTBALL_KEY est injectée côté serveur Vite (jamais dans le bundle).
        // En prod, géré par netlify/functions/apifootball.js.
        '/apifootball': {
          target: 'https://v3.football.api-sports.io',
          changeOrigin: true,
          rewrite: (path) => {
            const qs = path.includes('?') ? `?${path.split('?')[1]}` : ''
            return `/fixtures${qs}`
          },
          headers: { 'x-apisports-key': env.APIFOOTBALL_KEY },
        },
      },
    },
  }
})
