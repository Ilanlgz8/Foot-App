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
import { calcPronoAdvanced, pronoToOdds, getGoalExpectancy, bttsProbability } from '../utils/calcProno'
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

// Détail d'un match — marchés disponibles UNIQUEMENT si une vraie donnée ou
// un calcul réel existe (jamais de cote devinée, voir CLAUDE.md) :
//  - 1N2       : cote ESPN si dispo, sinon repli calcPronoAdvanced.
//  - Total buts: cote ESPN UNIQUEMENT (pas de ligne dérivée du modèle interne
//    pour l'instant — voir extractTotal, useMatchDetail.js).
//  - Double chance (1X/12/X2) : recombinaison mathématique exacte des
//    probabilités 1N2 déjà en main (réelles ou calculées) — aucune nouvelle
//    donnée, juste une addition de probabilités.
//  - BTTS (les 2 marquent) : dérivé des λ (buts espérés) du même modèle
//    Poisson que calcPronoAdvanced (getGoalExpectancy/bttsProbability,
//    calcProno.js) — affiché UNIQUEMENT quand assez de données saison sont
//    dispo pour ces λ, sinon le marché est simplement absent.
function BetDetailScreen({ match, picks, onPick, onBack }) {
  const isWC = isNationalTeamComp(match)
  const { data: odds, isLoading } = useEspnPregameOdds(match)

  // ⚠️ Toujours activé (plus de gate sur needsFallback) — nécessaire pour
  // calculer le marché BTTS même quand ESPN a déjà une vraie cote 1N2 (voir
  // ci-dessus). Coût réseau réel quasi nul malgré ce changement : même
  // queryKey React Query (['teamForm2', compCode, ...]) que celle DÉJÀ
  // chauffée par MatchPoster/MatchPanel sur la liste "Mes matchs" juste
  // avant que l'utilisateur clique sur ce match — la requête arrive donc
  // déjà en cache la quasi-totalité du temps (même pattern que
  // MatchPoster.jsx, qui fait exactement ce même appel sans jamais le gater).
  const compCode = match.competition?.code ?? null
  const { formMap, compMatches } = useTeamForm(compCode, 0, true)
  const resolvedHomeId = resolveFdTeamId(match.homeTeam, compMatches, { loose: true, strict: true })
  const resolvedAwayId = resolveFdTeamId(match.awayTeam, compMatches, { loose: true, strict: true })
  const hForm = formMap?.[resolvedHomeId] ?? []
  const aForm = formMap?.[resolvedAwayId] ?? []

  const needsFallback = !isLoading && !odds
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

  // Double chance — recombine le % actif (réel ESPN ou repli), quelle que
  // soit sa source (déjà géré par effectiveOdds ci-dessus pour le 1N2).
  const pctSource = odds?.pct ?? prono ?? null
  const dcHome = pctSource ? pronoToOdds(pctSource.home + pctSource.draw) : null // 1X
  const dcAway = pctSource ? pronoToOdds(pctSource.draw + pctSource.away) : null // X2
  const dc12   = pctSource ? pronoToOdds(pctSource.home + pctSource.away) : null // 12

  // BTTS — absent (pas juste "indisponible") si les λ ne sont pas calculables
  // (pas assez de matchs saison pour l'une des 2 équipes, voir
  // getGoalExpectancy/MIN_TEAM_SPLITS).
  const lambdas  = compMatches?.length ? getGoalExpectancy(resolvedHomeId, resolvedAwayId, compMatches) : null
  const bttsYes  = lambdas ? bttsProbability(lambdas.lambdaHome, lambdas.lambdaAway) : null
  const bttsOdds = bttsYes != null ? { yes: pronoToOdds(bttsYes), no: pronoToOdds(100 - bttsYes) } : null

  const home = teamName(match.homeTeam)
  const away = teamName(match.awayTeam)
  const current = picks.find(p => p.matchId === match.id)

  const pick1N2   = (key, label, odd) => onPick({ matchId: match.id, homeTeam: home, awayTeam: away, market: '1N2', key, label, odd })
  const pickTotal = (key, label, odd, line) => onPick({ matchId: match.id, homeTeam: home, awayTeam: away, market: 'TOTAL', key, label, odd, line })
  const pickDC    = (key, label, odd) => onPick({ matchId: match.id, homeTeam: home, awayTeam: away, market: 'DC', key, label, odd })
  const pickBtts  = (key, label, odd) => onPick({ matchId: match.id, homeTeam: home, awayTeam: away, market: 'BTTS', key, label, odd })

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

          {pctSource && (
            <>
              <p className="mesParis__marketLabel">
                Double chance
                <span className="mesParis__computedBadge">calculée à partir du 1N2</span>
              </p>
              <div className="mesParis__market mesParis__market--3">
                <button className={oddBtnClass(current, 'DC', '1X')} onClick={() => pickDC('1X', `${home} ou nul`, dcHome)}>
                  <span>{shortCode(match.homeTeam)} ou Nul</span><b>{dcHome.toFixed(2)}</b>
                </button>
                <button className={oddBtnClass(current, 'DC', '12')} onClick={() => pickDC('12', `${home} ou ${away}`, dc12)}>
                  <span>{shortCode(match.homeTeam)} ou {shortCode(match.awayTeam)}</span><b>{dc12.toFixed(2)}</b>
                </button>
                <button className={oddBtnClass(current, 'DC', 'X2')} onClick={() => pickDC('X2', `Nul ou ${away}`, dcAway)}>
                  <span>Nul ou {shortCode(match.awayTeam)}</span><b>{dcAway.toFixed(2)}</b>
                </button>
              </div>
            </>
          )}

          {bttsOdds && (
            <>
              <p className="mesParis__marketLabel">
                Les 2 équipes marquent
                <span className="mesParis__computedBadge">cote calculée par notre modèle</span>
              </p>
              <div className="mesParis__market mesParis__market--2">
                <button className={oddBtnClass(current, 'BTTS', 'YES')} onClick={() => pickBtts('YES', 'Les 2 équipes marquent : Oui', bttsOdds.yes)}>
                  <span>Oui</span><b>{bttsOdds.yes.toFixed(2)}</b>
                </button>
                <button className={oddBtnClass(current, 'BTTS', 'NO')} onClick={() => pickBtts('NO', 'Les 2 équipes marquent : Non', bttsOdds.no)}>
                  <span>Non</span><b>{bttsOdds.no.toFixed(2)}</b>
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
