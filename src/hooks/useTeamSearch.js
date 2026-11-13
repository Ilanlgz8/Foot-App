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
 * Équipes nationales (NL/WC/EC/CAN/COPA, via ESPN) ajoutées le 05/11 sur demande
 * utilisateur. Volontairement HORS PÉRIMÈTRE : compétitions à un seul match/an
 * (USC/TDC/CS).
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
import { readCacheStale, getCacheSavedAt } from './localCache'
import { COMPETITION_ESPN_SLUG } from '../data/competitions'
import { fetchStandingsData } from './useStandings'
import { fetchScorersData } from './useScorers'

const CLUB_FD_COMPS   = ['FL1', 'PL', 'PD', 'BL1', 'SA', 'CL']
const CLUB_ESPN_COMPS = ['UEL', 'UECL']
// 05/11 (demande utilisateur : « j'ai recherché la France et j'ai pas pu voir ») : les sélections
// nationales sont ajoutées — mêmes compétitions et même source (ESPN, fenêtre « sparse » 400 j en
// arrière / 60 j en avant, voir espnAdapter.js) que celles déjà gérées ailleurs dans l'app. Pas de
// classement ni de buteurs pour elles ici (voir NATIONAL_COMP_CODES, TeamSearchPage.jsx) : aucun
// appel FD.org en plus.
export const NATIONAL_COMP_CODES = new Set(['NL', 'WC', 'EC', 'CAN', 'CANQ', 'COPA'])
const ESPN_COMPS = [...CLUB_ESPN_COMPS, ...NATIONAL_COMP_CODES]
const STAGGER_MS = 1_000
const ESPN_STAGGER_MS = 400

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
    queries: ESPN_COMPS.map((comp, i) => ({
      queryKey: ['teamSearchEspn', comp],
      queryFn: async () => {
        if (i > 0) await new Promise(r => setTimeout(r, i * ESPN_STAGGER_MS))
        return fetchEspnCompMatches(comp, COMPETITION_ESPN_SLUG[comp])
      },
      // 05/11 : repart des matchs ESPN déjà gardés en local par le reste de l'app (même clé
      // `matches_espn_<comp>` que Programme/Résultats/forme récente — voir fetchEspnCompMatches) et ne
      // les redemande qu'après 30 min, au lieu de 2 min : revisiter la fiche équipe ne refait plus
      // d'appels ESPN à chaque fois.
      initialData: readCacheStale(`matches_espn_${comp}`) ?? undefined,
      initialDataUpdatedAt: getCacheSavedAt(`matches_espn_${comp}`),
      staleTime: 30 * 60 * 1000,
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
//
// ⚠️ `liveCompCodes` AJOUTÉ (02/11, constat utilisateur : "si on fait un
// appel pour la CAN alors qu'elle joue pas ce jour-là, ça sert à rien") —
// avant ça, `fetchScorersData(comp)` était appelée SANS `hasMatchToday`,
// donc avec sa valeur par défaut `true` pour TOUTE compétition, y compris
// une compétition sporadique (CAN/Copa América) qui ne joue pas forcément
// aujourd'hui pour l'équipe recherchée — ça forçait le TTL serveur COURT
// (5min, voir api/football.js) en permanence au lieu du TTL long (24h),
// même les jours où rien ne pouvait bouger. `liveCompCodes` (Set de codes
// comp, calculé par l'appelant depuis les matchs déjà chargés de l'équipe —
// voir TeamSearchPage.jsx, aucun fetch supplémentaire) dit précisément
// lesquelles jouent réellement aujourd'hui pour CETTE équipe.
export function useTeamScorersMulti(compCodes, liveCompCodes = new Set()) {
  const results = useQueries({
    queries: compCodes.map((comp, i) => ({
      queryKey: ['scorers', comp],
      queryFn: async () => {
        if (i > 0) await new Promise(r => setTimeout(r, i * STAGGER_MS))
        return fetchScorersData(comp, 0, liveCompCodes.has(comp))
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
