// Tests ciblés sur buildFormMap (exportée pour ce fix, voir son commentaire
// dans useTeamForm.js) — verrouille l'agrégation W/D/L par équipe, la seule
// partie de la fusion multi-compétitions (useTeamFormMulti) testable sans
// mocker react-query/le réseau. La logique de résolution par nom pour les
// compétitions ESPN-only (constat utilisateur : losange de Deportivo, 0
// match joué, sur une card Accueil contre Elche) réutilise resolveFdTeamId,
// déjà couvert par ses propres tests dans matchUtils.test.js — pas dupliqué
// ici.
import { describe, it, expect } from 'vitest'
import { buildFormMap } from './useTeamForm'

function match(homeId, awayId, winner) {
  return {
    status: 'FINISHED',
    homeTeam: { id: homeId },
    awayTeam: { id: awayId },
    score: { winner, duration: 'REGULAR' },
  }
}

describe('buildFormMap', () => {
  it('une équipe sans aucun match ne reçoit aucune entrée (pas de losange affiché, comportement voulu)', () => {
    const formMap = buildFormMap([match(1, 2, 'HOME_TEAM')])
    expect(formMap[999]).toBeUndefined()
  })

  it('W/D/L attribués correctement aux 2 équipes du même match', () => {
    const formMap = buildFormMap([match(1, 2, 'HOME_TEAM')])
    expect(formMap[1]).toEqual(['W'])
    expect(formMap[2]).toEqual(['L'])
  })

  it('garde seulement les 5 derniers résultats par équipe', () => {
    const matches = Array.from({ length: 7 }, (_, i) => match(1, 100 + i, 'HOME_TEAM'))
    const formMap = buildFormMap(matches)
    expect(formMap[1]).toHaveLength(5)
  })

  it('match sans score.winner exploitable (ni HOME_TEAM/AWAY_TEAM/DRAW, ni score numérique) : ignoré, formMap vide', () => {
    const formMap = buildFormMap([{ status: 'FINISHED', homeTeam: { id: 1 }, awayTeam: { id: 2 }, score: {} }])
    expect(formMap[1]).toBeUndefined()
    expect(formMap[2]).toBeUndefined()
  })
})
