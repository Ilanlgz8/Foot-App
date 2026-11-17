// Liste « Résultats récents » (17/11) : extraite telle quelle d'Accueil.jsx (ancienne IIFE
// `resultPanel`) pour être partagée avec la page « Tous les résultats » (TousResultatsPage.jsx) —
// les deux affichent donc EXACTEMENT les mêmes matchs et les mêmes scores. Aucune logique changée.
//   resultsSourceMatches : matchs des derniers jours (useRecentDaysMatches)
//   filteredResults      : ceux de ces matchs au statut FINISHED
//   espnScores / liveMatches : useLiveData()
import { getMatchState } from './matchStateTracker'
import { mergeScore } from './matchUtils'

export function buildRecentResults({ resultsSourceMatches, filteredResults, espnScores, liveMatches }) {
  // IIFE appelée directement dans le corps du render (pas mémoïsée) : cette
  // valeur est donc fraîche à chaque render, contrairement au cas Pronos.jsx
  // (mémoïsé avec des deps étroites) — aucun risque de péremption ici.
  const now4h = Date.now() - 4 * 60 * 60_000
  // resultsSourceMatches (aujourd'hui absolu + hier) — PAS `matches`, qui dépend
  // de dayOffset : sinon ce panneau se vide/réapparaît selon le jour affiché
  // dans "Matchs" (bug signalé : le match disparaît quand on va sur "Demain").
  // Ids déjà couverts par filteredResults (FD.org, EN TENANT COMPTE du filtre
  // compétition compFilterResult) — voir le bug ci-dessous.
  const filteredResultIds = new Set(filteredResults.map(r => r.id))
  const todayFt = resultsSourceMatches.filter(m => {
    // ⚠️ Bug réel signalé : score figé (3-5 au lieu de 4-6, buts marqués après
    // le FT ESPN mal détecté) alors que la page Résultat (Resultat.jsx) affichait
    // le bon score. Root cause : une fois FD.org a lui-même confirmé le match
    // FINISHED (score officiel, forcément à jour), ce panneau continuait quand
    // même à écraser le score avec le snapshot localStorage foot_espn_ figé au
    // moment précis de la confirmation FT locale (lsHome/lsAway ci-dessous,
    // jamais rafraîchi ensuite) — cet override prioritaire (`lsHome ?? m.score...`)
    // ignorait purement et simplement toute mise à jour FD.org ultérieure, même
    // plus fraîche/exacte. Resultat.jsx n'a pas ce bug car il exclut de son
    // override tout match déjà connu de fdMatches (voir `known` là-bas) — même
    // logique reproduite ici.
    //
    // ⚠️ RÉGRESSION CORRIGÉE (retour utilisateur : "un match terminé n'a jamais
    // disparu au bout de 4h avant, je comprends pas") : la 1ère version de ce
    // fix excluait tout match FINISHED en supposant qu'il retomberait forcément
    // sur filteredResults plus bas — FAUX quand un filtre compétition
    // (compFilterResult) est actif sur le panneau résultats : todayFtMapped
    // n'était PAS filtré par compétition (donc affichait le match quel que soit
    // le filtre), alors que filteredResults, LUI, applique ce filtre. Un match
    // exclu ici sur la seule base de son statut FINISHED, sans être dans la
    // compétition actuellement filtrée, disparaissait purement et simplement au
    // lieu de retomber sur filteredResults comme supposé. Fix : ne l'exclure
    // que si on a VÉRIFIÉ qu'il est bien dans filteredResults (donc qu'il va
    // vraiment s'afficher par cet autre chemin) — sinon on garde l'ancien
    // comportement (affichage via l'override ci-dessous, score potentiellement
    // pas 100% frais mais au moins visible, comme avant).
    if (m.status === 'FINISHED' && filteredResultIds.has(m.id)) return false
    const st = getMatchState(m.id)
    // ft (confirmé par ESPN) prime toujours, même si liveTracker garde encore
    // le match dans liveMatches (grâce period de 5min avant éviction) — sinon
    // le match reste invisible en Résultats pendant tout ce délai alors qu'il
    // est déjà terminé (signalé par l'utilisateur : "ça met du temps à se mettre").
    if (st.ft) return true
    if (liveMatches.some(l => l.id === m.id)) return false
    if (st.liveState === 'ended' && st.endedAt > now4h) return true
    return false
  })
  const todayFtIds = new Set(todayFt.map(m => m.id))
  const todayFtMapped = todayFt.map(m => {
    let lsHome = null, lsAway = null
    try {
      const lsScore = JSON.parse(localStorage.getItem(`foot_espn_${m.id}`) ?? 'null')
      if (lsScore && lsScore.home != null) { lsHome = lsScore.home; lsAway = lsScore.away }
    } catch {}
    const es = espnScores[m.id]
    // Tirs au but : voir même fix dans Resultat.jsx — sans ça, score.duration/
    // penalties étaient écrasés par le fullTime reconstruit ci-dessous, et le
    // badge "(x-y tab)" de MatchCard restait vide pour un match qu'ESPN
    // détecte fini avant que football-data.org ne le confirme.
    const wentToPens = es?.homeShootout != null && es?.awayShootout != null
    // 09/11 : même correctif que Resultat.jsx — score de la liste (match déjà TERMINÉ) prioritaire,
    // sinon le suivi direct pendant la séance de tab pouvait cumuler score 120 min + tab.
    const listFinal = m.status === 'FINISHED' && m.score?.fullTime?.home != null && m.score?.fullTime?.away != null
    const listPens  = m.score?.duration === 'PENALTY_SHOOTOUT' && m.score?.penalties?.home != null
    return {
      ...m,
      score: {
        ...m.score,
        fullTime: listFinal ? m.score.fullTime : {
          home: mergeScore(es?.home, lsHome ?? m.score?.fullTime?.home),
          away: mergeScore(es?.away, lsAway ?? m.score?.fullTime?.away),
        },
        ...(wentToPens && !listPens ? {
          duration: 'PENALTY_SHOOTOUT',
          penalties: { home: es.homeShootout, away: es.awayShootout },
        } : {}),
      },
      status: 'FINISHED',
    }
  })
  return [...todayFtMapped, ...filteredResults.filter(r => !todayFtIds.has(r.id))]
}
