import { useState, useRef, useEffect } from 'react'
import { translateTeam } from '../data/teamNames'
import { calcMinute, getMatchPeriod, mergeScore, finalScore , isNationalTeamComp } from '../utils/matchUtils'
import { notifyGoal } from '../utils/notifications'
import { getMatchState } from '../utils/matchStateTracker'
import { MatchPoster } from './MatchPoster'
import { FormDiamonds } from './FormDiamonds'
import { getMatchGradient } from '../data/teamPhotos'
import { COMPETITIONS } from '../data/competitions'

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

// ── Skeleton posters (mobile) ── — .accueil__matchCards est caché sur mobile
// (voir accueil.css), donc PanelSkeleton seul y est invisible pendant le
// chargement. Ce skeleton reprend la structure de MatchPoster pour combler
// ce trou et éviter un vide pendant le chargement initial sur mobile.
export function PosterSkeleton() {
  return (
    <div className="accueil__posterSkList">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="poster__frame poster__frame--sk">
          <div className="poster poster--sk">
            <div className="poster__middle">
              <div className="poster__team-col poster__team-col--home">
                <div className="sk" style={{ width: '44px', height: '44px', borderRadius: '50%' }} />
                <div className="sk" style={{ width: '3rem', height: '0.7rem' }} />
              </div>
              <div className="poster__center">
                <div className="sk" style={{ width: '3.5rem', height: '1.3rem', borderRadius: '0.4rem' }} />
              </div>
              <div className="poster__team-col poster__team-col--away">
                <div className="sk" style={{ width: '44px', height: '44px', borderRadius: '50%' }} />
                <div className="sk" style={{ width: '3rem', height: '0.7rem' }} />
              </div>
            </div>
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
//   espnScore     → { home, away } depuis ESPN (< 10s de délai), ou null
//   noGradient    → si true, pas de dégradé couleurs équipes en fond (ex: panel Résultats)
export function MatchCard({ match, noWinnerLoser = false, espnScore = null, noAnimation = false, isTermine = false, noLive = false, noGradient = false, formMap = null }) {
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
  // noLive : gardé pour compat (plus jamais passé à true depuis MatchPanel —
  // une card "Matchs à venir" passe maintenant elle-même en mode live dès le
  // coup d'envoi, voir accueil/MatchCard.jsx/MatchPanel). calcMinute() renvoie
  // déjà 'Débute' dès l'heure prévue (tant qu'ESPN n'a pas confirmé le KO,
  // jusqu'à 30min après) → liveMinute !== null suffit à couvrir ce cas ici,
  // sans code spécifique en plus.
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

  // Score : fusion ESPN + football-data.org PENDANT le direct seulement (ESPN
  // est alors la source la plus à jour, <10s de délai vs 1-5min pour FD.org).
  // Une fois le match TERMINÉ, on fait confiance au score final de football-
  // data.org (finalScore(match.score)) et on arrête de merger avec ESPN : un
  // score ESPN live périmé/faux resté en localStorage (ex: gonflé par les
  // tirs au but, avant notre fix sur la détection tab) pouvait sinon rester
  // affiché indéfiniment via mergeScore (qui garde le max des deux) — c'est
  // ce qui causait l'affichage "4-4" au lieu de "2-2 (4-2 tab)" sur un match
  // aux tirs au but.
  //
  // ⚠️ NE PAS lire match.score.fullTime directement (bug FD.org confirmé en
  // prod : pour un match aux tab, fullTime = regularTime+extraTime+penalties
  // CUMULÉS, pas le score 120min) — voir finalScore() dans matchUtils.js.
  const fsCard = finalScore(match.score)
  const hs  = isFinished
    ? (fsCard.home ?? match.score?.halfTime?.home ?? 0)
    : mergeScore(espnScore?.home, fsCard.home ?? match.score?.halfTime?.home)
  const as_ = isFinished
    ? (fsCard.away ?? match.score?.halfTime?.away ?? 0)
    : mergeScore(espnScore?.away, fsCard.away ?? match.score?.halfTime?.away)

  // Tirs au but : le score 120min (finalScore) est TOUJOURS à égalité dans ce
  // cas — le vrai vainqueur et le score des tab viennent de score.penalties.
  // Même logique que Resultat.jsx/Match.jsx/MatchModal.jsx, pour un affichage
  // identique partout dans l'app.
  const wentToPens = match.score?.duration === 'PENALTY_SHOOTOUT'
  const hPens = match.score?.penalties?.home ?? null
  const aPens = match.score?.penalties?.away ?? null
  // Décidé en prolongation SANS tirs au but — mutuellement exclusif avec
  // wentToPens (voir Resultat.jsx, même logique).
  const wentToAet = match.score?.duration === 'EXTRA_TIME'

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
  // Aux tirs au but, fullTime est à égalité → le vainqueur se lit dans penalties.
  const homeWins = !noWinnerLoser && isFinished && (wentToPens
    ? (hPens != null && aPens != null && hPens > aPens)
    : (hs != null && as_ != null && hs > as_))
  const awayWins = !noWinnerLoser && isFinished && (wentToPens
    ? (hPens != null && aPens != null && aPens > hPens)
    : (hs != null && as_ != null && as_ > hs))

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
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)
  const cardGradient = noGradient ? null : getMatchGradient(
    match.homeTeam?.name || match.homeTeam?.shortName || '',
    match.awayTeam?.name || match.awayTeam?.shortName || ''
  )

  // ── Bandeau live : compétition (haut gauche) + statut période (haut droite) ──
  // Même contenu/logique que le hero de LiveMatchPage (mp__hero__comp +
  // lmp__heroPeriodBadge) — demande explicite : une card en mode live doit
  // reprendre ce même habillage. Uniquement affiché en mode live (isLive) :
  // une card à venir/terminée n'a pas besoin de ce bandeau.
  const liveComp = COMPETITIONS.find(c => c.id === match.competition?.code)
  const liveCompEmblem = liveComp?.emblem ?? match.competition?.emblem
  const liveCompName   = match.competition?.name ?? liveComp?.name ?? ''
  const rawPeriod = getMatchPeriod(match)
  const livePeriodLabel = rawPeriod === '1ère MT'       ? '1ère mi-temps'
    : rawPeriod === '2ème MT'       ? '2ème mi-temps'
    : rawPeriod === 'Mi-temps'      ? 'Mi-temps'
    : rawPeriod === 'Prolongations' ? 'Prolongations'
    : rawPeriod === 'T.A.B.'        ? 'T.A.B.'
    : null

  return (
    <div
      className={`accueil__matchCard${isLive ? ' accueil__matchCard--live' : ''}${goal ? ' accueil__matchCard--goal' : ''}`}
      style={cardGradient ? { '--match-card-gradient': cardGradient } : undefined}
    >
      {goal && <GoalCelebration teamName={goal.team} scoreStr={goal.scoreStr} />}

      {/* Bandeau live : compétition à gauche, statut de période à droite —
          même habillage que le hero de LiveMatchPage. */}
      {isLive && (
        <div className="accueil__matchCardLiveBar">
          <span className="accueil__matchCardLiveComp">
            {liveCompEmblem && <img src={liveCompEmblem} alt="" className="accueil__matchCardLiveCompLogo" />}
            <span className="accueil__matchCardLiveCompName">{liveCompName}</span>
          </span>
          {livePeriodLabel && (
            <span className="accueil__matchCardLivePeriod">{livePeriodLabel}</span>
          )}
        </div>
      )}

      {/* Équipe domicile */}
      <div className="accueil__matchCardTeam">
        <div className="accueil__matchCardCrestWrap" data-crest={isWC ? 'country' : 'club'}>
          {match.homeTeam?.crest
            ? <img src={match.homeTeam.crest} alt="" loading="lazy" className={homeCrestCls} data-team={match.homeTeam?.name}
                onError={e => e.currentTarget.style.display = 'none'} />
            : <div className="accueil__matchCardCrestEmpty" />}
        </div>
        <span className={homeNameCls}>
          {translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')}
        </span>
        <FormDiamonds form={formMap?.[match.homeTeam?.id]} />
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
        {isFinished && wentToPens && hPens != null && aPens != null && (
          <div className="accueil__matchCardPensBlock">
            <span className="accueil__matchCardPensLabel">T.A.B</span>
            <span className="accueil__matchCardPensScore">({hPens}-{aPens})</span>
          </div>
        )}
        {isFinished && wentToAet && (
          <span className="accueil__matchCardAet">Après prolong.</span>
        )}

      </div>

      {/* Équipe extérieure */}
      <div className="accueil__matchCardTeam accueil__matchCardTeam--away">
        <div className="accueil__matchCardCrestWrap" data-crest={isWC ? 'country' : 'club'}>
          {match.awayTeam?.crest
            ? <img src={match.awayTeam.crest} alt="" loading="lazy" className={awayCrestCls} data-team={match.awayTeam?.name}
                onError={e => e.currentTarget.style.display = 'none'} />
            : <div className="accueil__matchCardCrestEmpty" />}
        </div>
        <span className={awayNameCls}>
          {translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')}
        </span>
        <FormDiamonds form={formMap?.[match.awayTeam?.id]} />
      </div>
    </div>
  )
}

// Un match est considéré "live" pour le routage du clic dès que sa card
// passe en mode live (même logique que isLive dans MatchCard/MatchPoster) :
// IN_PLAY/PAUSED confirmé, ou coup d'envoi imminent/en cours détecté par
// calcMinute() (ex: "Débute"), et pas encore terminé.
function isCardLive(match) {
  const ms = getMatchState(match.id)
  const isFinished = ms.ft === true || match.status === 'FINISHED'
  if (isFinished) return false
  return match.status === 'IN_PLAY' || match.status === 'PAUSED' || calcMinute(match) !== null
}

// ── Liste des matchs du jour ──
// Affiche en priorité les matchs non terminés, sinon tous les matchs
// Sur mobile : posters Betclic-style. Sur desktop : cards classiques.
// onMatchClick → matchs pas encore commencés (page pré-match /match/:id)
// onLiveClick  → matchs passés en live (page dédiée /live/:id) — la card
// elle-même reste affichée à la même place et change juste d'affichage (voir
// MatchCard : plus de noLive ici), au lieu de disparaître au profit d'un
// widget séparé ailleurs sur l'Accueil (demande utilisateur).
export function MatchPanel({ matches: allMatches, loading, espnScores = {}, onMatchClick, onLiveClick, formMap = null }) {
  // Si des matchs sont en cours ou à venir → les afficher en priorité
  // Sinon (tous terminés) → afficher quand même les résultats du jour
  const active    = allMatches.filter(m => m.status !== 'FINISHED')
  const displayed = active.length > 0 ? active : allMatches

  return (
    <div className="accueil__dashPanelBody">
      {loading && <PosterSkeleton />}
      {loading && <PanelSkeleton />}
      {!loading && displayed.length === 0 && (
        <p className="accueil__tickerEmpty">Aucun match aujourd'hui.</p>
      )}
      {!loading && displayed.length > 0 && (
        <>
          {/* Mobile : affiches poster */}
          <div className="accueil__posterList">
            {displayed.map(match => {
              const clickHandler = isCardLive(match)
                ? (onLiveClick ? () => onLiveClick(match) : undefined)
                : (onMatchClick ? () => onMatchClick(match) : undefined)
              return (
                <MatchPoster
                  key={match.id}
                  match={match}
                  espnScore={espnScores[match.id] ?? null}
                  onClick={clickHandler}
                />
              )
            })}
          </div>

          {/* Desktop : cards classiques */}
          <div className="accueil__matchCards">
            {displayed.map(match => {
              const clickHandler = isCardLive(match)
                ? (onLiveClick ? () => onLiveClick(match) : undefined)
                : (onMatchClick ? () => onMatchClick(match) : undefined)
              return (
                <div
                  key={match.id}
                  className={clickHandler ? 'accueil__matchCardClickable' : undefined}
                  onClick={clickHandler}
                >
                  <MatchCard
                    match={match}
                    espnScore={espnScores[match.id] ?? null}
                    noAnimation
                    formMap={formMap}
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
