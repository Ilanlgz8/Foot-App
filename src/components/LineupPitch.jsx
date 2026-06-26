/**
 * LineupPitch — Version Ultra-Réaliste 3D (Style EA FC)
 * Logique intacte, design entièrement refondu avec perspective et ombrages.
 */
import { useState } from 'react'

// ── Dimensions logiques pour calcul des positions (Inchangé) ─────────────────
const PW = 300, PH = 400
const L = 10, R = 290, T = 10, B = 390
const IW = R - L, IH = B - T

const LINE_Y = {
  4: [0.91, 0.66, 0.43, 0.19],
  5: [0.91, 0.73, 0.54, 0.34, 0.15],
  6: [0.91, 0.76, 0.60, 0.44, 0.28, 0.12],
}

// ── Helpers (Inchangé) ────────────────────────────────────────────────────────
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

// ── NOUVEAU : Joueur 3D Réaliste ─────────────────────────────────────────────
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
      zIndex:        2,
    }}>
      {/* Ombre au sol pour l'effet de suspension 3D */}
      <div style={{
        position: 'absolute',
        bottom: '-6px',
        width: '30px',
        height: '8px',
        background: 'rgba(0,0,0,0.5)',
        borderRadius: '50%',
        filter: 'blur(3px)',
        transform: 'scaleY(0.4)',
        pointerEvents: 'none',
      }} />

      {/* Rond du joueur "3D Maillot" */}
      <div style={{
        width:          'clamp(34px, 9.8vw, 44px)',
        height:         'clamp(34px, 9.8vw, 44px)',
        borderRadius:   '50%',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontSize:       'clamp(13px, 3.6vw, 16px)',
        fontWeight:     800,
        fontFamily:     "'Chakra Petch', monospace",
        color:          '#ffffff',
        background:     `radial-gradient(circle at top, ${color} 0%, ${alpha(color, 0.6)} 100%)`,
        border:         '2px solid #ffffff',
        boxShadow:      `0 8px 16px rgba(0,0,0,0.4), inset 0 2px 3px rgba(255,255,255,0.3)`,
        lineHeight:     1,
        flexShrink:     0,
        transform:      'translateY(-4px)', // Soulève le joueur du terrain
        animation:      'float 3s ease-in-out infinite',
      }}>
        {num}
      </div>

      {/* Capsule Nom "Glassmorphism" Pro */}
      <span style={{
        fontSize:       'clamp(9px, 2.5vw, 11px)',
        fontWeight:     700,
        color:          '#ffffff',
        whiteSpace:     'nowrap',
        fontFamily:     "'Chakra Petch', monospace",
        background:     'rgba(6, 11, 25, 0.85)',
        border:         '1px solid rgba(255, 255, 255, 0.15)',
        borderTop:      `2px solid ${color}`,
        padding:        '2px 8px',
        borderRadius:   '4px',
        boxShadow:      '0 4px 10px rgba(0,0,0,0.3)',
        letterSpacing:  '0.02em',
        maxWidth:       'clamp(60px, 16vw, 76px)',
        overflow:       'hidden',
        textOverflow:   'ellipsis',
      }}>
        {label}
      </span>
    </div>
  )
}

// ── NOUVEAU : Pitch avec Perspective Éclairée ────────────────────────────────
function Pitch({ formation, positions, teamColor }) {
  return (
    <div style={{
      width:       '100%',
      aspectRatio: '3 / 4',
      background:  '#051107',
      perspective: '700px', // Donne l'effet de profondeur 3D
      overflow:    'hidden',
      position:    'relative',
    }}>
      {/* Conteneur incliné */}
      <div style={{
        position: 'absolute',
        inset: '-12% -8%',
        transform: 'rotateX(22deg)', // Inclinaison type retransmission TV
        transformOrigin: 'bottom center',
        background: 'radial-gradient(circle at 50% 30%, #1e4e26 0%, #0d2812 65%, #051408 100%)',
        boxShadow: 'inset 0 0 80px rgba(0,0,0,0.7)',
      }}>
        {/* Bandes de pelouse fines */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 30px, transparent 30px, transparent 60px)'
        }} />

        {/* Lignes réglementaires épaissies pour la perspective */}
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12, bottom: 12, border: '1.5px solid rgba(255,255,255,0.18)' }} />
        <div style={{ position: 'absolute', left: 12, right: 12, top: '50%', height: 1.5, background: 'rgba(255,255,255,0.18)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '28%', aspectRatio: '1', transform: 'translate(-50%, -50%)', border: '1.5px solid rgba(255,255,255,0.18)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 4, height: 4, background: 'rgba(255,255,255,0.4)', borderRadius: '50%', transform: 'translate(-50%, -50%)' }} />

        {/* Surfaces de réparation */}
        <div style={{ position: 'absolute', left: '50%', top: 12, width: '48%', height: '15%', transform: 'translateX(-50%)', border: '1.5px solid rgba(255,255,255,0.18)', borderTop: 'none' }} />
        <div style={{ position: 'absolute', left: '50%', bottom: 12, width: '48%', height: '15%', transform: 'translateX(-50%)', border: '1.5px solid rgba(255,255,255,0.18)', borderBottom: 'none' }} />

        {/* Label Formation en filigrane technique */}
        {formation && (
          <div style={{
            position: 'absolute', top: 22, left: 24, fontSize: 11, fontWeight: 900,
            letterSpacing: '0.15em', color: 'rgba(255,255,255,0.25)', fontFamily: "'Chakra Petch', monospace",
          }}>
            {formation}
          </div>
        )}

        {/* Injection des Joueurs positionnés au bon endroit */}
        {positions.map(({ leftPct, topPct, player }, i) =>
          player ? <PlayerDot key={i} leftPct={leftPct} topPct={topPct} player={player} teamColor={teamColor} /> : null
        )}
      </div>
    </div>
  )
}

// ── Cellule joueur (Inchangé mais rafraîchi) ──────────────────────────────────
function PlayerCell({ player, isSub }) {
  const cat      = posCat(player.position)
  const catC     = CAT_COLOR[cat]
  const posLabel = POS_FR[(player.position ?? '').toUpperCase()] ?? player.position ?? '—'
  const nm       = formatName(player.name, player.shortName)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
      borderTop: '1px solid rgba(255,255,255,0.02)', background: 'rgba(10,14,24,0.3)',
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, fontFamily: "'Chakra Petch', monospace",
        color: isSub ? 'rgba(255,255,255,0.35)' : catC,
        background: isSub ? 'rgba(255,255,255,0.03)' : alpha(catC, 0.08),
        border: `1px solid ${isSub ? 'rgba(255,255,255,0.08)' : alpha(catC, 0.28)}`,
        borderRadius: 4, padding: '2px 5px', minWidth: 26, textAlign: 'center',
      }}>
        {posLabel}
      </span>
      <span style={{
        flex: 1, fontSize: 11, fontWeight: isSub ? 400 : 500,
        color: isSub ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {nm}
      </span>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.25)', fontFamily: "'Chakra Petch', monospace" }}>
        {player.number ?? ''}
      </span>
    </div>
  )
}

// ── Grille Listes (Inchangé) ──────────────────────────────────────────────────
function PlayerGrid({ starters, subs }) {
  const headerStyle = {
    padding: '8px 12px', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)', fontFamily: "'Chakra Petch', monospace", fontWeight: 700,
    background: '#0d111b', borderBottom: '1px solid rgba(255,255,255,0.03)'
  }
  return (
    <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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

// ── Composant Principal Modernisé ─────────────────────────────────────────────
export default function LineupPitch({ home, away }) {
  const [activeTeam, setActiveTeam] = useState('home')

  const hColor = '#ef4444'
  const aColor = '#f3f4f6' // Blanc éclatant propre

  if (!home?.starters?.length && !away?.starters?.length) return null

  const team      = activeTeam === 'home' ? home : away
  const teamColor = activeTeam === 'home' ? hColor : aColor
  const positions = getPositions(team.starters ?? [], team.formation)

  return (
    <div style={{
      background:   '#07090e',
      borderRadius: '16px',
      overflow:     'hidden',
      border:       '1px solid rgba(255,255,255,0.06)',
      boxShadow:    '0 24px 48px rgba(0,0,0,0.6)',
      maxWidth:     '480px',
      margin:       '0 auto',
    }}>
      {/* Onglets Tactiques Épurés */}
      <div style={{ display: 'flex', background: '#0b0e14', padding: '6px', gap: '6px' }}>
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
                background:    act ? 'rgba(255,255,255,0.04)' : 'transparent',
                borderRadius:  '10px',
                border:        'none',
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                gap:           4,
                transition:    'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                position:      'relative',
              }}
            >
              {t?.crest && (
                <img src={t.crest} alt="" style={{ width: 26, height: 26, objectFit: 'contain', filter: act ? 'none' : 'grayscale(40%) opacity(0.5)' }} />
              )}
              <span style={{
                fontSize:      11,
                fontWeight:    700,
                fontFamily:    "'Chakra Petch', monospace",
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color:         act ? '#ffffff' : 'rgba(255,255,255,0.35)',
              }}>
                {t?.name ?? key}
              </span>
              {t?.formation && (
                <span style={{
                  fontSize:     9,
                  fontFamily:   "'Chakra Petch', monospace",
                  color:        act ? c : 'rgba(255,255,255,0.25)',
                  background:   act ? alpha(c, 0.12) : 'rgba(255,255,255,0.02)',
                  border:       `1px solid ${act ? alpha(c, 0.35) : 'rgba(255,255,255,0.05)'}`,
                  borderRadius: 4,
                  padding:      '1px 5px',
                }}>
                  {t.formation}
                </span>
              )}
              
              {/* Ligne d'activation lumineuse au bas du bouton active */}
              {act && (
                <div style={{
                  position: 'absolute', bottom: 0, left: '35%', right: '35%',
                  height: '2px', background: c, borderRadius: '2px 2px 0 0',
                  boxShadow: `0 -2px 8px ${c}, 0 0 12px ${c}`
                }} />
              )}
            </button>
          )
        })}
      </div>

      {/* Terrain 3D */}
      <Pitch formation={team.formation} positions={positions} teamColor={teamColor} />

      {/* Liste des Joueurs */}
      <PlayerGrid starters={team.starters ?? []} subs={team.subs ?? []} />
    </div>
  )
}