// Suivi des plantages avec Sentry (12/11).
//
// Chargé APRÈS l'affichage (import dynamique, en temps mort) pour ne pas alourdir le premier
// chargement mesuré par PageSpeed. Les erreurs survenues avant sont mises en file et envoyées
// dès que Sentry est prêt. Offre gratuite : 5 000 erreurs/mois — pas de suivi de performance
// (tracesSampleRate 0) ni d'enregistrement de session, pour rester dedans.
// DSN du projet Sentry « foot-app » (organisation moi-iw, région UE). Ce n'est PAS un secret :
// il permet seulement d'ENVOYER des erreurs à ce projet (Sentry le prévoit visible dans le code
// du site). VITE_SENTRY_DSN (Vercel) le remplace si on change de projet. Uniquement en
// production : pas d'erreurs de développement local envoyées.
const DEFAULT_DSN = 'https://23c2060cb786854b0fd11be972251cf7@o4512420491493376.ingest.de.sentry.io/4512420533502032'
const DSN = import.meta.env.PROD ? (import.meta.env.VITE_SENTRY_DSN || DEFAULT_DSN) : null
let sentry = null
const queue = []

// Bruit sans intérêt (réseau coupé, navigation interrompue, extensions du navigateur…)
const IGNORE = [
  'ResizeObserver loop',
  'AbortError',
  'The user aborted a request',
  'Failed to fetch',
  'NetworkError',
  'Load failed',
  'Non-Error promise rejection captured',
]

export function reportError(error, context) {
  if (!DSN) return
  if (sentry) sentry.captureException(error, context ? { extra: context } : undefined)
  else if (queue.length < 20) queue.push([error, context])
}

export function initErrorReporting() {
  if (!DSN || typeof window === 'undefined') return
  const start = () => import('@sentry/react').then(S => {
    S.init({
      dsn: DSN,
      release: import.meta.env.VITE_APP_VERSION || undefined,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      ignoreErrors: IGNORE,
    })
    sentry = S
    for (const [e, c] of queue.splice(0)) S.captureException(e, c ? { extra: c } : undefined)
  }).catch(() => { /* Sentry indisponible : l'app continue normalement */ })

  // Erreurs avant le chargement de Sentry
  window.addEventListener('error', e => { if (!sentry && e?.error) reportError(e.error) })
  window.addEventListener('unhandledrejection', e => { if (!sentry && e?.reason instanceof Error) reportError(e.reason) })

  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 5000 })
  else setTimeout(start, 3000)
}
