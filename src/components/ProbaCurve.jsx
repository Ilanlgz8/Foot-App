// ProbaCurve — courbe de bascule post-match : comment la proba de victoire
// (calcLiveProno) a évolué minute par minute pendant le match. Basée sur des
// échantillons agrégés côté serveur (voir api/curve.js) — n'apparaît que si
// au moins un spectateur a suivi ce match en direct (aucune donnée
// inventée si personne ne l'a suivi : la section reste alors masquée).
import { useProbaCurve } from '../hooks/useProbaCurve'
import '../probaCurve.css'

export function ProbaCurve({ matchId, homeShort, awayShort }) {
  const { samples } = useProbaCurve(matchId, !!matchId)

  if (samples.length < 2) return null

  const width  = 100
  const height = 40
  const maxMinute = Math.max(...samples.map(s => s.minute), 90)

  const toX = (minute) => (minute / maxMinute) * width
  const toY = (pct)    => height - (pct / 100) * height

  const homePoints = samples.map(s => `${toX(s.minute).toFixed(1)},${toY(s.home).toFixed(1)}`).join(' ')
  const awayPoints = samples.map(s => `${toX(s.minute).toFixed(1)},${toY(s.away).toFixed(1)}`).join(' ')

  return (
    <div className="curve">
      <p className="curve__title">Courbe de bascule</p>
      <svg className="curve__svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1="0" y1={toY(50)} x2={width} y2={toY(50)} className="curve__midline" vectorEffect="non-scaling-stroke" />
        <polyline points={awayPoints} className="curve__line curve__line--away" vectorEffect="non-scaling-stroke" />
        <polyline points={homePoints} className="curve__line curve__line--home" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="curve__legend">
        <span className="curve__legendItem curve__legendItem--home">{homeShort}</span>
        <span className="curve__legendItem curve__legendItem--away">{awayShort}</span>
      </div>
    </div>
  )
}
