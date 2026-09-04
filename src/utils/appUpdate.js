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

/** URL de l'asset servi par le serveur, extraite du HTML. */
export function assetFromHtml(html) {
  if (typeof html !== 'string') return null
  const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)
  return m ? m[0] : null
}

/** Chemin de l'asset réellement en train de tourner. */
export function assetFromUrl(url) {
  if (typeof url !== 'string') return null
  const m = url.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)
  return m ? m[0] : null
}

/**
 * @returns 'ok' | 'reload' | 'purge'  — l'action à mener.
 * Séparé du reste (et testé) : c'est la seule décision qui puisse être fausse,
 * et une erreur ici coûterait cher (boucle de rechargement).
 */
export function decideUpdateAction(running, deployed, alreadyReloaded) {
  // Une des deux valeurs manque (HTML inattendu, réseau coupé) : on ne touche
  // à rien. Ne jamais recharger sur une simple incertitude.
  if (!running || !deployed) return 'ok'
  if (running === deployed) return 'ok'
  return alreadyReloaded ? 'purge' : 'reload'
}

const FLAG = 'sf_update_reload'
const MIN_INTERVAL_MS = 2 * 60_000

let lastCheck = 0

async function purgeAndReload() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
    await Promise.all(regs.map(r => r.unregister()))
  } catch { /* rien à faire de plus */ }
  try {
    const keys = await caches?.keys?.() ?? []
    await Promise.all(keys.map(k => caches.delete(k)))
  } catch { /* idem */ }
  try { sessionStorage.removeItem(FLAG) } catch {}
  window.location.reload()
}

/**
 * Vérifie une fois si la page tourne sur le bundle déployé, et se remet à
 * jour toute seule sinon.
 * @param {string} runningUrl  typiquement import.meta.url
 */
export async function checkAppVersion(runningUrl) {
  const now = Date.now()
  if (now - lastCheck < MIN_INTERVAL_MS) return
  lastCheck = now

  const running = assetFromUrl(runningUrl)
  if (!running) return   // build inattendu (dev) : on ne fait rien

  let deployed
  try {
    // Le paramètre aléatoire est ce qui fait sortir la requête du précache du
    // service worker (Workbox ne fait correspondre que les URLs qu'il connaît) :
    // sans lui, on comparerait le bundle courant… à la copie périmée que le SW
    // garde justement en cache, et on ne verrait jamais la différence.
    const res  = await fetch(`/index.html?v=${now}`, { cache: 'no-store' })
    if (!res.ok) return
    deployed = assetFromHtml(await res.text())
  } catch {
    return   // hors ligne : surtout ne rien casser
  }

  let alreadyReloaded = false
  try { alreadyReloaded = sessionStorage.getItem(FLAG) === '1' } catch {}

  switch (decideUpdateAction(running, deployed, alreadyReloaded)) {
    case 'reload':
      try { sessionStorage.setItem(FLAG, '1') } catch {}
      window.location.reload()
      break
    case 'purge':
      await purgeAndReload()
      break
    default:
      // À jour : on efface le drapeau pour que la prochaine mise à jour
      // reparte bien par l'étape douce.
      try { sessionStorage.removeItem(FLAG) } catch {}
  }
}
