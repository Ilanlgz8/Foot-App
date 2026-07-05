// LivePulse — "pouls collectif" : pronostic des fans (vote anonyme 1/X/2,
// verrouillé au coup d'envoi) + réactions emoji en direct. Remplace
// l'ancienne barre de probabilité algorithmique (PronoSection/PmPronoSection,
// retirée) dans les vues détail de match — celle-ci reste visible sur
// l'Accueil (carte "Match du jour", MatchPoster.jsx), pas besoin de la
// répéter ici. Style "segmented control" (3 boutons distincts) plutôt qu'une
// barre continue — chaque choix se tape individuellement.
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
 * @param {boolean} showReactions  true = affiche la ligne de réactions emoji (matchs en direct uniquement)
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
  const homePct = hasVotes ? pct(home, total) : null
  const drawPct = hasVotes ? pct(draw, total) : null
  const awayPct = hasVotes ? pct(away, total) : null
  const canVote = !locked

  const choice = (key, label, value) => (
    <button
      type="button"
      className={`pulse__choice pulse__choice--${key}${myVote === key ? ' pulse__choice--mine' : ''}`}
      onClick={() => canVote && vote(key)}
      disabled={!canVote}
    >
      <span className="pulse__choiceLabel">{label}</span>
      {value != null && <span className="pulse__choicePct">{value}%</span>}
    </button>
  )

  return (
    <div className="pulse">
      <div className="pulse__header">
        <span className="pulse__title">
          <span className="pulse__dot" aria-hidden="true" />
          Pronostic des fans
        </span>
        {hasVotes && <span className="pulse__count">{total.toLocaleString('fr-FR')} avis</span>}
      </div>

      <div className="pulse__choices" role="group" aria-label="Voter pour un résultat">
        {choice('home', homeShort, homePct)}
        {choice('draw', 'Nul', drawPct)}
        {choice('away', awayShort, awayPct)}
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
