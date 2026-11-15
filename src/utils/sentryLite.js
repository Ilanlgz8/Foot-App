// Sentry allégé (15/11, check-up) : `import('@sentry/react')` chargeait TOUT le paquet (rejeu de
// session, formulaire de retour, suivi de performance…) car un import dynamique du module entier
// empêche le tri du code inutile — 152 Ko compressés. Ici seules les fonctions réellement utilisées
// sont importées par leur nom : même comportement (mêmes intégrations par défaut, mêmes filtres).
export { init, captureException } from '@sentry/browser'
