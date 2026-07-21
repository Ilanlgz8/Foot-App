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

// ⚠️ AJOUT (question utilisateur : "on aura assez de place pour tout garder
// en cache ?") : readCache() ne supprime une entrée expirée QUE si on relit
// PRÉCISÉMENT cette clé après son expiration (nettoyage paresseux) — un match
// ouvert une fois et jamais revisité reste donc en localStorage pour TOUJOURS,
// sans jamais être nettoyé. Contrairement au blob unique de React Query (voir
// main.jsx, `retry: removeOldestQuery`, déjà protégé), ce cache par clé n'a
// aucun filet de sécurité équivalent : une fois le quota du navigateur
// atteint, `writeCache` échoue silencieusement (try/catch) — le cache
// s'arrête discrètement de fonctionner, sans erreur visible, exactement le
// genre de bug difficile à repérer qu'on a chassé toute la soirée. Purge
// active de toutes les entrées `foot_*` expirées, à appeler une fois au
// lancement de l'app (voir main.jsx) — borne la croissance à la fenêtre de
// TTL réellement en cours (max 90j pour les compos/stats confirmées) plutôt
// qu'à la totalité de l'historique jamais consulté par cet utilisateur.
export function purgeExpiredCache() {
  try {
    const now = Date.now()
    const toRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PREFIX)) continue
      try {
        const entry = JSON.parse(localStorage.getItem(key))
        // Entrée sans `exp` valide (corrompue/ancien format) : autant la
        // nettoyer aussi plutôt que la laisser traîner indéfiniment.
        if (!entry || typeof entry.exp !== 'number' || now > entry.exp) toRemove.push(key)
      } catch { toRemove.push(key) }
    }
    toRemove.forEach(k => localStorage.removeItem(k))
  } catch { /* localStorage indisponible (navigation privée stricte, quota...) → pas bloquant */ }
}
