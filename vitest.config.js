import { defineConfig } from 'vitest/config'

// Config séparée de vite.config.js (qui charge le plugin PWA + les proxies
// de dev) : les tests unitaires n'ont besoin d'aucun de ces plugins, et les
// mélanger ajoute de la lenteur/complexité pour rien.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.js'],
  },
})
