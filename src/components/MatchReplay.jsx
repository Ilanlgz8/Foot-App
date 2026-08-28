import { useState, useEffect, useRef } from 'react'

/**
 * MatchReplay — relit un match terminé événement par événement (buts/
 * cartons), minute par minute, à vitesse réglable. Demande utilisateur
 * (28/08) : bouton "Rejouer" sous le score final, sur la fiche d'un match
 * cliqué depuis Résultats/ResultPanel (MatchPageHero, MatchPage.jsx).
 *
 * Aucune nouvelle source de données : réutilise homeEvents/awayEvents déjà
 * calculés par buildMatchEvents (MatchModal.jsx, à partir des scorers/cards
 * ESPN déjà chargés pour l'affichage "Buts + cartons" du hero) — juste
 * rejoués dans le temps au lieu d'affichés d'un coup. Le score affiché est
 * RECALCULÉ à chaque minute (en comptant les buts déjà "passés" dans la
 * relecture) plutôt que stocké séparément — aucun risque de désynchro avec
 * le score final réel, toujours dérivé des mêmes événements.
 */
const SPEEDS = [1, 3, 8]
const TICK_MS = 400

export function MatchReplay({ homeEvents, awayEvents, homeName, awayName, wentToAet, pens }) {
  const merged = [
    ...(homeEvents ?? []).map(e => ({ ...e, side: 'home' })),
    ...(awayEvents ?? []).map(e => ({ ...e, side: 'away' })),
  ].sort((a, b) => a.sort - b.sort)

  const lastEventMinute = merged.reduce((max, e) => Math.max(max, e.sort), 0)
  const maxMinute = Math.ceil(Math.max(wentToAet ? 120 : 90, lastEventMinute) + 3)

  const [minute, setMinute] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const timerRef = useRef(null)

  useEffect(() => {
    clearInterval(timerRef.current)
    if (!playing) return undefined
    timerRef.current = setInterval(() => {
      setMinute(m => {
        if (m >= maxMinute) { setPlaying(false); return maxMinute }
        return m + 1
      })
    }, TICK_MS / speed)
    return () => clearInterval(timerRef.current)
  }, [playing, speed, maxMinute])

  const visible = merged.filter(e => e.sort <= minute)
  const score = visible.reduce((acc, e) => {
    if (e.icon === '⚽') acc[e.side] += 1
    return acc
  }, { home: 0, away: 0 })

  return (
    <div className="mp__replay">
      <div className="mp__replayTop">
        <span className="mp__replayMinute">{Math.round(minute)}'</span>
      </div>

      <div className="mp__replayScore">{score.home} - {score.away}</div>

      <div className="mp__replayTrack">
        <div className="mp__replayTrackFill" style={{ width: `${(minute / maxMinute) * 100}%` }} />
      </div>
      <input
        type="range" min={0} max={maxMinute} step={1} value={minute}
        className="mp__replaySeek"
        onChange={e => { setMinute(Number(e.target.value)); setPlaying(false) }}
        aria-label="Avancer dans le match"
      />

      <div className="mp__replayControls">
        <button
          type="button" className="mp__replayBtn"
          onClick={() => setPlaying(p => !p)}
          aria-label={playing ? 'Pause' : 'Lecture'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button" className="mp__replayBtn"
          onClick={() => { setMinute(0); setPlaying(false) }}
          aria-label="Recommencer"
        >
          ↻
        </button>
        <div className="mp__replaySpeeds">
          {SPEEDS.map(s => (
            <button
              key={s} type="button"
              className={`mp__replaySpeedBtn${s === speed ? ' mp__replaySpeedBtn--active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {minute >= maxMinute && pens && (
        <p className="mp__replayPens">Tirs au but : {pens.home}-{pens.away}</p>
      )}

      <div className="mp__replayFeed">
        {visible.length === 0 && (
          <p className="mp__replayFeedEmpty">{homeName} – {awayName}, coup d'envoi…</p>
        )}
        {[...visible].reverse().map(e => (
          <div key={e.key} className={`mp__replayFeedRow mp__replayFeedRow--${e.side}`}>
            <span className="mp__replayFeedIcon" aria-hidden="true">{e.icon}</span>
            <span className="mp__replayFeedName">{e.name}</span>
            <span className="mp__replayFeedMin">{e.minute}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
