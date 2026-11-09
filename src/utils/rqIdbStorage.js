// Stockage du cache React Query dans IndexedDB (10/11, demande utilisateur — point 3 du bilan).
//
// Avant : un seul bloc `REACT_QUERY_OFFLINE_CACHE` dans localStorage (812 ko mesurés sur
// l'iPhone de l'utilisateur), relu et réécrit EN ENTIER de façon synchrone — au démarrage
// (bloque l'affichage le temps de le lire et de le décoder) puis à chaque mise à jour d'une
// requête, et qui occupait à lui seul une grosse part du quota localStorage d'iOS (~5 Mo,
// voir storageGuard.js). Désormais : IndexedDB (lecture/écriture asynchrones, hors quota
// localStorage), via @tanstack/query-async-storage-persister.
//
// Reprise : à la première lecture, si IndexedDB n'a rien mais que l'ancien bloc existe dans
// localStorage, il est recopié dans IndexedDB puis retiré de localStorage SEULEMENT après
// une écriture réussie — même principe que la reprise de localCache.js (aucune perte).
// Sans IndexedDB (navigation privée stricte, tests) : repli sur localStorage, comme avant.
const DB_NAME = 'statfootix-rq'
const STORE = 'kv'

let dbPromise = null
function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function idbRequest(db, mode, run) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    } catch (e) {
      reject(e)
    }
  })
}

const ls = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { localStorage.setItem(k, v) },
  del: (k) => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}

export const rqIdbStorage = {
  async getItem(key) {
    const db = await openDb()
    if (!db) return ls.get(key)
    try {
      const value = await idbRequest(db, 'readonly', s => s.get(key))
      if (value != null) return value
      const legacy = ls.get(key)
      if (legacy != null) {
        try {
          await idbRequest(db, 'readwrite', s => s.put(legacy, key))
          ls.del(key)
        } catch { /* reprise ratée : on garde l'ancien bloc, réessai au prochain lancement */ }
      }
      return legacy
    } catch {
      return ls.get(key)
    }
  },
  async setItem(key, value) {
    const db = await openDb()
    if (!db) return ls.set(key, value)
    try {
      await idbRequest(db, 'readwrite', s => s.put(value, key))
      ls.del(key)
    } catch {
      ls.set(key, value)
    }
  },
  async removeItem(key) {
    ls.del(key)
    const db = await openDb()
    if (!db) return
    try { await idbRequest(db, 'readwrite', s => s.delete(key)) } catch { /* ignore */ }
  },
}
