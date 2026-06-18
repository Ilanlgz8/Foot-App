import { useEffect }               from 'react'
import { createPortal }            from 'react-dom'
import { useTeamForm }            from '../hooks/useTeamForm'
import { useMatchDetail }      from '../hooks/useMatchDetail'
import { useEspnMatchDetail }  from '../hooks/useEspnMatchDetail'
import { translateTeam }       from '../data/teamNames'
import { getMatchState }       from '../utils/matchStateTracker'
import './../matchModal.css'

// ── Lecture des données ESPN persistées au moment du FT ──────────────────────
// Sauvegardées par useLiveMinute dans foot_espn_{matchId} lors de la détection FT.
function getEspnData(matchId) {
  if (!matchId) return null
  try {
    const raw = localStorage.getItem(`foot_espn_${matchId}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ── Forme récente (matchs à venir) ──────────────────────────────────────────
function FormBadge({ result }) {
  const label = result === 'W' ? 'V' : result === 'D' ? 'N' : 'D'
  return <span className={`modal__formeBadge modal__formeBadge--${result}`}>{label}</span>
}

// ── Buteurs ESPN (format espnScoresCache.scorers) ────────────────────────────
// ESPN scorers : { name, minute (ex "24:00"), team ('home'|'away'), ownGoal, penaltyKick }
function ESPNScorers({ scorers = [] }) {
  if (scorers.length === 0) return null

  const homeGoals = scorers.filter(s => s.team === 'home')
  const awayGoals = scorers.filter(s => s.team === 'away')
  if (homeGoals.length === 0 && awayGoals.length === 0) return null

  const fmtMin  = (m) => { const base = (m ?? '').split(':')[0]; return base ? `${base}'` : '' }
  const fmtType = (s) => s.ownGoal ? ' (csc)' : s.penaltyKick ? ' (pen)' : ''

  return (
    <div className="modal__stats">
      <div className="modal__statsCol modal__statsCol--home">
        {homeGoals.map((s, i) => (
          <div key={i} className="modal__goalRow">
            <span className="modal__goalName">{s.name}{fmtType(s)}</span>
            <span className="modal__goalMeta">{fmtMin(s.minute)}</span>
            <span className="modal__goalIcon" aria-hidden="true">⚽</span>
          </div>
        ))}
      </div>
      <div className="modal__statsDivider" />
      <div className="modal__statsCol modal__statsCol--away">
        {awayGoals.map((s, i) => (
          <div key={i} className="modal__goalRow modal__goalRow--away">
            <span className="modal__goalIcon" aria-hidden="true">⚽</span>
            <span className="modal__goalMeta">{fmtMin(s.minute)}</span>
            <span className="modal__goalName">{s.name}{fmtType(s)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Stats ESPN (possession, tirs, corners) ───────────────────────────────────
function StatBar({ homeVal, awayVal, label }) {
  const hNum = parseFloat(homeVal) || 0
  const aNum = parseFloat(awayVal) || 0
  const total = hNum + aNum
  const homePct = total === 0 ? 50 : Math.round((hNum / total) * 100)
  return (
    <div className="modal__statBar">
      <span className="modal__statBarVal">{homeVal ?? '–'}</span>
      <div className="modal__statBarTrack">
        <div className="modal__statBarFill modal__statBarFill--home" style={{ width: `${homePct}%` }} />
        <div className="modal__statBarFill modal__statBarFill--away" style={{ width: `${100 - homePct}%` }} />
      </div>
      <span className="modal__statBarVal modal__statBarVal--away">{awayVal ?? '–'}</span>
      <span className="modal__statBarLabel">{label}</span>
    </div>
  )
}

function ESPNStats({ stats }) {
  if (!stats) return null
  const { home: h, away: a } = stats
  const rows = [
    { label: 'Possession', hv: h.poss    != null ? `${h.poss}%`    : null, av: a.poss    != null ? `${a.poss}%`    : null },
    { label: 'Tirs',       hv: h.shots   != null ? `${h.shots}`    : null, av: a.shots   != null ? `${a.shots}`    : null },
    { label: 'Corners',    hv: h.corners != null ? `${h.corners}`  : null, av: a.corners != null ? `${a.corners}`  : null },
  ].filter(r => r.hv != null || r.av != null)

  if (rows.length === 0) return null

  return (
    <div className="modal__espnStats">
      <p className="modal__espnStatsTitle">Statistiques</p>
      {rows.map(({ label, hv, av }) => (
        <StatBar key={label} label={label} homeVal={hv} awayVal={av} />
      ))}
    </div>
  )
}

// ── Timeline des buts FD.org (fallback) ──────────────────────────────────────
function GoalTimeline({ goals = [], homeId }) {
  if (goals.length === 0) return null

  const homeGoals = goals.filter(g => g.team?.id === homeId)
  const awayGoals = goals.filter(g => g.team?.id !== homeId)
  if (Math.max(homeGoals.length, awayGoals.length) === 0) return null

  const goalLabel = (g) => ({
    name: g.scorer?.shortName ?? g.scorer?.name ?? '?',
    min:  g.minute ? `${g.minute}'` : '',
    type: g.type === 'OWN_GOAL' ? ' (csc)' : g.type === 'PENALTY' ? ' (pen)' : '',
  })

  return (
    <div className="modal__stats">
      <div className="modal__statsCol modal__statsCol--home">
        {homeGoals.map((g, i) => {
          const { name, min, type } = goalLabel(g)
          return (
            <div key={i} className="modal__goalRow">
              <span className="modal__goalName">{name}{type}</span>
              <span className="modal__goalMeta">{min}</span>
              <span className="modal__goalIcon" aria-hidden="true">⚽</span>
            </div>
          )
        })}
      </div>
      <div className="modal__statsDivider" />
      <div className="modal__statsCol modal__statsCol--away">
        {awayGoals.map((g, i) => {
          const { name, min, type } = goalLabel(g)
          return (
            <div key={i} className="modal__goalRow modal__goalRow--away">
              <span className="modal__goalIcon" aria-hidden="true">⚽</span>
              <span className="modal__goalMeta">{min}</span>
              <span className="modal__goalName">{name}{type}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Cartons FD.org ────────────────────────────────────────────────────────────
function Bookings({ bookings = [], homeId }) {
  if (bookings.length === 0) return null
  const icon = (card) =>
    card === 'YELLOW_CARD'     ? '🟨' :
    card === 'RED_CARD'        ? '🟥' :
    card === 'YELLOW_RED_CARD' ? '🟨🟥' : '📋'
  const homeCards = bookings.filter(b => b.team?.id === homeId)
  const awayCards = bookings.filter(b => b.team?.id !== homeId)
  if (homeCards.length === 0 && awayCards.length === 0) return null
  return (
    <div className="modal__stats" style={{ marginTop: '0.1rem' }}>
      <div className="modal__statsCol modal__statsCol--home">
        {homeCards.map((b, i) => (
          <div key={i} className="modal__goalRow">
            <span className="modal__goalName">{b.player?.shortName ?? b.player?.name ?? '?'}</span>
            <span className="modal__goalMeta">{b.minute ? `${b.minute}'` : ''}</span>
            <span className="modal__goalIcon">{icon(b.card)}</span>
          </div>
        ))}
      </div>
      <div className="modal__statsDivider" />
      <div className="modal__statsCol modal__statsCol--away">
        {awayCards.map((b, i) => (
          <div key={i} className="modal__goalRow modal__goalRow--away">
            <span className="modal__goalIcon">{icon(b.card)}</span>
            <span className="modal__goalMeta">{b.minute ? `${b.minute}'` : ''}</span>
            <span className="modal__goalName">{b.player?.shortName ?? b.player?.name ?? '?'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section détails match terminé ────────────────────────────────────────────
// Priorité ESPN (persisté en localStorage au FT) → fallback FD.org
function FinishedDetails({ match, espnData, detail, loading }) {
  const homeId     = match.homeTeam?.id
  const totalGoals = (match.score?.fullTime?.home ?? 0) + (match.score?.fullTime?.away ?? 0)

  // ── ESPN : données disponibles (match suivi en live dans cette session ou précédente) ──
  if (espnData) {
    const scorers = espnData.scorers ?? []
    return (
      <>
        {scorers.length > 0
          ? <ESPNScorers scorers={scorers} />
          : <p className="modal__noEvents">
              {totalGoals > 0 ? 'Buteurs non disponibles' : 'Match sans but (0 – 0)'}
            </p>
        }
        <ESPNStats stats={espnData.stats} />
      </>
    )
  }

  // ── FD.org fallback ──
  if (loading) {
    return (
      <div className="modal__state">
        <div className="modal__spinner" />
        Chargement…
      </div>
    )
  }
  if (!detail) {
    return <div className="modal__state">Statistiques non disponibles</div>
  }

  const goals    = detail.goals    ?? []
  const bookings = detail.bookings ?? []
  return (
    <>
      {goals.length > 0
        ? <GoalTimeline goals={goals} homeId={homeId} />
        : <p className="modal__noEvents">
            {totalGoals > 0 ? 'Détail des buts non disponible' : 'Match sans but (0 – 0)'}
          </p>
      }
      {bookings.length > 0 && <Bookings bookings={bookings} homeId={homeId} />}
    </>
  )
}

// ── Modal principale ─────────────────────────────────────────────────────────
function MatchModal({ match, compId, onClose }) {
  const isFinished = match?.status === 'FINISHED' || getMatchState(match?.id).ft === true

  // 1. Données ESPN déjà persistées en localStorage (match suivi en live)
  const cachedEspn = isFinished ? getEspnData(match?.id) : null

  // 2. Si pas en cache → fetch ESPN à la demande (matchs du jour avec STATUS_FINAL)
  const { espnData: fetchedEspn, loading: espnLoading } = useEspnMatchDetail(
    isFinished && !cachedEspn ? match : null,
    isFinished && !cachedEspn ? compId : null,
    isFinished && !cachedEspn
  )
  const espnData = cachedEspn ?? fetchedEspn

  // Forme récente (matchs à venir uniquement)
  const { formMap } = useTeamForm(isFinished ? null : compId)
  // FD.org uniquement si pas de données ESPN (fallback matchs anciens)
  const { detail, loading: detailLoading } = useMatchDetail(
    isFinished && !espnData && !espnLoading ? match?.id : null
  )

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  if (!match) return null

  const homeForm = formMap?.[match.homeTeam?.id] ?? []
  const awayForm = formMap?.[match.awayTeam?.id] ?? []

  const hs  = match.score?.fullTime?.home
  const as_ = match.score?.fullTime?.away
  const hWin = isFinished && hs > as_
  const aWin = isFinished && as_ > hs

  const formatHour = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const formatDate = (d) => {
    const today    = new Date(); today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
    const date     = new Date(d); date.setHours(0,0,0,0)
    if (date.getTime() === today.getTime())    return "Aujourd'hui"
    if (date.getTime() === tomorrow.getTime()) return 'Demain'
    return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  const modal = (
    <div className="modal__overlay" onClick={onClose}>
      <div className="modal__panel" onClick={e => e.stopPropagation()}>

        <button className="modal__close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="modal__header">
          <span className="modal__kicker">{match.competition?.name}</span>
          <span className="modal__journee">Journée {match.matchday}</span>
        </div>

        {/* Équipes + score */}
        <div className="modal__teams">
          <div className="modal__team">
            {match.homeTeam.crest && (
              <img src={match.homeTeam.crest} alt="" className="modal__crest"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <span className="modal__teamName">
              {translateTeam(match.homeTeam.shortName || match.homeTeam.name)}
            </span>
          </div>

          <div className="modal__vs">
            {isFinished ? (
              <div className="modal__scoreboard">
                <span className={`modal__scoreNum ${hWin ? 'modal__scoreNum--win' : ''}`}>{hs}</span>
                <span className="modal__scoreSep">–</span>
                <span className={`modal__scoreNum ${aWin ? 'modal__scoreNum--win' : ''}`}>{as_}</span>
              </div>
            ) : (
              <>
                <span className="modal__date">{formatDate(match.utcDate)}</span>
                <span className="modal__hour">{formatHour(match.utcDate)}</span>
              </>
            )}
            {isFinished && <span className="modal__ftLabel">Terminé</span>}
          </div>

          <div className="modal__team modal__team--away">
            {match.awayTeam.crest && (
              <img src={match.awayTeam.crest} alt="" className="modal__crest"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <span className="modal__teamName">
              {translateTeam(match.awayTeam.shortName || match.awayTeam.name)}
            </span>
          </div>
        </div>

        {/* Contenu selon statut */}
        {isFinished ? (
          <FinishedDetails
            match={match}
            espnData={espnData}
            detail={detail}
            loading={espnLoading || detailLoading}
          />
        ) : (
          (homeForm.length > 0 || awayForm.length > 0) && (
            <div className="modal__formes">
              {homeForm.length > 0 && (
                <div className="modal__forme">
                  <span className="modal__formeLabel">
                    {translateTeam(match.homeTeam.shortName || match.homeTeam.name)}
                  </span>
                  <div className="modal__formeBadges">
                    {homeForm.map((r, i) => <FormBadge key={i} result={r} />)}
                  </div>
                </div>
              )}
              {awayForm.length > 0 && (
                <div className="modal__forme">
                  <span className="modal__formeLabel">
                    {translateTeam(match.awayTeam.shortName || match.awayTeam.name)}
                  </span>
                  <div className="modal__formeBadges">
                    {awayForm.map((r, i) => <FormBadge key={i} result={r} />)}
                  </div>
                </div>
              )}
            </div>
          )
        )}

      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

export default MatchModal
