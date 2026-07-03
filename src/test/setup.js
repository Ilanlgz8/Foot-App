// Setup exécuté avant tous les fichiers de test (voir vitest.config.js).
//
// matchUtils.js/matchStateTracker.js accèdent à `localStorage` et `window`
// directement (code écrit pour tourner dans un navigateur) — sans polyfill,
// les tests plantent dès l'import (localStorage/window non définis en
// environnement Node par défaut). On simule le strict nécessaire ici plutôt
// que d'ajouter une dépendance jsdom complète, pour des tests rapides.

class MemoryStorage {
  constructor() { this._store = new Map() }
  getItem(key)        { return this._store.has(key) ? this._store.get(key) : null }
  setItem(key, value)  { this._store.set(key, String(value)) }
  removeItem(key)      { this._store.delete(key) }
  clear()              { this._store.clear() }
  key(i)                { return [...this._store.keys()][i] ?? null }
  get length()          { return this._store.size }
}

globalThis.localStorage = new MemoryStorage()
globalThis.window = globalThis.window ?? {}
