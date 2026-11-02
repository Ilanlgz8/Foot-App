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

// ── Verrou "write-once" (02/11) ──────────────────────────────────────────────
// Ajouté suite à la découverte en direct (avec l'utilisateur, via la console
// SQL Turso) que ~1701 clés distinctes dans espn_cache avaient généré 250 000+
// LIGNES ÉCRITES — preuve chiffrée d'un effet "thundering herd" : sur une base
// tout juste créée (donc intégralement froide), plusieurs visiteurs arrivant
// dans la même fenêtre de quelques secondes voient chacun un cache miss pour
// LA MÊME tranche de scoreboard ESPN avant qu'aucun n'ait eu le temps de
// l'écrire — et la réécrivent chacun de leur côté, en pure perte. La réduction
// de fréquence de polling côté client (useTeamForm.js, même jour) diminue le
// RISQUE de collision mais ne l'élimine pas structurellement — ceci est le
// vrai "write-once" demandé : avant de fetcher ESPN pour une tranche jamais
// encore en cache, chaque requête tente de la RÉSERVER (émulation SET NX déjà
// éprouvée ailleurs dans ce projet, voir cf-worker/src/tursoKv.js). Seule la
// requête qui gagne la course fetch+écrit réellement ; les autres renvoient
// juste "pas de données pour cette tranche cette fois" (traité par l'appelant,
// voir mergeScoreboardChunks dans api/espn.js, exactement comme un échec ESPN
// transitoire — jamais une fausse donnée "0 match") — la tranche sera en
// cache quelques secondes plus tard, retrouvée au prochain poll/remontage.
// Fail-open si Turso est indisponible (renvoie true, comme n'importe quel
// autre verrou de ce type dans ce projet — jamais bloquer un vrai fetch pour
// un verrou qu'on n'a pas pu poser).
export async function tryLock(key, ttlSeconds) {
  const c = client()
  if (!c) return true
  try {
    await ensureSchema(c)
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + ttlSeconds
    const res = await c.execute({
      sql: `INSERT INTO espn_cache (key, value, expires_at) VALUES (?, '1', ?)
            ON CONFLICT(key) DO UPDATE SET value = '1', expires_at = excluded.expires_at
            WHERE espn_cache.expires_at <= ?`,
      args: [key, expiresAt, now],
    })
    return res.rowsAffected > 0
  } catch {
    return true
  }
}

// ── Lecture de l'état du Worker Cloudflare (01/10) ──────────────────────────
// cf-worker/src/tursoKv.js (migration du cron Cloudflare vers Turso, voir son
// commentaire d'en-tête) écrit dans worker_kv/worker_queue — MÊME base Turso
// que espn_cache ci-dessus (si TURSO_DATABASE_URL/TOKEN sont configurées sur
// le Worker ET sur Vercel avec les mêmes valeurs), tables DIFFÉRENTES. Les 2
// fonctions ci-dessous servent UNIQUEMENT à api/debug-push.js, pour continuer
// à afficher cron:goals:lastRun/lastResult/logHistory même une fois que le
// Worker a basculé sur Turso (sinon ces 3 clés disparaîtraient de Redis sans
// que ce diagnostic ne les retrouve nulle part). Ne CRÉENT jamais les tables
// (c'est le Worker qui les crée à sa 1ère écriture, voir ensureSchema dans
// tursoKv.js) — si elles n'existent pas encore (Worker jamais exécuté avec
// Turso configuré), retournent simplement "rien" plutôt qu'une erreur.
export async function getWorkerKv(key) {
  const c = client()
  if (!c) return null
  try {
    const res = await c.execute({
      sql: `SELECT value FROM worker_kv WHERE key=? AND expires_at>?`,
      args: [key, Math.floor(Date.now() / 1000)],
    })
    return res.rows[0]?.value ?? null
  } catch {
    return null
  }
}

// ⚠️ BUG TROUVÉ ET CORRIGÉ (02/11, constat utilisateur : "2,8M de row reads
// en 15h, c'énorme") : cette fonction lisait la file ENTIÈRE à CHAQUE appel
// (`ORDER BY id ASC`, sans LIMIT) — `cron:goals:logHistory` peut grossir
// jusqu'à 30 000 lignes (voir le ltrim dans cf-worker/src/index.js) avant
// d'être tronquée, et chaque appel à `/api/debug-push` (très fréquent
// pendant les sessions de debug des notifs live, voir tout l'historique de
// ce fichier depuis début octobre) relisait donc jusqu'à 30 000 lignes d'un
// coup — alors que `api/debug-push.js` n'affiche jamais plus de 200 lignes
// (ou un sous-ensemble filtré par `?match=`) au final. Corrigé : `LIMIT`
// ajouté directement dans le SQL (`ORDER BY id DESC LIMIT ?`, inversé en JS
// pour revenir à l'ordre chronologique ASC attendu par l'appelant) — un
// défaut de 8000 lignes couvre très largement une journée de matchs (bien
// au-delà des quelques centaines/milliers de lignes qu'une vraie soirée à
// plusieurs matchs simultanés génère), tout en divisant le pire cas par
// ~4x. Honnêteté : un filtre `?match=` qui cherche un événement VRAIMENT
// ancien (plus de 8000 lignes en arrière) pourrait ne plus le trouver —
// compromis assumé, ce cas n'a jamais été utilisé dans ce projet (le
// diagnostic porte toujours sur un match récent/en cours).
export async function getWorkerQueueAll(queueName, limit = 8000) {
  const c = client()
  if (!c) return []
  try {
    const now = Math.floor(Date.now() / 1000)
    const res = await c.execute({
      sql: `SELECT value FROM worker_queue WHERE queue_name=? AND (expires_at IS NULL OR expires_at>?) ORDER BY id DESC LIMIT ?`,
      args: [queueName, now, limit],
    })
    return res.rows.map(r => r.value).reverse()
  } catch {
    return []
  }
}
