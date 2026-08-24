/**
 * MesParis — paris fictifs, aucun argent réel.
 * Route : /mes-paris
 *
 * ⚠️ REVU (retour utilisateur : "t'as pas mis les cards comme dans accueil,
 * t'as pas mis les cotes pour tous les matchs, t'as pas mis les cotes
 * calculées grâce à notre système") : la 1ère version avait sa PROPRE card
 * simplifiée (style Pronos) au lieu de réutiliser telle quelle MatchPanel/
 * MatchPoster (accueil/MatchCard.jsx) — qui gère déjà tout ça nativement :
 * poster mobile "Betclic-style" + card desktop, ET le repli automatique sur
 * calcPronoAdvanced (notre modèle Poisson, "cotes calculées grâce à notre
 * système") dès qu'ESPN n'a pas de cote marché réelle pour ce match — donc
 * une cote 1N2 pour LITTÉRALEMENT tous les matchs, jamais de card vide.
 * Ici on réutilise MatchPanel directement pour la liste, exactement comme
 * Accueil.jsx (même wrapper .accueil__dashPanel--matchPanel, nécessaire
 * pour que le CSS bascule poster/mobile ↔ card/desktop comme partout
 * ailleurs — voir accueil.css). Cotes réelles (useEspnPregameOdds) toujours
 * utilisées pour le marché "Total buts" de la page détail (aucune cote
 * inventée pour CE marché précis — voir useMatchDetail.js/extractTotal).
 */
import { useState, useEffect, useMemo } from 'react'
import { useUpcomingMatchesAllComps, useFinishedMatchesAllComps } from '../hooks/useMatchs'
import { useEspnPregameOdds } from '../hooks/useMatchDetail'
import { useTeamForm } from '../hooks/useTeamForm'
import { calcPronoAdvanced, pronoToOdds } from '../utils/calcProno'
import { MatchPanel } from '../accueil/MatchCard'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'
import { isNationalTeamComp, isNeutralVenueComp, resolveFdTeamId } from '../utils/matchUtils'
import { getBalance, getBets, placeBet, settlePendingBets } from '../utils/betsStore'
import '../accueil.css'
import '../mesParis.css'

const COMP_IDS = COMPETITIONS.map(c => c.id)

const _fmtH = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const _fmtD = (d) => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const date = new Date(d); date.setHours(0, 0, 0, 0)
  if (date.getTime() === today.getTime()) return "Aujourd'hui"
  if (date.getTime() === tomorrow.getTime()) return 'Demain'
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

const teamName  = (team) => team?.name ? translateTeam(team.shortName || team.name) : 'À déterminer'
const shortCode = (team) => (team?.shortName || team?.tla || team?.name || '?').slice(0, 3).toUpperCase()

// Blason/drapeau — même attribut data-crest global que le reste de l'app
// (voir index.css), pas de CSS dupliqué ici. Encore utilisé par
// BetDetailScreen ci-dessous (la liste, elle, passe maintenant par
// MatchPanel/MatchPoster — voir commentaire en tête de fichier).
function TeamCrest({ team, isWC }) {
  if (!team?.crest) return <span className="mesParis__crestFb">{teamName(team)[0]}</span>
  return (
    <div className="mesParis__crestWrap" data-crest={isWC ? 'country' : 'club'}>
      <img src={team.crest} alt="" className="mesParis__crest" data-team={team?.name}
        onError={e => { e.currentTarget.style.display = 'none' }} />
    </div>
  )
}

function oddBtnClass(current, market, key) {
  const active = current && current.market === market && current.key === key
  return `mesParis__oddBtn${active ? ' mesParis__oddBtn--active' : ''}`
}

// Détail d'un match — marchés disponibles UNIQUEMENT si une vraie cote
// existe (1N2 quasi toujours dispo ; "Total buts" pas garanti, voir
// extractTotal dans useMatchDetail.js — provider ESPN BET pas encore
// vérifié pour ce marché précis, jamais de cote devinée).
function BetDetailScreen({ match, picks, onPick, onBack }) {
  const isWC = isNationalTeamComp(match)
  const { data: odds, isLoading } = useEspnPregameOdds(match)

  // Repli "cote calculée par notre système" (calcPronoAdvanced — même modèle
  // Poisson que la card Accueil, voir MatchPoster.jsx) dès qu'ESPN n'a pas de
  // cote marché réelle pour CE match précis : sans ça, un match visible avec
  // une cote dans la liste (MatchPanel/MatchPoster, qui a déjà ce repli)
  // pouvait quand même arriver ici en "Cotes indisponibles" — incohérence
  // signalée par l'utilisateur. Version simplifiée par rapport à MatchPoster
  // (pas de H2H dédié / repli club promu, juste forme + stats saison) :
  // suffisant pour un repli de cote 1N2, jamais de chiffre inventé — calcul
  // réel du même modèle. Hook désactivé tant qu'ESPN n'a pas répondu, pour ne
  // jamais taper FD.org pour rien quand la vraie cote existe déjà.
  const needsFallback = !isLoading && !odds
  const compCode = match.competition?.code ?? null
  const { formMap, compMatches } = useTeamForm(compCode, 0, needsFallback)
  const resolvedHomeId = needsFallback
    ? resolveFdTeamId(match.homeTeam, compMatches, { loose: true, strict: true }) : null
  const resolvedAwayId = needsFallback
    ? resolveFdTeamId(match.awayTeam, compMatches, { loose: true, strict: true }) : null
  const hForm = formMap?.[resolvedHomeId] ?? []
  const aForm = formMap?.[resolvedAwayId] ?? []
  const prono = needsFallback
    ? calcPronoAdvanced(resolvedHomeId, resolvedAwayId, compMatches, hForm, aForm, {
        neutralVenue: isNeutralVenueComp(match),
      })
    : null
  // Pas de marché "Total buts" en repli : le modèle interne ne veut pas
  // exposer publiquement ses lambdas de buts pour ce marché précis pour
  // l'instant — plutôt aucune cote que d'en inventer une (voir CLAUDE.md,
  // "n'invente rien"). Le marché reste dispo dès qu'ESPN a une vraie cote.
  const fallbackOdds = prono
    ? { decimal: { home: pronoToOdds(prono.home), draw: pronoToOdds(prono.draw), away: pronoToOdds(prono.away) }, total: null }
    : null
  const effectiveOdds = odds ?? fallbackOdds
  const isComputedOdds = !odds && !!fallbackOdds

  const home = teamName(match.homeTeam)
  const away = teamName(match.awayTeam)
  const current = picks.find(p => p.matchId === match.id)

  const pick1N2   = (key, label, odd) => onPick({ matchId: match.id, homeTeam: home, awayTeam: away, market: '1N2', key, label, odd })
  const pickTotal = (key, label, odd, line) => onPick({ matchId: match.id, homeTeam: home, awayTeam: away, market: 'TOTAL', key, label, odd, line })

  return (
    <div className="mesParis__detail">
      <button className="mesParis__back" onClick={onBack}>‹ Mes matchs</button>
      <div className="mesParis__detailHead">
        <div className="mesParis__detailTeams">
          <TeamCrest team={match.homeTeam} isWC={isWC} />
          <span>{home} – {away}</span>
          <TeamCrest team={match.awayTeam} isWC={isWC} />
        </div>
        <span className="mesParis__detailSub">{_fmtD(match.utcDate)} · {_fmtH(match.utcDate)}</span>
      </div>

      {isLoading && <p className="mesParis__state">Chargement des cotes…</p>}
      {!isLoading && !effectiveOdds && <p className="mesParis__state">Cotes indisponibles pour ce match.</p>}

      {effectiveOdds && (
        <>
          <p className="mesParis__marketLabel">
            Résultat du match
            {isComputedOdds && <span className="mesParis__computedBadge">cote calculée par notre modèle</span>}
          </p>
          <div className="mesParis__market mesParis__market--3">
            <button className={oddBtnClass(current, '1N2', 'home')} onClick={() => pick1N2('home', `${home} gagne`, effectiveOdds.decimal.home)}>
              <span>{shortCode(match.homeTeam)}</span><b>{effectiveOdds.decimal.home.toFixed(2)}</b>
            </button>
            <button className={oddBtnClass(current, '1N2', 'draw')} onClick={() => pick1N2('draw', 'Match nul', effectiveOdds.decimal.draw)}>
              <span>Nul</span><b>{effectiveOdds.decimal.draw.toFixed(2)}</b>
            </button>
            <button className={oddBtnClass(current, '1N2', 'away')} onClick={() => pick1N2('away', `${away} gagne`, effectiveOdds.decimal.away)}>
              <span>{shortCode(match.awayTeam)}</span><b>{effectiveOdds.decimal.away.toFixed(2)}</b>
            </button>
          </div>

          {effectiveOdds.total && (
            <>
              <p className="mesParis__marketLabel">Total buts</p>
              <div className="mesParis__market mesParis__market--2">
                <button className={oddBtnClass(current, 'TOTAL', 'OVER')} onClick={() => pickTotal('OVER', `+ de ${effectiveOdds.total.line} buts`, effectiveOdds.total.over, effectiveOdds.total.line)}>
                  <span>+ de {effectiveOdds.total.line} buts</span><b>{effectiveOdds.total.over.toFixed(2)}</b>
                </button>
                <button className={oddBtnClass(current, 'TOTAL', 'UNDER')} onClick={() => pickTotal('UNDER', `− de ${effectiveOdds.total.line} buts`, effectiveOdds.total.under, effectiveOdds.total.line)}>
                  <span>− de {effectiveOdds.total.line} buts</span><b>{effectiveOdds.total.under.toFixed(2)}</b>
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// Bulletin — persiste tant qu'on navigue entre les matchs (state au niveau
// de la page, pas du composant détail) : c'est ce qui permet le combiné
// multi-matchs demandé.
function BetSlip({ picks, onRemove, stake, onStakeChange, balance, onValidate, error }) {
  if (picks.length === 0) {
    return <div className="mesParis__slip mesParis__slip--empty">Bulletin vide — touchez une cote pour commencer.</div>
  }
  const combinedOdd = picks.reduce((acc, p) => acc * p.odd, 1)
  const stakeNum = Number(stake) || 0
  const potentialGain = stakeNum > 0 ? stakeNum * combinedOdd : 0

  return (
    <div className="mesParis__slip">
      <div className="mesParis__slipPicks">
        {picks.map(p => (
          <div key={p.matchId} className="mesParis__slipPick">
            <span>{p.homeTeam} – {p.awayTeam} : {p.label} <b>@ {p.odd.toFixed(2)}</b></span>
            <button className="mesParis__slipRemove" onClick={() => onRemove(p.matchId)} aria-label="Retirer cette sélection">✕</button>
          </div>
        ))}
      </div>
      <div className="mesParis__slipRow">
        <label htmlFor="mesParisStake">Mise</label>
        <input id="mesParisStake" type="number" min="0.10" max={balance} step="0.10"
          value={stake} onChange={e => onStakeChange(e.target.value)} />
        <span>€</span>
      </div>
      <div className="mesParis__slipRow mesParis__slipRow--gain">
        <span>Cote combinée {combinedOdd.toFixed(2)} · gain potentiel</span>
        <b>{potentialGain.toFixed(2)} €</b>
      </div>
      {error && <p className="mesParis__slipError">{error}</p>}
      <button className="mesParis__validate" onClick={onValidate}>Valider le pari</button>
    </div>
  )
}

function BetHistory({ bets }) {
  if (bets.length === 0) return <p className="mesParis__state">Aucun pari pour l'instant.</p>
  const STATUS_LABEL = { pending: 'En cours', won: 'Gagné', lost: 'Perdu' }
  return (
    <div className="mesParis__history">
      {bets.map(bet => (
        <div key={bet.id} className={`mesParis__histCard mesParis__histCard--${bet.status}`}>
          <div className="mesParis__histTop">
            <span className="mesParis__histStatus">{STATUS_LABEL[bet.status]}</span>
            <span>{bet.stake.toFixed(2)} € · cote {bet.combinedOdd.toFixed(2)}</span>
          </div>
          {bet.picks.map((p, i) => (
            <div key={i} className="mesParis__histPick">{p.homeTeam} – {p.awayTeam} : {p.label}</div>
          ))}
          {bet.status === 'won' && <div className="mesParis__histPayout">+{bet.payout.toFixed(2)} €</div>}
        </div>
      ))}
    </div>
  )
}

export default function MesParis() {
  const [tab, setTab]                 = useState('parier') // 'parier' | 'historique'
  const [view, setView]               = useState('list')   // 'list' | 'detail'
  const [activeMatch, setActiveMatch] = useState(null)
  const [picks, setPicks]             = useState([])
  const [stake, setStake]             = useState(1)
  const [error, setError]             = useState(null)
  const [balance, setBalance]         = useState(() => getBalance())
  const [bets, setBets]               = useState(() => getBets())

  const { matches: upcoming, loading } = useUpcomingMatchesAllComps(COMP_IDS)
  const { matches: finished }          = useFinishedMatchesAllComps(COMP_IDS)

  // Règlement automatique dès qu'un match suivi par un pari en attente
  // apparaît dans les matchs terminés — voir settlePendingBets (jamais de
  // résultat deviné, un pari reste "En cours" tant que tous ses matchs ne
  // sont pas confirmés terminés).
  useEffect(() => {
    if (!finished.length) return
    const byId = {}
    finished.forEach(m => { byId[m.id] = m })
    const { bets: updated, changed } = settlePendingBets(byId)
    if (!changed) return
    // Synchronisation avec un système externe (localStorage, voir
    // betsStore.js) : `changed` (calculé par settlePendingBets, pas une
    // simple différence de référence) garde déjà ce setState réellement
    // conditionnel — ne se déclenche QUE quand un pari vient d'être réglé,
    // jamais à chaque poll de `finished` sans rien de neuf. Pas de chemin
    // "sans effet" ici : le résultat dépend d'un appel localStorage (lecture
    // + écriture), impossible à dériver pendant le render (impur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBets(updated)
    setBalance(getBalance())
  }, [finished])

  const upcomingSorted = useMemo(
    () => [...upcoming].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)),
    [upcoming]
  )

  function openMatch(match) {
    setActiveMatch(match)
    setView('detail')
  }
  function backToList() {
    setView('list')
    setActiveMatch(null)
  }
  function handlePick(pick) {
    // Un seul pick par match dans un même bulletin — un nouveau choix sur ce
    // match remplace le précédent plutôt que de créer une incohérence
    // (ex: PSG gagne ET Nul en même temps).
    setPicks(prev => [...prev.filter(p => p.matchId !== pick.matchId), pick])
    setError(null)
  }
  function removePick(matchId) {
    setPicks(prev => prev.filter(p => p.matchId !== matchId))
  }
  function handleValidate() {
    const result = placeBet(picks, stake)
    if (!result.ok) { setError(result.error); return }
    setPicks([])
    setStake(1)
    setError(null)
    setBalance(getBalance())
    setBets(getBets())
    setView('list')
    setActiveMatch(null)
  }

  return (
    <div className="mesParis__page">
      <div className="mesParis__balance">
        <div>
          <span className="mesParis__balanceLabel">Solde fictif</span>
          <span className="mesParis__balanceVal">{balance.toFixed(2)} €</span>
        </div>
      </div>

      <div className="mesParis__tabs">
        <button className={`mesParis__tab${tab === 'parier' ? ' mesParis__tab--active' : ''}`} onClick={() => setTab('parier')}>Parier</button>
        <button className={`mesParis__tab${tab === 'historique' ? ' mesParis__tab--active' : ''}`} onClick={() => setTab('historique')}>Historique</button>
      </div>

      {tab === 'parier' && (
        <>
          {view === 'list' && (
            // Wrapper identique à Accueil.jsx (voir commentaire en tête de
            // fichier) : nécessaire pour que le CSS d'accueil.css bascule
            // poster mobile ↔ card desktop. onLiveClick délibérément omis —
            // un match déjà en direct n'a plus de cote pré-match figée,
            // MatchPanel le rend alors simplement non-cliquable ici.
            <div className="accueil__dashPanel--matchPanel">
              <MatchPanel
                matches={upcomingSorted}
                loading={loading}
                onMatchClick={openMatch}
              />
            </div>
          )}
          {view === 'detail' && activeMatch && (
            <BetDetailScreen match={activeMatch} picks={picks} onPick={handlePick} onBack={backToList} />
          )}
          <BetSlip picks={picks} onRemove={removePick} stake={stake} onStakeChange={setStake}
            balance={balance} onValidate={handleValidate} error={error} />
        </>
      )}

      {tab === 'historique' && <BetHistory bets={bets} />}
    </div>
  )
}
