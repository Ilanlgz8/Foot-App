/**
 * LiveMatchPage — page dédiée à un match en direct
 * Route : /live/:matchId
 *
 * Style : même visuel que MatchPage (hero gradient plein-écran + onglets)
 * Contenu live préservé : minute, score temps réel, buteurs, xG, stats live
 */
import { useParams, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { useLiveData }      from '../context/LiveProvider'
import { getMatchState, TERMINE_GRACE_MS, trackMatchState } from '../utils/matchStateTracker'
import { calcMinute, getMatchPeriod, mergeScore, finalScore, isNationalTeamComp, resolveFdTeamId, resolveFdCrest, parseEspnClock, buildHeroSubline } from '../utils/matchUtils'
import { COMPETITIONS }     from '../data/competitions'
import { translateTeam }    from '../data/teamNames'
import { TEAM_SHORT }       from '../data/teamShortNames'
import { getMatchThemeVars } from '../data/teamPhotos'
import { useTeamForm }      from '../hooks/useTeamForm'
import { useEspnMatchStats } from '../hooks/useMatchDetail'
import { useMatches, useLowerDivisionStats, useH2HHistory } from '../hooks/useMatchs'
import { useSwipe }         from '../hooks/useSwipe'
import { FormDiamonds }     from '../accueil/FormDiamonds'
import { WatchBadge }       from '../components/WatchBadge'
import { LiveSidebar }      from '../components/LiveSidebar'
import {
  LiveStatsTab,
  SeasonStatsTab,
  StatsSubTabs,
  ComposTab,
  ClassementTab,
  TabDots,
  useH2HRows,
  H2HTabContent,
  buildMatchEvents,
} from '../components/MatchModal'
import './LiveMatchPage.css'
import './MatchPage.css'
import '../live.css'
import '../matchModal.css'

// ── Raccourcis noms ───────────────────────────────────────────────────────────
// 5 pastilles par équipe pendant la séance de tab : gris = pas encore marqué,
// vert = but marqué. Basé sur le compteur ESPN `shootoutScore` (fiable, déjà
// utilisé pour le score "(x-y tab)") : les N premières pastilles passent au
// vert où N = nombre de buts marqués. Simplification assumée : un tir raté
// n'est pas distingué d'un tir pas encore tenté (les deux ne comptent pas dans
// le compteur) — distinguer précisément un raté demanderait de parser le détail
// tir-par-tir d'ESPN, jamais vérifié sur un vrai match en tab, donc pas fait.
function ShootoutDots({ scored }) {
  const n = scored ?? 0
  return (
    <div className="lmp__soDots">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`lmp__soDot${i < n ? ' lmp__soDot--scored' : ''}`} />
      ))}
    </div>
  )
}

function shortenName(name) {
  if (!name) return name
  if (TEAM_SHORT[name]) return TEAM_SHORT[name]
  if (name.length <= 13) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return `${words[0][0].toUpperCase()}. ${words.slice(1).join(' ')}`
}

// Skeleton pleine page — remplace le spinner générique affiché avant que le
// match soit reçu du LiveProvider. Même logique que MpPageSkeleton dans
// MatchPage.jsx (dupliqué ici, pas de composant partagé, cf. le pattern déjà
// utilisé pour les helpers stats "mêmes que MatchModal, dupliqués").
function LmpPageSkeleton() {
  return (
    <div className="mp__page">
      <div className="mp__hero lmp__hero">
        <div className="mp__hero__top">
          <div className="sk" style={{ width: '3.2rem', height: '0.85rem' }} />
          <div className="sk" style={{ width: '5rem', height: '0.7rem' }} />
        </div>
        <div className="mp__hero__mid">
          <div className="mp__hero__team">
            <div className="sk" style={{ width: '3.4rem', height: '3.4rem', borderRadius: '50%' }} />
            <div className="sk" style={{ width: '3.4rem', height: '0.75rem' }} />
          </div>
          <div className="mp__hero__center">
            <div className="sk" style={{ width: '3rem', height: '0.6rem' }} />
            <div className="sk" style={{ width: '4.5rem', height: '1.8rem', marginTop: '0.3rem' }} />
          </div>
          <div className="mp__hero__team mp__hero__team--away">
            <div className="sk" style={{ width: '3.4rem', height: '3.4rem', borderRadius: '50%' }} />
            <div className="sk" style={{ width: '3.4rem', height: '0.75rem' }} />
          </div>
        </div>
      </div>
      <div className="mp__wrap">
        <div className="mp__tabs">
          {[0, 1, 2].map(i => (
            <div key={i} style={{ flex: 1, padding: '0.75rem 0', display: 'flex', justifyContent: 'center' }}>
              <div className="sk" style={{ width: '4rem', height: '0.8rem' }} />
            </div>
          ))}
        </div>
        <div className="mp__tabContent">
          <div className="mp__statsList">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="mp__statRow">
                <div className="sk" style={{ width: '1.6rem', height: '0.9rem', marginLeft: 'auto' }} />
                <div className="sk" style={{ width: '4.4rem', height: '0.6rem' }} />
                <div className="sk" style={{ width: '1.6rem', height: '0.9rem' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Hero live (style MatchPage + éléments live) ───────────────────────────────
function MatchHeader({ match, espn, onBack, hForm, aForm, homeCrest, awayCrest }) {
  const matchSt   = getMatchState(match.id)
  const isTermine = matchSt.ft === true

  // Ticker 5s pour interpolation de minute en temps réel
  const [, setTick] = useState(0)
  useEffect(() => {
    if (isTermine) return
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [isTermine])

  const minute  = isTermine ? null : calcMinute(match)
  const period  = getMatchPeriod(match)
  const comp    = COMPETITIONS.find(c => c.id === match.competition?.code)
  const emblem  = comp?.emblem ?? match.competition?.emblem
  // ⚠️ BUG CORRIGÉ (nom de compétition pas en français) : match.competition?.name
  // vient de football-data.org (toujours en anglais) — comp?.name (COMPETITIONS,
  // data/competitions.js) contient déjà la traduction française et doit être
  // prioritaire, comme partout ailleurs dans l'app (convention "Noms français
  // partout dans l'UI", voir CLAUDE.md ; même ordre que ResultHeroCard.jsx/Pronos.jsx).
  const compName = comp?.name ?? match.competition?.name ?? ''
  // "Journée N · date" sous le nom du championnat — voir buildHeroSubline.
  const heroSubline = buildHeroSubline(match)

  const isHalftime = match.status === 'PAUSED' || matchSt.espnStatus === 'STATUS_HALFTIME'
  // Une seule valeur, utilisée de façon cohérente pour tout ce render (même
  // pattern que Live.jsx/MatchCard.jsx) — recalculée au prochain re-render live.
  // ⚠️ SUPPRIMÉ (04/09, demande utilisateur : "enlève le 'reprise dans x
  // minutes', juste dans livematchpage") : le compte à rebours de mi-temps
  // (pauseElapsed / repriseImminente / repriseDans) n'était lu QUE par le
  // bloc .lmp__heroReprise de cette page — retirer l'affichage rendait donc
  // ces trois calculs morts, ils partent avec.
  // ⚠️ Uniquement ICI : l'affiche "Match du jour" et les cards de l'Accueil
  // (MatchPoster.jsx, .poster__reprise-label) gardent ce compte à rebours,
  // demande explicitement limitée à cette page.

  // ⚠️ FILET DE SÉCURITÉ (bug signalé : "reprise dans Xmin" jamais affiché,
  // juste "Mi-temps" statique, ET la minute affichée ensuite en 2e MT décalée
  // de +15min ou plus) — même fix déjà en place sur MatchCard.jsx/
  // MatchPoster.jsx (16/08) mais oublié ici. Root cause : pausedAt n'est posé
  // par useLiveMinute.js QUE s'il détecte la transition IN_PLAY→PAUSED en
  // temps réel (app ouverte à ce moment précis) ; MatchCard.jsx/MatchPoster.jsx
  // le posent aussi eux-mêmes en filet de sécurité dès qu'ils witnessent 'MT',
  // mais cette page (LiveMatchPage) ne le faisait pas — un appareil resté
  // exclusivement sur CETTE page pendant toute la mi-temps (jamais passé par
  // Accueil) ne voyait donc jamais pausedAt posé nulle part. Conséquence en
  // cascade : les 2 détections qui posent half2Start (useLiveMinute.js,
  // "2H détecté" + "ancrage précoce") exigent TOUTES LES DEUX pausedAt déjà
  // présent — sans lui, jamais posé non plus, et calcMinute() retombe sur les
  // heuristiques kickoffAt/utcDate (moins précises que l'horloge ESPN réelle)
  // plus longtemps que prévu une fois la 2e MT reprise, d'où le décalage.
  // Même estimation qu'ailleurs : ESPN GÈLE son horloge sur la minute réelle
  // atteinte au coup de sifflet — jamais Date.now() (ferait repartir le
  // countdown à 15min au lieu du temps de pause déjà écoulé).
  useEffect(() => {
    if (!isHalftime) return
    const state = getMatchState(match.id)
    if (state.pausedAt || state.half2Start) return
    const koReference   = state.kickoffAt ?? new Date(match.utcDate).getTime()
    const realHalfMins  = parseEspnClock(state.espnClock)?.base
    const halfMins      = (realHalfMins != null && realHalfMins > 0) ? realHalfMins : 47
    const estimatedPausedAt = Math.min(Date.now(), koReference + halfMins * 60_000)
    trackMatchState({ ...match, status: 'PAUSED' }, estimatedPausedAt)
    // match.id sert de proxy stable pour match.utcDate (fixe pour un match
    // donné) — même pattern que MatchCard.jsx/MatchPoster.jsx, voir leur
    // commentaire détaillé : dépendre de `match` en entier redéclencherait
    // cet effet à chaque poll live (nouvel objet à chaque update de score).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHalftime, match.id])

  const fsLive = finalScore(match.score)
  const hs  = mergeScore(espn?.home, fsLive.home ?? match.score?.halfTime?.home)
  const as_ = mergeScore(espn?.away, fsLive.away ?? match.score?.halfTime?.away)

  const homeName = shortenName(translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?'))
  const awayName = shortenName(translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?'))

  const h = hs ?? '–', a = as_ ?? '–'

  // Label minute (badge rouge au-dessus du score)
  // ⚠️ getMatchPeriod() renvoie 'Mi-temps'/'Prolongations'/'T.A.B.'/'2ème MT'/
  // '1ère MT'/null (pas 'HT'/'ET1'/'ET2'/'PEN'/'FT') — ces comparaisons ne
  // matchaient donc jamais, et calcMinute() inclut déjà l'apostrophe pour les
  // minutes chiffrées ("91'") + des libellés complets pour MT/Pause/TAB/Débute,
  // donc ${minute}' ajoutait une 2e apostrophe en trop dans tous les cas.
  const minuteLabel = isTermine ? 'Terminé' : (minute ?? '–')

  // Badge période (MI-TEMPS, PROLONGATIONS, T.A.B., 1ère/2ème MT…)
  // ⚠️ Avant, '1ère MT'/'2ème MT' (retournés par getMatchPeriod pendant le
  // temps réglementaire) ne matchaient aucune branche → pas de badge du tout
  // pendant la 1ère/2ème mi-temps, seulement pour Mi-temps/Prolongations/T.A.B.
  // (demande explicite : ajouter le même style de badge pour ces 2 cas).
  const periodBadge = period === 'Mi-temps'      ? 'MI-TEMPS'
    : period === 'Prolongations' ? 'PROLONGATIONS'
    : period === 'T.A.B.'        ? 'T.A.B.'
    : period === '1ère MT'       ? '1ÈRE MI-TEMPS'
    : period === '2ème MT'       ? '2ÈME MI-TEMPS'
    : null

  // Score des tab en direct (mêmes champs que MatchModal.jsx)
  const homeShootout = espn?.homeShootout ?? null
  const awayShootout = espn?.awayShootout ?? null
  const showLivePens = period === 'T.A.B.' && (homeShootout != null || awayShootout != null)

  // Score localStorage (partagé avec Live.jsx)
  const scoreKey = `foot_lv_score_${match.id}`
  const prevHs   = useRef(null)
  const prevAs   = useRef(null)
  // Initialisation one-shot depuis localStorage — useLayoutEffect (pas une
  // mutation de ref pendant le render) : s'exécute avant peinture écran (donc
  // aucun flash) et toujours avant le useEffect de détection juste en dessous
  // (les useLayoutEffect passent systématiquement avant les useEffect classiques,
  // quel que soit l'ordre dans le fichier) — comportement identique, mais sûr
  // sous StrictMode/React Compiler (pas de mutation pendant la phase de render).
  useLayoutEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(scoreKey) || 'null')
      if (s?.home != null) prevHs.current = s.home
      if (s?.away != null) prevAs.current = s.away
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (hs  != null) prevHs.current = hs
    if (as_ != null) prevAs.current = as_
    if (hs != null && as_ != null) {
      try { localStorage.setItem(scoreKey, JSON.stringify({ home: hs, away: as_ })) } catch {}
    }
  }, [hs, as_, scoreKey])

  // (getMatchGradient n'est plus utilisé ici : depuis le passage en panneau
  // flottant, le fond est une base sombre + 2 halos diffus portés par le CSS,
  // plus un dégradé plein injecté en style inline. Voir .lmp__hero.)

  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)

  // ── PANNEAU FLOTTANT (refonte 02/09, maquette validée) ─────────────────
  // Constat de départ (utilisateur) : "le score et tout, c'est un peu
  // brouillon". Diagnostic fait sur la page réelle : cinq éléments centrés
  // empilés (minute, score, pastille de période, diffuseur, buteurs), chacun
  // avec son style, aucun ne dominant — et le tout posé sur un dégradé plein
  // très saturé contre lequel chaque texte devait lutter.
  // Trois changements : le hero devient une CARTE posée sur la page (marges,
  // coins arrondis) ; le dégradé plein cède la place à un fond sombre calme
  // avec deux halos très diffus aux couleurs des équipes ; le championnat
  // passe en haut à GAUCHE avec sa pastille de logo, exactement comme
  // l'affiche du match du jour — les deux écrans se répondent.
  return (
    <div className="lmp__heroOuter">
      {/* Le retour sort du panneau : c'est une action de navigation, pas une
          info du match — il n'a rien à faire dans la carte. */}
      <button className="lmp__heroBack" onClick={onBack}>‹ En Direct</button>

      {/* ⚠️ .sf-liveBorder UNIQUEMENT tant que le match n'est pas terminé
          (05/09). Le contour rouge fixe du panneau est désormais présent sur
          les trois pages (match à venir, direct, terminé), ce qui lui a fait
          perdre sa valeur de signal ; l'animation la lui rend, mais seulement
          là où elle veut dire quelque chose. Un mouvement se repère seul, là
          où un rouge simplement plus vif ne se voit qu'en comparaison.
          .sf-liveBorder existait déjà dans index.css, écrite pour cet usage
          exact et branchée nulle part — elle respecte aussi
          prefers-reduced-motion, l'animation s'arrête pour qui a désactivé les
          animations dans son système. */}
      <div
        className={`mp__hero lmp__hero${isTermine ? '' : ' sf-liveBorder'}${comp?.tintLight ? ' lmp__hero--lightTint' : ''}${comp?.tint ? ' lmp__hero--tinted' : ''}`}
        style={{
          // Teinte du championnat (voir `tint`, competitions.js). Absente pour
          // une compétition sans couleur identifiable : le CSS retombe alors
          // sur le fond sombre d'origine.
          // ⚠️ HALOS COULEUR CLUB RETIRÉS (05/09, demande explicite : "enlève
          // les couleurs du club dans livematchpage/matchpage/résultat page
          // pour bien garder la couleur [du championnat]") — les halos
          // --lmp-hc/--lmp-hc2 entraient en conflit avec la teinte du
          // championnat au lieu de la compléter. `getMatchTeamColors` et les
          // spans .lmp__heroGlowL/R ont été retirés avec (voir git log si
          // besoin de les retrouver).
          // ⚠️ tint2 AJOUTÉ (05/09, même jour, demande explicite : "un
          // mélange de blanc et rouge... des taches blanche" + reflet façon
          // verre/eau, PAS un simple fondu de couleur plate — voir le
          // commentaire détaillé dans LiveMatchPage.css) — alimente
          // .lmp__heroTintB/C. Absent pour la plupart des
          // compétitions : le CSS retombe sur une variante éclaircie
          // auto-calculée de `--lmp-comp`.
          ...(comp?.tint ? { '--lmp-comp': comp.tint } : {}),
          ...(comp?.tint2 ? { '--lmp-comp2': comp.tint2 } : {}),
        }}
      >
      {/* ⚠️ Calques de la texture animée (05/09) — voir le commentaire
          détaillé dans LiveMatchPage.css (.lmp__heroTintB/C). Purement
          décoratifs (aria-hidden), n'affectent jamais la mise en page : le
          contenu réel garde son z-index au-dessus. */}
      <span className="lmp__heroTintB" aria-hidden="true" />
      <span className="lmp__heroTintC" aria-hidden="true" />

      {/* Bandeau : championnat à gauche, bien lisible */}
      <div className="mp__hero__top lmp__heroTop">
        <div className="mp__hero__comp lmp__heroComp">
          {emblem && (
            <span
              className="lmp__heroCompIcon"
              /* ⚠️ data-opaque/emblemBg manquaient ici alors qu'ils existaient
                 déjà sur la carte "Match du jour" : les logos à fond plein
                 (Ligue 1, Premier League, Serie A) se retrouvaient donc dans
                 une pastille blanche sur CES pages — un carré de couleur dans
                 un carré blanc, le défaut corrigé ailleurs mais pas ici. */
              data-opaque={comp?.emblemOpaque ? '1' : undefined}
              style={comp?.emblemBg ? { background: comp.emblemBg } : undefined}
            >
              <img src={emblem} alt="" />
            </span>
          )}
          {/* ⚠️ AJOUT (05/09, constat utilisateur : "sur ces pages j'ai
              l'impression qu'il manque quelque chose"). Ce qui manquait est
              QUAND le match se joue : depuis que "Terminé" a remplacé la date
              au centre, plus rien n'indiquait ni le jour ni la journée de
              championnat — sur un match passé, impossible de savoir si c'était
              vendredi dernier ou il y a un mois.
              Les deux valeurs viennent du match déjà chargé, aucun appel
              supplémentaire. La journée peut manquer (un match sourcé ESPN n'a
              pas toujours `matchday`) : la ligne se réduit alors à la date, et
              disparaît complètement si les deux manquent. */}
          <span className="lmp__heroCompCol">
            <span className="mp__hero__compName lmp__heroCompName">{compName}</span>
            {heroSubline && <span className="lmp__heroCompSub">{heroSubline}</span>}
          </span>
        </div>
        {/* Période en HAUT À DROITE (02/09, demande explicite) — même
            emplacement que sur l'affiche "Match du jour" de l'Accueil, donc
            même repère d'un écran à l'autre. La minute, elle, reste juste
            au-dessus du score : c'est la seule des deux qui change en
            permanence, elle a sa place à côté du chiffre qu'elle qualifie. */}
        {/* Rouge tant que le match est en cours (04/09, demande utilisateur :
            "les minutes du match en rouge, et quand c'est la mi-temps le MT
            aussi"). La minute et le "MT" du centre l'étaient déjà ; ce badge
            de période était le dernier élément d'état resté blanc. Le
            modificateur est conditionné à `!isTermine` pour qu'un match qui
            vient de se terminer ne garde pas une mention rouge, qui signale
            "ça se joue en ce moment". */}
        {periodBadge && (
          <span className={`lmp__heroPeriodBadge${isTermine ? '' : ' lmp__heroPeriodBadge--live'}`}>
            {periodBadge}
          </span>
        )}
      </div>

      {/* Centre : crests + score */}
      <div className="mp__hero__mid">
        <div className="mp__hero__team">
          {showLivePens && <ShootoutDots scored={homeShootout} />}
          {(homeCrest ?? match.homeTeam?.crest)
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={homeCrest ?? match.homeTeam?.crest} alt="" className="mp__hero__crest" data-team={match.homeTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{homeName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{homeName}</span>
          <FormDiamonds form={hForm} />
        </div>

        <div className="mp__hero__center">
          {/* ⚠️ REGROUPÉ AU-DESSUS DU SCORE (02/09, demande utilisateur) :
              la minute était dans un bloc séparé AVANT toute la rangée (donc
              au-dessus des blasons, pas du score) et la période s'affichait
              SOUS le score. Les deux disaient pourtant la même chose — où en
              est le match — et encadraient le score sans le servir.
              Elles forment maintenant un seul groupe de statut juste au-dessus
              du score, centré. Le diffuseur (WatchBadge) reste sous le score,
              conformément à la demande : c'est une info d'une autre nature,
              pas un état de match. */}
          <div className="lmp__heroStatus">
            <span className={`lmp__heroMinute${isTermine ? ' lmp__heroMinute--ft' : ''}`}>
              {/* Dot fantôme symétrique à droite : sans lui, le point live à
                  gauche décale visuellement le texte de la minute par rapport
                  au score en dessous (qui, lui, n'a pas cet élément asymétrique). */}
              {!isTermine && <span className="lmp__heroLiveDot" />}
              <span className="lmp__heroMinuteText">{minuteLabel}</span>
              {!isTermine && <span className="lmp__heroLiveDot lmp__heroLiveDot--ghost" aria-hidden="true" />}
            </span>
          </div>

          <span className="mp__hero__score">{h} – {a}</span>
          {/* Score des tab en direct — ESPN expose un champ shootoutScore dédié
              par compétiteur (voir api/fifa-live.js), déjà tracké côté client
              dans espnScoresCache (useLiveMinute.js) mais pas encore affiché ici. */}
          {showLivePens && (
            <span className="lmp__heroPens">({homeShootout ?? 0}-{awayShootout ?? 0} tab)</span>
          )}
          {/* ⚠️ DÉPLACÉ (28/08, demande utilisateur : "en haut à droite y'a
              le statut du match... on pourrait le mettre en dessous du
              score") : était dans .mp__hero__top (coin haut-droit, à côté du
              badge compétition) — déplacé ici, sous le score, pour ne jamais
              se disputer l'espace avec un indicateur de statut là-haut. */}
          <WatchBadge match={match} variant="score" />
        </div>

        <div className="mp__hero__team mp__hero__team--away">
          {showLivePens && <ShootoutDots scored={awayShootout} />}
          {(awayCrest ?? match.awayTeam?.crest)
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={awayCrest ?? match.awayTeam?.crest} alt="" className="mp__hero__crest" data-team={match.awayTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{awayName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{awayName}</span>
          <FormDiamonds form={aForm} />
        </div>
      </div>

      {/* Buts + cartons — fusionnés et triés par minute (même logique/mêmes
          icônes que MatchPage.jsx, voir buildMatchEvents dans MatchModal.jsx).
          ⚠️ BUG CORRIGÉ (28/08, constat utilisateur : "y'a que les buteurs
          qui y sont, quand y'a un carton jaune ou rouge il s'affiche
          qu'après le match dans résultat") : ce hero n'affichait QUE
          espn.scorers, jamais espn.cards — alors que espn.cards est déjà
          rempli EN DIRECT par le même poll (voir espnScoresCache dans
          useLiveMinute.js, cards: cards écrit au même endroit que scorers).
          Ce n'était donc pas un manque de donnée, juste un rendu qui
          l'ignorait — un choix explicite d'une session précédente ("buts
          seuls" volontaire à l'époque), changé ici sur demande explicite. */}
      {(() => {
        const { home: homeEvents, away: awayEvents } = buildMatchEvents({
          espnScorers: espn?.scorers ?? [],
          espnCards:   espn?.cards   ?? [],
        })
        if (homeEvents.length === 0 && awayEvents.length === 0) return null
        return (
          <div className="lmp__heroScorers">
            <div className="lmp__heroScorersHome">
              {homeEvents.map(e => (
                <span key={e.key} className="lmp__heroScorerItem">
                  <span className="lmp__heroScorerIcon" aria-hidden="true">{e.icon}</span>
                  {e.name}
                  {e.minute && <span className="lmp__heroScorerMin"> {e.minute}</span>}
                </span>
              ))}
            </div>
            <div className="lmp__heroScorersDiv" />
            <div className="lmp__heroScorersAway">
              {awayEvents.map(e => (
                <span key={e.key} className="lmp__heroScorerItem">
                  <span className="lmp__heroScorerIcon" aria-hidden="true">{e.icon}</span>
                  {e.name}
                  {e.minute && <span className="lmp__heroScorerMin"> {e.minute}</span>}
                </span>
              ))}
            </div>
          </div>
        )
      })()}
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function LiveMatchPage() {
  const { matchId }            = useParams()
  const navigate               = useNavigate()
  const { liveMatches, espnScores } = useLiveData()

  const rawMatch = liveMatches.find(m => String(m.id) === String(matchId))
  const espn    = rawMatch ? (espnScores[rawMatch.id] ?? null) : null
  const compId  = rawMatch?.competition?.code ?? null

  const { formMap, compMatches, isLastSeason } = useTeamForm(compId)
  // Repli "club promu" (03/08, cohérence demandée avec Accueil/Pronos) — voir
  // useLowerDivisionStats (useMatchs.js) et son commentaire détaillé.
  const lowerDivMatches = useLowerDivisionStats(compId, compMatches)

  // Même correctif que MatchPage.jsx (voir resolveFdTeamId, matchUtils.js) :
  // un match live sourcé ESPN (les 6 grands championnats via Accueil) a des
  // homeTeam.id/awayTeam.id ESPN, pas FD.org — casse Forme/Stats saison/
  // Compos probables qui filtrent compMatches par id. Résolu une fois ici.
  //
  // ⚠️ AJOUT `scheduledMatches` (27/07, même demande/commentaire détaillé que
  // MatchPage.jsx) : compMatches (useTeamForm) est FINISHED-only (voire
  // saison précédente en intersaison) — ne contient jamais le match précis
  // affiché ici. useMatches(compId,'SCHEDULED') = même hook/queryKey que
  // Programme (cache RAW partagé, voir useMatchs.js) : aucune requête FD.org
  // en plus si Programme a déjà été visité pour cette compét.
  const { matches: scheduledMatches } = useMatches(compId, 'SCHEDULED')
  const resolveMatches = useMemo(
    () => [...(scheduledMatches ?? []), ...compMatches],
    [scheduledMatches, compMatches]
  )

  const match = useMemo(() => {
    if (!rawMatch || !resolveMatches?.length) return rawMatch
    // ⚠️ AJOUT `{ loose: true }` — voir le commentaire détaillé dans
    // MatchPage.jsx (même fix).
    // ⚠️ AJOUT `strict:true` (16/08, constat utilisateur : losange "forme
    // récente" d'une AUTRE équipe affiché sous le logo de Racing, match
    // toujours en cours — même bug que MatchCard.jsx/MatchPoster.jsx/
    // MatchPage.jsx, voir le commentaire détaillé sur resolveFdTeamId dans
    // matchUtils.js). Sans correspondance de nom fiable, homeId/awayId
    // restent `null` plutôt que l'id ESPN brut (coïncidence numérique
    // possible avec l'id FD.org d'un club différent une fois utilisé comme
    // clé de formMap/compMatches). Contrairement à MatchPage.jsx, cette page
    // n'a PAS besoin d'un id ESPN natif séparé : les buteurs live
    // (espn?.scorers, plus bas) sont déjà tagués 'home'/'away' en texte par
    // le serveur (api/fifa-live.js), jamais comparés par id d'équipe — donc
    // aucun consommateur de match.homeTeam.id sur cette page n'a besoin de
    // l'id ESPN brut, tous veulent l'id FD.org résolu (formMap, compMatches,
    // H2H, classement).
    const homeId = resolveFdTeamId(rawMatch.homeTeam, resolveMatches, { loose: true, strict: true })
    const awayId = resolveFdTeamId(rawMatch.awayTeam, resolveMatches, { loose: true, strict: true })
    if (homeId === rawMatch.homeTeam?.id && awayId === rawMatch.awayTeam?.id) return rawMatch
    return {
      ...rawMatch,
      homeTeam: { ...rawMatch.homeTeam, id: homeId },
      awayTeam: { ...rawMatch.awayTeam, id: awayId },
    }
  }, [rawMatch, resolveMatches])

  // ⚠️ AJOUT (18/08, constat utilisateur : "si je vais pas dans LiveMatchPage
  // pendant tout le match... quand le match se finit les stats affichent pas
  // toutes les stats du match mais seulement là où je suis allé" — comme si
  // ça s'était pas mis à jour) : `espn` (ci-dessus, espnScoresCache via
  // useLiveData) est un instantané LIVE — enrichi en stats détaillées
  // (possession/tirs/etc, voir api/fifa-live.js) uniquement PENDANT que le
  // match est IN_PROGRESS/HALFTIME/END_PERIOD, plus jamais une fois
  // STATUS_FINAL atteint. Résultat : les stats affichées restent celles du
  // DERNIER poll détaillé avant la fin — souvent incomplètes de quelques
  // minutes (celles APRÈS le dernier poll consulté), ce qui donne
  // l'impression trompeuse que ça dépend de la dernière fois où on est allé
  // sur cette page. MatchPage.jsx (page Résultat) a déjà ce même correctif
  // pour cette page-ci (MpMatchStats/useEspnMatchStats, voir son commentaire
  // détaillé) — jamais appliqué ici. useEspnMatchStats fait une VRAIE
  // recherche indépendante du résumé ESPN post-match (par nom d'équipe +
  // date, pas besoin d'avoir suivi le match en direct) — définitif, stats
  // complètes sur les 90+ minutes. Fusionné par-dessus `espn` (qui reste la
  // seule source pour les buteurs live/minute/score, non concernés par ce
  // bug) uniquement une fois `isTermine` vrai et si le fetch a réussi —
  // aucun changement pour un match encore en direct.
  const isTermine = match ? getMatchState(match.id).ft === true : false
  const { data: espnStatsFinal } = useEspnMatchStats(isTermine ? match : null, true)
  const espnForStats = espnStatsFinal?.stats
    ? { ...(espn ?? {}), stats: espnStatsFinal.stats }
    : espn

  // ⚠️ AJOUT (21/08, constat utilisateur : logos différents entre les cards
  // Accueil/LiveMatchPage et Programme/Résultats) : même principe que
  // MatchCard.jsx/MatchPoster.jsx/MatchDuJourCard.jsx — préfère l'écusson
  // FD.org (déjà dans resolveMatches, zéro appel réseau en plus, chargé
  // juste au-dessus pour la résolution d'id) à celui du match lui-même (ESPN
  // pour ces 6 championnats, voir espnAdapter.js).
  const homeCrest = resolveFdCrest(match?.homeTeam, match?.homeTeam?.id, resolveMatches)
  const awayCrest = resolveFdCrest(match?.awayTeam, match?.awayTeam?.id, resolveMatches)

  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]
  // Le pronostic live (calcLiveProno, score + minute + cartons rouges +
  // possession) est désormais calculé DANS LiveStatsTab (MatchModal.jsx) —
  // c'est là qu'on a déjà les stats live sous la main pour l'enrichir, et ça
  // permet de l'afficher au-dessus des stats sans dupliquer le calcul ici.
  // hForm/aForm/compMatches (déjà chargés ici pour d'autres besoins de la
  // page) lui sont simplement transmis en props, voir plus bas.

  // Échantillonnage pour la courbe de bascule post-match (voir <ProbaCurve>).
  const homeShort = translateTeam(match?.homeTeam?.shortName || match?.homeTeam?.name || '?')
  const awayShort = translateTeam(match?.awayTeam?.shortName || match?.awayTeam?.name || '?')
  // Thème dynamique — mêmes couleurs anti-collision que le hero (getMatchGradient).
  const themeVars = getMatchThemeVars(match?.homeTeam?.name || homeShort, match?.awayTeam?.name || awayShort)

  // Historique des confrontations — masqué tant qu'aucune confrontation
  // connue n'est confirmée (même logique que MatchPage). Replié comme 3e
  // sous-onglet dans StatsSubTabs au lieu d'un onglet top-level séparé (voir
  // MatchModal.jsx + MatchPage.jsx pour le même changement).
  // resolveMatches (pas compMatches) : voir commentaire détaillé plus haut —
  // nécessaire à resolveFdMatchId (matchUtils.js) pour retrouver le vrai id
  // FD.org du match affiché.
  // ⚠️ AJOUT `useH2HHistory` (constat utilisateur, 20/08 — voir commentaire
  // détaillé dans MatchPage.jsx, même fix) : resolveMatches perd toute trace
  // des saisons précédentes dès le 1er match FINISHED de la nouvelle saison —
  // h2hHistory (2 saisons de plus, indépendant de fetchClubMatchesRaw) comble
  // ce trou pour le head2head AFFICHÉ, pas seulement pour la cote de prono.
  const h2hHistory = useH2HHistory(compId, resolveMatches)
  const h2hPool = (resolveMatches?.length || h2hHistory?.length) ? [...resolveMatches, ...h2hHistory] : resolveMatches
  const { rows: h2hRows, isLoading: h2hLoading } = useH2HRows(match, h2hPool, 6_000, { looseTeamMatch: true, extendedH2H: true })
  // ⚠️ AJOUT (constat utilisateur, 02/09 : cotes différentes entre les cards
  // de l'Accueil et cette page). Le prono live ne doit PAS être nourri du
  // même historique que l'onglet "Historique" : celui-ci est volontairement
  // ÉTENDU (extendedH2H, jusqu'à 6 saisons via football-data.co.uk) alors que
  // les cards de l'Accueil (MatchPoster.jsx) n'utilisent que l'historique
  // court. Même modèle, même cote de marché, mais un prior bien plus profond
  // d'un côté → cotes divergentes pour le même match.
  // Ces rows-ci reprennent EXACTEMENT les options des cards (non étendu, même
  // delay 0) et ne servent qu'au CALCUL, transmis en `pronoH2H`. Aucun appel
  // réseau supplémentaire : c'est le même hook sur le même pool déjà chargé,
  // simplement sans l'extension football-data.co.uk.
  const { rows: pronoH2H } = useH2HRows(match, h2hPool, 0, { looseTeamMatch: true })
  // ⚠️ RETIRÉ `!h2hLoading` (27/07, même demande/commentaire détaillé que
  // MatchPage.jsx) : compH2H (repli instantané, 0 requête) suffit à afficher
  // l'onglet tout de suite — le contenu se complète tout seul avec
  // l'historique FD.org complet dès qu'il arrive.
  const showH2HTab = h2hRows.length > 0
  const TABS = ['stats', 'compos', 'classement']

  const [activeTab, setActiveTab] = useState('stats')
  const [tabDir, setTabDir]       = useState(null)
  // Sous-onglet dans "Stats Live" : Stats live (par défaut) / Stats saison
  const [statsView, setStatsView] = useState('live')

  const goTab = (t, dir) => { setTabDir(dir); setActiveTab(t) }

  const swipe = useSwipe(
    () => { const i = TABS.indexOf(activeTab); if (i < TABS.length - 1) goTab(TABS[i + 1], 'left') },
    () => { const i = TABS.indexOf(activeTab); if (i > 0) goTab(TABS[i - 1], 'right') }
  )

  // Filet de sécurité : si le match n'est (plus) dans liveMatches — lien direct
  // vers un match déjà terminé et évincé du tracker, ou match qui se termine
  // pendant que l'utilisateur est sur la page — on redirige vers la page match
  // classique (qui a son propre fetch de secours) au lieu de rester bloqué sur
  // le skeleton indéfiniment. Petit délai pour ne pas rediriger sur un flash
  // transitoire au tout premier rendu.
  useEffect(() => {
    if (match) return
    const t = setTimeout(() => {
      navigate(`/match/${matchId}`, { replace: true })
    }, 1200)
    return () => clearTimeout(t)
  }, [match, matchId, navigate])

  // ── Sortie automatique quelques secondes après "Terminé" ──────────────────
  // Avant : la page restait affichée en mode live (score/minute/onglets live)
  // jusqu'à l'éviction complète du match du tracker (5min, voir confirmFt
  // dans useLiveMinute.js) — le badge passait bien à "Terminé" immédiatement,
  // mais la page elle-même donnait l'impression de rester "en direct" bien
  // après la fin réelle (confusion signalée). Ticker dédié (3s) tant que le
  // match n'est pas terminé, pour détecter le passage à ft===true sans
  // attendre le prochain remount/poll global, puis redirection vers la page
  // match classique une fois la fenêtre de grâce (TERMINE_GRACE_MS) écoulée.
  // (isTermine déjà calculé plus haut, avant useEspnMatchStats — voir son
  // commentaire — même expression, pas dupliquée ici.)
  const [, setLmpTick] = useState(0)
  useEffect(() => {
    if (isTermine) return
    const id = setInterval(() => setLmpTick(t => t + 1), 3_000)
    return () => clearInterval(id)
  }, [isTermine])

  useEffect(() => {
    if (!match || !isTermine) return
    const termineAt = getMatchState(match.id).termineAt ?? Date.now()
    const remaining = TERMINE_GRACE_MS - (Date.now() - termineAt)
    const t = setTimeout(() => {
      navigate(`/match/${matchId}`, { replace: true })
    }, Math.max(0, remaining))
    return () => clearTimeout(t)
  }, [isTermine, match, matchId, navigate])

  if (!match) {
    return <LmpPageSkeleton />
  }

  return (
    <div className="lmp__layout">
    <div className="mp__page lmp__main" style={themeVars}>

      {/* Hero gradient avec score live */}
      <MatchHeader match={match} espn={espn} hForm={hForm} aForm={aForm} homeCrest={homeCrest} awayCrest={awayCrest} onBack={() => {
        if (window.history.length > 1) navigate(-1)
        else navigate('/live')
      }} />

      <div className="mp__wrap">
        <div className="mp__body" ref={swipe.ref}>

          {/* Onglets */}
          <div className="lmp__tabsRow">
            <div className="mp__tabs">
              {TABS.map(t => (
                <button
                  key={t}
                  className={`mp__tab${activeTab === t ? ' mp__tab--active' : ''}`}
                  onClick={() => goTab(t, null)}
                >
                  {t === 'stats'       ? 'Statistiques'
                 : t === 'compos'     ? 'Compos'
                 :                      'Classement'}
                </button>
              ))}
            </div>
          </div>
          <TabDots count={TABS.length} active={TABS.indexOf(activeTab)} />

          {/* Contenu */}
          <div
            key={activeTab}
            className={`mp__tabContent${
              !swipe.isDragging && tabDir === 'left'  ? ' mp__tabContent--fromRight' :
              !swipe.isDragging && tabDir === 'right' ? ' mp__tabContent--fromLeft'  : ''
            }`}
            style={{
              transform:  swipe.isDragging ? `translateX(${swipe.dragOffset}px)` : undefined,
              transition: swipe.isDragging ? 'none' : undefined,
            }}
          >
            {activeTab === 'stats' && (
              <>
                {/* Stats saison ramenée ici en sous-onglet (retour utilisateur,
                    12/08) — aux côtés de Stats live et Historique, comme sur
                    MatchPage.jsx (voir StatsSubTabs). Affichée dès qu'il y a
                    au moins un 2e sous-onglet à proposer (Historique dispo),
                    sinon "Stats live" reste seule sans sélecteur inutile. */}
                <StatsSubTabs view={statsView} onChange={setStatsView} showHistorique={showH2HTab} />
                {statsView === 'historique' ? (
                  <H2HTabContent match={match} rows={h2hRows} isLoading={h2hLoading} />
                ) : statsView === 'saison' ? (
                  // ⚠️ isLastSeason (27/07, demande explicite utilisateur :
                  // "pas la peine de recuperer la forme recente et stat saison
                  // des dernieres saison... juste h2h") : compMatches vient
                  // alors du repli "saison précédente" de useTeamForm — ni
                  // stats ni forme d'une saison déjà terminée ne sont
                  // affichées tant que la nouvelle saison n'a pas commencé
                  // (voir useTeamForm.js, redevient false automatiquement dès
                  // les premiers vrais matchs). `|| compMatches.length === 0`
                  // (30/07, même garde-fou que MatchPage.jsx) : évite un bloc
                  // vide sans message si compMatches est vide pour une autre
                  // raison (ex. équipe promue, tout début de saison).
                  (isLastSeason || compMatches.length === 0)
                    ? <p className="pm__noData">Disponibles dès le début de la saison</p>
                    : <SeasonStatsTab match={match} compMatches={compMatches} />
                ) : (
                  <LiveStatsTab
                    match={match}
                    espnScore={espnForStats}
                    compMatches={compMatches}
                    hForm={hForm}
                    aForm={aForm}
                    h2hRows={h2hRows}
                    pronoH2H={pronoH2H}
                    lowerDivMatches={lowerDivMatches}
                  />
                )}
              </>
            )}
            {activeTab === 'compos'     && <ComposTab match={match} compMatches={compMatches} scorers={espn?.scorers ?? []} />}
            {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
          </div>
        </div>
      </div>
    </div>

    {/* Sidebar desktop — tous les matchs en direct, cliquables (voir
        .lmp__sidebar dans LiveMatchPage.css, masquée en mobile) */}
    <LiveSidebar activeMatchId={match.id} />
    </div>
  )
}
