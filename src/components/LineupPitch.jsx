/**
 * LineupPitch — HTML/CSS version MODERNISÉE
 * Terrain en div CSS propre, joueurs en divs absolus avec design moderne type EA Sports/eFootball.
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

function posCat(pos) {
  const p = (pos ?? '').toUpperCase()
  if (['GK','G','GB'].includes(p)) return 0
  if (['CB','LB','RB','LWB','RWB','D','SW','DC','DL','DR','DD','DG','DEF'].includes(p)) return 1
  if (['CM','CDM','CAM','DM','AM','LM','RM','M','MF','MIL','MDC','MOF','MG','MD','MC'].includes(p)) return 2
  if (['ST','CF','LW','RW','F','FW','ATT','FWD','SS','AC','AG','AD','BU'].includes(p)) return 3
  return 2
}

const POS_FR = {
  GK:'G',  G:'G',   GB:'G',
  CB:'DC',  DC:'DC',  DL:'DG', DR:'DD',
  LB:'DG',  RB:'DD',  LWB:'LG', RWB:'LD',
  D:'DEF',  SW:'LIB', DEF:'DEF',
  CM:'MC',  CDM:'MDC', CAM:'MOC', DM:'MD', AM:'MOC', MC:'MC', MDC:'MDC', MOC:'MOC', MOF:'MOC', MG:'MG', MD:'MD', MC:'MC',
  LM:'MG',  RM:'MD',  M:'MC',  MF:'MC', MIL:'MC',
  ST:'ATT', CF:'AC',  LW:'AG',  RW:'AD',
  F:'BU',  FW:'BU', ATT:'BU', FWD:'ATD', SS:'ATT', BU:'BU',
}

const CAT_COLOR = { 0: '#f59e0b', 1: '#60a5fa', 2: '#34d399', 3: '#ef4444' }

// ── Positionnement ────────────────────────────────────────────────────────────
function fallbackLines(starters) {
  const g = [0, 0, 0, 0]
  for (const p of starters) g[posCat(p.position)]++
  return g.filter(n => n > 0)
}

function getPositions(starters, formation) {
  const parts = (formation ?? '').split('-').map(Number).filter(n => n > 0)
  const valid  = parts.length > 0 && parts.reduce((a, b) => a + b, 0) === starters.length - 1
  const lines  = valid ? [1, ...parts] : fallbackLines(starters)
  const yPcts  = LINE_Y[lines.length] ?? LINE_Y[4]
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
        player:  starters[idx] ?? null,
      })
      idx++
    }
  }
  return out
}

// ── Dot joueur (Modernisé en Capsule Glassmorphism) ──────────────────────────
function PlayerDot({ leftPct, topPct, player, teamColor }) {
  if (!player) return null
  const isGK  = ['GK','G','GB'].includes((player.position ?? '').toUpperCase())
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
      gap:           '6px',
      zIndex:        2,
    }}>
      {/* Badge Numéro Épuré */}
      <div style={{
        width:          'clamp(34px, 9.8vw, 44px)',
        height:         'clamp(34px, 9.8vw, 44px)',
        borderRadius:   '50%',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontSize:       'clamp(12px, 3.5vw, 15px)',
        fontWeight:     700,
        fontFamily:     "'Chakra Petch', monospace",
        color:          '#ffffff',
        background:     `linear-gradient(135deg, ${alpha(color, 0.6)} 0%, ${alpha(color, 0.2)} 100%)`,
        border:         `1.5px solid ${alpha(color, 0.8)}`,
        boxShadow:      `0 4px 12px ${alpha(color, 0.35)}, inset 0 1px 1px rgba(255,255,255,0.2)`,
        lineHeight:     1,
        flexShrink:     0,
        backdropFilter: 'blur(3px)',
      }}>
        {num}
      </div>
      {/* Étiquette Nom Type "Glass" */}
      <span style={{
        fontSize:      'clamp(9px, 2.6vw, 11px)',
        fontWeight:    600,
        color:         '#ffffff',
        whiteSpace:    'nowrap',
        fontFamily:    "'Chakra Petch', monospace",
        background:    'rgba(10, 15, 30, 0.75)',
        border:        '1px solid rgba(255, 255, 255, 0.15)',
        padding:       '2px 8px',
        borderRadius:  '12px',
        boxShadow:     '0 2px 6px rgba(0,0,0,0.4)',
        letterSpacing: '0.02em',
        maxWidth:      'clamp(60px, 18vw, 80px)',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        backdropFilter: 'blur(4px)',
      }}>
        {label}
      </span>
    </div>
  )
}

// ── Terrain HTML/CSS (Look Réaliste Pro) ──────────────────────────────────────
function Pitch({ formation, positions, teamColor }) {
  return (
    <div style={{
      position:    'relative',
      width:       '100%',
      aspectRatio: '3 / 4',
      background:  'linear-gradient(180deg, #112918 0%, #0d1f12 50%, #09170c 100%)',
      overflow:    'hidden',
    }}>
      {/* Bandes de pelouse ultra subtiles */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage:
          'repeating-linear-gradient(to bottom,' +
          'rgba(255,255,255,0.015) 0px,' +
          'rgba(255,255,255,0.015) 35px,' +
          'transparent 35px,' +
          'transparent 70px)',
      }} />

      {/* Lignes du terrain affinées */}
      {/* Bordure externe */}
      <div style={{
        position: 'absolute', top: 12, left: 12, right: 12, bottom: 12,
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 1, pointerEvents: 'none',
      }} />

      {/* Ligne médiane */}
      <div style={{
        position: 'absolute', left: 12, right: 12, top: '50%',
        height: 1, background: 'rgba(255,255,255,0.12)',
        pointerEvents: 'none',
      }} />

      {/* Cercle central */}
      <div style={{
        position:     'absolute', left: '50%', top: '50%',
        width:        '25%', aspectRatio: '1',
        transform:    'translate(-50%, -50%)',
        border:       '1px solid rgba(255,255,255,0.12)',
        borderRadius: '50%', pointerEvents: 'none',
      }} />

      {/* Point central */}
      <div style={{
        position:     'absolute', left: '50%', top: '50%',
        width: 4, height: 4,
        background:   'rgba(255,255,255,0.4)',
        borderRadius: '50%',
        transform:    'translate(-50%, -50%)',
        pointerEvents:'none',
      }} />

      {/* Surface haute */}
      <div style={{
        position:  'absolute', left: '50%', top: 12,
        width: '48%', height: '15%',
        transform: 'translateX(-50%)',
        border: '1px solid rgba(255,255,255,0.12)', borderTop: 'none',
        pointerEvents: 'none',
      }} />

      {/* Surface basse */}
      <div style={{
        position:  'absolute', left: '50%', bottom: 12,
        width: '48%', height: '15%',
        transform: 'translateX(-50%)',
        border: '1px solid rgba(255,255,255,0.12)', borderBottom: 'none',
        pointerEvents: 'none',
      }} />

      {/* Corners (Petits détails pro) */}
      <div style={{ position: 'absolute', top: 12, left: 12, width: 8, height: 8, borderRight: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', borderRadius: '0 0 100% 0' }} />
      <div style={{ position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderLeft: '1px solid rgba(255,255,255,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', borderRadius: '0 0 0 100%' }} />
      <div style={{ position: 'absolute', bottom: 12, left: 12, width: 8, height: 8, borderRight: '1px solid rgba(255,255,255,0.15)', borderTop: '1px solid rgba(255,255,255,0.15)', borderRadius: '0 100% 0 0' }} />
      <div style={{ position: 'absolute', bottom: 12, right: 12, width: 8, height: 8, borderLeft: '1px solid rgba(255,255,255,0.15)', borderTop: '1px solid rgba(255,255,255,0.15)', borderRadius: '100% 0 0 0' }} />

      {/* Filigranne Formation */}
      {formation && (
        <div style={{
          position:      'absolute', top: 18, left: 20,
          fontSize:      10,
          fontWeight:    800,
          letterSpacing: '0.15em',
          color:         'rgba(255,255,255,0.25)',
          fontFamily:    "'Chakra Petch', monospace",
          pointerEvents: 'none',
          textShadow:    '0 1px 2px rgba(0,0,0,0.2)',
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
  const posLabel = POS_FR[(player.position ?? '').toUpperCase()] ?? player.position ?? '—'
  const nm       = formatName(player.name, player.shortName)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 12px',
      borderTop: '1px solid rgba(255,255,255,0.02)',
      minWidth: 0,
    }}>
      <span style={{
        fontSize:      9,
        fontWeight:    700,
        flexShrink:    0,
        fontFamily:    "'Chakra Petch', monospace",
        letterSpacing: '0.02em',
        color:         isSub ? 'rgba(255,255,255,0.4)' : catC,
        background:    isSub ? 'rgba(255,255,255,0.03)' : alpha(catC, 0.08),
        border:        `1px solid ${isSub ? 'rgba(255,255,255,0.08)' : alpha(catC, 0.2)}`,
        borderRadius:  4,
        padding:       '1px 4px',
        minWidth:      26,
        textAlign:     'center',
      }}>
        {posLabel}
      </span>
      <span style={{
        flex:          1,
        fontSize:      11,
        fontWeight:    isSub ? 400 : 500,
        color:         isSub ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)',
        whiteSpace:    'nowrap',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        minWidth:      0,
      }}>
        {nm}
      </span>
      <span style={{
        fontSize:   10,
        fontWeight: 700,
        color:      'rgba(255,255,255,0.25)',
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
    padding:       '8px 12px 6px',
    fontSize:      8.5,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    color:         'rgba(255,255,255,0.3)',
    fontFamily:    "'Chakra Petch', monospace",
    fontWeight:    700,
    background:    'rgba(255,255,255,0.01)',
  }
  return (
    <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.05)', background: '#0e111a' }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.04)' }}>
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

// ── Composant principal (Header Clean & Pro) ──────────────────────────────────
export default function LineupPitch({ home, away }) {
  const [activeTeam, setActiveTeam] = useState('home')

  const hColor = '#ef4444'
  const aColor = '#f3f4f6' // Un blanc/gris cassé plus éclatant que l'ancien hexadécimal invalide

  if (!home?.starters?.length && !away?.starters?.length) return null

  const team      = activeTeam === 'home' ? home : away
  const teamColor = activeTeam === 'home' ? hColor : aColor
  const positions = getPositions(team.starters ?? [], team.formation)

  return (
    <div style={{
      background:   '#090b11',
      borderRadius: '14px',
      overflow:     'hidden',
      border:       '1px solid rgba(255,255,255,0.06)',
      boxShadow:    '0 20px 40px rgba(0,0,0,0.5)',
      maxWidth:     '480px',
      margin:       '0 auto',
    }}>
      {/* Navigation Onglets Épurée */}
      <div style={{ 
        display: 'flex', 
        background: '#0c0f17',
        padding: '6px',
        gap: '4px',
      }}>
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
                padding:       '10px 12px',
                cursor:        'pointer',
                background:    act ? 'rgba(255,255,255,0.04)' : 'transparent',
                borderRadius:  '8px',
                border:        'none',
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                gap:           4,
                transition:    'all 0.2s ease',
                boxShadow:     act ? 'inset 0 1px 0 rgba(255,255,255,0.05)' : 'none',
                position:      'relative',
              }}
            >
              {t?.crest && (
                <img src={t.crest} alt="" style={{ width: 26, height: 26, objectFit: 'contain', filter: act ? 'none' : 'grayscale(30%)' }} />
              )}
              <span style={{
                fontSize:      11,
                fontWeight:    700,
                fontFamily:    "'Chakra Petch', monospace",
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                color:         act ? '#ffffff' : 'rgba(255,255,255,0.4)',
              }}>
                {t?.name ?? key}
              </span>
              
              {/* Petite pillule de formation */}
              {t?.formation && (
                <span style={{
                  fontSize:     9,
                  fontWeight:   600,
                  fontFamily:   "'Chakra Petch', monospace",
                  color:        act ? c : 'rgba(255,255,255,0.3)',
                  background:   act ? alpha(c, 0.12) : 'rgba(255,255,255,0.02)',
                  border:       `1px solid ${act ? alpha(c, 0.3) : 'rgba(255,255,255,0.05)'}`,
                  borderRadius: '4px',
                  padding:      '1px 5px',
                  marginTop:    '2px',
                }}>
                  {t.formation}
                </span>
              )}

              {/* Ligne lumineuse active */}
              {act && (
                <div style={{
                  position: 'absolute', bottom: 0, left: '30%', right: '30%',
                  height: '2px', background: c, borderRadius: '2px 2px 0 0',
                  boxShadow: `0 -2px 6px ${c}`
                }} />
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