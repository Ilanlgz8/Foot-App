import { useState, useRef, useEffect } from 'react'
import { translateTeam } from '../data/teamNames'
import { calcMinute } from '../utils/matchUtils'

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

// Formate une date UTC en heure locale "20:45"
function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit'
  })
}

// Construit une classe CSS avec modificateur --winner ou --loser
// Ex: matchClass('accueil__matchCardName', true, false) → "accueil__matchCardName accueil__matchCardName--winner"
function matchClass(base, isWinner, isLoser) {
  if (isWinner) return `${base} ${base}--winner`
  if (isLoser)  return `${base} ${base}--loser`
  return base
}

// ── Skeleton de chargement (3 cartes grises animées) ──
export function PanelSkeleton() {
  return (
    <div className="accueil__matchCards">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="accueil__resultCardSk">
          <div className="accueil__resultCardSkTeam">
            <div className="sk" style={{ width: '2rem', height: '2rem', borderRadius: '50%' }} />
            <div className="sk" style={{ width: '4rem', height: '0.65rem' }} />
          </div>
          <div className="sk" style={{ width: '4rem', height: '2rem', borderRadius: '0.5rem' }} />
          <div className="accueil__resultCardSkTeam">
            <div className="sk" style={{ width: '2rem', height: '2rem', borderRadius: '50%' }} />
            <div className="sk" style={{ width: '4rem', height: '0.65rem' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Carte d'un match ──
// Affiche : logo + nom équipe dom | score/heure/minute | logo + nom équipe ext
// Props :
//   match         → données du match (football-data.org)
//   noWinnerLoser → si true, pas de style gagnant/perdant (ex: dans le widget live)
//   tracked       → si ce match est suivi avec minutes précises
//   onTrack       → callback pour activer/désactiver le suivi (null = bouton caché)
//   espnScore     → { home, away } depuis ESPN (< 10s de délai), ou null
export function MatchCard({ match, noWinnerLoser = false, tracked = false, onTrack = null, espnScore = null }) {
  const isFinished = match.status === 'FINISHED'
  // calcMinute retourne une valeur même si l'API dit brièvement SCHEDULED (timestamps locaux)
  // → on garde l'affichage live tant qu'on a une minute calculable
  const liveMinute = isFinished ? null : calcMinute(match)
  const isLive     = match.status === 'IN_PLAY' || match.status === 'PAUSED' || liveMinute !== null

  // Score : ESPN en priorité (quasi temps réel), sinon football-data.org (~1min de délai)
  const hs  = espnScore?.home ?? match.score?.fullTime?.home ?? match.score?.halfTime?.home
  const as_ = espnScore?.away ?? match.score?.fullTime?.away ?? match.score?.halfTime?.away

  // ── Détection de but ──
  const prevHs   = useRef(null)
  const prevAs   = useRef(null)
  const timerRef = useRef(null)
  const [goal, setGoal] = useState(null) // { team: string } | null

  useEffect(() => {
    if (!isLive) { prevHs.current = null; prevAs.current = null; return }
    if (prevHs.current !== null && hs != null && hs > prevHs.current) {
      setGoal({ team: translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || ''), scoreStr: `${hs} – ${as_ ?? 0}` })
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setGoal(null), 5200)
    } else if (prevAs.current !== null && as_ != null && as_ > prevAs.current) {
      setGoal({ team: translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || ''), scoreStr: `${hs ?? 0} – ${as_}` })
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setGoal(null), 5200)
    }
    if (hs  != null) prevHs.current = hs
    if (as_ != null) prevAs.current = as_
  }, [hs, as_, isLive])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  // Qui a gagné ? (uniquement pour les matchs terminés, et si noWinnerLoser est false)
  const homeWins = !noWinnerLoser && isFinished && hs != null && as_ != null && hs > as_
  const awayWins = !noWinnerLoser && isFinished && hs != null && as_ != null && as_ > hs

  // Texte affiché au centre :
  //   - Match à venir   → heure (ex: "20:45")
  //   - Match terminé   → "FT"
  //   - Match en cours  → minute calculée (ex: "73'" ou "MT") via calcMinute()
  const label     = isFinished ? 'FT' : !isLive ? formatHour(match.utcDate) : null

  // Classes CSS avec modificateur gagnant/perdant sur les noms et blasons
  const homeNameCls  = matchClass('accueil__matchCardName',  homeWins, awayWins)
  const awayNameCls  = matchClass('accueil__matchCardName',  awayWins, homeWins)
  const homeCrestCls = matchClass('accueil__matchCardCrest', false,    awayWins)  // blason perdant → grisé
  const awayCrestCls = matchClass('accueil__matchCardCrest', false,    homeWins)

  return (
    <div className={`accueil__matchCard${isLive ? ' accueil__matchCard--live' : ''}${goal ? ' accueil__matchCard--goal' : ''}`}>
      {goal && <GoalCelebration teamName={goal.team} scoreStr={goal.scoreStr} />}

      {/* Équipe domicile */}
      <div className="accueil__matchCardTeam">
        <div className="accueil__matchCardCrestWrap">
          {match.homeTeam?.crest
            ? <img src={match.homeTeam.crest} alt="" className={homeCrestCls}
                onError={e => e.currentTarget.style.display = 'none'} />
            : <div className="accueil__matchCardCrestEmpty" />}
        </div>
        <span className={homeNameCls}>
          {translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')}
        </span>
      </div>

      {/* Centre : minute/heure/FT + score */}
      <div className="accueil__matchCardCenter">
        <div className="accueil__matchCardLabelRow">
          {isLive && <span className="accueil__matchCardLiveDot" />}
          <span className={`accueil__matchCardLabel${isLive ? ' accueil__matchCardLabel--live' : ''}`}>
            {isLive ? (liveMinute ?? 'En cours') : label}
          </span>
        </div>
        <span className={`accueil__matchCardValue${isLive ? ' accueil__matchCardValue--live' : ''}`}>
          {/* Match en cours ou terminé → score | À venir → heure */}
          {(isLive || isFinished) ? `${hs ?? 0} – ${as_ ?? 0}` : formatHour(match.utcDate)}
        </span>
      </div>

      {/* Équipe extérieure */}
      <div className="accueil__matchCardTeam accueil__matchCardTeam--away">
        <div className="accueil__matchCardCrestWrap">
          {match.awayTeam?.crest
            ? <img src={match.awayTeam.crest} alt="" className={awayCrestCls}
                onError={e => e.currentTarget.style.display = 'none'} />
            : <div className="accueil__matchCardCrestEmpty" />}
        </div>
        <span className={awayNameCls}>
          {translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')}
        </span>
      </div>

      {/* Bouton "Suivre" — visible uniquement si onTrack est fourni et match pas terminé */}
      {onTrack && !isFinished && (
        <button
          className={`accueil__matchCardTrack${tracked ? ' accueil__matchCardTrack--on' : ''}`}
          onClick={e => { e.stopPropagation(); onTrack() }}
          title={tracked ? 'Désactiver le suivi précis' : 'Suivre avec minutes précises'}
        >
          {tracked ? '📍 Suivi' : '📍 Suivre'}
        </button>
      )}
    </div>
  )
}

// ── Liste des matchs du jour ──
// Affiche en priorité les matchs non terminés, sinon tous les matchs
export function MatchPanel({ matches: allMatches, loading, espnScores = {}, trackedIds, onTrack, totalMatchCount = 0 }) {
  // Si des matchs sont en cours ou à venir → les afficher en priorité
  // Sinon (tous terminés) → afficher quand même les résultats du jour
  const active    = allMatches.filter(m => m.status !== 'FINISHED')
  const displayed = active.length > 0 ? active : allMatches

  return (
    <div className="accueil__dashPanelBody">
      {loading && <PanelSkeleton />}
      {!loading && displayed.length === 0 && (
        <p className="accueil__tickerEmpty">Aucun match aujourd'hui.</p>
      )}
      {!loading && displayed.length > 0 && (
        <div className="accueil__matchCards">
          {displayed.map(match => {
            const isTracked     = trackedIds?.has(String(match.id)) ?? false
            const limitAtteinte = !isTracked && (trackedIds?.size ?? 0) >= 5
            // Bouton Suivre visible si : >5 matchs ce jour ET (déjà suivi OU limite pas atteinte)
            const showTrack = totalMatchCount > 5 && onTrack && (isTracked || !limitAtteinte)
            return (
              <MatchCard
                key={match.id}
                match={match}
                espnScore={espnScores[match.id] ?? null}
                tracked={isTracked}
                onTrack={showTrack ? () => onTrack(match.id) : null}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
