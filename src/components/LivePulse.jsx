// LivePulse — "pouls collectif" : pronostic des fans (vote anonyme 1/X/2,
// verrouillé au coup d'envoi) + réactions emoji en direct. Remplace
// l'ancienne barre de probabilité algorithmique (PronoSection/PmPronoSection,
// retirée) dans les vues détail de match — celle-ci reste visible sur
// l'Accueil (carte "Match du jour", MatchPoster.jsx), pas besoin de la
// répéter ici. Style "segmented control" (3 boutons distincts) plutôt qu'une
// barre continue — chaque choix se tape individuellement.
import { useState, useCallback, useEffect } from 'react'
import { usePulse, useLeaderboard } from '../hooks/usePulse'
import '../livePulse.css'

const CORRECT_POINTS = 10 // doit rester synchro avec api/pulse.js (CORRECT_POINTS)

function pct(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

/**
 * @param {string|number} matchId
 * @param {string} homeShort / awayShort — noms courts déjà traduits (FR)
 * @param {boolean} locked         true = vote fermé (match déjà commencé), lecture seule
 * @param {boolean} showReactions  true = affiche la ligne de réactions emoji (matchs en direct uniquement)
 * @param {'home'|'draw'|'away'|null} result  résultat réel (matchOutcome()) une fois le match terminé
 *   — déclenche la clôture du pronostic (points + classement) et affiche le score de précision.
 * @param {string|null} kickoffAt  match.utcDate (ISO) — transmis au serveur pour verrouiller le
 *   vote après le coup d'envoi, même si l'UI (locked) était contournée.
 */
export function LivePulse({ matchId, homeShort, awayShort, locked = false, showReactions = false, result = null, kickoffAt = null }) {
  const { votes, reactions, myVote, vote, react, resolve } = usePulse(matchId, !!matchId)
  const [bursts, setBursts] = useState([])
  const [showBoard, setShowBoard] = useState(false)
  const { top, me, isLoading: boardLoading } = useLeaderboard(showBoard)

  // Résultat connu (match terminé) + un vote a été posé → clôture le
  // pronostic côté serveur (idempotent, sûr à rappeler à chaque render).
  useEffect(() => {
    if (result && myVote) resolve(result)
  }, [result, myVote, resolve])

  // Calcul optimiste immédiat (pas besoin d'attendre le round-trip serveur
  // pour afficher juste/faux — même logique "optimiste" que vote()/react()).
  const matchCorrect = result && myVote ? myVote === result : null

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
      onClick={() => canVote && vote(key, kickoffAt)}
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
      {locked && hasVotes && matchCorrect === null && (
        <p className="pulse__hint pulse__hint--locked">Clôturé au coup d'envoi</p>
      )}

      {matchCorrect !== null && (
        <p className={`pulse__resultBanner${matchCorrect ? ' pulse__resultBanner--win' : ' pulse__resultBanner--lose'}`}>
          {matchCorrect ? `Pronostic juste — +${CORRECT_POINTS} points` : 'Pronostic manqué cette fois'}
        </p>
      )}

      {matchCorrect !== null && (
        <button type="button" className="pulse__boardToggle" onClick={() => setShowBoard(s => !s)}>
          {showBoard ? 'Masquer le classement' : 'Voir le classement des pronostiqueurs'}
        </button>
      )}

      {showBoard && (
        <div className="pulse__board">
          {boardLoading ? (
            <p className="pulse__hint">Chargement…</p>
          ) : (
            <>
              <ol className="pulse__boardList">
                {top.length === 0 && <li className="pulse__hint">Pas encore de classement</li>}
                {top.map((p, i) => (
                  <li key={p.deviceId} className="pulse__boardRow">
                    <span className="pulse__boardRank">{i + 1}</span>
                    <span className="pulse__boardName">Fan #{p.deviceId.slice(-4)}</span>
                    <span className="pulse__boardPts">{p.points} pts</span>
                  </li>
                ))}
              </ol>
              {me && (
                <p className="pulse__boardMe">
                  Toi : {me.rank ? `#${me.rank}` : 'non classé'} · {me.points} pts · {me.correct}/{me.total} pronos justes
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
