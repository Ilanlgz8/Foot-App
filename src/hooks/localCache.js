const PREFIX = 'foot_'

// Helper interne : parse l'entrée brute (sans vérification TTL)
function _parse(key) {
  try { return JSON.parse(localStorage.getItem(PREFIX + key)) } catch { return null }
}

export function readCache(key) {
  const entry = _parse(key)
  if (!entry) return null
  if (Date.now() > entry.exp) { localStorage.removeItem(PREFIX + key); return null }
  return entry.data
}

export function writeCache(key, data, ttlMs) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, exp: Date.now() + ttlMs, savedAt: Date.now() }))
  } catch {}
}

// Retourne les données même expirées (fallback si l'API échoue)
export function readCacheStale(key) { return _parse(key)?.data ?? null }

// Retourne le timestamp d'écriture (pour initialDataUpdatedAt de TanStack)
export function getCacheSavedAt(key) { return _parse(key)?.savedAt ?? 0 }
