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

// ⚠️ 06/11 (stockage plein sur iPhone, accord explicite de l'utilisateur) : chaque match football-data.org
// d'une liste arrive avec 3 champs que l'app n'affiche jamais depuis ces listes — `odds` (sans abonnement,
// juste le message « Activate Odds-Package… » ; les cotes affichées viennent d'ESPN), `area` (pays de la
// compétition) et `referees` (les arbitres affichés viennent de /v4/matches/{id}, jamais des listes).
// Mesuré sur la Premier League : ~21 % de la place de la liste. On les retire AVANT d'écrire sur le disque
// (la donnée en mémoire, elle, n'est pas modifiée). Une vraie cote (si l'abonnement était activé un jour)
// est conservée.
function compactFdMatch(m) {
  if (!m || typeof m !== 'object' || !m.homeTeam || !('utcDate' in m)) return m
  if (!('odds' in m) && !('area' in m) && !('referees' in m)) return m
  // eslint-disable-next-line no-unused-vars
  const { odds, area, referees, ...rest } = m
  if (odds && !odds.msg) rest.odds = odds
  return rest
}
function compactData(data) {
  if (Array.isArray(data)) return data.map(compactFdMatch)
  if (data && typeof data === 'object') {
    let changed = false
    const out = {}
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) { out[k] = v.map(compactFdMatch); changed = true } else out[k] = v
    }
    return changed ? out : data
  }
  return data
}

export function writeCache(key, data, ttlMs) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data: compactData(data), exp: Date.now() + ttlMs, savedAt: Date.now() }))
  } catch {}
}

// ⚠️ 06/11 (stockage plein sur iPhone, accord explicite de l'utilisateur « vérifie avant de supprimer ») :
// les saisons passées gardées pour les confrontations directes (h2hHistory_*, ~360 000 caractères par
// compétition) ne servent qu'à useH2HRows (onglet Historique, MatchModal.jsx), calcProno (directMeetings :
// équipes, score, statut) et resolveFdTeamId/resolveFdCrest (équipes). Vérifié dans ces 4 endroits : ni
// `season`, ni `lastUpdated`, ni `stage`, ni `group`, ni `matchday` n'y sont lus, et de `competition`
// seul `name` est affiché (on garde aussi id/code). Équipes, date, statut et score restent intacts.
export function compactH2HMatch(m) {
  if (!m || typeof m !== 'object') return m
  // eslint-disable-next-line no-unused-vars
  const { season, lastUpdated, stage, group, matchday, competition, ...rest } = m
  if (competition) rest.competition = { id: competition.id, name: competition.name, code: competition.code }
  return rest
}

// Migration unique des caches déjà écrits avant compactData (06/11) — réécrit chaque entrée concernée
// en gardant son `exp`/`savedAt` d'origine. Drapeau hors préfixe `foot_` (purgeExpiredCache supprime les
// `foot_*` sans `exp`).
const COMPACT_FLAG = 'sf_compact_v1'
const COMPACT_H2H_FLAG = 'sf_compact_h2h_v1'
export function compactExistingCaches() {
  try {
    if (!localStorage.getItem(COMPACT_FLAG)) for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PREFIX)) continue
      const raw = localStorage.getItem(key)
      if (!raw || !raw.includes('"referees"') && !raw.includes('"Activate Odds')) continue
      try {
        const entry = JSON.parse(raw)
        if (!entry || typeof entry.exp !== 'number') continue
        localStorage.setItem(key, JSON.stringify({ ...entry, data: compactData(entry.data) }))
      } catch { /* entrée illisible : laissée à purgeExpiredCache */ }
    }
    localStorage.setItem(COMPACT_FLAG, '1')
  } catch { /* pas bloquant */ }
  try {
    if (localStorage.getItem(COMPACT_H2H_FLAG)) return
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PREFIX + 'h2hHistory_')) continue
      try {
        const entry = JSON.parse(localStorage.getItem(key))
        if (!entry || typeof entry.exp !== 'number' || !Array.isArray(entry.data)) continue
        localStorage.setItem(key, JSON.stringify({ ...entry, data: entry.data.map(compactH2HMatch) }))
      } catch { /* entrée illisible : laissée à purgeExpiredCache */ }
    }
    localStorage.setItem(COMPACT_H2H_FLAG, '1')
  } catch { /* pas bloquant */ }
}

// Retourne les données même expirées (fallback si l'API échoue)
export function readCacheStale(key) { return _parse(key)?.data ?? null }

// ⚠️ AJOUT (18/08, besoin réel : forcer un vrai refetch H2H après la fin
// d'un match — voir confirmFt, useLiveMinute.js) : jusqu'ici rien n'exposait
// de suppression ciblée d'une entrée précise — seul readCache() en supprime
// une, mais seulement en effet de bord d'une lecture d'une clé EXPIRÉE, pas
// utilisable pour vider une entrée encore "fraîche" à la demande.
export function removeCache(key) { try { localStorage.removeItem(PREFIX + key) } catch {} }

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
// ⚠️ 06/11 (stockage plein sur iPhone, mesuré sur le téléphone de l'utilisateur : 711 entrées, dont
// ~600 par match) : les données PAR MATCH restaient jusqu'à 90 jours (stats/compos) voire 180 jours
// (correspondance d'identifiants ESPN→FD.org), pour des matchs qu'on ne rouvre presque jamais. On ne
// garde plus en local que les plus récentes ; un vieux match rouvert les redemande à notre serveur, qui
// les garde de façon permanente. Et `matches_current_*` (ancien doublon de `matches_*_RAW`, voir
// fetchClubMatchesRaw) est supprimé.
const DAY = 24 * 3600 * 1000
const PER_MATCH_MAX_AGE = [
  [/^foot_(stats|lineups)_.+_v2$/, 7 * DAY],
  [/^foot_matchdetail_/, 7 * DAY],
  [/^foot_fdMatchIdMap_/, 30 * DAY],
]
const OBSOLETE_PREFIXES = ['foot_matches_current_']

export function purgeExpiredCache() {
  try {
    const now = Date.now()
    const toRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PREFIX)) continue
      if (OBSOLETE_PREFIXES.some(p => key.startsWith(p))) { toRemove.push(key); continue }
      try {
        const entry = JSON.parse(localStorage.getItem(key))
        const maxAge = PER_MATCH_MAX_AGE.find(([re]) => re.test(key))?.[1]
        if (maxAge && entry && typeof entry.savedAt === 'number' && now - entry.savedAt > maxAge) { toRemove.push(key); continue }
        // Entrée sans `exp` valide (corrompue/ancien format) : autant la
        // nettoyer aussi plutôt que la laisser traîner indéfiniment.
        if (!entry || typeof entry.exp !== 'number' || now > entry.exp) toRemove.push(key)
      } catch { toRemove.push(key) }
    }
    toRemove.forEach(k => localStorage.removeItem(k))
  } catch { /* localStorage indisponible (navigation privée stricte, quota...) → pas bloquant */ }
}
