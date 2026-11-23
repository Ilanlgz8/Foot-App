// Boutons en haut à droite des pages de match (22/11) : Partager (image du match, direct et
// Résultat) et Ajouter au calendrier (match à venir). Voir shareCard.js / calendarEvent.js.
import { useState } from 'react'
import { renderShareCard, shareImage } from '../utils/shareCard'
import { buildMatchSummary } from '../utils/matchSummary'
import { getMatchTeamColors } from '../data/teamPhotos'
import { compForMatch, getCompetitionCampColors } from '../data/competitions'
import { matchEventInfo, addToCalendar, isAdded, markAdded } from '../utils/calendarEvent'

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

const CheckIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)

// Bouton calendrier (en haut à droite, en face de « Retour ») : un appui = ajout direct (voir
// addToCalendar), puis le bouton passe au vert (mémorisé sur le téléphone, sf_calendarAdded).
export function CalendarMatchButton({ match, homeName, awayName, compName, channel, venue, onAdded }) {
  const [added, setAdded] = useState(() => isAdded(match.id))
  const md = match.matchday ? ` · Journée ${match.matchday}` : ''
  const ev = matchEventInfo({ id: match.id, homeName, awayName, utcDate: match.utcDate, compLabel: `${compName ?? ''}${md}`.trim(), channel, venue })
  if (!ev) return null
  const onClick = () => { addToCalendar(ev); markAdded(match.id); setAdded(true); onAdded?.() }
  return (
    <button type="button" className={`lmp__heroAction${added ? ' lmp__heroAction--done' : ''}`} onClick={onClick}
      aria-label={added ? 'Déjà dans ton calendrier (appuyer pour ajouter à nouveau)' : 'Ajouter au calendrier'}>
      {added ? <CheckIcon /> : <CalendarIcon />}
    </button>
  )
}
