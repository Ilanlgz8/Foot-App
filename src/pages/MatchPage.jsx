/**
 * MatchPage — page dédiée à un match à venir / terminé
 * Route : /match/:matchId
 */
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useState, useMemo }       from 'react'
import { useQuery }                from '@tanstack/react-query'
import { translateTeam }           from '../data/teamNames'
import { COMPETITIONS }            from '../data/competitions'
import { useTeamForm }             from '../hooks/useTeamForm'
import { useMatches, useH2HHistory } from '../hooks/useMatchs'
import { useSwipe }                from '../hooks/useSwipe'
import { getMatchThemeVars, getMatchTeamColors } from '../data/teamPhotos'
import { finalScore, mergeScore, isNationalTeamComp, resolveFdTeamId, resolveFdMatchId } from '../utils/matchUtils'
import { getMatchState } from '../utils/matchStateTracker'
import { FormDiamonds }            from '../accueil/FormDiamonds'
import { WatchBadge }              from '../components/WatchBadge'
import { fdFetch, fdUrl }          from '../utils/fdFetch'
import {
  useEspnMatchStats,
  useFifaStats,
  useMatchDetail,
} from '../hooks/useMatchDetail'
import { useEspnMatchDetail } from '../hooks/useEspnMatchDetail'
import { useAflMatchStats } from '../hooks/useApiFootball'
import {
  PreMatchSection,
  ComposTab,
  ClassementTab,
  MatchTimeline,
  StatsSubTabs,
  getEspnData,
  TabDots,
  TeamFormTable,
  buildMatchEvents,
  useH2HRows,
  H2HTabContent,
  fifaStatsToRows,
  aflStatsToRows,
  StatTrack,
} from '../components/MatchModal'
import './MatchPage.css'
import '../matchModal.css'
import '../live.css'
// Réutilisé pour les classes .lmp__heroScorers* (buteurs sous les noms
// d'équipe dans le hero) — même style qu'en direct, demande explicite de
// l'utilisateur ("exactement pareil"). Import de la CSS de la page live
// plutôt que dupliquer les règles, pour garantir un rendu identique sans
// risque de dérive entre les deux (même pattern déjà utilisé ailleurs dans
// l'app, ex: Resultat.jsx qui importe match.css).
import './LiveMatchPage.css'



// ── Fetch fallback si accès direct par URL ────────────────────────────────────
function useMatchData(matchId, initialMatch) {
  return useQuery({
    queryKey:  ['match', matchId],
    queryFn:   async () => {
      // ⚠️ fdFetch et NON fetch() brut (04/09) : cet appel était le seul de la
      // page à contourner le wrapper — il n'avait donc ni le timeout de 15s
      // (une requête partie mais jamais revenue laissait la page en
      // chargement indéfini), ni la substitution des écussons basse
      // résolution (voir crestOverrides.js). Découvert en constatant que
      // l'écusson de Monaco restait flou ICI alors qu'il était corrigé dans
      // le classement, qui passe bien par fdFetch.
      const res = await fdFetch(fdUrl(`/api/v4/matches/${matchId}`))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled:   !initialMatch && !!matchId,
    staleTime: 5 * 60_000,
  })
}

// ── Formatage date / heure ────────────────────────────────────────────────────
function isSameDay(a, b) {
  return a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
}
function formatDate(utcDate) {
  if (!utcDate) return '–'
  const d = new Date(utcDate)
  const today    = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (isSameDay(d, today))    return "Aujourd'hui"
  if (isSameDay(d, tomorrow)) return 'Demain'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}
function formatTime(utcDate) {
  if (!utcDate) return '–'
  return new Date(utcDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Hero gradient plein-écran ─────────────────────────────────────────────────
function MatchPageHero({ match, navigate, hForm, aForm, rawHomeId }) {
  const comp       = COMPETITIONS.find(c => c.id === match.competition?.code)
  const homeName   = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName   = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  // ⚠️ BUG CORRIGÉ (constat utilisateur : après la redirection accélérée
  // LiveMatchPage→MatchPage — voir TERMINE_GRACE_MS dans matchStateTracker.js
  // — les buteurs n'apparaissaient plus et le match n'affichait pas
  // "Terminé") : isFinished ne testait que match.status === 'FINISHED', un
  // champ football-data.org qui a 1-5min de retard connu sur la vraie fin du
  // match (voir CLAUDE.md). Or cette redirection amène ici SANS state passé
  // par navigate() → `match` vient d'un fetch direct FD.org tout frais, donc
  // presque toujours encore 'IN_PLAY' à ce moment-là. Ailleurs dans l'app
  // (MatchCard, Resultat.jsx, Pronos.jsx…), le flag `ft` (confirmé par ESPN,
  // voir matchStateTracker.js) a toujours priorité sur match.status pour
  // cette raison — ce composant était le seul oublié.
  const isFinished = match.status === 'FINISHED' || getMatchState(match.id).ft === true

  // Buteurs + cartons — même source/logique que MpMatchStats (cache
  // localStorage persistant si le match a été suivi en live, sinon fetch ESPN
  // à la demande). queryKey partagée avec MpMatchStats → pas de double fetch,
  // React Query dédup les deux appels automatiquement.
  const cachedEspn = isFinished ? getEspnData(match?.id) : null

  // Score : si FD.org n'a pas encore confirmé FINISHED (cas ci-dessus), son
  // score peut encore être celui d'avant la fin du match — on fusionne avec
  // le score ESPN persisté par confirmFt() (cachedEspn.home/away, déjà le bon
  // score final) pour ne jamais afficher un score obsolète ici.
  const fs         = finalScore(match.score)
  const hs         = mergeScore(cachedEspn?.home, fs.home ?? match.score?.halfTime?.home)
  const as_        = mergeScore(cachedEspn?.away, fs.away ?? match.score?.halfTime?.away)
  // Tirs au but / prolongation — même logique que Resultat.jsx et
  // accueil/MatchCard.jsx (mutuellement exclusifs : un match aux tab a
  // duration='PENALTY_SHOOTOUT', pas 'EXTRA_TIME'). Manquait ici : cette page
  // affichait juste "Terminé" sans jamais préciser tab/prolongation.
  const wentToPens = match.score?.duration === 'PENALTY_SHOOTOUT'
  const wentToAet  = match.score?.duration === 'EXTRA_TIME'
  const emblem     = comp?.emblem ?? match.competition?.emblem
  // ⚠️ BUG CORRIGÉ (nom de compétition pas en français) — même correction
  // que LiveMatchPage.jsx, voir le commentaire là-bas.
  const compName   = comp?.name ?? match.competition?.name ?? ''
  // (plus de dégradé plein injecté ici : depuis le passage en panneau
  // flottant, le fond est une base sombre + 2 halos diffus portés par le CSS.
  // Voir .lmp__hero, réutilisé par cette page.)

  // Score tirs au but : fusion FD.org (match.score.penalties) + snapshot ESPN
  // persisté au moment du FT (cachedEspn.home/awayShootout), même garde
  // anti-régression (Math.max) que mergeScore() pour le score classique.
  // ⚠️ Bug constaté : FD.org peut brièvement re-servir une valeur de
  // score.penalties plus basse quelques minutes après la fin du match (même
  // catégorie d'instabilité déjà documentée pour score.fullTime, voir
  // finalScore() ci-dessus), le temps qu'ils recalculent/resynchronisent côté
  // serveur. Sans fusion, l'écran suivait cette régression telle quelle
  // (4-3 → 3-3 → 4-3). cachedEspn est écrit une seule fois par confirmFt()
  // avec la valeur ESPN déjà anti-régressée (voir useLiveMinute.js) et ne
  // change plus jamais après → sert de plancher fiable.
  const hPens = mergeScore(match.score?.penalties?.home ?? null, cachedEspn?.homeShootout ?? null)
  const aPens = mergeScore(match.score?.penalties?.away ?? null, cachedEspn?.awayShootout ?? null)
  // ⚠️ BUG CORRIGÉ (constat utilisateur : le déroulement buts/cartons
  // n'affichait QUE les buts marqués pendant qu'il regardait le match — les
  // buts marqués après qu'il s'est endormi/a fermé l'app manquaient) : un
  // 1er correctif avait juste changé "cachedEspn existe" en "cachedEspn a AU
  // MOINS un but/carton", mais un snapshot PARTIEL (capturé en direct par
  // confirmFt à l'instant précis de la fin du match) a justement TOUJOURS au
  // moins quelques buts dedans dès qu'il y a eu but avant que l'utilisateur
  // arrête de suivre — donc cette condition ne détectait jamais le cas
  // "incomplet mais non vide". confirmFt() capture un INSTANTANÉ du direct, à
  // un instant arbitraire — ce n'est structurellement JAMAIS une source
  // fiable pour le récap final une fois le match terminé. Seul le résumé
  // ESPN (POST-match, définitif) l'est. Nouvelle logique : une fois le match
  // terminé, on va TOUJOURS chercher le résumé ESPN complet et on l'utilise
  // en priorité — cachedEspn ne sert plus que de repli si ce fetch échoue
  // (offline, ESPN indispo). React Query dédup/cache déjà cet appel
  // (staleTime 1h), donc aucun coût réseau superflu à chaque ouverture.
  const { espnData: fetchedEspn } = useEspnMatchDetail(
    isFinished ? match : null,
    match?.competition?.id,
    isFinished
  )
  const espnScorers = (fetchedEspn?.scorers?.length ? fetchedEspn.scorers : cachedEspn?.scorers) ?? []
  const espnCards   = (fetchedEspn?.cards?.length   ? fetchedEspn.cards   : cachedEspn?.cards)   ?? []
  // Buts + cartons fusionnés et triés par minute (même logique que le Fil du
  // match dans l'onglet Statistiques, sans les remplacements — le hero reste
  // compact). Uniquement ici (page Résultat) : demande explicite de
  // l'utilisateur, LiveMatchPage garde son affichage buts-seuls actuel.
  // ⚠️ rawHomeId (pas match.homeTeam?.id) : espnScorers/espnCards viennent
  // d'ESPN (useEspnMatchDetail ci-dessus) et utilisent donc l'id ESPN natif
  // de l'équipe — jamais l'id football-data.org résolu (match.homeTeam.id,
  // désormais `null` en cas d'échec de résolution depuis le fix strict du
  // 16/08, voir la déclaration de `match` dans le composant parent). Utiliser
  // l'id résolu ici casserait l'attribution buteurs/cartons à chaque fois que
  // la résolution échoue légitimement (équipe hors compétitions suivies).
  const { home: homeEvents, away: awayEvents } = buildMatchEvents({
    espnScorers, espnCards, homeId: rawHomeId ?? match.homeTeam?.id,
  })

  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)

  // ── PANNEAU FLOTTANT (02/09, demande utilisateur : "fais ça aussi pour les
  // matchs terminés et les matchs à venir, comme ça c'est partout pareil").
  // Exactement le même habillage que LiveMatchPage : carte posée sur la page
  // au lieu d'un bandeau plein écran, fond sombre calme + 2 halos diffus aux
  // couleurs des équipes à la place du dégradé plein, championnat en haut à
  // gauche avec sa pastille de logo, statut en haut à droite, retour sorti du
  // panneau. Les classes .lmp__hero* sont RÉUTILISÉES telles quelles (elles
  // sont déjà chargées ici, MatchPage.css et LiveMatchPage.css étant importés
  // ensemble par les deux pages) — pas de copie parallèle qui divergerait au
  // prochain ajustement.
  const heroColors = getMatchTeamColors(match.homeTeam?.name, match.awayTeam?.name)

  return (
    <div className="lmp__heroOuter">
      <button className="lmp__heroBack" onClick={() => navigate(-1)}>‹ Retour</button>

      <div
        className="mp__hero lmp__hero"
        style={{ '--lmp-hc': heroColors.home.main, '--lmp-hc2': heroColors.away.main }}
      >
        <span className="lmp__heroGlowL" aria-hidden="true" />
        <span className="lmp__heroGlowR" aria-hidden="true" />

      {/* Bandeau : championnat à gauche, statut du match à droite */}
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
          <span className="mp__hero__compName lmp__heroCompName">{compName}</span>
        </div>
        {/* ⚠️ ÉCHANGÉ avec le statut (03/09, demande utilisateur) : c'est le
            DIFFUSEUR qui occupe le coin haut droit, et le statut (date ou
            "Terminé") qui passe au centre, juste au-dessus de l'heure.
            Logique : le statut qualifie l'heure/le score, sa place est collée
            à eux — exactement comme la minute sur la page du direct. Le
            diffuseur, lui, est une info annexe, il a sa place dans le bandeau.
            Le WatchBadge est du texte simple avec une icône, sans cadre : il
            fait donc disparaître au passage l'encadré "verre dépoli" qui
            entourait la date ici (fond translucide + bordure), signalé comme
            gênant. */}
        <WatchBadge match={match} variant="hero" />
      </div>

      {/* Centre : crests + score/heure */}
      <div className="mp__hero__mid">
        <div className="mp__hero__team">
          {match.homeTeam?.crest
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="mp__hero__crest" data-team={match.homeTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{homeName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{homeName}</span>
          <FormDiamonds form={hForm} />
        </div>

        <div className="mp__hero__center">
          {/* Statut AU-DESSUS de l'heure/du score, sans cadre — même
              disposition que la minute sur la page du direct. */}
          {/* Modificateur --ft (04/09, demande utilisateur : "Terminé" en rouge)
              plutôt qu'une couleur posée sur .lmp__heroWhenLabel : cette même
              classe sert AUSSI à la date d'un match à venir ("Aujourd'hui",
              "Demain"…), qui n'a aucune raison de passer en rouge. */}
          <span className={`lmp__heroWhenLabel${isFinished ? ' lmp__heroWhenLabel--ft' : ''}`}>
            {isFinished ? 'Terminé' : formatDate(match.utcDate)}
          </span>
          {isFinished ? (
            <>
              <span className="mp__hero__score">{hs} – {as_}</span>
              {wentToPens && hPens != null && aPens != null && (
                <div className="mp__hero__pensBlock">
                  <span className="mp__hero__pensLabel">T.A.B</span>
                  <span className="mp__hero__pensScore">({hPens}-{aPens})</span>
                </div>
              )}
              {wentToAet && (
                <span className="mp__hero__aet">Après prolong.</span>
              )}
            </>
          ) : (
            <>
              <span className="mp__hero__time">{formatTime(match.utcDate)}</span>
            </>
          )}
          {/* ⚠️ AJOUT (28/08, demande utilisateur : "quand les matchs ont
              pas commencé y'a pas le badge alors qu'on le sait d'avance") :
              MatchPage.jsx est justement la page consultée AVANT le coup
              d'envoi (pas seulement une fois le match terminé) — le
              diffuseur est connu dès la programmation de la saison, pas
              besoin d'attendre que le match commence pour l'afficher.
              ⚠️ DÉPLACÉ (03/09) dans le bandeau du haut, voir plus haut. */}
        </div>

        <div className="mp__hero__team mp__hero__team--away">
          {match.awayTeam?.crest
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="mp__hero__crest" data-team={match.awayTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{awayName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{awayName}</span>
          <FormDiamonds form={aForm} />
        </div>
      </div>

      {/* Buts + cartons — sous les noms d'équipe, triés par minute. Avant : ne
          montrait que les buts ici, et l'onglet Statistiques répétait les
          mêmes buts en y ajoutant les cartons dans le Fil du match → les buts
          apparaissaient deux fois sur la page (signalé par l'utilisateur).
          Le hero montre maintenant la même liste fusionnée (buts+cartons),
          au bon endroit selon la minute. */}
      {(homeEvents.length > 0 || awayEvents.length > 0) && (
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
      )}
      </div>
    </div>
  )
}

// ── Table stats + barre couleurs d'équipe ─────────────────────────────────────
// Une ligne par stat : valeur dom. | libellé | valeur ext. (la valeur la plus
// haute mise en avant), + une piste sous la ligne partant du centre vers
// chaque camp, proportionnelle à sa part de la stat, dans la vraie couleur de
// l'équipe (demande explicite, aperçu validé avant implémentation). StatTrack
// importé depuis MatchModal.jsx : même calcul/rendu que les stats live et
// saison, pas de logique dupliquée.
function MpStatRow({ label, homeVal, awayVal, homeBetter, awayBetter, homeColor, awayColor, noCompare = false }) {
  return (
    <div className="statBar__wrap">
      <div className="mp__statRow">
        <span className={`mp__statVal${homeBetter ? ' mp__statVal--home' : ''}`} style={homeColor ? { color: homeColor } : undefined}>
          {homeVal ?? '–'}
        </span>
        <span className="mp__statLabel">{label}</span>
        <span className={`mp__statVal mp__statVal--r${awayBetter ? ' mp__statVal--away' : ''}`} style={awayColor ? { color: awayColor } : undefined}>
          {awayVal ?? '–'}
        </span>
      </div>
      <StatTrack homeVal={homeVal} awayVal={awayVal} noCompare={noCompare} />
    </div>
  )
}

// Skeleton shimmer (mêmes classes que MpStatRow) — remplace le spinner
// générique, même logique que les skeletons ajoutés dans MatchModal.jsx.
function MpStatsSkeleton() {
  return (
    <div className="mp__statsList">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="mp__statRow">
          <div className="sk" style={{ width: '1.6rem', height: '0.9rem', marginLeft: 'auto' }} />
          <div className="sk" style={{ width: '4.4rem', height: '0.6rem' }} />
          <div className="sk" style={{ width: '1.6rem', height: '0.9rem' }} />
        </div>
      ))}
    </div>
  )
}

// Skeleton pleine page (hero + onglets + stats) — remplace le spinner
// centré affiché avant que le match soit chargé (1er accès direct par URL,
// pas de state router). Reprend les mêmes classes que MatchPageHero pour
// un placement identique, donc pas de saut de layout à l'arrivée du match.
function MpPageSkeleton() {
  return (
    <div className="mp__page">
      <div className="mp__hero">
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
            <div className="sk" style={{ width: '4rem', height: '0.6rem' }} />
            <div className="sk" style={{ width: '5rem', height: '2rem', marginTop: '0.3rem' }} />
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
          <MpStatsSkeleton />
        </div>
      </div>
    </div>
  )
}

// ⚠️ BUG CORRIGÉ (constat utilisateur : "dans résultat y'a pas toutes les
// stats live qu'il y a sur livematchpage") : les 2 fonctions ci-dessous
// étaient dupliquées depuis MatchModal.jsx ("mêmes que MatchModal") mais
// figées à une version courte (6 lignes : Possession/Tirs/Tirs cadrés/
// Corners/Fautes/Hors-jeux) pendant que la version de MatchModal.jsx était
// enrichie à 19 lignes (Passes, Tacles, Interceptions, Centres, Longs
// ballons, Dégagements, Tirs contrés, Arrêts, Cartons rouges...) — le même
// jeu de stats déjà utilisé en LIVE (LiveStatsTab/ESPNStats sur
// LiveMatchPage). La donnée FIFA les avait déjà, seul l'affichage ici les
// coupait. Importées depuis MatchModal.jsx désormais (voir plus bas) au lieu
// d'une copie locale — une seule source de vérité, plus de risque de
// re-divergence entre les deux pages.

// ── Stats match terminé ───────────────────────────────────────────────────────
function MpMatchStats({ match, dataMatch }) {
  // dataMatch (voir son commentaire détaillé plus haut, calcul de `dataMatch`
  // dans MatchPage()) : même match, mais avec le vrai id football-data.org
  // résolu quand `match.id` est un id synthétique ESPN (venu du panneau
  // Résultats de l'Accueil) — indispensable pour useMatchDetail (appel FD.org
  // direct par id) et pour que le cache Redis partagé (useEspnMatchStats/
  // useFifaStats) profite de ce qui a déjà été résolu ailleurs pour ce match.
  const dm = dataMatch ?? match
  const isWC = isNationalTeamComp(match)
  const { data: fifaData,  isLoading: fifaLoading  } = useFifaStats(isWC ? dm : null, isWC, false)
  // MpMatchStats n'est rendu que pour un match déjà terminé (voir l'appelant
  // plus bas) — isFinished=true directement, stats définitives, cache jamais
  // redemandé (voir useEspnMatchStats).
  const { data: espnStatsData, isLoading: espnLoading } = useEspnMatchStats(dm, true)
  const { data: aflStats,  isLoading: aflLoading   } = useAflMatchStats(match)

  // ── Fil du match : remplacements uniquement ────────────────────────────────
  // Buts ET cartons sont désormais affichés dans le hero (MatchPageHero, qui
  // les fusionne triés par minute) — les remontrer ici faisait doublon
  // (constat utilisateur : d'abord pour les buts, puis pour les cartons
  // "vu qu'on les a déplacés dans le header"). FD.org (useMatchDetail) reste
  // l'unique source des remplacements (ESPN n'en expose aucune) — a
  // impérativement besoin du VRAI id FD.org (dm.id), pas de l'id ESPN
  // synthétique, sinon l'appel /v4/matches/{id} échoue silencieusement.
  const { detail } = useMatchDetail(dm?.id)

  const fdSubs      = detail?.substitutions ?? []
  const hasEvents   = fdSubs.length > 0
  // (`detailLoading` n'est plus lu ici depuis le retrait du message "Match
  // sans but", qui était le seul à distinguer "pas encore chargé" de
  // "vraiment aucun événement".)

  const { home: hs, away: as_ } = finalScore(match.score)
  const totalGoals = (hs ?? 0) + (as_ ?? 0)

  // ⚠️ BUG CORRIGÉ (constat utilisateur : "tir cadré 0 alors qu'il y a eu 3
  // buts" — confirmé structurellement impossible, marquer nécessite au moins
  // 1 tir cadré) : FIFA est toujours prioritaire dès qu'il renvoie QUOI QUE CE
  // SOIT (fifaRows.length > 0), même des stats à 0 alors qu'un vrai match
  // avec des buts a forcément eu des tirs cadrés — jamais vérifié avant. On
  // rejette FIFA dans ce cas précis (mais UNIQUEMENT ce cas, sans casser les
  // vrais 0-0) et on laisse la place à ESPN.
  const fifaSotSum  = (fifaData?.home?.shotsOnTarget ?? 0) + (fifaData?.away?.shotsOnTarget ?? 0)
  const fifaLooksOff = totalGoals > 0 && fifaSotSum === 0

  // ⚠️ BUG CORRIGÉ (constat utilisateur : "y'a que une partie des stats" sur
  // la finale CM 2026) : FIFA ne fournit QUE 6 champs (possession/tirs/tirs
  // cadrés/corners/fautes/hors-jeux — voir useFifaStats), jamais
  // passes/tacles/interceptions/centres/longs ballons/dégagements/tirs
  // contrés/arrêts. L'ancienne logique choisissait fifaRows EN BLOC dès qu'il
  // avait ne serait-ce qu'1 champ rempli, ce qui cachait TOUJOURS les ~12
  // champs supplémentaires qu'ESPN a bien pour ce match (vérifié sur un vrai
  // payload prod : summary.boxscore a totalPasses/totalTackles/interceptions/
  // etc pour Espagne-Argentine) — pas un problème de donnée manquante, un
  // problème de source qui en écrase une autre au lieu de les compléter.
  // Fusion CHAMP PAR CHAMP désormais : FIFA reste prioritaire pour les champs
  // qu'il connaît (plus réactif en live), ESPN comble le reste.
  const mergeTeamStats = (primary, secondary) => {
    if (!primary && !secondary) return null
    const keys = new Set([...Object.keys(primary ?? {}), ...Object.keys(secondary ?? {})])
    const out = {}
    for (const k of keys) out[k] = primary?.[k] ?? secondary?.[k] ?? null
    return out
  }
  const fifaSource = fifaLooksOff ? null : fifaData
  const mergedStats = (fifaSource?.home || fifaSource?.away || espnStatsData?.stats?.home || espnStatsData?.stats?.away)
    ? { home: mergeTeamStats(fifaSource?.home, espnStatsData?.stats?.home), away: mergeTeamStats(fifaSource?.away, espnStatsData?.stats?.away) }
    : null
  const mergedRows = fifaStatsToRows(mergedStats)
  const aflRows  = aflStatsToRows(aflStats)
  // Dernier filet de sécurité (demande explicite utilisateur) : l'instantané
  // ESPN capturé en direct (confirmFt(), voir matchStateTracker.js) si CE
  // téléphone a suivi le match en live — même source que les buteurs du hero
  // (getEspnData, déjà importé plus bas). Volontairement en dernier (avant
  // aflRows, désactivé de toute façon) : un instantané pris en direct est
  // moins fiable qu'une vraie source post-match, mais toujours mieux que rien.
  // MpMatchStats n'est rendu que pour un match déjà terminé (voir l'appelant
  // plus bas), pas besoin de re-vérifier isFinished ici.
  const cachedLive = getEspnData(match?.id)
  const cachedRows = fifaStatsToRows(cachedLive?.stats)
  const rows = mergedRows.length ? mergedRows
    : cachedRows.length ? cachedRows
    : aflRows

  const isLoading = !rows.length && ((isWC && fifaLoading) || espnLoading || aflLoading)

  return (
    <div className="mp__statsWrap">
      {/* ⚠️ RETIRÉ (02/09, demande utilisateur : "y'a 'Toulouse 0' et '1
          Lille' et 'Match' au milieu, c'est inutile") : ce bandeau répétait
          les noms des deux équipes ET le score, à quelques centimètres du
          hero qui affiche déjà exactement la même chose en bien plus gros —
          avec les blasons en plus. Le mot "Match" au centre ne désignait rien
          du tout. Les colonnes de stats juste en dessous sont déjà lisibles
          sans en-tête : chaque ligne porte son libellé au milieu et les deux
          valeurs de part et d'autre, dans le même ordre que le hero.
          Les noms d'équipe traduits ne servaient QUE à ce bandeau : ils sont
          donc supprimés avec lui (vérifié — plus aucun autre usage dans ce
          composant).

          ⚠️ RETIRÉ AUSSI : le message "Match sans but (0 – 0)". Il apparaissait
          quand il n'y avait ni remplacement ni but à lister — mais le score
          0-0 est déjà affiché en grand juste au-dessus, donc la phrase
          n'apprenait rien. Le cas "aucun remplacement mais des buts" ne
          montrait déjà rien ici, on est simplement cohérent avec ça. */}
      {hasEvents && <MatchTimeline fdSubs={fdSubs} homeId={match.homeTeam?.id} />}

      {isLoading ? (
        <MpStatsSkeleton />
      ) : rows.length > 0 ? (
        <div className="mp__statsList">
          {rows.map(r => (
            <MpStatRow key={r.label} label={r.label}
              homeVal={r.hv} awayVal={r.av}
              homeBetter={r.hBetter} awayBetter={r.aBetter}
            />
          ))}
        </div>
      ) : (
        <p className="pm__noData">Statistiques non disponibles</p>
      )}
    </div>
  )
}

// ── Stats saison (matchs à venir) — barres depuis compMatches ────────────────
// split: 'all' | 'home' | 'away' — ne garde que les matchs joués à domicile
// ou à l'extérieur par teamId (retour utilisateur : comparatif dom/ext).
function calcTeamStats(teamId, compMatches, split = 'all') {
  const matches = (compMatches ?? []).filter(m => {
    if (m.status !== 'FINISHED') return false
    const isHome = m.homeTeam?.id === teamId
    const isAway = m.awayTeam?.id === teamId
    if (!isHome && !isAway) return false
    if (split === 'home') return isHome
    if (split === 'away') return isAway
    return true
  })
  if (!matches.length) return null
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, cs = 0, btts = 0, over25 = 0
  const results = []
  matches.forEach(m => {
    const myHome = m.homeTeam?.id === teamId
    const fs = finalScore(m.score)
    const f = myHome ? fs.home : fs.away
    const a = myHome ? fs.away : fs.home
    if (f == null || a == null) return
    gf += f; ga += a
    if (a === 0) cs++
    if (f > 0 && a > 0) btts++
    if (f + a >= 3) over25++
    // Aux tirs au but, le score 120min (f/a) est TOUJOURS à égalité : le vrai
    // résultat vient de score.penalties (même convention que FormDiamonds).
    let outcome
    if (m.score?.duration === 'PENALTY_SHOOTOUT' &&
        m.score?.penalties?.home != null && m.score?.penalties?.away != null) {
      const myPens  = myHome ? m.score.penalties.home : m.score.penalties.away
      const oppPens = myHome ? m.score.penalties.away : m.score.penalties.home
      outcome = myPens > oppPens ? 'W' : 'L'
    } else {
      outcome = f > a ? 'W' : f === a ? 'D' : 'L'
    }
    if (outcome === 'W') { wins++; results.push('W') }
    else if (outcome === 'D') { draws++; results.push('D') }
    else { losses++; results.push('L') }
  })
  // ⚠️ BUG CORRIGÉ (constat utilisateur : "l'Angleterre a 4 matchs joués
  // affichés alors qu'elle en a 5" pendant qu'elle jouait déjà son 6e) :
  // "played" était calculé comme wins+draws+losses, qui EXCLUT tout match
  // FINISHED dont le score n'est pas encore pleinement renseigné côté
  // FD.org (juste après le coup de sifflet final, avant que l'API ait fini
  // de repropager le score détaillé — décalage constaté en pratique, pas
  // une erreur de comptage de notre côté). Un match FINISHED sans score
  // exploitable disparaissait alors silencieusement du compteur "Matchs
  // joués" au lieu d'être compté normalement une fois le score arrivé.
  // "played" compte maintenant tous les matchs FINISHED (peu importe si le
  // score est déjà exploitable) ; les stats qui ont besoin d'un score réel
  // (moyennes, %) restent calculées sur scoredCount, le sous-ensemble avec
  // score connu — sinon un match sans score connu tirerait ces moyennes
  // vers le bas sans y avoir contribué.
  const played     = matches.length
  const scoredCount = wins + draws + losses
  if (!played) return null

  // Série en cours (même logique que SeasonStatsSection dans MatchModal.jsx)
  let streak = 0, streakType = null
  for (let i = results.length - 1; i >= 0; i--) {
    if (streakType === null) { streakType = results[i]; streak = 1 }
    else if (results[i] === streakType) streak++
    else break
  }

  return {
    played, wins, draws, losses,
    avgFor:     scoredCount ? (gf / scoredCount).toFixed(1) : '0.0',
    avgAgainst: scoredCount ? (ga / scoredCount).toFixed(1) : '0.0',
    winPct:     scoredCount ? Math.round((wins  / scoredCount) * 100) : 0,
    bttsPct:    scoredCount ? Math.round((btts  / scoredCount) * 100) : 0,
    over25Pct:  scoredCount ? Math.round((over25/ scoredCount) * 100) : 0,
    cs,
    streak, streakType,
  }
}

// ⚠️ isLastSeason retiré d'ici (27/07, demande explicite utilisateur :
// "pas la peine de recuperer la forme recente et stat saison des dernieres
// saison... juste h2h" — et après, quand les championnats démarreront).
// Avant, ce composant gardait quand même "Forme récente" visible en
// intersaison (voir historique git) — décision explicitement annulée : les
// 2 appelants (plus bas dans ce fichier) affichent maintenant un message
// à la place de TOUT ce composant (stats ET forme) quand isLastSeason est
// vrai, donc ce composant n'a plus besoin de connaître ce cas.
function MpSeasonStats({ match, compMatches, hideForm = false }) {
  const homeId   = match.homeTeam?.id
  const awayId   = match.awayTeam?.id
  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  // Toggle Global/Domicile/Extérieur (retour utilisateur) — chaque équipe
  // est recalculée sur ses seuls matchs à domicile ou à l'extérieur.
  const [split, setSplit] = useState('all')

  const h = calcTeamStats(homeId, compMatches, split)
  const a = calcTeamStats(awayId, compMatches, split)
  // Section masquée seulement si AUCUNE donnée n'existe même en vue globale
  // (sinon un simple clic sur "Domicile"/"Extérieur" pourrait faire
  // disparaître toute la section pour une équipe encore sans match dans ce
  // contexte précis, alors que "Global" en a).
  if (split === 'all' && !h && !a) return null

  function formSection() {
    return (
      <div className="pm__section modal__seasonForm">
        <h3 className="pm__sectionTitle">Forme récente</h3>
        <div className="pm__formGrid">
          <div className="pm__formCol">
            <p className="pm__formTeamName">{homeName}</p>
            <TeamFormTable teamId={homeId} compMatches={compMatches} />
          </div>
          <div className="pm__formDivider" />
          <div className="pm__formCol">
            <p className="pm__formTeamName">{awayName}</p>
            <TeamFormTable teamId={awayId} compMatches={compMatches} />
          </div>
        </div>
      </div>
    )
  }

  const streakColor = type => type === 'W' ? '#4ade80' : type === 'D' ? '#facc15' : '#f87171'
  const streakLabel = s => !s?.streak ? '–' : `${s.streak}${s.streakType === 'W' ? 'V' : s.streakType === 'D' ? 'N' : 'D'}`

  const rows = [
    { label: 'Matchs joués',            hv: h?.played,                 av: a?.played,                 noCompare: true },
    { label: 'Buts marqués / match',    hv: h?.avgFor,                 av: a?.avgFor,                 hRaw: parseFloat(h?.avgFor),  aRaw: parseFloat(a?.avgFor),  higher: true  },
    { label: 'Buts encaissés / match',  hv: h?.avgAgainst,             av: a?.avgAgainst,             hRaw: parseFloat(h?.avgAgainst),aRaw: parseFloat(a?.avgAgainst),higher: false },
    { label: '% Victoires',             hv: h ? `${h.winPct}%` : '–',  av: a ? `${a.winPct}%` : '–', hRaw: h?.winPct,              aRaw: a?.winPct,              higher: true  },
    { label: 'Clean sheets',            hv: h?.cs,                     av: a?.cs,                     hRaw: h?.cs,                  aRaw: a?.cs,                  higher: true  },
    { label: 'Les deux marquent %',     hv: h ? `${h.bttsPct}%` : '–', av: a ? `${a.bttsPct}%` : '–',hRaw: h?.bttsPct,             aRaw: a?.bttsPct,             higher: true  },
    { label: '+2.5 buts %',             hv: h ? `${h.over25Pct}%` : '–',av: a ? `${a.over25Pct}%` : '–',hRaw: h?.over25Pct,       aRaw: a?.over25Pct,           higher: true  },
    { label: 'Série en cours',          hv: streakLabel(h), av: streakLabel(a), noCompare: true, hColor: h ? streakColor(h.streakType) : null, aColor: a ? streakColor(a.streakType) : null },
  ]

  return (
    <div className="mp__statsWrap">
      {/* ⚠️ RETIRÉ (02/09, demande utilisateur, même raison que le bandeau des
          stats de match juste au-dessus dans ce fichier) : les noms d'équipe y
          étaient répétés une 3e fois sur la page (hero + sous-onglets + ici),
          et le mot "Saison" au centre disait ce que l'onglet "Stats saison"
          déjà sélectionné annonce à 20 pixels de là. Les lignes en dessous
          portent chacune leur libellé au milieu et une valeur de chaque côté,
          dans le même ordre que le hero — le repérage ne dépendait pas de cet
          en-tête.
          Le sélecteur Global/Domicile/Extérieur juste en dessous devient donc
          le premier élément du bloc, ce qui rapproche le réglage de ce qu'il
          règle. */}
      <div className="homeAwayToggle">
        <button className={`homeAwayToggle__btn${split === 'all' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('all')}>Global</button>
        <button className={`homeAwayToggle__btn${split === 'home' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('home')}>Domicile</button>
        <button className={`homeAwayToggle__btn${split === 'away' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('away')}>Extérieur</button>
      </div>

      <div className="mp__statsList">
        {rows.map(({ label, hv, av, hRaw, aRaw, higher, noCompare, hColor, aColor }) => {
          const hBetter = !noCompare && hRaw != null && aRaw != null && (higher ? hRaw > aRaw : hRaw < aRaw)
          const aBetter = !noCompare && hRaw != null && aRaw != null && (higher ? aRaw > hRaw : aRaw < hRaw)
          return (
            <MpStatRow key={label} label={label}
              homeVal={hv ?? '–'} awayVal={av ?? '–'}
              homeBetter={hBetter} awayBetter={aBetter}
              noCompare={noCompare}
              homeColor={hColor}
              awayColor={aColor}
            />
          )
        })}
      </div>

      {/* Forme récente — dernier match joué de chaque équipe (score, W/D/L,
          date), même bloc que l'onglet "Avant-match". Masqué quand
          PreMatchSection est rendu juste après (matchs à venir) : il a déjà
          son propre bloc Forme récente, l'afficher ici aussi le dupliquait. */}
      {!hideForm && formSection()}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function MatchPage() {
  const { matchId } = useParams()
  const navigate    = useNavigate()
  const location    = useLocation()

  const stateMatch = location.state?.match ?? null
  const { data: fetchedMatch, isLoading } = useMatchData(matchId, stateMatch)
  const rawMatch = stateMatch ?? fetchedMatch

  // Même correction que dans MatchPageHero — voir le commentaire là-bas.
  const isFinished = rawMatch?.status === 'FINISHED' || (rawMatch?.id != null && getMatchState(rawMatch.id).ft === true)
  const compId = rawMatch?.competition?.code ?? null

  // compMatches est nécessaire même pour un match terminé désormais : le
  // sous-onglet "Stats saison" en a besoin (avant, seuls les matchs à venir
  // le fetchaient, ce qui rendait "Stats saison" impossible pour un match FT).
  const { formMap, compMatches, isLastSeason, isLoading: formLoading } = useTeamForm(compId)

  // ⚠️ AJOUT (constat utilisateur, 26/07 : "quand je clique sur un match à
  // venir dans Accueil y'a aucune donnée, mais le même match cliqué depuis
  // Programme ça marche") : voir le commentaire détaillé sur resolveFdTeamId
  // (matchUtils.js) — un match sourcé ESPN (les 6 grands championnats dans
  // Accueil) a des homeTeam.id/awayTeam.id dans le référentiel ESPN, pas
  // FD.org, ce qui casse tout ce qui filtre compMatches par id (Forme
  // récente, Stats saison, Compos probables...) rien que pour CES matchs.
  // On résout l'id réel une seule fois ici, dès que compMatches est chargé —
  // tout le reste de cette page continue de lire match.homeTeam.id/
  // match.awayTeam.id normalement, sans rien savoir de ce contournement.
  //
  // ⚠️ AJOUT `scheduledMatches` (27/07, demande explicite utilisateur : "le
  // h2h y'a moins de match que fd.org... si je vais dans programme faut que
  // ça soit deja affiché... pas besoin de faire deux requetes vu que c la
  // meme chose") : `compMatches` (useTeamForm, ci-dessus) est UNIQUEMENT des
  // matchs FINISHED (forme/stats/pronostic) — en intersaison, c'est même la
  // saison PRÉCÉDENTE (repli isLastSeason) : le match précis affiché ici (à
  // venir, nouvelle saison) n'y figure jamais littéralement, seulement
  // d'éventuelles rencontres passées entre les 2 mêmes équipes. resolveFdMatchId
  // (useH2HRows plus bas) peut donc échouer à retrouver le match exact, et
  // Accueil retombe sur un historique plus court que Programme pour LE MÊME
  // match. Programme (Match.jsx), lui, utilise useMatches(compId,'SCHEDULED')
  // — la vraie liste FD.org des matchs à venir de la compétition, CONTIENT
  // donc ce match précis avec son vrai id. Réutilisé ici avec EXACTEMENT le
  // même hook/queryKey (voir useMatchs.js, cache RAW partagé Programme/
  // Résultats) : si Programme a déjà été visité pour cette compét, React
  // Query sert le résultat déjà en cache, aucune requête FD.org
  // supplémentaire — sinon un seul appel, strictement nécessaire de toute
  // façon pour retrouver ce match précis.
  const { matches: scheduledMatches } = useMatches(compId, 'SCHEDULED')
  const resolveMatches = useMemo(
    () => [...(scheduledMatches ?? []), ...compMatches],
    [scheduledMatches, compMatches]
  )

  const match = useMemo(() => {
    if (!rawMatch || !resolveMatches?.length) return rawMatch
    // ⚠️ AJOUT `{ loose: true }` (audit noms ESPN/FD.org) : cette résolution
    // était en strict clubNameMatch (préfixe uniquement) — trouve "Le Havre
    // AC"→"Le Havre" (suffixe en trop côté ESPN) mais PAS "AS Monaco"→"Monaco"
    // ni "Manchester City"→"Man City" (mot en trop en PRÉFIXE côté ESPN).
    // looseTeamNameMatch (translateTeam + normalize) couvre ces cas.
    // ⚠️ AJOUT `strict:true` (16/08, constat utilisateur : losange "forme
    // récente" d'une AUTRE équipe affiché — même bug que MatchCard.jsx/
    // MatchPoster.jsx, voir le commentaire détaillé sur resolveFdTeamId dans
    // matchUtils.js) : sans correspondance de nom fiable, on ne devine plus
    // — homeId/awayId restent `null` plutôt que l'id ESPN brut (qui peut
    // coïncider par hasard avec l'id FD.org d'un club différent une fois
    // utilisé comme clé de formMap/compMatches). MatchPageHero a besoin du
    // vrai id ESPN pour rattacher buteurs/cartons (espnScorers/espnCards,
    // eux-mêmes en id ESPN) — reçoit `rawHomeId`/`rawAwayId` séparément
    // (voir plus bas) pour ça, jamais l'id résolu ici.
    const homeId = resolveFdTeamId(rawMatch.homeTeam, resolveMatches, { loose: true, strict: true })
    const awayId = resolveFdTeamId(rawMatch.awayTeam, resolveMatches, { loose: true, strict: true })
    if (homeId === rawMatch.homeTeam?.id && awayId === rawMatch.awayTeam?.id) return rawMatch
    return {
      ...rawMatch,
      homeTeam: { ...rawMatch.homeTeam, id: homeId },
      awayTeam: { ...rawMatch.awayTeam, id: awayId },
    }
  }, [rawMatch, resolveMatches])

  // ⚠️ AJOUT `dataMatch` (21/08, constat utilisateur : "des fois j'ai un bug
  // genre quand je clique sur un match [depuis le panneau Résultats de
  // l'Accueil] ça a du mal à afficher le déroulement du match ou les stats
  // live alors que dans la page Résultats j'ai pas de problème" + demande
  // explicite de partage de données entre les deux entrées) : un match
  // affiché par ResultPanel (Accueil, useRecentDaysMatches → fetchEspnPortion)
  // porte un id SYNTHÉTIQUE `espn-{comp}-{eventId}` (voir espnAdapter.js,
  // normalizeEvent) — jamais un vrai id football-data.org — alors que
  // Resultat.jsx (page Résultats) source ses matchs via useMatches (FD.org
  // direct), toujours avec le vrai id numérique. `match.id` synthétique
  // cassait DEUX choses en aval, vérifiées dans le code : (1) useMatchDetail
  // (déroulement/remplacements, dans MpMatchStats ci-dessous) appelle
  // directement /v4/matches/{id} — un id non-numérique fait échouer cet appel
  // FD.org silencieusement, d'où "déroulement" toujours vide venant
  // d'Accueil ; (2) useLineups/useEspnMatchStats/useFifaStats envoient
  // `fdMatchId={match.id}` comme clé de cache Redis PARTAGÉE côté serveur
  // (api/espn.js lookupMap, api/fifa-lineups.js) — avec un id différent de
  // celui utilisé par Résultats/Programme/cf-worker pour CE MÊME match réel,
  // les deux entrées ne partagent jamais ce cache déjà chaud, exactement le
  // partage manquant demandé. resolveFdMatchId (matchUtils.js) — déjà
  // éprouvé pour résoudre l'Historique H2H dans ce même cas de figure —
  // retrouve le vrai id FD.org via la paire d'équipes + date la plus proche
  // dans resolveMatches. Volontairement une copie SÉPARÉE (`dataMatch`), pas
  // une réécriture de `match.id` lui-même : match.id reste le référentiel
  // ESPN utilisé partout ailleurs sur cette page (getMatchState/ft,
  // getEspnData — le suivi live/`Terminé` déjà stabilisé cette session) —
  // seuls les hooks de données FD.org/ESPN partagées reçoivent dataMatch.
  // Aucun changement pour un match déjà sourcé FD.org (Résultats/Programme) :
  // resolveFdMatchId renvoie alors rawId tel quel (isRealFdMatchId), donc
  // dataMatch === match, strictement rien ne change pour ce chemin déjà fiable.
  const dataMatch = useMemo(() => {
    if (!match) return match
    const resolvedId = resolveFdMatchId(match, resolveMatches, { loose: true })
    return (resolvedId != null && resolvedId !== match.id) ? { ...match, id: resolvedId } : match
  }, [match, resolveMatches])

  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]

  // ⚠️ AJOUT (badge ballon à côté du buteur dans la compo, demande explicite)
  // : même appel que dans MatchPageHero (React Query dédup par queryKey donc
  // aucun fetch réseau supplémentaire) — nécessaire ICI pour transmettre les
  // buteurs à ComposTab, qui ne fait pas ce fetch lui-même.
  const { espnData: composEspnData } = useEspnMatchDetail(
    isFinished ? match : null,
    match?.competition?.id,
    isFinished
  )
  const composScorers = composEspnData?.scorers ?? []
  const homeShort = translateTeam(match?.homeTeam?.shortName || match?.homeTeam?.name || '?')
  const awayShort = translateTeam(match?.awayTeam?.shortName || match?.awayTeam?.name || '?')
  // Thème dynamique — mêmes couleurs anti-collision que le hero (getMatchGradient),
  // posées en CSS vars sur la page pour teinter les onglets.
  const themeVars = getMatchThemeVars(match?.homeTeam?.name || homeShort, match?.awayTeam?.name || awayShort)

  // Historique des confrontations — masqué tant qu'aucune confrontation
  // connue n'est confirmée (demande explicite : pas de bouton si y'en a pas).
  // ⚠️ ÉVOLUTION (demande explicite) : n'est plus un onglet top-level séparé,
  // replié comme 3e sous-onglet dans StatsSubTabs (voir MatchModal.jsx) —
  // showH2HTab pilote maintenant seulement l'affichage du bouton "Historique"
  // à l'intérieur de "Statistiques".
  // delayMs=6_000 (26/07, audit anti-429) : useMatchDetail(match.id), plus
  // haut sur cette page, tape déjà FD.org au même montage — voir commentaire
  // détaillé dans useMatchDetail.js (useH2H).
  // resolveMatches (pas compMatches) : voir commentaire détaillé plus haut —
  // nécessaire à resolveFdMatchId (matchUtils.js, appelé par useH2HRows) pour
  // retrouver le vrai id FD.org du match affiché, y compris en intersaison.
  // ⚠️ AJOUT `useH2HHistory` (constat utilisateur, 20/08 : "Historique"
  // absent sur des rivalités connues — Everton-Crystal Palace, Toulouse-Lyon,
  // Sevilla-Bilbao — cette page n'utilisait pourtant PAS encore ce hook,
  // contrairement à MatchDuJourCard.jsx/MatchPoster.jsx qui l'avaient déjà
  // pour la cote de prono) : resolveMatches (compMatches + scheduledMatches)
  // perd toute trace des saisons précédentes dès le 1er match FINISHED de la
  // nouvelle saison (`hasFinished`, fetchClubMatchesRaw dans useMatchs.js) —
  // bien avant que les 2 équipes d'un match donné n'aient eu l'occasion de se
  // réaffronter CETTE saison. h2hHistory (2 saisons de PLUS, 1 seul fetch par
  // compétition, indépendant de fetchClubMatchesRaw) comble ce trou — fusionné
  // ici pour que resolveFdMatchId (le head2head AFFICHÉ) en profite aussi.
  const h2hHistory = useH2HHistory(compId, resolveMatches)
  const h2hPool = (resolveMatches?.length || h2hHistory?.length) ? [...resolveMatches, ...h2hHistory] : resolveMatches
  const { rows: h2hRows, isLoading: h2hLoading } = useH2HRows(match, h2hPool, 6_000, { looseTeamMatch: true, extendedH2H: true })
  // ⚠️ RETIRÉ `!h2hLoading` (27/07, demande explicite utilisateur : "h2h
  // arrive direct la première fois sans que ça mette plusieurs secondes") :
  // useH2HRows retombe déjà, SANS requête supplémentaire, sur les
  // confrontations de la saison en cours (compH2H) tant que le vrai
  // historique FD.org n'est pas encore arrivé — attendre `!h2hLoading` avant
  // de montrer l'onglet cachait cette donnée déjà disponible pour rien.
  // L'onglet apparaît maintenant dès qu'il y a QUELQUE CHOSE à montrer (même
  // partiel), et son contenu (H2HTabContent) se met à jour tout seul avec
  // l'historique complet dès qu'il arrive.
  const showH2HTab = h2hRows.length > 0
  const TABS = ['statistiques', 'compos', 'classement']

  const [activeTab, setActiveTab] = useState('statistiques')
  const [tabDir, setTabDir]       = useState(null)
  // Sous-onglet dans "Statistiques" : Stats live (récap du match, uniquement
  // si terminé) / Stats saison / Historique (si dispo). Avant le coup
  // d'envoi, pas de "Stats live" → on démarre sur "saison".
  const [statsView, setStatsView] = useState(isFinished ? 'live' : 'saison')

  const goTab = (t, dir) => { setTabDir(dir); setActiveTab(t) }

  const swipe = useSwipe(
    () => {
      const i = TABS.indexOf(activeTab)
      if (i < TABS.length - 1) goTab(TABS[i + 1], 'left')
    },
    () => {
      const i = TABS.indexOf(activeTab)
      if (i > 0) goTab(TABS[i - 1], 'right')
      else navigate(-1)
    }
  )

  if (isLoading || !match) {
    return <MpPageSkeleton />
  }

  return (
    <div className="mp__page" style={themeVars}>

      {/* Hero plein-écran avec gradient */}
      <MatchPageHero match={match} navigate={navigate} hForm={hForm} aForm={aForm} rawHomeId={rawMatch?.homeTeam?.id} />

      <div className="mp__wrap">
        <div className="mp__body" ref={swipe.ref}>

          {/* Onglets */}
          <div className="mp__tabs">
            {TABS.map(t => (
              <button
                key={t}
                className={`mp__tab${activeTab === t ? ' mp__tab--active' : ''}`}
                onClick={() => goTab(t, null)}
              >
                {t === 'statistiques' ? 'Statistiques'
               : t === 'compos'      ? 'Compos'
               :                       'Classement'}
              </button>
            ))}
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
            {activeTab === 'statistiques' && (
              isFinished
                ? <>
                    <StatsSubTabs view={statsView} onChange={setStatsView} showHistorique={showH2HTab} />
                    {/* Pronostic des fans + courbe de bascule — sous les
                        onglets Stats Live/Stats Saison, au-dessus du
                        contenu des stats (remplace l'ancienne barre de
                        proba algorithmique, déjà visible sur l'Accueil
                        via MatchPoster). */}
                    {statsView === 'live'       ? <MpMatchStats match={match} dataMatch={dataMatch} />
                   : statsView === 'historique' ? <H2HTabContent match={match} rows={h2hRows} isLoading={h2hLoading} />
                   : (isLastSeason || compMatches.length === 0) ? <p className="pm__noData">Stats saison et forme récente disponibles dès le début de la saison</p>
                   :                              <MpSeasonStats match={match} compMatches={compMatches} />
                    }
                  </>
                : formLoading
                  ? <MpStatsSkeleton />
                  : <>
                      {/* Sous-onglets seulement si Historique dispo — pas de
                          "Stats live" avant le coup d'envoi (rien à
                          récapituler), donc juste Stats saison / Historique. */}
                      {showH2HTab && (
                        <StatsSubTabs view={statsView} onChange={setStatsView} showLive={false} showHistorique />
                      )}
                      {statsView === 'historique' && showH2HTab
                        ? <H2HTabContent match={match} rows={h2hRows} isLoading={h2hLoading} />
                        : (isLastSeason || compMatches.length === 0)
                        // ⚠️ AJOUT (27/07, demande explicite utilisateur : "comme
                        // la les championnat ont pas commencé pas la peine de
                        // recuperer la forme recente et stat saison des dernieres
                        // saison... juste h2h... et après on affichera forme
                        // recente et stat saison quand les championnat
                        // debuteront") : compMatches vient alors du repli "saison
                        // précédente" de useTeamForm (voir isLastSeason,
                        // useTeamForm.js) — ni les stats ni la forme d'une saison
                        // déjà terminée ne sont affichées, seul l'Historique
                        // (useH2HRows, ci-dessus, inchangé) reste disponible.
                        // Redevient `false` automatiquement (voir useTeamForm.js)
                        // dès les premiers vrais matchs de la nouvelle saison —
                        // rien à modifier ici quand les championnats démarreront.
                        // ⚠️ AJOUT `|| compMatches.length === 0` (30/07, constat
                        // utilisateur : onglet Statistiques totalement vide/noir
                        // pour des matchs à venir, ex. Toulouse-Lyon) : isLastSeason
                        // peut être `false` alors que compMatches est quand même
                        // vide (ex. cas limite où même le repli saison précédente
                        // échoue, voir bug NaN corrigé dans useTeamForm.js) — dans
                        // ce cas MpSeasonStats retourne `null` (aucune donnée pour
                        // calcTeamStats) ET PreMatchSection ne rend rien non plus
                        // (compMatches vide) → écran vide sans aucun message. Ce
                        // garde-fou garantit qu'un message reste TOUJOURS visible
                        // dès que compMatches est vide, quelle qu'en soit la cause.
                        ? <p className="pm__noData">Stats saison et forme récente disponibles dès le début de la saison</p>
                        : <>
                            {/* Pronostic des fans — tout en haut, avant Stats saison
                                (pas de tabs Stats Live/Stats Saison avant le
                                coup d'envoi, donc pas de raison de le descendre). */}
                            <MpSeasonStats
                              match={match}
                              compMatches={compMatches}
                              hideForm
                            />
                            <PreMatchSection
                              match={match}
                              compMatches={compMatches}
                              hideStats
                            />
                          </>
                      }
                    </>
            )}
            {/* compMatches transmis même pour un match terminé : nécessaire au
                fallback "compositions probables" de ComposTab (dernier XI
                connu), maintenant aussi actif après-coup si la vraie compo
                n'a jamais pu être récupérée. */}
            {activeTab === 'compos'     && <ComposTab match={match} dataMatch={dataMatch} compMatches={compMatches} scorers={composScorers} />}
            {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
          </div>
        </div>
      </div>
    </div>
  )
}
