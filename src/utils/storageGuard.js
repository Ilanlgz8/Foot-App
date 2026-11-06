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

// Diagnostic (05-06/11, voir LiveDiag.jsx) : évictions faites par ce garde-fou pendant cette session.
const guardStats = { evictions: 0, removed: [] }
if (typeof window !== 'undefined') window.__sfGuard = guardStats

// 0 = supprimé en premier … 2 = supprimé en dernier.
function evictTier(k) {
  if (/^foot_(teamform2_|standings|scorers3_)/.test(k) || /^foot_matches_.+_RAW$/.test(k) || /^foot_matches_(espn_)?\d{4}-\d{2}-\d{2}$/.test(k)) return 2
  if (/^foot_(h2hHistory_|lowerDiv_|matches_lastSeason_|matches_espn_cup_|stats_|lineups_|matchdetail_|h2h_|espnOdds_)/.test(k)) return 0
  return 1
}

function freeSpace(storage, removeItem, keyBeingWritten) {
  guardStats.evictions++
  let freed = 0
  try {
    const rq = storage.getItem(RQ_KEY)
    if (rq && keyBeingWritten !== RQ_KEY) { removeItem.call(storage, RQ_KEY); freed += rq.length; guardStats.removed.push(RQ_KEY) }
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
  // 06/11 (forme récente qui disparaissait) : on supprime d'abord ce qui est le moins utile au démarrage,
  // et en tout dernier les caches dont dépendent l'Accueil et la forme récente.
  candidates.sort((a, b) => (evictTier(a[0]) - evictTier(b[0])) || (b[1] - a[1]))
  for (const [k, len] of candidates) {
    if (freed >= FREE_TARGET_CHARS) break
    try { removeItem.call(storage, k); freed += len; guardStats.removed.push(k) } catch { /* ignore */ }
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

// Diagnostic de lancement (06/11, constat utilisateur : « après l'animation, au moins 5 s avant que
// l'Accueil s'affiche » sur iPhone, non reproductible ailleurs) : état du stockage au tout début du
// lancement + tampon de mesures réseau agrandi (250 par défaut) pour garder toutes les requêtes du
// lancement. Lu par LiveDiag.jsx, n'écrit rien.
if (typeof window !== 'undefined') {
  try { performance.setResourceTimingBufferSize?.(1500) } catch { /* ignore */ }
  try {
    let chars = 0, matchKeys = 0
    const today = new Date()
    const todayKey = `foot_matches_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      chars += (k?.length ?? 0) + (localStorage.getItem(k)?.length ?? 0)
      if (k?.startsWith('foot_matches_')) matchKeys++
    }
    window.__sfLaunch = { keys: localStorage.length, chars, matchKeys, hadTodayCache: localStorage.getItem(todayKey) != null }
  } catch { /* ignore */ }
}
