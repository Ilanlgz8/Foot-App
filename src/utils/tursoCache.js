// src/utils/tursoCache.js
//
// Cache clé-valeur générique sur Turso (SQLite distribué, libsql) — remplace
// Redis UNIQUEMENT pour le cache scoreboard ESPN (api/espn.js, clés
// `espn:sb:*`), pas pour le reste de l'app (rate-limit, verrous live,
// notifications push) qui reste sur Upstash Redis pour sa rapidité/atomicité
// (SET NX, pipeline — pas le point fort d'une base SQL).
//
// Pourquoi (01/10, demande explicite utilisateur de trouver "une meilleure
// logique" après plusieurs incidents de quota Upstash le même jour) : ce
// cache précis est très majoritairement LU, très rarement ÉCRIT (TTL jusqu'à
// 365 jours pour le passé ancien, voir SCOREBOARD_OLD_PAST_CHUNK_TTL dans
// api/espn.js — un match terminé ne change quasiment jamais) — exactement le
// profil où la facturation par LIGNE de Turso (vérifié via recherche web,
// 01/10 : 500 millions de lectures/mois + 10 millions d'écritures/mois
// gratuit) est 100 à 1000x plus généreuse que la facturation par COMMANDE
// d'Upstash (500 000 commandes/mois, lecture+écriture confondues — déjà
// plusieurs fois proche de la limite cette semaine).
//
// TTL géré À LA MAIN (colonne expires_at, secondes epoch) : contrairement à
// Redis, SQLite n'a pas d'expiration automatique native — chaque lecture
// filtre elle-même les lignes expirées (voir mget ci-dessous). Aucune purge
// périodique des lignes expirées : leur poids reste négligeable (quelques Ko
// de JSON par ligne, quota de stockage Turso 5 Go) et une ligne expirée est
// de toute façon invisible pour mget — pas un problème fonctionnel, juste un
// peu d'espace disque inutilisé, sans impact sur le quota de lectures/
// écritures qui est le seul vrai sujet ici.
//
// Déploiement PRUDENT : si TURSO_DATABASE_URL/TURSO_AUTH_TOKEN ne sont pas
// encore configurées côté Vercel (ex. avant le tout premier déploiement de
// cette fonctionnalité), isTursoConfigured() renvoie false — api/espn.js
// retombe alors intégralement sur l'ancien chemin Redis, inchangé. Bascule
// automatique dès que les variables sont ajoutées, sans autre changement de
// code nécessaire.

import { createClient } from '@libsql/client'

let _client = null
function client() {
  if (_client) return _client
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) return null
  _client = createClient({ url, authToken })
  return _client
}

// Créée au premier appel réel (pas au chargement du module, pour ne jamais
// payer ce coût si Turso n'est pas configuré) — `CREATE TABLE IF NOT EXISTS`
// est sans risque à rappeler à chaque cold start Vercel (idempotent), le
// cache en mémoire du module (schemaReady) évite de la refaire à chaque
// invocation tant que l'instance serverless reste chaude.
let schemaReady = null
async function ensureSchema(c) {
  if (schemaReady) return schemaReady
  schemaReady = c.execute(`
    CREATE TABLE IF NOT EXISTS espn_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `)
  try {
    await schemaReady
  } catch (e) {
    schemaReady = null // un échec ne doit pas rester "en cache" pour toujours
    throw e
  }
  return schemaReady
}

// Équivalent kv.mget : renvoie un tableau aligné sur `keys`, `null` pour
// toute clé absente OU expirée — même contrat que le kv.mget actuel (voir
// son usage dans readCachedChunks, api/espn.js). Jamais d'exception
// propagée : une erreur réseau/Turso renvoie simplement tout en `null`
// (traité par l'appelant exactement comme un cache miss générique).
export async function mget(keys) {
  const c = client()
  if (!c || keys.length === 0) return keys.map(() => null)
  try {
    await ensureSchema(c)
    const placeholders = keys.map(() => '?').join(',')
    const now = Math.floor(Date.now() / 1000)
    const res = await c.execute({
      sql: `SELECT key, value FROM espn_cache WHERE key IN (${placeholders}) AND expires_at > ?`,
      args: [...keys, now],
    })
    const found = new Map(res.rows.map(r => [r.key, r.value]))
    return keys.map(k => found.get(k) ?? null)
  } catch {
    return keys.map(() => null)
  }
}

// Équivalent kv.set(key, value, { ex: ttlSeconds }) — upsert (remplace la
// valeur existante pour la même clé si déjà présente). Pensé pour un usage
// fire-and-forget côté appelant (même pattern que l'actuel
// kv.set(...).catch(()=>{}) dans fetchScoreboardChunk) : jamais bloquant
// pour la réponse HTTP, les erreurs sont avalées silencieusement ici.
export async function set(key, value, ttlSeconds) {
  const c = client()
  if (!c) return
  try {
    await ensureSchema(c)
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
    await c.execute({
      sql: `INSERT INTO espn_cache (key, value, expires_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      args: [key, value, expiresAt],
    })
  } catch { /* silencieux — même contrat que kv.set(...).catch(()=>{}) actuel */ }
}

// Permet à api/espn.js de choisir le chemin Turso seulement si les
// identifiants sont bien configurés côté Vercel — sinon repli intégral et
// silencieux sur Redis (voir commentaire d'en-tête).
export function isTursoConfigured() {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)
}
