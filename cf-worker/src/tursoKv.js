// cf-worker/src/tursoKv.js
//
// Adaptateur Turso (SQLite distribué, libsql) qui réimplémente le SOUS-ENSEMBLE
// exact de l'API @upstash/redis réellement utilisé dans src/index.js (get, set,
// mget, del, expire, sadd, srem, scard, rpush, lpop, ltrim, pipeline) — vérifié
// par grep exhaustif avant d'écrire ce fichier (aucune autre méthode Redis
// appelée nulle part dans index.js).
//
// Pourquoi (01/10, demande explicite utilisateur : "un max de truc sur turso
// pour alleger upstach") : ce Worker tourne 1x/minute, 24h/24, 365j/an — c'est
// le plus gros poste FIXE de commandes Upstash de toute l'app (bien avant le
// trafic des visiteurs), documenté plusieurs fois dans CLAUDE.md (incidents
// de quota des 10/09, 26/09, 30/09). Turso facture par LIGNE (500M lectures +
// 10M écritures/mois gratuit) au lieu de par COMMANDE (500K/mois chez Upstash,
// déjà épuisé plusieurs fois) — même raisonnement déjà appliqué au cache
// scoreboard ESPN côté Vercel, voir src/utils/tursoCache.js.
//
// Portée : TOUT l'état de ce Worker (y compris les verrous anti-doublon
// but/carton/KO/FT — demande explicite de l'utilisateur après qu'on lui ait
// signalé le risque : ces verrous reposent normalement sur l'atomicité native
// SET NX de Redis). Émulation de l'atomicité via SQL standard :
// `INSERT ... ON CONFLICT(key) DO UPDATE ... WHERE expires_at <= ?` — si la
// clé n'existe pas OU est expirée, l'UPDATE s'exécute (rowsAffected=1 → "OK",
// verrou acquis) ; si une entrée encore valide existe, la clause WHERE bloque
// l'UPDATE (rowsAffected=0 → null, verrou refusé) — comportement documenté de
// SQLite (upsert-clause), et une base libSQL/Turso traite les écritures sur
// UNE MÊME ligne de façon sérialisée côté serveur (pas de fenêtre de course
// entre 2 requêtes HTTP concurrentes sur la même clé), donc cette émulation
// est atomique dans les faits, pas seulement en apparence.
//
// Honnêteté : contrairement au cache scoreboard ESPN (purement en lecture,
// risque faible), ce fichier n'a PU ÊTRE TESTÉ CONTRE UNE VRAIE BASE TURSO —
// le sandbox de développement n'a aucun accès réseau sortant (voir l'historique
// du 01/10 dans CLAUDE.md, déjà rencontré pour tursoCache.js). Le code est
// relu attentivement (SQL standard, API @libsql/client conforme à sa doc
// publique) mais la vérification réelle ne pourra se faire qu'après déploiement
// (`npm run deploy` depuis cf-worker/, voir CLAUDE.md) — à surveiller de près
// sur les premières minutes (notifs reçues normalement ? doublons ? absence ?).
//
// Cloudflare Workers n'a pas d'API réseau Node (pas de net/tls) — import
// obligatoire de la variante edge-safe du client, basée sur fetch/HTTP.
import { createClient } from '@libsql/client/web'

function nowSec() { return Math.floor(Date.now() / 1000) }

// opts attendues : { ex: secondes } ou { px: millisecondes }, { nx: true }
// optionnel sur les deux — même forme que l'API @upstash/redis déjà utilisée
// partout dans index.js, aucun changement d'appel nécessaire côté appelants.
function ttlSecFromOpts(opts) {
  if (opts?.px != null) return Math.max(1, Math.ceil(opts.px / 1000))
  if (opts?.ex != null) return Math.max(1, opts.ex)
  // Repli défensif — en pratique TOUS les appels de index.js passent ex ou px
  // (vérifié par grep), jamais exercé réellement.
  return 24 * 3600
}

export function createTursoKv({ url, authToken }) {
  if (!url || !authToken) return null
  const client = createClient({ url, authToken })

  let schemaReady = null
  async function ensureSchema() {
    if (schemaReady) return schemaReady
    schemaReady = client.batch([
      `CREATE TABLE IF NOT EXISTS worker_kv (
         key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS worker_set (
         set_name TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY (set_name, member)
       )`,
      `CREATE TABLE IF NOT EXISTS worker_queue (
         id INTEGER PRIMARY KEY AUTOINCREMENT, queue_name TEXT NOT NULL,
         value TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER
       )`,
    ], 'write')
    try {
      await schemaReady
    } catch (e) {
      schemaReady = null // un échec ne doit pas rester "en cache" pour toujours
      throw e
    }
    return schemaReady
  }

  async function get(key) {
    await ensureSchema()
    const res = await client.execute({
      sql: `SELECT value FROM worker_kv WHERE key=? AND expires_at>?`,
      args: [key, nowSec()],
    })
    return res.rows[0]?.value ?? null
  }

  async function mget(...keys) {
    if (keys.length === 0) return []
    await ensureSchema()
    const placeholders = keys.map(() => '?').join(',')
    const res = await client.execute({
      sql: `SELECT key,value FROM worker_kv WHERE key IN (${placeholders}) AND expires_at>?`,
      args: [...keys, nowSec()],
    })
    const found = new Map(res.rows.map(r => [r.key, r.value]))
    return keys.map(k => found.get(k) ?? null)
  }

  async function set(key, value, opts = {}) {
    await ensureSchema()
    const val = typeof value === 'string' ? value : String(value)
    const now = nowSec()
    const expiresAt = now + ttlSecFromOpts(opts)
    if (opts.nx) {
      const res = await client.execute({
        sql: `INSERT INTO worker_kv (key, value, expires_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at
              WHERE worker_kv.expires_at <= ?`,
        args: [key, val, expiresAt, now],
      })
      return res.rowsAffected > 0 ? 'OK' : null
    }
    await client.execute({
      sql: `INSERT INTO worker_kv (key, value, expires_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at`,
      args: [key, val, expiresAt],
    })
    return 'OK'
  }

  async function del(key) {
    await ensureSchema()
    const res = await client.execute({ sql: `DELETE FROM worker_kv WHERE key=?`, args: [key] })
    return res.rowsAffected
  }

  // Seuls 2 appelants dans index.js (cron:goals:logHistory, fd:warmPriority),
  // tous deux des files (worker_queue) — jamais une clé worker_kv/worker_set.
  // Vérifié par grep avant implémentation, pas de généralité supposée à tort.
  async function expire(queueName, seconds) {
    await ensureSchema()
    await client.execute({
      sql: `UPDATE worker_queue SET expires_at=? WHERE queue_name=?`,
      args: [nowSec() + seconds, queueName],
    })
  }

  async function sadd(setName, member) {
    await ensureSchema()
    const res = await client.execute({
      sql: `INSERT OR IGNORE INTO worker_set (set_name, member) VALUES (?,?)`,
      args: [setName, String(member)],
    })
    return res.rowsAffected
  }

  async function srem(setName, member) {
    await ensureSchema()
    const res = await client.execute({
      sql: `DELETE FROM worker_set WHERE set_name=? AND member=?`,
      args: [setName, String(member)],
    })
    return res.rowsAffected
  }

  async function scard(setName) {
    await ensureSchema()
    const res = await client.execute({
      sql: `SELECT COUNT(*) as c FROM worker_set WHERE set_name=?`,
      args: [setName],
    })
    return Number(res.rows[0]?.c ?? 0)
  }

  async function rpush(queueName, ...values) {
    await ensureSchema()
    const now = nowSec()
    const stmts = values.map(v => ({
      sql: `INSERT INTO worker_queue (queue_name, value, created_at) VALUES (?,?,?)`,
      args: [queueName, String(v), now],
    }))
    if (stmts.length === 1) await client.execute(stmts[0])
    else if (stmts.length > 1) await client.batch(stmts, 'write')
    return values.length
  }

  async function lpop(queueName) {
    await ensureSchema()
    // DELETE...RETURNING : pop atomique en 1 aller-retour (supporté par
    // SQLite ≥3.35 / libSQL), évite une fenêtre de course SELECT puis DELETE.
    const res = await client.execute({
      sql: `DELETE FROM worker_queue WHERE id = (
              SELECT id FROM worker_queue
              WHERE queue_name=? AND (expires_at IS NULL OR expires_at>?)
              ORDER BY id ASC LIMIT 1
            ) RETURNING value`,
      args: [queueName, nowSec()],
    })
    return res.rows[0]?.value ?? null
  }

  // index.js n'appelle JAMAIS ltrim autrement qu'avec (-N, -1) — "garder les
  // N derniers éléments" (2 call-sites, vérifiés par grep). Pas d'implémentation
  // générique des index négatifs arbitraires de Redis.
  async function ltrim(queueName, start, stop) {
    if (stop !== -1 || start >= 0) {
      throw new Error('tursoKv.ltrim: seul le motif (-N, -1) est supporté')
    }
    const keepLast = -start
    await ensureSchema()
    await client.execute({
      sql: `DELETE FROM worker_queue WHERE queue_name=? AND id NOT IN (
              SELECT id FROM worker_queue WHERE queue_name=? ORDER BY id DESC LIMIT ?
            )`,
      args: [queueName, queueName, keepLast],
    })
  }

  function buildStatement(op, now) {
    if (op.type === 'set') {
      const val = typeof op.value === 'string' ? op.value : String(op.value)
      const expiresAt = now + ttlSecFromOpts(op.opts)
      if (op.opts?.nx) {
        return {
          sql: `INSERT INTO worker_kv (key, value, expires_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at
                WHERE worker_kv.expires_at <= ?`,
          args: [op.key, val, expiresAt, now],
        }
      }
      return {
        sql: `INSERT INTO worker_kv (key, value, expires_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at`,
        args: [op.key, val, expiresAt],
      }
    }
    if (op.type === 'get') {
      return { sql: `SELECT value FROM worker_kv WHERE key=? AND expires_at>?`, args: [op.key, now] }
    }
    if (op.type === 'del') {
      return { sql: `DELETE FROM worker_kv WHERE key=?`, args: [op.key] }
    }
    if (op.type === 'srem') {
      return { sql: `DELETE FROM worker_set WHERE set_name=? AND member=?`, args: [op.setName, String(op.member)] }
    }
    throw new Error(`tursoKv.pipeline: type non supporté: ${op.type}`)
  }

  function interpretResult(op, rs) {
    if (op.type === 'set') return op.opts?.nx ? (rs.rowsAffected > 0 ? 'OK' : null) : 'OK'
    if (op.type === 'get') return rs.rows[0]?.value ?? null
    if (op.type === 'del' || op.type === 'srem') return rs.rowsAffected
    return null
  }

  // Émule kv.pipeline().set(...).get(...).del(...).srem(...).exec({keepErrors})
  // de @upstash/redis.
  //
  // ⚠️ RÉÉCRIT (01/10, bug prod : notifs buts/cartons jamais envoyées une fois
  // basculé sur Turso — "j'ai reçu que fin de match du premier match, sinon
  // rien du tout même pas les buts", voir CLAUDE.md). Root cause la plus
  // probable trouvée en comparant les 2 chemins NX du fichier : `acquireDedup`
  // (index.js, dédup des notifs individuelles) appelle le `set()` STANDALONE
  // ci-dessus — 1 seul `client.execute()` isolé — et fonctionne bien (c'est
  // LUI qui a laissé passer la notif "Fin de match"). Le verrou anti-doublon
  // but/carton (`lockKey`, `writePipe` dans index.js ~ligne 1000), lui, est
  // batché avec le SET normal de `stateKey` dans UN SEUL `client.batch(stmts,
  // 'write')` — un batch libSQL est UNE SEULE transaction : si une des
  // opérations lève une erreur (contention, erreur transitoire...), TOUT le
  // batch échoue d'un coup, et l'ancien code ci-dessous renvoyait alors
  // `{result:null, error}` pour TOUTES les opérations du pipeline, y compris
  // celles sans rapport avec l'échec — contrairement à Redis, où
  // `pipeline().exec({keepErrors:true})` isole VRAIMENT chaque commande les
  // unes des autres. Un seul échec ponctuel sur `stateKey` (ou l'inverse)
  // suffisait donc à rendre `lockAcquired` systématiquement faux, bloquant
  // TOUTE notif de but/carton — alors que la notif "Fin de match" elle-même,
  // qui ne dépend pas de ce verrou, continuait de passer : exactement le
  // symptôme observé.
  // Corrigé : chaque opération du pipeline s'exécute maintenant en SÉQUENCE,
  // comme un `client.execute()` INDÉPENDANT avec son propre try/catch — un
  // échec sur une opération ne peut plus jamais affecter le résultat d'une
  // autre, même garantie d'isolation que Redis. Coût : N allers-retours HTTP
  // au lieu d'1 seul par pipeline — accepté ici : Turso facture par LIGNE
  // (pas par requête), et le temps d'attente réseau ne compte pas dans le
  // budget CPU Cloudflare Workers (seul le temps CPU réellement actif est
  // limité) — un aller-retour HTTP de plus ne coûte donc quasiment rien ici.
  function pipeline() {
    const ops = []
    const builder = {
      set(key, value, opts) { ops.push({ type: 'set', key, value, opts }); return builder },
      get(key) { ops.push({ type: 'get', key }); return builder },
      del(key) { ops.push({ type: 'del', key }); return builder },
      srem(setName, member) { ops.push({ type: 'srem', setName, member }); return builder },
      async exec(options = {}) {
        await ensureSchema()
        const results = []
        for (const op of ops) {
          const now = nowSec()
          const stmt = buildStatement(op, now)
          try {
            const rs = await client.execute(stmt)
            const result = interpretResult(op, rs)
            results.push(options.keepErrors ? { result, error: null } : result)
          } catch (e) {
            if (options.keepErrors) results.push({ result: null, error: e.message })
            else throw e
          }
        }
        return results
      },
    }
    return builder
  }

  return { get, mget, set, del, expire, sadd, srem, scard, rpush, lpop, ltrim, pipeline }
}
