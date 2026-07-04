// api/debug-push.js
// Diagnostic push notifications — protégé par CRON_SECRET
//
// GET /api/debug-push?secret=VOTRE_SECRET
//
// Retourne :
//   • nb de subscriptions dans Redis
//   • VAPID configuré ?
//   • Dernière exécution du cron (clé KV)

import { Redis } from '@upstash/redis'
import webpush  from 'web-push'

const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

export default async function handler(req, res) {
  // Auth
  const secret = req.headers['x-cron-secret'] ?? req.query.secret ?? ''
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' })
  }

  const info = {}

  // 1. VAPID
  const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  info.vapid = {
    configured: !!(VAPID_SUBJECT && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
    subject:    VAPID_SUBJECT ?? null,
    publicKey:  VAPID_PUBLIC_KEY ? VAPID_PUBLIC_KEY.slice(0, 12) + '…' : null,
  }

  // 2. Subscriptions dans Redis
  try {
    const subs = (await kv.smembers('push:subscriptions')) ?? []
    info.subscriptions = {
      count:     subs.length,
      endpoints: subs.map(s => {
        try {
          const parsed = typeof s === 'string' ? JSON.parse(s) : s
          const url = new URL(parsed.endpoint)
          return url.hostname // ex: fcm.googleapis.com
        } catch { return '(parse error)' }
      }),
    }
  } catch (e) {
    info.subscriptions = { error: e.message }
  }

  // 3. Dernier run du cron — AVANT ce fix, cette section ne vérifiait RIEN
  // de réel (juste "KV répond"), donc impossible de savoir si cron-job.org
  // appelle bien /api/cron-goals chaque minute ou si le job est cassé côté
  // cron-job.org (secret expiré, job désactivé/en pause, plan gratuit
  // expiré...) — cause plausible de "je ne reçois plus aucune notif de but"
  // qu'aucun log applicatif ne peut révéler puisque le cron externe
  // n'atteint alors même pas ce serveur.
  try {
    const lastRun    = await kv.get('cron:goals:lastRun')
    const lastResult = await kv.get('cron:goals:lastResult')
    const parsedResult = lastResult
      ? (typeof lastResult === 'string' ? JSON.parse(lastResult) : lastResult)
      : null
    const ageSec = lastRun ? Math.round((Date.now() - Number(lastRun)) / 1000) : null
    info.cron = {
      reachable:   true,
      lastRunAgo:  ageSec != null ? `${ageSec}s` : 'jamais',
      // Le cron est censé tourner toutes les 60s (cron-job.org) → si la
      // dernière exécution connue date de plus de 3min, cron-job.org
      // n'appelle probablement plus cet endpoint.
      stale:       ageSec == null || ageSec > 180,
      lastResult:  parsedResult,
    }
  } catch (e) {
    info.cron = { reachable: false, error: e.message }
  }

  // 3bis. Historique des logs (dernières lignes, toutes exécutions confondues
  // sur les dernières 24h) — permet de diagnostiquer un match précis après
  // coup (ex: "pourquoi tel but n'a pas été notifié ?") au lieu de deviner
  // sans preuve. Filtrable côté client via ?match=<eventId ESPN ou mot-clé>
  // pour ne pas avoir à lire des milliers de lignes toutes compétitions
  // confondues.
  try {
    const raw = (await kv.lrange('cron:goals:logHistory', 0, -1)) ?? []
    const filter = String(req.query.match ?? '').trim()
    info.logHistory = {
      totalLines: raw.length,
      lines: filter ? raw.filter(l => l.includes(filter)) : raw.slice(-200),
    }
  } catch (e) {
    info.logHistory = { error: e.message }
  }

  // 4. Test envoi VAPID (dry-run — sans vraie subscription)
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    info.vapid.valid = true
  } catch (e) {
    info.vapid.valid = false
    info.vapid.error = e.message
  }

  return res.status(200).json({ ok: true, ...info })
}
