import { describe, it, expect } from 'vitest'
import { pickMatchDuJour } from './matchDuJour'

function makeMatch(compCode, homeName, awayName, hour) {
  return {
    status: 'SCHEDULED',
    utcDate: `2026-08-28T${String(hour).padStart(2, '0')}:00:00Z`,
    competition: { code: compCode },
    homeTeam: { name: homeName },
    awayTeam: { name: awayName },
  }
}

// Même chose mais avec les DEUX champs renseignés comme le fait football-data.org
// (shortName court + name long) — sert à vérifier que la reconnaissance d'une
// équipe ne dépend pas du champ regardé (voir teamMatchesSet, matchDuJour.js).
function makeMatchFd(compCode, home, away, hour) {
  return {
    status: 'SCHEDULED',
    utcDate: `2026-08-28T${String(hour).padStart(2, '0')}:00:00Z`,
    competition: { code: compCode },
    homeTeam: { shortName: home[0], name: home[1] },
    awayTeam: { shortName: away[0], name: away[1] },
  }
}

describe('pickMatchDuJour', () => {
  it('retourne null avec moins de 2 matchs à venir', () => {
    expect(pickMatchDuJour([makeMatch('FL1', 'Lens', 'Brest', 13)])).toBeNull()
  })

  it('priorise une affiche entre 2 grands clubs même à une heure plus tôt (constat utilisateur)', () => {
    const clasico = makeMatch('PD', 'Real Madrid', 'Barcelona', 13)
    const anonyme = makeMatch('PD', 'Girona', 'Alavés', 20)
    expect(pickMatchDuJour([clasico, anonyme])).toBe(clasico)
  })

  it('1 grand club bat 0 grand club, même à égalité de compétition', () => {
    const avecGrandClub = makeMatch('PL', 'Arsenal', 'Fulham', 13)
    const sansGrandClub = makeMatch('PL', 'Burnley', 'Bournemouth', 20)
    expect(pickMatchDuJour([avecGrandClub, sansGrandClub])).toBe(avecGrandClub)
  })

  it('la Ligue des Champions garde priorité sur un match de grands clubs en championnat', () => {
    const cl = makeMatch('CL', 'Monaco', 'Auxerre', 13)
    const clasico = makeMatch('PD', 'Real Madrid', 'Barcelona', 20)
    expect(pickMatchDuJour([cl, clasico])).toBe(cl)
  })

  it('à prestige égal, garde le départage par coup d\'envoi le plus tardif', () => {
    const tot = makeMatch('FL1', 'Lens', 'Brest', 13)
    const tard = makeMatch('FL1', 'Toulouse', 'Nantes', 20)
    expect(pickMatchDuJour([tot, tard])).toBe(tard)
  })

  it('une compétition auparavant absente (Euro, Ligue des Nations, CAN, Copa America, Ligue Europa, Supercoupe UEFA, TDC/CS) peut désormais devenir match du jour', () => {
    const nl = makeMatch('NL', 'France', 'Allemagne', 13)
    const autreNl = makeMatch('NL', 'Malte', 'Andorre', 20)
    expect(pickMatchDuJour([nl, autreNl])).toBe(nl)
  })

  it('la Coupe du monde garde la priorité sur l\'Euro et la Ligue des Champions', () => {
    const wc = makeMatch('WC', 'Panama', 'Curaçao', 13)
    const clasico = makeMatch('CL', 'Real Madrid', 'Barcelona', 20)
    expect(pickMatchDuJour([wc, clasico])).toBe(wc)
  })

  it('un club "notable" (2e niveau) bat un match sans aucune équipe listée (constat utilisateur : Toulouse-Lille > R. Sociedad-Celta)', () => {
    // Cas réel constaté le 02/09 sur l'Accueil : aucune des 4 équipes n'était
    // listée, donc score 0 partout, et seul le coup d'envoi le plus tardif
    // départageait — R. Sociedad-Celta (21:00) passait devant Toulouse-Lille
    // (20:45). Ici les 2 comps sont dans le MÊME tier (PD et FL1 = tier 3),
    // donc c'est bien le score d'affiche qui doit trancher.
    const touLil = makeMatch('FL1', 'Toulouse', 'Lille', 13)
    const socCel = makeMatch('PD', 'Real Sociedad', 'Celta Vigo', 20)
    expect(pickMatchDuJour([touLil, socCel])).toBe(touLil)
  })

  it('un vrai choc entre grands clubs reste devant un match entre clubs seulement "notables"', () => {
    const choc     = makeMatch('PD', 'Real Madrid', 'Barcelona', 13)
    const notables = makeMatch('FL1', 'Toulouse', 'Lille', 20)
    expect(pickMatchDuJour([choc, notables])).toBe(choc)
  })

  it('un grand club + un notable devance deux notables', () => {
    const mixte    = makeMatch('FL1', 'Marseille', 'Lens', 13)
    const notables = makeMatch('FL1', 'Toulouse', 'Nice', 20)
    expect(pickMatchDuJour([mixte, notables])).toBe(mixte)
  })

  it('reconnaît une équipe listée quel que soit le champ fourni (shortName court OU name long)', () => {
    // Noms réels tels que renvoyés par football-data.org : sans le test sur
    // les 2 champs, un match arrivant sans shortName exploitable (cas ESPN)
    // ou avec seulement le nom long serait compté 0 en silence.
    const touLil = makeMatchFd('FL1', ['Toulouse', 'Toulouse FC'], ['Lille', 'LOSC Lille'], 13)
    const anonyme = makeMatchFd('FL1', ['Auxerre', 'AJ Auxerre'], ['Metz', 'FC Metz'], 20)
    expect(pickMatchDuJour([touLil, anonyme])).toBe(touLil)

    // Cas où SEUL le nom long est fourni : ça ne marche que si la table de
    // traduction connaît ce nom long. Vérifié en exécutant translateTeam sur
    // les vrais noms : "AS Roma" → "Rome" et "SS Lazio" → "SS Lazio" y sont,
    // alors que "LOSC Lille"/"Toulouse FC" n'y sont PAS (ils restent tels
    // quels). Autrement dit, pour les clubs français la reconnaissance repose
    // sur `shortName` (toujours fourni par football-data.org, c'est d'ailleurs
    // lui qui est affiché sur la card) ; regarder les 2 champs sert surtout
    // aux clubs italiens/allemands, dont c'est le nom LONG qui est traduit.
    const parLongNameSeul = makeMatch('SA', 'AS Roma', 'Bologna FC 1909', 13)
    const anonyme2        = makeMatch('SA', 'Empoli FC', 'US Lecce', 20)
    expect(pickMatchDuJour([parLongNameSeul, anonyme2])).toBe(parLongNameSeul)
  })

  it('un match Ligue Europa avec 2 grands clubs bat un match CAN sans grande nation, même tier', () => {
    const uel = makeMatch('UEL', 'Ajax', 'Benfica', 13)
    const can = makeMatch('CAN', 'Comores', 'Eswatini', 20)
    expect(pickMatchDuJour([uel, can])).toBe(uel)
  })
})
