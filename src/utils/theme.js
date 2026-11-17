// Thème de l'app (17/11) : 'sobre' (par défaut), 'neon' (style d'origine) ou 'jaune'
// (= Sobre + cotes jaunes façon site de paris : nom en entier, chiffres italiques, virgule).
// Posé sur <html> dès le démarrage par le script inline d'index.html :
//   data-theme = 'neon' | 'sobre'   (le thème Jaune EST le thème Sobre…)
//   data-odds  = 'jaune'            (…avec ce réglage en plus, voir theme-sobre.css)
// puis modifié ici depuis la page Profil, sans rechargement.
const KEY = 'sf_theme'
const THEMES = ['sobre', 'neon', 'jaune']

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY)
    return THEMES.includes(v) ? v : 'sobre'
  } catch { return 'sobre' }
}

export function setTheme(t) {
  const v = THEMES.includes(t) ? t : 'sobre'
  try { localStorage.setItem(KEY, v) } catch { /* navigation privée : le choix vaut pour la session */ }
  const root = document.documentElement
  root.setAttribute('data-theme', v === 'neon' ? 'neon' : 'sobre')
  if (v === 'jaune') root.setAttribute('data-odds', 'jaune')
  else root.removeAttribute('data-odds')
}
