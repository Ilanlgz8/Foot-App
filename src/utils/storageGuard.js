// storageGuard.js — filet de sécurité contre le stockage local PLEIN (05/11).
//
// Constat utilisateur (iPhone, app installée) : « En direct » n'affichait que 2 matchs sur 17, la page
// d'un match restait en chargement sans fin, puis « Un problème est survenu — The quota has been
// exceeded. » à chaque ouverture, même après relance. Sur ordinateur, tout marchait.
// Cause : le stockage local de Safari/iOS est limité à ~5 Mo par site ; les caches de l'app (matchs de
// chaque compétition, fiche équipe, blob React Query…) le remplissaient. Une fois plein, CHAQUE
// localStorage.setItem lève une exception. Plusieurs écritures ne sont pas protégées (notamment
// matchStateTracker.js, appelé pour chaque match pendant le suivi du direct) : l'exception coupait la
// boucle de suivi après 1-2 matchs (d'où « 2 matchs en direct ») et, pendant un rendu, déclenchait
// l'écran d'erreur.
//
// Correctif global, chargé AVANT tout le reste (premier import de main.jsx) : si une écriture échoue
// faute de place, on libère de la place en supprimant d'abord le blob React Query (redondant avec les
// caches disque dédiés), puis les plus gros CACHES écrits par writeCache() (format reconnaissable :
// `{"data":…,"exp":…,"savedAt":…}`, toujours recalculables depuis le réseau). Les données utilisateur
// (favoris, pronos, réglages) et l'état des matchs en direct (foot_ms_*, foot_live_v2) ne sont jamais
// supprimés. Puis on réessaie une fois ; si ça échoue encore, l'écriture est abandonnée SANS exception
// (une donnée de cache manquante est toujours préférable à une app qui plante).

const RQ_KEY = 'REACT_QUERY_OFFLINE_CACHE'
const FREE_TARGET_CHARS = 1_500_000 // marge libérée d'un coup, pour ne pas reboucler à chaque écriture

function isQuotaError(e) {
  return !!e && (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 || e.code === 1014
  )
}

function isWriteCacheEntry(value) {
  return typeof value === 'string' &&
    value.startsWith('{"data":') &&
    /,"exp":\d+,"savedAt":\d+\}$/.test(value.slice(-64))
}

function freeSpace(storage, removeItem, keyBeingWritten) {
  let freed = 0
  try {
    const rq = storage.getItem(RQ_KEY)
    if (rq && keyBeingWritten !== RQ_KEY) { removeItem.call(storage, RQ_KEY); freed += rq.length }
  } catch { /* ignore */ }
  if (freed >= FREE_TARGET_CHARS) return
  const candidates = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (!k || k === keyBeingWritten) continue
      const v = storage.getItem(k)
      if (isWriteCacheEntry(v)) candidates.push([k, v.length])
    }
  } catch { /* ignore */ }
  candidates.sort((a, b) => b[1] - a[1])
  for (const [k, len] of candidates) {
    if (freed >= FREE_TARGET_CHARS) break
    try { removeItem.call(storage, k); freed += len } catch { /* ignore */ }
  }
}

if (typeof Storage !== 'undefined' && !Storage.prototype.__sfGuarded) {
  const originalSetItem = Storage.prototype.setItem
  const originalRemoveItem = Storage.prototype.removeItem
  Storage.prototype.setItem = function guardedSetItem(key, value) {
    try {
      return originalSetItem.call(this, key, value)
    } catch (e) {
      if (!isQuotaError(e)) throw e
      // Le blob React Query a son propre mécanisme de repli (removeOldestQuery, main.jsx) : on le
      // laisse échouer normalement pour qu'il s'en serve, sans rien supprimer d'autre pour lui.
      if (key === RQ_KEY) throw e
      freeSpace(this, originalRemoveItem, key)
      try {
        return originalSetItem.call(this, key, value)
      } catch (e2) {
        if (!isQuotaError(e2)) throw e2
        console.warn('[storageGuard] écriture abandonnée, stockage plein :', key)
      }
    }
  }
  Storage.prototype.__sfGuarded = true
}
