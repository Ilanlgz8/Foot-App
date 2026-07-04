import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import './../match.css'
import './../compHeader.css'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames.js'
import { useMatches } from '../hooks/useMatchs'
import { useWcKnockout } from '../hooks/useWcKnockout'
import { useTeamForm } from '../hooks/useTeamForm'
import { calcProno } from '../utils/calcProno'
import { GroupModal } from './GroupModal'
import { usePersistedState } from '../hooks/usePersistedState'

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
const BK_CARD_W = 36
// Card de la FINALE (et de la petite finale) : volontairement plus large que
// les cards de tour normal — c'est le point de convergence du tableau, elle
// doit se voir davantage (demande explicite : la finale "en plus gros").
const BK_FINAL_W = 62
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
const BK_CARD_GAP = 16
// Largeur de la zone connecteur entre rounds. Réduite (12→8) : les libellés
// de tour sont maintenant très courts (16e/8e/4e/2e, voir BK_SHORT_LABELS)
// donc beaucoup moins de risque de chevauchement entre chips voisines — cet
// espace récupéré réduit TOTAL_W, ce qui fait mécaniquement grandir le zoom
// fit-to-screen (donc les cards/drapeaux) puisque le zoom est bloquant en
// LARGEUR (voir commentaire BK_CARD_W).
const BK_CONN_W = 8
// Hauteur de l'en-tête de round (titre) — libellés courts (voir
// BK_SHORT_LABELS), tiennent sur 1 ligne. Le titre de la finale n'est PLUS
// dans cette rangée (voir BK_FINAL_LABEL_H) : demande explicite de le
// mettre au niveau de la card de la finale plutôt que tout en haut.
// 16→18 : suit l'agrandissement du texte des chips (bracket__roundTitle
// 0.38rem→0.58rem dans match.css), pour ne pas les couper verticalement.
const BK_HDR_H  = 18
// Espace réservé au-dessus de la card de la finale pour son propre label
// "🏆 FINALE" — resserré pour que le label reste visuellement "accroché" à
// sa card plutôt que de flotter avec un grand vide entre les deux.
const BK_FINAL_LABEL_H = 16
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
   refresh à chaque fois"). */
function MatchRow({ match, index, inModal = false }) {
  const navigate = useNavigate()
  const isUpcoming = match.status === 'SCHEDULED' || match.status === 'TIMED'

  return (
    <div
      className={`matchs__match ${inModal ? 'matchs__match--modal' : ''}${isUpcoming ? ' matchs__match--upcoming' : ''}`}
      style={{ borderTop: index === 0 ? 'none' : undefined }}
      onClick={() => navigate(`/match/${match.id}`, { state: { match } })}
    >
      <span className="matchs__scoreDate">{_fmtD(match.utcDate)}</span>
      <div className="matchs__team matchs__team--home">
        {match.homeTeam.crest && (
          <div className="matchs__crestWrap"><img src={match.homeTeam.crest} alt="" loading="lazy" className="matchs__crest" data-team={match.homeTeam?.name}
            onError={e => e.target.style.display = 'none'} /></div>
        )}
        <span className="matchs__teamName">{teamName(match.homeTeam)}</span>
      </div>
      <div className="matchs__score">
        <span className="matchs__scoreHour">{_fmtH(match.utcDate)}</span>
        {isUpcoming && <span className="matchs__upcomingHint">›</span>}
      </div>
      <div className="matchs__team matchs__team--away">
        {match.awayTeam.crest && (
          <div className="matchs__crestWrap"><img src={match.awayTeam.crest} alt="" loading="lazy" className="matchs__crest" data-team={match.awayTeam?.name}
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
function BkCard({ m, style, onSelect, cardH, big = false }) {
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

  return (
    <div
      className={`bracket__card bracket__card--compact ${big ? 'bracket__card--big' : ''} ${live ? 'bracket__card--live' : ''}`}
      style={{ ...style, ...(cardH != null ? { minHeight: cardH } : {}), display:'flex', flexDirection:'column' }}
      onClick={() => !tbd && onSelect(m)}
    >
      <div className={`bracket__team ${hW?'bracket__team--winner':''} ${aW?'bracket__team--loser':''}`} title={_name(m.homeTeam)}>
        <span className="bracket__crestWrap">
          {m.homeTeam?.crest
            ? <img src={m.homeTeam.crest} alt="" loading="lazy" className="bracket__crest" data-team={m.homeTeam?.name} onError={e=>{e.currentTarget.style.display='none'}}/>
            : <span className="bracket__crestTbd">?</span>}
        </span>
      </div>
      <div className={`bracket__team ${aW?'bracket__team--winner':''} ${hW?'bracket__team--loser':''}`} title={_name(m.awayTeam)}>
        <span className="bracket__crestWrap">
          {m.awayTeam?.crest
            ? <img src={m.awayTeam.crest} alt="" loading="lazy" className="bracket__crest" data-team={m.awayTeam?.name} onError={e=>{e.currentTarget.style.display='none'}}/>
            : <span className="bracket__crestTbd">?</span>}
        </span>
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

function BracketSvgView({ rounds, onSelect, containerRef }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const probe = createPortal(
    <>
      <div ref={probeRef} aria-hidden="true"
        style={{ position:'fixed', top:-9999, left:-9999, width:BK_CARD_W,
                 visibility:'hidden', pointerEvents:'none' }}>
        <BkCard m={BK_PROBE_MATCH} onSelect={() => {}} style={{ position:'static' }} cardH={null} />
      </div>
      <div ref={probeBigRef} aria-hidden="true"
        style={{ position:'fixed', top:-9999, left:-9999, width:BK_FINAL_W,
                 visibility:'hidden', pointerEvents:'none' }}>
        <BkCard m={BK_PROBE_MATCH} onSelect={() => {}} style={{ position:'static' }} cardH={null} big />
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
  const GRID_H   = firstN * slotH
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

    // ERREUR CORRIGÉE : window.scrollTo(0,0) remontait à l'ABSOLU tout en
    // haut de la page — donc au-dessus du header/sidebar/onglets Poules-
    // Matchs-Phase finale, qui prennent eux-mêmes de la place. rect.top du
    // conteneur restait alors grand (tout ce chrome au-dessus), et comme
    // availH = hauteur écran − rect.top, le zoom calculé s'effondrait →
    // tableau minuscule. On aligne donc plutôt le conteneur lui-même au ras
    // du haut du viewport (scrollIntoView) : rect.top devient ~0, availH
    // redevient maximal, tout en restant UNE SEULE FOIS avant la mesure
    // (donc toujours indépendant d'où l'utilisateur était scrollé avant).
    el.scrollIntoView?.({ block: 'start', behavior: 'instant' })

    const compute = () => {
      const rect   = el.getBoundingClientRect()
      const availW = el.clientWidth
      const maxVH  = lvhProbe.getBoundingClientRect().height || window.innerHeight
      const availH = Math.max(0, maxVH - rect.top - BOTTOM_SAFETY)
      if (!availW || !availH) return
      const z = Math.min(1, availW / TOTAL_W, availH / TOTAL_H)
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
  }, [containerRef, TOTAL_W, TOTAL_H])

  // X gauche d'un tour, branche GAUCHE (croissant vers la droite)
  const rXLeft  = (ri) => BK_PAD_X + ri * (BK_CARD_W + BK_CONN_W)
  // X gauche d'un tour, branche DROITE (miroir : décroissant vers la gauche
  // à mesure qu'on se rapproche du centre, comme sur l'affiche)
  const rXRight = (ri) => TOTAL_W - BK_PAD_X - BK_CARD_W - ri * (BK_CARD_W + BK_CONN_W)
  const centerX = (TOTAL_W - CENTER_W) / 2

  // Centre Y d'un match dans sa grille, pour une branche donnée
  const mCY = (sideRounds, ri, mi) => {
    const n = sideRounds[ri].matches.length
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
  const finalPaths = finalRound ? [
    `M ${leftFeedX} ${leftFeedY} H ${(leftFeedX + centerX) / 2} V ${finalCY} H ${centerX}`,
    `M ${rightFeedX} ${rightFeedY} H ${(rightFeedX + centerX + CENTER_W) / 2} V ${finalCY} H ${centerX + CENTER_W}`,
  ] : []

  const thirdTop = finalTop + cardHBig + 56

  // Garde défensive : le call site (Matchs()) ne monte déjà ce composant que
  // si rounds.length > 0, mais on la garde ici aussi (défense en profondeur,
  // ex. futur appelant) — après tous les hooks, donc sans violer leur règle.
  if (main.length === 0) return probe

  return (
    <>
      {/* Card-sonde invisible : ne sert qu'à mesurer la hauteur réelle du
          pire cas de contenu (voir commentaire plus haut). Portée dans
          document.body via createPortal — surtout PAS à l'intérieur de
          .bracket__svgWrap — pour ne jamais hériter du `zoom` mobile et
          fausser la mesure. position:fixed + hors-écran + visibility:hidden :
          toujours "layout-able" (donc mesurable) mais jamais visible. */}
      {probe}

    <div className="bracket__svgWrap" style={{ zoom: fitZoom }}>
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
              <BkCard key={m.id} m={m} onSelect={onSelect} cardH={cardH}
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
              <BkCard key={m.id} m={m} onSelect={onSelect} cardH={cardH}
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
          <BkCard key={finalRound.matches[0].id} m={finalRound.matches[0]} onSelect={onSelect} cardH={cardHBig} big
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
            <BkCard key={third.matches[0].id} m={third.matches[0]} onSelect={onSelect} cardH={cardHBig} big
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
  const [selectedComp,  setSelectedComp]  = usePersistedState('matchs_selectedComp', 'WC')
  const [currentIndex,  setCurrentIndex]  = usePersistedState('matchs_currentIndex', 0)
  const [wcView,        setWcView]        = usePersistedState('matchs_wcView', 'poules') // 'poules' | 'bracket' | 'matchs'
  const [openedGroup,   setOpenedGroup]   = useState(null)
  const [compOpen,      setCompOpen]      = useState(false)
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
  // Conteneur du bracket — mesuré par BracketSvgView pour calculer le zoom
  // "fit-to-screen" (voir commentaire dans BracketSvgView).
  const bracketWrapRef = useRef(null)

  /* ── Data ── */
  const { matches, loading, error, grouped } = useMatches(selectedComp, 'SCHEDULED', 'asc')
  const { formMap } = useTeamForm(selectedComp)
  const { rounds, loading: bracketLoading, error: bracketError } = useWcKnockout()

  const currentComp = COMPETITIONS.find(c => c.id === selectedComp)
  const isWC        = selectedComp === 'WC'

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

  /* Auto-switch : si des matchs existent mais aucun groupe détecté → vue par journée */
  useEffect(() => {
    if (autoSwitchDone.current) return
    if (isWC && wcView === 'poules' && !loading && matches.length > 0 && wcGroups.length === 0) {
      setWcView('matchs')
      setCurrentIndex(0)
      autoSwitchDone.current = true
    }
  }, [isWC, wcView, loading, matches.length, wcGroups.length])

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
  }, [isWC, wcView, bracketLoading, hasPlayedKnockout])

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
        matches: g.matches.filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED'),
      }))
      .filter(g => g.matches.length > 0)
  }, [grouped])

  /* Navigation journées */
  const total = filteredGrouped.length
  // currentIndex peut venir de sessionStorage (retour depuis /match/:id) : si
  // la liste de journées/tours a changé depuis, on retombe sur la dernière
  // valide plutôt que de rester bloqué sur un index vide.
  useEffect(() => {
    if (total > 0 && currentIndex >= total) setCurrentIndex(total - 1)
  }, [total, currentIndex])
  const currentGroup      = filteredGrouped[currentIndex]
  const currentRoundLabel = currentGroup?.label ?? ''
  const currentMatches    = currentGroup?.matches ?? []

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

      <div className="matchs__layout">

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

        {/* ── Desktop : sidebar liste ── */}
        <aside className="matchs__sidebar">
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
              {/* Toggle vues CdM */}
              {isWC && (
                <div className="matchs__wcToggle">
                  {/* ── Poules : terrain de foot vu du dessus ── */}
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
                    className={`matchs__wcToggleBtn ${wcView === 'bracket' ? 'matchs__wcToggleBtn--active' : ''}`}
                    onClick={() => pickWcView('bracket')}
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
                    Phase finale
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
                                ? <div className="matchs__wcGroupCard__crestWrap"><img src={t.crest} alt="" loading="lazy" className="matchs__wcGroupCard__crest" data-team={t.name}
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
          {loading && (!isWC || wcView !== 'poules') && (
            <div className="matchs__state"><div className="matchs__spinner" /><p>Chargement des matchs...</p></div>
          )}
          {error && <p className="matchs__state matchs__state--error">{error}</p>}

          {/* ═══ Vue Phase finale (bracket) ═══ */}
          {isWC && wcView === 'bracket' && (
            <>
              {bracketLoading && (
                <div className="matchs__state"><div className="matchs__spinner" /><p>Chargement du tableau...</p></div>
              )}
              {bracketError && (
                <p className="matchs__state matchs__state--error">{bracketError}</p>
              )}
              {!bracketLoading && !bracketError && rounds.length === 0 && (
                <div className="bracket__empty">
                  <span className="bracket__emptyIcon">🏆</span>
                  <p className="bracket__emptyTitle">Phase finale à venir</p>
                  <p className="bracket__emptyText">
                    Le tableau des phases finales sera disponible dès la fin de la phase de groupes.
                  </p>
                </div>
              )}
              {!bracketLoading && !bracketError && rounds.length > 0 && (
                <div className="bracket__container" ref={bracketWrapRef}>
                  <BracketSvgView rounds={rounds} onSelect={m => navigate(`/match/${m.id}`, { state: { match: m } })} containerRef={bracketWrapRef} />
                </div>
              )}
            </>
          )}

          {/* ═══ Vue Par journée ═══ */}
          {!loading && !error && (!isWC || wcView === 'matchs') && total > 0 && (
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

          {!loading && !error && !isWC && matches.length === 0 && (
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
