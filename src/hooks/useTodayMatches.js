import { useQuery, useQueries } from '@tanstack/react-query'
import { readCacheStale, getCacheSavedAt, writeCache, readCache } from './localCache'
import { fdFetch, fdUrl } from '../utils/fdFetch'
import { fetchEspnCompMatches, fetchEspnCupMatches } from '../utils/espnAdapter'
import { COMPETITION_ESPN_SLUG, DOMESTIC_CUPS, MAJOR_LEAGUE_FD_ID } from '../data/competitions'

const VALID_STATUS = ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'FINISHED']

// ⚠️ AJOUT (constat utilisateur : la flèche "jour suivant" de l'Accueil
// sautait jusqu'au 16 août — un vrai match ce jour-là — mais le panneau
// affichait "aucun match"). Cause : cette fonction (fetchTodayMatches,
// utilisée pour les CARDS affichées) ne couvrait à l'origine que EURO_COMPS
// (FD.org) + WC, alors que la recherche du "prochain jour avec un match"
// (useUpcomingMatchesAllComps, dans useMatchs.js) couvre TOUTES les
// compétitions suivies (voir ACCUEIL_COMP_IDS dans Accueil.jsx). La flèche
// pouvait donc sauter vers un jour dont le SEUL match provenait d'une
// compétition manquante ici → jour trouvé, mais rien à afficher une fois
// arrivé dessus. Complété pour couvrir les mêmes compétitions.
//
// ⚠️ AJOUT 2 (23/07, demande explicite utilisateur suite à des 429 constatés
// en direct sur football-data.org, screenshot Network à l'appui) : FL1/PL/
// PD/BL1/SA/CL étaient jusqu'ici récupérés via UN SEUL appel FD.org
// multi-compétitions (`EURO_COMPS`, désormais retiré) — mais c'était, avec
// les appels WC/EC, le plus gros contributeur de charge FD.org de toute
// l'app (relancé à chaque jour affiché dans Accueil). Basculés sur ESPN ici,
// même mécanisme que NL/CAN/COPA/UEL/UECL juste en dessous.
//
// Volontairement LIMITÉ à ce fichier (widget "jour" de l'Accueil, simple
// liste triée par date) : Programme.jsx (useMatches, useMatchs.js) reste sur
// FD.org pour ces 6 comps, car sa vue "Par journée" a besoin du champ
// `matchday`, qu'ESPN ne fournit jamais (toujours `null`, voir
// normalizeEvent dans espnAdapter.js) — y toucher aurait cassé le
// regroupement par journée. Ce widget-ci n'affiche qu'une liste
// chronologique d'un jour donné, aucun besoin de matchday.
//
// REAL_COMP_ID : contrairement à NL/CAN/COPA/UEL/UECL (100% ESPN, aucun id
// football-data.org n'existe pour elles), ces 6 comps ONT un vrai id
// numérique FD.org, utilisé ailleurs dans l'app (matching live précis dans
// api/fifa-live.js/COMP_ESPN, regroupement par compétition dans
// ResultPanel.jsx). Sans le transmettre, ces matchs récupéreraient un
// competition.id à `null` (voir SYNTHETIC_COMP_ID, espnAdapter.js — pensé
// pour des comps qui n'ont justement PAS de vrai id) : plusieurs vrais
// championnats différents se retrouveraient fusionnés dans un même groupe
// "Autre" partout où l'app groupe par id, et le matching live perdrait ces
// matchs (aucune correspondance possible avec un id null). Les valeurs
// viennent des mêmes id que ESPN_SLUG_BY_COMP_ID (espnSlugs.js).
// ⚠️ Déplacé dans src/data/competitions.js (MAJOR_LEAGUE_FD_ID) le 24/07 :
// réutilisé aussi par useUpcomingMatchesAllComps (useMatchs.js) pour corriger
// un bug lié (doublons/jours manquants dans Accueil, voir son commentaire).
const REAL_COMP_ID = MAJOR_LEAGUE_FD_ID
const ESPN_SOURCED_COMPS = ['CL', 'PL', 'FL1', 'PD', 'BL1', 'SA', 'NL', 'CAN', 'COPA', 'UEL', 'UECL']
const CUP_PARENT_COMPS   = Object.keys(DOMESTIC_CUPS) // ['FL1', 'PD', 'PL']


async function safeFetch(url) {
  const res = await fdFetch(fdUrl(url))
  // Erreurs serveur/rate-limit → throw pour que TanStack garde le dernier state valide
  if (res.status === 429 || res.status === 403) throw new Error(String(res.status))
  if (res.status >= 500) throw new Error(`server_${res.status}`)
  if (!res.ok) return []
  const json = await res.json()
  return (json.matches ?? []).filter(m => VALID_STATUS.includes(m.status))
}

async function fetchTodayMatches(date) {
  // Calculer le jour UTC précédent pour capturer les matchs après minuit local
  // (ex: 00:00 local France UTC+2 = 22:00 UTC la veille → classé J-1 par FD.org)
  const prevD = new Date(date + 'T12:00:00')
  prevD.setDate(prevD.getDate() - 1)
  const prevDate = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}-${String(prevD.getDate()).padStart(2, '0')}`

  // ⚠️ BUG CORRIGÉ (constat utilisateur : "j'avais tout, 5min après plus
  // rien" — même mécanisme que useStandings.js/useMatchs.js/useScorers.js/
  // useWcKnockout.js, mais amplifié ici) : Promise.all() rejette DÈS QUE UN
  // SEUL des ~10 appels parallèles échoue (safeFetch lève sur 429/403/5xx) —
  // et fait perdre TOUS les autres résultats déjà obtenus avec succès, pas
  // seulement celui qui a raté. Une seule compétition FD.org en erreur
  // transitoire suffisait donc à vider toute la liste "Aujourd'hui" de
  // l'Accueil. Promise.allSettled() (déjà utilisé ailleurs dans l'app pour
  // exactement cette raison, voir useUpcomingMatchesAllComps dans
  // useMatchs.js) : chaque appel réussi garde son résultat, seul celui qui a
  // échoué contribue un tableau vide au lieu de tout faire tomber.
  const settled = await Promise.allSettled([
    safeFetch(`/api/v4/competitions/WC/matches?dateFrom=${prevDate}&dateTo=${date}`),
    safeFetch(`/api/v4/competitions/EC/matches?dateFrom=${prevDate}&dateTo=${date}`),
    ...ESPN_SOURCED_COMPS.map(id => fetchEspnCompMatches(id, COMPETITION_ESPN_SLUG[id], { compId: REAL_COMP_ID[id] })),
    ...CUP_PARENT_COMPS.map(id => fetchEspnCupMatches(id)),
  ])
  const results = settled.map(r => r.status === 'fulfilled' ? r.value : [])
  const [wcMatches, ecMatches, ...espnResults] = results
  const espnMatches = espnResults.flat().filter(m => VALID_STATUS.includes(m.status))

  // Dédupliquer par id et filtrer par date LOCALE
  // → un match à 00:00 local (= 22:00 UTC J-1) apparaît bien dans J local seulement
  const seen = new Set()
  const all = [...wcMatches, ...ecMatches, ...espnMatches].filter(m => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    if (m.utcDate) {
      const d = new Date(m.utcDate)
      const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (localStr !== date) return false
    }
    return true
  })

  return all.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
}

// Préchargement des jours adjacents
export async function prefetchMatchesForDate(queryClient, date) {
  if (readCache(`matches_${date}`)) return
  await queryClient.prefetchQuery({
    queryKey: ['todayMatches', date],
    queryFn: async () => {
      const result = await fetchTodayMatches(date)
      if (result.length > 0) writeCache(`matches_${date}`, result, 6 * 60 * 60 * 1000)
      return result.length > 0 ? result : (readCacheStale(`matches_${date}`) ?? [])
    },
    staleTime: 30 * 60 * 1000,
  })
}

// Calcule l'intervalle de refetch selon si un match est en cours ou non
function getRefetchInterval(query) {
  const matches = query.state.data ?? []
  const hasLive = matches.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')
  return hasLive ? 2 * 60 * 1000 : 10 * 60 * 1000  // 2min si live, 10min sinon
}

function getLocalDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useTodayMatches(targetDate) {
  const today = targetDate ?? getLocalDateStr()
  const isToday = today === getLocalDateStr()
  const isPastDay = today < getLocalDateStr()   // strictement avant aujourd'hui → FINISHED, immuable
  const cacheKey = `matches_${today}`

  const cachedData    = readCacheStale(cacheKey)
  const cachedSavedAt = getCacheSavedAt(cacheKey)

  const { data, isLoading } = useQuery({
    queryKey: ['todayMatches', today],
    queryFn: async () => {
      let result
      try {
        result = await fetchTodayMatches(today)
      } catch {
        result = []
      }
      if (result.length > 0) {
        const hasLive = result.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')

        // Durée du cache selon le contexte
        // ⚠️ 6h→7j pour les jours PASSÉS uniquement (24/07, question
        // utilisateur : "ça va pas bouger, pourquoi pas 7j ?") : un jour
        // passé n'a que des matchs FINISHED, immuables — aligné sur le TTL
        // Redis serveur (getTtl, api/football.js) et sur RESULTS_DAYS_BACK
        // (Accueil.jsx, fenêtre du panneau "Résultats récents"). Un jour
        // FUTUR (dayOffset > 0 dans Accueil) reste à 6h : un match SCHEDULED
        // peut encore être reporté/déplacé, contrairement à un résultat déjà
        // joué — pas de raison de risquer 7j de staleness là-dessus.
        let ttl
        if (isPastDay) {
          ttl = 7 * 24 * 60 * 60 * 1000   // jour passé → cache 7j
        } else if (!isToday) {
          ttl = 6 * 60 * 60 * 1000        // jour futur → cache 6h
        } else if (hasLive) {
          ttl = 2 * 60 * 1000         // match en cours → cache 2min
        } else {
          ttl = 60 * 60 * 1000        // aujourd'hui sans live → cache 1h
        }

        writeCache(cacheKey, result, ttl)
        return result
      }
      // Résultat vide : si le cache contient des matchs (dont un live), garder le cache
      // pour éviter que le panel s'efface sur une erreur réseau transitoire
      const stale = readCacheStale(cacheKey)
      if (stale?.length > 0) return stale
      return []
    },
    initialData: cachedData ?? undefined,
    initialDataUpdatedAt: cachedSavedAt,
    staleTime: isToday ? 60 * 1000 : 30 * 60 * 1000,
    refetchInterval: isToday ? getRefetchInterval : false,
    retry: false,
  })

  return { matches: data ?? [], loading: isLoading }
}

// ── useRecentDaysMatches ──────────────────────────────────────────────────
// Panneau "Résultats récents" (Accueil) — étendu de 2 jours (aujourd'hui +
// hier) à N jours en arrière, à la demande de l'utilisateur. Le coût réseau
// supplémentaire reste très faible : chaque jour PASSÉ (isToday=false) est
// mis en cache localStorage avec un TTL de 6h (voir useTodayMatches
// ci-dessus, réutilisé tel quel ici) — un résultat FINISHED ne change plus
// jamais, donc au-delà du tout premier chargement de chaque jour, tout part
// du cache, pas du réseau. Seul "aujourd'hui" reste rafraîchi souvent (utile
// s'il y a un match en cours). useQueries (même pattern que
// useTeamFormMulti dans useTeamForm.js) : N requêtes indépendantes, mais
// TanStack les dédup/partage déjà avec useTodayMatches si l'un des jours
// (typiquement aujourd'hui) est aussi demandé ailleurs sur la page — même
// queryKey ['todayMatches', date].
export function useRecentDaysMatches(numDays) {
  const today = getLocalDateStr()

  const dates = []
  for (let i = 0; i < numDays; i++) {
    const d = new Date(today + 'T12:00:00')
    d.setDate(d.getDate() - i)
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }

  // ⚠️ AJOUT (constat utilisateur : "au lancement de l'app, la répartition
  // des appels ESPN/FIFA/FD.org fait planter les appels quand on veut
  // consulter un match juste après" — vérifié dans le code, chiffres à
  // l'appui) : les N jours ci-dessous partent TOUS en parallèle au montage
  // (useQueries), et fetchTodayMatches() fait à lui seul jusqu'à 8 appels
  // ESPN par jour (5 compétitions ESPN_SOURCED_COMPS, dont Europa League +
  // Conference League ajoutées ensuite + 3 coupes nationales
  // CUP_PARENT_COMPS) — pour 7 jours (RESULTS_DAYS_BACK dans Accueil.jsx),
  // ça fait jusqu'à ~56 appels ESPN quasi simultanés rien que pour ce hook,
  // en plus de useTodayMatches/useUpcomingMatchesAllComps/useWcKnockout
  // montés en même temps sur la même page. ⚠️ Plafond ESPN (api/espn.js)
  // relevé 60→100 pour la même raison lors de l'ajout Europa League/
  // Conference League — ce calcul-ci (~56, en légitime pour UN utilisateur)
  // dépassait déjà l'ancien plafond de 60 à lui seul. Si l'utilisateur ouvre
  // un match juste après ce lancement, ses propres appels ESPN (stats/
  // compo/déroulement) arrivent sur un budget déjà partiellement consommé
  // par ce seul chargement de page. STAGGER_MS étale le déclenchement réel
  // des requêtes réseau au lieu d'un seul instant — initialData (cache
  // disque) continue d'afficher les données immédiatement, ce délai ne
  // retarde que le fetch réseau de RAFRAÎCHISSEMENT, jamais l'affichage.
  // Zéro changement de données/format, uniquement le timing.
  //
  // ⚠️ CORRIGÉ (24/07, constat utilisateur : "429 dès le lancement, même la
  // première requête" — reproduit et confirmé via une vraie URL fournie par
  // l'utilisateur, /v4/competitions/WC/matches?dateFrom=...&dateTo=...) :
  // 350ms ci-dessus étalait bien les appels ESPN (budget 100/min PAR IP,
  // api/espn.js) mais fetchTodayMatches() fait AUSSI 2 vrais appels FD.org
  // (WC + EC, seules compétitions encore sur FD.org ici) PAR JOUR — soit 14
  // appels FD.org pour 7 jours, tous dans une fenêtre de ~2s (7 × 350ms).
  // Or le budget FD.org (api/football.js, MINUTE_CAP=8/min) est GLOBAL, tous
  // utilisateurs confondus, ET son verrou d'espacement (spaceKey) est UNIQUE
  // pour tout l'endpoint (pas par URL/compétition) : une seule vraie requête
  // upstream peut passer toutes les SPACING_MS (~7,5s à 8/min), TOUTES clés
  // confondues. 14 appels envoyés en ~2s ne laissent donc passer qu'1 seule
  // requête réelle ; les 13 autres trouvent le verrou déjà pris → bloquées
  // immédiatement → aucune copie stale possible (clé jamais vue, un jour/
  // compétition précis) → vrai 429 renvoyé tel quel côté client. Ça explique
  // le "même la première requête" : le blocage est immédiat, pas progressif.
  // Fix : étaler les jours sur ~15s au lieu de 350ms, pour que les paires
  // WC/EC de chaque jour tombent dans des fenêtres d'espacement différentes
  // au lieu de toutes se disputer le même verrou. Coût : le rafraîchissement
  // réseau des jours les plus anciens arrive jusqu'à ~90s après le montage
  // au lieu de ~2s — sans impact visible, l'affichage reste instantané via
  // le cache (initialData), seul le refresh en arrière-plan est retardé.
  const STAGGER_MS = 15_000

  const results = useQueries({
    queries: dates.map((date, i) => {
      const isToday  = date === today
      const cacheKey = `matches_${date}`
      return {
        queryKey: ['todayMatches', date],
        queryFn: async () => {
          if (i > 0) await new Promise(r => setTimeout(r, i * STAGGER_MS))
          let result
          try {
            result = await fetchTodayMatches(date)
          } catch {
            result = []
          }
          if (result.length > 0) {
            const hasLive = result.some(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')
            let ttl
            // isToday=false ici = forcément un jour PASSÉ (dates ne remonte
            // jamais dans le futur, voir la boucle plus haut) → FINISHED,
            // immuable → 7j, même raisonnement que useTodayMatches ci-dessus.
            if (!isToday)    ttl = 7 * 24 * 60 * 60 * 1000
            else if (hasLive) ttl = 2 * 60 * 1000
            else              ttl = 60 * 60 * 1000
            writeCache(cacheKey, result, ttl)
            return result
          }
          const stale = readCacheStale(cacheKey)
          if (stale?.length > 0) return stale
          return []
        },
        initialData:          readCacheStale(cacheKey) ?? undefined,
        initialDataUpdatedAt: getCacheSavedAt(cacheKey),
        staleTime:            isToday ? 60 * 1000 : 30 * 60 * 1000,
        refetchInterval:      isToday ? getRefetchInterval : false,
        retry:                false,
      }
    }),
  })

  const seen = new Set()
  const matches = []
  for (const r of results) {
    for (const m of r.data ?? []) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      matches.push(m)
    }
  }

  return { matches, loading: results.some(r => r.isLoading) }
}
