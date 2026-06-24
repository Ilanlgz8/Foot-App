/**
 * MatchPage — page dédiée à un match à venir / terminé
 * Route : /match/:matchId
 *
 * Reçoit les données du match via location.state (navigation depuis la liste)
 * ou les recharge depuis football-data.org si accès direct par URL.
 */
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useQuery }       from '@tanstack/react-query'
import { translateTeam }  from '../data/teamNames'
import { COMPETITIONS }   from '../data/competitions'
import { calcProno }      from '../utils/calcProno'
import { useTeamForm }    from '../hooks/useTeamForm'
import { useSwipe }       from '../hooks/useSwipe'
import {
  ComposTab,
  ClassementTab,
  PronoSection,
} from '../components/MatchModal'
import './MatchPage.css'

// ── Fetch match depuis football-data.org (fallback accès direct) ──────────────
function useMatchData(matchId, initialMatch) {
  return useQuery({
    queryKey:  ['match', matchId],
    queryFn:   async () => {
      const res = await fetch(`/api/football?apiPath=/v4/matches/${matchId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled:   !initialMatch && !!matchId,
    staleTime: 5 * 60_000,
  })
}

// ── Formatage date ─────────────────────────────────────────────────────────────
function formatMatchDate(utcDate) {
  if (!utcDate) return '–'
  const d = new Date(utcDate)
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function formatMatchTime(utcDate) {
  if (!utcDate) return '–'
  const d = new Date(utcDate)
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Header match ──────────────────────────────────────────────────────────────
function MatchPageHeader({ match }) {
  const comp      = COMPETITIONS.find(c => c.id === match.competition?.code)
  const homeName  = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName  = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const isFinished = match.status === 'FINISHED'
  const hs = match.score?.fullTime?.home ?? match.score?.halfTime?.home
  const as_ = match.score?.fullTime?.away ?? match.score?.halfTime?.away

  return (
    <div className="mp__header">
      {/* Compétition */}
      {comp && (
        <div className="mp__comp">
          {comp.emblem && <img src={comp.emblem} alt="" className="mp__compEmb" />}
          <span>{comp.name}</span>
        </div>
      )}

      {/* Teams + score / date */}
      <div className="mp__scoreRow">
        {/* Domicile */}
        <div className="mp__team">
          {match.homeTeam?.crest
            ? <img src={match.homeTeam.crest} alt="" className="mp__crest" />
            : <div className="mp__crestFallback" />}
          <span className="mp__teamName">{homeName}</span>
        </div>

        {/* Centre : score ou date */}
        <div className="mp__center">
          {isFinished && hs != null ? (
            <>
              <div className="mp__scoreFinished">{hs} – {as_}</div>
              <div className="mp__statusLabel">Terminé</div>
            </>
          ) : (
            <>
              <div className="mp__time">{formatMatchTime(match.utcDate)}</div>
              <div className="mp__date">{formatMatchDate(match.utcDate)}</div>
            </>
          )}
        </div>

        {/* Extérieur */}
        <div className="mp__team mp__team--away">
          <span className="mp__teamName">{awayName}</span>
          {match.awayTeam?.crest
            ? <img src={match.awayTeam.crest} alt="" className="mp__crest" />
            : <div className="mp__crestFallback" />}
        </div>
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
const TABS = ['prono', 'compos', 'classement']

export default function MatchPage() {
  const { matchId }  = useParams()
  const navigate     = useNavigate()
  const location     = useLocation()

  // Données passées via navigate state (navigation normale)
  const stateMatch = location.state?.match ?? null

  // Fallback si accès direct par URL
  const { data: fetchedMatch, isLoading } = useMatchData(matchId, stateMatch)
  const match = stateMatch ?? fetchedMatch

  const compId  = match?.competition?.code ?? null
  const { formMap } = useTeamForm(compId)
  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]
  const prono = (hForm || aForm) ? calcProno(hForm, aForm) : null

  const visibleTabs = prono ? TABS : TABS.filter(t => t !== 'prono')
  const [activeTab, setActiveTab] = useState(() => prono ? 'prono' : 'compos')
  const [tabDir, setTabDir]       = useState(null)

  // Recalcule l'onglet par défaut quand le prono arrive
  useEffect(() => {
    if (prono && activeTab === 'compos' && !location.state?.tab) setActiveTab('prono')
  }, [!!prono])

  const goTab = (t, dir) => { setTabDir(dir); setActiveTab(t) }

  // Swipe gauche → onglet suivant, swipe droite → retour
  const swipe = useSwipe(
    () => {
      const i = visibleTabs.indexOf(activeTab)
      if (i < visibleTabs.length - 1) goTab(visibleTabs[i + 1], 'left')
    },
    () => {
      const i = visibleTabs.indexOf(activeTab)
      if (i > 0) goTab(visibleTabs[i - 1], 'right')
      else navigate(-1) // premier onglet → retour page précédente
    }
  )

  if (isLoading || !match) {
    return (
      <div className="mp__page">
        <div className="mp__loading">
          <div className="modal__spinner" />
          <p>Chargement du match…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mp__page">
      {/* Bouton retour */}
      <button className="mp__backBtn" onClick={() => navigate(-1)}>
        ‹ Retour
      </button>

      {/* Header */}
      <MatchPageHeader match={match} />

      {/* Onglets + contenu */}
      <div ref={swipe.ref}>
        <div className="mp__tabs">
          {visibleTabs.map(t => (
            <button
              key={t}
              className={`mp__tab${activeTab === t ? ' mp__tab--active' : ''}`}
              onClick={() => goTab(t, null)}
            >
              {t === 'prono'      ? 'Prono'
             : t === 'compos'    ? 'Compos'
             :                     'Classement'}
            </button>
          ))}
        </div>

        <div
          key={activeTab}
          className={`mp__tabContent${
            !swipe.isDragging && tabDir === 'left'  ? ' mp__tabContent--fromRight' :
            !swipe.isDragging && tabDir === 'right' ? ' mp__tabContent--fromLeft'  : ''
          }`}
          style={{
            transform:  swipe.isDragging ? `translateX(${swipe.dragOffset}px)` : undefined,
            transition: swipe.isDragging ? 'none' : undefined,
          }}
        >
          {activeTab === 'prono' && (
            <PronoSection
              prono={prono}
              homeShort={match.homeTeam?.shortName || match.homeTeam?.name}
              awayShort={match.awayTeam?.shortName || match.awayTeam?.name}
            />
          )}
          {activeTab === 'compos'     && <ComposTab match={match} />}
          {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
        </div>
      </div>
    </div>
  )
}
