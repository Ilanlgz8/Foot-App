/**
 * src/utils/sounds.js
 * Sons in-app générés via Web Audio API (zéro fichier externe, fonctionne offline).
 * Joués uniquement quand l'app est au premier plan (document.hidden === false).
 *
 * ⚠️  L'AudioContext doit être créé/repris après un geste utilisateur.
 *     On le crée lazy au premier appel ; s'il est suspendu on tente resume().
 *     Si l'utilisateur n'a jamais touché l'écran (rare), le son est silencieusement ignoré.
 */

let ctx = null

function getCtx() {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)()
    } catch { return null }
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  return ctx
}

/** Joue un seul coup de sifflet (oscillateur sinusoïdal avec vibrato léger) */
function whistleBurst(actx, startTime, freq = 2800, duration = 0.22, volume = 0.28) {
  try {
    const osc     = actx.createOscillator()
    const gain    = actx.createGain()
    const lfo     = actx.createOscillator()   // vibrato
    const lfoGain = actx.createGain()

    lfo.frequency.value  = 10
    lfoGain.gain.value   = 25
    lfo.connect(lfoGain)
    lfoGain.connect(osc.frequency)

    osc.connect(gain)
    gain.connect(actx.destination)

    osc.frequency.setValueAtTime(freq, startTime)

    // Envelope : attaque rapide, soutenu, déclin
    gain.gain.setValueAtTime(0, startTime)
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.015)
    gain.gain.setValueAtTime(volume, startTime + duration - 0.04)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

    lfo.start(startTime)
    lfo.stop(startTime + duration)
    osc.start(startTime)
    osc.stop(startTime + duration)
  } catch { /* silencieux si AudioContext indisponible */ }
}

/** Coup d'envoi / Reprise 2ème MT — 2 coups courts */
export function playWhistleKO() {
  if (document.hidden) return
  const actx = getCtx()
  if (!actx) return
  const t = actx.currentTime
  whistleBurst(actx, t,        2800, 0.20)
  whistleBurst(actx, t + 0.32, 2800, 0.20)
}

/** Mi-temps — 3 coups */
export function playWhistleHT() {
  if (document.hidden) return
  const actx = getCtx()
  if (!actx) return
  const t = actx.currentTime
  whistleBurst(actx, t,        2800, 0.20)
  whistleBurst(actx, t + 0.32, 2800, 0.20)
  whistleBurst(actx, t + 0.64, 2800, 0.26)
}

/** Fin de match — 3 coups longs */
export function playWhistleFT() {
  if (document.hidden) return
  const actx = getCtx()
  if (!actx) return
  const t = actx.currentTime
  whistleBurst(actx, t,        2600, 0.40, 0.30)
  whistleBurst(actx, t + 0.58, 2600, 0.40, 0.30)
  whistleBurst(actx, t + 1.16, 2600, 0.50, 0.30)
}

/** But — séquence type "corne de brume" grave */
export function playGoalSound() {
  if (document.hidden) return
  const actx = getCtx()
  if (!actx) return
  const t = actx.currentTime

  const horn = (startT, freq, dur, vol = 0.38) => {
    try {
      const osc    = actx.createOscillator()
      const gain   = actx.createGain()
      const filter = actx.createBiquadFilter()

      filter.type            = 'lowpass'
      filter.frequency.value = 900

      osc.type = 'sawtooth'
      osc.connect(filter)
      filter.connect(gain)
      gain.connect(actx.destination)

      osc.frequency.setValueAtTime(freq, startT)

      gain.gain.setValueAtTime(0, startT)
      gain.gain.linearRampToValueAtTime(vol, startT + 0.04)
      gain.gain.setValueAtTime(vol, startT + dur - 0.08)
      gain.gain.exponentialRampToValueAtTime(0.0001, startT + dur)

      osc.start(startT)
      osc.stop(startT + dur)
    } catch {}
  }

  // "Ta — Ta — Taaaa" (montée finale)
  horn(t,        220, 0.14)
  horn(t + 0.17, 220, 0.14)
  horn(t + 0.34, 277, 0.55)
}

/**
 * Débloquer l'AudioContext au premier geste utilisateur.
 * Appeler une fois au montage de l'app (App.jsx).
 */
export function unlockAudio() {
  const unlock = () => {
    getCtx() // crée + resume
    window.removeEventListener('touchstart', unlock, true)
    window.removeEventListener('click',      unlock, true)
  }
  window.addEventListener('touchstart', unlock, true)
  window.addEventListener('click',      unlock, true)
}
