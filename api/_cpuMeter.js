// Compteur de CPU par fonction (19/11) — le plan Hobby de Vercel affiche le CPU total (« Fluid Active
// CPU », limite 4 h / 30 jours) mais pas le détail par fonction. Chaque fonction est enveloppée par
// withCpuMeter : temps CPU (process.cpuUsage) cumulé en mémoire, puis écrit dans Redis au plus une fois
// par minute et par instance (hash `cpu:AAAA-MM-JJ`, champs `<fonction>:<mode>:ms` et `:n`) — quelques
// commandes Redis par minute, pas une par appel. Lecture : /api/debug-push?cpu=1 (public, chiffres seuls).
// Limite assumée : avec plusieurs requêtes simultanées sur une même instance (Fluid), le CPU de l'une
// peut déborder sur l'autre — suffisant pour classer les fonctions, pas une facture au centime.
// Fichier préfixé « _ » : Vercel n'en fait pas une fonction (12/12 déjà utilisées).
import { Redis } from '@upstash/redis'

let kv = null
const pending = new Map()
let lastFlush = Date.now()
const FLUSH_MS = 60_000

async function flush() {
  if (!pending.size || !process.env.KV_REST_API_URL) return
  const entries = [...pending.entries()]
  pending.clear()
  lastFlush = Date.now()
  try {
    kv ??= new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
    const key = `cpu:${new Date().toISOString().slice(0, 10)}`
    const p = kv.pipeline()
    for (const [field, v] of entries) {
      p.hincrbyfloat(key, `${field}:ms`, Math.round(v.ms * 10) / 10)
      p.hincrby(key, `${field}:n`, v.n)
    }
    p.expire(key, 40 * 86400)
    await p.exec()
  } catch { /* mesure seulement : jamais bloquant */ }
}

export function withCpuMeter(name, handler, modeOf = null) {
  return async function metered(req, res) {
    const t0 = process.cpuUsage()
    try {
      return await handler(req, res)
    } finally {
      try {
        const d = process.cpuUsage(t0)
        let mode = ''
        try { mode = modeOf ? String(modeOf(req) ?? '') : '' } catch { mode = '' }
        const field = mode ? `${name}:${mode.replace(/[^a-z0-9_.-]/gi, '').slice(0, 40)}` : name
        const cur = pending.get(field) ?? { ms: 0, n: 0 }
        cur.ms += (d.user + d.system) / 1000
        cur.n += 1
        pending.set(field, cur)
        if (Date.now() - lastFlush >= FLUSH_MS) await flush()
      } catch { /* ignore */ }
    }
  }
}

export async function readCpuStats(days = 3) {
  kv ??= new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  const out = {}
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    const h = (await kv.hgetall(`cpu:${day}`)) ?? {}
    const rows = {}
    for (const [k, v] of Object.entries(h)) {
      const m = /^(.*):(ms|n)$/.exec(k)
      if (!m) continue
      rows[m[1]] ??= { ms: 0, n: 0 }
      rows[m[1]][m[2]] = Number(v)
    }
    out[day] = Object.entries(rows)
      .map(([fn, r]) => ({ fn, cpuSec: Math.round(r.ms / 100) / 10, calls: r.n, msPerCall: r.n ? Math.round(r.ms / r.n) : 0 }))
      .sort((a, b) => b.cpuSec - a.cpuSec)
  }
  return out
}
