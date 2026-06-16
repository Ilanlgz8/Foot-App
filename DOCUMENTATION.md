# Documentation — Foot App

> Guide complet pour comprendre tout le code du projet, les concepts React utilisés, et le rôle de chaque fichier.

---

## Table des matières

1. [Vue d'ensemble du projet](#1-vue-densemble-du-projet)
2. [Technologies utilisées](#2-technologies-utilisées)
3. [Structure des fichiers](#3-structure-des-fichiers)
4. [Concepts clés à comprendre](#4-concepts-clés-à-comprendre)
5. [Point d'entrée — `main.jsx`](#5-point-dentrée--mainjsx)
6. [Routeur principal — `App.jsx`](#6-routeur-principal--appjsx)
7. [Les Composants](#7-les-composants)
   - [Navbar](#navbar)
   - [Accueil](#accueil)
   - [Match (Matchs à venir)](#match-matchs-à-venir)
   - [Resultat](#resultat)
   - [Classement](#classement)
   - [MatchModal](#matchmodal)
8. [Les Hooks personnalisés](#8-les-hooks-personnalisés)
   - [useMatches](#usematches)
   - [useMatchDetails](#usematchdetails)
   - [useNews](#usenews)
   - [useStandings](#usestandings)
   - [useTeamForm](#useteamform)
   - [useTodayMatches](#usetodaymatches)
   - [useScorers](#usescorers)
   - [useTopStandings](#usetopstandings)
   - [useRecentResults](#userecentresults)
9. [Les données statiques](#9-les-données-statiques)
   - [competitions.js](#competitionsjs)
   - [teamNames.js](#teamnamesjs)
10. [Styles globaux et animations](#10-styles-globaux-et-animations)
11. [Configuration](#11-configuration)
    - [vite.config.js — Le proxy API](#viteconfigjs--le-proxy-api)
    - [package.json — Les dépendances](#packagejson--les-dépendances)

---

## 1. Vue d'ensemble du projet

**Foot App** est une application web de football qui affiche :
- Les **actualités** football (via GNews API)
- Les **matchs du jour** en temps réel, groupés par compétition
- Les **matchs à venir** par compétition et par journée
- Les **résultats** des matchs terminés
- Le **classement** de chaque championnat + le **classement des buteurs**

Les données de matchs viennent de l'API **football-data.org**. Les articles viennent de l'API **GNews**.

---

## 2. Technologies utilisées

| Technologie | Rôle | Explication simple |
|---|---|---|
| **React 19** | Framework UI | Permet de construire l'interface avec des composants réutilisables |
| **Vite** | Bundler / serveur de dev | Lance le serveur local, compile le projet pour la production |
| **React Router v7** | Navigation | Gère les différentes pages (`/`, `/matchs`, `/resultats`, `/classement`) sans recharger la page |
| **TanStack React Query v5** | Gestion des données API | Fait les requêtes HTTP, met en cache les résultats, gère les états loading/error |
| **Tailwind CSS v4** | Styles utilitaires | Classes CSS prédéfinies (en complément du CSS custom) |

---

## 3. Structure des fichiers

```
src/
├── main.jsx              ← Point d'entrée : monte l'app dans le HTML
├── App.jsx               ← Définit les routes (pages)
├── index.css             ← Styles globaux, variables CSS, animations, skeleton .sk
├── components/
│   ├── navbar.jsx        ← Barre de navigation
│   ├── Accueil.jsx       ← Page d'accueil (news + widgets matchs du jour)
│   ├── Match.jsx         ← Page "Matchs à venir" avec modale de détails
│   ├── Resultat.jsx      ← Page "Résultats" (sans modale)
│   ├── Classement.jsx    ← Page "Classement" + vue "Buteurs"
│   └── MatchModal.jsx    ← Popup détails d'un match (utilisée dans Match.jsx)
├── hooks/
│   ├── useMatchs.js      ← Matchs d'une compétition (SCHEDULED ou FINISHED)
│   ├── useMatchDetails.js← Détails complets d'un match par son ID
│   ├── useNews.js        ← Actualités football depuis GNews API
│   ├── useStandings.js   ← Classement d'une compétition (simple ou multi-groupes)
│   ├── useTeamForm.js    ← Forme récente de chaque équipe (5 derniers matchs)
│   ├── useTodayMatches.js← Matchs du jour toutes compétitions confondues
│   ├── useScorers.js     ← Top 20 buteurs d'une compétition
│   ├── useTopStandings.js← Top 5 de chaque grand championnat (en parallèle)
│   └── useRecentResults.js← Derniers résultats de chaque ligue
└── data/
    ├── competitions.js   ← Liste des compétitions avec leurs logos et IDs API
    └── teamNames.js      ← Dictionnaire de traduction des noms d'équipes en français
```

---

## 4. Concepts clés à comprendre

### Qu'est-ce qu'un **Composant** React ?

Un composant, c'est une fonction JavaScript qui **retourne du JSX** (du HTML écrit dans du JS). Chaque page ou élément d'interface est un composant.

```jsx
// Exemple simple
function MonBouton({ texte }) {
  return <button>{texte}</button>
}

// Utilisation :
<MonBouton texte="Cliquer ici" />
```

Chaque composant peut recevoir des **props** (des paramètres), avoir son propre état interne, et être réutilisé partout dans l'app.

---

### Qu'est-ce qu'un **Hook** ?

Un hook est une **fonction spéciale de React** dont le nom commence toujours par `use`. Les hooks permettent d'ajouter des fonctionnalités aux composants (état, effets, données...).

#### `useState`
Crée une **variable réactive** : quand elle change, React re-affiche le composant automatiquement.

```jsx
const [selectedComp, setSelectedComp] = useState('FL1')
//     ↑ valeur actuelle  ↑ fonction pour la changer  ↑ valeur initiale
```

> Dans l'app, `useState` sert à retenir quelle compétition est sélectionnée, quelle vue est active (classement ou buteurs), à quelle journée on en est, etc.

#### `useEffect`
Exécute du code **après que le composant s'est affiché**, ou quand une valeur change.

```jsx
useEffect(() => {
  // code qui s'exécute après le rendu
}, [dependency]) // ← se ré-exécute si "dependency" change
```

> Dans cette app, `useEffect` n'est presque pas utilisé directement — React Query le remplace pour les appels API.

---

### Qu'est-ce qu'un **Hook personnalisé** ?

C'est une fonction `use...` que **tu crées toi-même** pour regrouper de la logique réutilisable. Par exemple, `useMatches` est un hook qui fait l'appel API pour les matchs et renvoie `{ matches, loading, error }`. Ainsi, n'importe quel composant peut utiliser ce hook sans réécrire la logique.

---

### Qu'est-ce que **React Query** (`useQuery`) ?

React Query est une bibliothèque qui gère les **appels API** de façon intelligente :
- Elle fait la requête HTTP
- Elle retourne automatiquement `isLoading` (chargement en cours), `data` (données reçues), `error` (si ça plante)
- Elle **met en cache** les résultats : si on revient sur la même page, les données sont déjà là sans refaire une requête
- Elle sait quand les données sont "périmées" (`staleTime`) et les rafraîchit automatiquement

```js
const { data, isLoading, error } = useQuery({
  queryKey: ['matches', 'FL1'],  // clé unique pour identifier ce cache
  queryFn: async () => { /* fetch API */ },
  staleTime: 1000 * 60 * 5,     // considère les données fraîches pendant 5 min
})
```

---

### Qu'est-ce que **JSX** ?

Du HTML écrit dans du JavaScript. Le navigateur ne comprend pas directement JSX — Vite le compile en JavaScript pur.

```jsx
// JSX
const element = <h1 className="titre">Bonjour</h1>

// Ce que ça devient après compilation
const element = React.createElement('h1', { className: 'titre' }, 'Bonjour')
```

Note : en JSX on écrit `className` au lieu de `class` (car `class` est un mot réservé en JS).

---

### Qu'est-ce que le **routing** (React Router) ?

Le routing permet d'avoir plusieurs "pages" sans recharger le navigateur (c'est une **SPA** — Single Page Application). L'URL change, mais c'est React qui affiche le bon composant.

```jsx
<Routes>
  <Route path="/"           element={<Accueil />} />
  <Route path="/matchs"     element={<MatchAVenir />} />
  <Route path="/resultats"  element={<Resultat />} />
  <Route path="/classement" element={<Classement />} />
</Routes>
```

`NavLink` fonctionne comme un `<a>` HTML mais sans recharger la page, et il sait si le lien est actif.

---

## 5. Point d'entrée — `main.jsx`

```jsx
// main.jsx
createRoot(document.getElementById('root')).render(
  <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </PersistQueryClientProvider>
)
```

C'est **le point de départ** de toute l'application. Il fait trois choses :

1. **`createRoot(...).render(...)`** — Monte l'app React dans la balise `<div id="root">` du fichier `index.html`.

2. **`BrowserRouter`** — Active le système de navigation (React Router). Tout ce qui est à l'intérieur peut utiliser `<Routes>`, `<NavLink>`, etc.

3. **`PersistQueryClientProvider`** — Configure React Query avec la **persistance** : les données récupérées depuis l'API sont sauvegardées dans le `localStorage` du navigateur. Ainsi si tu fermes et rouvres l'app, les données sont là immédiatement sans attendre.

```js
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // garde le cache 24h dans localStorage
      retry: false,                 // n'essaie pas de refaire la requête si ça échoue
      refetchOnWindowFocus: false,  // ne recharge pas quand on revient sur l'onglet
    }
  }
})

const persister = createSyncStoragePersister({
  storage: window.localStorage   // sauvegarde dans localStorage
})
```

> **`gcTime`** (Garbage Collection Time) = combien de temps garder les données en cache avant de les supprimer de la mémoire.

---

## 6. Routeur principal — `App.jsx`

```jsx
function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<Accueil />} />
        <Route path="/matchs" element={<MatchAVenir />} />
        <Route path="/resultats" element={<Resultat />} />
        <Route path="/classement" element={<Classement />} />
      </Routes>
    </>
  )
}
```

`App.jsx` est le **squelette de l'application** :
- La `Navbar` est **toujours visible** (en dehors des `Routes`)
- Selon l'URL, React affiche le bon composant de page

Le fragment `<>...</>` (aussi appelé **Fragment React**) permet de regrouper plusieurs éléments sans ajouter une balise `<div>` inutile dans le HTML.

---

## 7. Les Composants

### Navbar

**Fichier :** `src/components/navbar.jsx`

La barre de navigation affichée sur toutes les pages.

```jsx
const navigation = [
  { name: 'Accueil', href: '/' },
  { name: 'Match à venir', href: '/matchs' },
  ...
]
```

La liste `navigation` est un **tableau d'objets**. On utilise `.map()` pour boucler dessus et créer un `NavLink` pour chaque item.

```jsx
{navigation.map((item) => (
  <NavLink
    key={item.href}       // ← clé unique obligatoire pour les listes en React
    to={item.href}
    className={({ isActive }) =>
      isActive ? 'navbar__navLink navbar__navLink--active' : 'navbar__navLink'
    }
  >
    {item.name}
  </NavLink>
))}
```

**`className` avec une fonction** : React Router passe un objet `{ isActive }` à la fonction. Si le lien correspond à l'URL actuelle, `isActive` est `true` et on ajoute la classe CSS `--active`.

---

### Accueil

**Fichier :** `src/components/Accueil.jsx`

Page d'accueil avec deux sections : les matchs du jour (en widgets par compétition) et les actualités.

```jsx
// Fonction module-level (hors du composant) : regroupe les matchs par compétition
function groupByComp(matches) {
  const map = {}
  matches.forEach(m => {
    const key = m.competition?.code ?? 'OTHER'
    if (!map[key]) map[key] = {
      comp: COMPETITIONS.find(c => c.id === key) ?? { name: m.competition?.name },
      matches: []
    }
    map[key].matches.push(m)
  })
  return Object.values(map)
}

function Accueil() {
  const { news, loading: newsLoading, error: newsError } = useNews()
  const { matches, loading: matchesLoading } = useTodayMatches()

  const compGroups = groupByComp(matches) // tableau de groupes par compétition
  ...
}
```

**Pourquoi `groupByComp` est hors du composant ?** Si elle était déclarée à l'intérieur, React la recréerait à chaque render. Définie au niveau du module, elle est créée une seule fois — meilleur pour les performances.

**Affichage en widgets :**
```jsx
// Un widget par compétition, avec la liste des matchs dedans
<div className="accueil__widgets">
  {compGroups.map((group, gi) => (
    <div key={gi} className="accueil__widget">
      <div className="accueil__widgetCompHeader">
        {group.comp?.emblem && <img src={group.comp.emblem} ... />}
        <span>{group.comp?.name}</span>
      </div>
      {group.matches.map(match => (
        // Chaque match : grille 1fr 5.5rem 1fr (domicile | score/heure | extérieur)
        <div key={match.id} className="accueil__widgetMatch">...</div>
      ))}
    </div>
  ))}
</div>
```

**Statuts de match :**
```jsx
const isLive     = match.status === 'IN_PLAY' || match.status === 'PAUSED'
const isFinished = match.status === 'FINISHED'
// → affiche le score si terminé/en cours, sinon l'heure
{isFinished || isLive ? `${hs ?? 0} – ${as_ ?? 0}` : formatHour(match.utcDate)}
```

**L'opérateur `??`** (nullish coalescing) : retourne la valeur à droite si la valeur à gauche est `null` ou `undefined`. Donc `hs ?? 0` affiche `0` si le score n'est pas encore disponible.

---

### Match (Matchs à venir)

**Fichier :** `src/components/Match.jsx`

Affiche les matchs à venir, organisés par journée, avec navigation entre journées et une modale de détails au clic.

```jsx
const [selectedComp, setSelectedComp] = useState('FL1')    // compétition sélectionnée
const [selectedMatch, setSelectedMatch] = useState(null)   // match cliqué (pour la modale)
const [currentIndex, setCurrentIndex] = useState(0)        // index de la journée affichée
```

Les matchs sont **groupés par journée** grâce à la fonction `groupByMatchday` dans le hook `useMatches`. `grouped` est un tableau de paires `[numéroJournée, [matchs]]`.

```jsx
const currentGroup    = grouped[currentIndex]     // la journée actuelle
const currentMatchday = currentGroup?.[0]         // le numéro de la journée
const currentMatches  = currentGroup?.[1] ?? []   // les matchs de cette journée
const total           = grouped.length            // nombre total de journées
```

**L'opérateur `?.`** (optional chaining) : accède à une propriété sans planter si l'objet est `null` ou `undefined`. `currentGroup?.[0]` retourne `undefined` au lieu de lancer une erreur si `currentGroup` n'existe pas encore.

**Navigation journées :**
```jsx
<button onClick={() => setCurrentIndex(i => i - 1)} disabled={currentIndex <= 0}>←</button>
<button onClick={() => setCurrentIndex(i => i + 1)} disabled={currentIndex >= total - 1}>→</button>
```

`setCurrentIndex(i => i - 1)` utilise la **forme fonctionnelle** du setter : au lieu de passer directement une valeur, on passe une fonction qui reçoit l'état actuel (`i`) et retourne le nouvel état. C'est la bonne pratique quand le nouvel état dépend de l'ancien.

**Modale au clic :**
```jsx
onClick={() => setSelectedMatch(match)}   // ouvre la modale avec ce match

{selectedMatch && (
  <MatchModal matchId={selectedMatch.id} onClose={() => setSelectedMatch(null)} />
)}
```

`selectedMatch && <MatchModal />` : **rendu conditionnel** — le composant n'est rendu que si `selectedMatch` est non-nul.

---

### Resultat

**Fichier :** `src/components/Resultat.jsx`

Quasi identique à `Match.jsx` mais avec `status = 'FINISHED'` et `order = 'desc'` (journées les plus récentes en premier). **Pas de modale** — les résultats se lisent directement sur la card.

```jsx
const { matches, loading, error, grouped } = useMatches(selectedComp, 'FINISHED', 'desc')
```

**Mise en valeur du gagnant :**
```jsx
const hWin = hs > as_
const aWin = as_ > hs
const draw = hs === as_
// → classe CSS --loser sur l'équipe perdante (opacité réduite)
```

**Template literals** : les backticks `` ` `` permettent d'écrire des strings avec des expressions JS à l'intérieur via `${}`. Ici on ajoute dynamiquement la classe `--loser` si l'équipe a perdu.

---

### Classement

**Fichier :** `src/components/Classement.jsx`

Deux vues dans une même page, switchées par un toggle :
- **Vue "Classement"** : tableau des équipes avec points, victoires, forme, zones de qualification
- **Vue "Buteurs"** : liste des 20 meilleurs buteurs avec buts et passes décisives

```jsx
const [view, setView] = useState('classement') // 'classement' | 'buteurs'

const { standings, groups, loading, error } = useStandings(selectedComp)
const { formMap } = useTeamForm(selectedComp)
const { scorers, loading: scorersLoading, error: scorersError } = useScorers(selectedComp)
```

**Toggle classement / buteurs :**
```jsx
<div className="classement__viewToggle">
  <button
    className={`classement__viewBtn ${view === 'classement' ? 'classement__viewBtn--active' : ''}`}
    onClick={() => setView('classement')}
  >
    Classement
  </button>
  <button
    className={`classement__viewBtn ${view === 'buteurs' ? 'classement__viewBtn--active' : ''}`}
    onClick={() => setView('buteurs')}
  >
    Buteurs
  </button>
</div>
```

**Zone strip (légende UCL/Barrage/etc.) conditionnelle :**
```jsx
{view === 'classement' && (
  <div className="classement__zoneStrip">...</div>
)}
```
La légende est cachée quand on est sur la vue Buteurs — elle n'a pas de sens dans ce contexte.

**Règles de qualification par compétition :**
```js
const competitionRules = {
  FL1: [
    { label: 'Ligue des champions', start: 1, end: 3, dotClassName: '...', cardClassName: '...' },
    { label: 'Barrage',             start: 4, end: 4, ... },
    ...
  ],
  CL: [...],
  WC: [...],
  default: [...],
}
```

Un objet sert ici de **dictionnaire de configuration**. Chaque clé est un ID de compétition, chaque valeur est un tableau de règles. Ça évite les `if/else` imbriqués.

```js
function getQualificationZone(position) {
  return qualificationRules.find((rule) => position >= rule.start && position <= rule.end) ?? null
}
```

`.find()` parcourt le tableau et retourne le **premier élément** qui satisfait la condition.

**Composants internes** (définis dans `Classement.jsx`) :

```jsx
// Forme des équipes — traduit W/D/L → V/N/D, affiche des badges carrés colorés
function Forme({ results }) { ... }

// Tableau générique — réutilisé pour compétitions simples ET multi-groupes (CdM)
function StandingsTable({ rows }) { ... }

// Affichage multi-groupes (Coupe du Monde)
function MultiGroupView() { ... }
```

**Vue Buteurs :**
```jsx
{scorers.map((s, i) => (
  <div key={s.player?.id ?? i}
    className={`classement__scorerRow ${i < 3 ? `classement__scorerRow--top${i + 1}` : ''}`}
  >
    <span className="classement__scorerRank">{i + 1}</span>

    <div className="classement__scorerInfo">
      <span className="classement__scorerName">{s.player?.name}</span>
      <div className="classement__scorerTeamRow">
        <img src={s.team?.crest} ... />
        <span>{translateTeam(s.team?.shortName || s.team?.name)}</span>
      </div>
    </div>

    <div className="classement__scorerStats">
      <div className="classement__scorerStatItem classement__scorerStatItem--goals">
        <span className="classement__scorerGoals">{s.goals ?? 0}</span>
        <span className="classement__scorerStatLabel">G</span>
      </div>
      <div className="classement__scorerStatItem classement__scorerStatItem--assists">
        <span className="classement__scorerAssists">{s.assists ?? '—'}</span>
        <span className="classement__scorerStatLabel">A</span>
      </div>
    </div>
  </div>
))}
```

Les 3 premiers joueurs ont un fond dégradé spécial via les classes `--top1`, `--top2`, `--top3`.

---

### MatchModal

**Fichier :** `src/components/MatchModal.jsx`

Popup utilisée **uniquement dans `Match.jsx`** (pas dans Résultats). Elle montre les infos du match et la forme récente des deux équipes si disponibles.

```jsx
function MatchModal({ matchId, compId, onClose }) {
  const { match, loading, error } = useMatchDetails(matchId)
  const { formMap } = useTeamForm(compId)
  ...
}
```

**Props reçues :**
- `matchId` — l'ID du match pour faire l'appel API
- `compId` — l'ID de la compétition (pour récupérer la forme des équipes)
- `onClose` — une **fonction callback** : quand l'utilisateur ferme la modale, ce callback appelle `setSelectedMatch(null)` dans le parent

**Affichage conditionnel des sections :**
```jsx
// La section infos ne s'affiche que si l'API a renvoyé un stade ou des arbitres
{(match.venue || match.referees?.length > 0) && <div className="modal__infos">...</div>}

// La section forme ne s'affiche que si au moins une équipe a des données
{(homeForm.length > 0 || awayForm.length > 0) && <div className="modal__formes">...</div>}
```

**Fermeture en cliquant à l'extérieur :**
```jsx
<div className="modal__overlay" onClick={onClose}>
  <div className="modal__panel" onClick={e => e.stopPropagation()}>
```

`e.stopPropagation()` empêche le clic sur le panneau de "remonter" jusqu'à l'overlay. Sans ça, cliquer n'importe où dans la modale la fermerait.

---

## 8. Les Hooks personnalisés

Tous les hooks utilisent `useQuery` de React Query. Le principe est toujours le même :
1. On définit une `queryKey` (clé unique pour le cache)
2. On définit une `queryFn` (la fonction async qui fait le `fetch`)
3. On retourne les données formatées pour le composant

---

### useMatches

**Fichier :** `src/hooks/useMatchs.js`

Le hook le plus utilisé dans l'app. Récupère les matchs d'une compétition selon un statut.

```js
export function useMatches(selectedComp, status = 'SCHEDULED', order = 'asc') {
  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', selectedComp, status],
    queryFn: async () => {
      const res = await fetch(
        `/api/v4/competitions/${selectedComp}/matches?status=${status}`,
        { headers: { 'X-Auth-Token': API_KEY } }
      )
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      return json.matches ?? []
    },
    staleTime: 1000 * 60 * 5,
  })

  return {
    matches: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
    grouped: groupByMatchday(data ?? [], order),
  }
}
```

**`queryKey: ['matches', selectedComp, status]`** — La clé contient les paramètres. Ainsi, `['matches', 'FL1', 'SCHEDULED']` et `['matches', 'PL', 'FINISHED']` ont des caches **séparés**. Si `selectedComp` change, React Query refait automatiquement la requête.

**`async/await`** — Syntaxe moderne pour gérer les opérations asynchrones (qui prennent du temps, comme un appel réseau). `await fetch(...)` attend que la réponse arrive avant de continuer.

**`/api/v4/...`** — On n'appelle pas directement `https://api.football-data.org`. On passe par un proxy local `/api/...` configuré dans `vite.config.js` pour éviter les erreurs CORS.

**`groupByMatchday`** — Fonction locale qui transforme la liste de matchs en groupes par journée :

```js
function groupByMatchday(matches, order = 'asc') {
  const groups = {}
  matches.forEach(match => {
    const day = match.matchday
    if (!groups[day]) groups[day] = []
    groups[day].push(match)
  })
  // Object.entries transforme { 1: [...], 2: [...] } en [[1, [...]], [2, [...]]]
  return Object.entries(groups).sort(([a], [b]) =>
    order === 'asc' ? Number(a) - Number(b) : Number(b) - Number(a)
  )
}
```

---

### useMatchDetails

**Fichier :** `src/hooks/useMatchDetails.js`

Récupère les détails complets d'un match par son ID.

```js
export function useMatchDetails(matchId) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['matchDetails', matchId],
    queryFn: async () => { ... },
    enabled: !!matchId,        // ← n'exécute la requête que si matchId existe
    staleTime: 1000 * 60 * 60,
  })
  ...
}
```

**`enabled: !!matchId`** — `!!` convertit n'importe quelle valeur en booléen (`true`/`false`). Si `matchId` est `null` ou `undefined`, la requête ne se fait pas. C'est important car ce hook est appelé dès que le composant `MatchModal` est monté, mais on doit d'abord avoir un `matchId` valide.

---

### useNews

**Fichier :** `src/hooks/useNews.js`

Récupère les articles d'actualité football depuis **GNews API**.

```js
const FOOTBALL_KEYWORDS = ['football', 'foot', 'ligue', 'mercato', ...]

const uniqueArticles = [
  ...new Map(
    (json.articles ?? []).map(a => [
      a.title?.toLowerCase().replace(/[^\w\s]/g, '').trim(),
      a
    ])
  ).values()
]
```

**Déduplication via `Map`** : Une `Map` en JavaScript ne peut pas avoir deux fois la même clé. En utilisant le titre de l'article comme clé, on élimine automatiquement les doublons. `...` (spread operator) reconvertit ensuite le `Map` en tableau.

**`/[^\w\s]/g`** — Une **expression régulière** (regex). `[^\w\s]` signifie "tout caractère qui n'est ni une lettre/chiffre (`\w`) ni un espace (`\s`)". Le `g` signifie "global" (remplace toutes les occurrences). Cela permet de normaliser les titres pour mieux comparer.

```js
.filter(a => {
  const text = `${a.title ?? ''} ${a.description ?? ''}`.toLowerCase()
  return FOOTBALL_KEYWORDS.some(kw => text.includes(kw))
})
```

`.filter()` garde seulement les articles dont le titre ou la description contient au moins un mot-clé football. `.some()` retourne `true` dès qu'une condition est vraie pour au moins un élément.

---

### useStandings

**Fichier :** `src/hooks/useStandings.js`

Récupère le classement d'une compétition. Gère deux cas : classement simple (ligues) et multi-groupes (Coupe du Monde).

```js
const json = await res.json()
// standings[0].table = classement simple (Ligue 1, Premier League, etc.)
// Si plusieurs groupes (CdM), standings contient un objet par groupe
return json.standings?.[0]?.table ?? []
```

---

### useTeamForm

**Fichier :** `src/hooks/useTeamForm.js`

Calcule la forme récente (5 derniers matchs) de chaque équipe d'une compétition.

```js
const formMap = {}

matches.forEach(match => {
  const homeId = match.homeTeam.id
  const awayId = match.awayTeam.id
  const homeGoals = match.score.fullTime.home
  const awayGoals = match.score.fullTime.away

  const homeResult = homeGoals > awayGoals ? 'W' : homeGoals < awayGoals ? 'L' : 'D'
  const awayResult = awayGoals > homeGoals ? 'W' : awayGoals < homeGoals ? 'L' : 'D'

  if (!formMap[homeId]) formMap[homeId] = []
  formMap[homeId].push(homeResult)
  // idem pour awayId...
})

// Garde seulement les 5 derniers résultats
Object.keys(formMap).forEach(id => {
  formMap[id] = formMap[id].slice(-5)
})
```

`formMap` est un objet où chaque clé est un **ID d'équipe** et chaque valeur est un tableau de résultats. Par exemple : `{ 65: ['W', 'W', 'D', 'L', 'W'], 66: [...] }`.

`.slice(-5)` prend les 5 **derniers** éléments d'un tableau. Les index négatifs partent de la fin.

Ce hook est utilisé dans `Classement.jsx` et `MatchModal.jsx` pour afficher les badges de forme (V/N/D).

---

### useTodayMatches

**Fichier :** `src/hooks/useTodayMatches.js`

Récupère les matchs de **toutes les compétitions** pour aujourd'hui.

```js
const TODAY_COMPETITIONS = ['FL1', 'PL', 'PD', 'BL1', 'SA', 'CL', 'WC']
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

for (const id of TODAY_COMPETITIONS) {
  try {
    const res = await fetch(`/api/v4/competitions/${id}/matches`, ...)
    // filtre les matchs du jour...
  } catch (e) {
    console.error(id, 'erreur catch:', e)
  }
  await delay(800)  // ← attend 800ms entre chaque requête
}
```

**Pourquoi `await delay(800)` ?** L'API football-data.org a une limite de fréquence (**rate limiting**) : on ne peut pas envoyer trop de requêtes trop vite sinon on reçoit une erreur 429. En attendant 800ms entre chaque appel, on respecte cette limite.

**`for...of`** — Boucle sur un tableau en gardant `await` fonctionnel. Un `.forEach()` ne fonctionnerait pas ici avec `await` car il n'attend pas les promises.

**`try/catch`** — Si une requête échoue pour une compétition, on attrape l'erreur et on continue avec la suivante au lieu de tout arrêter.

---

### useScorers

**Fichier :** `src/hooks/useScorers.js`

Récupère les **20 meilleurs buteurs** d'une compétition.

```js
export function useScorers(compId) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['scorers', compId],
    queryFn: async () => {
      const res = await fetch(`/api/v4/competitions/${compId}/scorers?limit=20`, {
        headers: { 'X-Auth-Token': API_KEY }
      })
      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)
      const json = await res.json()
      return json.scorers ?? []
    },
    staleTime: 1000 * 60 * 10, // cache 10 minutes
    enabled: !!compId,
  })

  return {
    scorers: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
  }
}
```

Chaque objet `scorer` retourné par l'API contient :
- `scorer.player.name` — le nom du joueur
- `scorer.player.id` — l'ID unique (utilisé comme `key` en React)
- `scorer.team.name`, `scorer.team.crest` — équipe du joueur
- `scorer.goals` — nombre de buts
- `scorer.assists` — nombre de passes décisives (peut être `null` selon l'API)

> **Limite API** : football-data.org ne fournit pas les photos des joueurs sur le plan gratuit. Les avatars/initiales ne sont donc pas utilisés — on affiche seulement le logo de l'équipe à côté du nom.

---

### useTopStandings

**Fichier :** `src/hooks/useTopStandings.js`

Récupère le top 5 de chaque grand championnat **en parallèle**.

```js
const results = await Promise.all(
  LEAGUE_COMPETITIONS.map(id =>
    fetch(`/api/v4/competitions/${id}/standings`, ...)
      .then(res => res.ok ? res.json() : null)
      .then(json => ({
        comp: COMPETITIONS.find(c => c.id === id),
        table: json?.standings?.[0]?.table?.slice(0, 5) ?? []
      }))
  )
)
```

**`Promise.all([...])`** — Lance **toutes les requêtes en même temps** et attend qu'elles soient toutes terminées. C'est beaucoup plus rapide que les faire une par une (contrairement à `useTodayMatches` où on doit les espacer).

`.then()` est l'ancienne syntaxe pour les promises (avant `async/await`). Les deux font la même chose.

---

### useRecentResults

**Fichier :** `src/hooks/useRecentResults.js`

Même logique que `useTopStandings` mais pour les derniers résultats.

```js
.then(json => {
  const matches = json.matches ?? []
  return matches.slice(-3).reverse().map(m => ({
    ...m,
    compId: id    // ← ajoute l'ID de compétition à chaque match
  }))
})
```

**Spread operator `...m`** : copie toutes les propriétés de l'objet `m`, puis on ajoute `compId`. C'est une façon d'**étendre** un objet sans le modifier directement (immutabilité).

---

## 9. Les données statiques

### competitions.js

**Fichier :** `src/data/competitions.js`

Tableau de toutes les compétitions supportées. Chaque compétition a :
- `id` : le code utilisé par l'API football-data.org (`FL1` = Ligue 1, `PL` = Premier League, etc.)
- `name` : le nom affiché à l'utilisateur
- `emblem` : l'image du logo (importée comme module)

```js
import bundesligaLogo from '../assets/leagues/bundesliga.svg'

export const COMPETITIONS = [
  { id: 'FL1', name: 'Ligue 1 McDonald\'s', emblem: ligue1Logo },
  { id: 'PL',  name: 'Premier League',      emblem: premierLeagueLogo },
  { id: 'CL',  name: 'Ligue des champions', emblem: clLogo },
  { id: 'WC',  name: 'Coupe du Monde',      emblem: wcLogo },
  ...
]
```

En important les images avec `import`, Vite les optimise et génère les bons chemins lors du build.

---

### teamNames.js

**Fichier :** `src/data/teamNames.js`

Dictionnaire de traduction : l'API retourne des noms en anglais ou dans la langue d'origine. Ce fichier les traduit en français.

```js
export const TEAM_NAMES_FR = {
  'Bayern': 'Bayern Munich',
  'Barça': 'Barcelone',
  'Man City': 'Man. City',
  ...
}

export const translateTeam = (name) => TEAM_NAMES_FR[name] ?? name
```

`translateTeam` est une simple fonction : si le nom existe dans le dictionnaire, retourne la traduction ; sinon retourne le nom original (grâce à `??`).

---

## 10. Styles globaux et animations

**Fichier :** `src/index.css`

Contient les variables CSS globales, les animations et le système de skeleton loaders.

**Variables CSS (custom properties) :**
```css
:root {
  --red:     #ef4444;
  --bg-deep: #05080d;
  --bg-card: rgba(10,15,24,0.97);
  --text-main: #f1f5f9;
  --text-mid:  #8b9ab0;
  ...
}
```

Les variables CSS permettent de changer une couleur à un seul endroit et de la voir répercutée partout dans l'app.

**Animations globales :**
```css
@keyframes shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
@keyframes fadeUp   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
@keyframes pulseRed { ... }
```

**Classe `.sk` — Skeleton loader :**
```css
.sk {
  background: linear-gradient(90deg,
    rgba(255,255,255,0.05) 25%,
    rgba(255,255,255,0.1)  50%,
    rgba(255,255,255,0.05) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 0.35rem;
}
```

Un skeleton loader est un **placeholder animé** qui remplace le contenu pendant le chargement. Au lieu d'un spinner tournant, on montre la forme approximative du contenu final — meilleure expérience utilisateur.

La classe `.sk` est utilisée partout dans l'app :
- `Classement.jsx` — 10 lignes de tableau + 8 lignes de buteurs pendant le chargement
- `Resultat.jsx` — 6 cards de score
- `Accueil.jsx` — 4 lignes de matchs du jour + 6 cartes d'actualités
- `Match.jsx` — lignes de matchs

---

## 11. Configuration

### vite.config.js — Le proxy API

```js
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'https://api.football-data.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
```

**Pourquoi un proxy ?**

Quand une page web essaie d'appeler une API sur un autre domaine, le navigateur bloque la requête — c'est la politique **CORS** (Cross-Origin Resource Sharing). Pour contourner ça en développement, Vite agit comme un intermédiaire :

- Le navigateur envoie une requête à `/api/v4/competitions/FL1/matches`
- Vite la reçoit, enlève le préfixe `/api`, et la redirige vers `https://api.football-data.org/v4/competitions/FL1/matches`
- Vite reçoit la réponse et la retransmet au navigateur

Résultat : le navigateur ne fait qu'une requête vers `localhost` (aucun problème CORS).

---

### package.json — Les dépendances

```json
"dependencies": {
  "@tanstack/react-query": "^5.101.0",
  "@tanstack/react-query-persist-client": "^5.101.0",
  "@tanstack/query-sync-storage-persister": "^5.101.0",
  "react": "^19.2.7",
  "react-dom": "^19.2.7",
  "react-router-dom": "^7.16.0"
}
```

**`dependencies`** — Packages nécessaires en **production** (dans le navigateur).
**`devDependencies`** — Packages nécessaires uniquement en **développement** (Vite, ESLint...).

Le `^` devant les versions signifie "accepte les mises à jour mineures" (ex: `^5.101.0` accepte `5.102.0` mais pas `6.0.0`).

**Scripts disponibles :**
```json
"scripts": {
  "dev":     "vite",          // Lance le serveur de développement local
  "build":   "vite build",    // Compile l'app pour la production (dossier /dist)
  "lint":    "eslint .",      // Vérifie la qualité du code
  "preview": "vite preview"   // Prévisualise la version de production en local
}
```

---

## Résumé du flux de données

```
Utilisateur clique sur "Ligue 1"
        ↓
setSelectedComp('FL1')  ← useState change
        ↓
useMatches('FL1', 'SCHEDULED') ← hook appelé avec nouvelle valeur
        ↓
useQuery détecte que queryKey a changé → fait le fetch
        ↓
fetch('/api/v4/competitions/FL1/matches?status=SCHEDULED')
        ↓
Proxy Vite redirige vers api.football-data.org
        ↓
Réponse JSON reçue → mise en cache par React Query
        ↓
data disponible → composant re-render avec les nouveaux matchs
```

---

*Documentation générée pour Foot App — React 19 / Vite / React Query v5 / React Router v7*
