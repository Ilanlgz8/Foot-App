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

// 16/11 : le cache calendrier (table espn_cache) n'existe plus — calendriers par mois, voir api/espn.js.
// Ce module ne sert plus qu'à LIRE ce que le Worker écrit (worker_kv / worker_queue).

let _client = null
function client() {
  if (_client) return _client
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) return null
  _client = createClient({ url, authToken })
  return _client
}

// Permet à api/espn.js de choisir le chemin Turso seulement si les
// identifiants sont bien configurés côté Vercel — sinon repli intégral et
// silencieux sur Redis (voir commentaire d'en-tête).
// 06/11 : lecture d'une clé écrite par le Worker Cloudflare (table worker_kv, voir cf-worker/src/tursoKv.js)
// — utilisée pour l'état officiel des matchs (`pub:liveState`, lu par api/fifa-live.js). Table absente
// (Worker branché sur une autre base, ou sur Redis) → null, sans erreur.
export async function workerKvGet(key) {
  const c = client()
  if (!c) return null
  try {
    const res = await c.execute({
      sql: `SELECT value FROM worker_kv WHERE key = ? AND expires_at > ?`,
      args: [key, Math.floor(Date.now() / 1000)],
    })
    return res.rows[0]?.value ?? null
  } catch {
    return null
  }
}

export function isTursoConfigured() {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)
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
