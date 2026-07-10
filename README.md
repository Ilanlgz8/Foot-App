# StatFootix

PWA football (React + Vite) : matchs en direct, résultats, classements, compositions, notifications push — Coupe du Monde 2026 et grands championnats européens.

Déployé sur Vercel : `https://statfootix.vercel.app`

## Stack

- **Frontend** : React 19, Vite, React Router, TanStack Query, vite-plugin-pwa (Workbox)
- **Données** : ESPN (live), football-data.org (matchs/classements), FotMob (xG). `api-football` désactivé définitivement (compte suspendu à répétition — voir `api/apifootball.js`)
- **Backend** : Vercel serverless functions (`api/*`)
- **Push notifs** : Web Push VAPID (`web-push`), abonnements dans Upstash Redis
- **Temps quasi réel** : Ably (pub/sub), en complément du polling
- **Cron externe** : cron-job.org → `/api/cron-goals` chaque minute

Détail complet de l'architecture (routes, hooks, conventions) : voir `CLAUDE.md`.

## Développement

```bash
npm install
npm run dev       # serveur de dev
npm run build     # build production
npm run test      # tests unitaires (vitest)
npm run lint      # eslint
```

## Structure

```
src/        composants, pages, hooks, contexte, utilitaires React
api/        fonctions serverless Vercel (proxy ESPN/FD.org, notifs, live)
public/     assets statiques + service worker push
```
