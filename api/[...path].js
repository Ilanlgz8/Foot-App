// Proxy football-data.org — catch-all Vercel pour /api/v4/**
//
// ⚠️ SÉCURITÉ (corrigé lors d'un audit) : ce endpoint transmettait n'importe
// quel chemin/query vers football-data.org avec notre clé API_KEY, sans
// AUCUNE protection — ni cache, ni origin check, ni limite de débit.
// N'importe qui pouvait appeler /api/v4/<tout> directement (curl, bot) et
// consommer librement le quota FD.org (10 req/min sur le plan gratuit),
// provoquant des 429 pour les vrais utilisateurs (voir CLAUDE.md, problème
// déjà documenté et jusqu'ici non expliqué). Ajout d'un budget global partagé
// (même pattern que reserveQuota() dans api/apifootball.js, déjà éprouvé en
// prod suite à une suspension de compte api-football) : quel que soit
// l'appelant, jamais plus de FD_MINUTE_CAP requêtes upstream par minute.
import { Redis } from '@upstash/redis'

let kv = null
function getKv() {
  if (!kv && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  }
  return kv
}

// ⚠️ Clé Redis PARTAGÉE avec api/football.js (même compteur `fd:quota:min:*`) :
// les deux endpoints tapent le MÊME quota football-data.org (10 req/min total,
// tous appelants confondus) — un budget compté séparément par fichier
// laisserait passer jusqu'à 2x FD_MINUTE_CAP en combinant les deux, dépassant
// la vraie limite. FD_MINUTE_CAP doit rester identique des deux côtés.
const FD_MINUTE_CAP = 7 // sur 10/min réels — marge de sécurité, même logique qu'apifootball.js

async function reserveFdQuota() {
  const redis = getKv()
  if (!redis) return true // Redis indisponible → on ne bloque pas tout le service pour ça
  const minuteKey = `fd:quota:min:${new Date().toISOString().slice(0, 16)}`
  try {
    const count = await redis.incr(minuteKey)
    if (count === 1) await redis.expire(minuteKey, 70)
    return count <= FD_MINUTE_CAP
  } catch {
    return true
  }
}

export default async function handler(req, res) {
  // GET uniquement — pas de proxying de mutations vers FD.org avec notre clé API
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' })
  }

  if (!(await reserveFdQuota())) {
    return res.status(200).json({ errors: { quota: 'Budget interne football-data.org atteint, réessaie plus tard' } })
  }

  try {
    const { path: segments } = req.query
    const parts   = Array.isArray(segments) ? segments : [segments]
    const apiPath = '/' + parts.join('/')

    // Utiliser le query string brut de req.url pour éviter le re-encodage des virgules
    // (new URLSearchParams encoderait competitions=CL,PL → CL%2CPL, rejeté par football-data.org)
    const qsStart = (req.url ?? '').indexOf('?')
    const qs      = qsStart >= 0 ? req.url.slice(qsStart) : ''
    const url     = `https://api.football-data.org${apiPath}${qs}`

    if (!process.env.API_KEY) {
      return res.status(500).json({ error: 'API_KEY not configured on Vercel' })
    }

    const response = await fetch(url, {
      headers: { 'X-Auth-Token': process.env.API_KEY },
    })

    const body = await response.text()
    res.status(response.status)
       .setHeader('Content-Type', 'application/json')
       .send(body)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
