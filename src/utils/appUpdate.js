/**
 * appUpdate — garantit que l'app affichée est bien la dernière déployée.
 *
 * CONSTAT (04/09, utilisateur : "pourquoi sur mon tel en PWA je vois encore
 * comme avant ?").
 *
 * Le mécanisme existant (main.jsx) repose entièrement sur le cycle de vie du
 * service worker : `skipWaiting` + `clientsClaim` côté Workbox, `update()` au
 * retour au premier plan, rechargement sur `controllerchange`. Côté serveur
 * tout est correct aussi (vérifié : /sw.js est servi en `no-store` et
 * référence bien le bundle courant).
 *
 * Sauf que ça n'a pas suffi une seule fois de la session : il a fallu
 * désinscrire le SW et vider les caches à la main après CHAQUE déploiement
 * pour voir les changements. Le point faible est toujours le même — tout
 * dépend du navigateur qui redécouvre un nouveau /sw.js, chose qu'une PWA
 * installée et jamais vraiment fermée peut retarder très longtemps (et le CDN
 * peut lui servir l'ancien fichier pendant quelques minutes après un
 * déploiement).
 *
 * Cette vérification-ci ne dépend d'AUCUN de ces mécanismes : elle demande
 * simplement au serveur quel bundle il sert aujourd'hui et le compare à celui
 * qui tourne réellement dans la page. Deux réponses différentes = la page est
 * périmée, quelle qu'en soit la raison.
 *
 * Escalade en deux temps, volontairement : un simple rechargement d'abord (le
 * cas normal, et le moins brutal) ; si APRÈS ce rechargement la page tourne
 * toujours sur l'ancien bundle — c'est-à-dire que le service worker sert un
 * index.html périmé depuis son précache — alors seulement on désinscrit le SW
 * et on vide les caches, exactement le geste manuel qui débloquait la
 * situation. Le drapeau de passage est en sessionStorage : aucune boucle
 * possible, une tentative par étape.
 */

/**
 * ⚠️ DEUX ERREURS SUCCESSIVES ICI, corrigées — à lire avant de retoucher.
 *
 * 1. La 1re version ne comparait que le bundle JS. Un changement de CSS seul
 *    ne modifie pas son hash, et l'essentiel des modifications de la journée
 *    était précisément du CSS : elle ne détectait rien.
 *
 * 2. La 2e comparait TOUS les assets référencés. C'est elle qui a fait
 *    "tourner l'app en boucle" chez l'utilisateur : index.html contient huit
 *    balises `<link rel="modulepreload">` vers des morceaux de code, or la
 *    page en cours ne les expose PAS sous cette forme. Ces huit assets étaient
 *    donc toujours "présents côté serveur, absents côté page" — la page était
 *    jugée périmée en permanence, y compris juste après un rechargement, d'où
 *    rechargement → purge → rechargement… sans fin.
 *
 * D'où la règle actuelle, volontairement étroite : on ne compare QUE les deux
 * assets d'entrée (`/assets/index-*.js` et `/assets/index-*.css`). Ce sont les
 * seuls dont on est certain qu'ils figurent des deux côtés, et ils suffisent
 * comme empreinte de version : le bundle d'entrée référence les noms de tous
 * les morceaux, donc son hash change dès que n'importe lequel change.
 */

const ENTRY_RE = /\/assets\/index-[A-Za-z0-9._-]+\.(?:js|css)/g

/** Assets d'entrée référencés par le HTML servi par le serveur. */
export function assetsFromHtml(html) {
  if (typeof html !== 'string') return []
  return [...new Set(html.match(ENTRY_RE) ?? [])].sort()
}

/** Assets d'entrée réellement chargés par la page en cours. */
export function assetsFromDocument(doc = document) {
  const nodes = doc.querySelectorAll('script[src], link[href]')
  const found = [...nodes]
    .map(el => el.getAttribute('src') || el.getAttribute('href') || '')
    .flatMap(u => u.match(ENTRY_RE) ?? [])
  return [...new Set(found)].sort()
}

/**
 * @returns 'ok' | 'reload' | 'purge'  — l'action à mener.
 * Séparé du reste (et testé) : c'est la seule décision qui puisse être fausse,
 * et une erreur ici coûte cher — la preuve.
 */
export function decideUpdateAction(running, deployed, alreadyReloaded) {
  // Une des deux listes est vide (HTML inattendu, réseau coupé, mode dev) :
  // on ne touche à rien. Ne jamais recharger sur une simple incertitude.
  if (!running?.length || !deployed?.length) return 'ok'
  const present = new Set(running)
  if (deployed.every(a => present.has(a))) return 'ok'
  return alreadyReloaded ? 'purge' : 'reload'
}

const FLAG = 'sf_update_reload'
const ATTEMPTS_KEY = 'sf_update_attempts'
const MAX_ATTEMPTS = 2
const COOLDOWN_MS = 6 * 60 * 60_000
const MIN_INTERVAL_MS = 2 * 60_000

let lastCheck = 0

function readAttempts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? 'null')
    if (raw && typeof raw.n === 'number' && typeof raw.t === 'number') return raw
  } catch { /* illisible */ }
  return { n: 0, t: 0 }
}

function writeAttempts(n) {
  try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify({ n, t: Date.now() })) } catch {}
}

function clearAttempts() {
  try { localStorage.removeItem(ATTEMPTS_KEY) } catch {}
  try { sessionStorage.removeItem(FLAG) } catch {}
}

async function purgeAndReload() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
    await Promise.all(regs.map(r => r.unregister()))
  } catch { /* rien à faire de plus */ }
  try {
    const keys = await caches?.keys?.() ?? []
    await Promise.all(keys.map(k => caches.delete(k)))
  } catch { /* idem */ }
  window.location.reload()
}

/**
 * Vérifie une fois si la page tourne sur le bundle déployé, et se remet à
 * jour toute seule sinon.
 */
export async function checkAppVersion() {
  const now = Date.now()
  if (now - lastCheck < MIN_INTERVAL_MS) return
  lastCheck = now

  const running = assetsFromDocument()
  if (running.length === 0) return   // serveur de dev : aucun asset haché

  let deployed
  try {
    // Le paramètre aléatoire est ce qui fait sortir la requête du précache du
    // service worker (Workbox ne fait correspondre que les URLs qu'il connaît) :
    // sans lui, on comparerait le bundle courant… à la copie périmée que le SW
    // garde justement en cache, et on ne verrait jamais la différence.
    const res  = await fetch(`/index.html?v=${now}`, { cache: 'no-store' })
    if (!res.ok) return
    deployed = assetsFromHtml(await res.text())
  } catch {
    return   // hors ligne : surtout ne rien casser
  }

  let alreadyReloaded = false
  try { alreadyReloaded = sessionStorage.getItem(FLAG) === '1' } catch {}

  const action = decideUpdateAction(running, deployed, alreadyReloaded)

  if (action === 'ok') {
    // À jour : on repart d'une ardoise propre, une prochaine mise à jour
    // aura droit à ses deux tentatives.
    clearAttempts()
    return
  }

  // Périmé, mais on a déjà essayé sans succès : on ARRÊTE. Mieux vaut une app
  // légèrement en retard qu'une app qui redémarre en boucle.
  const attempts = readAttempts()
  const enSommeil = attempts.n >= MAX_ATTEMPTS && Date.now() - attempts.t < COOLDOWN_MS
  if (enSommeil) return
  if (attempts.n >= MAX_ATTEMPTS) clearAttempts()   // sommeil terminé, on peut réessayer

  writeAttempts(readAttempts().n + 1)

  if (action === 'reload') {
    try { sessionStorage.setItem(FLAG, '1') } catch {}
    window.location.reload()
  } else {
    await purgeAndReload()
  }
}
