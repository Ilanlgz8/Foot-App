import { useNavigate } from 'react-router-dom'
import { translateTeam } from '../data/teamNames'
import { finalScore } from '../utils/matchUtils'
import { getMatchGradient, getMatchTeamColors } from '../data/teamPhotos'
import { COMPETITIONS } from '../data/competitions'

// ── Carte "résultat en héros" (redesign panneau Résultats récents, Accueil) ──
// Composant DÉDIÉ, volontairement séparé de MatchCard.jsx (accueil/MatchCard.jsx) :
// MatchCard est réutilisé tel quel par Live.jsx, LiveWidget.jsx, MatchPage.jsx,
// Classement.jsx, Resultat.jsx — retoucher sa mise en page pour ce redesign
// aurait risqué de casser du visuel ailleurs dans l'app pour un changement demandé
// uniquement sur le panneau Résultats de l'Accueil. Ce composant ne gère QUE des
// matchs terminés (aucune logique live/minute/animation de but nécessaire — la
// donnée vient toujours de football-data.org, jamais d'ESPN ici).
export function ResultHeroCard({ match }) {
  const navigate = useNavigate()

  const fs  = finalScore(match.score)
  const hs  = fs.home ?? match.score?.halfTime?.home ?? 0
  const as_ = fs.away ?? match.score?.halfTime?.away ?? 0

  // Tirs au but : fullTime est TOUJOURS à égalité dans ce cas — le vrai
  // vainqueur et le score des tab se lisent dans score.penalties (même
  // logique que MatchCard.jsx/Resultat.jsx/Match.jsx, pour rester cohérent
  // partout dans l'app).
  const wentToPens = match.score?.duration === 'PENALTY_SHOOTOUT'
  const hPens = match.score?.penalties?.home ?? null
  const aPens = match.score?.penalties?.away ?? null
  const wentToAet = match.score?.duration === 'EXTRA_TIME'

  const homeWins = wentToPens
    ? (hPens != null && aPens != null && hPens > aPens)
    : hs > as_
  const awayWins = wentToPens
    ? (hPens != null && aPens != null && aPens > hPens)
    : as_ > hs

  const isWC = match.competition?.id === 2000 || match.competition?.code === 'WC'
  const homeRaw = match.homeTeam?.name || match.homeTeam?.shortName || ''
  const awayRaw = match.awayTeam?.name || match.awayTeam?.shortName || ''
  const gradient = getMatchGradient(homeRaw, awayRaw)
  const { home: homeColor, away: awayColor } = getMatchTeamColors(homeRaw, awayRaw)
  // Couleur d'accent = celle du VAINQUEUR (celle du perdant si match nul, les
  // deux teintes restent alors visibles à parts égales) — utilisée pour le
  // liseré du haut et la lueur derrière le score, seul endroit de l'app où la
  // couleur du dégradé équipe sert aussi à guider l'œil vers le résultat.
  const accentColor = homeWins ? homeColor.main : awayWins ? awayColor.main : homeColor.main

  const comp = COMPETITIONS.find(c => c.id === match.competition?.code)
  const compName = comp?.shortName ?? match.competition?.name ?? ''

  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  return (
    <div
      className="resultHero"
      style={{ '--result-hero-gradient': gradient, '--result-hero-accent': accentColor }}
      onClick={() => navigate(`/match/${match.id}`, { state: { match } })}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') navigate(`/match/${match.id}`, { state: { match } }) }}
    >
      <div className="resultHero__accentBar" />
      <div className="resultHero__topRow">
        {compName && <span className="resultHero__comp">{compName}</span>}
        <span className="resultHero__status">Terminé</span>
      </div>

      <div className="resultHero__body">
        <div className={`resultHero__team${homeWins ? ' resultHero__team--winner' : ''}${awayWins ? ' resultHero__team--loser' : ''}`}>
          <div className="resultHero__crestWrap" data-crest={isWC ? 'country' : 'club'}>
            {match.homeTeam?.crest
              ? <img src={match.homeTeam.crest} alt="" loading="lazy" className="resultHero__crest" data-team={match.homeTeam?.name}
                  onError={e => e.currentTarget.style.display = 'none'} />
              : <div className="resultHero__crestEmpty" />}
          </div>
          <span className="resultHero__name">{homeName}</span>
        </div>

        <div className="resultHero__center">
          <div className="resultHero__score">
            <span className={`resultHero__scoreDigit${homeWins ? ' resultHero__scoreDigit--win' : awayWins ? ' resultHero__scoreDigit--lose' : ''}`}>{hs}</span>
            <span className="resultHero__scoreSep">–</span>
            <span className={`resultHero__scoreDigit${awayWins ? ' resultHero__scoreDigit--win' : homeWins ? ' resultHero__scoreDigit--lose' : ''}`}>{as_}</span>
          </div>
          {wentToPens && hPens != null && aPens != null && (
            <span className="resultHero__tag">T.A.B <b>{hPens}-{aPens}</b></span>
          )}
          {wentToAet && !wentToPens && (
            <span className="resultHero__tag">Après prolongations</span>
          )}
        </div>

        <div className={`resultHero__team resultHero__team--away${awayWins ? ' resultHero__team--winner' : ''}${homeWins ? ' resultHero__team--loser' : ''}`}>
          <div className="resultHero__crestWrap" data-crest={isWC ? 'country' : 'club'}>
            {match.awayTeam?.crest
              ? <img src={match.awayTeam.crest} alt="" loading="lazy" className="resultHero__crest" data-team={match.awayTeam?.name}
                  onError={e => e.currentTarget.style.display = 'none'} />
              : <div className="resultHero__crestEmpty" />}
          </div>
          <span className="resultHero__name">{awayName}</span>
        </div>
      </div>
    </div>
  )
}
