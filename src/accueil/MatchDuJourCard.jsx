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
import { FormDiamonds } from './FormDiamonds'
import { TEAM_SHORT } from '../data/teamShortNames'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, isNationalTeamComp, isNeutralVenueComp, resolveFdTeamId, resolveFdCrest } from '../utils/matchUtils'
import { getMatchState } from '../utils/matchStateTracker'
import { calcPronoAdvanced, calcLiveProno, pronoToOdds, pronoIntensity, pronoGlowShadow, pronoFavoriteKey } from '../utils/calcProno'
import { useTeamForm } from '../hooks/useTeamForm'
import { useH2HHistory, useLowerDivisionStats } from '../hooks/useMatchs'
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

  // ⚠️ BUG CORRIGÉ (constat utilisateur, 02/09 : "c'est pas les mêmes cotes
  // dans les cards des matchs en live que sur la page live/:matchId") :
  // `enabled` était limité à `isUpcoming`, donc la cote de marché ESPN
  // n'était PAS chargée pendant le match et `marketPre` n'était jamais
  // transmis à calcLiveProno plus bas. Résultat : cette carte partait du seul
  // prior interne (forme récente) alors que MatchPoster.jsx (les autres cards
  // de l'Accueil) ET LiveStatsTab (MatchModal.jsx, la page du direct)
  // réinjectent tous les deux la cote de marché — d'où trois affichages pour
  // le même match, dont un seul divergeait.
  // Exactement le même correctif que celui déjà appliqué à MatchPoster.jsx
  // pour le cas Lens-PSG (voir son commentaire) : `!isFinished` garde la
  // requête active en live, indispensable si l'app est ouverte APRÈS le coup
  // d'envoi et jamais avant. Même hook, même cache, aucun appel réseau en
  // plus — juste jamais branché ici.
  const { data: espnOdds } = useEspnPregameOdds(match, !isFinished)

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
        // Point de départ RÉEL du calcul live : la cote de marché ESPN, comme
        // dans MatchPoster.jsx et LiveStatsTab. Sans elle, cette carte partait
        // du prior interne (forme récente) et divergeait des deux autres pour
        // le même match — voir le commentaire de useEspnPregameOdds plus haut.
        marketPre:         espnOdds?.pct ?? null,
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

  // ── AFFICHE (refonte 3, 02/09) ────────────────────────────────────────
  // Demande explicite après 2 essais : "faut pas que ce soit le même design
  // que les autres cards, une belle affiche qui donne envie, un vrai
  // affrontement, c'est LE match du jour". La carte n'imite donc plus les
  // cards de la liste (essai précédent) et n'invente pas non plus un langage
  // terne (essai d'avant) : format haut type affiche de match, camp de chaque
  // équipe teinté de SA couleur, gros blasons face à face, "VS" central.
  //
  // Couleurs : `--hc` / `--ac` sont les couleurs principales curées des deux
  // équipes (getMatchTeamColors, dico teamPhotos). Quand les deux équipes ont
  // une couleur de la même famille, c'est l'équipe à l'EXTÉRIEUR qui bascule
  // sur sa secondaire — règle appliquée directement dans getMatchTeamColors
  // (voir son commentaire : demande explicite + convention du foot réel, le
  // club qui reçoit garde son maillot principal).
  const homeColor = teamColors.home.main
  const awayColor = teamColors.away.main

  // Journée de championnat — affichée en sous-titre du bandeau compétition.
  // `matchday` vient de football-data.org (vérifié sur les données réelles de
  // l'app : présent et correct sur les 5 grands championnats) ; il n'existe
  // pas pour les compétitions à élimination directe ni pour certaines
  // sources ESPN — d'où l'affichage conditionnel plutôt qu'un "Journée
  // undefined". `stage` n'est utilisé que pour ne PAS écrire "Journée" sur
  // un tour de coupe, où le numéro ne veut rien dire.
  const matchdayLabel = (match.matchday != null && match.stage === 'REGULAR_SEASON')
    ? `Journée ${match.matchday}`
    : null

  // (plus de modificateur --home/--away : depuis que les couleurs de camp sont
  // portées par les calques de fond, aucun style ne dépend plus du côté.)
  const renderSide = (name, crest, rawName, form, code) => (
    <div className="accueil__mdjSide">
      <div className="accueil__mdjCrestWrap" data-crest={isWC ? 'country' : 'club'}>
        {crest
          ? <img src={crest} alt="" className="accueil__mdjCrest" data-team={rawName} />
          : <span className="accueil__mdjCrestFb">{code}</span>}
      </div>
      <span className="accueil__mdjTeamName">{name}</span>
      <FormDiamonds form={form} />
    </div>
  )

  return (
    <button
      className="accueil__mdj"
      onClick={onClick}
      style={{ '--hc': homeColor, '--ac': awayColor }}
    >
      {/* Camps colorés : deux moitiés en diagonale, chacune teintée de la
          couleur de son équipe. Éléments séparés (pas un background unique)
          pour pouvoir les animer en transform/opacity seulement — les 2
          propriétés que le navigateur compose sur le GPU sans repaint, comme
          déjà fait pour les cards de match (voir accueil.css). */}
      <span className="accueil__mdjCamp accueil__mdjCamp--home" aria-hidden="true" />
      <span className="accueil__mdjCamp accueil__mdjCamp--away" aria-hidden="true" />
      <span className="accueil__mdjClash" aria-hidden="true" />
      <span className="accueil__mdjVeil" aria-hidden="true" />

      <div className="accueil__mdjContent">
        {/* Bandeau haut : championnat À GAUCHE, bien lisible (demande
            explicite : "assez voyant pour qu'on sache le championnat sans
            plisser les yeux"). Logo dans une pastille claire + nom en gros
            et en blanc, journée en sous-titre.
            ⚠️ PASTILLE DE STATUT SUPPRIMÉE (02/09) — elle occupait le haut
            droite du bandeau et ne servait à rien dans AUCUN des 3 états :
              • avant le match, elle disait "Match du jour", ce que la carte
                dit déjà d'elle-même par sa taille et sa place en tête de page ;
              • en direct, la période est affichée au-dessus du VS et la minute
                en rouge au-dessus du score — l'état est déjà évident ;
              • après la fin, elle écrivait "Terminé"… alors que le libellé
                au-dessus du score écrit DÉJÀ "Terminé" : le mot apparaissait
                littéralement deux fois à l'écran.
            Le bandeau se réduit donc au championnat, qui récupère toute la
            largeur — la journée cesse d'être poussée hors du cadre par un nom
            long ("Ligue 1 McDonald's", constaté en capture réelle).
            Piste du filigrane "MATCH DU JOUR" en fond ÉCARTÉE après essai sur
            maquette (4 intensités/placements comparés) : à une opacité
            réellement voyante il passe derrière les noms d'équipe et les
            blasons — exactement ce qui avait déjà fait retirer le blason en
            filigrane de la version précédente. */}
        <div className="accueil__mdjTopBar">
          <span className="accueil__mdjLeague">
            {mdjCompEmblem && (
              /* data-opaque : le logo a son PROPRE fond plein (tuile Ligue 1
                 bleue, Premier League violette — voir emblemOpaque dans
                 competitions.js). Dans ce cas la tuile sert elle-même de
                 pastille : pas de fond blanc ni de marge, sinon on obtient un
                 carré de couleur dans un carré blanc. */
              <span
                className="accueil__mdjLeagueIcon"
                data-opaque={mdjComp?.emblemOpaque ? '1' : undefined}
                /* emblemBg : fond imposé par la compétition (LaLiga = noir,
                   son logo étant un tracé monochrome rouge illisible sur
                   blanc). Absent pour toutes les autres → pastille blanche. */
                style={mdjComp?.emblemBg ? { background: mdjComp.emblemBg } : undefined}
              >
                <img src={mdjCompEmblem} alt="" />
              </span>
            )}
            <span className="accueil__mdjLeagueText">
              <span className="accueil__mdjLeagueName">{mdjCompName}</span>
              {matchdayLabel && <span className="accueil__mdjLeagueSub">{matchdayLabel}</span>}
            </span>
          </span>

          {/* Période en cours EN HAUT À DROITE (02/09) — elle était centrée
              au-dessus du VS, jugée peu esthétique à cet endroit. Elle occupe
              maintenant le coin laissé libre par la pastille de statut
              supprimée, ce qui équilibre le bandeau au lieu d'ajouter une
              ligne au milieu de l'affiche. */}
          {isLive && livePeriodLabel && (
            <span className="accueil__mdjPeriod">{livePeriodLabel}</span>
          )}
        </div>

        <div className="accueil__mdjDuel">
          {renderSide(homeName, homeCrest, match.homeTeam?.name, homeForm, homeCode)}
          {/* VS en CONTOUR lumineux : 2 calques superposés (noyau translucide
              + contour tracé via -webkit-text-stroke) + halo rond derrière.
              aria-hidden : purement décoratif, l'affrontement est déjà porté
              par les 2 noms d'équipe lus juste avant/après. */}
          <span className="accueil__mdjVs" aria-hidden="true">
            <span className="accueil__mdjVsGlow" />
            <span className="accueil__mdjVsCore">VS</span>
            <span className="accueil__mdjVsOutline">VS</span>
          </span>
          {renderSide(awayName, awayCrest, match.awayTeam?.name, awayForm, awayCode)}
        </div>

        {/* Minute de jeu à la place du libellé, juste au-dessus du score
            (demande explicite) — d'où son retrait du bandeau haut, sinon
            elle apparaissait deux fois. Hors live, ce même emplacement
            affiche "Aujourd'hui" ou "Terminé". */}
        <div className="accueil__mdjWhen">
          {isLive
            ? (
              /* Le point rouge qui pulse suit la minute plutôt que de rester
                 dans l'ancienne pastille de statut (supprimée, voir bandeau
                 haut) : c'est le signal "ça bouge en ce moment", il a plus de
                 sens collé au chrono que perdu dans un coin. */
              <span className="accueil__mdjMinute">
                <span className="accueil__mdjLiveDot" aria-hidden="true" />
                {liveMinute ?? 'En cours'}
              </span>
            )
            : <span className="accueil__mdjWhenLabel">{isFinished ? 'Terminé' : "Aujourd'hui"}</span>}
          {(isLive || isFinished) ? (
            <div className="accueil__mdjScore">
              <span className="accueil__mdjBigNum">{hs ?? 0}</span>
              <span className="accueil__mdjScoreSep">–</span>
              <span className="accueil__mdjBigNum">{as_ ?? 0}</span>
            </div>
          ) : (
            <div className="accueil__mdjClock">
              <span className="accueil__mdjBigNum">{kickH}</span>
              <span className="accueil__mdjClockSep">:</span>
              <span className="accueil__mdjBigNum">{kickM}</span>
            </div>
          )}
        </div>

        {/* Cotes : classes .poster__prono-* réutilisées, à la MÊME taille que
            les cards de la liste (demande explicite après les avoir vues
            rétrécies) — plus aucune surcharge de dimension ici. */}
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
      </div>
    </button>
  )
}
