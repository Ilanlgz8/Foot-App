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
 *
 * ⚠️ PRONOS QUI NE S'ENREGISTRAIENT PAS (08/11, constat utilisateur : « ça
 * enregistre pas dès que je push une modif sur Vercel et quand je redémarre
 * l'app »). Avant : le prono n'existait QUE côté serveur. Un envoi raté
 * (réseau, app rechargée par une mise à jour pendant l'envoi, Redis
 * indisponible, limite de requêtes) était ignoré en silence — la case gardait
 * le chiffre tapé, donc tout semblait enregistré… jusqu'au redémarrage. Et la
 * relecture juste après l'envoi passait par un cache CDN (8 s + 30 s
 * stale-while-revalidate) qui pouvait renvoyer l'ancienne version.
 * Désormais :
 *   1. chaque prono est d'abord écrit en localStorage (`pronos_my_preds`),
 *      AVANT l'envoi — il survit à un rechargement, une mise à jour, un
 *      redémarrage ;
 *   2. tant que le serveur n'a pas confirmé, il est renvoyé automatiquement
 *      (au retour sur l'app, au retour du réseau, puis toutes les 30 s) ;
 *   3. l'affichage de MES pronos utilise la copie locale (toujours la dernière
 *      saisie), plus jamais une relecture serveur périmée ;
 *   4. la ligne indique l'état : envoi en cours / pas encore enregistré.
 * Erreurs définitives (400/403 : groupe expiré, joueur absent du groupe) :
 * pas de renvoi en boucle, la ligne affiche l'erreur.
 */
import { useState, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const LS_DEVICE = 'pronos_device_id'
const LS_GROUP  = 'pronos_group' // { code, name }
const LS_MY_PREDS = 'pronos_my_preds' // { [code]: { [matchId]: { home, away, at, synced, error } } }
const RETRY_EVERY_MS = 30_000
const LOCAL_KEEP_MS = 60 * 24 * 3600 * 1000 // même durée que GROUP_TTL côté serveur

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

// ── Copie locale de MES pronos ─────────────────────────────────────────────
// Petit magasin externe (useSyncExternalStore) : toutes les lignes et la page
// voient la même version, mise à jour immédiatement à chaque saisie.
let myPredsCache = null
const listeners = new Set()

function readAllMyPreds() {
  if (myPredsCache) return myPredsCache
  try {
    const raw = JSON.parse(localStorage.getItem(LS_MY_PREDS) ?? 'null')
    myPredsCache = raw && typeof raw === 'object' ? raw : {}
  } catch {
    myPredsCache = {}
  }
  return myPredsCache
}

function writeAllMyPreds(next) {
  // Purge des pronos trop anciens (le serveur les a oubliés aussi).
  const now = Date.now()
  for (const code of Object.keys(next)) {
    for (const [mid, p] of Object.entries(next[code] ?? {})) {
      if (!p || now - (p.at ?? 0) > LOCAL_KEEP_MS) delete next[code][mid]
    }
    if (Object.keys(next[code] ?? {}).length === 0) delete next[code]
  }
  myPredsCache = next
  try { localStorage.setItem(LS_MY_PREDS, JSON.stringify(next)) } catch {}
  for (const l of listeners) l()
}

function updateMyPred(code, matchId, patch) {
  const all = readAllMyPreds()
  const forCode = { ...(all[code] ?? {}) }
  forCode[matchId] = { ...(forCode[matchId] ?? {}), ...patch }
  writeAllMyPreds({ ...all, [code]: forCode })
}

function subscribe(l) {
  listeners.add(l)
  const onStorage = (e) => { if (e.key === LS_MY_PREDS) { myPredsCache = null; l() } }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(l); window.removeEventListener('storage', onStorage) }
}

function useMyPreds(code) {
  const all = useSyncExternalStore(subscribe, readAllMyPreds, readAllMyPreds)
  return code ? (all[code] ?? {}) : {}
}

class PulseError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

async function postPulse(body) {
  const res = await fetch('/api/pulse', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw new PulseError(json.error || `Erreur ${res.status}`, res.status)
  return json
}

// Erreur définitive = la requête ne réussira jamais telle quelle (données
// refusées, joueur absent du groupe). Tout le reste (réseau, 429, 5xx) se
// réessaie.
const isPermanentError = (e) => e?.status === 400 || e?.status === 403 || e?.status === 413

const inFlight = new Set()

async function sendPred(deviceId, code, matchId, p) {
  const key = `${code}|${matchId}`
  if (inFlight.has(key)) return
  inFlight.add(key)
  try {
    await postPulse({ action: 'predict', deviceId, code, matchId: String(matchId), home: p.home, away: p.away })
    // Ne marque « enregistré » que si la saisie n'a pas changé pendant l'envoi.
    const cur = readAllMyPreds()[code]?.[matchId]
    if (cur && cur.home === p.home && cur.away === p.away) updateMyPred(code, matchId, { synced: true, error: null })
  } catch (e) {
    updateMyPred(code, matchId, { synced: false, error: isPermanentError(e) ? e.message : null })
    throw e
  } finally {
    inFlight.delete(key)
  }
}

function flushPending(deviceId, code) {
  if (!code) return
  const preds = readAllMyPreds()[code] ?? {}
  for (const [matchId, p] of Object.entries(preds)) {
    if (p && !p.synced && !p.error) sendPred(deviceId, code, matchId, p).catch(() => {})
  }
}

export function usePronosGroup() {
  const [deviceId]  = useState(getDeviceId)
  const [group, setGroup] = useState(getGroupInfo)
  const myPreds = useMyPreds(group?.code)

  useEffect(() => {
    const onStorage = (e) => { if (e.key === LS_GROUP) setGroup(getGroupInfo()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Renvoi automatique des pronos pas encore confirmés par le serveur.
  const code = group?.code
  useEffect(() => {
    if (!code) return
    const flush = () => flushPending(deviceId, code)
    flush()
    const onVisible = () => { if (document.visibilityState === 'visible') flush() }
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(flush, RETRY_EVERY_MS)
    return () => {
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [deviceId, code])

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
    const mid = String(matchId)
    const prev = readAllMyPreds()[group.code]?.[mid]
    // Rien à faire si c'est exactement le prono déjà enregistré.
    if (prev && prev.home === home && prev.away === away && prev.synced) return { ok: true }
    // 1) copie locale d'abord — survit à un rechargement pendant l'envoi
    updateMyPred(group.code, mid, { home, away, at: Date.now(), synced: false, error: null })
    // 2) envoi ; en cas d'échec réseau/serveur, le renvoi automatique prend le relais
    return sendPred(deviceId, group.code, mid, { home, away })
  }, [deviceId, group])

  return {
    deviceId,
    groupCode: group?.code ?? null,
    pseudo:    group?.name ?? null,
    hasGroup:  !!group?.code,
    myPreds,
    createGroup,
    joinGroup,
    leaveGroup,
    predict,
  }
}

// `deviceId` + `myPreds` (optionnels) : MES pronos sont remplacés par la copie
// locale, toujours la plus récente — une relecture serveur encore en cache
// (CDN 8 s + 30 s) ne peut plus faire « disparaître » un prono tout juste saisi.
export function usePronosGroupData(code, enabled = true, deviceId = null, myPreds = null) {
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

  const serverPredictions = data?.predictions
  const predictions = useMemo(() => {
    const base = serverPredictions ?? {}
    if (!deviceId || !myPreds || Object.keys(myPreds).length === 0) return base
    const merged = { ...base }
    for (const [mid, p] of Object.entries(myPreds)) {
      if (!p || !Number.isInteger(p.home) || !Number.isInteger(p.away)) continue
      merged[mid] = { ...(merged[mid] ?? {}), [deviceId]: { home: p.home, away: p.away } }
    }
    return merged
  }, [serverPredictions, deviceId, myPreds])

  return {
    players:     data?.players ?? {},
    predictions,
    isLoading,
    error: error?.message ?? null,
    refresh: invalidate,
  }
}
