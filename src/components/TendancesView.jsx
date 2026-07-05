// TendancesView — onglet "Tendances" de Classement.jsx : vue d'ensemble de la
// compétition (buts marqués, répartition des buts par minute de jeu,
// meilleures attaques/défenses).
//
// Les KPI + meilleures attaques/défenses viennent de standings + liste des
// matchs terminés, déjà fetchées ailleurs dans l'app (aucun appel réseau
// dédié). La répartition par minute vient d'ESPN (useGoalsByMinute.js) —
// seule source qui expose la minute exacte de chaque but ; voir le
// commentaire de ce hook pour le détail du coût réseau et pourquoi ce n'est
// pas possible via football-data.org.
//
// Volontairement absent : classement des cartons (ESPN les expose aussi via
// comp.details, mais rien ne les agrège encore ici — pas fabriqué, donc pas
// affiché tant que ce n'est pas fait).
import { useMemo } from 'react'
import { translateTeam } from '../data/teamNames'
import { useGoalsByMinute } from '../hooks/useGoalsByMinute'
import '../tendances.css'

function sumGoals(matches) {
  return matches.reduce((acc, m) => {
    const h = m.score?.fullTime?.home
    const a = m.score?.fullTime?.away
    if (h == null || a == null) return acc
    return acc + h + a
  }, 0)
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

export function TendancesView({ selectedComp, standings, matches, loading, isCountry }) {
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

  const { data: minuteData, isLoading: minuteLoading } = useGoalsByMinute(selectedComp, finished)
  const rounds = minuteData?.rounds ?? []
  const maxGoals = Math.max(1, ...rounds.map(r => r.goals))
  const hasMinuteData = rounds.some(r => r.goals > 0)

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

      <div className="trends__panel">
        <p className="trends__panelTitle">Répartition des buts par minute</p>
        {minuteLoading ? (
          <p className="trends__hint" style={{ padding: '1.2rem 0' }}>Analyse des buts en cours…</p>
        ) : hasMinuteData ? (
          <div className="trends__chart">
            {rounds.map(r => (
              <div key={r.key} className="trends__bar" title={`${r.label}' — ${r.goals} but${r.goals > 1 ? 's' : ''}`}>
                <div className="trends__barFill" style={{ '--bar-h': `${Math.max(4, (r.goals / maxGoals) * 100)}%` }} />
                <span className="trends__barLabel">{r.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="trends__hint">Données ESPN indisponibles pour cette compétition.</p>
        )}
      </div>

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
        Buts par minute : données ESPN, calculées à partir des matchs terminés de cette compétition.
      </p>
    </div>
  )
}
