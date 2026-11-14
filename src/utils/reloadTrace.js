// Journal des lancements de l'app (09/11, constat utilisateur : « des fois, quand des
// matchs venaient de passer à la mi-temps, ça relançait l'appli »). Impossible à
// reproduire à distance : on note la RAISON de chaque lancement pour la voir dans le
// diagnostic (5 taps rapides sur « En direct ») la prochaine fois que ça arrive.
//   • rechargement voulu par l'app (mise à jour, bouton « Recharger »…) : markReload(raison)
//     juste avant location.reload() ;
//   • app relancée alors qu'elle était au premier plan il y a quelques secondes, sans
//     rechargement voulu → « relance non demandée » : iOS a tué la page (mémoire) ou
//     plantage du moteur. La dernière erreur JS vue avant est notée aussi.
const INTENT_KEY = 'sf_reload_intent'
const BEAT_KEY   = 'sf_heartbeat'
const LOG_KEY    = 'sf_boot_log'
const ERR_KEY    = 'sf_last_error'
const LOG_MAX    = 15
const SKIP_SPLASH_KEY = 'sf_skip_splash'

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* plein ou bloqué */ } }

export function markReload(reason) {
  write(INTENT_KEY, { reason, at: Date.now() })
  // Rechargement voulu par l'app (mise à jour…) : pas d'écran de lancement au redémarrage (14/11 :
  // « éviter de relancer l'animation deux voire trois fois » après un déploiement).
  try { sessionStorage.setItem(SKIP_SPLASH_KEY, String(Date.now())) } catch { /* bloqué */ }
}

// Vrai si ce lancement suit (moins d'une minute) un rechargement déclenché par l'app.
export function shouldSkipSplash() {
  try { return Date.now() - Number(sessionStorage.getItem(SKIP_SPLASH_KEY) || 0) < 60_000 } catch { return false }
}

export function getBootLog() {
  return read(LOG_KEY) ?? []
}

export function initReloadTrace() {
  const now = Date.now()
  const intent = read(INTENT_KEY)
  const beat = read(BEAT_KEY)
  const lastErr = read(ERR_KEY)
  let reason
  if (intent && now - intent.at < 60_000) reason = `rechargement voulu : ${intent.reason}`
  else if (beat && beat.visible && now - beat.at < 20_000) reason = 'RELANCE NON DEMANDÉE (app tuée par le système ou plantage)'
  else reason = 'ouverture normale'
  const entry = { at: now, reason }
  if (lastErr && beat && lastErr.at >= beat.at - 60_000) entry.err = lastErr.msg
  const log = [...getBootLog(), entry].slice(-LOG_MAX)
  write(LOG_KEY, log)
  try { localStorage.removeItem(INTENT_KEY) } catch { /* ignore */ }

  const beatNow = () => write(BEAT_KEY, { at: Date.now(), visible: document.visibilityState === 'visible' })
  beatNow()
  setInterval(() => { if (document.visibilityState === 'visible') beatNow() }, 5_000)
  document.addEventListener('visibilitychange', beatNow)
  window.addEventListener('pagehide', () => write(BEAT_KEY, { at: Date.now(), visible: false }))

  const noteError = (msg) => write(ERR_KEY, { at: Date.now(), msg: String(msg ?? '').slice(0, 160) })
  window.addEventListener('error', e => noteError(e?.message || e?.error?.message))
  window.addEventListener('unhandledrejection', e => noteError(e?.reason?.message || e?.reason))
}
