// Tests de calcMinute/getMatchPeriod/mergeScore — la logique de minute live
// la plus fragile de l'app (débuggée à la main via des scripts Node jetables
// à plusieurs reprises cette saison : cap du temps additionnel, transitions
// prolongations/tab...). Objectif : figer ces cas limites déjà corrigés pour
// ne pas avoir à refaire cette vérification manuelle à chaque nouveau bug.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, matchOutcome } from './matchUtils'
import { setEspnData, setKickoffAt } from './matchStateTracker'

const MID = 1
const baseMatch = (over = {}) => ({
  id: MID,
  status: 'IN_PLAY',
  utcDate: '2026-07-03T18:00:00.000Z',
  ...over,
})

// Écrit directement l'état ft — utilisé ailleurs dans l'app via localStorage
// direct (pas de helper dédié dans matchStateTracker.js), donc on reproduit
// le même format de clé ici plutôt que d'inventer une API qui n'existe pas.
function setFt(matchId) {
  localStorage.setItem(`foot_ms_${matchId}`, JSON.stringify({ ft: true }))
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-03T19:00:00.000Z'))
})

describe('mergeScore', () => {
  it('garde la valeur non-nulle si une seule est connue', () => {
    expect(mergeScore(null, 2)).toBe(2)
    expect(mergeScore(3, null)).toBe(3)
  })
  it('garde le score le plus haut entre les deux sources', () => {
    expect(mergeScore(2, 5)).toBe(5)
    expect(mergeScore(5, 2)).toBe(5)
  })
  it('renvoie null si les deux sont inconnues', () => {
    expect(mergeScore(null, null)).toBeNull()
  })
})

describe('finalScore', () => {
  it('match REGULAR : renvoie fullTime tel quel', () => {
    expect(finalScore({ fullTime: { home: 2, away: 0 } })).toEqual({ home: 2, away: 0 })
  })

  it('match EXTRA_TIME (prolongations, sans tab) : fullTime déjà correct', () => {
    // Donnée réelle observée : fullTime = regularTime + extraTime, cohérent.
    expect(finalScore({
      fullTime: { home: 3, away: 2 },
      regularTime: { home: 2, away: 2 },
      extraTime: { home: 1, away: 0 },
    })).toEqual({ home: 3, away: 2 })
  })

  it('match PENALTY_SHOOTOUT : ignore fullTime (qui inclut les tab) et renvoie le score 120min', () => {
    // Donnée réelle observée en prod (CM 2026, 8e de finale) : fullTime={4,5}
    // inclut à tort les tirs au but (penalties={3,4}) en plus du score réel
    // 120min (regularTime+extraTime={1,1}). Le bug corrigé ici.
    expect(finalScore({
      fullTime: { home: 4, away: 5 },
      regularTime: { home: 1, away: 1 },
      extraTime: { home: 0, away: 0 },
      penalties: { home: 3, away: 4 },
    })).toEqual({ home: 1, away: 1 })
  })

  it('match PENALTY_SHOOTOUT après prolongations non-nulles', () => {
    expect(finalScore({
      fullTime: { home: 3, away: 4 },
      regularTime: { home: 1, away: 1 },
      extraTime: { home: 1, away: 1 },
      penalties: { home: 1, away: 2 },
    })).toEqual({ home: 2, away: 2 })
  })

  it('score absent ou vide : renvoie {home:null, away:null}', () => {
    expect(finalScore(null)).toEqual({ home: null, away: null })
    expect(finalScore({})).toEqual({ home: null, away: null })
  })
})

describe('matchOutcome', () => {
  it('victoire domicile en temps réglementaire', () => {
    expect(matchOutcome({ score: { fullTime: { home: 2, away: 0 } } })).toBe('home')
  })

  it('victoire extérieur', () => {
    expect(matchOutcome({ score: { fullTime: { home: 0, away: 1 } } })).toBe('away')
  })

  it('match nul (hors tirs au but)', () => {
    expect(matchOutcome({ score: { fullTime: { home: 1, away: 1 } } })).toBe('draw')
  })

  it('tirs au but : jamais nul, decide par score.penalties (pas le score 120min à égalité)', () => {
    expect(matchOutcome({
      score: {
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 4, away: 5 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 0, away: 0 },
        penalties: { home: 3, away: 4 },
      },
    })).toBe('away')
  })

  it('match pas terminé (score manquant) : renvoie null', () => {
    expect(matchOutcome({ score: { fullTime: { home: null, away: null } } })).toBeNull()
    expect(matchOutcome(null)).toBeNull()
  })
})

describe('calcMinute', () => {
  it('renvoie null quand le match est marqué terminé (ft)', () => {
    setFt(MID)
    expect(calcMinute(baseMatch({ status: 'FINISHED' }))).toBeNull()
  })

  it('affiche "Débute" juste après le coup d\'envoi prévu, avant confirmation ESPN', () => {
    const match = baseMatch({ status: 'SCHEDULED', utcDate: '2026-07-03T18:59:00.000Z' })
    expect(calcMinute(match)).toBe('Débute')
  })

  it('affiche "Débute" (pas "1\'") pour un match TIMED (statut FD.org des matchs WC à venir)', () => {
    // Régression constatée : le garde-fou "Débute" ne testait que status === 'SCHEDULED',
    // hors football-data.org rapporte 'TIMED' pour les matchs à venir de la Coupe du
    // monde → "Débute" ne s'affichait jamais pour un match WC, l'heuristique utcDate
    // prenait le relais immédiatement et affichait "1'" avant même la confirmation ESPN.
    const match = baseMatch({ status: 'TIMED', utcDate: '2026-07-03T18:59:00.000Z' })
    expect(calcMinute(match)).toBe('Débute')
  })

  it('affiche "Débute" (pas "1\'") si FD.org bascule sur IN_PLAY avant qu\'ESPN confirme le KO', () => {
    // Même régression, autre déclencheur : FD.org peut passer IN_PLAY de son côté
    // avant qu'ESPN ait confirmé le coup d'envoi réel (détections pas synchrones).
    const match = baseMatch({ status: 'IN_PLAY', utcDate: '2026-07-03T18:59:00.000Z' })
    expect(calcMinute(match)).toBe('Débute')
  })

  it('interpole la minute en temps réglementaire depuis le dernier poll ESPN', () => {
    setEspnData(MID, { espnClock: '42:00', espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: 2 })
    vi.advanceTimersByTime(90_000) // +1min30 depuis le poll
    expect(calcMinute(baseMatch())).toBe('43\'')
  })

  it('affiche "MT" à la mi-temps réglementaire', () => {
    setEspnData(MID, { espnClock: '45:00', espnStatus: 'STATUS_HALFTIME', espnPeriod: 1 })
    expect(calcMinute(baseMatch({ status: 'PAUSED' }))).toBe('MT')
  })

  it('distingue "Pause" (mi-temps des prolongations) de "MT" via espnPeriod', () => {
    setEspnData(MID, { espnClock: '105:00', espnStatus: 'STATUS_HALFTIME', espnPeriod: 3 })
    expect(calcMinute(baseMatch({ status: 'PAUSED' }))).toBe('Pause')
  })

  it('plafonne le temps additionnel de fin de période (STOPPAGE_CAP) au lieu de grimper indéfiniment', () => {
    setEspnData(MID, { espnClock: '90:00+8:00', espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: 1 })

    // +5min depuis le poll : 8+5=13min de temps additionnel, encore sous le plafond (15)
    vi.advanceTimersByTime(5 * 60_000)
    expect(calcMinute(baseMatch())).toBe("90+13'")

    // +11min de plus (total 16min) : dépasse le plafond → "Prolongation", pas "90+24'"
    vi.advanceTimersByTime(11 * 60_000)
    expect(calcMinute(baseMatch())).toBe('Prolongation')
  })

  it('affiche "Prolongation" sur STATUS_END_PERIOD (pause avant le vrai début des prolongations)', () => {
    setEspnData(MID, { espnClock: '90:00+3:00', espnStatus: 'STATUS_END_PERIOD', espnPeriod: 1 })
    expect(calcMinute(baseMatch())).toBe('Prolongation')
  })

  it('reprend la numérotation normale dès qu\'ESPN confirme le vrai début de la 1ère prolongation', () => {
    setEspnData(MID, { espnClock: '91:00', espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: 3 })
    expect(calcMinute(baseMatch())).toBe("91'")
    vi.advanceTimersByTime(90_000)
    expect(calcMinute(baseMatch())).toBe("92'")
  })

  it('évite le faux "90+27" à la mi-temps des prolongations quand espnStatus devient inexploitable', () => {
    // Simule le poll précédent qui a bien établi qu'on est en prolongations (period 3),
    // mémorisé par setEspnData — puis un poll où espnStatus n'est plus utilisable
    // (transition ESPN), avec kickoffAt très ancien (comme dans le bug signalé).
    setKickoffAt(MID, new Date('2026-07-03T18:00:00.000Z').getTime())
    setEspnData(MID, { espnClock: '91:00', espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: 3 })
    // espnStatus devient vide sur ce poll (cas réel observé), mais espnPeriod=3 reste connu
    const stored = JSON.parse(localStorage.getItem(`foot_ms_${MID}`))
    delete stored.espnStatus
    localStorage.setItem(`foot_ms_${MID}`, JSON.stringify(stored))

    vi.advanceTimersByTime(90 * 60_000) // largement plus tard, comme dans le bug signalé
    expect(calcMinute(baseMatch())).toBe('Prolongation')
  })

  it('affiche "TAB" pendant la séance de tirs au but', () => {
    setEspnData(MID, { espnClock: '120:00', espnStatus: 'STATUS_SHOOTOUT', espnPeriod: 5 })
    expect(calcMinute(baseMatch())).toBe('TAB')
  })
})

describe('getMatchPeriod', () => {
  it('renvoie null une fois le match marqué terminé (ft)', () => {
    setFt(MID)
    expect(getMatchPeriod(baseMatch({ status: 'FINISHED' }))).toBeNull()
  })

  it('renvoie "Mi-temps" à la pause réglementaire', () => {
    setEspnData(MID, { espnClock: '45:00', espnStatus: 'STATUS_HALFTIME', espnPeriod: 1 })
    expect(getMatchPeriod(baseMatch({ status: 'PAUSED' }))).toBe('Mi-temps')
  })

  it('renvoie "Prolongations" pendant les prolongations', () => {
    setEspnData(MID, { espnClock: '95:00', espnStatus: 'STATUS_EXTRA_TIME', espnPeriod: 3 })
    expect(getMatchPeriod(baseMatch())).toBe('Prolongations')
  })

  it('renvoie "T.A.B." pendant la séance de tirs au but', () => {
    setEspnData(MID, { espnClock: '120:00', espnStatus: 'STATUS_SHOOTOUT', espnPeriod: 5 })
    expect(getMatchPeriod(baseMatch())).toBe('T.A.B.')
  })
})
