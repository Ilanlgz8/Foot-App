// LivePulse — "pouls collectif" : pronostic des fans (vote anonyme 1/X/2,
// verrouillé au coup d'envoi) + réactions emoji en direct. Partagé entre
// MatchPage.jsx (matchs à venir/terminés) et LiveMatchPage.jsx (matchs en
// direct — réactions actives en plus du pronostic figé).
import { useState, useCallback } from 'react'
import { usePulse } from '../hooks/usePulse'
import '../livePulse.css'

const REACTION_EMOJIS = ['⚽', '🔥', '😱', '👏', '😡']

function pct(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

/**
 * @param {string|number} matchId
 * @param {string} homeShort / awayShort — noms courts déjà traduits (FR)
 * @param {boolean} locked         true = vote fermé (match déjà commencé), lecture seule
 * @param {boolean} showReactions  true = affiche la ligne de réactions emoji (LiveMatchPage uniquement)
 */
export function LivePulse({ matchId, homeShort, awayShort, locked = false, showReactions = false }) {
  const { votes, reactions, myVote, vote, react } = usePulse(matchId, !!matchId)
  const [bursts, setBursts] = useState([])

  const handleReact = useCallback((emoji) => {
    react(emoji)
    const id = Date.now() + Math.random()
    setBursts(b => [...b, { id, emoji }])
    setTimeout(() => setBursts(b => b.filter(x => x.id !== id)), 900)
  }, [react])

  if (!matchId) return null

  const { home, draw, away, total } = votes
  const hasVotes = total > 0
  const homePct = hasVotes ? pct(home, total) : 33
  const drawPct = hasVotes ? pct(draw, total) : 34
  const awayPct = hasVotes ? pct(away, total) : 33
  const canVote = !locked

  return (
    <div className="pulse">
      <div className="pulse__header">
        <span className="pulse__title">
          <span className="pulse__dot" aria-hidden="true" />
          Pronostic des fans
        </span>
        {hasVotes && <span className="pulse__count">{total.toLocaleString('fr-FR')} avis</span>}
      </div>

      <div className="pulse__bar" role="group" aria-label="Voter pour un résultat">
        <button
          type="button"
          className={`pulse__seg pulse__seg--home${myVote === 'home' ? ' pulse__seg--mine' : ''}`}
          style={{ '--pulse-w': homePct }}
          onClick={() => canVote && vote('home')}
          disabled={!canVote}
        >
          {hasVotes && <span className="pulse__pct">{homePct}%</span>}
        </button>
        <button
          type="button"
          className={`pulse__seg pulse__seg--draw${myVote === 'draw' ? ' pulse__seg--mine' : ''}`}
          style={{ '--pulse-w': drawPct }}
          onClick={() => canVote && vote('draw')}
          disabled={!canVote}
        >
          {hasVotes && <span className="pulse__pct pulse__pct--draw">{drawPct}%</span>}
        </button>
        <button
          type="button"
          className={`pulse__seg pulse__seg--away${myVote === 'away' ? ' pulse__seg--mine' : ''}`}
          style={{ '--pulse-w': awayPct }}
          onClick={() => canVote && vote('away')}
          disabled={!canVote}
        >
          {hasVotes && <span className="pulse__pct">{awayPct}%</span>}
        </button>
      </div>

      <div className="pulse__labels">
        <span className={myVote === 'home' ? 'pulse__label--mine' : ''}>{homeShort}</span>
        <span className={myVote === 'draw' ? 'pulse__label--mine' : ''}>Nul</span>
        <span className={myVote === 'away' ? 'pulse__label--mine' : ''}>{awayShort}</span>
      </div>

      {!hasVotes && (
        <p className="pulse__hint">
          {canVote ? 'Sois le premier à donner ton pronostic' : 'Pas encore de pronostic des fans pour ce match'}
        </p>
      )}
      {locked && hasVotes && (
        <p className="pulse__hint pulse__hint--locked">Clôturé au coup d'envoi</p>
      )}

      {showReactions && (
        <div className="pulse__reactions">
          {REACTION_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              className="pulse__reactionBtn"
              onClick={() => handleReact(emoji)}
            >
              {bursts.filter(b => b.emoji === emoji).map(b => (
                <span key={b.id} className="pulse__burst" aria-hidden="true">{emoji}</span>
              ))}
              <span className="pulse__reactionEmoji">{emoji}</span>
              <span className="pulse__reactionCount">{reactions[emoji] ?? 0}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
