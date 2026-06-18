import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { trackMatchState, clearMatchState, isEspnWorking } from '../utils/matchStateTracker'
import { writeCache } from './localCache'
import { fdFetch } from '../utils/fdFetch'

const LIVE_CACHE_KEY = 'liveMatches_v1'

// IDs des matchs vus lors du dernier fetch réussi
// Quand un match disparaît de la liste live → il est terminé → on nettoie son état
const prevLiveIds = new Set()

// Matches vus IN_PLAY/PAUSED avec leur dernière version connue + timestamp
// Permet de les garder dans la liste si l'API les fait brièvement disparaître (faux SCHEDULED)
const stickyLive = new Map() // id → { match, seenAt }
const STICKY_TTL = 6 * 60_000 // 6 minutes max sans confirmation API

// ── Pas de restauration depuis le cache ───────────────────────────────────────
// useLiveMinute appelle pollESPN() immédiatement au montage (< 1s).
// ESPN est la seule source de vérité : si ESPN dit IN_PROGRESS → widget affiché,
// sinon → widget caché. Plus de données périmées après une veille ou un rechargement.

/**
 * Injecte un match dans stickyLive avec status IN_PLAY.
 * Appelé par useLiveMinute dès qu'ESPN détecte le coup d'envoi —
 * le prochain refetch de useLiveMatches inclura ce match dans le résultat
 * même si football-data.org n'a pas encore mis à jour son statut.
 */
export function injectLiveMatch(match) {
  if (!match?.id) return
  stickyLive.set(match.id, {
    match: { ...match, status: 'IN_PLAY' },
    seenAt: Date.now(),
  })
}

/**
 * Retire un match de stickyLive immédiatement (fin de match détectée par ESPN/api-football).
 * Sans ça, stickyLive le garde jusqu'à son TTL de 3min même si football-data.org
 * n'a pas encore confirmé FINISHED — le LiveWidget continuerait à l'afficher.
 */
export function evictLiveMatch(matchId) {
  if (!matchId) return
  stickyLive.delete(matchId)
}

/** Vérifie si un match est actuellement suivi comme live dans stickyLive. */
export function isStickyLive(matchId) {
  return stickyLive.has(matchId)
}

export function useLiveMatches() {
  const queryClient = useQueryClient()

  // Quand la page redevient visible après une longue inactivité (réveil ordi, retour sur l'onglet),
  // forcer un refetch — mais seulement si les données datent de plus de 90s
  // (évite un burst si le polling régulier vient juste de tourner)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const state = queryClient.getQueryState(['liveMatches'])
      const age   = Date.now() - (state?.dataUpdatedAt ?? 0)
      if (age > 90_000) {
        // Distinguer tab-switch (<5min) de vraie veille (>5min sans poll ESPN).
        // Tab-switch → juste refetch, pas de clear (le match est toujours valide).
        // Vraie veille → clear stickyLive, ESPN re-confirme dans <15s.
        const lastPoll = parseInt(localStorage.getItem('foot_espn_last_poll') ?? '0', 10)
        if (Date.now() - lastPoll > 5 * 60_000) {
          stickyLive.clear()
        }
        queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [queryClient])

  const { data } = useQuery({
    queryKey: ['liveMatches'],
    queryFn: async () => {
      try {
        const now = Date.now()

        // ── ESPN opérationnel → stickyLive suffit, 0 requête FD.org ──────────
        // ESPN gère toutes les compétitions de l'app (L1, PL, Liga, BL, SA, CL, EL, ECL, WC).
        // FD.org n'est utilisé qu'en fallback si ESPN est down (3 échecs consécutifs).
        if (isEspnWorking()) {
          const result = []
          const seen   = new Set()

          for (const [id, { match: m }] of stickyLive) {
            if (m.status === 'FINISHED') { stickyLive.delete(id); continue }
            result.push(m)
            seen.add(id)
          }

          prevLiveIds.clear()
          seen.forEach(id => prevLiveIds.add(id))
          if (result.length > 0) writeCache(LIVE_CACHE_KEY, result, 90_000)
          return result
        }

        // ── Fallback FD.org (ESPN down) ───────────────────────────────────────
        const [r1, r2] = await Promise.all([
          fdFetch('/api/v4/matches?status=IN_PLAY'),
          fdFetch('/api/v4/matches?status=PAUSED'),
        ])

        if (r1.status === 429 || r2.status === 429) throw new Error('429')
        if (r1.status === 403 || r2.status === 403) throw new Error('403')

        const live   = r1.ok ? (await r1.json()).matches ?? [] : []
        const paused = r2.ok ? (await r2.json()).matches ?? [] : []

        ;[...live, ...paused].forEach(trackMatchState)

        const seen = new Set()
        const result = [...live, ...paused].filter(m => {
          if (seen.has(m.id)) return false
          seen.add(m.id)
          return true
        })

        result.forEach(m => stickyLive.set(m.id, { match: m, seenAt: now }))

        for (const [id, { match: m, seenAt }] of stickyLive) {
          if (m.status === 'FINISHED') { stickyLive.delete(id); continue }
          if (now - seenAt > STICKY_TTL) { stickyLive.delete(id); continue }
          if (!seen.has(id)) { result.push(m); seen.add(id) }
        }

        for (const id of prevLiveIds) {
          if (!seen.has(id)) clearMatchState(id)
        }
        prevLiveIds.clear()
        seen.forEach(id => prevLiveIds.add(id))

        writeCache(LIVE_CACHE_KEY, result, 90_000)
        return result
      } catch (e) {
        throw e
      }
    },
    // ESPN gère KO/MT/FT/minutes en temps réel → football-data.org n'est plus
    // qu'un backup pour la liste des matchs. On peut se permettre 90s.
    // Sans live : 60s suffit pour détecter un nouveau match qui commence.
    // Avec live : 90s → 4 req/90s ≈ 2.7 req/min au lieu de 8 req/min → bien sous la limite de 10.
    refetchInterval: (query) => {
      const hasLive = (query.state.data ?? []).length > 0
      return hasLive ? 90_000 : 60_000
    },
    staleTime: 60_000,
    retry: 2,
    retryDelay: 5_000,
  })

  // Dès qu'on a des données (fetch OU restauration PersistQueryClientProvider),
  // les écrire en cache localStorage → disponibles instantanément au prochain reload
  useEffect(() => {
    if (data && data.length > 0) {
      writeCache(LIVE_CACHE_KEY, data, 10 * 60_000) // 10 min — survit largement à un rechargement
    }
  }, [data])

  return data ?? []
}
