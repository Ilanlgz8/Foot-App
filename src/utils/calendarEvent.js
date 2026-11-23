// Ajout d'un match au calendrier du téléphone (22/11). Tout est fabriqué sur le téléphone :
//  • iPhone (et la plupart des calendriers) : fichier .ics — rappel 1 h avant le coup d'envoi ;
//  • Google Agenda : lien « ajouter un événement » (Google ne permet pas de choisir le rappel par
//    lien : il applique le rappel par défaut de l'utilisateur).
// Le rappel du matin (« ce soir il y a match ») est une NOTIF envoyée par le serveur aux abonnés qui
// suivent l'équipe (cf-worker) — le calendrier ne la double pas.
const MATCH_MS = 2 * 3600 * 1000

const pad = n => String(n).padStart(2, '0')
function icsDate(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
}
// Échappement iCalendar (RFC 5545) : \ ; , et retours à la ligne.
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

export function matchEventInfo({ id, homeName, awayName, utcDate, compLabel, channel, venue, homeCrest, awayCrest }) {
  const start = new Date(utcDate)
  if (Number.isNaN(start.getTime())) return null
  const end = new Date(start.getTime() + MATCH_MS)
  const title = `${homeName} – ${awayName}` // sans emoji (23/11, demande utilisateur)
  const details = [compLabel, channel ? `Diffusion : ${channel}` : null, 'Scores et notifs en direct : statfootix.vercel.app'].filter(Boolean).join('\n')
  return {
    uid: `match-${id}@statfootix.vercel.app`, title, start, end, details, location: venue || '',
    // affichage dans la feuille « Ajouter au calendrier » (pas utilisé dans le fichier .ics)
    view: { homeName, awayName, homeCrest: homeCrest || null, awayCrest: awayCrest || null, compLabel: compLabel || '', channel: channel || null },
  }
}

export function buildIcs(ev) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StatFootix//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(ev.end)}`,
    `SUMMARY:${esc(ev.title)}`,
    `DESCRIPTION:${esc(ev.details)}`,
    ...(ev.location ? [`LOCATION:${esc(ev.location)}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}`, 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}

export function googleCalendarUrl(ev) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${icsDate(ev.start)}/${icsDate(ev.end)}`,
    details: ev.details,
    ...(ev.location ? { location: ev.location } : {}),
  })
  return `https://calendar.google.com/calendar/render?${p}`
}

// Ouvre le .ics : sur iPhone, iOS propose directement « Ajouter au calendrier ».
export function openIcs(ev) {
  const blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${ev.title.replace(/[^\p{L}\p{N} -]/gu, '').trim() || 'match'}.ics`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

// Matchs déjà ajoutés (mémorisés sur le téléphone, survivent à la fermeture de l'app) : le bandeau
// « Mon équipe » n'affiche plus le bouton pour ces matchs.
const ADDED_KEY = 'sf_calendarAdded'
export function getAddedMatches() {
  try { const v = JSON.parse(localStorage.getItem(ADDED_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
export function markAdded(id) {
  try {
    const v = getAddedMatches()
    v[String(id)] = Date.now()
    // ménage : on oublie les ajouts de plus de 60 jours
    for (const k of Object.keys(v)) if (Date.now() - v[k] > 60 * 86400000) delete v[k]
    localStorage.setItem(ADDED_KEY, JSON.stringify(v))
  } catch { /* stockage indisponible */ }
}
export const isAdded = id => !!getAddedMatches()[String(id)]
