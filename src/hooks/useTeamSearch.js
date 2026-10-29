/**
 * useTeamSearch.js — données brutes pour la fiche équipe (route /equipe,
 * demande utilisateur 28/10). Agrège TOUS les matchs de la saison en cours
 * des compétitions de CLUB couvertes par l'app : les 5 grands championnats +
 * Ligue des Champions (football-data.org, via fetchClubMatchesRaw — inclut
 * déjà la coupe nationale fusionnée pour FL1/PD/PL/SA/BL1, voir DOMESTIC_CUPS
 * dans competitions.js) + Europa League/Ligue Europa Conférence (ESPN, pas de
 * couverture FD.org gratuite pour elles, voir ESPN_SOURCED_COMPS dans
 * useMatchs.js).
 *
 * Volontairement HORS PÉRIMÈTRE (pas demandé, et chaque entrée de plus
 * alourdirait cette page sans rapport clair avec "chercher une équipe de
 * club") : équipes nationales (WC/EC/NL/CAN/COPA) et compétitions à un seul
 * match/an (USC/TDC/CS).
 *
 * Mêmes fonctions de fetch que Programme/Résultats (fetchClubMatchesRaw/
 * fetchEspnCompMatches) — chacune a déjà son propre cache (localStorage +
 * verrou in-flight), donc revisiter cette page après avoir consulté Programme
 * ne retape jamais FD.org/ESPN pour rien. Étalées (STAGGER_MS, même principe
 * que useLowerDivisionStatsMulti/useTeamFormMulti) pour ne jamais lancer 6
 * vrais appels FD.org simultanés au premier chargement à froid — historique
 * de ce projet très sensible aux suspensions de compte FD.org en cas de
 * rafale (voir CLAUDE.md).
 */
import { useQueries } from '@tanstack/react-query'
import { fetchClubMatchesRaw, TTL } from './useMatchs'
import { fetchEspnCompMatches } from '../utils/espnAdapter'
import { COMPETITION_ESPN_SLUG } from '../data/competitions'
import { fetchStandingsData } from './useStandings'
import { fetchScorersData } from './useScorers'

const CLUB_FD_COMPS   = ['FL1', 'PL', 'PD', 'BL1', 'SA', 'CL']
const CLUB_ESPN_COMPS = ['UEL', 'UECL']
const STAGGER_MS = 1_000

export function useTeamSearchMatches() {
  const fdResults = useQueries({
    queries: CLUB_FD_COMPS.map((comp, i) => ({
      queryKey: ['teamSearchRaw', comp],
      queryFn: async () => {
        if (i > 0) await new Promise(r => setTimeout(r, i * STAGGER_MS))
        return fetchClubMatchesRaw(comp)
      },
      staleTime: TTL.FINISHED,
      retry: 1,
    })),
  })

  const espnResults = useQueries({
    queries: CLUB_ESPN_COMPS.map((comp, i) => ({
      queryKey: ['teamSearchEspn', comp],
      queryFn: async () => {
        if (i > 0) await new Promise(r => setTimeout(r, i * STAGGER_MS))
        return fetchEspnCompMatches(comp, COMPETITION_ESPN_SLUG[comp])
      },
      staleTime: 2 * 60 * 1000,
      retry: 1,
    })),
  })

  const allResults = [...fdResults, ...espnResults]
  const isLoading  = allResults.some(r => r.isLoading)
  // _fromLastSeason : matchs de la saison précédente injectés par
  // fetchClubMatchesRaw UNIQUEMENT pour H2H/prono ailleurs dans l'app (voir
  // son commentaire, useMatchs.js) — jamais à afficher ici, la demande est
  // explicitement "depuis le début de la saison" en cours.
  const matches = allResults.flatMap(r => (r.data ?? []).filter(m => !m._fromLastSeason))

  return { matches, isLoading }
}

// ⚠️ AJOUT (28/10, demande utilisateur : "met le classement de l'equipe pour
// chaque championat ou elle participe") — classement de l'équipe par
// compétition, pour chaque compétition NON-COUPE où elle joue. Réutilise
// fetchStandingsData (extrait de useStandings.js, voir ce fichier) avec la
// MÊME queryKey (['standings', comp]) que la page Classement — un classement
// déjà consulté là-bas est servi instantanément ici, zéro fetch en double.
// Stagger (même principe que ci-dessus) : jamais plus d'un vrai appel FD.org
// à la fois au premier chargement à froid.
export function useTeamStandingsMulti(compCodes) {
  const results = useQueries({
    queries: compCodes.map((comp, i) => ({
      queryKey: ['standings', comp],
      queryFn: async () => {
        if (i > 0) await new Promise(r => setTimeout(r, i * STAGGER_MS))
        return fetchStandingsData(comp)
      },
      staleTime: TTL.FINISHED,
      retry: false,
      enabled: !!comp,
    })),
  })

  const byComp = {}
  compCodes.forEach((comp, i) => {
    byComp[comp] = {
      standings: results[i]?.data?.table  ?? [],
      groups:    results[i]?.data?.groups ?? [],
      loading:   results[i]?.isLoading ?? false,
    }
  })
  return byComp
}

// ⚠️ AJOUT (28/10, demande utilisateur : "les meilleurs buteurs de l'equipe")
// — buteurs par compétition, même principe/mêmes garanties que ci-dessus
// (réutilise fetchScorersData, même queryKey que la page Classement). Les
// comps ESPN-only de cette page (UEL/UECL) sont déjà couvertes par
// NO_SCORERS_COMPS DANS fetchScorersData lui-même (renvoie [] proprement,
// voir son commentaire dans useScorers.js) — aucun filtre supplémentaire
// nécessaire ici, le composant affiche juste "aucune donnée" le cas échéant.
export function useTeamScorersMulti(compCodes) {
  const results = useQueries({
    queries: compCodes.map((comp, i) => ({
      queryKey: ['scorers', comp],
      queryFn: async () => {
        if (i > 0) await new Promise(r => setTimeout(r, i * STAGGER_MS))
        return fetchScorersData(comp)
      },
      staleTime: TTL.FINISHED,
      retry: false,
      enabled: !!comp,
    })),
  })

  const byComp = {}
  compCodes.forEach((comp, i) => {
    byComp[comp] = {
      scorers: results[i]?.data ?? [],
      loading: results[i]?.isLoading ?? false,
    }
  })
  return byComp
}
