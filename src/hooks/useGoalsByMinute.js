// useGoalsByMinute — répartition des buts par tranche de minute de jeu, sur
// TOUS les matchs terminés d'une compétition (onglet Tendances).
//
// Pourquoi ESPN et pas football-data.org : FD.org (plan gratuit, 10 req/min)
// n'expose pas la minute exacte de chaque but dans la liste des matchs, il
// faudrait un appel détaillé par match — hors budget. ESPN, en revanche, est
// déjà documenté ailleurs dans l'app comme "gratuit, illimité" (voir
// useProbableLineups) et chaque summary est mis en cache côté serveur 7 jours
// dans Redis, PARTAGÉ entre tous les utilisateurs (voir api/espn.js) — donc
// ce coût (1 scoreboard par date + 1 summary par match) n'est payé qu'UNE
// SEULE FOIS par match, par le premier utilisateur qui ouvre Tendances après
// que ce match soit terminé. Aucune nouvelle fonction serverless : on
// réutilise /api/espn.js tel quel (mode scoreboard + mode summary, déjà
// utilisés par useEspnMatchDetail.js).
import { useQuery } from '@tanstack/react-query'
import { fuzzyTeam } from './useLiveMinute'
import { extractGoalMinutes } from './useEspnMatchDetail'
import { COMPETITION_ESPN_SLUG } from '../data/competitions'

const BUCKET_ORDER = ['0-15', '16-30', '31-45', '46-60', '61-75', '76-90', '90+']

function espnDateStr(utcDate) {
  const d = new Date(utcDate)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

// "45+2'" → 45 (le "+2" de temps additionnel n'affecte pas la tranche —
// un but à 45+2 reste un but de fin de 1ère mi-temps, pas de 2e).
function baseMinute(displayValue) {
  const m = String(displayValue ?? '').match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function bucketFor(minute) {
  if (minute == null) return null
  if (minute <= 15) return '0-15'
  if (minute <= 30) return '16-30'
  if (minute <= 45) return '31-45'
  if (minute <= 60) return '46-60'
  if (minute <= 75) return '61-75'
  if (minute <= 90) return '76-90'
  return '90+'
}

export function useGoalsByMinute(selectedComp, finishedMatches) {
  const slug = COMPETITION_ESPN_SLUG[selectedComp] ?? null
  const matches = finishedMatches ?? []
  const matchIds = matches.map(m => m.id).join(',')

  return useQuery({
    // 'v2' : bump volontaire — l'app persiste les résultats React Query en
    // localStorage 24h (voir main.jsx). Sans ce bump, les navigateurs ayant
    // déjà ouvert Tendances AVANT le fix de la date ESPN (voir commit
    // précédent) resserviraient leur résultat vide en cache pendant jusqu'à
    // 15min (staleTime) sans jamais retenter le vrai fetch corrigé.
    queryKey: ['goalsByMinute', 'v2', selectedComp, matchIds],
    enabled: !!slug && matches.length > 0,
    staleTime: 15 * 60_000,
    retry: 1,
    queryFn: async () => {
      // 1. Construire l'ensemble des dates ESPN à interroger.
      //
      // ⚠️ ESPN groupe son scoreboard par date CALENDAIRE LOCALE du stade, pas
      // par date UTC. Beaucoup de matchs de ce Mondial (Amérique du Nord) se
      // jouent en soirée locale, ce qui fait "rouler" leur utcDate au
      // lendemain UTC. Exemple vérifié : Czechia-Corée du Sud, utcDate
      // 2026-06-12T02:00Z (2h du matin), apparaît dans le scoreboard ESPN
      // dates=20260611 — jamais dans dates=20260612. Avec un seul jour
      // (l'ancien code prenait juste le jour UTC), ce match — et la plupart
      // des matchs joués en soirée — n'étaient JAMAIS résolus en eventId,
      // eventIds restait vide, et le graphique par minute n'affichait rien.
      // Fix : pour chaque match on interroge la date UTC ET la veille, puis on
      // fusionne tous les events récupérés dans un seul pool avant le matching
      // fuzzy. Tous les fuseaux du tournoi sont en retard sur UTC (jamais en
      // avance), donc "UTC ou UTC-1" couvre tous les cas sans avoir à
      // maintenir une table de fuseaux par stade.
      const neededDates = new Set()
      for (const m of matches) {
        if (!m?.utcDate) continue
        const d = new Date(m.utcDate)
        neededDates.add(espnDateStr(d))
        neededDates.add(espnDateStr(new Date(d.getTime() - 86_400_000)))
      }

      const allEvents = []
      await Promise.all([...neededDates].map(async (day) => {
        try {
          const res = await fetch(`/espn?slug=${slug}&dates=${day}`)
          if (!res.ok) return
          const board = await res.json()
          allEvents.push(...(board.events ?? []))
        } catch { /* jour ignoré si erreur réseau — pas bloquant pour le reste */ }
      }))

      const eventIds = []
      const seenIds = new Set()
      for (const m of matches) {
        const fdHome = m.homeTeam?.name ?? m.homeTeam?.shortName ?? ''
        const fdAway = m.awayTeam?.name ?? m.awayTeam?.shortName ?? ''
        for (const evt of allEvents) {
          if (seenIds.has(evt.id)) continue
          const comp  = evt.competitions?.[0]
          const homeC = (comp?.competitors ?? []).find(c => c.homeAway === 'home')
          const awayC = (comp?.competitors ?? []).find(c => c.homeAway === 'away')
          if (!homeC || !awayC) continue
          const espnHome = homeC.team?.displayName ?? homeC.team?.name ?? ''
          const espnAway = awayC.team?.displayName ?? awayC.team?.name ?? ''
          if (fuzzyTeam(fdHome, espnHome) && fuzzyTeam(fdAway, espnAway)) {
            eventIds.push(evt.id)
            seenIds.add(evt.id)
            break
          }
        }
      }

      // 2. Summary par match résolu → minutes de but réelles
      const buckets = Object.fromEntries(BUCKET_ORDER.map(k => [k, 0]))
      let totalGoals = 0

      await Promise.all(eventIds.map(async (eventId) => {
        try {
          const res = await fetch(`/espn?slug=${slug}&eventId=${eventId}`)
          if (!res.ok) return
          const summary = await res.json()
          for (const raw of extractGoalMinutes(summary)) {
            const bucket = bucketFor(baseMinute(raw))
            if (bucket) { buckets[bucket]++; totalGoals++ }
          }
        } catch { /* match ignoré si erreur réseau */ }
      }))

      return {
        rounds: BUCKET_ORDER.map(key => ({ key, label: key, goals: buckets[key] })),
        totalGoals,
        resolvedMatches: eventIds.length,
      }
    },
  })
}
