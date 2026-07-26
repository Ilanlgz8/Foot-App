import { useEffect, useRef, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import '../splashScreen.css'

// ⚠️ AJOUT (25/07, demande explicite utilisateur) : écran de lancement animé
// (fond noir/gris, "StatFootix" en néon rouge) pendant le tout premier
// chargement de l'app — masque le temps que les données initiales
// (Accueil : matchs du jour, live, news…) arrivent, plutôt que de laisser
// apparaître une page à moitié chargée.
//
// Affiché UNIQUEMENT au lancement à froid : ce composant est monté une seule
// fois dans App.jsx (au-dessus des Routes, jamais remonté lors d'un
// changement de page — App() ne se démonte pas en naviguant). Un retour
// d'arrière-plan (l'utilisateur switch d'app puis revient) ne remonte PAS
// App.jsx tant que l'OS n'a pas tué la page — donc pas de splash à chaque
// retour. C'est un choix délibéré : toute la logique de cache de l'app est
// construite autour de "jamais bloquer l'écran quand du cache existe déjà"
// (affichage instantané + mise à jour silencieuse en fond, voir tous les
// hooks de l'app) — un écran plein écran à chaque retour d'arrière-plan
// irait à l'encontre de cette philosophie et gênerait un usage normal
// (switcher d'app puis revenir).
//
// Durée : ni fixe ni arbitraire — `useIsFetching()` (React Query) renvoie le
// nombre de requêtes actuellement en cours dans TOUTE l'app, tous hooks
// confondus, sans avoir à coupler ce composant à chacun d'eux individuellement.
// MIN_MS évite un flash trop rapide sur un lancement où tout est déjà en
// cache (perçu comme un bug plutôt qu'une animation) ; MAX_MS est un filet de
// sécurité si jamais le chargement traîne (réseau lent, panne) — l'app ne
// reste jamais bloquée derrière l'écran de lancement indéfiniment.
// ⚠️ MIN_MS relevé 1200→1900→2800 (26/07, portage puis ralentissement de
// l'animation ballon — retour utilisateur "le ballon est trop rapide") : le
// ballon démarre à MEASURE_DELAY_MS (850ms) et son vol dure maintenant 1.8s
// (voir splashBallFly, CSS) — 850+1800=2650ms pour un atterrissage complet.
// MIN_MS doit toujours couvrir ce total + une petite marge, sinon un
// lancement avec données déjà en cache coupe le fondu de sortie avant que le
// ballon ait fini d'atterrir.
const MIN_MS  = 2800
const MAX_MS  = 3500
const FADE_MS = 500
// Délai avant de mesurer la position réelle du point du "i" pour y faire
// atterrir le ballon. Doit être POSTÉRIEUR à la fin de l'animation d'entrée du
// texte (splashTextFromLeft/Right, 0.8s — voir CSS) : mesurer avant capterait
// la lettre encore décalée par son propre glissement d'entrée (translateX),
// donnant une cible fausse et un ballon qui part loin hors-cadre — bug identifié
// et corrigé en maquette (mcp__visualize) avant ce portage.
const MEASURE_DELAY_MS = 850

export function SplashScreen() {
  const [visible, setVisible] = useState(true)
  const [fading, setFading]   = useState(false)
  const [ballReady, setBallReady] = useState(false)
  // Lazy initializer (pas un appel direct à Date.now() dans le corps du
  // composant) : seule forme d'appel impur tolérée pendant le rendu par les
  // règles React actuelles — valeur figée dès le tout premier rendu, jamais
  // réévaluée ensuite (comme un useRef, mais sans l'appel impur en dehors du
  // rendu initial).
  const [mountedAt] = useState(() => Date.now())
  const isFetching = useIsFetching()
  const logoRef = useRef(null)
  const dotIRef = useRef(null)

  // Filet de sécurité : quoi qu'il arrive, on lance le fondu de sortie au
  // plus tard à MAX_MS.
  useEffect(() => {
    const t = setTimeout(() => setFading(true), MAX_MS)
    return () => clearTimeout(t)
  }, [])

  // Se déclenche à chaque changement de isFetching. Le cleanup de l'effet
  // précédent annule automatiquement tout minuteur programmé pour un état
  // devenu obsolète (ex: isFetching repasse à 1 avant que le minuteur pour
  // "isFetching===0" n'ait eu le temps de se déclencher) — jamais de fondu
  // lancé alors qu'un chargement est encore réellement en cours.
  useEffect(() => {
    if (fading) return
    if (isFetching > 0) return
    const elapsed   = Date.now() - mountedAt
    const remaining = Math.max(0, MIN_MS - elapsed)
    // Toujours via setTimeout (même à 0ms) plutôt qu'un setFading direct dans
    // le corps de l'effet — évite un rendu en cascade synchrone (règle React
    // actuelle), et le délai de 0ms ne change rien perceptiblement.
    const t = setTimeout(() => setFading(true), remaining)
    return () => clearTimeout(t)
  }, [isFetching, fading, mountedAt])

  // Démonte complètement l'écran une fois le fondu CSS terminé (évite de
  // garder un élément invisible mais toujours dans le DOM).
  useEffect(() => {
    if (!fading) return
    const t = setTimeout(() => setVisible(false), FADE_MS)
    return () => clearTimeout(t)
  }, [fading])

  // Mesure la position réelle du point du "i" (dotless-ı, voir JSX) une fois
  // le texte stabilisé, et en déduit le point de départ du ballon (sous le
  // texte). Le ballon (span .splash__ball) n'est monté dans le DOM QU'APRÈS
  // que ces variables CSS soient posées (voir ballReady) — pas de valeur de
  // repli à deviner, pas de course JS/CSS : son animation démarre à 0% avec
  // les bonnes coordonnées déjà en place dès son tout premier rendu.
  useEffect(() => {
    const t = setTimeout(() => {
      const logo = logoRef.current
      const dotI = dotIRef.current
      if (!logo || !dotI) return
      const logoRect = logo.getBoundingClientRect()
      const iRect    = dotI.getBoundingClientRect()
      if (!iRect.width) return
      const ix = iRect.left + iRect.width / 2 - logoRect.left
      const iy = iRect.top - logoRect.top - 2
      // Départ : sous le texte, décalé sur la gauche (arrive en roulant).
      const startX = -logoRect.width * 0.35
      const startY = logoRect.height + logoRect.height * 0.55
      logo.style.setProperty('--ball-start-x', `${startX}px`)
      logo.style.setProperty('--ball-start-y', `${startY}px`)
      logo.style.setProperty('--ball-ix', `${ix}px`)
      logo.style.setProperty('--ball-iy', `${iy}px`)
      setBallReady(true)
    }, MEASURE_DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  if (!visible) return null

  return (
    <div className={`splash${fading ? ' splash--fading' : ''}`} aria-hidden="true">
      <div className="splash__glow" />
      <div className="splash__logo" ref={logoRef}>
        <span className="splash__stat">Stat</span>
        <span className="splash__foot">Foot</span>
        {/* ı = dotless i (U+0131) : pas de point rendu, pour que le ballon
            puisse "devenir" le point sans qu'un vrai point ne traîne dessous. */}
        <span className="splash__doti" ref={dotIRef}>ı</span>
        <span className="splash__x">x</span>
        {ballReady && <span className="splash__ball">⚽</span>}
        <span className="splash__underline" />
      </div>
    </div>
  )
}
