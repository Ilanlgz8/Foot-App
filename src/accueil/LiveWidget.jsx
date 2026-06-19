import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod } from '../utils/matchUtils'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'

// Map abréviations — clés = sortie de translateTeam (ou nom brut API si pas traduit)
const TEAM_SHORT = {
  // ── Ligue 1 ──
  'Union Saint-Gilloise':    'Union SG',      // translateTeam('Union SG') → trop long
  'Paris Saint-Germain':     'Paris SG',      // si API renvoie nom complet
  'Paris Saint-Germain FC':  'Paris SG',

  // ── Premier League ──
  'Crystal Palace':          'C. Palace',
  'Wolverhampton':           'Wolves',
  'Wolverhampton Wanderers': 'Wolves',
  'Nottingham Forest':       'Nott. Forest',
  'Brighton & Hove Albion':  'Brighton',
  'Brighton Hove Albion':    'Brighton',
  'Newcastle United':        'Newcastle',
  'Tottenham Hotspur':       'Tottenham',
  'West Ham United':         'West Ham',
  'Manchester City':         'Man. City',
  'Manchester United':       'Man. United',
  'Leeds United':            'Leeds',

  // ── La Liga ──
  'Atlético Madrid':         'Atl. Madrid',   // translateTeam('Atleti') → Atlético Madrid
  'Athletic Bilbao':         'Ath. Bilbao',   // translateTeam('Athletic') → Athletic Bilbao
  'Real Sociedad':           'R. Sociedad',
  'Deportivo Alavés':        'Alavés',
  'Rayo Vallecano':          'Rayo',

  // ── Bundesliga ──
  'Bayern Munich':           'Bayern',        // translateTeam('Bayern') → Bayern Munich
  'Eintracht Frankfurt':     'Frankfurt',
  'Werder Brême':            'Werder',        // translateTeam('Bremen') → Werder Brême
  'Werder Bremen':           'Werder',
  'Borussia Dortmund':       'Dortmund',

  // ── Serie A ──
  'Inter Milan':             'Inter',         // translateTeam('Inter') → Inter Milan
  'Milan AC':                'Milan',         // translateTeam('Milan') → Milan AC
  'Hellas Verona':           'Verona',

  // ── Ligue des Champions ──
  'PSV Eindhoven':           'PSV',
  'Club Brugge':             'Bruges',
  'Slavia Prague':           'Slavia',
  'Slavia Praha':            'Slavia',

  // ── Coupe du Monde / Nations ──
  'Bosnie-Herzégovine':      'Bosnie-H.',     // translateTeam('Bosnia-H.') → Bosnie-Herzégovine
  'Arabie Saoudite':         'Arabie S.',
  'Nouvelle-Zélande':        'N.-Zélande',
  "Côte d'Ivoire":           'Côte d\'Ivoire', // 13 chars, ok tel quel
  'Corée du Sud':            'Corée du Sud',
  'États-Unis':              'États-Unis',
  'Afrique du Sud':          'Afrique S.',
}

// Fallback générique si > 13 caractères et pas dans la map
function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 13) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0]}. ${words.slice(1).join(' ')}`
}

// ── Badge compétition ────────────────────────────────────────────────────────
function CompBadge({ match }) {
  const comp   = COMPETITIONS.find(c => c.id === match.competition?.code)
  const emblem = comp?.emblem ?? match.competition?.emblem
  const name   = match.competition?.name ?? comp?.name ?? ''
  if (!emblem && !name) return null
  return (
    <div className="accueil__liveWidgetCompBadge">
      {emblem && <img src={emblem} alt="" className="accueil__liveWidgetCompLogo" />}
      <span className="accueil__liveWidgetCompName">{name}</span>
    </div>
  )
}

// ── Badge période ────────────────────────────────────────────────────────────
function PeriodBadge({ match }) {
  const period = getMatchPeriod(match)
  if (!period) return null
  return (
    <span className="accueil__liveWidgetPeriod">{period}</span>
  )
}

// ── Rang score custom : pills Chakra Petch + barre verticale ────────────────
function ScoreDisplay({ homeScore, awayScore, minute, isTermine }) {
  const h = homeScore ?? '-'
  const a = awayScore ?? '-'
  const label = isTermine ? 'FT' : (minute ?? '–')

  let homeCls = 'accueil__liveWidgetPill'
  let awayCls = 'accueil__liveWidgetPill'
  if (isTermine) {
    homeCls += ' accueil__liveWidgetPill--ft'
    awayCls += ' accueil__liveWidgetPill--ft'
  }

  return (
    <div className="accueil__liveWidgetScoreWrap">
      <div className="accueil__liveWidgetPills">
        <div className={homeCls}>{h}</div>
        <div className="accueil__liveWidgetPillBar" />
        <div className={awayCls}>{a}</div>
      </div>
      <span className="accueil__liveWidgetMinute">{label}</span>
    </div>
  )
}

// ── Buteurs alignés sous chaque équipe ──────────────────────────────────────
function ScorerColumns({ scorers = [] }) {
  const homeGoals = scorers.filter(s => s.team === 'home')
  const awayGoals = scorers.filter(s => s.team === 'away')
  if (homeGoals.length === 0 && awayGoals.length === 0) return null

  const suffix = s => (s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : '')

  return (
    <div className="accueil__liveWidgetScorers">
      <div className="accueil__liveWidgetScorersHome">
        {homeGoals.map((s, i) => (
          <div key={i} className="accueil__liveWidgetScorerItem">
            <span className="accueil__liveWidgetScorerName">{s.name}{suffix(s)}</span>
            {s.minute && <span className="accueil__liveWidgetScorerMin">{s.minute}</span>}
          </div>
        ))}
      </div>
      <div className="accueil__liveWidgetScorersGap" />
      <div className="accueil__liveWidgetScorersAway">
        {awayGoals.map((s, i) => (
          <div key={i} className="accueil__liveWidgetScorerItem">
            <span className="accueil__liveWidgetScorerName">{s.name}{suffix(s)}</span>
            {s.minute && <span className="accueil__liveWidgetScorerMin">{s.minute}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Stats grille : home val | barre | label | barre | away val ───────────────
function StatsBar({ stats }) {
  if (!stats) return null
  const { home, away } = stats

  const fmtShots = (shots, sot) =>
    shots == null ? null : sot != null ? `${shots} (${sot})` : `${shots}`

  const rows = []

  if (home.poss != null) {
    const hp = Math.round(home.poss)
    const ap = Math.round(away.poss ?? (100 - home.poss))
    rows.push({ h: `${hp}%`, label: 'poss', a: `${ap}%`, hNum: hp, aNum: ap })
  }

  const hs = fmtShots(home.shots, home.shotsOnTarget)
  const as_ = fmtShots(away.shots, away.shotsOnTarget)
  if (hs != null)
    rows.push({ h: hs, label: 'tirs', a: as_, hNum: home.shots ?? 0, aNum: away.shots ?? 0 })

  if (home.corners != null)
    rows.push({ h: `${home.corners}`, label: 'crs', a: `${away.corners}`, hNum: home.corners, aNum: away.corners })

  if (rows.length === 0) return null

  return (
    <div className="accueil__liveWidgetStats">
      {rows.map((row, i) => {
        const total = (row.hNum + row.aNum) || 1
        const homePct = (row.hNum / total) * 100
        return (
          <div key={i} className="accueil__liveWidgetStatRow">
            <div className="accueil__liveWidgetStatHeader">
              <span className="accueil__liveWidgetStatNum">{row.h}</span>
              <span className="accueil__liveWidgetStatLabel">{row.label}</span>
              <span className="accueil__liveWidgetStatNum">{row.a}</span>
            </div>
            <div className="accueil__liveWidgetStatTrack">
              <div className="accueil__liveWidgetStatFill" style={{ width: `${homePct}%` }} />
              <div className="accueil__liveWidgetStatFill accueil__liveWidgetStatFill--away" style={{ width: `${100 - homePct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Widget principal ─────────────────────────────────────────────────────────
export function LiveWidget({ liveMatches = [], espnScores = {}, trackedIds, onRecalibrate, onMatchClick }) {
  const live = liveMatches.filter(m =>
    m.status === 'IN_PLAY' || m.status === 'PAUSED' || getMatchState(m.id).ft === true
  )

  if (live.length === 0) return null

  return (
    <div className="accueil__liveWidget">
      <div className="accueil__liveWidgetHeader">
        {/* Compétition à gauche */}
        <CompBadge match={live[0]} />
        {/* EN DIRECT à droite */}
        <div className="accueil__liveWidgetHeaderRight">
          <span className="accueil__liveWidgetDot" />
          <span className="accueil__liveWidgetTitle">EN DIRECT</span>
          {live.length > 1 && <span className="accueil__liveWidgetCount">{live.length}</span>}
          {onRecalibrate && (
            <button className="accueil__liveWidgetRecal" onClick={onRecalibrate} title="Recalibrer les minutes">⟳</button>
          )}
        </div>
      </div>

      <div className="accueil__liveWidgetMatches">
        {live.slice(0, 5).map(match => {
          const espn      = espnScores[match.id] ?? null
          const isTermine = getMatchState(match.id).ft === true
          const minute    = isTermine ? null : calcMinute(match)
          const hs        = espn?.home ?? match.score?.fullTime?.home ?? match.score?.halfTime?.home
          const as_       = espn?.away ?? match.score?.fullTime?.away ?? match.score?.halfTime?.away
          const homeName  = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
          const awayName  = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))
          const clickable = !!onMatchClick

          return (
            <div
              key={match.id}
              className={`accueil__liveWidgetMatchBlock${clickable ? ' accueil__liveWidgetMatchBlock--clickable' : ''}`}
              onClick={clickable ? () => onMatchClick(match) : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? e => e.key === 'Enter' && onMatchClick(match) : undefined}
            >
              <div className="accueil__liveWidgetMeta">
                <PeriodBadge match={match} />
              </div>

              <div className="accueil__liveWidgetMatchRow">
                {/* Équipe domicile */}
                <div className="accueil__liveWidgetTeam">
                  {match.homeTeam?.crest
                    ? <img src={match.homeTeam.crest} alt="" className="accueil__liveWidgetCrest" />
                    : <div className="accueil__liveWidgetCrestFallback" />}
                  <span className="accueil__liveWidgetTeamName">{homeName}</span>
                </div>

                <ScoreDisplay
                  homeScore={hs}
                  awayScore={as_}
                  minute={minute}
                  isTermine={isTermine}
                />

                {/* Équipe extérieur */}
                <div className="accueil__liveWidgetTeam accueil__liveWidgetTeam--away">
                  {match.awayTeam?.crest
                    ? <img src={match.awayTeam.crest} alt="" className="accueil__liveWidgetCrest" />
                    : <div className="accueil__liveWidgetCrestFallback" />}
                  <span className="accueil__liveWidgetTeamName">{awayName}</span>
                </div>
              </div>

              {(espn?.scorers?.length > 0) && <div className="accueil__liveWidgetDivider" />}
              <ScorerColumns scorers={espn?.scorers ?? []} />
              <StatsBar stats={espn?.stats ?? null} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
