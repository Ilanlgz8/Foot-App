import { useEffect, useState } from 'react'

// ⚠️ AJOUT (12/09, retour utilisateur après le 9e signalement de la barre du
// bas décollée au retour d'arrière-plan : "bah oui mais faudrait savoir en
// fait parce que la ça fait jsp combien de fois qu'on essaie de réparer ça") —
// il a raison. 9 tentatives basées sur des théories (compositing, ancêtre
// transformé, scroll-lock, viewport visuel...) sans jamais avoir pu observer
// le bug moi-même sur un vrai appareil : chaque fix corrige la théorie la
// plus probable du moment, pas forcément la vraie cause. Plutôt qu'une 10e
// théorie devinée à l'aveugle, ce petit encart de mesure permet d'arrêter de
// deviner et de VOIR les vrais chiffres au moment exact où ça se décolle.
//
// Activation : aller une fois sur .../?navdebug=1 (persiste ensuite en
// localStorage, pas besoin de rajouter le paramètre à chaque visite). Un petit
// encart texte apparaît en haut à gauche, ne capte aucun clic
// (pointer-events: none), mis à jour 3x/seconde. Au prochain décrochage, une
// capture d'écran de cet encart (avec la barre décollée visible dessous) donne
// les vraies valeurs : viewport de layout (`innerH`) vs viewport visuel réel
// (`vvH`/`vvTop`), position réelle du bas de la barre (`barBottom`), l'écart
// que la 8e tentative essaie de combler (`gap`), le `transform`/`position`
// CSS réellement appliqués. Ça permet de savoir en un coup d'œil laquelle des
// théories déjà tentées était (ou n'était pas) la bonne, au lieu de continuer
// à empiler des correctifs sur des hypothèses non vérifiées.
// Désactivation : .../?navdebug=0.
// Lu une seule fois via un initialiseur useState paresseux (pas un effect
// séparé + setState, pour éviter un aller-retour de rendu inutile ET la
// règle lint react-hooks/set-state-in-effect — même pattern déjà respecté
// ailleurs dans l'app).
function readNavDebugFlag() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  if (params.get('navdebug') === '1') localStorage.setItem('navDebug', '1')
  if (params.get('navdebug') === '0') localStorage.removeItem('navDebug')
  return localStorage.getItem('navDebug') === '1'
}

// ⚠️ AJOUT (12/09, retour utilisateur : "faudrait que je teste sur mon tel
// mais [...] tout les appareils ne font pas la même taille") — le lien
// `?navdebug=1` marche bien pour tester au clavier/desktop, mais une PWA
// installée sur iPhone ("ajouter à l'écran d'accueil") n'a PAS de barre
// d'adresse : impossible d'y taper une URL avec paramètre une fois lancée
// depuis l'icône. Et rien ne garantit que le `localStorage` posé depuis
// Safari soit bien partagé avec l'app installée (comportement iOS pas
// toujours fiable sur ce point). Ajout d'un déclencheur qui marche DEPUIS
// L'APP ELLE-MÊME, sans URL : 5 taps rapides sur le logo "StatFootix" du
// header (voir `navbar.jsx`, `handleBrandTap`) basculent l'encart on/off via
// un évènement `navdebug:toggle` — fonctionne à l'identique dans la PWA
// installée, Safari, ou n'importe quel navigateur. Honnêteté sur "toutes les
// tailles d'écran" : ce n'est pas un problème pour cet outil — les chiffres
// affichés sont des VALEURS RELATIVES (l'écart `gap`, la position du bas de
// la barre PAR RAPPORT au bas du viewport), pas des seuils absolus supposant
// une taille d'écran précise ; ils se lisent de la même façon quel que soit
// le modèle d'iPhone.
export function NavDebugHUD() {
  const [on, setOn] = useState(readNavDebugFlag)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    const onToggle = e => setOn(!!e.detail)
    window.addEventListener('navdebug:toggle', onToggle)
    return () => window.removeEventListener('navdebug:toggle', onToggle)
  }, [])

  useEffect(() => {
    if (!on) return
    const tick = () => {
      const el = document.querySelector('.sfTabbar')
      const vv = window.visualViewport
      const rect = el?.getBoundingClientRect()
      const vvH = vv ? Math.round(vv.height) : null
      const vvTop = vv ? Math.round(vv.offsetTop) : null
      setStats({
        innerH: window.innerHeight,
        vvH,
        vvTop,
        barBottom: rect ? Math.round(rect.bottom) : null,
        gap: vvH != null ? window.innerHeight - (vvH + vvTop) : null,
        transform: el ? getComputedStyle(el).transform : 'n/a',
        position: el ? getComputedStyle(el).position : 'n/a',
        scrollY: Math.round(window.scrollY),
        vis: document.visibilityState,
        t: new Date().toLocaleTimeString('fr-FR'),
      })
    }
    const id = setInterval(tick, 300)
    tick()
    return () => clearInterval(id)
  }, [on])

  if (!on || !stats) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 4,
        left: 4,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.78)',
        color: '#39ff6a',
        font: '9px/1.35 ui-monospace, monospace',
        padding: '5px 7px',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'pre',
      }}
    >
{`${stats.t} vis:${stats.vis}
innerH:${stats.innerH} vvH:${stats.vvH} vvTop:${stats.vvTop} gap:${stats.gap}
barBottom:${stats.barBottom} scrollY:${stats.scrollY}
transform:${stats.transform}
position:${stats.position}`}
    </div>
  )
}
