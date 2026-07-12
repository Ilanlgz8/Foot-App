/**
 * LiveProvider — contexte global pour les données live.
 *
 * Monté au niveau App (au-dessus des Routes) → survit aux navigations intra-app.
 * Quand l'utilisateur va sur Classement, Résultats, etc., le polling ESPN continue.
 *
 * Fournit via useLiveData() :
 *   • liveMatches  — matchs actuellement en cours (source : liveTracker, persisté localStorage)
 *   • espnScores   — scores + buteurs + stats ESPN en temps réel
 *   • recalibrate  — force un re-poll complet (bouton ⟳ dans LiveWidget)
 *
 * Architecture :
 *   liveTracker.js est la seule source de vérité.
 *   markLive(match) → widget visible immédiatement, même après reload.
 *   markEnded(id)   → widget disparaît (5min de STATUS_FINAL + horloge >= 85min).
 *   Pas de stickyLive, pas de machine d'états complexe, pas de pendingEviction.
 */

import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTodayMatches } from '../hooks/useTodayMatches'
import { useLiveMatches } from '../hooks/useLiveMatches'
import { useLiveMinute } from '../hooks/useLiveMinute'
import { useEspnScores } from '../hooks/useEspnScores'
import { useLiveTracker } from '../hooks/liveTracker'
import { requestNotificationPermission } from '../utils/notifications'

const LiveCtx = createContext({
  liveMatches:  [],
  espnScores:   {},
  recalibrate:  null,
})

export function LiveProvider({ children }) {
  const queryClient = useQueryClient()

  // Toujours aujourd'hui — le live ne concerne que le jour courant
  const { matches } = useTodayMatches()

  // FD.org polling (fallback si ESPN down) — side effect uniquement
  // Quand ESPN est down, useLiveMatches appelle markLive() pour les matchs IN_PLAY FD.org
  useLiveMatches()

  const espnScores = useEspnScores()

  // ── Source de vérité unique ─────────────────────────────────────────────────
  // liveTracker lit depuis localStorage au module load → disponible immédiatement.
  // markLive() appelé dans useLiveMinute → met à jour liveTracker → re-render ici.
  // Survit aux rechargements, aux faux STATUS_FINAL ESPN, et aux buts.
  const liveMatches = useLiveTracker()

  const { recalibrate } = useLiveMinute(
    liveMatches.length > 0
      ? [...matches, ...liveMatches.filter(g => !matches.some(m => m.id === g.id))]
      : matches
  )

  // Quand un nouveau match passe en live → invalider useTodayMatches immédiatement
  const prevLiveCount = useRef(0)
  useEffect(() => {
    if (liveMatches.length > prevLiveCount.current) {
      queryClient.invalidateQueries({ queryKey: ['todayMatches'] })
      requestNotificationPermission()
    }
    prevLiveCount.current = liveMatches.length
  }, [liveMatches.length, queryClient])

  // Badge sur l'icône PWA = nombre de matchs live en cours, visible sans
  // ouvrir l'app (Badging API — supportée par Chrome/Edge desktop+Android,
  // pas par Safari/iOS : feature-detect, dégradation silencieuse sinon).
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    if (liveMatches.length > 0) {
      navigator.setAppBadge(liveMatches.length).catch(() => {})
    } else {
      navigator.clearAppBadge().catch(() => {})
    }
  }, [liveMatches.length])

  // ⚠️ BUG CORRIGÉ (constat utilisateur : navigation/clics "pas fluides",
  // comme si l'app buggait un peu) : la value du Provider était un littéral
  // objet recréé À CHAQUE render de LiveProvider — et LiveProvider re-render
  // très souvent (poll ESPN toutes les 10-30s, mises à jour liveTracker, etc.).
  // Comme LiveProvider englobe TOUTE l'app (au-dessus des Routes), une
  // nouvelle référence d'objet ici fait re-render TOUS les composants qui
  // appellent useLiveData() n'importe où dans l'arbre, même ceux dont les
  // données affichées n'ont pas changé — un poll qui tombe pile pendant un
  // clic/une navigation peut donc provoquer un à-coup visible. useMemo :
  // seule une vraie nouvelle valeur de liveMatches/espnScores/recalibrate
  // déclenche un re-render des consommateurs.
  const ctxValue = useMemo(
    () => ({ liveMatches, espnScores, recalibrate }),
    [liveMatches, espnScores, recalibrate]
  )

  return (
    <LiveCtx.Provider value={ctxValue}>
      {children}
    </LiveCtx.Provider>
  )
}

/** Accès aux données live depuis n'importe quel composant. */
export function useLiveData() {
  return useContext(LiveCtx)
}
