// Client Turso minimal (protocole HTTP « pipeline » v2) — remplaçant léger de @libsql/client/web, voir tursoKv.js.
function toArg(v) {
  if (v === null || v === undefined) return { type: 'null' }
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' }
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() }
  return { type: 'text', value: String(v) }
}
function fromValue(v) {
  if (!v || v.type === 'null') return null
  if (v.type === 'integer') return Number(v.value)
  if (v.type === 'float') return Number(v.value)
  return v.value
}
function toStmt(s) {
  if (typeof s === 'string') return { sql: s, args: [] }
  return { sql: s.sql, args: (s.args ?? []).map(toArg) }
}
function toResultSet(r) {
  const names = r.cols.map(c => c.name)
  const rows = r.rows.map(row => {
    const o = {}
    row.forEach((v, i) => { o[names[i]] = fromValue(v) })
    return o
  })
  return { columns: names, rows, rowsAffected: r.affected_row_count, lastInsertRowid: r.last_insert_rowid }
}
function hranaError(e) {
  const err = new Error(`${e?.code ?? 'SQLITE_ERROR'}: ${e?.message ?? 'erreur Turso'}`)
  err.code = e?.code
  return err
}
export function createTursoHttpClient({ url, authToken }) {
  const endpoint = url.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '') + '/v2/pipeline'
  // Les requêtes lancées dans le même tour (ex. Promise.all) partent dans UN
  // seul appel HTTP, comme le faisait @libsql/client — indispensable pour le
  // plafond de 50 sous-requêtes du plan gratuit. Chaque requête reste
  // indépendante (pas de transaction commune) : un échec n'affecte qu'elle.
  let queue = null
  function pipeline(request) {
    return new Promise((resolve, reject) => {
      if (!queue) {
        queue = []
        Promise.resolve().then(flush)
      }
      queue.push({ request, resolve, reject })
    })
  }
  async function flush() {
    const items = queue
    queue = null
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [...items.map(it => it.request), { type: 'close' }] }),
      })
      if (!r.ok) throw new Error(`Turso HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const results = (await r.json()).results ?? []
      items.forEach((it, i) => {
        const res = results[i]
        if (!res) it.reject(new Error('Turso : réponse manquante'))
        else if (res.type === 'error') it.reject(hranaError(res.error))
        else it.resolve(res.response)
      })
    } catch (e) {
      for (const it of items) it.reject(e)
    }
  }
  return {
    async execute(stmt) {
      const resp = await pipeline({ type: 'execute', stmt: toStmt(stmt) })
      return toResultSet(resp.result)
    },
    // Même sémantique que @libsql/client batch(stmts, 'write') : tout ou rien
    // (BEGIN IMMEDIATE … COMMIT, ROLLBACK si une étape échoue).
    async batch(stmts, mode = 'deferred') {
      const begin = mode === 'write' ? 'BEGIN IMMEDIATE' : mode === 'read' ? 'BEGIN TRANSACTION READONLY' : 'BEGIN DEFERRED'
      const steps = [{ stmt: { sql: begin, args: [] } }]
      stmts.forEach(s => steps.push({ stmt: toStmt(s), condition: { type: 'ok', step: steps.length - 1 } }))
      const commitIdx = steps.length
      steps.push({ stmt: { sql: 'COMMIT', args: [] }, condition: { type: 'ok', step: commitIdx - 1 } })
      steps.push({ stmt: { sql: 'ROLLBACK', args: [] }, condition: { type: 'not', cond: { type: 'ok', step: commitIdx } } })
      const resp = await pipeline({ type: 'batch', batch: { steps } })
      const { step_results: results, step_errors: errors } = resp.result
      for (let i = 1; i <= stmts.length; i++) {
        if (errors[i]) throw hranaError(errors[i])
      }
      if (errors[commitIdx]) throw hranaError(errors[commitIdx])
      if (!results[commitIdx]) throw new Error('Turso : transaction non validée')
      return stmts.map((_, i) => toResultSet(results[i + 1]))
    },
  }
}
