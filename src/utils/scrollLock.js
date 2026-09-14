// src/utils/scrollLock.js
// Verrou de scroll partagé, appelé par 6 endroits de l'app (Match.jsx,
// Resultat.jsx, Classement.jsx x2, Footer.jsx, GroupModal.jsx) pour bloquer le
// scroll de fond pendant qu'un modal/dropdown est ouvert.
//
// ⚠️ RÉÉCRIT ENTIÈREMENT (14/09, refonte structurelle de la navbar — voir
// App.jsx/App.css/navbar.css) : la version précédente (11/09) posait
// `position: fixed` + `top: -scrollY` sur `#root` plutôt que sur `<body>`,
// pour protéger `.sfTabbar` (alors `position: fixed`, portalée dans `<body>`)
// d'une régression Safari où un ancêtre en `position: fixed` avec un `top`
// négatif dynamique pouvait décaler ses descendants fixed. Cette protection
// n'a plus lieu d'être : `.sfTabbar` n'est plus `position: fixed` du tout
// (simple élément de flux dans `.appShell`), et surtout, tout le document NE
// SCROLLE PLUS — c'est `.appScroll` (le conteneur unique de contenu, voir
// App.jsx) qui défile. Verrouiller le scroll de fond ne demande donc plus
// aucun hack `position: fixed`/`top` négatif (qui existait uniquement pour
// figer la position de scroll du DOCUMENT pendant le verrou) : il suffit de
// bloquer le scroll de CE conteneur précis avec `overflow: hidden` — sa
// position de scroll (`scrollTop`) reste intacte nativement tant qu'on ne la
// touche pas, aucune restauration manuelle à faire au déverrouillage. Plus
// simple, et plus aucun risque de la classe de bug qui a motivé la version
// précédente (aucun `position: fixed` posé dynamiquement nulle part ici).
export function lockBodyScroll() {
  const el = document.querySelector('.appScroll')
  if (el) el.style.overflow = 'hidden'
  return function unlock() {
    if (el) el.style.overflow = ''
  }
}
