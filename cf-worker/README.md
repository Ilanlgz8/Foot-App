# statfootix-cron — Worker Cloudflare

Remplace le polling ESPN toutes les minutes qui tournait avant sur Vercel
(`api/cron-goals.js`, appelé par cron-job.org). Voir le commentaire en tête de
`src/index.js` pour le contexte complet : ce Worker fait le fetch ESPN + la
détection (but/carton/KO/mi-temps/fin), gratuitement, et n'appelle Vercel que
pour la partie réellement coûteuse en CPU (envoi push chiffré par abonné),
uniquement quand il y a vraiment quelque chose à notifier.

## Déploiement (une seule fois)

1. **Compte Cloudflare** (gratuit) : https://dash.cloudflare.com/sign-up si pas
   déjà fait.

2. **Installer les dépendances** (depuis ce dossier `cf-worker/`) :
   ```
   npm install
   ```

3. **Se connecter à Cloudflare** :
   ```
   npx wrangler login
   ```
   Ouvre une page dans le navigateur pour autoriser l'accès — normal, à faire
   une seule fois.

4. **Configurer les 4 secrets** (jamais dans wrangler.toml, jamais commit) :
   ```
   npx wrangler secret put KV_REST_API_URL
   npx wrangler secret put KV_REST_API_TOKEN
   npx wrangler secret put CRON_SECRET
   npx wrangler secret put VERCEL_NOTIFY_URL
   ```
   - `KV_REST_API_URL` / `KV_REST_API_TOKEN` : **exactement les mêmes valeurs**
     que dans Vercel (Settings → Environment Variables) — c'est le même Redis
     Upstash, partagé entre les deux.
   - `CRON_SECRET` : **exactement la même valeur** que `CRON_SECRET` sur
     Vercel.
   - `VERCEL_NOTIFY_URL` : `https://statfootix.vercel.app/api/cron-goals`

5. **Déployer** :
   ```
   npm run deploy
   ```
   Wrangler affiche une URL type `https://statfootix-cron.<compte>.workers.dev`
   — pas besoin de la retenir, le Cron Trigger tourne tout seul en arrière-plan
   dès le déploiement, aucun appel externe n'est nécessaire pour le déclencher.

## Vérifier que ça tourne

- **Logs en direct** : `npm run tail` (laisser tourner ~1-2 min, une ligne
  doit apparaître chaque minute).
- **Déclenchement manuel** (sans attendre la prochaine minute) :
  ```
  curl "https://statfootix-cron.<compte>.workers.dev/?secret=<CRON_SECRET>"
  ```
- **Vérif côté app** : `/api/debug-push?secret=<CRON_SECRET>` sur Vercel
  affichera toujours `lastRun` à jour — ce marqueur est maintenant posé par le
  Worker (même clé Redis partagée), la vérif existante n'a rien à changer.

## Après vérification : désactiver cron-job.org

Une fois que le Worker tourne bien (logs propres pendant 10-15 min, une notif
de test reçue si un match est en cours), **désactive le job sur
cron-job.org** — il ne sert plus à rien, et le laisser actif rappellerait
Vercel chaque minute pour rien (mode complet historique, toujours disponible
en fallback mais plus besoin d'être déclenché automatiquement).

## Si besoin de revenir en arrière

Le mode complet (polling + envoi, tout sur Vercel) est **toujours dans
`api/cron-goals.js`**, inchangé — il suffit de réactiver le job cron-job.org
pointant sur `/api/cron-goals` pour retrouver exactement le comportement
d'avant, le temps de déboguer le Worker si besoin.
