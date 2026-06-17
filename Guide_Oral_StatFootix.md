# Guide oral — StatFootix

> Durée cible : ~20 min | ~2 min par slide

---

## Slide 1 — Présentation du projet

**Ce que tu montres :** titre, stack technique (React, TanStack Query, Netlify Functions, football-data.org)

**Ce que tu dis :**

> "StatFootix c'est une application web de stats football en temps réel. L'idée c'est de pouvoir suivre les matchs en direct, consulter les classements, les résultats et les buteurs — le tout dans une interface propre.
>
> Côté stack : React 18 pour l'UI, TanStack Query pour toute la gestion des données et du cache, et Netlify Functions comme couche serveur pour sécuriser les appels aux APIs externes."

---

## Slide 2 — Architecture : comment les données circulent

**Ce que tu montres :** schéma en 3 couches (Navigateur → Netlify → APIs)

**Ce que tu dis :**

> "L'architecture est en trois couches. Le navigateur ne parle jamais directement aux APIs externes — il passe toujours par une Netlify Function qui joue le rôle de proxy sécurisé.
>
> On a 4 sources de données :
> - football-data.org pour les matchs, classements et résultats
> - api-football.com pour les minutes précises en direct
> - ESPN pour les scores en temps quasi-réel
> - 4 flux RSS agrégés pour les actualités foot
>
> Chaque source a sa propre Netlify Function. Le navigateur appelle `/api/...` ou `/espn/...` — il ne voit jamais la vraie URL ni la clé API."

---

## Slide 3 — Sécuriser la clé API avec Netlify Functions

**Ce que tu montres :** comparaison ❌ sans proxy vs ✅ avec proxy

**Ce que tu dis :**

> "Le problème de base : si tu mets ta clé API directement dans le code React, elle est visible dans DevTools, n'importe qui peut la récupérer et consommer ton quota.
>
> La solution : une Netlify Function qui tourne côté serveur. Le code React appelle `/api/v4/matches` — Netlify intercepte, ajoute la vraie clé depuis une variable d'environnement, et retransmet la réponse. La clé ne quitte jamais le serveur.
>
> Détail important : si l'API répond 429 (trop de requêtes), on retransmet ce code tel quel. TanStack Query le détecte et conserve les données précédentes — pas de spinner, pas de page blanche."

---

## Slide 4 — TanStack Query : le pattern commun

**Ce que tu montres :** code de `useMatches` avec annotations queryKey / queryFn / staleTime

**Ce que tu dis :**

> "Toute la gestion des données suit le même pattern avec TanStack Query : un hook, une queryKey, une queryFn.
>
> La queryKey c'est l'identifiant de la donnée en cache. Si je change de compétition, la clé change, TanStack fait automatiquement un nouveau fetch. Si deux composants utilisent la même clé en même temps — par exemple la page Résultats et le panel Accueil — il n'y a qu'une seule requête réseau. C'est le cache partagé.
>
> Le staleTime : tant que la donnée est 'fraîche', aucun refetch inutile. Ça préserve le quota API."

---

## Slide 5 — Récupérer les matchs du jour

**Ce que tu montres :** `fetchTodayMatches` avec les deux requêtes et le `delay(700)`

**Ce que tu dis :**

> "Premier problème découvert : l'endpoint global de football-data.org en tier gratuit ne retourne pas les matchs de la Coupe du Monde. Donc pour avoir tous les matchs d'une journée, il faut faire deux requêtes séparées — une pour les ligues européennes, une pour la WC.
>
> Le `delay(700)` entre les deux c'est important : l'API limite à 10 requêtes par minute. Sans ce délai, on peut se prendre un 429 au chargement.
>
> Ensuite on déduplique par ID (au cas où un match apparaît dans les deux réponses) et on trie chronologiquement."

---

## Slide 6 — Afficher un match : MatchCard

**Ce que tu montres :** code de `MatchCard` avec blasons, scores, `calcMinute()`

**Ce que tu dis :**

> "MatchCard c'est le composant de base — il affiche un match dans n'importe quel contexte : panel du jour, widget live, résultats.
>
> Pour le score : on priorise ESPN plutôt que football-data.org, parce qu'ESPN met à jour en moins de 10 secondes alors que football-data.org a un délai d'environ 1 minute. Si ESPN n'a pas le score, l'opérateur `?.` fait le fallback automatiquement.
>
> Pour la minute : `calcMinute()` calcule côté client depuis les timestamps stockés en localStorage. Elle est mise à jour toutes les 30 secondes via un `setInterval` sans aucun refetch réseau — ça affiche '73'', 'MT', '90+2'' selon l'état du match."

---

## Slide 7 — Résultats : fetch + affichage

**Ce que tu montres :** `useMatches` avec queryKey partagée, code d'affichage

**Ce que tu dis :**

> "Pour les résultats, le point clé c'est le cache partagé. La page Résultats et le panel 'Résultats récents' de l'Accueil utilisent exactement le même hook avec la même queryKey. Donc une seule requête pour les deux — dès que la page Résultats se met à jour, le panel Accueil est à jour aussi instantanément.
>
> Pour l'affichage : les blasons viennent directement de l'URL fournie par l'API, pas besoin de les stocker. Si l'URL est vide on affiche la première lettre du nom. Le gagnant est mis en évidence avec une classe CSS."

---

## Slide 8 — Classements : useStandings

**Ce que tu montres :** `useStandings` avec gestion multi-groupes, tableau HTML

**Ce que tu dis :**

> "Le classement a une complexité particulière : l'API retourne une structure différente selon la compétition. Pour un championnat classique comme la Premier League, c'est un seul tableau. Pour la Coupe du Monde ou la Ligue des Champions, c'est plusieurs groupes — Groupe A, B, C...
>
> Le hook détecte ça automatiquement : si `realGroups.length > 1`, on est en mode multi-groupes. Sinon, tableau unique. Le composant Classement.jsx n'a pas besoin de savoir quelle compétition est chargée — il reçoit `groups` et `standings` et s'adapte."

---

## Slide 9 — Top buteurs : useScorers

**Ce que tu montres :** `useScorers` avec `enabled`, affichage top 3 stylisé

**Ce que tu dis :**

> "Un détail intéressant ici : le paramètre `enabled: !!compId`. TanStack Query permet de désactiver une requête conditionnellement — si aucune compétition n'est sélectionnée, la requête ne part pas du tout. Pas besoin d'un `if` dans le composant, TanStack gère ça nativement.
>
> Le staleTime est à 10 minutes parce que les stats de buteurs ne changent qu'après un but — pas besoin de rafraîchir toutes les 30 secondes."

---

## Slide 10 — Scores en direct : overlay ESPN

**Ce que tu montres :** `useEspnScores` avec fuzzy matching, `refetchInterval: 10_000`

**Ce que tu dis :**

> "Le vrai problème du temps réel : football-data.org free tier met environ 1 minute à mettre à jour les scores. Pour un match en direct c'est trop long.
>
> Solution : ESPN a une API publique non officielle qui met à jour en moins de 10 secondes. On la poll toutes les 10 secondes uniquement quand un match est en cours — le paramètre `enabled` s'en charge.
>
> Le challenge c'est le fuzzy matching : les noms d'équipes sont différents entre ESPN et football-data.org. 'PSG' d'un côté, 'Paris Saint-Germain' de l'autre. La solution : on normalise les noms (minuscules, accents retirés) et on compare les 5 premiers caractères. 'paris' correspond à 'paris saint-germain'. Ça marche pour 99% des cas."

---

## Slide 11 — Conclusion

**Ce que tu montres :** récapitulatif des 4 points clés

**Ce que tu dis :**

> "Pour résumer ce que j'ai retenu de ce projet :
>
> 1. Le proxy Netlify c'est non-négociable dès qu'il y a une clé API — une ligne dans netlify.toml et la clé ne quitte plus le serveur.
>
> 2. TanStack Query simplifie énormément la gestion des données : un pattern, ça couvre fetch, cache, loading, error et refetch automatique.
>
> 3. ESPN comme overlay c'est une solution pragmatique quand l'API principale est trop lente — on garde football-data.org comme source de vérité et ESPN pour la fraîcheur.
>
> 4. `enabled` et `staleTime` c'est ce qui fait qu'on ne brûle pas le quota : zéro requête inutile."

---

## Conseils généraux

- **Si on te demande pourquoi pas un backend custom** : Netlify Functions c'est suffisant pour ce besoin, zéro infrastructure à gérer, déploiement automatique.
- **Si on te demande pourquoi pas GraphQL / SWR** : TanStack Query est le standard pour React, plus complet que SWR, plus simple que gérer Apollo.
- **Si on te demande les limites** : le free tier football-data.org limite à 10 req/min et 100 req/jour pour api-football.com — l'app est pensée pour un usage personnel, pas à l'échelle.
- **Si l'app ne charge pas en démo** : dire que les APIs ont des quotas et proposer de montrer le code directement.
