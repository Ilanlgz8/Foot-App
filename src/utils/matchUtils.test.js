// Tests de calcMinute/getMatchPeriod/mergeScore — la logique de minute live
// la plus fragile de l'app (débuggée à la main via des scripts Node jetables
// à plusieurs reprises cette saison : cap du temps additionnel, transitions
// prolongations/tab...). Objectif : figer ces cas limites déjà corrigés pour
// ne pas avoir à refaire cette vérification manuelle à chaque nouveau bug.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, matchOutcome, resolveFdTeamId, isRealFdMatchId, resolveFdMatchId } from './matchUtils'
import { setEspnData, setKickoffAt, setHalf2Start, trackMatchState, recordEspnMiss } from './matchStateTracker'

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

  it('interpole la minute en temps réglementaire depuis le dernier poll ESPN (bootstrap, half2Start pas encore ancré)', () => {
    setEspnData(MID, { espnClock: '42:00', espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: 2 })
    vi.advanceTimersByTime(90_000) // +1min30 depuis le poll
    expect(calcMinute(baseMatch())).toBe('43\'')
  })

  it('1ère MT : chronomètre depuis kickoffAt (ancre réelle), pas depuis le clock ESPN — reste juste même si espnClock/espnCapturedAt sont périmés', () => {
    // kickoffAt ancré à la vraie 3e minute (comme le fait "KO détecté", useLiveMinute.js).
    setKickoffAt(MID, Date.now() - 3 * 60_000)
    // espnClock volontairement FAUX/PÉRIMÉ (ex. un vieux poll jamais rafraîchi) : si le
    // calcul dépendait encore de l'interpolation ESPN, on obtiendrait un résultat basé
    // sur "10:00", pas sur kickoffAt. La garantie testée est que ça n'arrive plus.
    setEspnData(MID, { espnClock: '10:00', espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: 1 })
    vi.advanceTimersByTime(10 * 60_000) // +10min réelles sans nouveau poll
    expect(calcMinute(baseMatch())).toBe("13'") // 3 + 10, depuis kickoffAt — pas depuis "10:00"+10min
  })

  it('2e MT : chronomètre depuis half2Start (ancre réelle), pas depuis le clock ESPN — reprend bien à la 46e', () => {
    setHalf2Start(MID, Date.now()) // reprise de la 2e MT confirmée à l'instant T
    setEspnData(MID, { espnClock: '46:00', espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: 2 })
    expect(calcMinute(baseMatch())).toBe("46'")

    // +20min réelles SANS aucun nouveau poll (espnClock reste figé sur "46:00") : le
    // chronométrage local doit quand même avancer normalement, minute par minute.
    vi.advanceTimersByTime(20 * 60_000)
    expect(calcMinute(baseMatch())).toBe("66'")
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
    // (aucun nouveau poll simulé ici à dessein : l'interpolation doit continuer à
    // extrapoler sans limite tant que le compteur d'échecs de matching — voir le
    // test espnMissStreak ci-dessous — n'est pas atteint, notamment pour rester
    // exploitable après une longue mise en veille iOS sans poll du tout.)
    vi.advanceTimersByTime(11 * 60_000)
    expect(calcMinute(baseMatch())).toBe('Prolongation')
  })

  it('espnMissStreak : cesse de faire confiance à un espnStatus resté figé après plusieurs échecs de matching consécutifs, et retombe sur les heuristiques locales au lieu d\'extrapoler indéfiniment', () => {
    // Mi-temps détectée 15min plus tôt, puis reprise de la 2e MT confirmée par
    // ESPN à la 46e minute réelle (pausedAt ET half2Start tous deux ancrés,
    // comme dans le vrai flux HT→2H de useLiveMinute.js — le fallback
    // half2Start plus bas n'est utilisé QUE si pausedAt est déjà connu).
    const half2StartTs = Date.now()
    trackMatchState({ id: MID, status: 'PAUSED' }, half2StartTs - 15 * 60_000)
    setHalf2Start(MID, half2StartTs)
    setEspnData(MID, { espnClock: '46:00', espnStatus: 'STATUS_IN_PROGRESS', espnPeriod: 2 })
    expect(calcMinute(baseMatch())).toBe("46'")

    // Le matching ESPN↔FD.org échoue ensuite pendant plusieurs polls d'affilée
    // (recordEspnMiss appelé par useLiveMinute.js à chaque poll global réussi où
    // ce match est absent de la réponse — voir matchUtils.js/MAX_ESPN_MISS_STREAK).
    // Sous le seuil (4 échecs) : espnStatus reste utilisé normalement même si
    // le temps a un peu avancé.
    vi.advanceTimersByTime(2 * 60_000)
    for (let i = 0; i < 4; i++) recordEspnMiss(MID)
    expect(calcMinute(baseMatch())).toBe("48'") // interpolé depuis l'ancre ESPN (46:00 + 2min)

    // Le 5e échec consécutif atteint le seuil : sans le garde-fou,
    // interpolateEspnMinute continuerait d'extrapoler pour toujours depuis
    // l'ancre ESPN figée. Avec le garde-fou, on retombe sur half2Start (ancré
    // sur un vrai timestamp observé) — la garantie testée est le décrochage de
    // la source ESPN, pas la valeur exacte (les deux coïncident ici puisqu'ils
    // étaient synchronisés au départ).
    recordEspnMiss(MID)
    expect(calcMinute(baseMatch())).toBe("48'")
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

  it('n\'affiche PLUS null si ESPN indique FINAL mais que le FT n\'est pas encore confirmé (bug réel signalé : "j\'ai eu comme quoi le match est fini alors qu\'il est pas fini, on est encore dans le temps additionnel")', () => {
    // Simule un match en tout début de temps additionnel de la 2ème MT (46min
    // après la reprise, donc minute réelle 90+2) sur lequel ESPN vient
    // d'envoyer un STATUS_FINAL — potentiel glitch ponctuel de l'API ESPN, PAS
    // encore confirmé (voir pendingFt dans useLiveMinute.js : la confirmation
    // n'a lieu qu'au 2e poll consécutif voyant FINAL, donc `ft` n'est pas
    // encore posé à ce stade). AVANT ce fix, calcMinute() renvoyait null dès
    // qu'il voyait espnStatus FINAL-ish, MÊME sans confirmation — la minute
    // (et donc l'affichage "en direct") disparaissait à tort dès le 1er poll
    // suspect.
    trackMatchState({ id: MID, status: 'PAUSED' }, new Date('2026-07-03T18:00:00.000Z').getTime())
    setHalf2Start(MID, new Date('2026-07-03T18:14:00.000Z').getTime())
    setEspnData(MID, { espnClock: '90:00+1:00', espnStatus: 'STATUS_FINAL', espnPeriod: 2 })
    const minute = calcMinute(baseMatch({ status: 'IN_PLAY' }))
    expect(minute).not.toBeNull()
    expect(minute).toBe("90+2'")
  })

  it('bascule bien sur null une fois le FT réellement confirmé (ft posé), y compris avec STATUS_FINAL', () => {
    setEspnData(MID, { espnClock: '90:00+1:00', espnStatus: 'STATUS_FINAL', espnPeriod: 2 })
    setFt(MID)
    expect(calcMinute(baseMatch({ status: 'FINISHED' }))).toBeNull()
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

// resolveFdTeamId — bug réel (26/07) : un match sourcé ESPN (les 6 grands
// championnats dans Accueil, voir espnAdapter.js) a des homeTeam.id/
// awayTeam.id dans le référentiel ESPN, incompatibles avec les id FD.org de
// compMatches — casse tout ce qui filtre par égalité stricte d'id (Forme
// récente/Stats saison/Compos probables), alors que le même match ouvert
// depuis Programme (100% FD.org, mêmes id) fonctionne.
describe('resolveFdTeamId', () => {
  const compMatches = [
    { homeTeam: { id: 86,  name: 'Real Madrid CF',     shortName: 'Real Madrid' },
      awayTeam: { id: 81,  name: 'FC Barcelona',       shortName: 'Barça' } },
    { homeTeam: { id: 78,  name: 'Club Atlético de Madrid', shortName: 'Atleti' },
      awayTeam: { id: 86,  name: 'Real Madrid CF',     shortName: 'Real Madrid' } },
  ]

  it('renvoie l\'id tel quel si déjà connu dans compMatches (cas normal, FD.org natif)', () => {
    expect(resolveFdTeamId({ id: 86, name: 'Real Madrid CF' }, compMatches)).toBe(86)
  })

  it('résout par nom un id ESPN incompatible (match sourcé ESPN, Accueil)', () => {
    // id ESPN totalement différent (ex: 244 côté ESPN pour le Real Madrid),
    // mais le nom permet de retrouver le vrai id FD.org (86) dans compMatches.
    expect(resolveFdTeamId({ id: 244, name: 'Real Madrid' }, compMatches)).toBe(86)
  })

  it('résout aussi via shortName si name ne matche pas directement', () => {
    expect(resolveFdTeamId({ id: 999, name: 'FC Barcelona', shortName: 'Barcelona' }, compMatches)).toBe(81)
  })

  it('retombe sur l\'id d\'origine si aucune correspondance trouvée', () => {
    expect(resolveFdTeamId({ id: 555, name: 'Équipe inconnue' }, compMatches)).toBe(555)
  })

  it('retombe sur l\'id d\'origine si compMatches est vide/pas encore chargé', () => {
    expect(resolveFdTeamId({ id: 244, name: 'Real Madrid' }, [])).toBe(244)
    expect(resolveFdTeamId({ id: 244, name: 'Real Madrid' }, undefined)).toBe(244)
  })

  it('gère une équipe absente sans planter', () => {
    expect(resolveFdTeamId(null, compMatches)).toBeNull()
    expect(resolveFdTeamId(undefined, compMatches)).toBeNull()
  })

  // ⚠️ Bug réel constaté par l'utilisateur (16/08) : losange "forme récente"
  // d'une AUTRE équipe affiché sous le logo de Racing, match toujours en
  // cours (id ESPN sans correspondance qui coïncide par hasard avec l'id
  // FD.org d'un club différent une fois utilisé comme clé de formMap).
  // `strict:true` : le repli sur l'id brut devient dangereux dès qu'on
  // l'utilise comme clé de dictionnaire plutôt que dans une recherche de
  // fixture à 2 id — on préfère `null` (aucune donnée) à un id emprunté à
  // une autre équipe par coïncidence numérique.
  describe('option { strict }', () => {
    it('renvoie null (pas l\'id brut) si aucune correspondance trouvée', () => {
      expect(resolveFdTeamId({ id: 555, name: 'Équipe inconnue' }, compMatches, { strict: true })).toBeNull()
    })

    it('renvoie null si compMatches est vide/pas encore chargé', () => {
      expect(resolveFdTeamId({ id: 244, name: 'Real Madrid' }, [], { strict: true })).toBeNull()
      expect(resolveFdTeamId({ id: 244, name: 'Real Madrid' }, undefined, { strict: true })).toBeNull()
    })

    it('résout toujours normalement par nom quand une correspondance existe', () => {
      expect(resolveFdTeamId({ id: 244, name: 'Real Madrid' }, compMatches, { strict: true })).toBe(86)
    })

    it('renvoie l\'id tel quel si déjà connu dans compMatches (chemin normal inchangé)', () => {
      expect(resolveFdTeamId({ id: 86, name: 'Real Madrid CF' }, compMatches, { strict: true })).toBe(86)
    })
  })

  // ⚠️ Bug réel constaté par l'utilisateur (16/08, 2e occurrence) : losange
  // "forme récente" de Deportivo (0 match joué cette saison) affichait le
  // résultat GAGNANT d'un autre club. Root cause plus profonde que le 1er fix
  // `strict` ci-dessus : l'ancien raccourci "id déjà connu dans compMatches"
  // faisait confiance à `rawId` dès qu'il existait QUELQUE PART dans
  // compMatches, MÊME associé au nom d'une équipe complètement différente —
  // un id ESPN qui coïncide par hasard avec l'id FD.org d'un AUTRE club
  // passait ce test AVANT même d'atteindre la recherche par nom (donc AVANT
  // que `strict` ait la moindre chance d'intervenir). Ce test fige le
  // comportement correct : un id "connu" mais mal attribué doit retomber sur
  // la recherche par nom, pas être accepté aveuglément.
  describe('id connu dans compMatches mais associé au MAUVAIS club (collision numérique)', () => {
    // id=81 est le vrai id FD.org de FC Barcelona dans compMatches — un id
    // ESPN pour Deportivo qui coïnciderait PAR HASARD avec 81 ne doit jamais
    // être accepté comme "id de Deportivo" juste parce que 81 existe déjà
    // dans compMatches (sous le nom de Barcelone, pas de Deportivo).
    it('avec { strict: true } : ignore l\'id trouvé si le nom associé ne correspond pas → null, pas 81', () => {
      expect(resolveFdTeamId({ id: 81, name: 'RC Deportivo' }, compMatches, { strict: true })).toBeNull()
    })

    it('sans strict : retombe sur l\'id brut (comportement par défaut inchangé, non protégé)', () => {
      expect(resolveFdTeamId({ id: 81, name: 'RC Deportivo' }, compMatches)).toBe(81)
    })

    it('le nom associé au bon id continue de fonctionner normalement (pas de faux négatif introduit)', () => {
      expect(resolveFdTeamId({ id: 81, name: 'FC Barcelona' }, compMatches, { strict: true })).toBe(81)
    })
  })

  // ⚠️ Bug réel constaté par l'utilisateur (27/07) : match Manchester City -
  // Bournemouth affichait les données de Manchester United. Cause :
  // resolveFdTeamId utilisait fuzzyTeam (préfixe 5 caractères / mot partagé),
  // qui matche à tort "Manchester City" et "Manchester United" via le mot
  // commun "Manchester" — corrigé en passant à clubNameMatch (préfixe
  // complet strict). Ce test fige le comportement correct pour ne pas
  // régresser.
  const plCompMatches = [
    { homeTeam: { id: 65, name: 'Manchester City FC',   shortName: 'Man City' },
      awayTeam: { id: 91, name: 'AFC Bournemouth',      shortName: 'Bournemouth' } },
    { homeTeam: { id: 66, name: 'Manchester United FC', shortName: 'Man United' },
      awayTeam: { id: 65, name: 'Manchester City FC',   shortName: 'Man City' } },
  ]

  it('ne confond pas 2 clubs qui partagent juste un mot (Manchester City vs Manchester United)', () => {
    // id ESPN incompatible pour Man City (comme dans le vrai bug), résolu
    // par nom — doit retrouver 65 (Man City), jamais 66 (Man United).
    expect(resolveFdTeamId({ id: 111, name: 'Manchester City' }, plCompMatches)).toBe(65)
    expect(resolveFdTeamId({ id: 222, name: 'Manchester United' }, plCompMatches)).toBe(66)
  })

  it('ne confond pas non plus via shortName (Man City vs Man United)', () => {
    expect(resolveFdTeamId({ id: 111, name: '?', shortName: 'Man City' }, plCompMatches)).toBe(65)
    expect(resolveFdTeamId({ id: 222, name: '?', shortName: 'Man United' }, plCompMatches)).toBe(66)
  })
})

// resolveFdMatchId — bug réel (26/07) : "dans Accueil t'as que 2 h2h, dans
// Programme t'as le vrai historique, pour le MÊME match" — un match sourcé
// ESPN a un id `espn-PL-...`, pas un vrai id numérique FD.org, donc l'appel
// FD.org /head2head (qui a besoin de l'id du MATCH, pas des équipes) était
// entièrement désactivé côté Accueil.
describe('isRealFdMatchId', () => {
  it('reconnaît un id FD.org numérique', () => {
    expect(isRealFdMatchId(542447)).toBe(true)
    expect(isRealFdMatchId('542447')).toBe(true)
  })

  it('rejette un id ESPN ou vide', () => {
    expect(isRealFdMatchId('espn-PL-401584580')).toBe(false)
    expect(isRealFdMatchId(null)).toBe(false)
    expect(isRealFdMatchId(undefined)).toBe(false)
  })
})

describe('resolveFdMatchId', () => {
  const compMatches = [
    { id: 542447, utcDate: '2025-09-22T18:45:00Z',
      homeTeam: { id: 516, name: 'Olympique de Marseille' },
      awayTeam: { id: 524, name: 'Paris Saint-Germain FC' } },
    { id: 500001, utcDate: '2025-02-01T20:00:00Z',
      homeTeam: { id: 524, name: 'Paris Saint-Germain FC' },
      awayTeam: { id: 516, name: 'Olympique de Marseille' } },
  ]

  it('renvoie l\'id tel quel si déjà un vrai id FD.org (match natif Programme)', () => {
    const match = { id: 542447, homeTeam: { id: 516 }, awayTeam: { id: 524 } }
    expect(resolveFdMatchId(match, compMatches)).toBe(542447)
  })

  it('résout l\'id FD.org réel pour un match sourcé ESPN (Accueil), au plus proche de la date', () => {
    const match = {
      id: 'espn-FL1-401700001',
      utcDate: '2025-09-22T18:45:00Z',
      homeTeam: { id: 516, name: 'Olympique de Marseille' },
      awayTeam: { id: 524, name: 'Paris Saint-Germain FC' },
    }
    expect(resolveFdMatchId(match, compMatches)).toBe(542447)
  })

  it('fonctionne aussi si domicile/extérieur sont inversés dans compMatches', () => {
    const match = {
      id: 'espn-FL1-401700002',
      utcDate: '2025-02-01T20:00:00Z',
      homeTeam: { id: 524 },
      awayTeam: { id: 516 },
    }
    expect(resolveFdMatchId(match, compMatches)).toBe(500001)
  })

  it('renvoie null si aucune correspondance ou compMatches vide/absent', () => {
    const match = { id: 'espn-PL-999', homeTeam: { id: 1 }, awayTeam: { id: 2 } }
    expect(resolveFdMatchId(match, compMatches)).toBeNull()
    expect(resolveFdMatchId(match, [])).toBeNull()
    expect(resolveFdMatchId(match, undefined)).toBeNull()
  })

  it('gère un match absent sans planter', () => {
    expect(resolveFdMatchId(null, compMatches)).toBeNull()
    expect(resolveFdMatchId(undefined, compMatches)).toBeNull()
  })
})

// Bug réel (27/07) : H2H vide pour Toulouse-Lyon vu depuis Accueil, alors que
// ça marche depuis Programme. Cause : ESPN nomme l'OL simplement "Lyon", qui
// est un SUFFIXE (jamais un préfixe) des variantes FD.org ("Olympique Lyon"/
// "Olympique Lyonnais") — clubNameMatch (préfixe strict) ne matche donc
// jamais cette paire précise.
//
// 2 tentatives de fix ont modifié clubNameMatch/resolveFdTeamId directement
// et ont CASSÉ l'Accueil en prod à chaque fois (plus aucun match affiché),
// pour une raison jamais identifiée avec certitude (la 2e tentative avait
// pourtant toute la fonction protégée par try/catch, ce qui exclut une
// exception non gérée comme mécanisme). clubNameMatch reste donc strictement
// intacte.
//
// Design retenu à la place : un paramètre `{ loose }` optionnel, désactivé
// par défaut, qui n'active la résolution assouplie (via translateTeam +
// normalize, dans looseTeamNameMatch) que pour les appelants qui le
// demandent explicitement (MatchPage.jsx / LiveMatchPage.jsx). Les cards
// Accueil (MatchPoster.jsx, MatchDuJourCard.jsx) appellent useH2HRows sans
// ce paramètre et ne peuvent donc structurellement jamais exécuter ce
// nouveau chemin — garantie par construction, pas seulement par ces tests.
describe('resolveFdTeamId — option { loose } (bug Toulouse-Lyon)', () => {
  const fl1CompMatches = [
    { homeTeam: { id: 511, name: 'Toulouse FC', shortName: 'Toulouse' },
      awayTeam: { id: 523, name: 'Olympique Lyonnais', shortName: 'Olympique Lyon' } },
  ]

  it('sans { loose } (défaut), "Lyon" (nom ESPN) ne résout PAS vers l\'id FD.org — comportement inchangé', () => {
    expect(resolveFdTeamId({ id: 777, name: 'Lyon' }, fl1CompMatches)).toBe(777)
  })

  it('avec { loose: true }, "Lyon" (nom ESPN) résout bien vers l\'id FD.org de l\'OL (523)', () => {
    expect(resolveFdTeamId({ id: 777, name: 'Lyon' }, fl1CompMatches, { loose: true })).toBe(523)
  })

  it('avec { loose: true }, Toulouse (déjà matché par clubNameMatch) continue de résoudre normalement', () => {
    expect(resolveFdTeamId({ id: 888, name: 'Toulouse' }, fl1CompMatches, { loose: true })).toBe(511)
  })
})

describe('resolveFdMatchId — option { loose } (bug Toulouse-Lyon)', () => {
  const fl1CompMatches = [
    { id: 600001, utcDate: '2025-10-04T18:00:00Z',
      homeTeam: { id: 511, name: 'Toulouse FC', shortName: 'Toulouse' },
      awayTeam: { id: 523, name: 'Olympique Lyonnais', shortName: 'Olympique Lyon' } },
  ]
  const espnMatch = {
    id: 'espn-FL1-401700099',
    utcDate: '2025-10-04T18:00:00Z',
    homeTeam: { id: 777, name: 'Toulouse' },
    awayTeam: { id: 778, name: 'Lyon' },
  }

  it('sans { loose } (défaut), aucune correspondance trouvée — comportement inchangé (Accueil)', () => {
    expect(resolveFdMatchId(espnMatch, fl1CompMatches)).toBeNull()
  })

  it('avec { loose: true }, résout le vrai id FD.org du match Toulouse-Lyon', () => {
    expect(resolveFdMatchId(espnMatch, fl1CompMatches, { loose: true })).toBe(600001)
  })
})
