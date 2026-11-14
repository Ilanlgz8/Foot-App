import { useEffect, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import '../splashScreen.css'
import { shouldSkipSplash } from '../utils/reloadTrace'

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
// ⚠️ MIN_MS relevé 1200→1900→2800→4800 (26/07, retours utilisateur successifs
// — dernier en date : "l'animation va trop vite, ralentir tout, +2s") : texte
// 0.8s→1.3s, ballon mesuré à MEASURE_DELAY_MS=1400ms puis vol de 3.2s (voir
// CSS) → 1400+3200=4600ms pour un atterrissage complet. MIN_MS doit toujours
// couvrir ce total + une petite marge, sinon un lancement avec données déjà
// en cache coupe le fondu de sortie avant que le ballon ait fini d'atterrir.
// Honnêteté : l'écran de lancement dure maintenant ~4.8s minimum (+ 0.5s de
// fondu) à chaque lancement à froid — nettement plus long qu'un splash
// screen typique, mais c'est la demande explicite ("ralentir tout").
// 14/11 : 4,8 s → 3,5 s (demande utilisateur) — texte 1,1 s, ballon parti à 0,9 s, posé à 3,1 s.
const MIN_MS  = 3500
const MAX_MS  = 4000
const FADE_MS = 500

export function SplashScreen() {
  // Pas d'animation quand l'app se recharge d'elle-même (mise à jour) — voir reloadTrace.js.
  const [visible, setVisible] = useState(() => !shouldSkipSplash())
  const [fading, setFading]   = useState(false)
  // Lazy initializer (pas un appel direct à Date.now() dans le corps du
  // composant) : seule forme d'appel impur tolérée pendant le rendu par les
  // règles React actuelles — valeur figée dès le tout premier rendu, jamais
  // réévaluée ensuite (comme un useRef, mais sans l'appel impur en dehors du
  // rendu initial).
  const [mountedAt] = useState(() => Date.now())
  const isFetching = useIsFetching()

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

  if (!visible) return null

  return (
    <div className={`splash${fading ? ' splash--fading' : ''}`} aria-hidden="true">
      <div className="splash__glow" />
      <div className="splash__logo">
        <span className="splash__stat">Stat</span>
        <span className="splash__foot">Foot</span>
        {/* ı = dotless i (U+0131) : pas de point rendu, le ballon "devient" le
            point. Refonte (05/11, "l'animation est buggée des fois, surtout
            sur téléphone") : le ballon est maintenant un ENFANT du ı, posé en
            CSS pur (position + animation en transform). Plus aucune mesure
            JavaScript à 1,4 s pendant que l'app charge ses données, plus de
            ballon monté en retard ni mal placé si la police arrive tard, et
            l'animation ne fait plus recalculer la mise en page à chaque image. */}
        <span className="splash__doti">ı<span className="splash__ball">⚽</span></span>
        <span className="splash__x">x</span>
        <span className="splash__underline" />
      </div>
    </div>
  )
}
