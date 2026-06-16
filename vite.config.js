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
      },
    },
  }
})
