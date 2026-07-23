import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import './../match.css'
import './../compHeader.css'
import { COMPETITIONS, DOMESTIC_CUPS } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useMatches } from '../hooks/useMatchs'
import { useWcKnockout, useCupKnockout, getKnockoutTeamOverrides, applyKnockoutTeamOverrides } from '../hooks/useWcKnockout'
import { GroupModal } from './GroupModal'
import { usePersistedState } from '../hooks/usePersistedState'
import { FavStarBadge } from './FavStarBadge'
import { useFavoriteClubs } from '../hooks/useFavoriteClubs'
import { getTeamColor } from '../data/teamPhotos'
import { isNationalTeamComp } from '../utils/matchUtils'

/* ═══════════════════════════════════════════════════════════════
   BRACKET SVG VIEW — layout mathématique pur, zéro DOM query
   Les positions sont calculées depuis des constantes fixes.
   Défini AU NIVEAU MODULE pour éviter tout remount inutile.
   ═══════════════════════════════════════════════════════════════ */
// Largeur de card compacte : SEULEMENT le drapeau, plus aucun texte (ni nom
// complet, ni code 3 lettres). Historique : nom complet → beaucoup trop
// large (zoom ~0.35x, texte 2.6-3px, illisible) ; code 3 lettres → mieux
// mais toujours petit (zoom ~0.74x, ~7px) et jugé "pas ouf" par l'utilisateur
// à l'usage. En retirant TOUT texte des cards de tour normal, chaque colonne
// n'a plus qu'à loger un drapeau (le nom complet reste dispo via l'attribut
// title au tap-maintenu) : le tableau logique redescend à ~444px au lieu de
// ~484px, ET surtout le drapeau peut occuper presque toute la largeur de la
// card au lieu de partager la place avec du texte → rendu final nettement
// plus grand malgré un zoom similaire. Un drapeau seul reste identifiable
// (c'est déjà le repère visuel principal), contrairement à 3 lettres minuscules.
// Largeur de card : ATTENTION à l'équilibre largeur/hauteur du zoom
// fit-to-screen (voir plus bas) — au tour précédent, BK_CARD_GAP=30 avait
// rendu le tableau bloquant en HAUTEUR plutôt qu'en largeur, ce qui laissait
// une marge inutilisée sur les côtés (signalé par l'utilisateur : "on a de
// la place sur les côtés"). En rééquilibrant (gap vertical réduit + cards un
// peu plus larges), le zoom redevient bloquant en LARGEUR → le tableau
// utilise vraiment toute la largeur dispo à l'écran, ET les drapeaux (qui
// scalent avec BK_CARD_W) en profitent aussi.
const BK_CARD_W_MOBILE = 36
// Card de la FINALE (et de la petite finale) : volontairement plus large que
// les cards de tour normal — c'est le point de convergence du tableau, elle
// doit se voir davantage (demande explicite : la finale "en plus gros").
const BK_FINAL_W_MOBILE = 62

// ── Variante DESKTOP (≥900px, voir isDesktop dans Matchs()) ──
// Sur mobile le tableau est volontairement compact (drapeau seul, zoom
// fit-to-screen) faute de place. Sur desktop il y a largement la place
// d'afficher le nom complet de chaque équipe à côté du drapeau, avec des
// cards nettement plus larges — demande explicite : "un tableau différent
// et bien mieux vu qu'on a plus de place". Ces constantes remplacent les
// BK_* ci-dessus dans BracketSvgView quand isDesktop=true (voir CARD_W,
// FINAL_W etc. calculés en tête de la fonction) ; la logique de zoom
// fit-to-screen existante n'a pas besoin de changer, elle s'adapte déjà
// dynamiquement à TOTAL_W/TOTAL_H quels qu'ils soient.
// Agrandi une 1ère fois (176→216 etc.) : retour utilisateur après premier
// déploiement — "encore de la place, on voit pas trop bien". Combiné au
// zoom fit-to-screen qui peut désormais dépasser 1 en desktop (voir
// BK_ZOOM_CAP_DESKTOP plus bas), le tableau remplit vraiment l'espace dispo
// au lieu de rester à sa taille naturelle quand l'écran est très large.
const BK_CARD_W_DESKTOP   = 216
const BK_FINAL_W_DESKTOP  = 270
const BK_CONN_W_DESKTOP   = 40
const BK_CARD_GAP_DESKTOP = 26
const BK_HDR_H_DESKTOP    = 40
// Le zoom fit-to-screen était plafonné à 1 (jamais agrandi au-delà de la
// taille naturelle des cards) — pertinent en mobile (la taille naturelle
// est déjà celle voulue), mais pas en desktop : sur un grand écran, la
// taille naturelle des cards laisse une large marge vide inutilisée. En
// autorisant le zoom desktop à monter jusqu'à 1.6, le tableau grandit pour
// occuper l'espace vraiment dispo, tout en restant borné par
// availW/TOTAL_W et availH/TOTAL_H (donc jamais de débordement).
const BK_ZOOM_CAP_DESKTOP = 1.6
// Hauteur de card : mesurée via sonde (fiable, gère les variations de
// métriques de fonte/rendu d'image selon l'appareil) plutôt que devinée à la
// main — même principe que précédemment. Fallback plus généreux qu'avant
// car le drapeau occupe maintenant plus de place dans la card.
const BK_CARD_H_FALLBACK = 50
const BK_CARD_H_SAFETY = 4
// Marge verticale entre le bas d'une card et le haut de la suivante —
// réduite (30→16) pour rester bloquant en LARGEUR plutôt qu'en hauteur (voir
// commentaire BK_CARD_W). Reste plus généreuse que la toute 1ère version
// compacte (8) : un compromis, pas un simple retour en arrière.
const BK_CARD_GAP_MOBILE = 16
// Largeur de la zone connecteur entre rounds. Réduite (12→8) : les libellés
// de tour sont maintenant très courts (16e/8e/4e/2e, voir BK_SHORT_LABELS)
// donc beaucoup moins de risque de chevauchement entre chips voisines — cet
// espace récupéré réduit TOTAL_W, ce qui fait mécaniquement grandir le zoom
// fit-to-screen (donc les cards/drapeaux) puisque le zoom est bloquant en
// LARGEUR (voir commentaire BK_CARD_W_MOBILE).
const BK_CONN_W_MOBILE = 8
// Hauteur de l'en-tête de round (titre) — libellés courts (voir
// BK_SHORT_LABELS), tiennent sur 1 ligne. Le titre de la finale n'est PLUS
// dans cette rangée (voir BK_FINAL_LABEL_H_MOBILE) : demande explicite de le
// mettre au niveau de la card de la finale plutôt que tout en haut.
// 16→18 : suit l'agrandissement du texte des chips (bracket__roundTitle
// 0.38rem→0.58rem dans match.css), pour ne pas les couper verticalement.
const BK_HDR_H_MOBILE  = 18
// Espace réservé au-dessus de la card de la finale pour son propre label
// "🏆 FINALE" — resserré pour que le label reste visuellement "accroché" à
// sa card plutôt que de flotter avec un grand vide entre les deux.
const BK_FINAL_LABEL_H_MOBILE = 16
// Marge horizontale de sécu de part et d'autre du tableau (débordement du
// titre de tour centré — voir bracket__roundTitle).
const BK_PAD_X = 3

// Libellés COURTS pour les en-têtes de colonne du bracket compact — pas les
// mêmes que KNOCKOUT_LABELS (useWcKnockout.js), qui restent complets partout
// ailleurs dans l'app (navigation "Par journée", badges, etc.). Ici la
// colonne ne fait que 44px de large : "Seizièmes de finale" n'y tient pas.
// Raccourcis encore plus (16èmes/8èmes/Quarts/Demies → 16e/8e/4e/2e, sur le
// modèle "8e/4e/2e" demandé) : libère de la largeur dans chaque colonne pour
// pouvoir réduire BK_CONN_W (voir plus haut) et donc grossir le reste.
const BK_SHORT_LABELS = {
  LAST_32:        '1/16',
  LAST_16:        '1/8',
  QUARTER_FINALS: '1/4',
  SEMI_FINALS:    '1/2',
  FINAL:          'Finale',
  THIRD_PLACE:    '3e place',
}
const _shortLabel = (round) => BK_SHORT_LABELS[round.stage] ?? round.label

// Card-sonde : mesure la hauteur réelle du composant BkCard (2 lignes de
// drapeau) tel qu'il sera vraiment rendu (fonte/padding PWA réels).
const BK_PROBE_MATCH = {
  status: 'SCHEDULED',
  utcDate: new Date().toISOString(),
  homeTeam: { name: 'Argentine', shortName: 'Argentine', tla: 'ARG' },
  awayTeam: { name: 'Allemagne', shortName: 'Allemagne', tla: 'GER' },
  score: { fullTime: { home: null, away: null } },
}

// Formatage date/heure — utilisé par MatchRow (vue "Par journée"), PAS par
// BkCard (qui n'affiche plus ni date ni heure depuis son passage en version
// compacte). Supprimées par erreur lors de ce passage en compact — elles
// étaient encore utilisées ailleurs dans ce fichier, d'où le crash
// "_fmtD is not defined" qui faisait planter toute l'appli au chargement de
// Programme (aucune Error Boundary dans App.jsx → un throw ici démonte tout
// l'arbre React, navbar comprise). Restaurées à l'identique.
const _fmtH = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })
const _fmtD = (d) => {
  const today    = new Date(); today.setHours(0,0,0,0)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const date     = new Date(d); date.setHours(0,0,0,0)
  if (date.getTime() === today.getTime())    return `Aujourd'hui`
  if (date.getTime() === tomorrow.getTime()) return `Demain`
  return new Date(d).toLocaleDateString('fr-FR', { weekday:'short', day:'2-digit', month:'short' })
}

const teamName = (team) =>
  team?.name ? translateTeam(team.shortName || team.name) : 'À déterminer'

/* Ligne de match (poules + journée) — définie AU NIVEAU MODULE (comme
   BracketSvgView plus haut) : sinon, recréée à chaque render de Matchs()
   (ex: input recherche, ticker, refetch), React perd l'identité du composant
   et démonte/remonte tous les <img> crest → flicker/rechargement visible des
   drapeaux à chaque re-render (constat utilisateur : "ça fait comme un
   refresh à chaque fois").
   Pas de loading="lazy" sur les crests de cette page (ici et plus bas) : même
   raison que sur Résultat — la page est démontée/remontée en entier à chaque
   retour depuis /match/:id (comportement normal du routeur), donc les <img>
   sont recréées à chaque fois. Avec "lazy", même une image déjà en cache
   navigateur repasse par l'IntersectionObserver avant de s'afficher → flash
   "vide → image" à chaque retour (constat utilisateur, même bug que sur
   Résultat). Les listes ici restent courtes, le coût eager est négligeable. */
function MatchRow({ match, index, inModal = false }) {
  const navigate = useNavigate()
  const { isFavorite } = useFavoriteClubs()
  const homeIsFav = isFavorite(match.homeTeam?.id)
  const awayIsFav = isFavorite(match.awayTeam?.id)
  const isFav = homeIsFav || awayIsFav
  // Si les 2 équipes sont favorites, priorité à domicile pour la couleur du badge.
  const favColor = isFav
    ? getTeamColor((homeIsFav ? match.homeTeam : match.awayTeam)?.shortName || (homeIsFav ? match.homeTeam : match.awayTeam)?.name)
    : null
  const isUpcoming = match.status === 'SCHEDULED' || match.status === 'TIMED'
  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)

  return (
    <div
      className={`matchs__match ${inModal ? 'matchs__match--modal' : ''}${isUpcoming ? ' matchs__match--upcoming' : ''}`}
      style={{ borderTop: index === 0 ? 'none' : undefined }}
      onClick={() => navigate(`/match/${match.id}`, { state: { match } })}
    >
      {isFav && <FavStarBadge variant="row" color={favColor} />}
      {match.isCup && <span className="matchs__cupBadge">{match.competition?.name}</span>}
      <span className="matchs__scoreDate">{_fmtD(match.utcDate)}</span>
      <div className="matchs__team matchs__team--home">
        {match.homeTeam.crest && (
          <div className="matchs__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="matchs__crest" data-team={match.homeTeam?.name}
            onError={e => e.target.style.display = 'none'} /></div>
        )}
        <span className="matchs__teamName">{teamName(match.homeTeam)}</span>
      </div>
      <div className="matchs__score">
        <span className="matchs__scoreHour">{_fmtH(match.utcDate)}</span>
      </div>
      <div className="matchs__team matchs__team--away">
        {match.awayTeam.crest && (
          <div className="matchs__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="matchs__crest" data-team={match.awayTeam?.name}
            onError={e => e.target.style.display = 'none'} /></div>
        )}
        <span className="matchs__teamName">{teamName(match.awayTeam)}</span>
      </div>
    </div>
  )
}
const _name = (t) => t?.name ? translateTeam(t.shortName || t.name) : 'À venir'

// Card compacte pour le bracket : SEULEMENT le drapeau (plus de nom, plus de
// code 3 lettres, plus de score ni date/heure — le nom complet reste dispo
// via l'attribut title au tap-maintenu/survol). Historique du retrait
// progressif du texte : nom complet → illisible une fois zoomé pour tenir
// sur un téléphone ; code 3 lettres → mieux mais encore petit et jugé "pas
// ouf" à l'usage ; drapeau seul → chaque colonne est plus étroite (le
// drapeau n'a plus à partager la largeur avec du texte) donc le zoom global
// nécessaire est moins agressif, ET le drapeau lui-même peut occuper une
// bien plus grande part de la card → rendu final nettement plus grand. Le
// vainqueur/perdant reste visible via la même mise en avant (fond vert /
// opacité réduite) que dans les cards détaillées, et un match en cours
// garde son liseré rouge pulsant (bracket__card--live).
// cardH: hauteur mini imposée (px). `null` = mode sonde → contenu naturel.
// big: true pour la card de la finale/petite finale — mise en avant,
// drapeaux plus grands (voir bracket__card--big dans match.css).
function BkCard({ m, style, onSelect, cardH, big = false, desktop = false, isCountry = true }) {
  const fin  = m.status === 'FINISHED'
  const live = m.status === 'IN_PLAY' || m.status === 'PAUSED'
  const tbd  = !m.homeTeam?.name && !m.awayTeam?.name
  const hs   = m.score?.fullTime?.home
  const as_  = m.score?.fullTime?.away
  // fullTime inclut déjà les buts de prolongations — un match décidé aux tirs au
  // but y est TOUJOURS à égalité, le vrai vainqueur se lit dans score.penalties.
  const wentToPens = m.score?.duration === 'PENALTY_SHOOTOUT'
  const hp   = m.score?.penalties?.home ?? null
  const ap   = m.score?.penalties?.away ?? null
  const hW   = fin && (wentToPens ? (hp != null && ap != null && hp > ap) : hs > as_)
  const aW   = fin && (wentToPens ? (hp != null && ap != null && ap > hp) : as_ > hs)

  // `title` (nom complet au survol) ne se déclenche jamais au tactile — sur
  // mobile, seul le drapeau reste visible, sans aucun moyen de connaître le
  // nom de l'équipe sans taper la card (qui navigue direct vers /match/:id).
  // Appui long sur un drapeau = révèle le nom en surimpression sans naviguer
  // (le tap simple continue de naviguer comme avant, comportement inchangé).
  const longPressRef  = useRef(false)
  const pressTimerRef = useRef(null)
  const revealTimerRef = useRef(null)
  const [revealedSide, setRevealedSide] = useState(null) // 'home' | 'away' | null

  const startPress = (side) => {
    pressTimerRef.current = setTimeout(() => {
      longPressRef.current = true
      setRevealedSide(side)
      revealTimerRef.current = setTimeout(() => setRevealedSide(null), 1600)
    }, 420)
  }
  const cancelPress = () => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null }
  }
  useEffect(() => () => {
    cancelPress()
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
  }, [])

  const handleClick = () => {
    if (longPressRef.current) { longPressRef.current = false; return }
    if (!tbd) onSelect(m)
  }

  // Desktop : assez de place pour le nom complet à côté du drapeau (+ le
  // score si le match a commencé/est terminé) — voir BK_*_DESKTOP.
  const showScore = desktop && (fin || live) && !tbd

  return (
    <div
      className={`bracket__card bracket__card--compact ${big ? 'bracket__card--big' : ''} ${live ? 'bracket__card--live' : ''} ${desktop ? 'bracket__card--desktop' : ''}`}
      style={{ ...style, ...(cardH != null ? { minHeight: cardH } : {}), display:'flex', flexDirection:'column' }}
      onClick={handleClick}
    >
      <div
        className={`bracket__team ${desktop ? 'bracket__team--desktop' : ''} ${hW?'bracket__team--winner':''} ${aW?'bracket__team--loser':''}`}
        title={desktop ? undefined : _name(m.homeTeam)}
        onTouchStart={() => startPress('home')}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
      >
        <span className="bracket__crestWrap" data-crest={isCountry ? 'country' : 'club'}>
          {m.homeTeam?.crest
            ? <img src={m.homeTeam.crest} alt="" className="bracket__crest" data-team={m.homeTeam?.name} onError={e=>{e.currentTarget.style.display='none'}}/>
            : <span className="bracket__crestTbd">?</span>}
        </span>
        {desktop && <span className="bracket__teamNameDesktop">{_name(m.homeTeam)}</span>}
        {showScore && <span className="bracket__scoreDesktop">{hs ?? (wentToPens ? hp : '–')}</span>}
        {revealedSide === 'home' && !desktop && <span className="bracket__nameTip">{_name(m.homeTeam)}</span>}
      </div>
      <div
        className={`bracket__team ${desktop ? 'bracket__team--desktop' : ''} ${aW?'bracket__team--winner':''} ${hW?'bracket__team--loser':''}`}
        title={desktop ? undefined : _name(m.awayTeam)}
        onTouchStart={() => startPress('away')}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
      >
        <span className="bracket__crestWrap" data-crest={isCountry ? 'country' : 'club'}>
          {m.awayTeam?.crest
            ? <img src={m.awayTeam.crest} alt="" className="bracket__crest" data-team={m.awayTeam?.name} onError={e=>{e.currentTarget.style.display='none'}}/>
            : <span className="bracket__crestTbd">?</span>}
        </span>
        {desktop && <span className="bracket__teamNameDesktop">{_name(m.awayTeam)}</span>}
        {showScore && <span className="bracket__scoreDesktop">{as_ ?? (wentToPens ? ap : '–')}</span>}
        {revealedSide === 'away' && !desktop && <span className="bracket__nameTip">{_name(m.awayTeam)}</span>}
      </div>
    </div>
  )
}

// Découpe un tour en 2 moitiés (gauche/droite). Grâce au réordonnancement par
// topologie fait dans useWcKnockout.js (chaque paire d'index consécutifs
// (2k, 2k+1) d'un tour alimente toujours l'index k du tour suivant), la 1ère
// moitié d'un tour alimente TOUJOURS la 1ère moitié du tour suivant (et pareil
// pour la 2e moitié) — on peut donc couper chaque tableau en 2 sans jamais
// mélanger les deux branches de l'arbre. Vérifié par le calcul : pour un tour
// de 16 matchs → 8 au tour suivant, les index 0-7 (1ère moitié) sont fondés
// sur les paires (0,1)...(6,7) → indices 0-3 du tour suivant (1ère moitié),
// et 8-15 → indices 4-7 (2e moitié). Ça se vérifie à chaque niveau de l'arbre.
function splitHalf(matches) {
  const half = Math.ceil(matches.length / 2)
  return [matches.slice(0, half), matches.slice(half)]
}

function BracketSvgView({ rounds, onSelect, containerRef, isDesktop = false, isCountry = true }) {
  // Constantes de layout résolues selon le mode (BK_*_DESKTOP vs BK_*_MOBILE,
  // définies au niveau module plus haut) — nommées pareil (BK_CARD_W etc.)
  // pour tout le reste de cette fonction, aucun autre call site à toucher.
  const BK_CARD_W   = isDesktop ? BK_CARD_W_DESKTOP   : BK_CARD_W_MOBILE
  const BK_FINAL_W  = isDesktop ? BK_FINAL_W_DESKTOP  : BK_FINAL_W_MOBILE
  const BK_CARD_GAP = isDesktop ? BK_CARD_GAP_DESKTOP : BK_CARD_GAP_MOBILE
  const BK_CONN_W   = isDesktop ? BK_CONN_W_DESKTOP   : BK_CONN_W_MOBILE
  const BK_HDR_H    = isDesktop ? BK_HDR_H_DESKTOP    : BK_HDR_H_MOBILE
  // Espace pour le label "🏆 FINALE" au-dessus de sa card — agrandi en
  // desktop car le chip lui-même est plus grand (voir bracket__finalLabel
  // desktop dans match.css), sinon il chevaucherait les connecteurs SVG.
  const BK_FINAL_LABEL_H = isDesktop ? 34 : BK_FINAL_LABEL_H_MOBILE

  // ── Mesure de la hauteur réelle de card via une sonde invisible ──
  // La sonde utilise le VRAI composant BkCard avec le pire cas de contenu
  // (BK_PROBE_MATCH, un match à venir → séparateur date+heure 2 lignes),
  // donc la mesure reflète exactement ce qui sera rendu (fonte, padding,
  // line-height PWA réels), plus jamais une constante devinée à la main.
  //
  // IMPORTANT : la sonde est portée dans document.body (hors de
  // .bracket__svgWrap) et PAS rendue comme enfant direct ici. Raison : sur
  // mobile, .bracket__svgWrap est zoomé dynamiquement (voir plus bas).
  // getBoundingClientRect() renvoie toujours la taille APRÈS zoom — si on
  // mesure une sonde qui est déjà dans ce sous-arbre zoomé, on récupère une
  // valeur déjà réduite, puis on la réinjecte comme minHeight/position DANS
  // ce même sous-arbre zoomé → elle se retrouve zoomée UNE SECONDE FOIS au
  // rendu final. Résultat : cardH sous-dimensionné sur mobile, cards plus
  // hautes que leur slot alloué → chevauchement. En mesurant hors de toute
  // ancêtre zoomée (portail vers document.body), on obtient la vraie taille
  // logique, cohérente avec les valeurs qu'on réinjecte ensuite (elles ne
  // sont zoomées qu'UNE fois, au même titre que toutes les autres valeurs
  // de layout du bracket).
  // Hooks appelés avant tout retour anticipé (règle des Hooks React).
  // 2 sondes : une pour les cards de tour normal (BK_CARD_W), une pour la
  // card "big" (finale/petite finale, BK_FINAL_W) — le drapeau y est plus
  // grand (CSS bracket__card--big) donc la hauteur diffère réellement, on la
  // mesure séparément plutôt que d'extrapoler un ratio à la main.
  const probeRef    = useRef(null)
  const probeBigRef = useRef(null)
  const [cardH, setCardH]       = useState(BK_CARD_H_FALLBACK)
  const [cardHBig, setCardHBig] = useState(BK_CARD_H_FALLBACK + 12)

  useLayoutEffect(() => {
    const h = probeRef.current?.getBoundingClientRect().height
    if (h && h > 0) setCardH(Math.ceil(h) + BK_CARD_H_SAFETY)
    const hb = probeBigRef.current?.getBoundingClientRect().height
    if (hb && hb > 0) setCardHBig(Math.ceil(hb) + BK_CARD_H_SAFETY)
    // Contenu-sonde fixe (jamais lié aux données réelles) → une seule mesure
    // au montage suffit, pas besoin de re-mesurer à chaque render.
  }, [])

  const probe = createPortal(
    <>
      <div ref={probeRef} aria-hidden="true"
        style={{ position:'fixed', top:-9999, left:-9999, width:BK_CARD_W,
                 visibility:'hidden', pointerEvents:'none' }}>
        <BkCard m={BK_PROBE_MATCH} onSelect={() => {}} style={{ position:'static' }} cardH={null} desktop={isDesktop} />
      </div>
      <div ref={probeBigRef} aria-hidden="true"
        style={{ position:'fixed', top:-9999, left:-9999, width:BK_FINAL_W,
                 visibility:'hidden', pointerEvents:'none' }}>
        <BkCard m={BK_PROBE_MATCH} onSelect={() => {}} style={{ position:'static' }} cardH={null} big desktop={isDesktop} />
      </div>
    </>,
    document.body
  )

  // THIRD_PLACE et FINAL sortent des 2 "branches" gauche/droite : la finale
  // se joue au centre (1 seul match, alimenté par les 2 demies), la petite
  // finale est affichée à part sous la finale — comme sur une affiche de
  // Coupe du Monde classique (voir la maquette fournie par l'utilisateur).
  // Calculé sans early-return AVANT les hooks suivants (règle des Hooks) —
  // tableaux vides si `rounds` est vide, ce qui donne des tailles à 0, sans
  // planter — le vrai "rien à afficher" est géré tout en bas, au retour JSX.
  const main       = (rounds ?? []).filter(r => r.stage !== 'THIRD_PLACE' && r.stage !== 'FINAL')
  const finalRound = (rounds ?? []).find(r => r.stage === 'FINAL')
  const third       = (rounds ?? []).find(r => r.stage === 'THIRD_PLACE')

  // 2 branches, chacune avec la moitié des matchs de chaque tour.
  const leftRounds  = main.map(r => ({ ...r, matches: splitHalf(r.matches)[0] }))
  const rightRounds = main.map(r => ({ ...r, matches: splitHalf(r.matches)[1] }))

  const slotH    = cardH + BK_CARD_GAP
  const firstN   = Math.max(leftRounds[0]?.matches.length ?? 0, rightRounds[0]?.matches.length ?? 0)
  // Cas réel du jour (voir mCY) : aucune branche (main vide), seule la
  // finale existe → firstN vaut 0, donc une grille de hauteur 0 aurait
  // rogné la card de la finale (finalTop négatif, card qui dépasse en haut
  // du wrapper). On impose une hauteur mini suffisante pour loger la card
  // "big" dans ce cas précis, sans changer le calcul normal (branches
  // présentes) qui reste piloté par firstN comme avant.
  const GRID_H   = main.length === 0 ? cardHBig : firstN * slotH
  const nSides   = main.length   // nb de tours par branche (hors finale)
  const sideW    = nSides * BK_CARD_W + Math.max(0, nSides - 1) * BK_CONN_W
  const CENTER_W = BK_FINAL_W
  const TOTAL_W  = 2 * BK_PAD_X + 2 * sideW + 2 * BK_CONN_W + CENTER_W
  const TOTAL_H  = BK_HDR_H + GRID_H + (third ? 180 : 0)

  // ── Zoom "fit-to-screen" calculé dynamiquement ──
  // ERREUR CORRIGÉE : la version précédente donnait à .bracket__container un
  // `height: calc(100dvh - 13rem)` en CSS — "13rem" était une ESTIMATION à la
  // main de l'espace pris par la navbar/le header/les onglets au-dessus,
  // jamais mesurée. Si cette estimation est trop généreuse (chrome réel
  // < 13rem), le conteneur reçoit une hauteur plus grande que l'espace
  // vraiment dispo → le zoom calculé dessus est plus petit que nécessaire →
  // marge vide visible tout autour, sur LA LARGEUR ET LA HAUTEUR à la fois
  // (symptôme observé). Le conteneur n'a maintenant PLUS AUCUNE hauteur CSS
  // fixe (voir .bracket__container dans match.css) : on mesure la position
  // RÉELLE du conteneur à l'écran via getBoundingClientRect().top et on en
  // déduit l'espace dispo jusqu'au bas du viewport — aucun chiffre deviné.
  // CORRECTION : la version précédente recalculait le zoom À CHAQUE SCROLL
  // (rect.top change quand la page défile), donc la taille du bracket
  // variait selon où l'utilisateur était scrollé — trop petit en haut de
  // page, correct plus bas. Comportement jugé non voulu : la taille doit
  // être FIXE, calculée une seule fois à l'ouverture de l'onglet, à sa
  // valeur MAXIMALE, peu importe où l'utilisateur scrolle ensuite.
  const [fitZoom, setFitZoom] = useState(1)
  useLayoutEffect(() => {
    const el = containerRef?.current
    if (!el || !TOTAL_W || !TOTAL_H) return
    // Petite marge de sécurité en bas (pas une estimation de chrome, juste
    // un peu d'air pour ne pas coller au tout dernier pixel de l'écran).
    const BOTTOM_SAFETY = 12
    // Sonde cachée mesurant 100lvh ("largest viewport height" — hauteur une
    // fois la barre d'adresse mobile rétractée), pour ne pas dépendre de
    // l'état actuel de cette barre. Fallback sur innerHeight si lvh non
    // supporté (Safari < 15.4, vieux Android).
    const lvhProbe = document.createElement('div')
    lvhProbe.style.cssText = 'position:fixed; top:0; left:0; width:0; height:100lvh; visibility:hidden; pointer-events:none;'
    document.body.appendChild(lvhProbe)

    // ERREUR CORRIGÉE (v1) : window.scrollTo(0,0) remontait à l'ABSOLU tout
    // en haut de la page — rect.top du conteneur restait grand (chrome
    // au-dessus), et comme availH = hauteur écran − rect.top, le zoom
    // calculé s'effondrait → tableau minuscule.
    // ERREUR CORRIGÉE (v2) : la "solution" suivante (scrollIntoView pour
    // amener rect.top à ~0) réglait le zoom mais scrollait la page toute
    // seule à l'ouverture de l'onglet — sur mobile ça poussait le header
    // compétition (bouton "Changer"), le titre et les onglets hors écran,
    // introuvables sans quitter la page. Désactiver le scroll sur mobile
    // (v3) réglait ça mais réintroduisait le bug v1 (tableau rétréci, plus
    // petit qu'avant) puisque rect.top redevenait grand.
    // FIX DÉFINITIF : on n'a pas besoin de scroller la page ni de connaître
    // sa position actuelle pour calculer le zoom max. `availH` doit juste
    // répondre à "quelle est la plus grande hauteur que le tableau pourrait
    // occuper s'il était seul à l'écran ?" = la hauteur du viewport, point.
    // On calcule donc le zoom MAXIMAL sur cette base fixe, sans jamais lire
    // rect.top ni toucher au scroll — la page ne bouge plus toute seule, et
    // le tableau garde sa taille maximale ; l'utilisateur scrolle normalement
    // pour le voir en entier, comme n'importe quel contenu plus grand que
    // l'écran.
    const compute = () => {
      const availW = el.clientWidth
      const maxVH  = lvhProbe.getBoundingClientRect().height || window.innerHeight
      const availH = Math.max(0, maxVH - BOTTOM_SAFETY)
      if (!availW || !availH) return
      const zoomCap = isDesktop ? BK_ZOOM_CAP_DESKTOP : 1
      const z = Math.min(zoomCap, availW / TOTAL_W, availH / TOTAL_H)
      setFitZoom(z > 0 ? z : 1)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    // Seul un vrai changement de taille de fenêtre (rotation, redimensionnement)
    // redéclenche le calcul. PAS de listener 'scroll' : la taille reste FIXE
    // quel que soit l'endroit où l'utilisateur scrolle ensuite sur la page.
    window.addEventListener('resize', compute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', compute)
      lvhProbe.remove()
    }
  }, [containerRef, TOTAL_W, TOTAL_H, isDesktop])

  // X gauche d'un tour, branche GAUCHE (croissant vers la droite)
  const rXLeft  = (ri) => BK_PAD_X + ri * (BK_CARD_W + BK_CONN_W)
  // X gauche d'un tour, branche DROITE (miroir : décroissant vers la gauche
  // à mesure qu'on se rapproche du centre, comme sur l'affiche)
  const rXRight = (ri) => TOTAL_W - BK_PAD_X - BK_CARD_W - ri * (BK_CARD_W + BK_CONN_W)
  const centerX = (TOTAL_W - CENTER_W) / 2

  // Centre Y d'un match dans sa grille, pour une branche donnée.
  // BUG CORRIGÉ (écran noir en cliquant "Phase finale" Coupe de France) :
  // sideRounds[ri] n'était jamais gardé contre un index hors bornes. Ça
  // arrive en vrai dès que `main` (tours hors FINALE/3e place) est vide mais
  // qu'une FINALE existe seule dans la fenêtre de données — cas réel vérifié
  // en direct sur l'API ESPN (aujourd'hui, seule la finale 2025-26 Nice-Lens
  // est encore dans la fenêtre glissante de 60j, les tours précédents étant
  // sortis de la fenêtre) : leftRounds/rightRounds sont alors des tableaux
  // VIDES, donc lastLi/lastRi valent -1, et sideRounds[-1] est `undefined` →
  // `.matches` plantait avec un TypeError non rattrapé (pas d'Error Boundary
  // dans App.jsx) → démontage de tout l'arbre React → écran noir. On
  // sécurise ici (retombe sur le centre de la grille) : plus jamais de throw,
  // quelle que soit la forme des données.
  const mCY = (sideRounds, ri, mi) => {
    const n = sideRounds[ri]?.matches?.length
    if (!n) return BK_HDR_H + GRID_H / 2
    return BK_HDR_H + GRID_H / n * (mi + 0.5)
  }

  // ── Chemins SVG d'une branche ──
  // xOut = bord de départ (côté "extérieur", d'où sort la ligne du tour ri)
  // xIn  = bord d'arrivée (côté "intérieur", où la ligne entre dans ri+1)
  function buildConnectors(sideRounds, xOfRound, outEdge, inEdge) {
    const paths = []
    for (let ri = 0; ri < sideRounds.length - 1; ri++) {
      const curr = sideRounds[ri]
      for (let mi = 0; mi + 1 < curr.matches.length; mi += 2) {
        const y1   = mCY(sideRounds, ri, mi)
        const y2   = mCY(sideRounds, ri, mi + 1)
        const yMid = (y1 + y2) / 2
        const x1   = xOfRound(ri) + outEdge
        const x2   = xOfRound(ri + 1) + inEdge
        const xMid = (x1 + x2) / 2
        paths.push(
          `M ${x1} ${y1} H ${xMid} V ${y2} ` +
          `M ${x1} ${y2} H ${xMid} ` +
          `M ${xMid} ${yMid} H ${x2}`
        )
      }
    }
    return paths
  }
  const svgPathsLeft  = buildConnectors(leftRounds,  rXLeft,  BK_CARD_W, 0)
  const svgPathsRight = buildConnectors(rightRounds, rXRight, 0, BK_CARD_W)

  // ── Connecteurs demi-finale → finale (centre) ──
  const lastLi     = leftRounds.length - 1
  const lastRi     = rightRounds.length - 1
  const finalCY    = BK_HDR_H + GRID_H / 2
  // La card de la finale utilise cardHBig (mesurée séparément, elle est
  // physiquement plus grande — voir bracket__card--big).
  const finalTop   = finalCY - cardHBig / 2
  const leftFeedX  = rXLeft(lastLi) + BK_CARD_W
  const leftFeedY  = mCY(leftRounds, lastLi, 0)
  const rightFeedX = rXRight(lastRi)
  const rightFeedY = mCY(rightRounds, lastRi, 0)
  // Pas de connecteur à tracer s'il n'y a aucune branche gauche/droite (voir
  // commentaire mCY ci-dessus, même cas réel) : une ligne partant de nulle
  // part vers la finale n'aurait aucun sens visuellement — la finale
  // s'affiche alors seule, centrée, sans trait.
  const finalPaths = (finalRound && main.length > 0) ? [
    `M ${leftFeedX} ${leftFeedY} H ${(leftFeedX + centerX) / 2} V ${finalCY} H ${centerX}`,
    `M ${rightFeedX} ${rightFeedY} H ${(rightFeedX + centerX + CENTER_W) / 2} V ${finalCY} H ${centerX + CENTER_W}`,
  ] : []

  const thirdTop = finalTop + cardHBig + 56

  // Garde défensive : rien à afficher que si NI branches, NI finale, NI 3e
  // place. AVANT : `if (main.length === 0) return probe` sortait aussi
  // quand seule la finale existait (cas réel du jour, voir mCY) — le match
  // était alors invisible (juste la sonde), alors qu'il y a bien quelque
  // chose à montrer. Élargi pour ne bloquer QUE le cas vraiment vide.
  if (main.length === 0 && !finalRound && !third) return probe

  return (
    <>
      {/* Card-sonde invisible : ne sert qu'à mesurer la hauteur réelle du
          pire cas de contenu (voir commentaire plus haut). Portée dans
          document.body via createPortal — surtout PAS à l'intérieur de
          .bracket__svgWrap — pour ne jamais hériter du `zoom` mobile et
          fausser la mesure. position:fixed + hors-écran + visibility:hidden :
          toujours "layout-able" (donc mesurable) mais jamais visible. */}
      {probe}

    <div className={`bracket__svgWrap${isDesktop ? ' bracket__svgWrap--desktop' : ''}`} style={{ zoom: fitZoom }}>
      {/* ── Tableau symétrique : 2 branches convergent vers la finale au
          centre, comme une affiche classique de Coupe du Monde. ── */}
      <div style={{ position:'relative', width:TOTAL_W, height:TOTAL_H, minWidth:TOTAL_W }}>

        {/* Traits SVG des 2 branches + finale — léger glow (filter sur le
            <svg> global, pas besoin de <defs>/<filter> par path) pour un
            rendu plus "app moderne" que des traits plats. */}
        <svg
          style={{ position:'absolute', top:0, left:0, width:TOTAL_W, height:TOTAL_H,
                   overflow:'visible', pointerEvents:'none', zIndex:0,
                   filter:'drop-shadow(0 0 2px rgba(239,68,68,0.35))' }}
        >
          {[...svgPathsLeft, ...svgPathsRight, ...finalPaths].map((d, i) => (
            <path key={i} d={d} fill="none"
              stroke="rgba(239,68,68,0.55)" strokeWidth="1.75"
              // strokeLinejoin="round" arrondissait le coin à chaque angle
              // droit (horizontal → vertical) des connecteurs — d'où
              // l'impression de lignes "légèrement courbées" alors que les
              // tracés eux-mêmes (commandes H/V du path) sont mathématiquement
              // parfaitement droits. "miter" donne un angle net à 90°, comme
              // sur un vrai tableau de phases finales. strokeLinecap="round"
              // conservé : il n'arrondit que les extrémités libres des
              // segments, pas les angles — c'est l'effet "moderne" voulu.
              strokeLinecap="round" strokeLinejoin="miter"
            />
          ))}
        </svg>

        {/* Titres des tours — branche gauche */}
        {leftRounds.map((round, ri) => (
          <div key={`hdr-l-${round.stage}`} style={{
            position:'absolute', left:rXLeft(ri), top:0,
            width:BK_CARD_W, height:BK_HDR_H,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <span className="bracket__roundTitle">{_shortLabel(round)}</span>
          </div>
        ))}
        {/* Titres des tours — branche droite */}
        {rightRounds.map((round, ri) => (
          <div key={`hdr-r-${round.stage}`} style={{
            position:'absolute', left:rXRight(ri), top:0,
            width:BK_CARD_W, height:BK_HDR_H,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <span className="bracket__roundTitle">{_shortLabel(round)}</span>
          </div>
        ))}
        {/* Cards branche gauche */}
        {leftRounds.map((round, ri) =>
          round.matches.map((m, mi) => {
            const n       = round.matches.length
            const sH      = GRID_H / n
            const cardTop = BK_HDR_H + sH * mi + (sH - cardH) / 2
            return (
              <BkCard key={m.id} m={m} onSelect={onSelect} cardH={cardH} desktop={isDesktop} isCountry={isCountry}
                style={{ position:'absolute', left:rXLeft(ri), top:cardTop, width:BK_CARD_W, zIndex:1 }}
              />
            )
          })
        )}
        {/* Cards branche droite */}
        {rightRounds.map((round, ri) =>
          round.matches.map((m, mi) => {
            const n       = round.matches.length
            const sH      = GRID_H / n
            const cardTop = BK_HDR_H + sH * mi + (sH - cardH) / 2
            return (
              <BkCard key={m.id} m={m} onSelect={onSelect} cardH={cardH} desktop={isDesktop} isCountry={isCountry}
                style={{ position:'absolute', left:rXRight(ri), top:cardTop, width:BK_CARD_W, zIndex:1 }}
              />
            )
          })
        )}

        {/* Titre + card de la finale, au centre — le label "🏆 FINALE" est
            positionné juste au-dessus de LA CARD elle-même (pas tout en haut
            dans la rangée des titres de tour avec tout le monde) : demande
            explicite pour la mettre en valeur, au niveau des finalistes. */}
        {finalRound && (
          <div style={{
            position:'absolute', left:centerX, top:finalTop - BK_FINAL_LABEL_H - 8, width:CENTER_W,
            display:'flex', justifyContent:'center',
          }}>
            <div className="bracket__finalLabel">🏆 {_shortLabel(finalRound)}</div>
          </div>
        )}
        {finalRound?.matches[0] && (
          <BkCard key={finalRound.matches[0].id} m={finalRound.matches[0]} onSelect={onSelect} cardH={cardHBig} big desktop={isDesktop} isCountry={isCountry}
            style={{ position:'absolute', left:centerX, top:finalTop, width:CENTER_W, zIndex:2 }}
          />
        )}

        {/* Petite finale, sous la finale */}
        {third?.matches[0] && (
          <div style={{ position:'absolute', left:centerX, top:thirdTop, width:CENTER_W }}>
            {/* BUG CORRIGÉ : text-align:center était posé sur le label lui-même
                (inline-block, donc sans effet — il se contracte à la taille de
                son texte) au lieu du conteneur. Le label n'était donc pas
                centré par rapport à la card en dessous. Flexbox sur le
                conteneur (même technique que le label de la finale ci-dessus). */}
            <div style={{ display:'flex', justifyContent:'center', marginBottom:'0.5rem' }}>
              <div className="bracket__thirdLabel">🥉 {_shortLabel(third)}</div>
            </div>
            <BkCard key={third.matches[0].id} m={third.matches[0]} onSelect={onSelect} cardH={cardHBig} big desktop={isDesktop} isCountry={isCountry}
              style={{ position:'static', width:CENTER_W }}
            />
          </div>
        )}
      </div>

    </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════ */

function Matchs() {
  /* ── State ── */
  const navigate = useNavigate()
  // Persistés dans sessionStorage : App.jsx remonte cette page à chaque
  // retour depuis /match/:id (voir usePersistedState) — sans ça, revenir
  // d'un match rebasculait toujours sur la 1ère journée/tour (16e) au lieu
  // de celui consulté (ex: 8e de finale).
  // Clé 'shared_selectedComp' PARTAGÉE avec Classement.jsx et Resultat.jsx
  // — changer de championnat ici met aussi à jour les deux autres pages (et
  // inversement). Sûr car une seule des 3 pages est montée à la fois (voir
  // usePersistedState.js).
  // ⚠️ Défaut changé de 'WC' à 'FL1' (Ligue 1) — demande utilisateur : la CM
  // 2026 est terminée (finale le 19/07), plus de raison de l'avoir par
  // défaut jusqu'à la reprise des championnats de club fin août.
  const [selectedComp,  setSelectedComp]  = usePersistedState('shared_selectedComp', 'FL1')
  const [currentIndex,  setCurrentIndex]  = usePersistedState('matchs_currentIndex', 0)
  const [wcView,        setWcView]        = usePersistedState('matchs_wcView', 'poules') // 'poules' | 'bracket' | 'matchs'
  const [openedGroup,   setOpenedGroup]   = useState(null)
  const [compOpen,      setCompOpen]      = useState(false)
  // Recherche équipe (vue "Par journée" uniquement) — même pattern que
  // Resultat.jsx, pour la parité avec les 2 autres pages liste de l'app.
  const [search, setSearch] = useState('')
  const searchNorm = search.trim().toLowerCase()
  // Dropdown "Changer" — voir Classement.jsx pour l'explication (portail
  // dans <body> + position fixed calculée depuis le bouton, comme la cloche).
  const compHeroRef = useRef(null)
  const [compAnchor, setCompAnchor] = useState(null)
  useLayoutEffect(() => {
    if (!compOpen || !compHeroRef.current) return
    const r = compHeroRef.current.getBoundingClientRect()
    setCompAnchor({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 220) })
  }, [compOpen])
  useEffect(() => {
    if (!compOpen) return
    const onClick = (e) => {
      if (compHeroRef.current?.contains(e.target)) return
      if (e.target.closest?.('.compHeader__pickerWrap')) return
      setCompOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [compOpen])
  // ⚠️ AJOUT (retour utilisateur : "quand je scroll tout en bas du dropdown
  // pour voir les derniers championnats puis je remonte, ça remonte la page
  // Programme derrière au lieu du dropdown") : le dropdown est un portail
  // position:fixed qui flotte AU-DESSUS de la page, mais rien n'empêchait le
  // body en dessous de scroller en même temps — un geste de scroll qui
  // atteint le haut/bas de la liste du dropdown (fin de son propre scroll
  // interne) "traverse" et continue de scroller la page derrière. Fix :
  // même technique de verrou de scroll déjà utilisée pour GroupModal.jsx
  // (position:fixed sur body + restauration de la position exacte à la
  // fermeture, pour ne pas sauter ailleurs sur la page une fois le dropdown
  // refermé).
  useEffect(() => {
    if (!compOpen) return
    const scrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.left = '0'
    document.body.style.right = '0'
    return () => {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.left = ''
      document.body.style.right = ''
      window.scrollTo(0, scrollY)
    }
  }, [compOpen])
  // Conteneur du bracket — mesuré par BracketSvgView pour calculer le zoom
  // "fit-to-screen" (voir commentaire dans BracketSvgView).
  const bracketWrapRef = useRef(null)
  // Tableau desktop (≥900px) : cards larges avec nom complet + score au lieu
  // du drapeau seul compact — voir BK_*_DESKTOP dans BracketSvgView.
  const [isBracketDesktop, setIsBracketDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const onChange = () => setIsBracketDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  /* ── Data ── */
  const { matches, loading, error, grouped } = useMatches(selectedComp, 'SCHEDULED', 'asc')
  // useTeamForm(selectedComp) retiré (10/07 cleanup) : formMap n'était jamais
  // consommé nulle part dans cette page (Programme n'affiche pas de losanges
  // de forme) — fetch réseau pur perte, contraire à l'effort de réduction du
  // budget CPU Vercel (voir CLAUDE.md, Fluid Active CPU).
  const { rounds, loading: bracketLoading, error: bracketError } = useWcKnockout(selectedComp)

  const currentComp = COMPETITIONS.find(c => c.id === selectedComp)
  // WC ET Euro : mêmes vues Poules/Phase finale (les 2 seules compétitions du
  // catalogue avec une phase de groupes + bracket à élimination directe côté
  // football-data.org). Le nom "isWC" reste historique (beaucoup de call
  // sites), mais couvre bien les 2 depuis l'ajout de l'Euro.
  const isWC        = selectedComp === 'WC' || selectedComp === 'EC'
  // Coupe nationale fusionnée dans cet onglet (Coupe de France/Copa del
  // Rey/FA Cup) : pas de vue "Poules" (pas de phase de groupes), mais un
  // tableau à élimination directe SI — voir useCupKnockout (source ESPN,
  // useWcKnockout.js) et DOMESTIC_CUPS (competitions.js).
  const hasCup       = !!DOMESTIC_CUPS[selectedComp]
  const {
    rounds:  cupRounds,
    loading: cupBracketLoading,
    error:   cupBracketError,
  } = useCupKnockout(selectedComp)
  const bracketRounds  = hasCup ? cupRounds        : rounds
  const bracketLoad    = hasCup ? cupBracketLoading : bracketLoading
  const bracketErr     = hasCup ? cupBracketError   : bracketError
  // Correctif fraîcheur "à déterminer" (voir commentaire détaillé dans
  // useWcKnockout.js) : le bracket ci-dessus est déjà chargé et plus frais
  // (10min) que la vue "Par journée" (matches/grouped, 1h) — on réutilise ses
  // rounds pour corriger l'affichage des mêmes matchs plus bas, sans requête
  // réseau en plus.
  const knockoutOverrides = useMemo(
    () => getKnockoutTeamOverrides(bracketRounds),
    [bracketRounds]
  )
  // Retour utilisateur : bug rencontré en ouvrant le tableau d'une coupe
  // nationale (ex. Coupe de France) pas encore rempli côté ESPN — désactive
  // l'onglet "Phase finale" pour ces compétitions tant qu'aucun match n'y
  // figure. Se réactive automatiquement dès que cupRounds a au moins un
  // match (le tableau "commence tout juste à se remplir"). Ne concerne QUE
  // les coupes nationales — WC/EC ont déjà leur propre garde (état "à venir"
  // géré normalement, jamais buggé).
  // AFFINÉ (retour utilisateur : la finale de la saison précédente restait
  // seule seule dans la fenêtre glissante de 60j de fetchEspnCupMatches une
  // fois les tours antérieurs sortis de la fenêtre — voir mCY dans
  // BracketSvgView) : `cupRounds.length === 0` ne suffit pas, ce cas précis a
  // longueur 1 (juste FINAL). Il ne faut PAS afficher cette finale résiduelle
  // comme si un vrai tableau de la nouvelle saison existait — l'onglet doit
  // rester désactivé tant qu'AU MOINS un tour hors finale/3e place (donc un
  // vrai début de tableau à élimination directe de la saison EN COURS) n'est
  // pas apparu.
  const cupBracketDisabled = hasCup &&
    cupRounds.filter(r => r.stage !== 'THIRD_PLACE' && r.stage !== 'FINAL').length === 0
  // Vrai pour toute compétition ayant un toggle Poules/Journée/Phase finale
  // (WC, EC, ou une coupe nationale fusionnée) — remplace les anciens tests
  // "!isWC"/"isWC" isolés dans les vues ci-dessous, qui ignoraient le cas
  // coupe nationale et auraient affiché "Par journée" ET le bracket en même
  // temps pour ces onglets.
  const hasToggle    = isWC || hasCup
  // Sur l'onglet "Phase finale" en desktop, la sidebar "Championnats" ne sert
  // à rien (le bracket est propre à la CdM, changer de championnat en sort de
  // toute façon) — on la masque et on laisse le tableau utiliser toute la
  // largeur dispo au lieu de rester capé à 1200px (voir .matchs__layout,
  // .matchs__layout--bracketFull dans match.css). Demande explicite : "encore
  // de la place, tu peux agrandir".
  const bracketFullWidth = hasToggle && wcView === 'bracket' && isBracketDesktop

  // Note : plus de ticker de minute ici — les cards du bracket sont
  // maintenant compactes (drapeau + nom uniquement, plus de texte "minute
  // live"), donc plus besoin de re-render périodique pour ça.

  /* ── Groupes CdM (uniquement GROUP_X, pas les stades) ── */
  const wcGroups = useMemo(() => {
    if (!isWC) return []

    const seen = new Set()
    const groups = []

    for (const m of matches) {
      const g = m.group ?? null  // on n'utilise PAS m.stage ici
      if (g && g.startsWith('GROUP_') && !seen.has(g)) {
        seen.add(g)
        groups.push(g)
      }
    }

    return groups.sort()
  }, [matches, isWC])

  const matchesByGroup = useMemo(() => {
    const map = new Map()
    for (const g of wcGroups) map.set(g, [])
    for (const m of matches) {
      const g = m.group ?? null
      if (g && map.has(g)) map.get(g).push(m)
    }
    return map
  }, [matches, wcGroups])

  const groupTeams = (groupMatches) => {
    const seen = new Set()
    const teams = []

    for (const m of groupMatches) {
      if (!seen.has(m.homeTeam.id)) {
        seen.add(m.homeTeam.id)
        teams.push(m.homeTeam)
      }
      if (!seen.has(m.awayTeam.id)) {
        seen.add(m.awayTeam.id)
        teams.push(m.awayTeam)
      }
    }

    return teams
  }

  /* Les 2 auto-switch ci-dessous ne doivent corriger la vue par défaut QU'UNE
     FOIS par compétition sélectionnée — sinon ils re-déclenchent à chaque fois
     que wcView repasse à 'poules' (dépendance de leurs deux useEffect), y
     compris quand l'utilisateur clique lui-même sur le bouton "Poules", ce qui
     le renvoyait aussitôt sur "Par journée" et rendait le bouton inutilisable.
     autoSwitchDone est remis à zéro à chaque changement de compétition
     (handleSelectComp) et marqué dès qu'un clic manuel a lieu (pickWcView). */
  const autoSwitchDone = useRef(false)

  /* Auto-switch : si des matchs existent mais aucun groupe détecté → vue par
     journée. Couvre aussi les coupes nationales (hasCup) : elles n'ont
     jamais de groupes (wcGroups reste [] tant que !isWC), donc basculent
     immédiatement hors de "poules" — qui ne leur est de toute façon jamais
     proposé comme bouton (voir le toggle plus bas). */
  useEffect(() => {
    if (autoSwitchDone.current) return
    if ((isWC || hasCup) && wcView === 'poules' && !loading && matches.length > 0 && wcGroups.length === 0) {
      setWcView('matchs')
      setCurrentIndex(0)
      autoSwitchDone.current = true
    }
  // setWcView/setCurrentIndex (useState) : identité garantie stable par React
  // entre les renders, sans risque à ajouter aux deps (résout juste le
  // warning exhaustive-deps, aucun changement de comportement).
  }, [isWC, hasCup, wcView, loading, matches.length, wcGroups.length, setWcView, setCurrentIndex])

  /* Auto-switch (2e garde-fou, plus fiable) : si un match à élimination directe
     est déjà TERMINÉ, on est forcément après la phase de poules — inutile
     d'attendre que le cache "SCHEDULED" (qui peut rester périmé un moment,
     ex: rate-limit 429 silencieux → fallback sur un vieux cache local) le
     confirme. useWcKnockout() fetch les matchs sans filtre de statut, donc
     un match FINISHED y apparaît immédiatement dès qu'il est joué. */
  const hasPlayedKnockout = (rounds ?? []).some(r => r.matches?.some(m => m.status === 'FINISHED'))
  useEffect(() => {
    if (autoSwitchDone.current) return
    if (isWC && wcView === 'poules' && !bracketLoading && hasPlayedKnockout) {
      setWcView('matchs')
      setCurrentIndex(0)
      autoSwitchDone.current = true
    }
  }, [isWC, wcView, bracketLoading, hasPlayedKnockout, setWcView, setCurrentIndex])

  /* Si l'onglet "Phase finale" d'une coupe nationale est désactivé (aucun
     match dans le tableau, voir cupBracketDisabled) mais que wcView pointe
     encore dessus — ex. retour depuis une navigation précédente où le
     tableau contenait des matchs entre-temps disparus — on retombe sur "Par
     journée" plutôt que d'afficher l'onglet actif mais désactivé. */
  useEffect(() => {
    if (cupBracketDisabled && wcView === 'bracket') {
      setWcView('matchs')
      setCurrentIndex(0)
    }
  }, [cupBracketDisabled, wcView, setWcView, setCurrentIndex])

  /* Changement manuel de vue (clics utilisateur) → on considère l'auto-switch
     "consommé" pour cette compétition, il ne doit plus jamais forcer la vue. */
  const pickWcView = (v) => {
    autoSwitchDone.current = true
    setWcView(v)
  }

  /* Vue "Par journée" (toutes compétitions) : seulement les matchs pas encore
     joués (TIMED/SCHEDULED). Un match en direct (IN_PLAY/PAUSED) n'a plus sa
     place ici — il est déjà visible dans le widget "EN DIRECT" de l'Accueil
     et sur la page /live, pas besoin de le montrer aussi dans "Programme". */
  const filteredGrouped = useMemo(() => {
    return grouped
      .map(g => ({
        ...g,
        matches: applyKnockoutTeamOverrides(
          g.matches.filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED'),
          knockoutOverrides
        ),
      }))
      .filter(g => g.matches.length > 0)
  }, [grouped, knockoutOverrides])

  /* Navigation journées */
  const total = filteredGrouped.length
  // currentIndex peut venir de sessionStorage (retour depuis /match/:id) : si
  // la liste de journées/tours a changé depuis, on retombe sur la dernière
  // valide plutôt que de rester bloqué sur un index vide.
  useEffect(() => {
    if (total > 0 && currentIndex >= total) setCurrentIndex(total - 1)
  }, [total, currentIndex, setCurrentIndex])
  const currentGroup      = filteredGrouped[currentIndex]
  const currentRoundLabel = currentGroup?.label ?? ''
  const currentMatches    = currentGroup?.matches ?? []

  // Recherche — filtre côté client par nom d'équipe (traduit ou brut), même
  // logique que Resultat.jsx. En recherche, on ignore le découpage par
  // journée : on cherche sur TOUS les matchs à venir de la compétition
  // (sinon une équipe absente de la journée affichée semblerait n'avoir
  // aucun match programmé).
  const filteredSearchMatches = useMemo(() => {
    if (!searchNorm) return []
    // Définie ICI (pas au niveau du composant) : seule utilisatrice, évite le
    // warning exhaustive-deps sans recalculer le memo à chaque render (une
    // fonction définie au niveau du composant est une référence différente à
    // chaque passage, ce qui aurait invalidé le memo inutilement si ajoutée
    // aux deps — son comportement dépend uniquement de searchNorm, déjà listé).
    function matchesTeamSearch(team) {
      const translated = translateTeam(team?.shortName || team?.name || '').toLowerCase()
      const raw         = (team?.name ?? '').toLowerCase()
      return translated.includes(searchNorm) || raw.includes(searchNorm)
    }
    // Override AVANT le filtre de recherche : sinon un match dont le vrai
    // qualifié (bracket) correspond à la recherche, mais dont le nom encore
    // caché en cache ("à déterminer") ne correspond pas, serait exclu à tort.
    return applyKnockoutTeamOverrides(matches, knockoutOverrides)
      .filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED')
      .filter(m => matchesTeamSearch(m.homeTeam) || matchesTeamSearch(m.awayTeam))
  }, [matches, knockoutOverrides, searchNorm])

  /* ── Helpers ── */
  const handleSelectComp = (id) => {
    autoSwitchDone.current = false
    setSelectedComp(id); setCurrentIndex(0); setWcView('poules'); setOpenedGroup(null)
  }

  const formatGroupName = (raw = '') => raw.replace('GROUP_', 'Groupe ').replace(/_/g, ' ')

  /* ── Rendu ── */
  return (
    <section className="matchs">
      <div className="matchs__backdrop matchs__backdrop--one" />
      <div className="matchs__backdrop matchs__backdrop--two" />

      <div className={`matchs__layout${bracketFullWidth ? ' matchs__layout--bracketFull' : ''}`}>

        {/* ── Mobile : header compétition vedette (Option B) ── */}
        <div className={`compHeader${compOpen ? ' compHeader--open' : ''}`}>
          <div className="compHeader__hero" ref={compHeroRef} onClick={() => setCompOpen(o => !o)}>
            {currentComp?.emblem && (
              <img src={currentComp.emblem} alt="" className="compHeader__logo"
                onError={e => e.currentTarget.style.display = 'none'} />
            )}
            <div className="compHeader__info">
              <span className="compHeader__name">{currentComp?.name}</span>
            </div>
            <button className="compHeader__btn" aria-label="Changer de compétition">
              {compOpen ? 'Fermer ✕' : 'Changer ›'}
            </button>
          </div>
          <div className="compHeader__dots">
            {COMPETITIONS.map(c => (
              <span key={c.id} className={`compHeader__dot${c.id === selectedComp ? ' compHeader__dot--active' : ''}`} />
            ))}
          </div>
          {compAnchor && createPortal(
            <div
              className={`compHeader__pickerWrap${compOpen ? ' compHeader__pickerWrap--open' : ''}`}
              style={{ top: compAnchor.top, left: compAnchor.left, width: compAnchor.width }}
            >
              <div className="compHeader__picker">
                {COMPETITIONS.map(comp => (
                  <button
                    key={comp.id}
                    className={`compHeader__item${comp.id === selectedComp ? ' compHeader__item--active' : ''}`}
                    onClick={() => { handleSelectComp(comp.id); setCompOpen(false) }}
                  >
                    <img src={comp.emblem} alt="" className="compHeader__itemLogo"
                      onError={e => e.currentTarget.style.display = 'none'} />
                    <span className="compHeader__itemName">{comp.shortName ?? comp.name}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )}
        </div>

        {/* ── Desktop : sidebar liste — masquée sur l'onglet Phase finale
            (voir bracketFullWidth), le bracket est propre à la CdM. ── */}
        <aside className={`matchs__sidebar${bracketFullWidth ? ' matchs__sidebar--hidden' : ''}`}>
          <p className="matchs__sidebarLabel">Championnats</p>
          <nav className="matchs__sidebarNav">
            {COMPETITIONS.map(comp => (
              <button key={comp.id}
                onClick={() => handleSelectComp(comp.id)}
                className={`matchs__sidebarItem ${selectedComp === comp.id ? 'matchs__sidebarItem--active' : ''}`}
              >
                <img src={comp.emblem} alt=""
                  className="matchs__competitionLogo matchs__competitionLogo--sidebar"
                  onError={e => e.currentTarget.style.display = 'none'} />
                <span className="matchs__sidebarName matchs__sidebarName--full">{comp.name}</span>
                <span className="matchs__sidebarName matchs__sidebarName--short">{comp.shortName ?? comp.name}</span>
                {selectedComp === comp.id && <span className="matchs__sidebarDot" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Contenu principal */}
        <main className="matchs__main">

          {/* Header */}
          <div className="matchs__header">
            <h1 className="matchs__kicker">Matchs à venir</h1>
            <div className="matchs__headerRow">
              {/* Toggle vues CdM / coupe nationale */}
              {(isWC || hasCup) && (
                <div className="matchs__wcToggle">
                  {/* ── Poules : terrain de foot vu du dessus (WC/EC seulement — pas de phase de groupes pour une coupe nationale) ── */}
                  {isWC && (
                  <button
                    className={`matchs__wcToggleBtn ${wcView === 'poules' ? 'matchs__wcToggleBtn--active' : ''}`}
                    onClick={() => pickWcView('poules')}
                  >
                    <svg className="matchs__wcToggleIcon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Terrain */}
                      <rect x="1.5" y="3" width="21" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity=".07"/>
                      {/* Ligne mi-terrain */}
                      <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="1.4" strokeDasharray="1.5 1"/>
                      {/* Cercle central */}
                      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                      {/* Point central */}
                      <circle cx="12" cy="12" r="0.8" fill="currentColor"/>
                      {/* Surface de réparation gauche */}
                      <rect x="1.5" y="7.5" width="4.5" height="9" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                      {/* Surface de réparation droite */}
                      <rect x="18" y="7.5" width="4.5" height="9" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                    </svg>
                    Poules
                  </button>
                  )}

                  {/* ── Par journée : liste de matchs ── */}
                  <button
                    className={`matchs__wcToggleBtn ${wcView === 'matchs' ? 'matchs__wcToggleBtn--active' : ''}`}
                    onClick={() => { pickWcView('matchs'); setCurrentIndex(0) }}
                  >
                    <svg className="matchs__wcToggleIcon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Fond carte */}
                      <rect x="2" y="3" width="20" height="18" rx="2.5" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="1.5"/>
                      {/* Header coloré */}
                      <rect x="2" y="3" width="20" height="5" rx="2.5" fill="currentColor" fillOpacity=".3"/>
                      {/* Lignes de match */}
                      <rect x="5" y="11.5" width="14" height="2" rx="1" fill="currentColor" opacity=".7"/>
                      <rect x="5" y="15.5" width="10" height="2" rx="1" fill="currentColor" opacity=".45"/>
                      {/* Numéro journée */}
                      <text x="12" y="7.2" textAnchor="middle" fontSize="3.5" fontWeight="bold" fill="currentColor" opacity=".9">J·12</text>
                    </svg>
                    Par journée
                  </button>

                  {/* ── Phase finale : arbre de tournoi ── */}
                  <button
                    className={`matchs__wcToggleBtn ${wcView === 'bracket' ? 'matchs__wcToggleBtn--active' : ''} ${cupBracketDisabled ? 'matchs__wcToggleBtn--disabled' : ''}`}
                    onClick={() => { if (!cupBracketDisabled) pickWcView('bracket') }}
                    disabled={cupBracketDisabled}
                    title={cupBracketDisabled ? 'Le tableau apparaît dès les premiers matchs programmés' : undefined}
                  >
                    <svg className="matchs__wcToggleIcon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Matchs 1er tour */}
                      <rect x="1" y="2.5" width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".9"/>
                      <rect x="1" y="7"   width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".9"/>
                      <rect x="1" y="14"  width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".9"/>
                      <rect x="1" y="18.5" width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".9"/>
                      {/* Connecteurs gauche */}
                      <path d="M6.5 3.75 H8.5 V8.25 H6.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
                      <path d="M6.5 15.25 H8.5 V19.75 H6.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
                      {/* Demi-finales */}
                      <rect x="9" y="5.25" width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".75"/>
                      <rect x="9" y="16.25" width="5.5" height="2.5" rx="0.8" fill="currentColor" opacity=".75"/>
                      {/* Connecteur centre */}
                      <path d="M14.5 6.5 H16.5 V17.5 H14.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
                      {/* Finale */}
                      <rect x="17" y="10.75" width="6" height="2.5" rx="0.8" fill="currentColor" opacity=".6"/>
                    </svg>
                    {hasCup ? DOMESTIC_CUPS[selectedComp]?.name : 'Phase finale'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ═══ Vue Poules ═══ */}
          {!loading && !error && isWC && wcView === 'poules' && (
            <>
              {loading && (
                <div className="matchs__state"><div className="matchs__spinner" /><p>Chargement...</p></div>
              )}
              {wcGroups.length > 0 && (
                <div className="matchs__wcBoard">
                  {wcGroups.map(g => {
                    const gMatches = matchesByGroup.get(g) ?? []
                    const teams    = groupTeams(gMatches)
                    const letter   = g.replace('GROUP_', '')
                    return (
                      <button key={g} className="matchs__wcGroupCard" onClick={() => setOpenedGroup(g)}>
                        <div className="matchs__wcGroupCard__top">
                          <span className="matchs__wcGroupCard__label">Groupe</span>
                          <span className="matchs__wcGroupCard__name">{letter}</span>
                        </div>
                        <ul className="matchs__wcGroupCard__teams">
                          {teams.map(t => (
                            <li key={t.id} className="matchs__wcGroupCard__team">
                              {t.crest
                                ? <div className="matchs__wcGroupCard__crestWrap" data-crest="country"><img src={t.crest} alt="" className="matchs__wcGroupCard__crest" data-team={t.name}
                                    onError={e => e.currentTarget.style.display = 'none'} /></div>
                                : <span className="matchs__wcGroupCard__crestFallback">{(t.shortName || t.name)?.[0]}</span>
                              }
                              <span className="matchs__wcGroupCard__teamName">
                                {translateTeam(t.shortName || t.name)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="matchs__wcGroupCard__footer">
                          <span>{gMatches.length} match{gMatches.length > 1 ? 's' : ''}</span>
                          <span className="matchs__wcGroupCard__cta">Voir →</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
              {!loading && wcGroups.length === 0 && (
                <p className="matchs__state">Aucune poule disponible.</p>
              )}
            </>
          )}

          {/* États chargement pour les autres vues */}
          {loading && (!hasToggle || wcView !== 'poules') && (
            <div className="matchs__state"><div className="matchs__spinner" /><p>Chargement des matchs...</p></div>
          )}
          {error && <p className="matchs__state matchs__state--error">{error}</p>}

          {/* ═══ Vue Phase finale (bracket) ═══ */}
          {hasToggle && wcView === 'bracket' && (
            <>
              {bracketLoad && (
                <div className="matchs__state"><div className="matchs__spinner" /><p>Chargement du tableau...</p></div>
              )}
              {bracketErr && (
                <p className="matchs__state matchs__state--error">{bracketErr}</p>
              )}
              {!bracketLoad && !bracketErr && bracketRounds.length === 0 && (
                <div className="bracket__empty">
                  <span className="bracket__emptyIcon">🏆</span>
                  <p className="bracket__emptyTitle">{hasCup ? `${DOMESTIC_CUPS[selectedComp]?.name} à venir` : 'Phase finale à venir'}</p>
                  <p className="bracket__emptyText">
                    {hasCup
                      ? "Le tableau apparaît dès que des matchs à partir des 32es de finale sont programmés ou joués."
                      : 'Le tableau des phases finales sera disponible dès la fin de la phase de groupes.'}
                  </p>
                  <button className="bracket__emptyCta" onClick={() => pickWcView(isWC ? 'poules' : 'matchs')}>
                    {isWC ? 'Voir les poules →' : 'Voir le programme →'}
                  </button>
                </div>
              )}
              {!bracketLoad && !bracketErr && bracketRounds.length > 0 && (
                <div className="bracket__container" ref={bracketWrapRef}>
                  <BracketSvgView rounds={bracketRounds} onSelect={m => navigate(`/match/${m.id}`, { state: { match: m } })} containerRef={bracketWrapRef} isDesktop={isBracketDesktop} isCountry={isWC} />
                </div>
              )}
            </>
          )}

          {/* ═══ Vue Par journée ═══ */}
          {!loading && !error && (!hasToggle || wcView === 'matchs') && (
            <div className="matchs__searchWrap">
              <input
                type="text"
                className="matchs__searchInput"
                placeholder="Rechercher une équipe…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="matchs__searchClear" onClick={() => setSearch('')} aria-label="Effacer la recherche">✕</button>
              )}
            </div>
          )}

          {!loading && !error && (!hasToggle || wcView === 'matchs') && searchNorm && (
            filteredSearchMatches.length === 0 ? (
              <p className="matchs__state">Aucun match à venir ne correspond à « {search} ».</p>
            ) : (
              <div className="matchs__panel">
                {filteredSearchMatches.map((m, i) => <MatchRow key={m.id} match={m} index={i} />)}
              </div>
            )
          )}

          {!loading && !error && (!hasToggle || wcView === 'matchs') && !searchNorm && total > 0 && (
            <>
              <div className="matchs__nav">
                <button className="matchs__navBtn"
                  onClick={() => setCurrentIndex(i => i - 1)}
                  disabled={currentIndex <= 0}>←</button>
                <span className="matchs__navLabel">{currentRoundLabel}</span>
                <button className="matchs__navBtn"
                  onClick={() => setCurrentIndex(i => i + 1)}
                  disabled={currentIndex >= total - 1}>→</button>
              </div>
              <div className="matchs__panel">
                {currentMatches.map((m, i) => <MatchRow key={m.id} match={m} index={i} />)}
              </div>
            </>
          )}

          {!loading && !error && (!hasToggle || wcView === 'matchs') && matches.length === 0 && (
            <p className="matchs__state">Aucun match à venir pour le moment.</p>
          )}

        </main>
      </div>

      {openedGroup && (
        <GroupModal
          title={formatGroupName(openedGroup)}
          matches={(matchesByGroup.get(openedGroup) ?? []).filter(m =>
            m.status === 'TIMED' || m.status === 'SCHEDULED' ||
            m.status === 'IN_PLAY' || m.status === 'PAUSED'
          )}
          renderMatch={(m, i) => <MatchRow key={m.id} match={m} index={i} inModal />}
          emptyMessage="Aucun match à venir dans ce groupe."
          onClose={() => setOpenedGroup(null)}
        />
      )}
    </section>
  )
}

export default Matchs
