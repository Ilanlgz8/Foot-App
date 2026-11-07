// Test du client Turso léger (src/tursoHttp.js) contre la VRAIE base, comparé
// au client officiel @libsql/client. Utilise une table de test séparée,
// supprimée à la fin : aucune donnée de l'app n'est touchée.
// Lancement (depuis cf-worker/) :
//   TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." node scripts/test-turso-http.mjs
import { createClient } from '@libsql/client/web'
import { createTursoHttpClient } from '../src/tursoHttp.js'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) { console.error('❌ TURSO_DATABASE_URL et TURSO_AUTH_TOKEN manquants'); process.exit(1) }

let httpCalls = 0
const realFetch = globalThis.fetch
globalThis.fetch = (...a) => { httpCalls++; return realFetch(...a) }

const neu = createTursoHttpClient({ url, authToken })
const off = createClient({ url, authToken })
const T = `selftest_${Date.now()}`
let ok = 0, ko = 0
function check(name, cond, info = '') {
  if (cond) { ok++; console.log('✅', name) } else { ko++; console.log('❌', name, info) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const rowsOf = rs => rs.rows.map(r => Object.fromEntries(rs.columns.map(c => [c, r[c]])))

try {
  await neu.batch([`CREATE TABLE ${T} (k TEXT PRIMARY KEY, v TEXT, n INTEGER NOT NULL, f REAL)`], 'write')
  check('création de table (batch write)', true)

  const now = Math.floor(Date.now() / 1000)
  const ins = await neu.execute({ sql: `INSERT INTO ${T} (k, v, n, f) VALUES (?, ?, ?, ?)`, args: ['a', 'texte é', now + 60, 1.5] })
  check('insertion : rowsAffected = 1', ins.rowsAffected === 1, JSON.stringify(ins))
  await neu.execute({ sql: `INSERT INTO ${T} (k, v, n, f) VALUES (?, ?, ?, ?)`, args: ['b', null, now - 10, null] })

  const sel = `SELECT k, v, n, f, typeof(n) AS tn FROM ${T} ORDER BY k`
  const a = rowsOf(await neu.execute(sel)), b = rowsOf(await off.execute(sel))
  check('lecture identique au client officiel', same(a, b), `\n   nouveau: ${JSON.stringify(a)}\n   officiel: ${JSON.stringify(b)}`)
  check('nombre stocké en entier', a[0]?.tn === 'integer', JSON.stringify(a[0]))

  const cmp = `SELECT k FROM ${T} WHERE n > ? ORDER BY k`
  check('comparaison avec un nombre identique', same(rowsOf(await neu.execute({ sql: cmp, args: [now] })), rowsOf(await off.execute({ sql: cmp, args: [now] }))))

  // Verrou « SET NX » exactement comme tursoKv.js
  const nx = `INSERT INTO ${T} (k, v, n) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, n=excluded.n WHERE ${T}.n <= ?`
  const l1 = await neu.execute({ sql: nx, args: ['a', 'x', now + 60, now] })
  const l2 = await neu.execute({ sql: nx, args: ['b', 'x', now + 60, now] })
  check('verrou déjà pris → refusé (0 ligne)', l1.rowsAffected === 0, JSON.stringify(l1))
  check('verrou expiré → repris (1 ligne)', l2.rowsAffected === 1, JSON.stringify(l2))

  const ret = await neu.execute({ sql: `DELETE FROM ${T} WHERE k = ? RETURNING v`, args: ['b'] })
  check('RETURNING', ret.rows[0]?.v === 'x', JSON.stringify(ret.rows))

  httpCalls = 0
  const par = await Promise.all([1, 2, 3].map(i => neu.execute({ sql: `SELECT ? AS i`, args: [i] })))
  check('3 requêtes simultanées → 1 seul appel HTTP', httpCalls === 1 && same(par.map(r => r.rows[0].i), [1, 2, 3]), `appels=${httpCalls} ${JSON.stringify(par.map(r => r.rows))}`)

  let batchErr = null
  try { await neu.batch([{ sql: `INSERT INTO ${T} (k, n) VALUES (?, ?)`, args: ['c', 1] }, `INSERT INTO table_qui_nexiste_pas VALUES (1)`], 'write') } catch (e) { batchErr = e }
  const c = await neu.execute({ sql: `SELECT k FROM ${T} WHERE k='c'` })
  check('transaction en échec → rien d\'écrit (annulée)', batchErr && c.rows.length === 0, String(batchErr?.message))
  check('erreur « no such table » reconnue', /no such table/i.test(String(batchErr?.message)), String(batchErr?.message))

  const okBatch = await neu.batch([{ sql: `INSERT INTO ${T} (k, n) VALUES (?, ?)`, args: ['d', 1] }, { sql: `INSERT INTO ${T} (k, n) VALUES (?, ?)`, args: ['e', 2] }], 'write')
  const de = await neu.execute(`SELECT COUNT(*) AS c FROM ${T} WHERE k IN ('d','e')`)
  check('transaction réussie → tout écrit', okBatch.length === 2 && de.rows[0].c === 2, JSON.stringify(de.rows))

  let missErr = null
  try { await neu.execute(`SELECT * FROM ${T}_absente`) } catch (e) { missErr = e }
  check('table absente → erreur reconnue', /no such table/i.test(String(missErr?.message)), String(missErr?.message))

  const wk = `SELECT COUNT(*) AS c FROM worker_kv`
  const wkRows = rowsOf(await neu.execute(wk))
  check('lecture des vraies tables du Worker (lecture seule)', wkRows.length === 1 && typeof wkRows[0].c === 'number', JSON.stringify(wkRows))
} catch (e) {
  ko++; console.log('❌ erreur inattendue :', e?.message ?? e)
} finally {
  try { await off.execute(`DROP TABLE IF EXISTS ${T}`); console.log('🧹 table de test supprimée') } catch (e) { console.log('⚠️ suppression table de test :', e.message) }
  console.log(`\n${ko === 0 ? '✅ TOUT EST BON' : '❌ ÉCHECS'} — ${ok} réussis, ${ko} échoués`)
  process.exit(ko === 0 ? 0 : 1)
}
