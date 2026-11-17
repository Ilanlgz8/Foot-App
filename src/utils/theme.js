// Thème de l'app (17/11) : 'sobre' (par défaut) ou 'neon' (style d'origine).
// Le choix est posé sur <html data-theme> dès le démarrage par le script inline d'index.html,
// puis modifié ici depuis la page Profil, sans rechargement.
const KEY = 'sf_theme'

export function getTheme() {
  try { return localStorage.getItem(KEY) === 'neon' ? 'neon' : 'sobre' } catch { return 'sobre' }
}

export function setTheme(t) {
  const v = t === 'neon' ? 'neon' : 'sobre'
  try { localStorage.setItem(KEY, v) } catch { /* navigation privée : le choix vaut pour la session */ }
  document.documentElement.setAttribute('data-theme', v)
}
