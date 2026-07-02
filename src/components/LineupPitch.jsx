/**
 * LineupPitch — HTML/CSS version
 * Terrain en div CSS propre, joueurs en divs absolus avec glow dynamique.
 * Couleur d'équipe tirée du champ `color` de l'API.
 */
import { useState } from 'react'

// ── Dimensions logiques pour calcul des positions ─────────────────────────────
const PW = 300, PH = 400
const L = 10, R = 290, T = 10, B = 390
const IW = R - L, IH = B - T

const LINE_Y = {
  4: [0.91, 0.66, 0.43, 0.19],
  5: [0.91, 0.73, 0.54, 0.34, 0.15],
  6: [0.91, 0.76, 0.60, 0.44, 0.28, 0.12],
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeColor(raw) {
  if (!raw) return null
  return raw.startsWith('#') ? raw : `#${raw}`
}

function alpha(hex, a) {
  if (!hex || !hex.startsWith('#')) return `rgba(239,68,68,${a})`
  const full = hex.length === 4
    ? '#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3]
    : hex
  const r = parseInt(full.slice(1,3), 16)
  const g = parseInt(full.slice(3,5), 16)
  const b = parseInt(full.slice(5,7), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(239,68,68,${a})`
  return `rgba(${r},${g},${b},${a})`
}

function formatName(name, sname) {
  const n = (name || sname || '?').trim()
  const parts = n.split(/\s+/)
  if (parts.length === 1) return parts[0]
  return parts[0][0].toUpperCase() + '. ' + parts.slice(1).join(' ')
}

// Certaines sources renvoient des codes suffixés par le couloir plutôt qu'un
// code simple — ex: "CD-L" / "CD-R" (défenseur central gauche/droit, observé
// en pratique). On isole le suffixe -L/-R/-C AVANT toute recherche : sans ça,
// "CD-L" ne correspond à aucune entrée connue (ni CB, ni DEF...) et retombait
// sur le défaut MID par erreur — un défenseur pouvait s'afficher au milieu.
function stripSide(pos) {
  return (pos ?? '').toUpperCase().replace(/-[LRC]$/, '')
}

function posCat(pos) {
  const p = stripSide(pos)
  if (['GK','G','GB'].includes(p)) return 0
  if (['CB','CD','LB','RB','LWB','RWB','D','SW','DC','DL','DR','DD','DG','DEF'].includes(p)) return 1
  if (['CM','CDM','CAM','DM','AM','LM','RM','M','MF','MIL','MDC','MOF','MG','MD','MC'].includes(p)) return 2
  if (['ST','CF','LW','RW','F','FW','ATT','FWD','SS','AC','AG','AD','BU'].includes(p)) return 3
  return 2
}

// Couloir gauche/centre/droite déduit du code de poste, quand l'info est
// disponible (suffixe -L/-R, ou sigle explicite LB/RB/LM/RM/LW/RW/LWB/RWB).
// Sert à ORDONNER les joueurs correctement au sein de leur ligne au lieu de
// faire confiance à l'ordre brut renvoyé par l'API — c'est ce qui causait
// l'inversion gauche/droite constatée (ex: DC gauche affiché à droite).
// Tri STABLE : quand aucune info de latéralité n'existe (cas normal pour la
// plupart des sources, qui ne donnent que GK/DEF/MID/FWD génériques), tous
// les joueurs ont le même poids → l'ordre d'origine est conservé, donc aucun
// changement de comportement pour les formations sans détail gauche/droite.
function laneWeight(pos) {
  const raw = stripSide(pos)
  const original = (pos ?? '').toUpperCase()
  if (original.endsWith('-L')) return 0
  if (original.endsWith('-R')) return 2
  if (['LB','LM','LW','LWB'].includes(raw)) return 0
  if (['RB','RM','RW','RWB'].includes(raw)) return 2
  return 1
}

// ⚠️ La plupart du temps, ESPN/FIFA/api-football/football-data.org ne renvoient
// que des catégories génériques : GK/DEF/MID/FWD (jamais de détail gauche/
// droite/central). MAIS certaines sources renvoient parfois des codes plus
// détaillés suffixés par le couloir (ex: "CD-L"/"CD-R" observés en pratique
// pour un défenseur central gauche/droit) — stripSide() retire ce suffixe
// avant la recherche ici, donc "CD-L"/"CD-R" retombent bien sur l'entrée 'CD'
// ci-dessous plutôt que d'afficher le code brut non traduit.
// Labels en FRANÇAIS, façon FIFA/FC26 en version française (G, DC, DG, DD, MDC,
// MC, MOC, MG, MD, BU, AC, AG, AD... — ce sont exactement les abréviations du
// jeu quand la langue est réglée sur français).
// ⚠️ IMPORTANT : les codes/textes "défensif" vs "offensif" pour un milieu
// (CDM/"Defensive Midfield" vs CAM/"Attacking Midfield") viennent d'un champ
// "poste enregistré" en base chez la source (ESPN/FD.org/api-football) — une
// classification GÉNÉRALE du profil du joueur, pas une info tactique propre
// à CE match. Ce champ peut être obsolète/faux (constaté en pratique : un
// joueur connu comme milieu défensif affiché "MOC", un autre affiché "MDC"
// au lieu de son vrai poste). Contrairement à DEF/MID/FWD (toujours fiable)
// ou à gauche/droite (LB/RB — fait géométrique, pas un jugement), le duel
// défensif/offensif est un jugement de rôle trop incertain pour l'afficher
// avec confiance → on l'aplati sur "MIL" générique plutôt que d'afficher un
// rôle précis potentiellement faux.
const POS_LABEL = {
  // ── Catégories génériques (le plus souvent fournies par les APIs) ──
  GK:'G',  G:'G',   GB:'G',
  DEF:'DÉF', D:'DÉF',
  MID:'MIL', M:'MIL', MF:'MIL',
  FWD:'ATT', F:'ATT', FW:'ATT',
  // ── Codes détaillés FIFA/FC26 FR (utilisés quand une source les fournit) ──
  CB:'DC',  CD:'DC',  DC:'DC',  DL:'DG', DR:'DD',
  LB:'DG',  RB:'DD',  LWB:'DLG', RWB:'DLD',
  SW:'LIB',
  // Milieu central : générique fiable → 'MC'. Défensif/offensif : voir note
  // ci-dessus, aplati sur 'MIL' générique (pas assez fiable pour un label précis).
  CM:'MC',  CDM:'MIL', CAM:'MIL', DM:'MIL', AM:'MIL', MDC:'MIL', MOC:'MIL', MOF:'MIL', MG:'MG', MD:'MD', MC:'MC',
  LM:'MG',  RM:'MD',
  ST:'BU',  CF:'AC',  LW:'AG',  RW:'AD',
  SS:'BU',  BU:'BU', AC:'AC', AG:'AG', AD:'AD',
}

const CAT_COLOR = { 0: '#f59e0b', 1: '#60a5fa', 2: '#34d399', 3: '#ef4444' }

// ── Positionnement ────────────────────────────────────────────────────────────
function fallbackLines(starters) {
  const g = [0, 0, 0, 0]
  for (const p of starters) g[posCat(p.position)]++
  return g.filter(n => n > 0)
}

// Regroupe les titulaires par ligne RÉELLE (gardien / défense / milieu / attaque),
// via posCat() qui lit le poste renvoyé par l'API (fiable : GK/DEF/MID/FWD).
// Fix historique : avant, les joueurs étaient simplement tranchés dans l'ordre du
// tableau starters[] pour remplir les lignes de la formation, en supposant que
// l'API renvoie déjà les joueurs triés dans cet ordre tactique — pas garanti.
//
// BUG CORRIGÉ (2e passe) : la version précédente exigeait que le nombre de
// lignes de la formation corresponde EXACTEMENT au nombre de catégories
// dispo (GK/DEF/MID/FWD, 4 max) — sinon elle abandonnait et retombait sur
// l'ordre brut de l'API (donc un joueur pouvait atterrir n'importe où). Or
// une formation à 4 lignes de champ (ex: 4-2-3-1 = DEF/MDéf/MOff/ATT, ou
// 3-4-2-1, 4-1-2-1-2…) est extrêmement courante — et comme les 4 sources de
// données (ESPN/FIFA/api-football/football-data.org) ne distinguent JAMAIS
// milieu défensif de milieu offensif (tout est "MID" générique), cette
// condition d'égalité échouait très souvent → écran cassé sur ces formations,
// probablement la cause principale du "pas toujours bien placé" observé.
//
// Nouvelle règle, basée sur la convention football standard des notations de
// formation (X-Y-Z…) : la 1ère ligne de champ = défenseurs, la DERNIÈRE =
// attaquants, TOUTES les lignes intermédiaires (il peut y en avoir 1, 2 ou 3)
// = milieux, répartis dans l'ordre où l'API les renvoie. On ne peut toujours
// pas savoir PRÉCISÉMENT qui est sentinelle vs meneur de jeu (donnée absente
// des 4 sources), mais chaque joueur atterrit désormais toujours dans la
// bonne zone du terrain (jamais un défenseur en ligne d'attaque ou l'inverse),
// au lieu de dépendre d'un ordre d'API non garanti.
function groupByRealLine(starters, lines) {
  const byCat = [[], [], [], []]  // 0=GK, 1=DEF, 2=MID, 3=FWD
  for (const p of starters) byCat[posCat(p.position)].push(p)
  // Tri stable gauche→droite (voir laneWeight) : corrige l'inversion gauche/
  // droite constatée avec les codes de poste détaillés. Ne change rien pour
  // les données génériques sans info de latéralité (tri stable = neutre).
  for (const arr of byCat) arr.sort((a, b) => laneWeight(a.position) - laneWeight(b.position))

  const nOutfield = lines.length - 1  // hors ligne gardien (lines[0])
  const ordered = []

  if (nOutfield <= 1) {
    // Formation dégénérée (une seule ligne de champ) : tout regrouper.
    ordered.push(...byCat[0], ...byCat[1], ...byCat[2], ...byCat[3])
  } else {
    let midIdx = 0
    for (let li = 0; li < lines.length; li++) {
      if (li === 0)                    { ordered.push(...byCat[0]); continue }        // GK
      if (li === 1)                    { ordered.push(...byCat[1]); continue }        // 1ère ligne = DEF
      if (li === lines.length - 1)     { ordered.push(...byCat[3]); continue }        // dernière ligne = FWD
      // ligne(s) intermédiaire(s) = MID, réparti dans l'ordre API
      const n = lines[li]
      ordered.push(...byCat[2].slice(midIdx, midIdx + n))
      midIdx += n
    }
  }

  // Reliquat (mismatch de comptage entre la formation déclarée et les
  // catégories réellement reçues) : rattaché à la fin plutôt que perdu.
  const placed = new Set(ordered)
  for (const p of starters) if (!placed.has(p)) ordered.push(p)

  return ordered
}

// Coordonnée "ligne:colonne" fournie par api-football (ex: "2:3"), propre à
// CE match — voir commentaire dans useApiFootball.js. Contrairement au champ
// "poste" (registre général du joueur, parfois périmé — cause des DC/DG
// inversés constatés), le grid ne peut pas être faux : il décrit où le
// joueur a réellement été placé sur le schéma tactique publié pour ce match.
function parseGrid(g) {
  if (typeof g !== 'string') return null
  const m = g.match(/^(\d+):(\d+)$/)
  if (!m) return null
  return { row: Number(m[1]), col: Number(m[2]) }
}

// Placement par grid : fiable à 100% quand disponible (tous les titulaires
// doivent l'avoir, sinon on abandonne et on retombe sur l'heuristique
// posCat/formation ci-dessous — pas de mélange partiel, trop risqué).
function getPositionsFromGrid(starters) {
  const byRow = new Map()
  for (const p of starters) {
    const g = parseGrid(p.grid)
    if (!g) return null
    if (!byRow.has(g.row)) byRow.set(g.row, [])
    byRow.get(g.row).push({ p, col: g.col })
  }
  const rows  = [...byRow.keys()].sort((a, b) => a - b)
  const yPcts = LINE_Y[rows.length] ?? LINE_Y[4]
  const out   = []
  rows.forEach((r, li) => {
    const arr = byRow.get(r).sort((a, b) => a.col - b.col)
    const y   = T + (yPcts[li] ?? yPcts[yPcts.length - 1]) * IH
    const n   = arr.length
    arr.forEach((entry, j) => {
      const x = L + (j + 0.5) * IW / n
      out.push({ leftPct: x / PW * 100, topPct: y / PH * 100, player: entry.p })
    })
  })
  return out
}

function getPositions(starters, formation) {
  const fromGrid = getPositionsFromGrid(starters)
  if (fromGrid) return fromGrid

  const parts = (formation ?? '').split('-').map(Number).filter(n => n > 0)
  const valid  = parts.length > 0 && parts.reduce((a, b) => a + b, 0) === starters.length - 1
  const lines  = valid ? [1, ...parts] : fallbackLines(starters)
  const yPcts  = LINE_Y[lines.length] ?? LINE_Y[4]
  const ordered = groupByRealLine(starters, lines)
  const out    = []
  let idx = 0
  for (let li = 0; li < lines.length; li++) {
    const n = lines[li]
    const y = T + yPcts[li] * IH
    for (let j = 0; j < n; j++) {
      const x = L + (j + 0.5) * IW / n
      out.push({
        leftPct: x / PW * 100,
        topPct:  y / PH * 100,
        player:  ordered[idx] ?? null,
      })
      idx++
    }
  }
  return out
}

// ── Dot joueur ────────────────────────────────────────────────────────────────
function PlayerDot({ leftPct, topPct, player, teamColor }) {
  if (!player) return null
  const isGK  = ['GK','G','GB'].includes(stripSide(player.position))
  const color = isGK ? '#f59e0b' : teamColor
  const nm    = formatName(player.name, player.shortName)
  const label = nm.length > 11 ? nm.slice(0, 10) + '.' : nm
  const num   = player.number ?? ''

  return (
    <div style={{
      position:      'absolute',
      left:          `${leftPct}%`,
      top:           `${topPct}%`,
      transform:     'translate(-50%, -50%)',
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'center',
      gap:           'clamp(3px, 1vw, 5px)',
      zIndex:        2,
    }}>
      <div style={{
        width:          'clamp(32px, 9.5vw, 42px)',
        height:         'clamp(32px, 9.5vw, 42px)',
        borderRadius:   '50%',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontSize:       'clamp(12px, 3.4vw, 16px)',
        fontWeight:     800,
        fontFamily:     "'Chakra Petch', monospace",
        color,
        background:     alpha(color, 0.13),
        border:         `1.5px solid ${color}`,
        boxShadow:      `0 0 12px ${alpha(color, 0.4)}, inset 0 0 6px ${alpha(color, 0.1)}`,
        lineHeight:     1,
        flexShrink:     0,
      }}>
        {num}
      </div>
      <span style={{
        fontSize:      'clamp(8.5px, 2.6vw, 11px)',
        fontWeight:    600,
        color:         isGK ? alpha('#f59e0b', 0.65) : 'rgba(255,255,255,0.52)',
        whiteSpace:    'nowrap',
        fontFamily:    "'Chakra Petch', monospace",
        textShadow:    '0 1px 5px rgba(0,0,0,0.95)',
        letterSpacing: '0.01em',
        maxWidth:      'clamp(52px, 15vw, 64px)',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
      }}>
        {label}
      </span>
    </div>
  )
}

// ── Terrain HTML/CSS ──────────────────────────────────────────────────────────
function Pitch({ formation, positions, teamColor }) {
  return (
    <div style={{
      position:    'relative',
      width:       '100%',
      aspectRatio: '3 / 4',
      background:  'linear-gradient(180deg, #0f2214 0%, #0d1e11 50%, #0b1a0e 100%)',
      overflow:    'hidden',
    }}>
      {/* Bandes gazon alternées */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage:
          'repeating-linear-gradient(to bottom,' +
          'rgba(255,255,255,0.022) 0px,' +
          'rgba(255,255,255,0.022) 46px,' +
          'transparent 46px,' +
          'transparent 92px)',
      }} />

      {/* Bordure terrain */}
      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8, bottom: 8,
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 2, pointerEvents: 'none',
      }} />

      {/* Ligne médiane */}
      <div style={{
        position: 'absolute', left: 8, right: 8, top: '50%',
        height: 1, background: 'rgba(255,255,255,0.09)',
        pointerEvents: 'none',
      }} />

      {/* Cercle central */}
      <div style={{
        position:     'absolute', left: '50%', top: '50%',
        width:        '25%', aspectRatio: '1',
        transform:    'translate(-50%, -50%)',
        border:       '1px solid rgba(255,255,255,0.07)',
        borderRadius: '50%', pointerEvents: 'none',
      }} />

      {/* Point central */}
      <div style={{
        position:     'absolute', left: '50%', top: '50%',
        width: 5, height: 5,
        background:   'rgba(255,255,255,0.2)',
        borderRadius: '50%',
        transform:    'translate(-50%, -50%)',
        pointerEvents:'none',
      }} />

      {/* Surface de réparation haute */}
      <div style={{
        position:  'absolute', left: '50%', top: 8,
        width: '49%', height: '14%',
        transform: 'translateX(-50%)',
        border: '1px solid rgba(255,255,255,0.07)', borderTop: 'none',
        pointerEvents: 'none',
      }} />

      {/* Surface de réparation basse */}
      <div style={{
        position:  'absolute', left: '50%', bottom: 8,
        width: '49%', height: '14%',
        transform: 'translateX(-50%)',
        border: '1px solid rgba(255,255,255,0.07)', borderBottom: 'none',
        pointerEvents: 'none',
      }} />

      {/* But haut */}
      <div style={{
        position:  'absolute', left: '50%', top: 8,
        width: '22%', height: '5%',
        transform: 'translateX(-50%)',
        border: '1px solid rgba(255,255,255,0.07)', borderTop: 'none',
        background: 'rgba(255,255,255,0.025)',
        pointerEvents: 'none',
      }} />

      {/* But bas */}
      <div style={{
        position:  'absolute', left: '50%', bottom: 8,
        width: '22%', height: '5%',
        transform: 'translateX(-50%)',
        border: '1px solid rgba(255,255,255,0.07)', borderBottom: 'none',
        background: 'rgba(255,255,255,0.025)',
        pointerEvents: 'none',
      }} />

      {/* Label formation */}
      {formation && (
        <div style={{
          position:      'absolute', top: 13, left: 14,
          fontSize:      9,
          fontWeight:    700,
          letterSpacing: '0.12em',
          color:         'rgba(255,255,255,0.15)',
          fontFamily:    "'Chakra Petch', monospace",
          pointerEvents: 'none',
        }}>
          {formation}
        </div>
      )}

      {/* Joueurs */}
      {positions.map(({ leftPct, topPct, player }, i) =>
        player
          ? <PlayerDot key={i} leftPct={leftPct} topPct={topPct} player={player} teamColor={teamColor} />
          : null
      )}
    </div>
  )
}

// ── Cellule joueur (liste) ────────────────────────────────────────────────────
function PlayerCell({ player, isSub }) {
  const cat      = posCat(player.position)
  const catC     = CAT_COLOR[cat]
  // Si le code brut n'est pas reconnu, `player.position` peut être une chaîne
  // vide (ex: source qui renvoie une catégorie non mappée) — dans ce cas
  // `?? player.position` ne rattrape rien car '' n'est pas null/undefined,
  // et le poste s'affichait invisible plutôt qu'incompréhensible. On retombe
  // désormais sur positionName (texte brut de la source) puis sur '—'.
  const posLabel = POS_LABEL[stripSide(player.position)]
    || player.position
    || player.positionName
    || '—'
  const nm       = formatName(player.name, player.shortName)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px',
      borderTop: '1px solid rgba(255,255,255,0.035)',
      minWidth: 0,
    }}>
      <span style={{
        fontSize:      8,
        fontWeight:    700,
        flexShrink:    0,
        fontFamily:    "'Chakra Petch', monospace",
        letterSpacing: '0.03em',
        color:         isSub ? 'rgba(255,255,255,0.38)' : catC,
        background:    isSub ? 'rgba(255,255,255,0.05)' : alpha(catC, 0.1),
        border:        `1px solid ${isSub ? 'rgba(255,255,255,0.1)' : alpha(catC, 0.28)}`,
        borderRadius:  3,
        padding:       '2px 5px',
        minWidth:      28,
        textAlign:     'center',
      }}>
        {posLabel}
      </span>
      <span style={{
        flex:          1,
        fontSize:      10.5,
        fontWeight:    isSub ? 400 : 500,
        color:         isSub ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.85)',
        whiteSpace:    'nowrap',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        minWidth:      0,
      }}>
        {nm}
      </span>
      <span style={{
        fontSize:   9,
        fontWeight: 700,
        color:      'rgba(255,255,255,0.2)',
        flexShrink: 0,
        fontFamily: "'Chakra Petch', monospace",
      }}>
        {player.number ?? ''}
      </span>
    </div>
  )
}

// ── Grille titulaires / remplaçants ──────────────────────────────────────────
function PlayerGrid({ starters, subs }) {
  const headerStyle = {
    padding:       '5px 10px 4px',
    fontSize:      8,
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
    color:         'rgba(255,255,255,0.22)',
    fontFamily:    "'Chakra Petch', monospace",
  }
  return (
    <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={headerStyle}>Titulaires</div>
        {starters.map((p, i) => <PlayerCell key={i} player={p} isSub={false} />)}
      </div>
      {subs?.length > 0 && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={headerStyle}>⇄ Remplaçants</div>
          {subs.map((p, i) => <PlayerCell key={i} player={p} isSub={true} />)}
        </div>
      )}
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function LineupPitch({ home, away }) {
  const [activeTeam, setActiveTeam] = useState('home')

  // Rouge app pour les deux équipes — cohérent avec le thème
  const hColor = '#ef4444'
  const aColor = '#eadfdfe4'

  if (!home?.starters?.length && !away?.starters?.length) return null

  const team      = activeTeam === 'home' ? home : away
  const teamColor = activeTeam === 'home' ? hColor : aColor
  const positions = getPositions(team.starters ?? [], team.formation)

  return (
    <div style={{
      background:   '#0a0c14',
      borderRadius: '1rem',
      overflow:     'hidden',
      border:       '1px solid rgba(255,255,255,0.07)',
      maxWidth:     '480px',
      margin:       '0 auto',
    }}>
      {/* Onglets équipes */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {[
          { key: 'home', t: home, c: hColor },
          { key: 'away', t: away, c: aColor },
        ].map(({ key, t, c }) => {
          const act = activeTeam === key
          return (
            <button
              key={key}
              onClick={() => setActiveTeam(key)}
              style={{
                flex:          1,
                padding:       '10px 8px',
                cursor:        'pointer',
                background:    act ? alpha(c, 0.08) : 'transparent',
                border:        'none',
                borderBottom:  `2px solid ${act ? c : 'transparent'}`,
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                gap:           3,
                transition:    'all .15s',
              }}
            >
              {t?.crest && (
                <img src={t.crest} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />
              )}
              <span style={{
                fontSize:      10,
                fontWeight:    700,
                fontFamily:    "'Chakra Petch', monospace",
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color:         act ? c : 'rgba(255,255,255,0.35)',
              }}>
                {t?.name ?? key}
              </span>
              {t?.formation && (
                <span style={{
                  fontSize:     9.5,
                  fontFamily:   "'Chakra Petch', monospace",
                  color:        act ? c : 'rgba(255,255,255,0.2)',
                  background:   act ? alpha(c, 0.1) : 'transparent',
                  border:       `1px solid ${act ? alpha(c, 0.3) : 'transparent'}`,
                  borderRadius: 4,
                  padding:      '1px 6px',
                }}>
                  {t.formation}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Terrain */}
      <Pitch formation={team.formation} positions={positions} teamColor={teamColor} />

      {/* Liste joueurs */}
      <PlayerGrid starters={team.starters ?? []} subs={team.subs ?? []} />
    </div>
  )
}
