// MatchDuJourCard — carte "Match du jour" en haut de l'Accueil.
//
// Design validé avec l'utilisateur après plusieurs itérations de maquette
// (design "4★ Editorial Pro") : fond rouge intense (couleur de marque de
// l'app) qui plonge vers le noir, titre en Chakra Petch (police déjà
// utilisée partout ailleurs dans l'app — scores, badges live), secousse
// "façon séisme" au montage — ET, ajout de cette refonte : la carte passe
// désormais en mode live (statut/minute/score, comme les cards à venir/
// résultats) au lieu de rester figée sur l'heure du coup d'envoi une fois le
// match commencé (retour utilisateur : "t'as pas fait aussi sur la grosse
// card en live du match du jour"), plus une rangée de cotes prono (même
// calcul que MatchPoster.jsx — cote de marché ESPN si disponible, sinon
// calcProno/calcLiveProno).
import { translateTeam } from '../data/teamNames'
import { getMatchTeamColors } from '../data/teamPhotos'
import { TEAM_SHORT } from '../data/teamShortNames'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, isNationalTeamComp, isNeutralVenueComp } from '../utils/matchUtils'
import { getMatchState } from '../utils/matchStateTracker'
import { calcPronoAdvanced, calcLiveProno, pronoToOdds, pronoIntensity, pronoGlowShadow, pronoFavoriteKey } from '../utils/calcProno'
import { useTeamForm } from '../hooks/useTeamForm'
import { useEspnPregameOdds } from '../hooks/useMatchDetail'
import { useH2HRows } from '../components/MatchModal'
import { COMPETITIONS } from '../data/competitions'

function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 14) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0].toUpperCase()}. ${words.slice(1).join(' ')}`
}

function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// match n'est jamais absent en pratique : Accueil.jsx ne monte ce composant
// que dans un bloc {matchDuJour && <MatchDuJourCard match={matchDuJour} .../>}
// (voir Accueil.jsx) — pas de early-return "if (!match) return null" ici,
// pour permettre d'appeler tous les Hooks inconditionnellement, dans le même
// ordre à chaque render (règle des Hooks). Un seul "Match du jour" affiché à
// la fois sur l'Accueil, donc un seul appel FD.org/ESPN supplémentaire en
// plus, même raisonnement budget-safe déjà documenté dans MatchPoster.jsx.
export function MatchDuJourCard({ match, espnScore = null, onClick }) {
  const compCode = match?.competition?.code ?? null
  const { formMap, compMatches } = useTeamForm(compCode)
  const { rows: fullH2H } = useH2HRows(match, compMatches)

  // ── État live/terminé — même logique que accueil/MatchCard.jsx ──
  const _ms       = match ? getMatchState(match.id) : null
  const _espnLive = _ms && (
    _ms.espnStatus === 'STATUS_IN_PROGRESS' ||
    _ms.espnStatus === 'STATUS_HALFTIME'    ||
    _ms.espnStatus === 'STATUS_END_PERIOD'
  )
  const isFinished = !!match && (_ms?.ft === true || (match.status === 'FINISHED' && !_espnLive))
  const liveMinute = (match && !isFinished) ? calcMinute(match) : null
  const isLive     = !!match && !isFinished && (
    match.status === 'IN_PLAY' ||
    match.status === 'PAUSED'  ||
    liveMinute !== null
  )
  const isUpcoming = !!match && !isFinished && !isLive

  const { data: espnOdds } = useEspnPregameOdds(match, isUpcoming)

  if (!match) return null

  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))
  const kickoff  = formatHour(match.utcDate)
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)

  // Couleurs réelles des deux équipes (dico curé teamPhotos) → halos latéraux
  // du hero. Le thème v2 (theme-v2.css) les consomme via var(--mdj-home/away),
  // avec repli rouge de marque si l'équipe est inconnue.
  const teamColors = getMatchTeamColors(match.homeTeam?.name, match.awayTeam?.name)

  const fsCard = finalScore(match.score)
  const hs  = isFinished
    ? (fsCard.home ?? match.score?.halfTime?.home ?? 0)
    : mergeScore(espnScore?.home, fsCard.home ?? match.score?.halfTime?.home)
  const as_ = isFinished
    ? (fsCard.away ?? match.score?.halfTime?.away ?? 0)
    : mergeScore(espnScore?.away, fsCard.away ?? match.score?.halfTime?.away)

  const rawPeriod = getMatchPeriod(match)
  const livePeriodLabel = rawPeriod === '1ère MT'       ? '1ère mi-temps'
    : rawPeriod === '2ème MT'       ? '2ème mi-temps'
    : rawPeriod === 'Mi-temps'      ? 'Mi-temps'
    : rawPeriod === 'Prolongations' ? 'Prolongations'
    : rawPeriod === 'T.A.B.'        ? 'T.A.B.'
    : null

  const mdjComp = COMPETITIONS.find(c => c.id === match.competition?.code)
  const mdjCompEmblem = mdjComp?.emblem ?? match.competition?.emblem
  const mdjCompName   = mdjComp?.name ?? match.competition?.name ?? ''

  // ── Pronostic — même modèle que MatchPoster.jsx (cote de marché ESPN en
  // priorité pré-match, sinon calcProno/calcLiveProno). ──
  const hForm = formMap?.[match.homeTeam?.id] ?? []
  const aForm = formMap?.[match.awayTeam?.id] ?? []
  const prono = isLive
    ? calcLiveProno(hForm, aForm, hs, as_, liveMinute, {
        homeId: match.homeTeam?.id, awayId: match.awayTeam?.id, compMatches,
        fullH2H,
        neutralVenue:      isNeutralVenueComp(match),
        homeRedCards:      espnScore?.stats?.home?.redCards,
        awayRedCards:      espnScore?.stats?.away?.redCards,
        homePoss:          espnScore?.stats?.home?.poss,
        awayPoss:          espnScore?.stats?.away?.poss,
        homeShotsOnTarget: espnScore?.stats?.home?.shotsOnTarget,
        awayShotsOnTarget: espnScore?.stats?.away?.shotsOnTarget,
        homeCorners:       espnScore?.stats?.home?.corners,
        awayCorners:       espnScore?.stats?.away?.corners,
      })
    : calcPronoAdvanced(match.homeTeam?.id, match.awayTeam?.id, compMatches, hForm, aForm, {
        fullH2H,
        neutralVenue: isNeutralVenueComp(match),
      })

  const useMarketOdds = isUpcoming && !!espnOdds
  const displayPct    = useMarketOdds ? espnOdds.pct : prono
  const pronoFavorite = pronoFavoriteKey(displayPct)

  const homeCode = (homeName || match.homeTeam?.tla || '').slice(0, 3).toUpperCase()
  const awayCode = (awayName || match.awayTeam?.tla || '').slice(0, 3).toUpperCase()

  return (
    <button
      className="accueil__mdj"
      onClick={onClick}
      style={{
        '--mdj-home': teamColors.home.main,
        '--mdj-away': teamColors.away.main,
      }}
    >
      <div className="accueil__mdjTopBar">
        <span className="accueil__mdjComp">
          {mdjCompEmblem && <img src={mdjCompEmblem} alt="" className="accueil__mdjCompLogo" />}
          <span className="accueil__mdjCompName">{mdjCompName}</span>
        </span>
        {isLive && livePeriodLabel && (
          <span className="accueil__mdjStatus">{livePeriodLabel}</span>
        )}
      </div>

      <div className="accueil__mdjTitleWrap">
        <span className="accueil__mdjTitle">Match du jour</span>
        <div className="accueil__mdjUnderline" />
      </div>

      <div className="accueil__mdjTeams">
        <div className="accueil__mdjTeam">
          {match.homeTeam?.crest
            ? <div className="accueil__mdjCrestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="accueil__mdjCrest" data-team={match.homeTeam?.name} /></div>
            : <div className="accueil__mdjCrestFb">{homeName?.[0] ?? ''}</div>}
          <span className="accueil__mdjTeamName">{homeName}</span>
        </div>

        <div className="accueil__mdjVs">
          {isLive ? (
            <span className="accueil__mdjMinute">{liveMinute ?? 'En cours'}</span>
          ) : isFinished ? (
            <span className="accueil__mdjFinished">Terminé</span>
          ) : (
            <span className="accueil__mdjToday">Aujourd'hui</span>
          )}
          {(isLive || isFinished)
            ? <span className="accueil__mdjTime">{hs ?? 0} – {as_ ?? 0}</span>
            : <span className="accueil__mdjTime">{kickoff}</span>}
        </div>

        <div className="accueil__mdjTeam">
          {match.awayTeam?.crest
            ? <div className="accueil__mdjCrestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="accueil__mdjCrest" data-team={match.awayTeam?.name} /></div>
            : <div className="accueil__mdjCrestFb">{awayName?.[0] ?? ''}</div>}
          <span className="accueil__mdjTeamName">{awayName}</span>
        </div>
      </div>

      {/* Pronostic — pilules "côtes bookmaker", même design que MatchPoster/
          LiveProno : liseré + glow bordeaux réservés à la pilule favorite. */}
      <div className="accueil__mdjPronoRow">
        <div className="accueil__mdjPronoPill" style={pronoFavorite === 'home' ? { borderColor: `rgba(159,30,52,${pronoIntensity(displayPct.home)})`, boxShadow: pronoGlowShadow(displayPct.home) } : { borderColor: 'transparent' }}>
          <span className="accueil__mdjPronoPillLabel">{homeCode}</span>
          <span className="accueil__mdjPronoPillVal">{(useMarketOdds ? espnOdds.decimal.home : pronoToOdds(prono.home)).toFixed(2)}</span>
        </div>
        <div className="accueil__mdjPronoPill" style={pronoFavorite === 'draw' ? { borderColor: `rgba(159,30,52,${pronoIntensity(displayPct.draw)})`, boxShadow: pronoGlowShadow(displayPct.draw) } : { borderColor: 'transparent' }}>
          <span className="accueil__mdjPronoPillLabel">Nul</span>
          <span className="accueil__mdjPronoPillVal">{(useMarketOdds ? espnOdds.decimal.draw : pronoToOdds(prono.draw)).toFixed(2)}</span>
        </div>
        <div className="accueil__mdjPronoPill" style={pronoFavorite === 'away' ? { borderColor: `rgba(159,30,52,${pronoIntensity(displayPct.away)})`, boxShadow: pronoGlowShadow(displayPct.away) } : { borderColor: 'transparent' }}>
          <span className="accueil__mdjPronoPillLabel">{awayCode}</span>
          <span className="accueil__mdjPronoPillVal">{(useMarketOdds ? espnOdds.decimal.away : pronoToOdds(prono.away)).toFixed(2)}</span>
        </div>
      </div>
    </button>
  )
}
