// TendancesView — onglet "Tendances" de Classement.jsx : vue d'ensemble de la
// compétition (buts marqués, évolution par journée, meilleures attaques/
// défenses). Construit UNIQUEMENT à partir de données déjà disponibles côté
// client (standings + liste des matchs terminés, déjà fetchées ailleurs dans
// l'app) — aucun nouvel appel réseau dédié, aucune nouvelle fonction serverless.
//
// Volontairement absents : classement des cartons et répartition des buts
// minute par minute. Ces deux angles nécessiteraient de récupérer le détail
// événement par événement de CHAQUE match (cartons, minute exacte de chaque
// but) — football-data.org ne les expose pas dans la liste des matchs, il
// faudrait un appel par match. Sur le plan gratuit (10 req/min), ça ferait
// exploser le rate limit pour une compétition à plusieurs dizaines de
// matchs. Pas fabriqué, donc pas affiché.
import { useMemo } from 'react'
import { translateTeam } from '../data/teamNames'
import '../tendances.css'

function sumGoals(matches) {
  return matches.reduce((acc, m) => {
    const h = m.score?.fullTime?.home
    const a = m.score?.fullTime?.away
    if (h == null || a == null) return acc
    return acc + h + a
  }, 0)
}

// Regroupe les matchs terminés pour tracer l'évolution du nombre de buts :
//   - phase de poules → par journée (match.matchday), comme Programme/Résultats
//   - phase à élimination directe (matchday toujours null) → par date, un
//     regroupement par tour serait trop épars (souvent 1 seul match/tour avant
//     les quarts) ; la date donne une vraie courbe lisible.
function groupGoalsByRound(matches) {
  const withScore = matches.filter(m => m.score?.fullTime?.home != null && m.score?.fullTime?.away != null)
  const groupStage = withScore.filter(m => m.matchday != null)
  const knockout    = withScore.filter(m => m.matchday == null)

  const byMd = {}
  groupStage.forEach(m => {
    byMd[m.matchday] = (byMd[m.matchday] ?? 0) + m.score.fullTime.home + m.score.fullTime.away
  })
  const mdEntries = Object.keys(byMd)
    .map(Number).sort((a, b) => a - b)
    .map(day => ({ key: `md-${day}`, label: `J${day}`, goals: byMd[day] }))

  const byDate = {}
  knockout.forEach(m => {
    const day = new Date(m.utcDate).toISOString().slice(0, 10)
    byDate[day] = (byDate[day] ?? 0) + m.score.fullTime.home + m.score.fullTime.away
  })
  const dateEntries = Object.keys(byDate).sort()
    .map(day => ({
      key: day,
      label: new Date(day).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
      goals: byDate[day],
    }))

  return [...mdEntries, ...dateEntries]
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
            loading="lazy"
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

export function TendancesView({ standings, matches, loading, isCountry }) {
  const finished = useMemo(
    () => (matches ?? []).filter(m => m.status === 'FINISHED'),
    [matches]
  )

  const totalGoals = useMemo(() => sumGoals(finished), [finished])
  const playedCount = useMemo(
    () => finished.filter(m => m.score?.fullTime?.home != null && m.score?.fullTime?.away != null).length,
    [finished]
  )
  const avgGoals = playedCount > 0 ? totalGoals / playedCount : 0

  const rounds = useMemo(() => groupGoalsByRound(finished), [finished])
  const maxGoals = Math.max(1, ...rounds.map(r => r.goals))

  const eligible = (standings ?? []).filter(t => t.playedGames > 0)
  const bestAttacks  = [...eligible].sort((a, b) => (b.goalsFor ?? 0) - (a.goalsFor ?? 0)).slice(0, 5)
  const bestDefenses = [...eligible].sort((a, b) => (a.goalsAgainst ?? 0) - (b.goalsAgainst ?? 0)).slice(0, 5)

  if (loading) {
    return <div className="trends"><p className="trends__hint">Calcul des tendances…</p></div>
  }

  if (playedCount === 0 && eligible.length === 0) {
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

      {rounds.length >= 2 && (
        <div className="trends__panel">
          <p className="trends__panelTitle">Évolution des buts</p>
          <div className="trends__chart">
            {rounds.map(r => (
              <div key={r.key} className="trends__bar" title={`${r.label} — ${r.goals} but${r.goals > 1 ? 's' : ''}`}>
                <div className="trends__barFill" style={{ '--bar-h': `${Math.max(4, (r.goals / maxGoals) * 100)}%` }} />
                <span className="trends__barLabel">{r.label}</span>
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
        Cartons et répartition minute par minute pas encore disponibles pour cette vue.
      </p>
    </div>
  )
}
