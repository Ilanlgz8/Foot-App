import { useState, useRef, useEffect } from 'react'
import { translateTeam } from '../data/teamNames'
import { calcMinute, mergeScore } from '../utils/matchUtils'
import { notifyGoal } from '../utils/notifications'
import { getMatchState } from '../utils/matchStateTracker'
import { MatchPoster } from './MatchPoster'
import { getMatchGradient } from '../data/teamPhotos'

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
//   noGradient    → si true, pas de dégradé couleurs équipes en fond (ex: panel Résultats)
export function MatchCard({ match, noWinnerLoser = false, tracked = false, onTrack = null, espnScore = null, noAnimation = false, isTermine = false, noLive = false, noGradient = false }) {
  // FD.org a 1-5min de retard sur les FT → si ESPN a déjà détecté la fin du match
  // (flag ft dans localStorage), on traite le match comme terminé immédiatement
  // au lieu d'attendre la mise à jour FD.org. Affiche "FT" + arrête le compteur.
  // isFinished : ft local (confirmé par ESPN) OU FD.org FINISHED, SAUF si ESPN confirme
  // toujours un match en cours (STATUS_IN_PROGRESS/HALFTIME) → priorité ESPN pour éviter
  // d'afficher "FT" sur un faux STATUS_FINAL FIFA propagé à FD.org en cours de match.
  const _ms      = getMatchState(match.id)
  const _espnLive = (
    _ms.espnStatus === 'STATUS_IN_PROGRESS' ||
    _ms.espnStatus === 'STATUS_HALFTIME'    ||
    _ms.espnStatus === 'STATUS_END_PERIOD'
  )
  const isFinished = _ms.ft === true || (match.status === 'FINISHED' && !_espnLive)
  const liveMinute = isFinished ? null : calcMinute(match)
  // noLive = true → jamais de mode live (MatchPanel). isLive uniquement dans LiveWidget.
  const isLive     = !noLive && !isFinished && (
    match.status === 'IN_PLAY' ||
    match.status === 'PAUSED'  ||
    liveMinute !== null
  )

  // Countdown mi-temps : "15 min" → "1 min" → "Reprise immédiate"
  const [htLabel, setHtLabel] = useState(null)
  useEffect(() => {
    if (liveMinute !== 'MT') { setHtLabel(null); return }
    const compute = () => {
      const state = getMatchState(match.id)
      // Arrêter le décompte si la 2ème MT a démarré
      if (!state.pausedAt || state.half2Start) { setHtLabel(null); return }
      const elapsed = Date.now() - state.pausedAt
      const remMin  = Math.max(0, Math.ceil((15 * 60_000 - elapsed) / 60_000))
      setHtLabel(remMin > 0 ? `${remMin} min` : 'Reprise immédiate')
    }
    compute()
    // Mise à jour chaque minute (le décompte est en minutes)
    const id = setInterval(compute, 60_000)
    return () => clearInterval(id)
  }, [liveMinute, match.id])

  // Score : fusion ESPN + football-data.org, on garde toujours le plus à jour des deux
  // (évite d'afficher un score ESPN périmé alors que FD.org a déjà la bonne valeur, ou l'inverse)
  const hs  = mergeScore(espnScore?.home, match.score?.fullTime?.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espnScore?.away, match.score?.fullTime?.away ?? match.score?.halfTime?.away)

  // ── Détection de but ──
  // scoreKey : clé localStorage pour mémoriser le dernier score connu.
  // Sans persistance, prevHs/prevAs repartent à null au reload → FD.org donne 0,
  // puis ESPN arrive avec score=2 → 2 > 0 → fausse animation de but.
  const scoreKey = `foot_score_${match.id}`
  const prevHs   = useRef(null)
  const prevAs   = useRef(null)
  const timerRef = useRef(null)
  const [goal, setGoal] = useState(null) // { team: string } | null

  // Initialisation one-shot depuis localStorage pour éviter les fausses animations au reload
  const initDone = useRef(false)
  if (!initDone.current) {
    initDone.current = true
    try {
      const s = JSON.parse(localStorage.getItem(scoreKey) || 'null')
      if (s?.home != null) prevHs.current = s.home
      if (s?.away != null) prevAs.current = s.away
    } catch {}
  }

  useEffect(() => {
    if (!isLive) {
      prevHs.current = null
      prevAs.current = null
      try { localStorage.removeItem(scoreKey) } catch {}
      return
    }
    if (prevHs.current !== null && hs != null && hs > prevHs.current) {
      if (!noAnimation) {
        const team = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '')
        const score = `${hs} – ${as_ ?? 0}`
        setGoal({ team, scoreStr: score })
        notifyGoal({ teamName: team, scoreStr: score, minute: liveMinute })
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setGoal(null), 5200)
      }
    } else if (prevAs.current !== null && as_ != null && as_ > prevAs.current) {
      if (!noAnimation) {
        const team = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '')
        const score = `${hs ?? 0} – ${as_}`
        setGoal({ team, scoreStr: score })
        notifyGoal({ teamName: team, scoreStr: score, minute: liveMinute })
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setGoal(null), 5200)
      }
    }
    if (hs  != null) prevHs.current = hs
    if (as_ != null) prevAs.current = as_
    // Persister le score pour que le prochain reload initialise les refs correctement
    if (hs != null && as_ != null) {
      try { localStorage.setItem(scoreKey, JSON.stringify({ home: hs, away: as_ })) } catch {}
    }
  }, [hs, as_, isLive])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  // Qui a gagné ? (uniquement pour les matchs terminés, et si noWinnerLoser est false)
  const homeWins = !noWinnerLoser && isFinished && hs != null && as_ != null && hs > as_
  const awayWins = !noWinnerLoser && isFinished && hs != null && as_ != null && as_ > hs

  // Texte affiché au centre :
  //   - Match à venir   → heure (ex: "20:45")
  //   - Match terminé   → "FT"
  //   - Match en cours  → minute calculée (ex: "73'" ou "MT") via calcMinute()
  // Dans le widget live, pendant les 5min post-FT : "Terminé" au lieu de "FT"
  const label     = isFinished ? 'Terminé' : !isLive ? formatHour(match.utcDate) : null

  // Classes CSS avec modificateur gagnant/perdant sur les noms et blasons
  const homeNameCls  = matchClass('accueil__matchCardName',  homeWins, awayWins)
  const awayNameCls  = matchClass('accueil__matchCardName',  awayWins, homeWins)
  const homeCrestCls = matchClass('accueil__matchCardCrest', false,    awayWins)  // blason perdant → grisé
  const awayCrestCls = matchClass('accueil__matchCardCrest', false,    homeWins)
  const cardGradient = noGradient ? null : getMatchGradient(
    match.homeTeam?.name || match.homeTeam?.shortName || '',
    match.awayTeam?.name || match.awayTeam?.shortName || ''
  )

  return (
    <div
      className={`accueil__matchCard${isLive ? ' accueil__matchCard--live' : ''}${goal ? ' accueil__matchCard--goal' : ''}`}
      style={cardGradient ? { '--match-card-gradient': cardGradient } : undefined}
    >
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
          {liveMinute === 'MT' && htLabel && (
            <span className="accueil__matchCardHTCountdown">{htLabel}</span>
          )}
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
    </div>
  )
}

// ── Liste des matchs du jour ──
// Affiche en priorité les matchs non terminés, sinon tous les matchs
// Sur mobile : posters Betclic-style. Sur desktop : cards classiques.
export function MatchPanel({ matches: allMatches, loading, espnScores = {}, onMatchClick }) {
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
        <>
          {/* Mobile : affiches poster */}
          <div className="accueil__posterList">
            {displayed.map(match => (
              <MatchPoster
                key={match.id}
                match={match}
                espnScore={espnScores[match.id] ?? null}
                onClick={onMatchClick ? () => onMatchClick(match) : undefined}
              />
            ))}
          </div>

          {/* Desktop : cards classiques */}
          <div className="accueil__matchCards">
            {displayed.map(match => {
              const isUpcoming = match.status === 'SCHEDULED' || match.status === 'TIMED'
              return (
                <div
                  key={match.id}
                  className={isUpcoming && onMatchClick ? 'accueil__matchCardClickable' : undefined}
                  onClick={isUpcoming && onMatchClick ? () => onMatchClick(match) : undefined}
                >
                  <MatchCard
                    match={match}
                    espnScore={espnScores[match.id] ?? null}
                    noAnimation
                    noLive
                  />
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
