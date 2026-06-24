/**
 * MatchPage — page dédiée à un match à venir / terminé
 * Route : /match/:matchId
 *
 * Même contenu que la MatchModal pré-match, mais en page entière.
 * Données passées via location.state.match (navigation) ou fetchées si accès direct.
 */
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useQuery }         from '@tanstack/react-query'
import { translateTeam }    from '../data/teamNames'
import { COMPETITIONS }     from '../data/competitions'
import { calcProno }        from '../utils/calcProno'
import { useTeamForm }      from '../hooks/useTeamForm'
import { useSwipe }         from '../hooks/useSwipe'
import {
  PreMatchSection,
  ComposTab,
  ClassementTab,
} from '../components/MatchModal'
import './MatchPage.css'
import '../matchModal.css'

// ── Fetch fallback si accès direct par URL ────────────────────────────────────
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

// ── Formatage date / heure ────────────────────────────────────────────────────
function formatDate(utcDate) {
  if (!utcDate) return '–'
  return new Date(utcDate).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}
function formatTime(utcDate) {
  if (!utcDate) return '–'
  return new Date(utcDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Header match ──────────────────────────────────────────────────────────────
function MatchPageHeader({ match }) {
  const comp       = COMPETITIONS.find(c => c.id === match.competition?.code)
  const homeName   = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName   = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const isFinished = match.status === 'FINISHED'
  const hs  = match.score?.fullTime?.home ?? match.score?.halfTime?.home
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

        {/* Domicile : crest en haut, nom en bas */}
        <div className="mp__team">
          {match.homeTeam?.crest
            ? <img src={match.homeTeam.crest} alt="" className="mp__crest" />
            : <div className="mp__crestFallback" />}
          <span className="mp__teamName">{homeName}</span>
        </div>

        {/* Centre : score ou heure */}
        <div className="mp__center">
          {isFinished && hs != null ? (
            <>
              <div className="mp__scoreFinished">{hs} – {as_}</div>
              <div className="mp__statusLabel">Terminé</div>
            </>
          ) : (
            <>
              <div className="mp__time">{formatTime(match.utcDate)}</div>
              <div className="mp__date">{formatDate(match.utcDate)}</div>
            </>
          )}
        </div>

        {/* Extérieur : crest en haut, nom en bas (même ordre que domicile) */}
        <div className="mp__team">
          {match.awayTeam?.crest
            ? <img src={match.awayTeam.crest} alt="" className="mp__crest" />
            : <div className="mp__crestFallback" />}
          <span className="mp__teamName">{awayName}</span>
        </div>

      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
const TABS = ['statistiques', 'compos', 'classement']

export default function MatchPage() {
  const { matchId } = useParams()
  const navigate    = useNavigate()
  const location    = useLocation()

  const stateMatch = location.state?.match ?? null
  const { data: fetchedMatch, isLoading } = useMatchData(matchId, stateMatch)
  const match = stateMatch ?? fetchedMatch

  const compId = match?.competition?.code ?? null
  const { formMap, compMatches, isLoading: formLoading } = useTeamForm(compId)

  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]
  const prono = (hForm || aForm) ? calcProno(hForm, aForm) : null

  const [activeTab, setActiveTab] = useState('statistiques')
  const [tabDir, setTabDir]       = useState(null)

  const goTab = (t, dir) => { setTabDir(dir); setActiveTab(t) }

  const swipe = useSwipe(
    () => {
      const i = TABS.indexOf(activeTab)
      if (i < TABS.length - 1) goTab(TABS[i + 1], 'left')
    },
    () => {
      const i = TABS.indexOf(activeTab)
      if (i > 0) goTab(TABS[i - 1], 'right')
      else navigate(-1) // premier onglet + swipe droite = retour
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
      <div className="mp__wrap">
        <button className="mp__backBtn" onClick={() => navigate(-1)}>
          ‹ Retour
        </button>

        <MatchPageHeader match={match} />

        <div className="mp__body" ref={swipe.ref}>

          {/* Sidebar tabs (desktop) / barre horizontale (mobile) */}
          <div className="mp__tabs">
            {TABS.map(t => (
              <button
                key={t}
                className={`mp__tab${activeTab === t ? ' mp__tab--active' : ''}`}
                onClick={() => goTab(t, null)}
              >
                {t === 'statistiques' ? 'Statistiques'
               : t === 'compos'      ? 'Compos'
               :                       'Classement'}
              </button>
            ))}
          </div>

          {/* Contenu */}
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
            {activeTab === 'statistiques' && (
              formLoading
                ? <div className="mp__tabLoading"><div className="modal__spinner" /></div>
                : <PreMatchSection
                    match={match}
                    prono={prono}
                    formMap={formMap}
                    compMatches={compMatches}
                  />
            )}
            {activeTab === 'compos'     && <ComposTab match={match} />}
            {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
          </div>
        </div>
      </div>
    </div>
  )
}
