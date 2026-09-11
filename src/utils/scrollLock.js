// src/utils/scrollLock.js
// Verrou de scroll iOS partagé, factorisé le 11/09 (6e signalement de la barre du
// bas ".sfTabbar" détachée — constat utilisateur, capture d'écran : la barre
// apparaît "au milieu de la page", entre deux blocs de contenu, au lieu d'être
// collée en bas de l'écran).
//
// Root cause trouvée (jamais auditée dans les 5 tentatives précédentes, toutes
// concentrées sur un transform d'ancêtre / une couche GPU / un watchdog de
// réparation) : le pattern classique de scroll-lock iOS (position:fixed + top
// négatif posés sur <body> pendant qu'un dropdown/modal est ouvert) existait déjà
// à l'identique à 6 endroits (Match.jsx, Resultat.jsx, Classement.jsx x2,
// Footer.jsx, GroupModal.jsx) AVANT le passage de .sfTabbar en portail direct
// dans <body> (10/09). Une fois ce portail en place, .sfTabbar est devenue un
// ENFANT DIRECT de <body> — et Safari iOS a un comportement non conforme à la
// spec CSS documenté sur ce cas précis : quand <body> lui-même passe en
// position:fixed avec un top négatif dynamique, certains rendus WebKit
// répercutent ce décalage sur les descendants position:fixed de <body> au lieu
// de les laisser ancrés au viewport (la spec dit que seuls transform/filter/
// perspective/will-change/contain sur un ancêtre doivent casser position:fixed —
// pas un simple position:fixed — mais c'est une régression connue de Safari).
// Résultat : ouvrir n'importe lequel des 6 dropdowns/modals après avoir scrollé
// décale visuellement .sfTabbar de -scrollY px — collant exactement au symptôme
// rapporté.
//
// Fix : le verrou pose désormais position:fixed/top sur #root (le conteneur de
// tout le contenu applicatif React) au lieu de <body>. #root est un FRÈRE de
// .sfTabbar dans le DOM (portail direct dans <body>, voir navbar.jsx), jamais un
// ancêtre — donc structurellement insensible à ce que #root fait, quel que soit
// le comportement exact de Safari sur ce point. <body> garde seulement
// overflow:hidden (inoffensif pour position:fixed, sert juste à bloquer le
// scroll de fond derrière la modal/dropdown).
//
// Honnêteté : je n'ai aucun accès à un vrai iPhone/PWA depuis cet environnement
// pour reproduire le bug moi-même ni confirmer avec certitude absolue que c'est
// CE mécanisme précis (plutôt qu'un autre) qui cause le symptôme — mais c'est la
// première piste concrète et reproductible à la demande (pas besoin d'un cycle
// arrière-plan/premier-plan comme les tentatives précédentes le supposaient),
// et le fix (ne plus jamais mettre <body> en position:fixed tant que .sfTabbar
// en est un enfant direct) est sain structurellement même si la cause exacte
// s'avérait légèrement différente.
export function lockBodyScroll() {
  const scrollY = window.scrollY
  const root = document.getElementById('root')
  document.body.style.overflow = 'hidden'
  if (root) {
    root.style.position = 'fixed'
    root.style.top = `-${scrollY}px`
    root.style.left = '0'
    root.style.right = '0'
  }
  return function unlock() {
    document.body.style.overflow = ''
    if (root) {
      root.style.position = ''
      root.style.top = ''
      root.style.left = ''
      root.style.right = ''
    }
    window.scrollTo(0, scrollY)
  }
}
