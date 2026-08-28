import { useQuery } from '@tanstack/react-query'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { readCacheStale, getCacheSavedAt, writeCache } from './localCache'
import { classifyFetchError } from '../utils/fetchErrors'
import { toFdcoukName } from '../data/fdcoukTeamNames'

// ── useCrossCompH2H — confrontations directes entre 2 équipes, PEU IMPORTE
// leur championnat respectif ──────────────────────────────────────────────
//
// ⚠️ AJOUT (28/08, demande utilisateur — simulateur de confrontation
// hypothétique dans Pronos.jsx) : tous les hooks H2H existants de l'app
// (useH2HHistory, useH2HRows...) sont scopés à UNE compétition (ils lisent
// dans compMatches, déjà chargé pour cette compétition précise) — aucun ne
// peut répondre à "est-ce que ces 2 équipes-là, MÊME de championnats
// différents, se sont déjà affrontées" (ex. PSG-Bayern en Ligue des
// Champions alors qu'on compare depuis Ligue 1/Bundesliga).
//
// football-data.org expose /v4/teams/{id}/matches : TOUT l'historique
// d'UNE équipe, toutes compétitions confondues — jamais utilisé ailleurs
// dans l'app jusqu'ici. Un seul appel (équipe domicile), filtré côté client
// pour ne garder que les matchs contre l'équipe extérieure — TOUTES ses
// confrontations apparaissent déjà dans cette liste (elle contient ses
// matchs domicile ET extérieur), pas besoin d'un 2e appel symétrique.
//
// Volontairement PAS auto-déclenché : seulement quand l'utilisateur clique
// "Comparer" (enabled), jamais en arrière-plan — un appel FD.org de plus par
// clic explicite reste dans l'esprit du budget partagé (7 req/min, voir
// CLAUDE.md), contrairement à un fetch qui se répéterait à chaque
// changement de sélection dans les menus déroulants.
const STALE_MS = 1000 * 60 * 60 * 24  // 24h — un historique de confrontations ne change qu'après un nouveau match entre les 2, rarissime

// ── Extension multi-années football-data.co.uk (28/08, voir api/h2h.js) ──
// FD.org (ci-dessus) ne couvre QUE la saison en cours en compte gratuit —
// quasi toujours vide pour un H2H. Requête SÉPARÉE (queryKey distincte,
// n'affecte jamais le chemin FD.org existant), déclenchée UNIQUEMENT quand
// les 2 équipes sont du MÊME championnat (paramètre `sameCompInfo`, fourni
// par l'appelant — ce hook ne devine rien) parmi les 5 couverts par
// FDCOUK_LEAGUE_FILE (pas de fichier pour les compétitions européennes).
// Fusionnée avec `meetings` plutôt que substituée : les 2 sources sont
// complémentaires, jamais en doublon (api/h2h.js exclut lui-même la saison
// en cours, déjà couverte côté FD.org).
const H2H_STALE_MS = 1000 * 60 * 60 * 24 // 24h — historique de saisons terminées, immuable

export function useCrossCompH2H(homeId, awayId, enabled, sameCompInfo) {
  const key = `crossH2H_${homeId}_${awayId}`
  const { comp, homeShortName, awayShortName } = sameCompInfo ?? {}

  const { data, isLoading, error } = useQuery({
    queryKey: ['crossCompH2H', homeId, awayId],
    queryFn: async () => {
      const url = fdUrl(`/api/v4/teams/${homeId}/matches?status=FINISHED&limit=100`)
      const res = await fdFetch(url)
      if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      const all = json.matches ?? []
      const meetings = all.filter(m =>
        (m.homeTeam?.id === homeId && m.awayTeam?.id === awayId) ||
        (m.homeTeam?.id === awayId && m.awayTeam?.id === homeId)
      )
      writeCache(key, meetings, STALE_MS)
      return meetings
    },
    initialData:          readCacheStale(key) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(key),
    staleTime:            STALE_MS,
    retry:                false,
    enabled:               enabled && homeId != null && awayId != null,
  })

  const extendedEnabled = enabled && !!comp && !!homeShortName && !!awayShortName && homeId != null && awayId != null
  const extKey = `h2hExt_${comp}_${homeId}_${awayId}`

  const { data: extended, isLoading: extLoading } = useQuery({
    queryKey: ['fdcoukH2H', comp, homeId, awayId],
    queryFn: async () => {
      const params = new URLSearchParams({ comp, home: homeShortName, away: awayShortName })
      const res = await fetch(`/api/h2h?${params.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      const rows = json.meetings ?? []
      // Reconstruit le même format que les meetings FD.org ci-dessus
      // ({status, homeTeam:{id}, awayTeam:{id}, score:{fullTime}}), seul
      // format lu par directMeetings()/outcomeForTeam() (calcProno.js,
      // matchUtils.js) — aucune nouvelle logique de lecture à écrire côté
      // consommateur. `m.home`/`m.away` (noms football-data.co.uk) sont
      // remis en correspondance avec les VRAIS ids FD.org homeId/awayId en
      // comparant au nom déjà résolu de CE côté-ci (homeShortName →
      // fdcouk), garantissant le bon sens domicile/extérieur historique
      // (pas juste "homeId d'un côté, awayId de l'autre" à l'aveugle).
      const homeFdcouk = toFdcoukName(homeShortName)
      const converted = rows.map(m => {
        const literalHomeIsOurHome = m.home === homeFdcouk
        return {
          status: 'FINISHED',
          homeTeam: { id: literalHomeIsOurHome ? homeId : awayId },
          awayTeam: { id: literalHomeIsOurHome ? awayId : homeId },
          score: { fullTime: { home: m.homeGoals, away: m.awayGoals } },
        }
      })
      writeCache(extKey, converted, H2H_STALE_MS)
      return converted
    },
    initialData:          readCacheStale(extKey) ?? undefined,
    initialDataUpdatedAt: getCacheSavedAt(extKey),
    staleTime:            H2H_STALE_MS,
    retry:                false,
    enabled:               extendedEnabled,
  })

  const meetings = [...(data ?? []), ...(extended ?? [])]

  return {
    meetings,
    loading:  isLoading || (extendedEnabled && extLoading),
    error:    classifyFetchError(error?.message),
  }
}
