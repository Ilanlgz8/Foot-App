/**
 * LineupPitch — Version Premium Tactique & PWA Friendly
 * Prénoms raccourcis (Initiale.), design de carte haut de gamme, et sécurité mobile.
 */
import { useState } from 'react'

// ── Dimensions logiques pour calcul des positions ─────────────────────────────
const PW = 300, PH = 400
const L = 15, R = 285, T = 28, B = 372 // Marges parfaites pour sécuriser le GK et l'ATT sur mobile
const IW = R - L, IH = B - T

const LINE_Y = {
  4: [0.92, 0.68, 0.44, 0.20],
  5: [0.92, 0.74, 0.55, 0.36, 0.16],
  6: [0.92, 0.78, 0.62, 0.46, 0.30, 0.14],
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

// Format strict demandé : I. Nomfamille
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

// ── DESIGN PREMIUM : BADGE JOUEUR TYPE COMPOSITION TV ────────────────────────
function PlayerDot({ leftPct, topPct, player, teamColor }) {
  if (!player) return null
  const isGK  = ['GK','G','GB'].includes((player.position ?? '').toUpperCase())
  const color = isGK ? '#f59e0b' : teamColor
  const label = formatName(player.name, player.shortName)
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
      {/* Conteneur principal de la carte du joueur */}
      <div style={{
        display:       'flex',
        alignItems:    'center',
        background:    'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 100%)',
        border:        `1px solid rgba(255, 255, 255, 0.15)`,
        borderLeft:    `3px solid ${color}`, // Rappel de la couleur d'équipe ultra élégant
        borderRadius:  '6px',
        padding:       '3px 8px 3px 6px',
        boxShadow:     '0 4px 14px rgba(0,0,0,0.45)',
        gap:           '6px',
        backdropFilter:'blur(6px)',
      }}>
        {/* Numéro du joueur stylisé */}
        <span style={{
          fontSize:      'clamp(11px, 3.2vw, 13px)',
          fontWeight:    800,
          fontFamily:    "'Chakra Petch', monospace",
          color:         '#ffffff',
          minWidth:      '14px',
          textAlign:     'center',
        }}>
          {num}
        </span>

        {/* Ligne verticale de séparation interne */}
        <div style={{ width: '1px', height: '12px', background: 'rgba(255,255,255,0.15)' }} />

        {/* Nom au format "I. Nom" */}
        <span style={{
          fontSize:      'clamp(9.5px, 2.7vw, 11px)',
          fontWeight:    700,
          color:         '#ffffff',
          fontFamily:    "'Chakra Petch', sans-serif",
          whiteSpace:    'nowrap',
          letterSpacing: '0.01em',
        }}>
          {label}
        </span>
      </div>
    </div>
  )
}

// ── TERRAIN ROBUSTE POUR ÉCRANS MOBILES PWA ──────────────────────────────────
function Pitch({ formation, positions, teamColor }) {
  return (
    <div style={{
      position:    'relative',
      width:       '100%',
      paddingTop:  '130%', // Ratio vertical sécurisé : empêche le gardien d'être coupé sur mobile
      background:  'linear-gradient(180deg, #0e1e12 0%, #0a140c 100%)',
      overflow:    'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        {/* Tonte de pelouse premium et réaliste */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.01) 0px, rgba(255,255,255,0.01) 35px, transparent 35px, transparent 70px)',
        }} />

        {/* Lignes du terrain épurées (Blanche transparentes) */}
        <div style={{ position: 'absolute', top: 16, left: 16, right: 16, bottom: 16, border: '1px solid rgba(255,255,255,0.14)' }} />
        <div style={{ position: 'absolute', left: 16, right: 16, top: '50%', height: 1, background: 'rgba(255,255,255,0.14)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '24%', aspectRatio: '1', transform: 'translate(-50%, -50%)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 4, height: 4, background: 'rgba(255,255,255,0.3)', borderRadius: '50%', transform: 'translate(-50%, -50%)' }} />

        {/* Surfaces de Réparation */}
        <div style={{ position: 'absolute', left: '50%', top: 16, width: '46%', height: '14%', transform: 'translateX(-50%)', border: '1px solid rgba(255,255,255,0.14)', borderTop: 'none' }} />
        <div style={{ position: 'absolute', left: '50%', bottom: 16, width: '46%', height: '14%', transform: 'translateX(-50%)', border: '1px solid rgba(255,255,255,0.14)', borderBottom: 'none' }} />

        {/* Filigrane tactique moderne */}
        {formation && (
          <div style={{
            position: 'absolute', top: 24, left: 26, fontSize: 10, fontWeight: 800,
            letterSpacing: '0.12em', color: 'rgba(255,255,255,0.25)', fontFamily: "'Chakra Petch', monospace",
          }}>
            {formation}
          </div>
        )}

        {/* Injection des Joueurs */}
        {positions.map(({ leftPct, topPct, player }, i) =>
          player ? <PlayerDot key={i} leftPct={leftPct} topPct={topPct} player={player} teamColor={teamColor} /> : null
        )}
      </div>
    </div>
  )
}

// ── Liste des Joueurs bas de page ─────────────────────────────────────────────
function PlayerCell({ player, isSub }) {
  const cat      = posCat(player.position)
  const catC     = CAT_COLOR[cat]
  const posLabel = POS_FR[(player.position ?? '').toUpperCase()] ?? player.position ?? '—'
  const nm       = formatName(player.name, player.shortName)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
      borderTop: '1px solid rgba(255,255,255,0.03)', minWidth: 0,
    }}>
      <span style={{
        fontSize: 8.5, fontWeight: 700, fontFamily: "'Chakra Petch', monospace",
        color: isSub ? 'rgba(255,255,255,0.35)' : catC,
        background: isSub ? 'rgba(255,255,255,0.03)' : alpha(catC, 0.08),
        border: `1px solid ${isSub ? 'rgba(255,255,255,0.08)' : alpha(catC, 0.22)}`,
        borderRadius: 4, padding: '1px 4px', minWidth: 26, textAlign: 'center',
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
      <span style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.2)', fontFamily: "'Chakra Petch', monospace" }}>
        {player.number ?? ''}
      </span>
    </div>
  )
}

function PlayerGrid({ starters, subs }) {
  const headerStyle = {
    padding: '7px 12px', fontSize: 8.5, letterSpacing: '1.2px', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.25)', fontFamily: "'Chakra Petch', monospace", fontWeight: 700
  }
  return (
    <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#090b11' }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.05)' }}>
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

// ── Composant Principal Final Pro ─────────────────────────────────────────────
export default function LineupPitch({ home, away }) {
  const [activeTeam, setActiveTeam] = useState('home')

  const hColor = '#ef4444'
  const aColor = '#cbd5e1' // Gris métal clair ultra pro pour l'extérieur

  if (!home?.starters?.length && !away?.starters?.length) return null

  const team      = activeTeam === 'home' ? home : away
  const teamColor = activeTeam === 'home' ? hColor : aColor
  const positions = getPositions(team.starters ?? [], team.formation)

  return (
    <div style={{
      background:   '#05060a',
      borderRadius: '14px',
      overflow:     'hidden',
      border:       '1px solid rgba(255,255,255,0.07)',
      maxWidth:     '450px',
      margin:       '0 auto',
      boxShadow:    '0 16px 40px rgba(0,0,0,0.6)',
    }}>
      {/* Onglets Équipes */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#090c12' }}>
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
                padding:       '12px 8px',
                cursor:        'pointer',
                background:    act ? alpha(c, 0.04) : 'transparent',
                border:        'none',
                borderBottom:  `2px solid ${act ? c : 'transparent'}`,
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                gap:           4,
                transition:    'all .2s ease',
              }}
            >
              {t?.crest && (
                <img src={t.crest} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />
              )}
              <span style={{
                fontSize:      11,
                fontWeight:    700,
                fontFamily:    "'Chakra Petch', monospace",
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color:         act ? '#ffffff' : 'rgba(255,255,255,0.4)',
              }}>
                {t?.name ?? key}
              </span>
              {t?.formation && (
                <span style={{
                  fontSize:     9,
                  fontFamily:   "'Chakra Petch', monospace",
                  color:        act ? c : 'rgba(255,255,255,0.2)',
                  background:   act ? alpha(c, 0.1) : 'transparent',
                  border:       `1px solid ${act ? alpha(c, 0.25) : 'transparent'}`,
                  borderRadius: 4,
                  padding:      '0px 5px',
                }}>
                  {t.formation}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Terrain Adaptatif Mobile / PWA */}
      <Pitch formation={team.formation} positions={positions} teamColor={teamColor} />

      {/* Liste joueurs */}
      <PlayerGrid starters={team.starters ?? []} subs={team.subs ?? []} />
    </div>
  )
}