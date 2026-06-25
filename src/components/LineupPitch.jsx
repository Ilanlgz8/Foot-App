/**
 * LineupPitch — Concept A
 * • Un onglet par équipe (home / away)
 * • Terrain SVG pleine largeur, GK en bas, ATT en haut
 * • Schéma tactique "4-3-3" affiché sur le terrain (haut gauche)
 * • Maillots SVG blancs (gardien ambre), numéro visible, nom "P. Nom"
 * • Liste 2 colonnes compacte dessous — remplaçants estompés
 */
import { useState } from 'react'

// ── Dimensions SVG ─────────────────────────────────────────────────────────────
const PW = 300, PH = 400
const L = 10, R = 290, T = 10, B = 390
const IW = R - L, IH = B - T
const CX = (L + R) / 2
const CY = (T + B) / 2

// ── Fractions Y (GK bas → ATT haut) ───────────────────────────────────────────
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
  GK:'GB',  G:'GB',   GB:'GB',
  CB:'DC',  DC:'DC',  DL:'DG', DR:'DD',
  LB:'DG',  RB:'DD',  LWB:'PG', RWB:'PD',
  D:'DEF',  SW:'LIB', DEF:'DEF',
  CM:'MC',  CDM:'MDC', CAM:'MOF', DM:'MDC', AM:'MOF',
  LM:'MG',  RM:'MD',  M:'MIL',  MF:'MIL', MIL:'MIL',
  ST:'ATT', CF:'AC',  LW:'AG',  RW:'AD',
  F:'ATT',  FW:'ATT', ATT:'ATT', FWD:'ATT', SS:'ATT', BU:'ATT',
}

// couleurs par catégorie de poste (utilisées dans PlayerCell)
const CAT_COLOR = { 0: '#f59e0b', 1: '#60a5fa', 2: '#34d399', 3: '#ef4444' }

// ── Positionnement ────────────────────────────────────────────────────────────
function fallbackLines(starters) {
  const g = [0, 0, 0, 0]
  for (const p of starters) g[posCat(p.position)]++
  return g.filter(n => n > 0)
}

function getPositions(starters, formation) {
  const parts = (formation ?? '').split('-').map(Number).filter(n => n > 0)
  const valid = parts.length > 0 && parts.reduce((a, b) => a + b, 0) === starters.length - 1
  const lines = valid ? [1, ...parts] : fallbackLines(starters)
  const yPcts = LINE_Y[lines.length] ?? LINE_Y[4]
  const out = []
  let idx = 0
  for (let li = 0; li < lines.length; li++) {
    const n = lines[li]
    const y = T + yPcts[li] * IH
    for (let j = 0; j < n; j++) {
      out.push({ x: L + (j + 0.5) * IW / n, y, player: starters[idx] ?? null })
      idx++
    }
  }
  return out
}

// ── Jersey SVG — Style E (flat modern, fond sombre, numéro haut) ──────────────
const JERSEY_PATH =
  'M -4,-22 L -12,-20 L -24,-10 L -24,-3 L -14,-6 L -14,20 L 14,20 L 14,-6 L 24,-3 L 24,-10 L 14,-20 L 4,-22 Q 0,-18 -4,-22 Z'

function PlayerIcon({ x, y, player }) {
  if (!player) return null
  const isGK   = ['GK','G','GB'].includes((player.position ?? '').toUpperCase())
  const stroke = isGK ? '#f59e0b' : '#ef4444'
  const bgFill = isGK ? 'rgba(6,4,0,0.97)' : 'rgba(8,3,3,0.97)'
  const num    = player.number ?? ''
  const label  = (() => {
    const nm = formatName(player.name, player.shortName)
    return nm.length > 12 ? nm.slice(0, 11) + '.' : nm
  })()

  return (
    <g transform={`translate(${x},${y})`}>
      <path d={JERSEY_PATH} fill={bgFill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
      <text x="0" y="-4" textAnchor="middle" dominantBaseline="middle"
        fill={stroke} fontSize="13" fontWeight="800"
        fontFamily="'Chakra Petch',monospace,Arial">{num}</text>
      <text x="0" y="30" textAnchor="middle" dominantBaseline="middle"
        fill="rgba(255,255,255,0.65)" fontSize="8"
        fontFamily="'Chakra Petch',monospace,Arial"
        stroke="rgba(0,0,0,0.9)" strokeWidth="2.5" paintOrder="stroke">{label}</text>
    </g>
  )
}

// ── Terrain ───────────────────────────────────────────────────────────────────
function PitchMarkings({ formation }) {
  const S   = 'rgba(255,255,255,0.14)'
  const PAH = 78, PAW = 176, GAH = 30, GAW = 92, GW = 52
  const pxL = CX - PAW / 2, pxR = CX + PAW / 2
  const gxL = CX - GAW / 2
  const glL = CX - GW / 2

  return (
    <g>
      <rect x={0} y={0} width={PW} height={PH} fill="#06060d" />
      {/* Bandes alternées très subtiles */}
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={L} y={T + i * (IH / 8)} width={IW} height={IH / 8}
          fill={i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0)'} />
      ))}
      <rect x={L} y={T} width={IW} height={IH} fill="none" stroke={S} strokeWidth="1.2" />
      <line x1={L} y1={CY} x2={R} y2={CY} stroke={S} strokeWidth="1.2" />
      <circle cx={CX} cy={CY} r={38} fill="none" stroke={S} strokeWidth="1.2" />
      <circle cx={CX} cy={CY} r={3} fill={S} />
      <rect x={pxL} y={T} width={PAW} height={PAH} fill="none" stroke={S} strokeWidth="1" />
      <rect x={gxL} y={T} width={GAW} height={GAH} fill="none" stroke={S} strokeWidth="0.9" />
      <rect x={glL} y={T - 8} width={GW} height={8} fill="rgba(255,255,255,0.04)" stroke={S} strokeWidth="0.9" />
      <circle cx={CX} cy={T + 52} r={2} fill={S} />
      <path d={`M ${pxL},${T + PAH} A 38,38 0 0 1 ${pxR},${T + PAH}`} fill="none" stroke={S} strokeWidth="0.9" />
      <rect x={pxL} y={B - PAH} width={PAW} height={PAH} fill="none" stroke={S} strokeWidth="1" />
      <rect x={gxL} y={B - GAH} width={GAW} height={GAH} fill="none" stroke={S} strokeWidth="0.9" />
      <rect x={glL} y={B} width={GW} height={8} fill="rgba(255,255,255,0.04)" stroke={S} strokeWidth="0.9" />
      <circle cx={CX} cy={B - 52} r={2} fill={S} />
      <path d={`M ${pxL},${B - PAH} A 38,38 0 0 0 ${pxR},${B - PAH}`} fill="none" stroke={S} strokeWidth="0.9" />
      {[[L + 8, T, 0],[R - 8, T, 1],[L + 8, B, 0],[R - 8, B, 1]].map(([cx2, cy2, sw], i) => (
        <path key={i}
          d={`M ${cx2},${cy2} A 8,8 0 0,${sw} ${cx2 < CX ? L : R},${cy2 < CY ? T + 8 : B - 8}`}
          fill="none" stroke={S} strokeWidth="0.8" />
      ))}
      {formation && (
        <text x={L + 6} y={T + 13} fontSize="10" fontWeight="700"
          fill="rgba(239,68,68,0.4)" fontFamily="'Chakra Petch',monospace,Arial"
          letterSpacing="1">{formation}</text>
      )}
    </g>
  )
}

// ── Titulaires gauche / Remplaçants droite ────────────────────────────────────
function PlayerGrid({ starters, subs, color }) {
  const headerStyle = {
    padding: '5px 8px 4px',
    fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.32)',
    fontFamily: "'Chakra Petch',monospace,Arial",
  }

  return (
    <div style={{
      display: 'flex',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* ── Titulaires — colonne gauche ── */}
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={headerStyle}>Titulaires</div>
        {starters.map((p, i) => <PlayerCell key={i} player={p} isSub={false} />)}
      </div>

      {/* ── Remplaçants — colonne droite ── */}
      {subs?.length > 0 && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={headerStyle}>⇄ Rempl.</div>
          {subs.map((p, i) => <PlayerCell key={i} player={p} isSub={true} />)}
        </div>
      )}
    </div>
  )
}

function PlayerCell({ player, isSub }) {
  const cat      = posCat(player.position)
  const catC     = CAT_COLOR[cat]
  const posLabel = POS_FR[(player.position ?? '').toUpperCase()] ?? player.position ?? ''
  const nm       = formatName(player.name, player.shortName)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 8px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      minWidth: 0,
    }}>
      {/* Badge poste */}
      <span style={{
        fontSize: 9, fontWeight: 700, flexShrink: 0,
        fontFamily: "'Chakra Petch',monospace,Arial",
        letterSpacing: '0.04em',
        color:      isSub ? 'rgba(255,255,255,0.55)' : catC,
        background: isSub ? 'rgba(255,255,255,0.07)' : `${catC}18`,
        border:     `1px solid ${isSub ? 'rgba(255,255,255,0.16)' : catC + '44'}`,
        borderRadius: 4, padding: '2px 4px',
        minWidth: 26, textAlign: 'center',
      }}>
        {posLabel || '—'}
      </span>
      {/* Nom */}
      <span style={{
        flex: 1, fontSize: 11,
        fontWeight: isSub ? 400 : 500,
        color: isSub ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.9)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        minWidth: 0,
      }}>
        {nm}
      </span>
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function LineupPitch({ home, away }) {
  const [activeTeam, setActiveTeam] = useState('home')

  const hColor = safeColor(home?.color) ?? '#ef4444'
  const aColor = safeColor(away?.color) ?? '#3b82f6'

  if (!home?.starters?.length && !away?.starters?.length) return null

  const team      = activeTeam === 'home' ? home : away
  const color     = activeTeam === 'home' ? hColor : aColor
  const positions = getPositions(team.starters ?? [], team.formation)

  return (
    <div style={{
      background: '#06060d',
      borderRadius: '1rem', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.07)',
    }}>

      {/* ── Onglets équipes ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {[
          { key: 'home', t: home,  c: hColor },
          { key: 'away', t: away,  c: aColor },
        ].map(({ key, t, c }) => {
          const act = activeTeam === key
          return (
            <button key={key}
              onClick={() => setActiveTeam(key)}
              style={{
                flex: 1, padding: '10px 8px', cursor: 'pointer',
                background: act ? `${c}14` : 'transparent',
                border: 'none',
                borderBottom: `2px solid ${act ? c : 'transparent'}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                transition: 'all .15s',
              }}
            >
              {t?.crest && (
                <img src={t.crest} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />
              )}
              <span style={{
                fontSize: 11, fontWeight: 700,
                fontFamily: "'Chakra Petch',monospace,Arial",
                textTransform: 'uppercase', letterSpacing: '0.04em',
                color: act ? c : 'rgba(255,255,255,0.38)',
              }}>
                {t?.name ?? key}
              </span>
              {t?.formation && (
                <span style={{
                  fontSize: 10, fontFamily: "'Chakra Petch',monospace,Arial",
                  color:      act ? c : 'rgba(255,255,255,0.22)',
                  background: act ? `${c}18` : 'transparent',
                  border:     `1px solid ${act ? c + '40' : 'transparent'}`,
                  borderRadius: 4, padding: '1px 6px',
                }}>
                  {t.formation}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Terrain SVG — capé à 380px pour éviter un rendu géant sur desktop ── */}
      <svg viewBox={`0 0 ${PW} ${PH}`} width="100%" style={{ display: 'block', maxWidth: 380, margin: '0 auto' }} aria-label="Composition">
        <PitchMarkings formation={team.formation} />
        {positions.map(({ x, y, player }, i) =>
          player ? <PlayerIcon key={i} x={x} y={y} player={player} /> : null
        )}
      </svg>

      {/* ── Liste 2 colonnes ── */}
      <PlayerGrid
        starters={team.starters ?? []}
        subs={team.subs ?? []}
        color={color}
      />
    </div>
  )
}
