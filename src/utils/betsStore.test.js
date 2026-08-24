// Tests ciblés sur le règlement des paris "Mes Paris" (settlePendingBets) —
// en particulier les 2 marchés ajoutés après le lancement initial (Double
// chance/BTTS, retour utilisateur comparant à Betclic) : évaluatePick n'est
// pas exporté (détail d'implémentation), donc testé indirectement via
// settlePendingBets, comme le ferait vraiment l'app.
import { describe, it, expect, beforeEach } from 'vitest'
import { getBalance, STARTING_BALANCE, placeBet, getBets, settlePendingBets, resolveManualPick } from './betsStore'

const finished = (id, home, away) => ({
  id,
  status: 'FINISHED',
  score: { fullTime: { home, away } },
})

beforeEach(() => {
  localStorage.clear()
})

describe('getBalance / placeBet — plomberie de base', () => {
  it('initialise à STARTING_BALANCE au tout premier appel', () => {
    expect(getBalance()).toBe(STARTING_BALANCE)
  })

  it('refuse une mise supérieure au solde', () => {
    const res = placeBet([{ matchId: 1, market: '1N2', key: 'home', odd: 2 }], STARTING_BALANCE + 1)
    expect(res.ok).toBe(false)
  })

  it('débite le solde et enregistre le pari en pending', () => {
    const res = placeBet([{ matchId: 1, market: '1N2', key: 'home', odd: 2 }], 5)
    expect(res.ok).toBe(true)
    expect(getBalance()).toBe(STARTING_BALANCE - 5)
    expect(getBets()[0].status).toBe('pending')
  })
})

describe('settlePendingBets — marché Double chance (DC)', () => {
  it('1X gagne sur une victoire domicile', () => {
    placeBet([{ matchId: 1, market: 'DC', key: '1X', odd: 1.3 }], 2)
    const { bets } = settlePendingBets({ 1: finished(1, 2, 0) })
    expect(bets[0].status).toBe('won')
  })

  it('1X gagne sur un nul', () => {
    placeBet([{ matchId: 1, market: 'DC', key: '1X', odd: 1.3 }], 2)
    const { bets } = settlePendingBets({ 1: finished(1, 1, 1) })
    expect(bets[0].status).toBe('won')
  })

  it('1X perd sur une victoire extérieure', () => {
    placeBet([{ matchId: 1, market: 'DC', key: '1X', odd: 1.3 }], 2)
    const { bets } = settlePendingBets({ 1: finished(1, 0, 2) })
    expect(bets[0].status).toBe('lost')
  })

  it('12 perd sur un nul (aucune des 2 équipes ne gagne)', () => {
    placeBet([{ matchId: 1, market: 'DC', key: '12', odd: 1.1 }], 2)
    const { bets } = settlePendingBets({ 1: finished(1, 1, 1) })
    expect(bets[0].status).toBe('lost')
  })

  it('X2 gagne sur une victoire extérieure', () => {
    placeBet([{ matchId: 1, market: 'DC', key: 'X2', odd: 1.3 }], 2)
    const { bets } = settlePendingBets({ 1: finished(1, 0, 3) })
    expect(bets[0].status).toBe('won')
  })
})

describe('settlePendingBets — marché BTTS', () => {
  it('Oui gagne si les 2 équipes ont marqué', () => {
    placeBet([{ matchId: 1, market: 'BTTS', key: 'YES', odd: 1.7 }], 2)
    const { bets } = settlePendingBets({ 1: finished(1, 2, 1) })
    expect(bets[0].status).toBe('won')
  })

  it('Oui perd si une seule équipe (ou aucune) a marqué', () => {
    placeBet([{ matchId: 1, market: 'BTTS', key: 'YES', odd: 1.7 }], 2)
    const { bets } = settlePendingBets({ 1: finished(1, 2, 0) })
    expect(bets[0].status).toBe('lost')
  })

  it('Non gagne sur un 0-0', () => {
    placeBet([{ matchId: 1, market: 'BTTS', key: 'NO', odd: 2.0 }], 2)
    const { bets } = settlePendingBets({ 1: finished(1, 0, 0) })
    expect(bets[0].status).toBe('won')
  })

  it('crédite le solde du gain quand le pari est gagné', () => {
    placeBet([{ matchId: 1, market: 'BTTS', key: 'NO', odd: 2.0 }], 2)
    const before = getBalance()
    settlePendingBets({ 1: finished(1, 0, 0) })
    expect(getBalance()).toBeCloseTo(before + 2 * 2.0, 5)
  })
})

describe('settlePendingBets — marché Score exact', () => {
  it('gagne sur le score exact prédit', () => {
    placeBet([{ matchId: 1, market: 'SCORE_EXACT', key: '2-1', odd: 9 }], 1)
    const { bets } = settlePendingBets({ 1: finished(1, 2, 1) })
    expect(bets[0].status).toBe('won')
  })

  it('perd sur un autre score', () => {
    placeBet([{ matchId: 1, market: 'SCORE_EXACT', key: '2-1', odd: 9 }], 1)
    const { bets } = settlePendingBets({ 1: finished(1, 1, 1) })
    expect(bets[0].status).toBe('lost')
  })
})

describe('settlePendingBets — marché Écart de buts (MARGIN)', () => {
  it('CLOSE gagne sur un écart de 1 but', () => {
    placeBet([{ matchId: 1, market: 'MARGIN', key: 'CLOSE', odd: 1.8 }], 1)
    const { bets } = settlePendingBets({ 1: finished(1, 2, 1) })
    expect(bets[0].status).toBe('won')
  })

  it('HOME_BIG gagne sur un écart de 3 buts pour le domicile', () => {
    placeBet([{ matchId: 1, market: 'MARGIN', key: 'HOME_BIG', odd: 3.5 }], 1)
    const { bets } = settlePendingBets({ 1: finished(1, 4, 1) })
    expect(bets[0].status).toBe('won')
  })

  it('AWAY_BIG perd si l\'extérieur gagne de seulement 1 but', () => {
    placeBet([{ matchId: 1, market: 'MARGIN', key: 'AWAY_BIG', odd: 3.5 }], 1)
    const { bets } = settlePendingBets({ 1: finished(1, 1, 2) })
    expect(bets[0].status).toBe('lost')
  })
})

describe('settlePendingBets — marché Total buts par équipe (TEAM_TOTAL)', () => {
  it('HOME_OVER gagne si le domicile marque plus que la ligne', () => {
    placeBet([{ matchId: 1, market: 'TEAM_TOTAL', key: 'HOME_OVER', odd: 2.1, line: 1.5 }], 1)
    const { bets } = settlePendingBets({ 1: finished(1, 2, 0) })
    expect(bets[0].status).toBe('won')
  })

  it('AWAY_UNDER gagne si l\'extérieur marque moins que la ligne', () => {
    placeBet([{ matchId: 1, market: 'TEAM_TOTAL', key: 'AWAY_UNDER', odd: 1.5, line: 1.5 }], 1)
    const { bets } = settlePendingBets({ 1: finished(1, 3, 1) })
    expect(bets[0].status).toBe('won')
  })
})

describe('settlePendingBets — marché Buteur (SCORER, règlement manuel)', () => {
  it('un pari buteur seul, match terminé, passe en needsManual (jamais réglé tout seul)', () => {
    placeBet([{ matchId: 1, market: 'SCORER', key: '171', odd: 2.5 }], 1)
    const { bets } = settlePendingBets({ 1: finished(1, 2, 0) })
    expect(bets[0].status).toBe('pending')
    expect(bets[0].needsManual).toBe(true)
  })

  it('un combiné 1N2 (perdu) + buteur est réglé "lost" directement, sans attendre la confirmation manuelle', () => {
    placeBet([
      { matchId: 1, market: '1N2',    key: 'home', odd: 1.5 },
      { matchId: 2, market: 'SCORER', key: '171',  odd: 2.5 },
    ], 1)
    const { bets } = settlePendingBets({
      1: finished(1, 0, 2), // 1N2 home perdu
      2: finished(2, 1, 1), // buteur : match terminé mais résultat inconnu
    })
    expect(bets[0].status).toBe('lost')
  })
})

describe('resolveManualPick', () => {
  it('confirmer "gagné" sur un pari buteur simple le règle en "won" et crédite le solde', () => {
    placeBet([{ matchId: 1, market: 'SCORER', key: '171', odd: 2.5 }], 1)
    settlePendingBets({ 1: finished(1, 2, 0) }) // → needsManual
    const before = getBalance()
    const res = resolveManualPick(getBets()[0].id, 0, true)
    expect(res.ok).toBe(true)
    expect(res.bet.status).toBe('won')
    expect(getBalance()).toBeCloseTo(before + 1 * 2.5, 5)
  })

  it('confirmer "perdu" règle le pari en "lost" sans créditer', () => {
    placeBet([{ matchId: 1, market: 'SCORER', key: '171', odd: 2.5 }], 1)
    settlePendingBets({ 1: finished(1, 2, 0) })
    const before = getBalance()
    const res = resolveManualPick(getBets()[0].id, 0, false)
    expect(res.bet.status).toBe('lost')
    expect(getBalance()).toBe(before)
  })

  it('un combiné avec 2 jambes buteur reste pending tant que les 2 ne sont pas confirmées', () => {
    placeBet([
      { matchId: 1, market: 'SCORER', key: '171', odd: 2.0 },
      { matchId: 2, market: 'SCORER', key: '99',  odd: 1.8 },
    ], 1)
    settlePendingBets({ 1: finished(1, 1, 0), 2: finished(2, 0, 1) })
    const betId = getBets()[0].id
    const r1 = resolveManualPick(betId, 0, true)
    expect(r1.bet.status).toBe('pending')
    const r2 = resolveManualPick(betId, 1, true)
    expect(r2.bet.status).toBe('won')
  })

  it('renvoie ok:false sur un id de pari inconnu', () => {
    expect(resolveManualPick('bet_inconnu', 0, true).ok).toBe(false)
  })
})

describe('settlePendingBets — combiné multi-marchés', () => {
  it('un combiné 1N2 + DC + BTTS gagne seulement si TOUTES les jambes gagnent', () => {
    placeBet([
      { matchId: 1, market: '1N2',  key: 'home', odd: 1.5 },
      { matchId: 2, market: 'DC',   key: '1X',   odd: 1.2 },
      { matchId: 3, market: 'BTTS', key: 'YES',  odd: 1.8 },
    ], 1)
    const { bets } = settlePendingBets({
      1: finished(1, 2, 0), // 1N2 home : gagné
      2: finished(2, 1, 1), // DC 1X : gagné (nul)
      3: finished(3, 1, 0), // BTTS YES : PERDU (une seule équipe marque)
    })
    expect(bets[0].status).toBe('lost')
  })
})
