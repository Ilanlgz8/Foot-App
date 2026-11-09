/* eslint-disable react-hooks/purity -- écran de diagnostic temporaire, lu une fois par rendu */
// LiveDiag — écran de diagnostic TEMPORAIRE du direct (05/11, iPhone de l'utilisateur : « En direct »
// vide alors que les matchs sont en cours, impossible à reproduire ailleurs). S'ouvre en tapant 5 fois
// de suite sur l'onglet « En direct » (une PWA iOS n'a pas de barre d'adresse). Lecture seule : n'écrit
// rien, sauf une clé de test de 2 caractères aussitôt supprimée.
import { getBootLog } from '../utils/reloadTrace'
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

// 06/11 : répartition du stockage local par type d'entrée (ids, dates et codes de compétition
// regroupés), pour repérer doublons et données jamais nettoyées sur le téléphone de l'utilisateur.
function StorageBreakdown() {
  const groups = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? ''
      const v = localStorage.getItem(k) ?? ''
      const g = k
        .replace(/espn-[A-Za-z0-9_]+-\d+/g, '#id')
        .replace(/\d{4}-\d{2}-\d{2}/g, '#date')
        .replace(/\d{4,}/g, '#n')
        .replace(/_[A-Z][A-Z0-9]{1,4}(?=_|$)/g, '_#C')
      groups[g] = groups[g] || { n: 0, c: 0 }
      groups[g].n++
      groups[g].c += k.length + v.length
    }
  } catch { /* ignore */ }
  const list = Object.entries(groups)
  const bySize = [...list].sort((a, b) => b[1].c - a[1].c).slice(0, 14)
  const byCount = [...list].sort((a, b) => b[1].n - a[1].n).slice(0, 8)
  const fmt = ([k, v]) => `${k} ×${v.n} ${Math.round(v.c / 1000)}k`
  return (
    <div style={{ marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.15)' }}>
      <div>plus gros :</div>
      {bySize.map(e => <div key={'s' + e[0]} style={{ opacity: 0.85 }}>{fmt(e)}</div>)}
      <div style={{ marginTop: '0.3rem' }}>plus nombreux :</div>
      {byCount.map(e => <div key={'n' + e[0]} style={{ opacity: 0.85 }}>{fmt(e)}</div>)}
    </div>
  )
}

function LaunchInfo() {
  const l = window.__sfLaunch
  const g = window.__sfGuard
  const slow = performance.getEntriesByType('resource')
    .filter(e => /\/api\/|\/espn\?/.test(e.name))
    .map(e => ({ u: e.name.replace(location.origin, '').replace('/api/football?apiPath=', 'fd:').replace(/%2F/g, '/').slice(0, 58), s: Math.round(e.startTime), d: Math.round(e.duration) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 10)
  const nApi = performance.getEntriesByType('resource').filter(e => /\/api\/|\/espn\?/.test(e.name)).length
  return (
    <div style={{ marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.15)' }}>
      <div>lancement : {l ? `${l.keys} clés, ${Math.round(l.chars / 1000)} k car., ${l.matchKeys} caches matchs, cache du jour ${l.hadTodayCache ? 'OUI' : 'NON'}` : '—'}</div>
      <div>Accueil affiché à : {window.__sfAccueilReadyAt != null ? `${(window.__sfAccueilReadyAt / 1000).toFixed(1)} s` : '— (pas passé par l\'Accueil)'} après le lancement</div>
      <div>garde-fou stockage : {g ? `${g.evictions} purge(s)${g.removed.length ? ' — ' + g.removed.slice(-4).join(', ') : ''}` : '—'}</div>
      <div>liste « à venir » (jour suivant) : {window.__sfAllComps ? `${window.__sfAllComps.total} matchs, dont Ligue des Nations ${window.__sfAllComps.nl} — par compétition : ${Object.entries(window.__sfAllComps.byComp).map(([k, v]) => `${k} ${v}`).join(', ')}` : 'pas encore chargée'}</div>
      <div>ESPN Ligue des Nations : {window.__sfEspnWin?.['uefa.nations'] ? JSON.stringify(window.__sfEspnWin['uefa.nations']) : 'aucune requête'}</div>
      <div>derniers lancements (le plus récent en bas) :</div>
      {getBootLog().slice(-6).map((b, i) => <div key={'b' + i} style={{ opacity: 0.85, color: /NON DEMANDÉE/.test(b.reason) ? '#fca5a5' : undefined }}>{new Date(b.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — {b.reason}{b.err ? ` (dernière erreur : ${b.err})` : ''}</div>)}
      <div>requêtes depuis le lancement : {nApi} · les plus lentes :</div>
      {slow.map((r, i) => <div key={i} style={{ opacity: 0.85 }}>{(r.s / 1000).toFixed(1)}s +{(r.d / 1000).toFixed(1)}s {r.u}</div>)}
    </div>
  )
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
      <LaunchInfo />
      <StorageBreakdown />
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
