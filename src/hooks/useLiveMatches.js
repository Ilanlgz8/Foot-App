/**
 * useLiveMatches — fallback FD.org quand ESPN est down.
 *
 * Quand ESPN fonctionne : ne fait rien (isEspnWorking() = true).
 * Quand ESPN est down   : poll FD.org toutes les 90s, appelle markLive() pour
 *                         chaque match IN_PLAY/PAUSED trouvé → widget reste visible.
 *
 * La source de vérité pour l'affichage est liveTracker (foot_live_v2).
 * Ce hook ne retourne rien d'utile ; il est monté dans LiveProvider pour ses effets.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { trackMatchState, isEspnWorking } from '../utils/matchStateTracker'
import { markLive } from './liveTracker'
import { fdFetch, fdUrl } from '../utils/fdFetch'

// ⚠️ BUG CORRIGÉ (constat utilisateur : un match de Série A brésilienne
// affiché sur Accueil/LiveMatchPage, bloqué sur "Débute" — "c'est peut-être
// FD.org, ils couvrent le championnat brésilien" — vérifié en direct,
// confirmé) : les 2 appels ci-dessous n'avaient AUCUN filtre `competitions=`
// — /v4/matches?status=IN_PLAY renvoie TOUS les matchs en cours sur TOUT le
// compte football-data.org (13 compétitions disponibles sur notre plan, pas
// seulement les 8 qu'on suit — Campeonato Brasileiro Série A, Eredivisie,
// Primeira Liga, Championship, Copa Libertadores y sont aussi). Chaque
// résultat était passé tel quel à markLive() SANS AUCUN filtre par
// compétition. Ce chemin n'est emprunté que quand ESPN est perçu comme "down"
// (isEspnWorking() === false, voir plus bas) — explique pourquoi ce n'est
// jamais arrivé avant : rare, seulement pendant les brèves fenêtres où ESPN
// semble indisponible. Même liste de codes que EURO_COMPS (useTodayMatches.js)
// + WC/EC — les 8 seules compétitions FD.org réellement suivies par l'app.
const TRACKED_FD_COMPS = 'CL,PL,FL1,PD,BL1,SA,WC,EC'

export function useLiveMatches() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const state = queryClient.getQueryState(['liveMatches'])
      const age   = Date.now() - (state?.dataUpdatedAt ?? 0)
      if (age > 90_000) {
        queryClient.invalidateQueries({ queryKey: ['liveMatches'] })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [queryClient])

  useQuery({
    queryKey: ['liveMatches'],
    queryFn: async () => {
      // ESPN opérationnel → pas besoin de FD.org
      if (isEspnWorking()) return []

      try {
        const [r1, r2] = await Promise.all([
          fdFetch(fdUrl(`/api/v4/matches?status=IN_PLAY&competitions=${TRACKED_FD_COMPS}`)),
          fdFetch(fdUrl(`/api/v4/matches?status=PAUSED&competitions=${TRACKED_FD_COMPS}`)),
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

        // Alimenter liveTracker → widget visible même quand ESPN est down
        result.forEach(m => markLive(m))
        return result
      } catch {
        return []
      }
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: 2,
    retryDelay: 5_000,
  })
}
