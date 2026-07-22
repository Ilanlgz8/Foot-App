/**
 * LiveCardWidget.jsx — widget "match en direct" (crest + nom + score +
 * minute + statut, détection de but avec animation).
 *
 * Extrait de Live.jsx (demande utilisateur : réutiliser EXACTEMENT ce widget
 * dans la nouvelle grille "En direct" de l'Accueil desktop — voir
 * Accueil.jsx). Vit dans son propre fichier plutôt que d'être importé
 * directement depuis Live.jsx car Live.jsx est lazy-loadée par route dans
 * App.jsx (React.lazy) — un import statique depuis Accueil.jsx aurait cassé
 * ce code-splitting (avertissement Vite "INEFFECTIVE_DYNAMIC_IMPORT" observé
 * au build : tout le code de la PAGE /live, y compris son composant par
 * défaut, se serait retrouvé embarqué dans le bundle de l'Accueil). Live.jsx
 * importe maintenant LiveCard depuis ici, exactement comme avant côté
 * comportement/rendu — zéro changement fonctionnel, seulement l'emplacement
 * du code.
 */
import { useState, useRef, useEffect } from 'react'
import { getMatchState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, isNationalTeamComp } from '../utils/matchUtils'
import { translateTeam } from '../data/teamNames'
import { TEAM_SHORT } from '../data/teamShortNames'
import '../live.css'

function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 13) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0]}. ${words.slice(1).join(' ')}`
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
// Utilisée par Live.jsx (page /live, grille complète) ET Accueil.jsx (grille
// "En direct" desktop, voir accueil__liveWidgetsGrid) — comportement/rendu
// strictement identique dans les deux contextes.
export function LiveCard({ match, espn, onClick }) {
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
          affiché une seule fois par section (voir groupByCompetition, Live.jsx) */}
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
