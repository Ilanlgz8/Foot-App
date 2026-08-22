import { useNavigate } from 'react-router-dom'
import '../resultats.css'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { finalScore, isNationalTeamComp } from '../utils/matchUtils'
import { FavStarBadge } from './FavStarBadge'
import { useFavoriteClubs } from '../hooks/useFavoriteClubs'
import { getTeamColor } from '../data/teamPhotos'

const tName = (t) => translateTeam(t?.shortName || t?.name || '?')

// ── ResultCard — card "résultat" partagée entre la page Résultats
// (Resultat.jsx, navigation par championnat + onglet "Tous") et le panneau
// "Résultats récents" de l'Accueil (accueil/ResultPanel.jsx) ──
// ⚠️ EXTRACTION (demande utilisateur : "même style que les cards dans
// résultats" pour le panneau Accueil aussi) : vivait avant comme un
// composant local (MatchCard) DANS Resultat.jsx, pas exportable — extrait
// ici tel quel (même logique/mêmes classes resultats__*, resultats.css
// importé directement ici pour que ce soit auto-suffisant partout où ce
// composant est utilisé) pour être réutilisable des deux côtés sans
// dupliquer le code. Renommé ResultCard (pas MatchCard) pour éviter toute
// confusion avec accueil/MatchCard.jsx, un fichier totalement différent qui
// exporte MatchPanel/PanelSkeleton — pure coïncidence de nom, aucun rapport.
//
// Carte définie AU NIVEAU MODULE (pas dans un composant parent qui re-render
// souvent) : sinon React perd l'identité du composant à chaque re-render du
// parent, démonte/remonte tous les <img> crest → flicker visible des
// drapeaux/blasons (constat utilisateur d'origine, voir l'historique de
// Resultat.jsx). Pas de loading="lazy" sur les <img> pour la même raison
// déjà documentée là-bas (flash "vide → image" à chaque remontage de page).
//
// showComp (false par défaut) : le badge championnat (logo + nom, haut
// gauche) n'a de sens QUE quand plusieurs compétitions se mélangent —
// onglet "Tous" de Resultat.jsx ET panneau Résultats récents de l'Accueil
// (qui affiche déjà plusieurs championnats ensemble, contrairement à la
// navigation par championnat de Resultat.jsx qui n'en a pas besoin).
export function ResultCard({ match, showComp = false }) {
  const navigate = useNavigate()
  const { isFavorite } = useFavoriteClubs()
  const homeIsFav = isFavorite(match.homeTeam?.id)
  const awayIsFav = isFavorite(match.awayTeam?.id)
  const isFav = homeIsFav || awayIsFav
  const favColor = isFav
    ? getTeamColor((homeIsFav ? match.homeTeam : match.awayTeam)?.shortName || (homeIsFav ? match.homeTeam : match.awayTeam)?.name)
    : null
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)
  // finalScore() = score 120min (prolongations incluses, tirs au but exclus).
  // ⚠️ NE PAS lire match.score.fullTime directement : pour un match décidé aux
  // tab, FD.org y met regularTime+extraTime+penalties CUMULÉS (bug confirmé en
  // prod), pas le score 120min — voir finalScore() dans matchUtils.js. Un match
  // décidé aux tab est TOUJOURS à égalité en score 120min → le vainqueur doit
  // se déterminer via le score des tab (score.penalties), pas via ce score.
  const fsRes = finalScore(match.score)
  const hs   = fsRes.home ?? 0
  const as_  = fsRes.away ?? 0
  const wentToPens = match.score?.duration === 'PENALTY_SHOOTOUT'
  // Décidé en prolongation SANS tirs au but (score.duration ne vaut
  // 'EXTRA_TIME' que dans ce cas précis — si ça s'est joué aux tab, duration
  // vaut déjà 'PENALTY_SHOOTOUT', donc les deux sont mutuellement exclusifs).
  const wentToAet = match.score?.duration === 'EXTRA_TIME'
  const hp   = match.score?.penalties?.home ?? null
  const ap   = match.score?.penalties?.away ?? null
  const hWin = wentToPens ? (hp != null && ap != null && hp > ap) : hs > as_
  const aWin = wentToPens ? (hp != null && ap != null && ap > hp) : as_ > hs
  const draw = !wentToPens && hs === as_

  const comp     = COMPETITIONS.find(c => c.id === match.competition?.code)
  const compName = match.isCup ? match.competition?.name : (comp?.name ?? match.competition?.name ?? '')
  const compLogo = comp?.emblem ?? match.competition?.emblem

  return (
    <div className="resultats__card" onClick={() => navigate(`/match/${match.id}`, { state: { match } })} style={{ cursor: 'pointer' }}>
      {isFav && <FavStarBadge variant="row" color={favColor} />}
      {showComp && compName && (
        <div className="resultats__cardCompBadge">
          {compLogo && <img src={compLogo} alt="" className="resultats__cardCompLogo" onError={e => e.currentTarget.style.display = 'none'} />}
          <span className="resultats__cardCompName">{compName}</span>
        </div>
      )}
      <div className="resultats__cardBody">
        <div className={`resultats__team resultats__team--home ${aWin ? 'resultats__team--loser' : ''}`}>
          <div className="resultats__crestWrap" data-crest={isWC ? 'country' : 'club'}>
            {match.homeTeam?.crest
              ? <img src={match.homeTeam.crest} alt="" className="resultats__crest" data-team={match.homeTeam?.name} onError={e => e.target.style.display='none'} />
              : <span className="resultats__crestFb">{tName(match.homeTeam)[0]}</span>}
          </div>
          <span className="resultats__teamName">{tName(match.homeTeam)}</span>
        </div>
        <div className="resultats__scoreCenter">
          <span className="resultats__ftBadge">Terminé</span>
          <div className="resultats__scoreRow">
            <span className={`resultats__scoreNum ${hWin ? 'resultats__scoreNum--win' : ''} ${draw ? 'resultats__scoreNum--draw' : ''}`}>{hs}</span>
            <span className="resultats__scoreDash">–</span>
            <span className={`resultats__scoreNum ${aWin ? 'resultats__scoreNum--win' : ''} ${draw ? 'resultats__scoreNum--draw' : ''}`}>{as_}</span>
          </div>
          {wentToPens && hp != null && ap != null && (
            <div className="resultats__pensBlock">
              <span className="resultats__pensLabel">T.A.B</span>
              <span className="resultats__pensScore">({hp}-{ap})</span>
            </div>
          )}
          {wentToAet && (
            <span className="resultats__aet">Après prolong.</span>
          )}
        </div>
        <div className={`resultats__team resultats__team--away ${hWin ? 'resultats__team--loser' : ''}`}>
          <div className="resultats__crestWrap" data-crest={isWC ? 'country' : 'club'}>
            {match.awayTeam?.crest
              ? <img src={match.awayTeam.crest} alt="" className="resultats__crest" data-team={match.awayTeam?.name} onError={e => e.target.style.display='none'} />
              : <span className="resultats__crestFb">{tName(match.awayTeam)[0]}</span>}
          </div>
          <span className="resultats__teamName">{tName(match.awayTeam)}</span>
        </div>
      </div>
    </div>
  )
}
