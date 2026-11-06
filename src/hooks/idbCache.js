// idbCache.js — cache disque IndexedDB pour les GROS caches qui ne sont lus que dans des fonctions async
// (06/11, constat utilisateur : la forme récente disparaît par moments, une compétition puis une autre).
// Cause : le stockage local (localStorage, ~5 Mo sur iPhone) déborde ; le garde-fou (storageGuard.js)
// supprime alors de gros caches — dont les matchs qui servent à calculer la forme — et l'app doit les
// retélécharger. IndexedDB a une limite bien plus large : on y déplace les saisons passées des
// confrontations directes (h2hHistory_*) et des divisions inférieures (lowerDiv_*), ~1,6 M caractères
// mesurés sur le téléphone de l'utilisateur, pour laisser la place aux caches lus au démarrage.
// Même contrat que readCache/writeCache (exp, savedAt). Si IndexedDB est indisponible (navigation
// privée stricte, tests), repli transparent sur localStorage.
import { readCache, writeCache, removeCache } from './localCache'

const DB_NAME = 'statfootix-cache'
const STORE = 'kv'
const hasIdb = typeof indexedDB !== 'undefined'
let dbPromise = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }).catch(e => { dbPromise = null; throw e })
  }
  return dbPromise
}

async function idbGet(key) {
  const db = await openDb()
  return new Promise(resolve => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    r.onsuccess = () => resolve(r.result ?? null)
    r.onerror = () => resolve(null)
  })
}

async function idbPut(key, entry) {
  const db = await openDb()
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry, key)
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
    tx.onabort = () => resolve(false)
  })
}

// Donnée encore valide (comme readCache), sinon null. Une ancienne copie encore en localStorage est
// déplacée vers IndexedDB à la volée (aucun retéléchargement).
export async function readBigCache(key) {
  if (!hasIdb) return readCache(key)
  try {
    const e = await idbGet(key)
    if (e && Date.now() <= e.exp) return e.data
    const legacy = readCache(key)
    if (legacy != null) {
      const raw = (() => { try { return JSON.parse(localStorage.getItem('foot_' + key)) } catch { return null } })()
      if (raw && await idbPut(key, raw)) removeCache(key)
      return legacy
    }
    return null
  } catch {
    return readCache(key)
  }
}

export async function writeBigCache(key, data, ttlMs) {
  if (!hasIdb) { writeCache(key, data, ttlMs); return }
  try {
    const ok = await idbPut(key, { data, exp: Date.now() + ttlMs, savedAt: Date.now() })
    if (!ok) writeCache(key, data, ttlMs)
  } catch {
    writeCache(key, data, ttlMs)
  }
}

// Au lancement (différé) : déplace vers IndexedDB toutes les copies restantes de ces caches.
const BIG_PREFIXES = ['foot_h2hHistory_', 'foot_lowerDiv_']
export async function migrateBigCachesToIdb() {
  if (!hasIdb) return
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && BIG_PREFIXES.some(p => k.startsWith(p))) keys.push(k)
    }
    for (const k of keys) {
      let raw = null
      try { raw = JSON.parse(localStorage.getItem(k)) } catch { /* illisible */ }
      if (raw && typeof raw.exp === 'number' && await idbPut(k.slice(5), raw)) localStorage.removeItem(k)
    }
  } catch { /* pas bloquant */ }
}
