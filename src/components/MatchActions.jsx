// Boutons en haut à droite des pages de match (22/11) : Partager (image du match, direct et
// Résultat) et Ajouter au calendrier (match à venir). Voir shareCard.js / calendarEvent.js.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { renderShareCard, shareImage } from '../utils/shareCard'
import { buildMatchSummary } from '../utils/matchSummary'
import { getMatchTeamColors } from '../data/teamPhotos'
import { compForMatch, getCompetitionCampColors } from '../data/competitions'
import { matchEventInfo, openIcs, googleCalendarUrl, markAdded } from '../utils/calendarEvent'

const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
)
const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M12 13v4M10 15h4" />
  </svg>
)

const dropInitial = n => String(n ?? '').trim().replace(/^[A-ZÀ-Ý]\.\s+/, '')

// Lignes « icône, nom, minute » d'une équipe : buts groupés par joueur, puis cartons rouges.
export function shareLines(scorers = [], cards = [], side) {
  const goals = scorers.filter(s => !s.shootout && (s.team === 'home' ? 'home' : 'away') === side)
  const byName = new Map()
  for (const g of goals) {
    const key = dropInitial(g.name) || '?'
    const m = `${String(g.minute ?? '').replace(/'$/, '')}'`.replace(/^'$/, '')
    const label = m + (g.penaltyKick ? ' (pen.)' : g.ownGoal ? ' (csc)' : '')
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(label)
  }
  const lines = [...byName.entries()].map(([name, mins]) => ({ kind: 'goal', name, minutes: mins.join(', ') }))
  for (const c of cards.filter(c => c.red && (c.team === 'home' ? 'home' : 'away') === side)) {
    lines.push({ kind: 'red', name: dropInitial(c.name), minutes: `${String(c.minute ?? '').replace(/'$/, '')}'` })
  }
  return lines
}

function frDateShort(utcDate) {
  const d = new Date(utcDate)
  if (Number.isNaN(d.getTime())) return ''
  const s = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function ShareMatchButton({ match, homeName, awayName, homeCrest, awayCrest, hs, as, scorers, cards, isFinished, statusLabel, compName }) {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      const colors = getMatchTeamColors(match.homeTeam?.name ?? homeName, match.awayTeam?.name ?? awayName)
      const goals = (scorers ?? []).filter(s => !s.shootout).map(s => ({ side: s.team === 'home' ? 'home' : 'away', name: s.name, minute: s.minute, ownGoal: s.ownGoal, penaltyKick: s.penaltyKick }))
      const md = match.matchday ? ` · J${match.matchday}` : ''
      const compObj = compForMatch(match)
      const blob = await renderShareCard({
        palette: getCompetitionCampColors(compObj) ?? null,
        compLogo: compObj?.emblem ?? match.competition?.emblem ?? null,
        compLogoOpaque: !!compObj?.emblemOpaque,
        // filigrane : nom court, sauf s'il est abrégé (« Premier L. » → nom complet)
        compLabel: (compObj?.shortName && !compObj.shortName.endsWith('.')) ? compObj.shortName : (compObj?.name ?? compName ?? ''),
        home: { name: homeName, crest: homeCrest ?? match.homeTeam?.crest, color: colors.home.main },
        away: { name: awayName, crest: awayCrest ?? match.awayTeam?.crest, color: colors.away.main },
        hs, as, isFinished,
        status: isFinished ? 'Terminé' : (statusLabel || 'En direct'),
        meta1: `${compName ?? ''}${md}`.trim(),
        meta2: frDateShort(match.utcDate),
        homeLines: shareLines(scorers, cards, 'home'),
        awayLines: shareLines(scorers, cards, 'away'),
        summary: buildMatchSummary({ homeName, awayName, hs, as, goals, isFinished }),
      })
      const file = `${homeName}-${awayName}`.replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase()
      await shareImage(blob, `statfootix-${file}.jpg`, `${homeName} ${hs ?? ''}-${as ?? ''} ${awayName}`)
    } catch { /* échec silencieux : rien de cassé, l'utilisateur peut réessayer */ }
    setBusy(false)
  }
  return (
    <button type="button" className={`lmp__heroAction${busy ? ' lmp__heroAction--busy' : ''}`} onClick={onClick} aria-label="Partager le match">
      <ShareIcon />
    </button>
  )
}

export function CalendarMatchButton({ match, homeName, awayName, compName, channel, venue, onAdded }) {
  const [open, setOpen] = useState(false)
  const md = match.matchday ? ` · Journée ${match.matchday}` : ''
  const ev = matchEventInfo({ id: match.id, homeName, awayName, utcDate: match.utcDate, compLabel: `${compName ?? ''}${md}`.trim(), channel, venue, homeCrest: match.homeTeam?.crest, awayCrest: match.awayTeam?.crest })
  if (!ev) return null
  const done = () => { markAdded(match.id); setOpen(false); onAdded?.() }
  return (
    <>
      <button type="button" className="lmp__heroAction" onClick={() => setOpen(true)} aria-label="Ajouter au calendrier">
        <CalendarIcon />
      </button>
      {open && <CalendarSheet ev={ev} onClose={() => setOpen(false)} onDone={done} />}
    </>
  )
}

const PhoneCalIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M9 15l2 2 4-4" />
  </svg>
)
const WebCalIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z" />
  </svg>
)
const BellIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" /><path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
)
const Chevron = () => (
  <svg className="calSheet__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
)

function SheetTeam({ name, crest }) {
  const [ok, setOk] = useState(!!crest)
  return (
    <div className="calSheet__team">
      {ok
        ? <img className="calSheet__crest" src={crest} alt="" onError={() => setOk(false)} />
        : <span className="calSheet__crest calSheet__crest--empty">{String(name ?? '?').slice(0, 3).toUpperCase()}</span>}
      <span className="calSheet__teamName">{name}</span>
    </div>
  )
}

// Feuille « Ajouter au calendrier » (23/11, refaite à la demande de l'utilisateur : plus moderne, dans
// le thème de l'app, sans emojis) : carte du match (blasons, heure, compétition, chaîne) puis les deux
// choix. Rendue dans <body> (portail) : hors du conteneur qui défile, et classe « calSheetLayer » —
// le thème Sobre masque tout ce qui finit par « __backdrop ».
export function CalendarSheet({ ev, onClose, onDone }) {
  const v = ev.view ?? {}
  const time = ev.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const dayRaw = ev.start.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const day = dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1)
  const [home, away] = v.homeName ? [v.homeName, v.awayName] : ev.title.split(' – ')
  return createPortal(
    <div className="calSheetLayer" onClick={onClose}>
      <div className="calSheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Ajouter au calendrier">
        <div className="calSheet__grab" aria-hidden="true" />
        <div className="calSheet__head">
          <span className="calSheet__title">Ajouter au calendrier</span>
          <button type="button" className="calSheet__close" onClick={onClose} aria-label="Fermer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="calSheet__match">
          <SheetTeam name={home} crest={v.homeCrest} />
          <div className="calSheet__when">
            <span className="calSheet__time">{time}</span>
            <span className="calSheet__day">{day}</span>
          </div>
          <SheetTeam name={away} crest={v.awayCrest} />
          {(v.compLabel || v.channel) && (
            <div className="calSheet__meta">
              {v.compLabel && <span>{v.compLabel}</span>}
              {v.channel && <span className="calSheet__chan">{v.channel}</span>}
            </div>
          )}
        </div>

        <div className="calSheet__opts">
          <button type="button" className="calSheet__opt" onClick={() => { openIcs(ev); onDone() }}>
            <span className="calSheet__ico"><PhoneCalIcon /></span>
            <span className="calSheet__txt">
              <span className="calSheet__optName">Calendrier de l'iPhone</span>
              <span className="calSheet__optSub"><BellIcon /> Rappel 1 h avant le coup d'envoi</span>
            </span>
            <Chevron />
          </button>
          <a className="calSheet__opt" href={googleCalendarUrl(ev)} target="_blank" rel="noopener noreferrer" onClick={onDone}>
            <span className="calSheet__ico calSheet__ico--alt"><WebCalIcon /></span>
            <span className="calSheet__txt">
              <span className="calSheet__optName">Google Agenda</span>
              <span className="calSheet__optSub">Rappel selon tes réglages Google</span>
            </span>
            <Chevron />
          </a>
        </div>
      </div>
    </div>,
    document.body,
  )
}
