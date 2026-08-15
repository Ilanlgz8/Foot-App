// Tests ciblés sur le nouveau champ endedEspnEventId (setLiveState/getLiveState/
// clearMatchState) — introduit pour permettre à useLiveMinute.js de corriger un
// faux FT (ESPN confirme FINAL par erreur, ex. juste après un but/carton tardif
// en fin de temps additionnel chaotique, voir Séville-Rayo 90'+8' après un
// penalty à la 90'+7' et un carton rouge à la 88') sans réintroduire le bug que
// le verrou anti-résurrection corrigeait à l'origine (mauvais matching → données
// d'un event ESPN DIFFÉRENT). Pas de couverture de _doPollESPN lui-même
// (useLiveMinute.js) ici : fonction async, fetch réseau, hors du périmètre d'un
// test unitaire simple — seule la plomberie de stockage (matchStateTracker.js,
// consommée directement par isFalseEndedReversal) est testée.
import { describe, it, expect, beforeEach } from 'vitest'
import { getLiveState, setLiveState, clearMatchState, getMatchState, markRecentlyFinished, getRecentlyFinishedMatches } from './matchStateTracker'

const MID = 1

beforeEach(() => {
  localStorage.clear()
})

describe('setLiveState / getLiveState — espnEventId', () => {
  it('état par défaut (jamais vu) : unknown, espnEventId null', () => {
    expect(getLiveState(MID)).toEqual({ state: 'unknown', since: null, endedAt: null, espnEventId: null })
  })

  it('state="ended" avec espnEventId : round-trip complet', () => {
    setLiveState(MID, 'ended', { endedAt: 1000, espnEventId: '401882918' })
    expect(getLiveState(MID)).toEqual({ state: 'ended', since: null, endedAt: 1000, espnEventId: '401882918' })
  })

  it('state="ended" sans espnEventId fourni : espnEventId reste null (pas planté)', () => {
    setLiveState(MID, 'ended', { endedAt: 1000 })
    expect(getLiveState(MID).espnEventId).toBeNull()
  })

  it('repasser à state="live" efface espnEventId (un match vraiment relancé ne doit pas garder une trace de fin)', () => {
    setLiveState(MID, 'ended', { endedAt: 1000, espnEventId: '401882918' })
    setLiveState(MID, 'live')
    expect(getLiveState(MID)).toEqual({ state: 'live', since: null, endedAt: null, espnEventId: null })
  })

  it('ne touche pas aux autres champs déjà stockés (kickoffAt, espnClock...)', () => {
    localStorage.setItem(`foot_ms_${MID}`, JSON.stringify({ kickoffAt: 500, espnClock: '10:00' }))
    setLiveState(MID, 'ended', { endedAt: 1000, espnEventId: '401882918' })
    const st = getMatchState(MID)
    expect(st.kickoffAt).toBe(500)
    expect(st.espnClock).toBe('10:00')
    expect(st.liveState).toBe('ended')
  })
})

describe('clearMatchState({ preserveEnded: true })', () => {
  it('conserve endedEspnEventId (pas seulement liveState/endedAt) au nettoyage 5min post-FT', () => {
    setLiveState(MID, 'ended', { endedAt: 1000, espnEventId: '401882918' })
    localStorage.setItem(`foot_ms_${MID}`, JSON.stringify({
      ...getMatchState(MID),
      kickoffAt: 500, espnClock: '90:00', ft: true, termineAt: 1000,
    }))
    clearMatchState(MID, { preserveEnded: true })
    const st = getMatchState(MID)
    // Tout le reste (kickoffAt, espnClock, ft...) doit bien être effacé
    expect(st.kickoffAt).toBeUndefined()
    expect(st.espnClock).toBeUndefined()
    expect(st.ft).toBeUndefined()
    // Mais l'info nécessaire à isFalseEndedReversal doit survivre
    expect(getLiveState(MID)).toEqual({ state: 'ended', since: null, endedAt: 1000, espnEventId: '401882918' })
  })

  it('sans preserveEnded (ou liveState !== "ended") : efface tout, y compris espnEventId', () => {
    setLiveState(MID, 'ended', { endedAt: 1000, espnEventId: '401882918' })
    clearMatchState(MID)
    expect(getLiveState(MID)).toEqual({ state: 'unknown', since: null, endedAt: null, espnEventId: null })
  })
})

describe('markRecentlyFinished / getRecentlyFinishedMatches — matchday/stage', () => {
  const baseMatch = {
    id: MID,
    utcDate: '2026-08-15T19:30:00.000Z',
    homeTeam: { id: 243, name: 'Sevilla' },
    awayTeam: { id: 101, name: 'Rayo Vallecano' },
    competition: { code: 'PD' },
    score: { fullTime: { home: 1, away: 1 } },
  }

  it('conserve matchday/stage quand présents sur le match source (constat utilisateur : le pont "Résultats" atterrissait dans sa propre case "15 août" au lieu de "Journée 1")', () => {
    markRecentlyFinished({ ...baseMatch, matchday: 1 })
    const [m] = getRecentlyFinishedMatches('PD')
    expect(m.matchday).toBe(1)
    expect(m.stage).toBeNull()
  })

  it('stage préservé pour un match à élimination directe (matchday absent par nature côté FD.org)', () => {
    markRecentlyFinished({ ...baseMatch, matchday: null, stage: 'QUARTER_FINALS' })
    const [m] = getRecentlyFinishedMatches('PD')
    expect(m.matchday).toBeNull()
    expect(m.stage).toBe('QUARTER_FINALS')
  })

  it('sans matchday/stage sur le match source (ex. NL/CAN/COPA, sourcés ESPN) : reste null des deux côtés, comportement inchangé', () => {
    markRecentlyFinished(baseMatch)
    const [m] = getRecentlyFinishedMatches('PD')
    expect(m.matchday).toBeNull()
    expect(m.stage).toBeNull()
  })
})
