// TendancesView — onglet "Tendances" de Classement.jsx : vue d'ensemble de la
// compétition (buts marqués, répartition par période, domicile/extérieur,
// matchs les plus prolifiques, meilleures attaques/défenses).
//
// ⚠️ Meilleures attaques/défenses : NE PAS utiliser standings[].goalsFor —
// pour une compétition à élimination directe (WC, CL...), football-data.org
// fige goalsFor/goalsAgainst à la fin de la phase de poules : les buts
// marqués/encaissés en 8es/quarts/demies/finale n'y sont JAMAIS ajoutés. Une
// équipe qui marque en poules puis enchaîne plusieurs matchs à élimination
// directe se retrouvait donc sous-comptée (constat utilisateur : chiffres
// faux dès que la phase de poules est terminée). On recalcule à la place
// nous-mêmes en additionnant les scores de TOUS les matchs terminés
// (poules + élimination directe), déjà présents dans `matches`.
//
// ⚠️ Répartition par minute (ESPN) abandonnée : la CM en est à ~85 matchs
// FINISHED. Résoudre chaque match FD.org → event ESPN nécessitait d'interroger
// ~25-30 dates de scoreboard puis jusqu'à ~85 summaries — ESPN groupe son
// scoreboard par date locale du stade (pas UTC), et à ce volume une partie
// des requêtes échouait silencieusement (rate limit / timeout), même en
// limitant la concurrence. Résultat : peu fiable en pratique. Remplacé par
// des métriques calculées UNIQUEMENT à partir des matchs football-data.org
// déjà en main (mêmes données que les KPI ci-dessous, déjà fiables) : aucun
// appel réseau supplémentaire, aucune résolution ESPN, donc rien qui puisse
// silencieusement ne rien renvoyer.
//
// Volontairement absent : classement des cartons (nécessiterait la même
// résolution ESPN fragile) — pas fabriqué, donc pas affiché.
import { useMemo } from 'react'
import { translateTeam } from '../data/teamNames'
import { finalScore } from '../utils/matchUtils'
import '../tendances.css'

// ⚠️ Partout ci-dessous : NE PAS lire match.score.fullTime directement — pour
// un match décidé aux tirs au but, FD.org y met regularTime+extraTime+
// penalties CUMULÉS (bug confirmé en prod), pas le score 120min. On passe
// systématiquement par finalScore() (matchUtils.js), qui isole le vrai score
// 120min (tab exclus).
function sumGoals(matches) {
  return matches.reduce((acc, m) => {
    const { home: h, away: a } = finalScore(m.score)
    if (h == null || a == null) return acc
    return acc + h + a
  }, 0)
}

// Additionne buts marqués/encaissés par équipe sur TOUS les matchs terminés
// fournis (poules ET élimination directe) — contrairement à standings[], qui
// s'arrête à la fin des poules pour ce genre de compétition.
function aggregateTeamGoals(matches) {
  const map = new Map()
  for (const m of matches) {
    const { home: hs, away: as } = finalScore(m.score)
    const home = m.homeTeam
    const away = m.awayTeam
    if (hs == null || as == null || !home?.id || !away?.id) continue

    if (!map.has(home.id)) map.set(home.id, { team: home, goalsFor: 0, goalsAgainst: 0, played: 0 })
    if (!map.has(away.id)) map.set(away.id, { team: away, goalsFor: 0, goalsAgainst: 0, played: 0 })

    const h = map.get(home.id)
    h.goalsFor += hs; h.goalsAgainst += as; h.played += 1

    const a = map.get(away.id)
    a.goalsFor += as; a.goalsAgainst += hs; a.played += 1
  }
  return [...map.values()]
}

// Répartition 1ère mi-temps / 2e mi-temps (+ prolongations éventuelles) —
// calculée à partir de score.halfTime et finalScore(), déjà fournis par
// football-data.org pour chaque match terminé (aucun appel en plus, aucune
// dépendance ESPN). Pour un match allé en prolongations, le 2e bloc inclut
// les buts des prolongations : le libellé le précise pour rester honnête.
function halfSplit(matches) {
  let firstHalf = 0, secondHalfPlus = 0
  for (const m of matches) {
    const ht = m.score?.halfTime
    const ft = finalScore(m.score)
    if (ht?.home == null || ht?.away == null || ft.home == null || ft.away == null) continue
    firstHalf += ht.home + ht.away
    secondHalfPlus += Math.max(0, (ft.home - ht.home) + (ft.away - ht.away))
  }
  return { firstHalf, secondHalfPlus }
}

// Buts marqués à domicile vs à l'extérieur — même source, aucun appel en plus.
function homeAwaySplit(matches) {
  let home = 0, away = 0
  for (const m of matches) {
    const ft = finalScore(m.score)
    if (ft.home == null || ft.away == null) continue
    home += ft.home
    away += ft.away
  }
  return { home, away }
}

// Les matchs les plus prolifiques (le plus de buts marqués au total).
function topScoringMatches(matches, n = 3) {
  return matches
    .map(m => ({ match: m, fs: finalScore(m.score) }))
    .filter(({ fs }) => fs.home != null && fs.away != null)
    .map(({ match, fs }) => ({ match, fs, total: fs.home + fs.away }))
    .sort((a, b) => b.total - a.total || new Date(b.match.utcDate) - new Date(a.match.utcDate))
    .slice(0, n)
}

function TeamRankRow({ rank, team, value, isCountry }) {
  return (
    <div className="trends__rankRow">
      <span className="trends__rankPos">{rank}</span>
      {team.crest && (
        <div className="trends__rankCrest" data-crest={isCountry ? 'country' : 'club'}>
          <img
            src={team.crest}
            alt=""
            data-team={team.name}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        </div>
      )}
      <span className="trends__rankName">{translateTeam(team.shortName || team.name)}</span>
      <span className="trends__rankValue">{value}</span>
    </div>
  )
}

function TwoBarChart({ bars }) {
  const maxGoals = Math.max(1, ...bars.map(b => b.goals))
  return (
    <div className="trends__chart">
      {bars.map(b => (
        <div key={b.key} className="trends__bar" title={`${b.label} — ${b.goals} but${b.goals > 1 ? 's' : ''}`}>
          <div className="trends__barFill" style={{ '--bar-h': `${Math.max(4, (b.goals / maxGoals) * 100)}%` }} />
          <span className="trends__barLabel">{b.label} ({b.goals})</span>
        </div>
      ))}
    </div>
  )
}

export function TendancesView({ matches, loading, isCountry }) {
  const finished = useMemo(
    () => (matches ?? []).filter(m => m.status === 'FINISHED'),
    [matches]
  )

  const totalGoals = useMemo(() => sumGoals(finished), [finished])
  const playedCount = useMemo(
    () => finished.filter(m => {
      const fs = finalScore(m.score)
      return fs.home != null && fs.away != null
    }).length,
    [finished]
  )
  const avgGoals = playedCount > 0 ? totalGoals / playedCount : 0

  const { firstHalf, secondHalfPlus } = useMemo(() => halfSplit(finished), [finished])
  const hasHalfData = firstHalf + secondHalfPlus > 0

  const { home: homeGoals, away: awayGoals } = useMemo(() => homeAwaySplit(finished), [finished])
  const hasHomeAwayData = homeGoals + awayGoals > 0

  const topMatches = useMemo(() => topScoringMatches(finished, 3), [finished])

  const teamGoals = useMemo(() => aggregateTeamGoals(finished), [finished])
  const bestAttacks  = [...teamGoals].sort((a, b) => (b.goalsFor ?? 0) - (a.goalsFor ?? 0)).slice(0, 5)
  const bestDefenses = [...teamGoals].sort((a, b) => (a.goalsAgainst ?? 0) - (b.goalsAgainst ?? 0)).slice(0, 5)

  if (loading) {
    return <div className="trends"><p className="trends__hint">Calcul des tendances…</p></div>
  }

  if (playedCount === 0 && teamGoals.length === 0) {
    return (
      <div className="trends">
        <p className="trends__hint">Pas encore assez de matchs joués pour dégager des tendances.</p>
      </div>
    )
  }

  return (
    <div className="trends">
      <div className="trends__kpis">
        <div className="trends__kpi">
          <span className="trends__kpiValue">{totalGoals}</span>
          <span className="trends__kpiLabel">Buts marqués</span>
        </div>
        <div className="trends__kpi">
          <span className="trends__kpiValue">{playedCount}</span>
          <span className="trends__kpiLabel">Matchs joués</span>
        </div>
        <div className="trends__kpi">
          <span className="trends__kpiValue">{avgGoals.toFixed(2)}</span>
          <span className="trends__kpiLabel">Buts / match</span>
        </div>
      </div>

      <div className="trends__grid">
        {hasHalfData && (
          <div className="trends__panel">
            <p className="trends__panelTitle">Buts par période</p>
            <TwoBarChart bars={[
              { key: '1h', label: '1ère MT',            goals: firstHalf },
              { key: '2h', label: '2e MT (+ prolong.)', goals: secondHalfPlus },
            ]} />
          </div>
        )}
        {hasHomeAwayData && (
          <div className="trends__panel">
            <p className="trends__panelTitle">Domicile vs extérieur</p>
            <TwoBarChart bars={[
              { key: 'h', label: 'Domicile',  goals: homeGoals },
              { key: 'a', label: 'Extérieur', goals: awayGoals },
            ]} />
          </div>
        )}
      </div>

      {topMatches.length > 0 && (
        <div className="trends__panel">
          <p className="trends__panelTitle">Matchs les plus prolifiques</p>
          <div className="trends__rankList">
            {topMatches.map(({ match, fs, total }, i) => (
              <div key={match.id} className="trends__rankRow">
                <span className="trends__rankPos">{i + 1}</span>
                <span className="trends__rankName">
                  {translateTeam(match.homeTeam?.shortName || match.homeTeam?.name)} {fs.home}-{fs.away} {translateTeam(match.awayTeam?.shortName || match.awayTeam?.name)}
                </span>
                <span className="trends__rankValue">{total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(bestAttacks.length > 0 || bestDefenses.length > 0) && (
        <div className="trends__grid">
          {bestAttacks.length > 0 && (
            <div className="trends__panel">
              <p className="trends__panelTitle">Meilleures attaques</p>
              <div className="trends__rankList">
                {bestAttacks.map((t, i) => (
                  <TeamRankRow key={t.team.id} rank={i + 1} team={t.team} value={t.goalsFor} isCountry={isCountry} />
                ))}
              </div>
            </div>
          )}
          {bestDefenses.length > 0 && (
            <div className="trends__panel">
              <p className="trends__panelTitle">Meilleures défenses</p>
              <div className="trends__rankList">
                {bestDefenses.map((t, i) => (
                  <TeamRankRow key={t.team.id} rank={i + 1} team={t.team} value={t.goalsAgainst} isCountry={isCountry} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="trends__disclaimer">
        Données football-data.org, calculées à partir des matchs terminés de cette compétition.
      </p>
    </div>
  )
}
