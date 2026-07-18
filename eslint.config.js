import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // 110 `catch {}` volontaires dans tout le projet (échec réseau ignoré
      // silencieusement en best-effort, pattern déjà présent et commenté un
      // peu partout — ex. lecture de .env.local dans scripts/backtest-prono.mjs)
      // — noyaient les vrais problèmes dans le bruit d'un audit ESLint complet.
      // Autres formes de bloc vide (if/for/while...) restent signalées comme
      // avant (vérifié : aucune dans le projet actuellement).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // api/ (fonctions serverless Vercel), cf-worker/ (Cloudflare Worker),
  // scripts/ (outils dev type backtest-prono.mjs) et vite.config.js tournent
  // sous Node, jamais dans un navigateur — 59 faux positifs `process`/`Buffer`
  // is not defined (code parfaitement valide en prod, juste vérifié avec le
  // mauvais jeu de globals) faussaient le compte total d'un audit ESLint
  // complet du projet.
  {
    files: ['api/**/*.js', 'cf-worker/**/*.js', 'scripts/**/*.mjs', 'vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Service worker (public/sw-push.js, importé via importScripts par Workbox)
  // : contexte ServiceWorkerGlobalScope, pas window — `clients`/`registration`
  // n'existent pas côté globals.browser.
  {
    files: ['public/sw-push.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
])
