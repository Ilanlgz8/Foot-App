// usePulse — "pouls collectif" : pronostic des fans (vote 1/X/2 anonyme) +
// réactions emoji en direct, agrégés côté serveur (api/pulse.js, Redis).
//
// Identité : un UUID anonyme par navigateur, généré une fois et persisté en
// localStorage (même logique que matchStateTracker.js/notify.js) — jamais de
// compte, jamais de donnée personnelle, juste un compteur agrégé par match.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback, useRef } from 'react'

const DEVICE_KEY = 'pulseDeviceId'

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '')
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    // localStorage indisponible (mode privé strict, etc.) — id éphémère,
    // le vote ne survivra pas au reload mais la fonctionnalité reste utilisable.
    return 'anon' + Math.random().toString(36).slice(2)
  }
}

function myVoteKey(matchId) { return `pulseVote:${matchId}` }

async function postPulse(body) {
  const res = await fetch('/api/pulse', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`pulse ${res.status}`)
  return res.json()
}

/**
 * @param {string|number} matchId
 * @param {boolean} enabled  désactive tout fetch/poll (ex: match pas encore chargé)
 */
export function usePulse(matchId, enabled = true) {
  const queryClient = useQueryClient()
  const id = matchId != null ? String(matchId) : null

  const [myVote, setMyVote] = useState(() => {
    if (!id) return null
    try { return localStorage.getItem(myVoteKey(id)) } catch { return null }
  })

  const { data, isLoading } = useQuery({
    queryKey: ['pulse', id],
    queryFn:  async () => {
      const res = await fetch(`/api/pulse?matchId=${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error(`pulse ${res.status}`)
      return res.json()
    },
    enabled:         !!id && enabled,
    refetchInterval: enabled ? 6_000 : false,   // même cadence que les autres polls live de l'app
    retry:           1,
    staleTime:       4_000,
  })

  // kickoffAt (ISO, match.utcDate) est transmis au serveur pour qu'il refuse
  // le vote une fois le coup d'envoi passé — verrou en plus du `locked` de
  // l'UI, qui à lui seul ne protège pas contre un appel direct à l'API.
  const vote = useCallback(async (choice, kickoffAt) => {
    if (!id) return
    // Optimiste : on fixe le choix visuellement avant la réponse serveur.
    setMyVote(choice)
    try { localStorage.setItem(myVoteKey(id), choice) } catch {}
    try {
      const result = await postPulse({ matchId: id, deviceId: getDeviceId(), action: 'vote', choice, kickoffAt })
      queryClient.setQueryData(['pulse', id], result)
    } catch {
      // Échec réseau : le choix local reste affiché (optimiste), le prochain
      // poll (ou la prochaine visite) resynchronisera silencieusement.
    }
  }, [id, queryClient])

  // Anti-spam côté client : au-delà du cooldown serveur (1.5s/device), on
  // désactive aussi le bouton immédiatement pour un retour visuel net.
  const reactLock = useRef(false)
  const react = useCallback(async (emoji) => {
    if (!id || reactLock.current) return
    reactLock.current = true
    setTimeout(() => { reactLock.current = false }, 1600)
    try {
      const result = await postPulse({ matchId: id, deviceId: getDeviceId(), action: 'react', emoji })
      queryClient.setQueryData(['pulse', id], result)
    } catch {}
  }, [id, queryClient])

  // Clôture pronostic une fois le match terminé : compare myVote au résultat
  // réel (matchOutcome() côté appelant) et met à jour le classement global.
  // Idempotent côté serveur (verrou 'pulse:resolved:*') donc sûr à rappeler
  // à chaque render (StrictMode, remount...).
  const resolveLock = useRef(false)
  const [resolution, setResolution] = useState(null) // { matchCorrect, top, me }
  const resolve = useCallback(async (result) => {
    if (!id || !result || resolveLock.current) return
    resolveLock.current = true
    try {
      const data = await postPulse({ matchId: id, deviceId: getDeviceId(), action: 'resolve', result })
      setResolution(data)
    } catch {
      // Échec réseau : pas grave, ce n'est qu'un classement pour le fun —
      // pas de retry agressif, le prochain accès à la page réessaiera.
    }
  }, [id])

  return {
    votes:      data?.votes     ?? { home: 0, draw: 0, away: 0, total: 0 },
    reactions:  data?.reactions ?? {},
    myVote,
    vote,
    react,
    resolve,
    resolution,
    isLoading,
  }
}

/**
 * Classement global "pronostics" (cross-match, anonyme par device).
 * Rafraîchi automatiquement après un resolve() réussi via resolution ci-dessus
 * (LivePulse le fusionne), ou manuellement via refetch().
 */
export function useLeaderboard(enabled = false) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pulse-leaderboard'],
    queryFn:  async () => {
      const res = await fetch(`/api/pulse?resource=leaderboard&deviceId=${encodeURIComponent(getDeviceId())}`)
      if (!res.ok) throw new Error(`pulse-leaderboard ${res.status}`)
      return res.json()
    },
    enabled,
    staleTime: 30_000,
    retry:     1,
  })

  return {
    top:      data?.top ?? [],
    me:       data?.me  ?? null,
    isLoading,
    refetch,
  }
}
