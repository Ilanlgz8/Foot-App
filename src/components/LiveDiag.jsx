/* eslint-disable react-hooks/purity -- écran de diagnostic temporaire, lu une fois par rendu */
// LiveDiag — écran de diagnostic TEMPORAIRE du direct (05/11, iPhone de l'utilisateur : « En direct »
// vide alors que les matchs sont en cours, impossible à reproduire ailleurs). S'ouvre en tapant 5 fois
// de suite sur l'onglet « En direct » (une PWA iOS n'a pas de barre d'adresse). Lecture seule : n'écrit
// rien, sauf une clé de test de 2 caractères aussitôt supprimée.
import { getMatchState } from '../utils/matchStateTracker'
import { isTrackedLive } from '../hooks/liveTracker'
import { isCardLive, calcMinute } from '../utils/matchUtils'

function storageInfo() {
  let chars = 0, keys = 0, writeOk = 'ok'
  try {
    keys = localStorage.length
    for (let i = 0; i < keys; i++) {
      const k = localStorage.key(i)
      chars += (k?.length ?? 0) + (localStorage.getItem(k)?.length ?? 0)
    }
    localStorage.setItem('foot_diag_test', 'x')
    localStorage.removeItem('foot_diag_test')
  } catch (e) { writeOk = `ÉCHEC (${e?.name || e})` }
  return { chars, keys, writeOk }
}

export function LiveDiag({ dayMatches, liveMatches, live, espnScores }) {
  const st = storageInfo()
  let lastPoll = '—'
  try {
    const t = Number(localStorage.getItem('foot_espn_last_poll'))
    if (t) lastPoll = `il y a ${Math.round((Date.now() - t) / 1000)} s`
  } catch { /* ignore */ }
  let trackerKeys = '—'
  try { trackerKeys = Object.keys(JSON.parse(localStorage.getItem('foot_live_v2') || '{}')).length } catch { /* ignore */ }

  const now = Date.now()
  const started = dayMatches.filter(m => {
    const age = (now - new Date(m.utcDate).getTime()) / 60_000
    return age >= 0 && age <= 150
  })

  const row = { display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.4rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }
  return (
    <div style={{ margin: '0.6rem 0 1rem', padding: '0.7rem', borderRadius: '0.8rem', background: '#111827', color: '#e5e7eb', fontSize: '0.68rem', fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: 1.45 }}>
      <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>Diagnostic direct</div>
      <div>stockage : {st.keys} clés, {Math.round(st.chars / 1000)} k car., écriture {st.writeOk}</div>
      <div>dernier poll ESPN : {lastPoll}</div>
      <div>en direct affichés : {live.length} · suivis (mémoire) : {liveMatches.length} · suivis (disque) : {trackerKeys}</div>
      <div>matchs du jour : {dayMatches.length} · commencés (&lt;150 min) : {started.length} · scores ESPN : {Object.keys(espnScores ?? {}).length}</div>
      <div style={{ marginTop: '0.5rem' }}>
        {started.map(m => {
          const ms = getMatchState(m.id)
          const name = `${m.homeTeam?.shortName || m.homeTeam?.name || '?'} – ${m.awayTeam?.shortName || m.awayTeam?.name || '?'}`
          return (
            <div key={m.id} style={row}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <span>
                {String(m.id).slice(-6)} · {m.status} · {ms.liveState || '-'}{ms.ft ? ' · FT' : ''} · {(ms.espnStatus || '-').replace('STATUS_', '')}
                {' · '}min {calcMinute(m) ?? '∅'} · {isTrackedLive(m.id) ? 'suivi' : 'NON suivi'} · {isCardLive(m) ? 'LIVE' : 'pas live'} · {espnScores?.[m.id] ? 'score' : 'sans score'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
