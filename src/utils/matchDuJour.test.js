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

  it('un match de coupe domestique (tour préliminaire, code = championnat parent) ne devance jamais un vrai match de championnat/tournoi (constat utilisateur : Pinatarense-Melilla/Copa del Rey élu devant Espagne-Angleterre/NL)', () => {
    const cupPrelim = { ...makeMatch('PD', 'Atlético Pinatarense', 'Atlético Melilla', 20), isCup: true, competition: { code: 'PD', name: 'Copa del Rey' } }
    const nl = makeMatch('NL', 'Espagne', 'Angleterre', 13)
    expect(pickMatchDuJour([cupPrelim, nl])).toBe(nl)
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

  it('deux clubs élite battent deux gros clubs, même à une heure plus tôt (constat utilisateur : Arsenal-Chelsea > Juventus-Milan)', () => {
    // Cas réel du dimanche 06/09 : les 2 matchs valaient exactement 4 avant
    // le 3e niveau, et seul le coup d'envoi le plus tardif tranchait — la
    // Juventus (20h45) passait devant Arsenal-Chelsea (17h30) sans aucune
    // raison sportive.
    const arsChe = makeMatch('PL', 'Arsenal', 'Chelsea', 15)
    const juvMil = makeMatch('SA', 'Juventus', 'Milan', 20)
    expect(pickMatchDuJour([arsChe, juvMil])).toBe(arsChe)
  })

  it('une élite + un gros club devance deux gros clubs', () => {
    // ⚠️ Séville → Atlético Madrid (11/09) : Séville a été déplacé de
    // BIG_TEAMS vers NOTABLE_TEAMS (voir son commentaire dans matchDuJour.js,
    // constat utilisateur "Rennes-Marseille > Valence-Séville") — l'exemple
    // avait besoin d'un club toujours à 2 points pour rester valide.
    const mixte = makeMatch('PD', 'Real Madrid', 'Atlético Madrid', 13)
    const gros  = makeMatch('SA', 'Juventus', 'Milan', 20)
    expect(pickMatchDuJour([mixte, gros])).toBe(mixte)
  })

  it('Rennes-Marseille devance Valence-Séville, même avec un coup d\'envoi plus tôt (constat utilisateur 11/09)', () => {
    // Avant le déplacement de Séville vers NOTABLE_TEAMS, ce cas produisait
    // exactement une égalité (Marseille 2 + Rennes 1 = Séville 2 + Valence 1
    // = 3), départagée uniquement par le coup d'envoi le plus tardif — sans
    // lien avec quel match est réellement le plus intéressant.
    const rennesOm    = makeMatch('FL1', 'Rennes', 'Marseille', 15)
    const valenceSeville = makeMatch('PD', 'Valence', 'Séville', 21)
    expect(pickMatchDuJour([rennesOm, valenceSeville])).toBe(rennesOm)
  })

  it('garde le match du jour ÉPINGLÉ une fois lancé, au lieu de sauter au suivant', () => {
    // Avant ce fix, seuls SCHEDULED/TIMED étaient candidats : au coup d'envoi
    // le match élu quittait le lot et la carte basculait sur un autre match.
    const enCours = { ...makeMatch('PL', 'Arsenal', 'Chelsea', 15), status: 'IN_PLAY' }
    const aVenir1 = makeMatch('SA', 'Juventus', 'Milan', 20)
    const aVenir2 = makeMatch('FL1', 'Paris SG', 'Monaco', 21)
    expect(pickMatchDuJour([enCours, aVenir1, aVenir2])).toBe(enCours)
  })

  // ⚠️ RETOURNÉ (16/09, demande explicite : "quand le match est terminé faut
  // bien qu'elle disparaisse comme toutes les autres") — ce test vérifiait
  // l'ANCIEN comportement (rester affiché avec le score final). Inversé :
  // une fois FINISHED, la carte disparaît (null), même s'il reste un match
  // à venir ce jour-là (pas de bascule vers un autre match, voir le
  // commentaire détaillé dans matchDuJour.js).
  it('disparaît (null) une fois le match élu terminé, même s\'il reste un match à venir', () => {
    const termine = { ...makeMatch('PL', 'Arsenal', 'Chelsea', 15), status: 'FINISHED' }
    const aVenir  = makeMatch('SA', 'Fiorentina', 'Torino', 20)
    expect(pickMatchDuJour([termine, aVenir])).toBeNull()
  })

  // L'élection elle-même reste invariante au statut (le même match reste "le
  // meilleur du jour" tout du long, voir electBest) — seul l'AFFICHAGE change
  // une fois FINISHED (masqué). Ici l'élu (meilleure affiche) est toujours en
  // cours, donc bien affiché normalement.
  it('le statut n\'influence PAS l\'élection : la meilleure affiche gagne, qu\'elle soit à venir ou en cours', () => {
    const enCours = { ...makeMatch('PD', 'Real Madrid', 'Barcelona', 13), status: 'IN_PLAY' }
    const aVenir  = makeMatch('FL1', 'Toulouse', 'Lille', 20)
    expect(pickMatchDuJour([enCours, aVenir])).toBe(enCours)
  })

  it('LE MÊME match reste élu toute la journée tant qu\'il n\'est pas terminé, puis la carte disparaît', () => {
    // Cas réel signalé le 02/09 : le match du jour se termine et un AUTRE
    // match, encore en cours, prend sa place sur l'Accueil — corrigé en
    // rendant l'élection invariante au statut. Le 16/09, demande explicite
    // inverse le comportement APRÈS la fin : au lieu de rester affiché avec
    // le score final, la carte disparaît désormais purement et simplement.
    const faire = (statutChoc, statutAutre) => ([
      { ...makeMatch('PD', 'Real Madrid', 'Barcelona', 13), status: statutChoc },
      { ...makeMatch('FL1', 'Toulouse', 'Lille', 20), status: statutAutre },
    ])
    const etapes = [
      { jour: faire('SCHEDULED', 'SCHEDULED'), attendu: 'Real Madrid' },  // matin
      { jour: faire('IN_PLAY',   'SCHEDULED'), attendu: 'Real Madrid' },  // le choc démarre
      { jour: faire('FINISHED',  'IN_PLAY'),   attendu: null },           // le choc se termine → disparaît
      { jour: faire('FINISHED',  'FINISHED'),  attendu: null },           // fin de journée
    ]
    for (const { jour, attendu } of etapes) {
      const elu = pickMatchDuJour(jour)
      if (attendu === null) {
        expect(elu).toBeNull()
      } else {
        expect(elu.homeTeam.name).toBe(attendu)
      }
    }
  })

  it('ignore un match reporté ou annulé (la carte resterait bloquée dessus)', () => {
    const reporte = { ...makeMatch('PD', 'Real Madrid', 'Barcelona', 13), status: 'POSTPONED' }
    const joue1   = makeMatch('FL1', 'Toulouse', 'Lille', 20)
    const joue2   = makeMatch('FL1', 'Auxerre', 'Metz', 15)
    expect(pickMatchDuJour([reporte, joue1, joue2])).toBe(joue1)
  })

  it('un match Ligue Europa avec 2 grands clubs bat un match CAN sans grande nation, même tier', () => {
    const uel = makeMatch('UEL', 'Ajax', 'Benfica', 13)
    const can = makeMatch('CAN', 'Comores', 'Eswatini', 20)
    expect(pickMatchDuJour([uel, can])).toBe(uel)
  })

  // ⚠️ BUG CORRIGÉ (constat utilisateur, 15/09 : "quand il reste plus que
  // [le match en cours] et que les autres sont terminé il redevient comme
  // les autres cards basique") : le garde-fou "moins de 2 matchs" comptait
  // TOUT le tableau reçu — si les autres matchs finis disparaissent du flux
  // de données au fil de la journée (Accueil.jsx/useTodayMatches.js, hors
  // de cette fonction) et qu'il ne reste plus QUE le match déjà épinglé
  // (en cours ou terminé), `all.length` tombait à 1 et la carte disparaissait
  // — alors que rien n'avait changé pour ce match précis.
  it('reste élu même SEUL dans le tableau, s\'il a déjà débuté (en cours)', () => {
    const enCours = { ...makeMatch('PD', 'Real Madrid', 'Barcelona', 13), status: 'IN_PLAY' }
    expect(pickMatchDuJour([enCours])).toBe(enCours)
  })

  // ⚠️ RETOURNÉ (16/09) : avant, restait épinglé même seul et terminé — voir
  // le commentaire détaillé dans matchDuJour.js. Désormais, terminé = masqué,
  // qu'il soit seul dans le tableau ou non.
  it('disparaît (null) une fois terminé, même seul dans le tableau', () => {
    const termine = { ...makeMatch('PD', 'Real Madrid', 'Barcelona', 13), status: 'FINISHED' }
    expect(pickMatchDuJour([termine])).toBeNull()
  })

  it('un seul match JAMAIS débuté reste refusé (comportement pré-match inchangé)', () => {
    expect(pickMatchDuJour([makeMatch('PD', 'Real Madrid', 'Barcelona', 13)])).toBeNull()
  })
})
