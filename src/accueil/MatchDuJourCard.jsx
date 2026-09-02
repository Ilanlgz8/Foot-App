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
import { calcMinute, getMatchPeriod, mergeScore, finalScore, isNationalTeamComp, isNeutralVenueComp, resolveFdTeamId, resolveFdCrest } from '../utils/matchUtils'
import { getMatchState } from '../utils/matchStateTracker'
import { calcPronoAdvanced, calcLiveProno, pronoToOdds, pronoIntensity, pronoGlowShadow, pronoFavoriteKey } from '../utils/calcProno'
import { useTeamForm } from '../hooks/useTeamForm'
import { useH2HHistory, useLowerDivisionStats } from '../hooks/useMatchs'
import { useEspnPregameOdds } from '../hooks/useMatchDetail'
import { useH2HRows } from '../components/MatchModal'
import { COMPETITIONS } from '../data/competitions'

// Libellés FR des losanges de forme récente — même convention que
// StandingsTable.jsx (V/N/D), source 'W'/'D'/'L' (buildFormMap).
const MDJ_FORM_LABEL = { W: 'V', D: 'N', L: 'D' }

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
  const h2hHistory = useH2HHistory(compCode, compMatches)
  // ⚠️ RÉORDONNÉ (constat utilisateur, 20/08 : "Historique" toujours absent
  // sur des rivalités connues — Everton-Crystal Palace, Toulouse-Lyon,
  // Sevilla-Bilbao — même après les 3 fix précédents du jour) : root cause
  // plus profonde, en amont de useTeamForm.js — fetchClubMatchesRaw
  // (useMatchs.js) n'inclut la saison précédente QUE tant qu'AUCUN match de
  // la saison en cours n'est encore FINISHED (`hasFinished`, voir son
  // commentaire) — dès le tout premier match joué de la nouvelle saison
  // (généralement sous 1 semaine après le coup d'envoi), compMatches perd
  // TOUTE trace des saisons précédentes, bien avant que les 2 équipes d'un
  // match donné n'aient eu l'occasion de se réaffronter CETTE saison — un
  // trou bien plus large et durable (tout le 1er tour de championnat, pas
  // juste les tout premiers jours) que ce que les 3 fix précédents du jour
  // corrigeaient. h2hHistory (2 saisons de PLUS, déjà fetché juste au-dessus
  // pour la cote de prono, indépendant de fetchClubMatchesRaw/hasFinished)
  // comble exactement ce trou — combiné à compMatches AVANT d'être transmis
  // à useH2HRows (plus seulement en repli pour le prono comme avant), pour
  // que le head2head AFFICHÉ en profite aussi, pas seulement le calcul de cote.
  const h2hPool = (compMatches?.length || h2hHistory?.length) ? [...compMatches, ...h2hHistory] : compMatches
  // `{ looseTeamMatch: true }` (02/08, même fix que MatchPoster.jsx — voir son
  // commentaire détaillé) : sans ça, resolveFdMatchId (appelé en interne par
  // useH2HRows pour retrouver le head2head dédié) échoue en mode strict sur
  // les noms ESPN qui sont un SUFFIXE du nom FD.org (ex. "Lyon"), alors que la
  // résolution d'id d'ÉQUIPE juste en dessous est déjà en loose.
  const { rows: dedicatedH2H } = useH2HRows(match, h2hPool, 0, { looseTeamMatch: true })
  const fullH2H = dedicatedH2H.length > 0 ? dedicatedH2H : h2hPool
  // Repli "club promu" — voir commentaire détaillé dans MatchPoster.jsx.
  const lowerDivMatches = useLowerDivisionStats(compCode, compMatches)

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
  // ⚠️ BUG CORRIGÉ (même fix que MatchPoster.jsx — voir son commentaire
  // détaillé) : formMap/compMatches/fullH2H indexés id FD.org, match.homeTeam.id
  // est un id ESPN pour les 6 grands championnats → sans résolution, le calcul
  // de côte ne peut jamais utiliser la vraie donnée saison/H2H de l'équipe.
  // ⚠️ 2e BUG CORRIGÉ (même fix que MatchPoster.jsx — voir son commentaire
  // détaillé, H2H 8/8 Barcelone pas reflété dans la cote) : dedicatedH2H
  // ajouté au pool de recherche de resolveFdTeamId, cohérence garantie avec
  // le H2H déjà affiché.
  const teamIdPool = dedicatedH2H.length > 0 ? [...h2hPool, ...dedicatedH2H] : h2hPool
  // ⚠️ BUG CORRIGÉ (16/08, même fix que MatchCard.jsx/MatchPoster.jsx : id
  // ESPN coïncidant par hasard avec l'id FD.org d'un club différent) :
  // `strict:true` + suppression du repli `?? match.xxx.id`.
  const resolvedHomeId = resolveFdTeamId(match.homeTeam, teamIdPool, { loose: true, strict: true })
  const resolvedAwayId = resolveFdTeamId(match.awayTeam, teamIdPool, { loose: true, strict: true })
  // ⚠️ AJOUT (21/08, constat utilisateur : logos différents entre Accueil et
  // Programme/Résultats) : même principe que MatchCard.jsx/MatchPoster.jsx —
  // préfère l'écusson FD.org (déjà dans teamIdPool, zéro appel réseau en
  // plus) à celui du match lui-même (ESPN pour ces 6 championnats).
  const homeCrest = resolveFdCrest(match.homeTeam, resolvedHomeId, teamIdPool)
  const awayCrest = resolveFdCrest(match.awayTeam, resolvedAwayId, teamIdPool)
  const hForm = formMap?.[resolvedHomeId] ?? []
  const aForm = formMap?.[resolvedAwayId] ?? []
  const prono = isLive
    ? calcLiveProno(hForm, aForm, hs, as_, liveMinute, {
        homeId: resolvedHomeId, awayId: resolvedAwayId, compMatches,
        fullH2H, lowerDivMatches,
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
    : calcPronoAdvanced(resolvedHomeId, resolvedAwayId, compMatches, hForm, aForm, {
        fullH2H, lowerDivMatches,
        neutralVenue: isNeutralVenueComp(match),
      })

  const useMarketOdds = isUpcoming && !!espnOdds
  const displayPct    = useMarketOdds ? espnOdds.pct : prono
  const pronoFavorite = pronoFavoriteKey(displayPct)

  const homeCode = (homeName || match.homeTeam?.tla || '').slice(0, 3).toUpperCase()
  const awayCode = (awayName || match.awayTeam?.tla || '').slice(0, 3).toUpperCase()

  // ── Heure éclatée en 3 morceaux (heures / deux-points / minutes) ──
  // Demande explicite (02/09) : chiffres plus gros ET deux-points rouges
  // "moins collés". Un seul <span> avec le texte "20:45" ne permet ni
  // d'espacer ni de recolorer le séparateur — d'où le split ici plutôt
  // qu'en CSS (aucune règle CSS ne peut cibler un caractère au milieu
  // d'un nœud texte).
  const [kickH, kickM] = kickoff.split(':')

  // Forme récente (5 derniers résultats) — hForm/aForm sont DÉJÀ calculés
  // plus haut pour le pronostic (formMap de useTeamForm, résolu par id
  // FD.org) : les afficher ici ne coûte AUCUN appel réseau supplémentaire,
  // contrairement à la position au classement ou au stade (qui exigeraient
  // un appel football-data.org de plus depuis l'Accueil — budget déjà
  // fragile, voir CLAUDE.md, donc volontairement non affichés).
  const homeForm = (hForm ?? []).slice(-5)
  const awayForm = (aForm ?? []).slice(-5)

  const renderForm = (results) => (
    results.length > 0 ? (
      <div className="accueil__mdjForm">
        {results.map((r, i) => (
          <span key={i} className={`accueil__mdjFormBadge accueil__mdjFormBadge--${r}`}>
            {MDJ_FORM_LABEL[r] ?? r}
          </span>
        ))}
      </div>
    ) : null
  )

  const renderTeam = (side, name, crest, rawName, form) => (
    <div className="accueil__mdjTeam">
      <div className="accueil__mdjCrestSlot" data-side={side}>
        <span className="accueil__mdjCrestGlow" aria-hidden="true" />
        {crest
          ? <div className="accueil__mdjCrestWrap" data-crest={isWC ? 'country' : 'club'}><img src={crest} alt="" className="accueil__mdjCrest" data-team={rawName} /></div>
          : <div className="accueil__mdjCrestFb">{name?.[0] ?? ''}</div>}
      </div>
      <span className="accueil__mdjTeamName">{name}</span>
      {renderForm(form)}
    </div>
  )

  return (
    <button
      className="accueil__mdj"
      onClick={onClick}
      style={{
        '--mdj-home': teamColors.home.main,
        '--mdj-away': teamColors.away.main,
      }}
    >
      {/* Habillage lumineux (maquette validée 02/09) — halos flous aux
          couleurs RÉELLES des deux équipes (--mdj-home/--mdj-away, dico
          curé teamPhotos) + liseré dégradé en haut de carte. Purement
          décoratifs, d'où aria-hidden. Remplacent l'ancien blason en
          filigrane, retiré : il chargeait visuellement le fond juste
          derrière la forme récente et les noms d'équipe, désormais placés
          là. */}
      <span className="accueil__mdjTopLine" aria-hidden="true" />
      <span className="accueil__mdjGlowTop" aria-hidden="true" />
      <span className="accueil__mdjGlowBottom" aria-hidden="true" />

      <div className="accueil__mdjHeader">
        <span className="accueil__mdjHeaderRule" aria-hidden="true" />
        <span className={`accueil__mdjKicker${isLive ? ' accueil__mdjKicker--live' : ''}`}>
          {isLive && <span className="accueil__mdjLiveDot" aria-hidden="true" />}
          {isLive
            ? `En direct${liveMinute ? ` · ${liveMinute}` : ''}`
            : isFinished ? 'Match du jour · terminé' : 'Match du jour'}
        </span>
        <span className="accueil__mdjHeaderRule" aria-hidden="true" />
      </div>

      <div className="accueil__mdjSub">
        {mdjCompEmblem && <img src={mdjCompEmblem} alt="" className="accueil__mdjCompLogo" />}
        <span>{[mdjCompName, isLive ? livePeriodLabel : null].filter(Boolean).join(' · ')}</span>
      </div>

      <div className="accueil__mdjTeams">
        {renderTeam('home', homeName, homeCrest, match.homeTeam?.name, homeForm)}

        <div className="accueil__mdjCenter">
          {(isLive || isFinished) ? (
            <div className="accueil__mdjScore">
              <span className="accueil__mdjScoreNum">{hs ?? 0}</span>
              <span className="accueil__mdjScoreSep">–</span>
              <span className="accueil__mdjScoreNum">{as_ ?? 0}</span>
            </div>
          ) : (
            <div className="accueil__mdjClock">
              <span className="accueil__mdjClockNum">{kickH}</span>
              <span className="accueil__mdjClockSep">:</span>
              <span className="accueil__mdjClockNum">{kickM}</span>
            </div>
          )}
          <span className="accueil__mdjCenterLabel">
            {isFinished ? 'Terminé' : isLive ? 'Score' : "Aujourd'hui"}
          </span>
        </div>

        {renderTeam('away', awayName, awayCrest, match.awayTeam?.name, awayForm)}
      </div>

      {/* Pronostic — pilules "côtes bookmaker" : classes .poster__prono-*
          RÉUTILISÉES telles quelles (pas de copie CSS parallèle) pour un
          design garanti identique à celui des autres cards de l'Accueil
          (MatchPoster.jsx, retour utilisateur explicite : "même design
          exactement que sur les cards des autres matchs"). Liseré + glow
          bordeaux réservés à la pilule favorite. */}
      <div className="poster__prono-row">
        <div className="poster__prono-pill" style={pronoFavorite === 'home' ? { borderColor: `rgba(159,30,52,${pronoIntensity(displayPct.home)})`, boxShadow: pronoGlowShadow(displayPct.home) } : { borderColor: 'transparent' }}>
          <span className="poster__prono-pillLabel">{homeCode}</span>
          <span className="poster__prono-pillVal">{(useMarketOdds ? espnOdds.decimal.home : pronoToOdds(prono.home)).toFixed(2)}</span>
        </div>
        <div className="poster__prono-pill" style={pronoFavorite === 'draw' ? { borderColor: `rgba(159,30,52,${pronoIntensity(displayPct.draw)})`, boxShadow: pronoGlowShadow(displayPct.draw) } : { borderColor: 'transparent' }}>
          <span className="poster__prono-pillLabel">Nul</span>
          <span className="poster__prono-pillVal">{(useMarketOdds ? espnOdds.decimal.draw : pronoToOdds(prono.draw)).toFixed(2)}</span>
        </div>
        <div className="poster__prono-pill" style={pronoFavorite === 'away' ? { borderColor: `rgba(159,30,52,${pronoIntensity(displayPct.away)})`, boxShadow: pronoGlowShadow(displayPct.away) } : { borderColor: 'transparent' }}>
          <span className="poster__prono-pillLabel">{awayCode}</span>
          <span className="poster__prono-pillVal">{(useMarketOdds ? espnOdds.decimal.away : pronoToOdds(prono.away)).toFixed(2)}</span>
        </div>
      </div>
    </button>
  )
}
