/**
 * usePronosGroup.js — Pronos entre amis (groupe par code, sans compte).
 *
 * Identité minimale, purement locale :
 *   - deviceId : UUID généré une fois, persisté en localStorage. Sert
 *     uniquement à savoir "qui a écrit quoi" dans un groupe côté serveur
 *     (api/pulse.js) — jamais de mot de passe, jamais d'email.
 *   - groupCode + pseudo : le groupe actif (code à 6 caractères type Kahoot)
 *     et le pseudo choisi, persistés pour rester dans le groupe entre deux
 *     visites de l'app.
 *
 * Toutes les requêtes réseau passent par api/pulse.js (createGroup/join/predict),
 * même fichier que la courbe de bascule — pas de nouvel endpoint (limite
 * 12/12 functions Vercel Hobby).
 */
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const LS_DEVICE = 'pronos_device_id'
const LS_GROUP  = 'pronos_group' // { code, name }

function getDeviceId() {
  try {
    let id = localStorage.getItem(LS_DEVICE)
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
      localStorage.setItem(LS_DEVICE, id)
    }
    return id
  } catch {
    // Pas de localStorage (navigation privée stricte) : id éphémère, pas de persistance possible
    return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

function getGroupInfo() {
  try {
    const raw = localStorage.getItem(LS_GROUP)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function persistGroupInfo(info) {
  try {
    if (info) localStorage.setItem(LS_GROUP, JSON.stringify(info))
    else localStorage.removeItem(LS_GROUP)
  } catch {}
}

async function postPulse(body) {
  const res = await fetch('/api/pulse', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw new Error(json.error || `Erreur ${res.status}`)
  return json
}

export function usePronosGroup() {
  const [deviceId]  = useState(getDeviceId)
  const [group, setGroup] = useState(getGroupInfo)

  useEffect(() => {
    const onStorage = (e) => { if (e.key === LS_GROUP) setGroup(getGroupInfo()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const createGroup = useCallback(async (name) => {
    const json = await postPulse({ action: 'createGroup', deviceId, name })
    const info = { code: json.code, name }
    persistGroupInfo(info)
    setGroup(info)
    return json.code
  }, [deviceId])

  const joinGroup = useCallback(async (code, name) => {
    const cleanCode = String(code).toUpperCase().trim()
    await postPulse({ action: 'join', deviceId, name, code: cleanCode })
    const info = { code: cleanCode, name }
    persistGroupInfo(info)
    setGroup(info)
    return cleanCode
  }, [deviceId])

  const leaveGroup = useCallback(() => {
    persistGroupInfo(null)
    setGroup(null)
  }, [])

  const predict = useCallback(async (matchId, home, away) => {
    if (!group?.code) throw new Error('Aucun groupe actif')
    return postPulse({ action: 'predict', deviceId, code: group.code, matchId: String(matchId), home, away })
  }, [deviceId, group])

  return {
    deviceId,
    groupCode: group?.code ?? null,
    pseudo:    group?.name ?? null,
    hasGroup:  !!group?.code,
    createGroup,
    joinGroup,
    leaveGroup,
    predict,
  }
}

// Données du groupe (joueurs + pronostics) — pollées légèrement pour voir les
// pronostics des amis se mettre à jour (lecture Redis seule, coût minime,
// aucun appel ESPN/FD.org donc aucun impact sur le budget cron).
export function usePronosGroupData(code, enabled = true) {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['pronosGroup', code],
    queryFn: async () => {
      const res = await fetch(`/api/pulse?resource=group&code=${encodeURIComponent(code)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || `groupe ${res.status}`)
      return json
    },
    enabled:        !!code && enabled,
    staleTime:      15_000,
    refetchInterval: 30_000,
    retry: false,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pronosGroup', code] })
  }, [queryClient, code])

  return {
    players:     data?.players ?? {},
    predictions: data?.predictions ?? {},
    isLoading,
    error: error?.message ?? null,
    refresh: invalidate,
  }
}
