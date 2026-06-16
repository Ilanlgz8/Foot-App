import { useTeamForm } from '../hooks/useTeamForm'
import { translateTeam } from '../data/teamNames'
import './../matchModal.css'

function FormBadge({ result }) {
  const label = result === 'W' ? 'V' : result === 'D' ? 'N' : 'D'
  return <span className={`modal__formeBadge modal__formeBadge--${result}`}>{label}</span>
}

function MatchModal({ match, compId, onClose }) {
  const { formMap } = useTeamForm(compId)

  if (!match) return null

  const homeForm = formMap[match.homeTeam?.id] ?? []
  const awayForm = formMap[match.awayTeam?.id] ?? []

  const isFinished = match.status === 'FINISHED'
  const hs  = match.score?.fullTime?.home
  const as_ = match.score?.fullTime?.away
  const hWin = isFinished && hs > as_
  const aWin = isFinished && as_ > hs

  const formatHour = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const formatDate = (d) => {
    const today    = new Date(); today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
    const date     = new Date(d); date.setHours(0,0,0,0)
    if (date.getTime() === today.getTime())    return "Aujourd'hui"
    if (date.getTime() === tomorrow.getTime()) return 'Demain'
    return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  return (
    <div className="modal__overlay" onClick={onClose}>
      <div className="modal__panel" onClick={e => e.stopPropagation()}>

        <button className="modal__close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="modal__header">
          <span className="modal__kicker">{match.competition?.name}</span>
          <span className="modal__journee">Journée {match.matchday}</span>
        </div>

        {/* Équipes + score */}
        <div className="modal__teams">
          <div className="modal__team">
            {match.homeTeam.crest && (
              <img src={match.homeTeam.crest} alt="" className="modal__crest"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <span className="modal__teamName">
              {translateTeam(match.homeTeam.shortName || match.homeTeam.name)}
            </span>
          </div>

          <div className="modal__vs">
            {isFinished ? (
              <div className="modal__scoreboard">
                <span className={`modal__scoreNum ${hWin ? 'modal__scoreNum--win' : ''}`}>{hs}</span>
                <span className="modal__scoreSep">–</span>
                <span className={`modal__scoreNum ${aWin ? 'modal__scoreNum--win' : ''}`}>{as_}</span>
              </div>
            ) : (
              <>
                <span className="modal__date">{formatDate(match.utcDate)}</span>
                <span className="modal__hour">{formatHour(match.utcDate)}</span>
              </>
            )}
            {isFinished && <span className="modal__ftLabel">Terminé</span>}
          </div>

          <div className="modal__team modal__team--away">
            {match.awayTeam.crest && (
              <img src={match.awayTeam.crest} alt="" className="modal__crest"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <span className="modal__teamName">
              {translateTeam(match.awayTeam.shortName || match.awayTeam.name)}
            </span>
          </div>
        </div>

        {/* Forme récente */}
        {(homeForm.length > 0 || awayForm.length > 0) && (
          <div className="modal__formes">
            {homeForm.length > 0 && (
              <div className="modal__forme">
                <span className="modal__formeLabel">
                  {translateTeam(match.homeTeam.shortName || match.homeTeam.name)}
                </span>
                <div className="modal__formeBadges">
                  {homeForm.map((r, i) => <FormBadge key={i} result={r} />)}
                </div>
              </div>
            )}
            {awayForm.length > 0 && (
              <div className="modal__forme">
                <span className="modal__formeLabel">
                  {translateTeam(match.awayTeam.shortName || match.awayTeam.name)}
                </span>
                <div className="modal__formeBadges">
                  {awayForm.map((r, i) => <FormBadge key={i} result={r} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default MatchModal
