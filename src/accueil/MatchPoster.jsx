import { useState }                   from 'react'
import { translateTeam }              from '../data/teamNames'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, isNationalTeamComp } from '../utils/matchUtils'
import { getMatchState }              from '../utils/matchStateTracker'
import { calcPronoAdvanced, calcLiveProno, pronoToOdds, pronoIntensity } from '../utils/calcProno'
import { getMatchTeamColors, buildMatchGradient, buildMatchGradientAlt } from '../data/teamPhotos'
import { useTeamForm }                from '../hooks/useTeamForm'
import { FormDiamonds }               from './FormDiamonds'
import { COMPETITIONS }               from '../data/competitions'

function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function MatchPoster({ match, espnScore = null, onClick }) {
  // Vrai formMap depuis football-data.org pour cette compétition
  const compCode = match.competition?.code ?? null
  const { formMap, compMatches } = useTeamForm(compCode)
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)

  // Fallback initiale si le crest ne charge pas (404, image cassée)
  const [homeCrestError, setHomeCrestError] = useState(false)
  const [awayCrestError, setAwayCrestError] = useState(false)

  const _ms       = getMatchState(match.id)
  const _espnLive = (
    _ms.espnStatus === 'STATUS_IN_PROGRESS' ||
    _ms.espnStatus === 'STATUS_HALFTIME'    ||
    _ms.espnStatus === 'STATUS_END_PERIOD'
  )
  const isFinished = _ms.ft === true || (match.status === 'FINISHED' && !_espnLive)
  const isLive     = !isFinished && (
    match.status === 'IN_PLAY' ||
    match.status === 'PAUSED'  ||
    match.status === 'HALFTIME'||
    _espnLive
  )
  const isUpcoming = !isFinished && !isLive

  const fsPoster  = finalScore(match.score)
  const homeScore = mergeScore(espnScore?.home, fsPoster.home)
  const awayScore = mergeScore(espnScore?.away, fsPoster.away)
  const minute    = isLive ? calcMinute(match) : null

  const homeName  = match.homeTeam?.name ?? ''
  const awayName  = match.awayTeam?.name ?? ''
  const hForm     = formMap?.[match.homeTeam?.id] ?? []
  const aForm     = formMap?.[match.awayTeam?.id] ?? []
  // BUG CORRIGÉ (constat utilisateur : "le prono ne bougeait pas dans la
  // card en live en fonction du score") : cette barre utilisait TOUJOURS
  // calcPronoAdvanced (le prior pré-match figé), même une fois le match en
  // direct — jamais calcLiveProno, qui est pourtant le modèle prévu pour ça
  // (voir LiveMatchPage/LiveStatsTab). Résultat : les % restaient identiques
  // du coup d'envoi à la fin du match quel que soit le score réel. En live,
  // on utilise maintenant calcLiveProno (score + minute + cartons rouges/
  // possession/tirs cadrés, déjà dans espnScore?.stats — aucun fetch de
  // plus) ; pré-match et FT gardent calcPronoAdvanced (rien à faire glisser
  // avant le coup d'envoi, résultat déjà figé une fois le match terminé).
  const prono = isLive
    ? calcLiveProno(hForm, aForm, homeScore, awayScore, minute, {
        homeId: match.homeTeam?.id, awayId: match.awayTeam?.id, compMatches,
        homeRedCards:      espnScore?.stats?.home?.redCards,
        awayRedCards:      espnScore?.stats?.away?.redCards,
        homePoss:          espnScore?.stats?.home?.poss,
        awayPoss:          espnScore?.stats?.away?.poss,
        homeShotsOnTarget: espnScore?.stats?.home?.shotsOnTarget,
        awayShotsOnTarget: espnScore?.stats?.away?.shotsOnTarget,
      })
    : calcPronoAdvanced(match.homeTeam?.id, match.awayTeam?.id, compMatches, hForm, aForm)

  // Fond : dégradé couleurs des deux équipes (anti-collision) — plus de photo
  // hardcodée : elle masquait systématiquement les couleurs pour toute la trentaine
  // de pays "populaires" pré-photographiés (très fréquent en Coupe du Monde), ce qui
  // donnait l'impression que "les couleurs ne s'affichent jamais".
  const { home: homeColors, away: awayColors } = getMatchTeamColors(homeName, awayName)
  const hColor      = homeColors.main
  const aColor      = awayColors.main
  // 2 dégradés STATIQUES (peints une seule fois, jamais réanimés eux-mêmes) :
  // le crossfade et le mouvement ci-dessous n'animent que opacity/transform,
  // les 2 seules propriétés que le navigateur compose sur le GPU sans jamais
  // redéclencher de repaint — voir accueil.css .poster__bg--gradient(Alt).
  const gradient    = buildMatchGradient(homeColors, awayColors)
  const gradientAlt = buildMatchGradientAlt(homeColors, awayColors)

  const homeShort = translateTeam(match.homeTeam?.shortName || homeName)
  const awayShort = translateTeam(match.awayTeam?.shortName || awayName)

  // Retour utilisateur : quand une équipe a peu de chances (petit %), le
  // libellé complet ("Paris Saint-Germain 5%") était coupé par "…" et le
  // pourcentage disparaissait — le libellé était contraint à la même largeur
  // que le segment de barre (parfois 5% du poster, ~15px). Initiales à 3
  // lettres — BUG CORRIGÉ (retour utilisateur : "les noms d'équipe à 3
  // lettres en français") : priorité inversée. `homeShort`/`awayShort` sont
  // déjà passés par translateTeam() (voir plus haut) donc en français ;
  // l'ancien code priorisait `tla` (code FD.org brut, souvent la version
  // anglaise/internationale du nom, ex. "ENG" au lieu de "ANG" pour
  // l'Angleterre) — jamais traduit. `tla` ne sert plus qu'en dernier
  // recours si `homeShort`/`awayShort` sont vides.
  const homeCode = (homeShort || match.homeTeam?.tla || '').slice(0, 3).toUpperCase()
  const awayCode = (awayShort || match.awayTeam?.tla || '').slice(0, 3).toUpperCase()

  const cls = 'poster' + (isLive ? ' poster--live' : isFinished ? ' poster--ft' : '')

  // ── Bandeau compétition (gauche, logo + nom FR) + statut période (droite) ──
  // Même contenu/logique que le hero de LiveMatchPage et que la version
  // desktop (accueil/MatchCard.jsx) — demande explicite : cette version
  // mobile (posters) doit avoir le même traitement. comp?.name (COMPETITIONS,
  // déjà traduit en français) est prioritaire sur match.competition?.name
  // (football-data.org, toujours en anglais) — voir le fix équivalent dans
  // MatchCard.jsx/LiveMatchPage.jsx/MatchPage.jsx.
  const posterComp = COMPETITIONS.find(c => c.id === match.competition?.code)
  const posterCompEmblem = posterComp?.emblem ?? match.competition?.emblem
  const posterCompName   = posterComp?.name ?? match.competition?.name ?? ''
  const rawPosterPeriod = getMatchPeriod(match)
  const posterPeriodLabel = rawPosterPeriod === '1ère MT'       ? '1ère mi-temps'
    : rawPosterPeriod === '2ème MT'       ? '2ème mi-temps'
    : rawPosterPeriod === 'Mi-temps'      ? 'Mi-temps'
    : rawPosterPeriod === 'Prolongations' ? 'Prolongations'
    : rawPosterPeriod === 'T.A.B.'        ? 'T.A.B.'
    : null

  return (
    <div className="poster__frame" style={{ '--hc': hColor ?? '#2a3a4a', '--ac': aColor ?? '#2a3a4a' }}>
    <div className={cls} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>

      {/* ── Fond : dégradé couleurs des équipes, 2 calques STATIQUES ──
          Chaque dégradé est peint une seule fois (background posé inline,
          jamais réanimé). Tout le mouvement/morph vient du CSS (transform +
          opacity uniquement — voir accueil.css) : ce sont les 2 seules
          propriétés qu'un navigateur anime sur le compositeur GPU sans
          jamais redéclencher de repaint, contrairement à background-position
          ou à une couleur de dégradé qui change dans le temps. */}
      <div className="poster__bg poster__bg--gradient"    style={{ background: gradient }} />
      <div className="poster__bg poster__bg--gradientAlt" style={{ background: gradientAlt }} />
      <div className="poster__overlay" />

      {/* ── Badge compét (gauche, logo + nom FR) + statut période en live (droite) ── */}
      <div className="poster__topbar">
        <span className="poster__topbarComp">
          {isLive && <span className="poster__live-dot" />}
          {posterCompEmblem && <img src={posterCompEmblem} alt="" className="poster__topbarCompLogo" />}
          <span className="poster__comp-name">{posterCompName}</span>
        </span>
        {isLive && posterPeriodLabel && (
          <span className="poster__topbarPeriod">{posterPeriodLabel}</span>
        )}
      </div>

      {/* ── Bloc central : [crest+nom] | [label+temps] | [crest+nom] ── */}
      <div className="poster__middle">

        <div className="poster__team-col poster__team-col--home">
          {/* BUG CORRIGÉ : crest+nom étaient 2 enfants SÉPARÉS de team-col
              (align-items:flex-start/flex-end pour plaquer le nom au bord
              extérieur). Le crest (largeur fixe 44px) suivait donc le MÊME
              bord que le nom, mais un nom plus large que 44px décale son
              propre centre visuel vers la droite (home) — un correctif
              précédent centrait le crest sur toute la colonne (68px), ce qui
              ne matche que pour un nom qui occupe presque toute cette
              largeur (ex. "Angleterre") : pour un nom court ("Maroc",
              "France"…) le nom reste collé au bord tandis que le crest se
              retrouve centré plus loin — toujours pas aligné. Fix définitif :
              crest+nom+losanges sont maintenant TOUS les 3 enfants de
              .poster__nameGroup (largeur "shrink-to-fit", align-items:center
              — voir CSS), donc centrés les uns par rapport aux autres quelle
              que soit la longueur du nom, tandis que le groupe entier reste
              plaqué au bord extérieur via l'align-items hérité de team-col. */}
          <div className="poster__nameGroup">
            {match.homeTeam?.crest && !homeCrestError
              ? <div className="poster__crestWrap" data-crest={isWC ? 'country' : 'club'}><img className="poster__crest" src={match.homeTeam.crest} alt="" data-team={homeName}
                  onError={() => setHomeCrestError(true)} /></div>
              : <div className="poster__crest-empty">{homeShort?.[0] ?? ''}</div>
            }
            <span className="poster__name poster__name--home">{homeShort}</span>
            <FormDiamonds form={hForm} />
          </div>
        </div>

        <div className="poster__center">
          {isLive && minute && (
            <div className="poster__min-label">
              {/* calcMinute() renvoie déjà des libellés complets pour les états
                  spéciaux (MT/Pause/TAB/Débute) et inclut déjà l'apostrophe pour
                  les minutes chiffrées ("91'") — ne jamais en rajouter une. */}
              {minute === 'MT' ? 'Mi-temps' : minute}
            </div>
          )}
          {isUpcoming && <div className="poster__env-label">Coup d&apos;envoi</div>}
          {isFinished  && <div className="poster__env-label">Terminé</div>}
          {(isLive || isFinished)
            ? <div className="poster__score">{homeScore ?? 0} – {awayScore ?? 0}</div>
            : <div className="poster__time">{formatHour(match.utcDate)}</div>
          }
        </div>

        <div className="poster__team-col poster__team-col--away">
          <div className="poster__nameGroup">
            {match.awayTeam?.crest && !awayCrestError
              ? <div className="poster__crestWrap" data-crest={isWC ? 'country' : 'club'}><img className="poster__crest" src={match.awayTeam.crest} alt="" data-team={awayName}
                  onError={() => setAwayCrestError(true)} /></div>
              : <div className="poster__crest-empty">{awayShort?.[0] ?? ''}</div>
            }
            <span className="poster__name poster__name--away">{awayShort}</span>
            <FormDiamonds form={aForm} />
          </div>
        </div>

      </div>

      {/* ── Pronostic — pilules "côtes bookmaker", même design que
          LiveProno (MatchModal.jsx/LiveMatchPage) : fond clair pour
          trancher sur le poster, cote décimale (pronoToOdds), liseré rouge
          d'intensité proportionnelle à la probabilité (pronoIntensity). ── */}
      <div className="poster__footer">
        <div className="poster__prono-row">
          <div className="poster__prono-pill" style={{ borderColor: `rgba(255,7,45,${pronoIntensity(prono.home)})` }}>
            <span className="poster__prono-pillLabel">{homeCode}</span>
            <span className="poster__prono-pillVal">{pronoToOdds(prono.home).toFixed(2)}</span>
          </div>
          <div className="poster__prono-pill poster__prono-pill--draw" style={{ borderColor: `rgba(255,7,45,${pronoIntensity(prono.draw)})` }}>
            <span className="poster__prono-pillLabel">Nul</span>
            <span className="poster__prono-pillVal">{pronoToOdds(prono.draw).toFixed(2)}</span>
          </div>
          <div className="poster__prono-pill" style={{ borderColor: `rgba(255,7,45,${pronoIntensity(prono.away)})` }}>
            <span className="poster__prono-pillLabel">{awayCode}</span>
            <span className="poster__prono-pillVal">{pronoToOdds(prono.away).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
