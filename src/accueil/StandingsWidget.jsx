import { useNavigate } from 'react-router-dom'
import { useStandings } from '../hooks/useStandings'
import { StandingsTable } from '../components/StandingsTable'
import { COMPETITIONS } from '../data/competitions'

// StandingsWidget — aperçu compact (top 4) du classement d'une compétition,
// sur l'Accueil. Réutilise StandingsTable (déjà utilisé par Classement.jsx
// et MatchModal.jsx) en mode compact. Masqué s'il n'y a aucune donnée (pas
// de placeholder vide, même logique que le H2H et la carte Match du jour).
export function StandingsWidget({ compId }) {
  const navigate = useNavigate()
  const { standings, groups, loading, error } = useStandings(compId)
  const comp = COMPETITIONS.find(c => c.id === compId)

  // Compétition à groupes (ex: phase de groupes du Mondial) : `standings` est
  // la concaténation de tous les groupes bout à bout — prendre les 4
  // premiers dessus mélangerait des équipes de groupes différents en le
  // faisant passer pour un classement général qui n'existe pas. On montre
  // à la place le premier groupe, explicitement nommé.
  const isMultiGroup = (groups?.length ?? 0) > 1
  const rows = isMultiGroup ? (groups[0]?.table ?? []).slice(0, 4) : (standings ?? []).slice(0, 4)
  const groupLabel = isMultiGroup ? (groups[0]?.name ?? '').replace('GROUP_', 'Groupe ') : null

  if (error) return null
  if (!loading && rows.length === 0) return null

  return (
    <div className="accueil__standingsPanel">
      <div className="accueil__standingsPanelHeader">
        {comp?.emblem && <img src={comp.emblem} alt="" className="accueil__standingsCompLogo" />}
        <h2 className="accueil__standingsPanelTitle">
          Classement{comp?.shortName ? ` — ${comp.shortName}` : ''}{groupLabel ? ` (${groupLabel})` : ''}
        </h2>
        <button className="accueil__liveDirectBtn" onClick={() => navigate('/classement')}>
          Voir tout <span className="accueil__livePageBtnArrow">›</span>
        </button>
      </div>
      <div className="accueil__standingsPanelBody">
        {rows.length === 0
          ? <div className="accueil__tickerEmpty">Chargement…</div>
          : <StandingsTable rows={rows} compact />}
      </div>
    </div>
  )
}
