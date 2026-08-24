// Tests ciblés sur le règlement des paris "Mes Paris" (settlePendingBets) —
// en particulier les 2 marchés ajoutés après le lancement initial (Double
// chance/BTTS, retour utilisateur comparant à Betclic) : évaluatePick n'est
// pas exporté (détail d'implémentation), donc testé indirectement via
// settlePendingBets, comme le ferait vraiment l'app.
import { describe, it, expect, beforeEach } from 'vitest'
import { getBalance, STARTING_BALANCE, placeBet, getBets, settlePendingBets } from './betsStore'

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
