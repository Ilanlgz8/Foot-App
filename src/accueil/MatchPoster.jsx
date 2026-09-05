import { useState, useEffect }        from 'react'
import { translateTeam }              from '../data/teamNames'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, isNationalTeamComp, isNeutralVenueComp, parseEspnClock, resolveFdTeamId, resolveFdCrest } from '../utils/matchUtils'
import { getMatchState, trackMatchState } from '../utils/matchStateTracker'
import { calcPronoAdvanced, calcLiveProno, pronoToOdds, pronoIntensity, pronoGlowShadow, pronoFavoriteKey } from '../utils/calcProno'
import { useTeamForm }                from '../hooks/useTeamForm'
import { useH2HHistory, useLowerDivisionStats } from '../hooks/useMatchs'
import { useEspnPregameOdds }         from '../hooks/useMatchDetail'
import { useH2HRows }                 from '../components/MatchModal'
import { FormDiamonds }               from './FormDiamonds'
import { COMPETITIONS }               from '../data/competitions'

function formatHour(dateStr) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ⚠️ AJOUT formMap/compMatches en props (24/07, trouvé via l'audit
// chronologique demandé par l'utilisateur) : ce composant est rendu dans un
// .map() par match affiché (voir MatchCard.jsx/MatchPanel) — l'ancien
// `useTeamForm(compCode)` local ici tapait FD.org indépendamment PAR CARTE,
// en plus du useTeamFormMulti déjà calculé et stagger côté Accueil.jsx pour
// TOUTES les compétitions affichées. Si l'Accueil montre plusieurs
// championnats le même jour (fréquent), c'était potentiellement autant de
// requêtes FD.org simultanées que de compétitions différentes visibles,
// sans passer par le stagger de useTeamFormMulti (contournement complet,
// pas juste une redondance réseau). Accueil.jsx calcule déjà cette donnée
// une seule fois pour tous les posters — elle descend maintenant en props.
// Repli sur l'ancien comportement (fetch local) UNIQUEMENT si le composant
// est utilisé ailleurs sans ces props (aucun autre call site connu
// actuellement, mais garde la robustesse du composant si réutilisé).
// ⚠️ RETIRÉ onOddPick (02/09) : prop qui rendait les 3 pilules de cote
// cliquables, ajoutée uniquement pour la page "Mes Paris" — fonctionnalité
// entièrement supprimée de l'app (décision produit : simulation de paris
// hors du périmètre stats/live/notifs, et sujet sensible). Aucun autre
// appelant ne la passait, donc l'affichage des cotes est strictement
// inchangé partout (Accueil, Pronos...).
export function MatchPoster({ match, espnScore = null, onClick, formMap: formMapProp, compMatches: compMatchesProp }) {
  const compCode = match.competition?.code ?? null
  const hasPropsData = formMapProp !== undefined
  // Hook TOUJOURS appelé (Rules of Hooks) — mais désactivé (enabled=false)
  // dès que les données arrivent déjà en props, pour ne jamais déclencher de
  // requête FD.org redondante avec celle déjà faite par l'appelant (voir
  // useTeamFormMulti, Accueil.jsx).
  const fetched = useTeamForm(compCode, 0, !hasPropsData)
  const formMap     = hasPropsData ? formMapProp     : fetched.formMap
  const compMatches = hasPropsData ? (compMatchesProp ?? []) : fetched.compMatches
  // ── H2H utilisé par calcPronoAdvanced (pas juste affiché) ──────────────
  // ⚠️ MIS À JOUR (02/08) : ce composant est en fait rendu UNE FOIS PAR MATCH
  // affiché (voir MatchCard.jsx, `displayed.map(...)`), pas "un seul poster à
  // la fois" comme l'ancien commentaire ici le disait à tort — sur une liste
  // de plusieurs matchs, le verrou d'espacement serveur (SPACING_MS,
  // api/football.js) ne laisse réussir qu'1 appel head2head DÉDIÉ réel toutes
  // les 6s, peu importe combien de cartes le demandent en même temps.
  const h2hHistory = useH2HHistory(compCode, compMatches)
  // ⚠️ RÉORDONNÉ (constat utilisateur, 20/08 : "Historique" toujours absent
  // sur des rivalités connues — Everton-Crystal Palace, Toulouse-Lyon,
  // Sevilla-Bilbao) : h2hHistory n'était utilisé QU'en repli pour la cote de
  // prono (fullH2H), jamais transmis à useH2HRows — le head2head AFFICHÉ,
  // lui, ne voyait donc que compMatches (1 saison, souvent MOINS d'1 saison
  // dès le 1er match FINISHED de la nouvelle saison — voir hasFinished dans
  // fetchClubMatchesRaw, useMatchs.js) même quand h2hHistory avait déjà les 2
  // saisons précédentes en mémoire, gratuitement, juste au-dessus. Fusionné
  // AVANT d'être transmis à useH2HRows : priorité 1 reste le head2head dédié
  // réel (remonte 5-6 saisons quand il réussit) — `{ looseTeamMatch: true }`
  // (constat utilisateur : "quand y'a des rencontres avec h2h disponible les
  // côtes sont toujours par defaut pour certaine equipe") aligne la
  // résolution du match sur le mode déjà stable de MatchPage/LiveMatchPage
  // (un nom ESPN qui est un SUFFIXE du nom FD.org, ex. "Lyon" vs "Olympique
  // Lyonnais", ratait la résolution en mode strict). Priorité 2 (repli quand
  // le head2head dédié échoue/429, ce qui arrive pour la plupart des cartes
  // d'une même liste) : ce pool fusionné (3 saisons au lieu d'1, chargées UNE
  // FOIS par compétition — pas par carte) pour toutes les cartes qui n'ont
  // pas gagné la course du head2head dédié, sans aucun appel FD.org
  // supplémentaire par carte.
  const h2hPool = (compMatches?.length || h2hHistory?.length) ? [...compMatches, ...h2hHistory] : compMatches
  const { rows: dedicatedH2H } = useH2HRows(match, h2hPool, 0, { looseTeamMatch: true })
  const fullH2H = dedicatedH2H.length > 0 ? dedicatedH2H : h2hPool
  // Repli "club promu" (02/08, voir calcProno.js computeLambdasWithPromotion) —
  // fetch best-effort, une seule fois par compétition (jamais par carte), vide
  // silencieusement pour toute comp sans division inférieure connue
  // (LOWER_DIVISION_FD_CODE) ou toute équipe déjà bien pourvue en données
  // saison en cours.
  const lowerDivMatches = useLowerDivisionStats(compCode, compMatches)
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)

  // Fallback initiale si le crest ne charge pas (404, image cassée)
  const [homeCrestError, setHomeCrestError] = useState(false)
  const [awayCrestError, setAwayCrestError] = useState(false)

  const _ms       = getMatchState(match.id)
  const _espnLive = (
    _ms.espnStatus === 'STATUS_IN_PROGRESS' ||
    _ms.espnStatus === 'STATUS_HALFTIME'    ||
    _ms.espnStatus === 'STATUS_END_PERIOD'
  )
  const isFinished = _ms.ft === true || (match.status === 'FINISHED' && !_espnLive)
  // BUG CORRIGÉ (constat utilisateur : "ça affiche pas 'Débute' sur la card,
  // ça affiche que quand le match commence") : isLive ne regardait QUE
  // match.status/_espnLive, jamais calcMinute() — or c'est calcMinute() qui
  // renvoie 'Débute' pendant la fenêtre entre l'heure de coup d'envoi
  // prévue et la confirmation ESPN (~30-60s, voir matchUtils.js). Comme
  // minute n'était calculé QUE si isLive était déjà vrai, ce label ne
  // pouvait jamais s'afficher — la card restait en "Coup d'envoi" (upcoming)
  // jusqu'à ce qu'ESPN confirme, puis sautait direct à "1'"/"2'". Même
  // pattern déjà utilisé et documenté dans MatchCard.jsx (liveMinute calculé
  // d'abord, puis inclus dans la condition isLive).
  const liveMinute  = isFinished ? null : calcMinute(match)
  const isLive     = !isFinished && (
    match.status === 'IN_PLAY' ||
    match.status === 'PAUSED'  ||
    match.status === 'HALFTIME'||
    _espnLive ||
    liveMinute !== null
  )
  const isUpcoming = !isFinished && !isLive

  const fsPoster  = finalScore(match.score)
  const homeScore = mergeScore(espnScore?.home, fsPoster.home)
  const awayScore = mergeScore(espnScore?.away, fsPoster.away)
  const minute    = isLive ? liveMinute : null

  const homeName  = match.homeTeam?.name ?? ''
  const awayName  = match.awayTeam?.name ?? ''
  // ⚠️ BUG CORRIGÉ (constat utilisateur : "le calcul de côte ne regarde pas
  // h2h" — même quand le H2H existe et s'affiche, les côtes restent par
  // défaut) : formMap/compMatches/fullH2H sont indexés par les ids FD.org,
  // mais pour les 6 grands championnats, match.homeTeam.id est un id ESPN
  // (preferEspnForMajors) — espace d'ids différent, sans coïncidence
  // garantie. calcPronoAdvanced(id ESPN, ...) ne retrouve donc JAMAIS la
  // vraie donnée saison/H2H de l'équipe → repli neutre systématique.
  // resolveFdTeamId convertit l'id ESPN vers l'id FD.org équivalent via
  // compMatches déjà chargé — repli sur l'id d'origine si la résolution
  // échoue (aucune régression possible dans ce cas précis).
  // ⚠️ 2e BUG CORRIGÉ (02/08, constat utilisateur : "Barcelone a gagné 8/8
  // dans le H2H affiché mais sa cote de victoire est 2.01, pas cohérent" —
  // vérifié par simulation directe des formules de calcProno.js : un H2H 8/8
  // pris en compte au poids prévu par le code donnerait une cote Barcelone
  // bien plus basse, ~1.3-1.8, jamais 2.01 — donc ce H2H visible n'était PAS
  // reflété dans le calcul réel) : resolveFdTeamId ci-dessous ne cherchait le
  // nom de l'équipe QUE dans compMatches — si cette recherche par nom échouait
  // pour une raison quelconque (silencieuse, sans qu'aucune erreur ne
  // remonte) alors que useH2HRows, LUI, avait réussi à résoudre le fixture et
  // charger un vrai head2head (dedicatedH2H, ce qu'on voit affiché), les ids
  // utilisés pour AFFICHER le H2H et ceux utilisés pour le CALCUL de cote
  // pouvaient diverger — directMeetings (calcProno.js) ne retrouvait alors
  // aucune des 8 confrontations dans fullH2H (comparaison stricte par id) et
  // retombait sur un mix beaucoup plus proche du neutre. dedicatedH2H, quand
  // il est non vide, contient PAR CONSTRUCTION uniquement des matchs entre
  // ces 2 mêmes équipes (c'est un head2head DÉDIÉ, garanti par l'endpoint
  // FD.org lui-même) — l'ajouter au pool de recherche de resolveFdTeamId
  // (même fonction déjà éprouvée, juste plus de données où chercher le nom)
  // donne une 2e chance de résolution cohérente avec le H2H déjà affiché,
  // sans introduire de nouvelle logique de matching.
  const teamIdPool = dedicatedH2H.length > 0 ? [...h2hPool, ...dedicatedH2H] : h2hPool
  // ⚠️ BUG CORRIGÉ (16/08, constat utilisateur : losange "forme récente"
  // d'une AUTRE équipe affiché sous le logo de Racing, match toujours en
  // cours — id ESPN coïncidant par hasard avec l'id FD.org d'un club
  // différent) : `strict:true` + suppression du repli `?? match.xxx.id` —
  // voir le commentaire détaillé sur resolveFdTeamId (matchUtils.js).
  const resolvedHomeId = resolveFdTeamId(match.homeTeam, teamIdPool, { loose: true, strict: true })
  const resolvedAwayId = resolveFdTeamId(match.awayTeam, teamIdPool, { loose: true, strict: true })
  // ⚠️ AJOUT (21/08, constat utilisateur : logos différents entre Accueil et
  // Programme/Résultats) : même principe que MatchCard.jsx — préfère
  // l'écusson FD.org (déjà dans teamIdPool, zéro appel réseau en plus) à
  // celui du match lui-même (ESPN pour ces 6 championnats).
  const homeCrest = resolveFdCrest(match.homeTeam, resolvedHomeId, teamIdPool)
  const awayCrest = resolveFdCrest(match.awayTeam, resolvedAwayId, teamIdPool)
  const hForm     = formMap?.[resolvedHomeId] ?? []
  const aForm     = formMap?.[resolvedAwayId] ?? []
  // BUG CORRIGÉ (constat utilisateur : "le prono ne bougeait pas dans la
  // card en live en fonction du score") : cette barre utilisait TOUJOURS
  // calcPronoAdvanced (le prior pré-match figé), même une fois le match en
  // direct — jamais calcLiveProno, qui est pourtant le modèle prévu pour ça
  // (voir LiveMatchPage/LiveStatsTab). Résultat : les % restaient identiques
  // du coup d'envoi à la fin du match quel que soit le score réel. En live,
  // on utilise maintenant calcLiveProno (score + minute + cartons rouges/
  // possession/tirs cadrés, déjà dans espnScore?.stats — aucun fetch de
  // plus) ; pré-match et FT gardent calcPronoAdvanced (rien à faire glisser
  // avant le coup d'envoi, résultat déjà figé une fois le match terminé).
  // ── Cote de marché réelle (toutes compétitions ESPN) ────────────────────
  // Remplace l'affichage calcProno par la vraie cote (ESPN BET/DraftKings
  // selon la compétition) quand disponible et fiable — voir useEspnPregameOdds
  // pour le détail des providers retenus/écartés et le garde-fou anti-cote-
  // absurde. `prono` (calculé plus bas) reste la source pour tout le reste
  // (Pronos.jsx, jeu entre amis, jamais touché ici).
  // ⚠️ AJOUT (constat utilisateur, Lens-PSG : PSG favori à la vraie cote
  // bookmaker, mais dès le coup d'envoi le direct affichait Lens favori) :
  // enabled élargi de `isUpcoming` à `!isFinished` — la requête reste active
  // en live (nécessaire pour l'avoir dispo si l'app est ouverte APRÈS le
  // coup d'envoi, jamais pré-match) et est réinjectée dans calcLiveProno
  // ci-dessous (marketPre) comme point de départ réel, au lieu du prior
  // interne (calcPronoAdvanced) qui peut diverger du marché sur la base
  // "forme récente" seule — surtout en tout début de saison, quand peu de
  // matchs de la saison en cours existent encore pour affiner le modèle.
  const { data: espnOdds } = useEspnPregameOdds(match, !isFinished)

  const prono = isLive
    ? calcLiveProno(hForm, aForm, homeScore, awayScore, minute, {
        homeId: resolvedHomeId, awayId: resolvedAwayId, compMatches,
        fullH2H, lowerDivMatches,
        neutralVenue:      isNeutralVenueComp(match),
        homeRedCards:      espnScore?.stats?.home?.redCards,
        awayRedCards:      espnScore?.stats?.away?.redCards,
        homePoss:          espnScore?.stats?.home?.poss,
        awayPoss:          espnScore?.stats?.away?.poss,
        homeShotsOnTarget: espnScore?.stats?.home?.shotsOnTarget,
        awayShotsOnTarget: espnScore?.stats?.away?.shotsOnTarget,
        homeCorners:       espnScore?.stats?.home?.corners,
        awayCorners:       espnScore?.stats?.away?.corners,
        marketPre:         espnOdds?.pct ?? null,
      })
    : calcPronoAdvanced(resolvedHomeId, resolvedAwayId, compMatches, hForm, aForm, {
        fullH2H, lowerDivMatches,
        neutralVenue: isNeutralVenueComp(match),
      })

  const useMarketOdds = isUpcoming && !!espnOdds
  const displayPct    = useMarketOdds ? espnOdds.pct : prono
  // Pilule favorite (% le plus haut) — seule à recevoir le liseré/glow
  // bordeaux, voir footer plus bas (pronoFavoriteKey, calcProno.js).
  const pronoFavorite = pronoFavoriteKey(displayPct)
  // Cotes affichées — calculées une seule fois ici plutôt qu'avec le même
  // ternaire répété 3x dans le footer.
  const homeOdd = useMarketOdds ? espnOdds.decimal.home : pronoToOdds(prono.home)
  const drawOdd = useMarketOdds ? espnOdds.decimal.draw : pronoToOdds(prono.draw)
  const awayOdd = useMarketOdds ? espnOdds.decimal.away : pronoToOdds(prono.away)

  // ⚠️ REMPLACÉ (05/09, demande explicite utilisateur : "les cards accueil
  // sur mobile pareil que livematchpage, les couleurs du championnat au lieu
  // des équipes"). Le fond n'est plus le dégradé des couleurs des 2 équipes
  // (calculé via getMatchTeamColors/buildMatchGradient — retiré) mais la
  // teinte du championnat (`tint`, competitions.js), posée comme variable CSS
  // `--poster-comp` — même mécanisme et même recette de dégradé (color-mix,
  // 3 paliers 85/68/48%) que `.lmp__hero` sur LiveMatchPage/MatchPage/
  // Résultat (voir accueil.css `.poster__bg--gradient`), pour un rendu
  // identique. `posterComp` (nom + logo du championnat) était déjà calculé
  // plus bas dans ce fichier — remonté ici pour être réutilisé aux deux
  // endroits sans dupliquer la recherche dans COMPETITIONS.
  const posterComp = COMPETITIONS.find(c => c.id === match.competition?.code)
  const compTint    = posterComp?.tint ?? null
  // ⚠️ AJOUTÉS (05/09, même jour, demande explicite : "animer les couleurs...
  // en embellissant la couleur", Bundesliga/LaLiga en plusieurs couleurs) —
  // voir LiveMatchPage.jsx pour le même mécanisme (`--lmp-comp2/3`). Ici
  // alimentent `--poster-comp2/3`, lues par .poster__bg--gradientAlt/Tri
  // (accueil.css).
  const compTint2   = posterComp?.tint2 ?? null
  const compTint3   = posterComp?.tint3 ?? null

  const homeShort = translateTeam(match.homeTeam?.shortName || homeName)
  const awayShort = translateTeam(match.awayTeam?.shortName || awayName)

  // Retour utilisateur : quand une équipe a peu de chances (petit %), le
  // libellé complet ("Paris Saint-Germain 5%") était coupé par "…" et le
  // pourcentage disparaissait — le libellé était contraint à la même largeur
  // que le segment de barre (parfois 5% du poster, ~15px). Initiales à 3
  // lettres — BUG CORRIGÉ (retour utilisateur : "les noms d'équipe à 3
  // lettres en français") : priorité inversée. `homeShort`/`awayShort` sont
  // déjà passés par translateTeam() (voir plus haut) donc en français ;
  // l'ancien code priorisait `tla` (code FD.org brut, souvent la version
  // anglaise/internationale du nom, ex. "ENG" au lieu de "ANG" pour
  // l'Angleterre) — jamais traduit. `tla` ne sert plus qu'en dernier
  // recours si `homeShort`/`awayShort` sont vides.
  const homeCode = (homeShort || match.homeTeam?.tla || '').slice(0, 3).toUpperCase()
  const awayCode = (awayShort || match.awayTeam?.tla || '').slice(0, 3).toUpperCase()

  const cls = 'poster'
    + (isLive ? ' poster--live' : isFinished ? ' poster--ft' : '')
    + (compTint ? ' poster--tinted' : '')
    + (compTint3 ? ' poster--triColor' : '')

  // ── Bandeau compétition (gauche, logo + nom FR) + statut période (droite) ──
  // Même contenu/logique que le hero de LiveMatchPage et que la version
  // desktop (accueil/MatchCard.jsx) — demande explicite : cette version
  // mobile (posters) doit avoir le même traitement. comp?.name (COMPETITIONS,
  // déjà traduit en français) est prioritaire sur match.competition?.name
  // (football-data.org, toujours en anglais) — voir le fix équivalent dans
  // MatchCard.jsx/LiveMatchPage.jsx/MatchPage.jsx.
  // (posterComp lui-même est calculé plus haut, voir compTint.)
  const posterCompEmblem = posterComp?.emblem ?? match.competition?.emblem
  const posterCompName   = posterComp?.name ?? match.competition?.name ?? ''
  const rawPosterPeriod = getMatchPeriod(match)
  // "Mi-temps" → "MT" ici uniquement (retour utilisateur, spécifique à ce
  // badge en haut à droite de la card Accueil — getMatchPeriod() lui-même
  // n'est pas touché, MatchCard.jsx/LiveMatchPage.jsx gardent leur libellé
  // complet).
  const posterPeriodLabel = rawPosterPeriod === '1ère MT'       ? '1ère mi-temps'
    : rawPosterPeriod === '2ème MT'       ? '2ème mi-temps'
    : rawPosterPeriod === 'Mi-temps'      ? 'MT'
    : rawPosterPeriod === 'Prolongations' ? 'Prolongations'
    : rawPosterPeriod === 'T.A.B.'        ? 'T.A.B.'
    : null

  // Countdown mi-temps : "Reprise dans 15 min" → ... → "Reprise imminente"
  // — remis en place (retour utilisateur), même logique déjà éprouvée que
  // MatchCard.jsx (indépendante du calcul de la minute elle-même : basée
  // sur matchStateTracker/pausedAt-half2Start, jamais sur liveMinute en
  // écriture — ne perturbe donc jamais l'affichage de la minute réelle du
  // match une fois la 2ème mi-temps commencée, calcMinute() reprend le
  // relais tout seul).
  const [htLabel, setHtLabel] = useState(null)
  useEffect(() => {
    if (liveMinute !== 'MT') { setHtLabel(null); return }
    const compute = () => {
      let state = getMatchState(match.id)
      // Filet de sécurité (constat utilisateur : "c'était déjà la mi-temps
      // quand t'as fait les modifs, y'a pas 'reprise dans 15min'") : si
      // aucun autre hook (useLiveMatches.js/useLiveMinute.js) n'a encore posé
      // pausedAt pour ce match — fenêtre entre un déploiement et le prochain
      // poll live, ou app ouverte directement en pleine mi-temps sans avoir
      // witnessed la transition IN_PLAY→PAUSED — on le pose nous-mêmes ici
      // plutôt que de rester bloqué indéfiniment sur le texte statique.
      // ⚠️ Ne PAS utiliser Date.now() comme instant de pause : si la mi-temps
      // a déjà commencé depuis 10min quand l'app s'ouvre, ça ferait repartir
      // le countdown à 15min au lieu d'afficher les 5min restantes (constat
      // utilisateur). Même estimation que useLiveMinute.js : ESPN GÈLE son
      // horloge (espnClock) sur la minute réelle atteinte au coup de sifflet
      // et la garde identique tant que dure la pause — déjà en localStorage
      // ici, posée par le watchdog global (LiveProvider) qui tourne sur
      // toutes les pages, donc dispo même si on n'a jamais vu la transition
      // nous-mêmes. pausedAt = kickoff + cette vraie durée jouée.
      if (!state.pausedAt && !state.half2Start) {
        const koReference  = state.kickoffAt ?? new Date(match.utcDate).getTime()
        // ⚠️ `base + extra` et non `base` seul (05/09) : parseEspnClock rend
        // "45'+3'" comme { base: 45, extra: 3 }. En ne gardant que la base, la
        // pause était estimée 3 minutes trop tôt — et comme la 2ème mi-temps
        // se déduit ensuite de `pausedAt + 15 min`, tout le temps additionnel
        // de la 1ère période se retrouvait ajouté à la minute affichée à la
        // reprise. C'est la seconde moitié du "ça a repris à la 50' au lieu
        // de la 46'" (l'autre étant canAnchorHalf2, voir matchUtils.js).
        const parsedClock  = parseEspnClock(state.espnClock)
        const realHalfMins = parsedClock ? parsedClock.base + (parsedClock.extra ?? 0) : null
        const halfMins     = (realHalfMins != null && realHalfMins > 0) ? realHalfMins : 47
        const estimatedPausedAt = Math.min(Date.now(), koReference + halfMins * 60_000)
        trackMatchState({ ...match, status: 'PAUSED' }, estimatedPausedAt)
        state = getMatchState(match.id)
      }
      // Arrêter le décompte si la 2ème MT a démarré
      if (!state.pausedAt || state.half2Start) { setHtLabel(null); return }
      const elapsed = Date.now() - state.pausedAt
      const remMin  = Math.max(0, Math.ceil((15 * 60_000 - elapsed) / 60_000))
      setHtLabel(remMin > 0 ? `Reprise dans ${remMin} min` : 'Reprise imminente')
    }
    compute()
    // Mise à jour chaque minute (le décompte est en minutes)
    const id = setInterval(compute, 60_000)
    return () => clearInterval(id)
    // match.id (stable, jamais réassigné) sert de proxy volontaire pour tout le
    // reste de `match` utilisé dans compute() (match.utcDate = coup d'envoi prévu,
    // fixe pour un match donné). Dépendre de `match` en entier redéclencherait cet
    // effet — et recréerait le setInterval — à chaque poll live (nouvel objet à
    // chaque update de score), sans que le countdown mi-temps n'en ait besoin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMinute, match.id])

  return (
    <div
      className="poster__frame"
      style={compTint ? {
        '--poster-comp': compTint,
        ...(compTint2 ? { '--poster-comp2': compTint2 } : {}),
        ...(compTint3 ? { '--poster-comp3': compTint3 } : {}),
      } : undefined}
    >
    <div className={cls} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>

      {/* ── Fond : teinte du championnat, calques ANIMÉS ──
          Même recette que le fond de LiveMatchPage/MatchPage/Résultat
          (`.lmp__hero`, LiveMatchPage.css) : la couleur (`--poster-comp`) est
          posée une seule fois ci-dessus, tout le dégradé (color-mix) vit dans
          accueil.css, pas ici.
          ⚠️ RÉANIMÉ EN COULEUR (05/09, demande explicite : "faudrait animer
          les couleurs... comme avant dans les cards de accueil avec les
          couleurs des équipes... mais avec les couleurs du championnat, en
          embellissant la couleur") — gradientAlt ne fait plus un crossfade
          inutile vers la MÊME couleur (comme juste après le passage aux
          teintes championnat) : il porte maintenant `--poster-comp2` (2e
          couleur, éclaircie auto par défaut, dédiée pour Bundesliga/LaLiga) et
          son opacité respire réellement. gradientTri (3e couche, LaLiga
          uniquement) fait de même avec `--poster-comp3`. Seules `transform`/
          `opacity` sont animées (GPU, aucun repaint) — même contrainte que le
          reste de l'app pour ce type de fond animé. */}
      <div className="poster__bg poster__bg--gradient" />
      <div className="poster__bg poster__bg--gradientAlt" />
      <div className="poster__bg poster__bg--gradientTri" />
      <div className="poster__overlay" />

      {/* ── Badge compét (gauche, logo + nom FR) + statut période en live (droite) ── */}
      <div className="poster__topbar">
        <span className="poster__topbarComp">
          {/* ⚠️ Le point rouge pulsant a QUITTÉ cet emplacement (04/09, demande
              utilisateur) : accolé au nom du championnat il désignait la
              compétition, ce qui n'a pas de sens — c'est le signal "ça bouge
              en ce moment", il appartient au chrono. Déplacé sur la minute de
              jeu, plus bas, exactement comme sur l'affiche "Match du jour". */}
          {posterCompEmblem && <img src={posterCompEmblem} alt="" className="poster__topbarCompLogo" />}
          <span className="poster__comp-name">{posterCompName}</span>
        </span>
        {isLive && posterPeriodLabel && (
          <span className="poster__topbarPeriod">{posterPeriodLabel}</span>
        )}
      </div>

      {/* ── Bloc central : [crest+nom] | [label+temps] | [crest+nom] ── */}
      <div className="poster__middle">

        <div className="poster__team-col poster__team-col--home">
          {/* BUG CORRIGÉ : crest+nom étaient 2 enfants SÉPARÉS de team-col
              (align-items:flex-start/flex-end pour plaquer le nom au bord
              extérieur). Le crest (largeur fixe 44px) suivait donc le MÊME
              bord que le nom, mais un nom plus large que 44px décale son
              propre centre visuel vers la droite (home) — un correctif
              précédent centrait le crest sur toute la colonne (68px), ce qui
              ne matche que pour un nom qui occupe presque toute cette
              largeur (ex. "Angleterre") : pour un nom court ("Maroc",
              "France"…) le nom reste collé au bord tandis que le crest se
              retrouve centré plus loin — toujours pas aligné. Fix définitif :
              crest+nom+losanges sont maintenant TOUS les 3 enfants de
              .poster__nameGroup (largeur "shrink-to-fit", align-items:center
              — voir CSS), donc centrés les uns par rapport aux autres quelle
              que soit la longueur du nom, tandis que le groupe entier reste
              plaqué au bord extérieur via l'align-items hérité de team-col. */}
          <div className="poster__nameGroup">
            {homeCrest && !homeCrestError
              ? <div className="poster__crestWrap" data-crest={isWC ? 'country' : 'club'}><img className="poster__crest" src={homeCrest} alt="" data-team={homeName}
                  onError={() => setHomeCrestError(true)} /></div>
              : <div className="poster__crest-empty">{homeShort?.[0] ?? ''}</div>
            }
            <span className="poster__name poster__name--home">{homeShort}</span>
            <FormDiamonds form={hForm} />
          </div>
        </div>

        <div className="poster__center">
          {isLive && minute && (
            minute === 'MT' ? (
              // Retour utilisateur : reproduire EXACTEMENT le style
              // LiveMatchPage pour la mi-temps — "MT" en évidence (même
              // classe que le badge minute normal, voir .lmp__heroMinute) et
              // le countdown "Reprise dans X min" / "Reprise imminente" EN
              // DESSOUS (pas à la place), en jaune/or (.lmp__heroReprise),
              // au lieu de remplacer "MT" par le countdown comme avant.
              // htLabel repasse à null tout seul dès que la 2ème MT démarre
              // (half2Start), minute reprend alors le relais normalement.
              <div className="poster__min-labelCol">
                <div className="poster__min-label">
                  <span className="poster__live-dot" />MT
                  <span className="poster__live-dot poster__live-dot--ghost" aria-hidden="true" />
                </div>
                <div className="poster__reprise-label">{htLabel ?? 'Mi-temps'}</div>
              </div>
            ) : (
              // calcMinute() renvoie déjà des libellés complets pour les états
              // spéciaux (Pause/TAB/Débute/Prolongation) et inclut déjà
              // l'apostrophe pour les minutes chiffrées ("91'") — ne jamais
              // en rajouter une.
              // Le point rouge est doublé d'une copie INVISIBLE à droite
              // (04/09, constat utilisateur : "c'est pas exactement
              // centralisé"). Le conteneur est bien centré, mais il contient
              // "point + texte" : c'est donc ce GROUPE qui est centré, et le
              // texte seul se retrouve poussé vers la droite de la largeur du
              // point. La copie invisible rétablit la symétrie, si bien que le
              // texte de la minute tombe pile au-dessus du score. Même
              // solution que .lmp__heroLiveDot--ghost sur la page du direct,
              // où le problème s'était déjà posé.
              <div className="poster__min-label">
                <span className="poster__live-dot" />{minute}
                <span className="poster__live-dot poster__live-dot--ghost" aria-hidden="true" />
              </div>
            )
          )}
          {isUpcoming && <div className="poster__env-label">Coup d&apos;envoi</div>}
          {isFinished  && <div className="poster__env-label">Terminé</div>}
          {(isLive || isFinished)
            ? <div className="poster__score">{homeScore ?? 0} – {awayScore ?? 0}</div>
            : <div className="poster__time">{formatHour(match.utcDate)}</div>
          }
        </div>

        <div className="poster__team-col poster__team-col--away">
          <div className="poster__nameGroup">
            {awayCrest && !awayCrestError
              ? <div className="poster__crestWrap" data-crest={isWC ? 'country' : 'club'}><img className="poster__crest" src={awayCrest} alt="" data-team={awayName}
                  onError={() => setAwayCrestError(true)} /></div>
              : <div className="poster__crest-empty">{awayShort?.[0] ?? ''}</div>
            }
            <span className="poster__name poster__name--away">{awayShort}</span>
            <FormDiamonds form={aForm} />
          </div>
        </div>

      </div>

      {/* ── Pronostic — pilules "côtes bookmaker", même design que
          LiveProno (MatchModal.jsx/LiveMatchPage) : fond blanc, cote
          décimale (pronoToOdds). Liseré + glow bordeaux PERMANENT
          (pronoIntensity/pronoGlowShadow) réservé à la pilule FAVORITE
          (pronoFavorite) — les 2 autres restent neutres. ── */}
      <div className="poster__footer">
        <div className="poster__prono-row">
          <div
            className="poster__prono-pill"
            style={pronoFavorite === 'home' ? { borderColor: `rgba(159,30,52,${pronoIntensity(displayPct.home)})`, boxShadow: pronoGlowShadow(displayPct.home) } : { borderColor: 'transparent' }}
          >
            <span className="poster__prono-pillLabel">{homeCode}</span>
            <span className="poster__prono-pillVal">{homeOdd.toFixed(2)}</span>
          </div>
          <div
            className="poster__prono-pill"
            style={pronoFavorite === 'draw' ? { borderColor: `rgba(159,30,52,${pronoIntensity(displayPct.draw)})`, boxShadow: pronoGlowShadow(displayPct.draw) } : { borderColor: 'transparent' }}
          >
            <span className="poster__prono-pillLabel">Nul</span>
            <span className="poster__prono-pillVal">{drawOdd.toFixed(2)}</span>
          </div>
          <div
            className="poster__prono-pill"
            style={pronoFavorite === 'away' ? { borderColor: `rgba(159,30,52,${pronoIntensity(displayPct.away)})`, boxShadow: pronoGlowShadow(displayPct.away) } : { borderColor: 'transparent' }}
          >
            <span className="poster__prono-pillLabel">{awayCode}</span>
            <span className="poster__prono-pillVal">{awayOdd.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
