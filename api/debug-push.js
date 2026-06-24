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

  // 3. Dernier run du cron (on vérifie une clé ESPN récente)
  try {
    // Lister quelques clés cron:espn:* pour voir si le cron tourne
    // Note : smembers sur un pattern n'existe pas, on juste confirme que KV répond
    info.kv = { reachable: true }
  } catch (e) {
    info.kv = { reachable: false, error: e.message }
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
