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

// ⚠️ AJOUT : un vrai `localStorage` navigateur expose ses clés comme des
// propriétés énumérables — `Object.keys(localStorage)` fonctionne nativement
// (comportement spécial des objets Storage, indépendant de getItem/setItem).
// `getRecentlyFinishedMatches` (matchStateTracker.js) en dépend pour lister
// toutes les entrées `foot_recentft_*`. La classe MemoryStorage seule ne le
// reproduit pas (Object.keys() ne verrait que le champ interne `_store`,
// jamais couvert par un test jusqu'ici) — un Proxy comble cet écart pour que
// le comportement testé corresponde à celui d'un vrai navigateur.
function createLocalStorage() {
  const instance = new MemoryStorage()
  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target) && target._store.has(prop)) {
        return target._store.get(prop)
      }
      return Reflect.get(target, prop, receiver)
    },
    has(target, prop) {
      return target._store.has(prop) || Reflect.has(target, prop)
    },
    ownKeys(target) {
      return [...target._store.keys()]
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && target._store.has(prop)) {
        return { enumerable: true, configurable: true, value: target._store.get(prop) }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  })
}

globalThis.localStorage = createLocalStorage()
globalThis.window = globalThis.window ?? {}
