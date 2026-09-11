import { Suspense, lazy, useEffect } from 'react'
import './App.css'
import './theme-v2.css'
import Navbar from './components/navbar.jsx'
import Footer from './components/Footer.jsx'
import Accueil from './components/Accueil.jsx'
import { LiveProvider } from './context/LiveProvider.jsx'
import { Routes, Route, useLocation, useNavigationType } from 'react-router-dom'
import { requestNotificationPermission } from './utils/notify'
import { useOnline } from './hooks/useOnline'
import { OfflineBanner } from './components/OfflineBanner'
import { useWeakNetwork } from './hooks/useNetworkQuality'
import { WeakNetworkBanner } from './components/WeakNetworkBanner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SplashScreen } from './components/SplashScreen'

const MatchAVenir = lazy(() => import('./components/Match.jsx'))
const Resultat = lazy(() => import('./components/Resultat.jsx'))
const Classement = lazy(() => import('./components/Classement.jsx'))
const MentionsLegales = lazy(() => import('./components/MentionsLegales.jsx'))
const Live = lazy(() => import('./components/Live.jsx'))
const LiveMatchPage = lazy(() => import('./pages/LiveMatchPage.jsx'))
const MatchPage = lazy(() => import('./pages/MatchPage.jsx'))
const FavoritesPage = lazy(() => import('./pages/FavoritesPage.jsx'))
const Pronos = lazy(() => import('./pages/Pronos.jsx'))
// DebugEspn : route désactivée (audit sécurité — page de diagnostic accessible
// publiquement sans auth). Fichier gardé tel quel dans src/pages/DebugEspn.jsx
// pour la remonter facilement si un bug ESPN similaire réapparaît : il suffit
// de redécommenter cette ligne + le <Route> correspondant ci-dessous.
// const DebugEspn = lazy(() => import('./pages/DebugEspn.jsx'))

// ⚠️ AJOUT (constat utilisateur : "cliquer sur un bouton pour changer de page
// c'est pas fluide") : chaque page est en lazy() — au tout premier clic vers
// une page jamais visitée dans la session, le navigateur doit encore
// télécharger + exécuter son chunk JS avant que Suspense puisse l'afficher,
// ce qui se voit comme un petit à-coup/flash (fallback vide) avant que le
// contenu apparaisse. En précachant tous les chunks en arrière-plan une fois
// l'app au repos (idle), le clic sur n'importe quel onglet devient instantané
// dès la 1ère fois — le module est déjà en mémoire, plus de Suspense visible.
// requestIdleCallback (avec repli setTimeout sur Safari, qui ne le supporte
// pas) : ne vole aucun temps CPU au chargement initial de l'Accueil.
function preloadRoutes() {
  import('./components/Match.jsx')
  import('./components/Resultat.jsx')
  import('./components/Classement.jsx')
  import('./components/Live.jsx')
  import('./pages/LiveMatchPage.jsx')
  import('./pages/MatchPage.jsx')
  import('./pages/FavoritesPage.jsx')
  import('./pages/Pronos.jsx')
  import('./components/MentionsLegales.jsx')
}

// Positions de scroll par entrée d'historique (location.key) — niveau module
// pour survivre aux remounts (voir useNavigationType ci-dessous).
const scrollPositions = new Map()

function App() {
  const location = useLocation()
  const navType  = useNavigationType() // 'PUSH' | 'POP' | 'REPLACE'
  const online   = useOnline()
  // Signal "réseau faible" (voir useNetworkQuality.js) — inutile de l'afficher
  // en plus de OfflineBanner quand on est carrément hors ligne, ce dernier
  // couvre déjà et plus clairement ce cas.
  const weakNetwork = useWeakNetwork()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preloadRoutes, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(preloadRoutes, 2000)
    return () => clearTimeout(t)
  }, [])

  // Mémorise la position de scroll en continu, par entrée d'historique
  // (location.key — unique même pour 2 visites de la même URL), pour pouvoir
  // la restaurer si on revient dessus via "retour arrière". Écoute en continu
  // (pas juste au démontage) : plus fiable, aucune dépendance à l'ordre exact
  // des effets React au moment du changement de route.
  useEffect(() => {
    const onScroll = () => scrollPositions.set(location.key, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [location.key])

  // ⚠️ BUG CORRIGÉ (constat utilisateur : scroller dans "Résultats récents"
  // jusqu'à un résultat vieux de 2 jours, cliquer dessus, puis "retour"
  // ramenait tout en haut de l'Accueil au lieu de laisser le scroll où il
  // était) : ce useEffect forçait TOUJOURS window.scrollTo(0,0) à chaque
  // changement de route, y compris au retour arrière. Utile pour une
  // navigation "en avant" (nouvelle page = démarrer en haut, la raison
  // d'être initiale de cet effet), mais faux pour un retour (l'ancienne page
  // doit reprendre exactement où on l'avait laissée). useNavigationType()
  // distingue les deux : 'POP' = bouton retour (ou navigate(-1)) → restaure
  // la position sauvegardée pour cette page si on en a une ; sinon
  // (PUSH/REPLACE, nouvelle page) → comportement inchangé, on repart en haut.
  useEffect(() => {
    if (navType === 'POP') {
      const saved = scrollPositions.get(location.key)
      if (saved != null) {
        // Double rAF : laisse le temps au contenu (souvent déjà en cache,
        // mais pas garanti) de se poser avant de scroller, sinon la page
        // n'est parfois pas encore assez haute pour atteindre `saved`.
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, saved)))
        return
      }
    }
    window.scrollTo(0, 0)
  }, [location.pathname, location.key, navType])

  // Demander la permission notifications au premier lancement (après 3s pour ne pas surprendre)
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      const t = setTimeout(() => requestNotificationPermission(), 3_000)
      return () => clearTimeout(t)
    }
  }, [])

  // ⚠️ AJOUT (10/09, retour utilisateur : "quand je quitte et reviens
  // d'arrière-plan et que je scroll vers le bas, la barre du bas se
  // détache"). Plusieurs endroits de l'app (Match.jsx, Footer.jsx,
  // GroupModal.jsx, Resultat.jsx, Classement.jsx) verrouillent le scroll
  // d'un modal/dropdown en posant `body.style.position = 'fixed'` +
  // `overflow = 'hidden'` pendant qu'il est ouvert, et le retirent au
  // nettoyage React (fermeture/démontage — un `useEffect` classique).
  // Si l'app est mise en arrière-plan PENDANT que l'un de ces verrous est
  // actif, iOS peut geler l'exécution JS à tout moment sans prévenir : le
  // nettoyage ne s'exécute alors jamais au bon moment, le body reste
  // bloqué en `position: fixed` — ce qui casse l'ancrage au viewport des
  // autres éléments fixes (dont `.sfTabbar`, la barre du bas) au prochain
  // scroll. Même classe de bug que celle déjà documentée dans index.css
  // (overflow-x/swipe), cause différente (overflow-y/background). Filet de
  // sécurité : à chaque retour au premier plan, si le body est resté
  // verrouillé, on le libère de force. Un modal réellement encore ouvert à
  // ce moment perdrait son verrou de scroll (désagrément mineur, rare) —
  // largement préférable à une barre du bas décrochée durablement.
  useEffect(() => {
    const unstickBody = () => {
      if (document.visibilityState !== 'visible') return
      if (document.body.style.position === 'fixed') {
        document.body.style.position = ''
        document.body.style.overflow = ''
        document.body.style.top = ''
        document.body.style.left = ''
        document.body.style.right = ''
      }
    }
    document.addEventListener('visibilitychange', unstickBody)
    window.addEventListener('pageshow', unstickBody)
    return () => {
      document.removeEventListener('visibilitychange', unstickBody)
      window.removeEventListener('pageshow', unstickBody)
    }
  }, [])

  // ⚠️ 4e TENTATIVE (10/09, "nn toujours pas bg .." puis confirmé "iphone pwa
  // et c comme avant les symptome" — DONC symptôme identique confirmé sur un
  // vrai iPhone en PWA après le watchdog ci-dessous, pas juste "pas encore
  // reproduit"). En reprenant le watchdog de la 3e tentative avec cette
  // nouvelle donnée, un vrai trou logique apparaît : le check tournait sur
  // CHAQUE événement `scroll` (via rAF, donc quasiment à chaque frame pendant
  // un geste de scroll), et comparait `rect.bottom` à `window.innerHeight` —
  // or sur iOS Safari, `window.innerHeight` (viewport de LAYOUT) change en
  // continu PENDANT l'animation native de la barre d'adresse qui se
  // masque/affiche au scroll, un comportement 100% normal et déjà géré
  // nativement par WebKit pour les éléments `position:fixed`. Un simple écart
  // transitoire pendant cette animation (mesuré au mauvais frame) suffisait à
  // déclencher la "réparation" — qui elle-même force un reflow synchrone en
  // retirant puis réappliquant `position` sur la barre. Répétée à chaque
  // frame de CHAQUE scroll, cette réparation est probablement devenue la
  // cause du symptôme observé plutôt que son remède : le watchdog lui-même
  // provoquait le flash/décrochage visible qu'il était censé corriger.
  // Autrement dit, la 3e tentative n'a probablement rien réparé de réel — elle
  // a ajouté un déclencheur supplémentaire du même symptôme.
  // Corrigé : plus AUCUNE réparation pendant le scroll (retiré entièrement,
  // c'est la source la plus probable du bruit). Le filet de sécurité ne reste
  // actif que sur les transitions arrière-plan → premier plan
  // (`visibilitychange`/`pageshow`, seul moment où le bug ORIGINAL — perte de
  // couche GPU après mise en arrière-plan — a un sens réel) et un intervalle
  // lent (3s, au lieu d'1s) qui exige DEUX mesures consécutives en dérive
  // avant d'agir (évite qu'une seule mesure prise pile pendant une animation
  // de barre d'adresse déclenche une réparation inutile). Utilise
  // `window.visualViewport` quand disponible : c'est l'API conçue
  // spécifiquement pour refléter le viewport RÉELLEMENT visible sur mobile
  // (indépendant de l'animation de la barre d'adresse ou d'un zoom), plus
  // fiable que `window.innerHeight` pour ce cas précis.
  // ⚠️ RETOUCHÉ (11/09, 7e signalement malgré les 6 tentatives précédentes —
  // portail body, couche GPU dédiée, watchdog géométrique, scroll-lock #root)
  // : nouvelle théorie + vrai bug de logique trouvé dans CE watchdog, pas
  // juste une nouvelle cause devinée au hasard.
  //
  // Théorie : si le décrochage est un désync de PEINTURE (la couche compositée
  // à l'écran reste figée après un cycle arrière-plan→premier plan) plutôt
  // qu'un désync de LAYOUT, `getBoundingClientRect()` continue de renvoyer la
  // position CORRECTE (le calcul de layout n'a jamais été faux) alors que
  // l'écran affiche autre chose — ce qui expliquerait que ce watchdog
  // géométrique n'ait JAMAIS rien détecté d'anormal dans aucune tentative
  // précédente : il mesure une géométrie qui a toujours été juste, le problème
  // est invisible à cette mesure. Voir navbar.css : la couche GPU dédiée
  // (transform/will-change, ajoutée le 10/09) a été retirée en conséquence —
  // c'est précisément le mécanisme qui expose ce type de bug de compositing
  // sur iOS Safari.
  //
  // Bug de logique trouvé (indépendant de la théorie ci-dessus, et solide à
  // 100% celui-là) : `onResume` mettait `driftStreak = 2` puis appelait
  // `check()` — mais `check()` RECALCULE la dérive à cet instant précis et
  // écrase `driftStreak` à 0 si cette mesure est ≤4px, AVANT même de regarder
  // la valeur "2" qu'onResume venait de poser. Résultat : la réparation
  // immédiate au retour au premier plan — tout l'intérêt d'`onResume` — ne se
  // déclenchait en pratique QUE si la dérive était déjà mesurable au moment de
  // l'appel. Dans le scénario "désync de peinture" (layout correct, donc
  // drift mesuré ≈0), ce filet ne réparait jamais rien : du code mort pour
  // exactement le cas qu'il était censé traiter.
  //
  // Corrigé : `onResume` force désormais une réparation INCONDITIONNELLE
  // (reflow forcé, indépendant de toute mesure) à chaque retour au premier
  // plan — le moment à risque identifié depuis la théorie initiale (perte de
  // couche GPU/paint après mise en arrière-plan). Le watchdog périodique (3s,
  // 2 mesures consécutives en dérive) reste actif en complément pour un vrai
  // décrochage de LAYOUT qui surviendrait sans cycle arrière-plan/premier
  // plan (ex. après le scroll-lock #root, voir scrollLock.js).
  useEffect(() => {
    let driftStreak = 0
    const viewportH = () => window.visualViewport?.height ?? window.innerHeight
    const getBar = () => {
      const el = document.querySelector('.sfTabbar')
      if (!el || getComputedStyle(el).display === 'none') return null   // desktop : masquée exprès
      return el
    }
    const repair = el => {
      el.style.position = 'static'
      void el.offsetHeight   // force un reflow + repaint synchrones avant de réappliquer
      el.style.position = ''
    }
    const check = () => {
      if (document.visibilityState !== 'visible') { driftStreak = 0; return }
      const el = getBar()
      if (!el) { driftStreak = 0; return }
      const rect  = el.getBoundingClientRect()
      const drift = Math.abs(rect.bottom - viewportH())
      if (drift > 4) {
        driftStreak += 1
      } else {
        driftStreak = 0
      }
      // 2 mesures consécutives en dérive (≥3s d'écart réel) avant de réparer —
      // une dérive isolée est presque toujours une simple animation de barre
      // d'adresse en cours, pas un vrai décrochage.
      if (driftStreak >= 2) {
        driftStreak = 0
        repair(el)
      }
    }
    const intervalId = setInterval(check, 3000)
    // Réparation INCONDITIONNELLE au retour au premier plan (voir commentaire
    // au-dessus) — ne dépend d'aucune mesure de dérive, cible directement le
    // scénario "désync de peinture" que `check()` seul ne peut pas détecter.
    const onResume = () => {
      driftStreak = 0
      if (document.visibilityState !== 'visible') return
      const el = getBar()
      if (el) repair(el)
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('pageshow', onResume)
    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('pageshow', onResume)
    }
  }, [])

  return (
    // LiveProvider monté ici → hooks live survivent aux changements de route
    // + Web Worker ESPN continue de tourner même si l'utilisateur est sur Classement etc.
    //
    // 2 niveaux d'ErrorBoundary (voir ErrorBoundary.jsx pour le contexte
    // complet) : l'extérieur protège tout le shell (Navbar/Footer compris —
    // filet de dernier recours si l'un d'eux plante) ; celui autour des
    // Routes, KEYÉ par location.pathname, isole une page cassée SANS faire
    // disparaître la navbar — et se réinitialise tout seul dès qu'on change
    // de page (nouvelle clé = nouvelle instance = l'erreur précédente est
    // oubliée), donc pas besoin d'un rechargement complet pour s'en sortir.
    <ErrorBoundary>
      {/* Monté une seule fois (App() ne se démonte pas en naviguant) — voir
          SplashScreen.jsx pour le détail du déclencheur (lancement à froid
          uniquement) et de la durée (variable, liée aux requêtes en cours). */}
      <SplashScreen />
      <LiveProvider>
        <Navbar />
        {!online && <OfflineBanner />}
        {online && weakNetwork && <WeakNetworkBanner />}
        <div key={location.pathname} className="page-transition">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<div className="routeFallback" />}>
              <Routes location={location}>
                <Route path="/" element={<Accueil />} />
                <Route path="/matchs" element={<MatchAVenir />} />
                <Route path="/resultats" element={<Resultat />} />
                <Route path="/classement" element={<Classement />} />
                <Route path="/live" element={<Live />} />
                <Route path="/live/:matchId" element={<LiveMatchPage />} />
                <Route path="/match/:matchId" element={<MatchPage />} />
                <Route path="/favoris" element={<FavoritesPage />} />
                <Route path="/pronos" element={<Pronos />} />
                <Route path="/mentions-legales" element={<MentionsLegales />} />
                {/* <Route path="/debug-espn" element={<DebugEspn />} /> — voir commentaire import ci-dessus */}
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </div>
        <Footer />
      </LiveProvider>
    </ErrorBoundary>
  )
}

export default App
