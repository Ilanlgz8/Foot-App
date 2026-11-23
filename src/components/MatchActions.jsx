// Boutons en haut à droite des pages de match (22/11) : Partager (image du match, direct et
// Résultat) et Ajouter au calendrier (match à venir). Voir shareCard.js / calendarEvent.js.
import { useEffect, useMemo, useState } from 'react'
import { renderShareCard, shareImage, preloadShareFonts } from '../utils/shareCard'
import { compForMatch } from '../data/competitions'
import { isNationalTeamComp } from '../utils/matchUtils'
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

function frDate(utcDate) {
  const d = new Date(utcDate)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

const Spinner = () => (
  <svg className="lmp__heroSpin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M12 3a9 9 0 1 1-9 9" />
  </svg>
)

// Bouton Partager (23/11, constat utilisateur : en appuyant trop vite, la police du score n'était pas
// encore chargée et les buteurs pas encore arrivés). Désormais l'image est PRÉPARÉE à l'avance :
//  • polices préchargées dès l'arrivée sur la page ;
//  • buteurs considérés complets quand leur nombre = total du score (ou après 6 s, au cas où la source
//    n'a pas de buteurs pour ce match) ;
//  • l'image est redessinée en arrière-plan dès que les données changent (direct compris).
// Tant qu'elle n'est pas prête, le bouton tourne et ne réagit pas ; une fois prête, un appui la
// partage tout de suite (et le partage iPhone exige un appui récent : pas d'attente avant share()).
export function ShareMatchButton({ match, homeName, awayName, homeCrest, awayCrest, hs, as, scorers, cards, isFinished, statusLabel, compName }) {
  const [fontsOk, setFontsOk] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [ready, setReady] = useState(null)      // { key, blob }
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    preloadShareFonts().finally(() => { if (alive) setFontsOk(true) })
    const t = setTimeout(() => { if (alive) setTimedOut(true) }, 6000)
    return () => { alive = false; clearTimeout(t) }
  }, [])

  const goalsKnown = (scorers ?? []).filter(s => !s.shootout).length
  const goalsTotal = (Number(hs) || 0) + (Number(as) || 0)
  const dataOk = goalsKnown >= goalsTotal || timedOut

  const compObj = compForMatch(match)
  const data = useMemo(() => ({
    compLogo: compObj?.emblem ?? match.competition?.emblem ?? null,
    compLogoOpaque: !!compObj?.emblemOpaque,
    home: { name: homeName, crest: homeCrest ?? match.homeTeam?.crest },
    away: { name: awayName, crest: awayCrest ?? match.awayTeam?.crest },
    isNational: isNationalTeamComp(match),
    // en-tête : nom court de la compétition (sauf abrégé « Premier L. » → nom complet), journée ; pied : date
    compLabel: (compObj?.shortName && !compObj.shortName.endsWith('.')) ? compObj.shortName : (compObj?.name ?? compName ?? ''),
    matchday: match.matchday ?? null,
    dateLabel: frDate(match.utcDate),
    hs, as, isFinished,
    status: isFinished ? 'Terminé' : (statusLabel || ''),
    homeLines: shareLines(scorers, cards, 'home'),
    awayLines: shareLines(scorers, cards, 'away'),
  }), [compObj, compName, match, homeName, awayName, homeCrest, awayCrest, hs, as, isFinished, statusLabel, scorers, cards])
  const key = JSON.stringify(data)

  useEffect(() => {
    if (!fontsOk || !dataOk) return
    let alive = true
    const t = setTimeout(async () => {
      try {
        const blob = await renderShareCard(data)
        if (alive) setReady({ key, blob })
      } catch { /* l'appui réessaiera */ }
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [key, fontsOk, dataOk]) // eslint-disable-line react-hooks/exhaustive-deps

  const prepared = ready && ready.key === key ? ready.blob : null
  const waiting = !prepared
  const onClick = async () => {
    if (busy || !prepared) return
    setBusy(true)
    try {
      const file = `${homeName}-${awayName}`.replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase()
      await shareImage(prepared, `statfootix-${file}.jpg`)
    } catch { /* échec silencieux : l'utilisateur peut réessayer */ }
    setBusy(false)
  }
  return (
    <button type="button" className={`lmp__heroAction${waiting || busy ? ' lmp__heroAction--busy' : ''}`} onClick={onClick}
      aria-label={waiting ? "Préparation de l'image…" : 'Partager le match'} aria-busy={waiting}>
      {waiting ? <Spinner /> : <ShareIcon />}
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
