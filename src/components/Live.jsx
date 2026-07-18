import { useNavigate } from 'react-router-dom'
import { useLiveData } from '../context/LiveProvider'
import { getMatchState, isRecentlyFinished } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod, mergeScore, finalScore , isNationalTeamComp } from '../utils/matchUtils'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'
import { TEAM_SHORT } from '../data/teamShortNames'
import { useState, useRef, useEffect } from 'react'
import '../live.css'

function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 13) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0]}. ${words.slice(1).join(' ')}`
}

// Regroupe les matchs live par championnat — un seul badge compétition par
// section au lieu d'un par card (redondant).
// Ordre (retour utilisateur) : Coupe du Monde toujours en tête (pas un
// "championnat" club à proprement parler), puis Ligue 1 en premier parmi les
// championnats club, puis le reste par ordre alphabétique.
const SECTION_PRIORITY = { WC: 0, FL1: 1 }
function groupByCompetition(matches) {
  const map = new Map()
  for (const m of matches) {
    const code   = m.competition?.code ?? 'AUTRE'
    const comp   = COMPETITIONS.find(c => c.id === code)
    const name   = comp?.name ?? m.competition?.name ?? 'Autre compétition'
    const emblem = comp?.emblem ?? m.competition?.emblem ?? null
    if (!map.has(code)) map.set(code, { code, name, emblem, matches: [] })
    map.get(code).matches.push(m)
  }
  return [...map.values()].sort((a, b) => {
    const pa = SECTION_PRIORITY[a.code] ?? 2
    const pb = SECTION_PRIORITY[b.code] ?? 2
    if (pa !== pb) return pa - pb
    return a.name.localeCompare(b.name, 'fr')
  })
}

function PeriodBadge({ match }) {
  const period = getMatchPeriod(match)
  if (!period) return null
  return <span className="live__period">{period}</span>
}

function ScoreDisplay({ homeScore, awayScore, minute, isTermine, repriseImminente, repriseDans, goalSide }) {
  const h = homeScore ?? '-'
  const a = awayScore ?? '-'
  const label = isTermine ? 'Terminé' : (minute ?? '–')
  const pillCls = `live__pill${isTermine ? ' live__pill--ft' : ''}`
  return (
    <div className="live__scoreWrap">
      <div className="live__minuteWrap">
        <span className="live__minute">{label}</span>
      </div>
      {(repriseImminente || repriseDans != null) && (
        <span className="live__reprise">
          {repriseImminente ? 'Reprise imm.' : `Reprise ${repriseDans}min`}
        </span>
      )}
      <div className="live__pills">
        <div className={`${pillCls}${goalSide === 'home' ? ' live__pill--scored' : ''}`} key={`h${h}`}>{h}</div>
        <div className="live__pillBar" />
        <div className={`${pillCls}${goalSide === 'away' ? ' live__pill--scored' : ''}`} key={`a${a}`}>{a}</div>
      </div>
    </div>
  )
}

function ScorerColumns({ scorers = [] }) {
  const homeGoals = scorers.filter(s => s.team === 'home')
  const awayGoals = scorers.filter(s => s.team === 'away')
  if (!homeGoals.length && !awayGoals.length) return null
  const suffix = s => s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''
  return (
    <div className="live__scorers">
      <div className="live__scorersHome">
        {homeGoals.map((s, i) => (
          <div key={i} className="live__scorerItem">
            <span className="live__scorerName">{s.name}{suffix(s)}</span>
            {s.minute && <span className="live__scorerMin">{s.minute}</span>}
          </div>
        ))}
      </div>
      <div className="live__scorersGap" />
      <div className="live__scorersAway">
        {awayGoals.map((s, i) => (
          <div key={i} className="live__scorerItem">
            <span className="live__scorerName">{s.name}{suffix(s)}</span>
            {s.minute && <span className="live__scorerMin">{s.minute}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Animation BUT ────────────────────────────────────────────────────────────
function GoalCelebration({ teamName, scoreStr }) {
  return (
    <div className="goal__overlay" aria-hidden="true">
      <span className="goal__text">BUT !</span>
      <div className="goal__line" />
      {teamName && <span className="goal__team">{teamName}</span>}
      {scoreStr  && <span className="goal__score">{scoreStr}</span>}
    </div>
  )
}

// ── Card match individuelle ───────────────────────────────────────────────────
function LiveCard({ match, espn, onClick }) {
  const matchSt = getMatchState(match.id)
  const isTermine = matchSt.ft === true

  // Ticker : force un re-render toutes les 5s pour que calcMinute() avance
  // en temps réel entre les polls ESPN (interpolation sans limite après background)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (isTermine) return
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [isTermine])

  const minute = isTermine ? null : calcMinute(match)
  // Reprise : match en pause selon FD.org OU ESPN → déclenche le compte à rebours
  const isHalftime = match.status === 'PAUSED' || matchSt.espnStatus === 'STATUS_HALFTIME'
  // Une seule valeur, utilisée de façon cohérente pour tout ce render — le
  // ticker 5s ci-dessus force le prochain recalcul, pas besoin de plus.
  const pauseElapsed = (isHalftime && matchSt.pausedAt && !matchSt.half2Start)
    // eslint-disable-next-line react-hooks/purity
    ? Date.now() - matchSt.pausedAt : null
  const repriseImminente = pauseElapsed != null && pauseElapsed >= 15 * 60_000
  const repriseDans = pauseElapsed != null && pauseElapsed < 15 * 60_000
    ? Math.max(1, Math.ceil((15 * 60_000 - pauseElapsed) / 60_000)) : null
  const fsLiveCard = finalScore(match.score)
  const hs = mergeScore(espn?.home, fsLiveCard.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, fsLiveCard.away ?? match.score?.halfTime?.away)
  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))

  // ── Détection de but ──
  const scoreKey = `foot_lv_score_${match.id}` // clé séparée de MatchCard et LiveWidget
  const prevHs   = useRef(null)
  const prevAs   = useRef(null)
  const timerRef = useRef(null)
  const [goal, setGoal] = useState(null)

  const initDone = useRef(false)
  if (!initDone.current) {
    initDone.current = true
    try {
      const s = JSON.parse(localStorage.getItem(scoreKey) || 'null')
      if (s?.home != null) prevHs.current = s.home
      if (s?.away != null) prevAs.current = s.away
    } catch {}
  }

  const isLive = !isTermine && (match.status === 'IN_PLAY' || match.status === 'PAUSED' || minute !== null)
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)

  useEffect(() => {
    if (!isLive) { prevHs.current = null; prevAs.current = null; return }
    // But annulé (VAR/hors-jeu) → score redescend → effacer immédiatement
    if (
      (prevHs.current !== null && hs != null && hs < prevHs.current) ||
      (prevAs.current !== null && as_ != null && as_ < prevAs.current)
    ) {
      clearTimeout(timerRef.current)
      setGoal(null)
      if (hs  != null) prevHs.current = hs
      if (as_ != null) prevAs.current = as_
      return
    }

    const homeGoals = (prevHs.current != null && hs != null) ? hs - prevHs.current : 0
    const awayGoals = (prevAs.current != null && as_ != null) ? as_ - prevAs.current : 0

    const fireGoal = (side, scoreStr, delay = 0) => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const team = side === 'home'
          ? translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '')
          : translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '')
        setGoal({ team, scoreStr, side })
        timerRef.current = setTimeout(() => setGoal(null), 5200)
      }, delay)
    }

    if (homeGoals > 0 && prevHs.current != null) {
      const firstScore = homeGoals >= 2
        ? `${prevHs.current + 1} – ${as_ ?? prevAs.current ?? 0}`
        : `${hs} – ${as_ ?? 0}`
      fireGoal('home', firstScore)
      if (homeGoals >= 2) fireGoal('home', `${hs} – ${as_ ?? 0}`, 5400)
    } else if (awayGoals > 0 && prevAs.current != null) {
      const firstScore = awayGoals >= 2
        ? `${hs ?? prevHs.current ?? 0} – ${prevAs.current + 1}`
        : `${hs ?? 0} – ${as_}`
      fireGoal('away', firstScore)
      if (awayGoals >= 2) fireGoal('away', `${hs ?? 0} – ${as_}`, 5400)
    }

    if (hs  != null) prevHs.current = hs
    if (as_ != null) prevAs.current = as_
    if (hs != null && as_ != null) {
      try { localStorage.setItem(scoreKey, JSON.stringify({ home: hs, away: as_ })) } catch {}
    }
    // Deps volontairement restreintes (même raison que MatchCard.jsx) : détection
    // "le score vient d'augmenter" via comparaison à prevHs/prevAs.current, ne doit
    // se déclencher QUE sur un vrai changement de score/statut live — ajouter les
    // noms d'équipe redéclencherait l'effet sans nouveau but, sans les rendre plus
    // à jour (déjà lus via closure au bon moment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hs, as_, isLive])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <div
      className={`live__card${goal ? ' live__card--goal' : ''}`}
      onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      {goal && <GoalCelebration teamName={goal.team} scoreStr={goal.scoreStr} />}

      {/* Header : période seulement — le badge compétition est maintenant
          affiché une seule fois par section (voir groupByCompetition) */}
      <div className="live__cardHeader--periodOnly">
        <PeriodBadge match={match} />
      </div>

      {/* Score principal — 3 colonnes: home | score | away */}
      <div className="live__matchRow">
        <div className="live__team">
          {match.homeTeam?.crest
            ? <div className="live__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="live__crest" data-team={match.homeTeam?.name} /></div>
            : <div className="live__crestFallback">{homeName?.[0] ?? ''}</div>}
          <span className="live__teamName">{homeName}</span>
        </div>

        <ScoreDisplay
          homeScore={hs} awayScore={as_}
          minute={minute} isTermine={isTermine}
          repriseImminente={repriseImminente}
          repriseDans={repriseDans}
          goalSide={goal?.side ?? null}
        />

        <div className="live__team live__team--away">
          {match.awayTeam?.crest
            ? <div className="live__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="live__crest" data-team={match.awayTeam?.name} /></div>
            : <div className="live__crestFallback">{awayName?.[0] ?? ''}</div>}
          <span className="live__teamName">{awayName}</span>
        </div>
      </div>

      {/* Buteurs */}
      {(espn?.scorers?.length > 0) && <div className="live__divider" />}
      <ScorerColumns scorers={espn?.scorers ?? []} />

      {/* CTA explicite — avant, seule la card entière était cliquable sans
          aucun indice visuel permanent (juste un hover, invisible au tactile).
          Retour utilisateur : accès à LiveMatchPage pas assez clair. */}
      <div className="live__cardFooter">
        Voir le match <span className="live__cardFooterChevron">›</span>
      </div>
    </div>
  )
}

// ── Page Live ─────────────────────────────────────────────────────────────────
export default function Live() {
  const navigate = useNavigate()
  const { liveMatches, espnScores } = useLiveData()

  // Ticker dédié : force un re-render toutes les secondes tant qu'un match
  // vient de passer "Terminé" (fenêtre de grâce, voir isRecentlyFinished) —
  // sans ça, rien ne déclenche le retrait de la card une fois la fenêtre
  // passée (le ticker interne de LiveCard s'arrête lui-même dès isTermine).
  // S'arrête tout seul dès qu'il n'y a plus aucun match dans la fenêtre.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!liveMatches.some(m => isRecentlyFinished(m.id))) return
    const id = setInterval(() => {
      forceTick(n => n + 1)
      if (!liveMatches.some(m => isRecentlyFinished(m.id))) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [liveMatches])

  const live = liveMatches.filter(m =>
    m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'SCHEDULED' || isRecentlyFinished(m.id)
  )

  return (
    <section className="live__page">
      <div className="live__pageInner">

        {/* Header */}
        <div className="live__pageHeader">
          <button className="live__backBtn" onClick={() => navigate(-1)}>
            ‹ Retour
          </button>
          <div className="live__pageTitleWrap">
            <span className="live__pageDot" />
            <h1 className="live__pageTitle">En Direct</h1>
            <span className="live__pageCount">{live.length}</span>
          </div>
        </div>

        {/* Grille */}
        {live.length === 0 ? (
          <div className="live__empty">
            <span className="live__emptyIcon" aria-hidden="true">⚽</span>
            <p className="live__emptyTitle">Aucun match en direct</p>
            <p className="live__emptyHint">Reviens à l'heure du coup d'envoi pour suivre les scores en temps réel.</p>
            <button className="live__emptyCta" onClick={() => navigate('/matchs')}>
              Voir le programme →
            </button>
          </div>
        ) : (
          groupByCompetition(live).map(group => (
            <div key={group.code} className="live__section">
              <div className="live__sectionHeader">
                {group.emblem && <img src={group.emblem} alt="" className="live__sectionLogo" />}
                <span className="live__sectionName">{group.name}</span>
                <span className="live__sectionCount">{group.matches.length} en direct</span>
              </div>
              <div className="live__grid">
                {group.matches.map(match => (
                  <LiveCard
                    key={match.id}
                    match={match}
                    espn={espnScores[match.id] ?? null}
                    onClick={() => navigate(`/live/${match.id}`)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
