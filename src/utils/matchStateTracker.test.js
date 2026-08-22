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
import { getLiveState, setLiveState, clearMatchState, getMatchState, markRecentlyFinished, getRecentlyFinishedMatches, shouldShowLiveWidget, clearFtFlags } from './matchStateTracker'

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

describe('shouldShowLiveWidget — décision unique Live.jsx/Accueil.jsx (anti-réapparition)', () => {
  // IDs dédiés à ce describe : _dismissedFt (matchStateTracker.js) est
  // module-level, donc partagé entre TOUS les tests du fichier — réutiliser
  // MID=1 (déjà manipulé par les describe précédents) pourrait faire fuiter
  // un dismiss d'un test à l'autre.
  it('match IN_PLAY sans ft : visible', () => {
    expect(shouldShowLiveWidget({ id: 501, status: 'IN_PLAY' })).toBe(true)
  })

  it('match PAUSED/SCHEDULED sans ft : visible (coup d\'envoi imminent/mi-temps)', () => {
    expect(shouldShowLiveWidget({ id: 502, status: 'PAUSED' })).toBe(true)
    expect(shouldShowLiveWidget({ id: 502, status: 'SCHEDULED' })).toBe(true)
  })

  it('match FINISHED sans ft ni statut live : invisible', () => {
    expect(shouldShowLiveWidget({ id: 503, status: 'FINISHED' })).toBe(false)
  })

  it('ft=true, encore dans la fenêtre de grâce (8s) : visible', () => {
    localStorage.setItem('foot_ms_504', JSON.stringify({ ft: true, termineAt: Date.now() }))
    expect(shouldShowLiveWidget({ id: 504, status: 'IN_PLAY' })).toBe(true)
  })

  it('ft=true, fenêtre de grâce dépassée : invisible, ET reste invisible pour CE MÊME événement de fin même si rappelé ensuite (anti-réapparition)', () => {
    const termineAt = Date.now() - 60_000 // largement > 8s
    localStorage.setItem('foot_ms_505', JSON.stringify({ ft: true, termineAt }))
    const match = { id: 505, status: 'IN_PLAY' } // status figé IN_PLAY côté liveTracker, comme en prod
    expect(shouldShowLiveWidget(match)).toBe(false)
    // Rappel ultérieur (ex. remount de la page) — même termineAt, aucune
    // nouvelle donnée : doit rester caché, jamais ré-afficher.
    expect(shouldShowLiveWidget(match)).toBe(false)
    expect(shouldShowLiveWidget(match)).toBe(false)
  })

  it('ré-confirmations multiples de la MÊME vraie fin (termineAt différent à chaque fois) : reste invisible, ne clignote plus', () => {
    // Root cause du clignotement signalé (jusqu'à 2min après la vraie fin) :
    // confirmFt() peut être ré-appelé plusieurs fois pour le même match par
    // différents garde-fous (pendingFt timeout, durée max live, FD.org
    // FINISHED, disparu du scoreboard...) — chacun pose un termineAt FRAIS.
    // L'ancien dismiss (matché sur la valeur exacte de termineAt) traitait
    // chaque nouveau termineAt comme un tout nouvel événement de fin, donc
    // réarmait la fenêtre de grâce de 8s à chaque fois → clignotement.
    const match = { id: 507, status: 'IN_PLAY' }
    const termineAt1 = Date.now() - 60_000
    localStorage.setItem('foot_ms_507', JSON.stringify({ ft: true, termineAt: termineAt1 }))
    expect(shouldShowLiveWidget(match)).toBe(false) // 1ère confirmation, dismiss

    // Re-confirmation par un autre garde-fou, quelques dizaines de secondes
    // plus tard, NOUVEAU termineAt — doit rester invisible, pas se réarmer.
    const termineAt2 = Date.now() - 30_000
    localStorage.setItem('foot_ms_507', JSON.stringify({ ft: true, termineAt: termineAt2 }))
    expect(shouldShowLiveWidget(match)).toBe(false)

    // Encore une 3e re-confirmation, termineAt tout frais (< 8s) — même une
    // fenêtre de grâce "techniquement valide" ne doit pas suffire à
    // réafficher un match déjà dismiss cette session.
    localStorage.setItem('foot_ms_507', JSON.stringify({ ft: true, termineAt: Date.now() }))
    expect(shouldShowLiveWidget(match)).toBe(false)
  })

  it('résurrection légitime (clearFtFlags — faux FT vérifié) : redevient visible normalement', () => {
    const termineAt = Date.now() - 60_000
    localStorage.setItem('foot_ms_506', JSON.stringify({ ft: true, termineAt }))
    const match = { id: 506, status: 'IN_PLAY' }
    expect(shouldShowLiveWidget(match)).toBe(false) // dismiss

    // Une simple réécriture localStorage qui efface ft SANS passer par
    // clearFtFlags() ne doit PLUS suffire à réautoriser le réaffichage —
    // exactement le comportement qui causait le clignotement (voir test
    // précédent).
    localStorage.setItem('foot_ms_506', JSON.stringify({}))
    expect(shouldShowLiveWidget(match)).toBe(false)

    // Seule vraie sortie légitime : clearFtFlags() (faux FT VÉRIFIÉ, voir
    // isFalseEndedReversal dans useLiveMinute.js).
    clearFtFlags(506)
    expect(shouldShowLiveWidget(match)).toBe(true)

    // Une 2e vraie fin, NOUVEAU termineAt : redémarre normalement le cycle
    // (visible dans la fenêtre de grâce, comme un tout premier FT)
    const termineAt2 = Date.now()
    localStorage.setItem('foot_ms_506', JSON.stringify({ ft: true, termineAt: termineAt2 }))
    expect(shouldShowLiveWidget(match)).toBe(true)
  })

  it('match sans id : invisible sans planter', () => {
    expect(shouldShowLiveWidget({ status: 'IN_PLAY' })).toBe(false)
    expect(shouldShowLiveWidget(null)).toBe(false)
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
