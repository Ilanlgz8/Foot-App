/**
 * LineupPitch — composition futuriste
 * • Un onglet par équipe — chaque équipe occupe tout le terrain
 * • GK en bas, ATT en haut (sens d'attaque)
 * • Maillots SVG avec numéro (gros) + nom "P. Nom" en dessous
 * • Liste joueurs : postes en français, remplaçants en blanc estompé
 */
import { useState } from 'react'

// ── Dimensions SVG ─────────────────────────────────────────────────────────────
const PW = 300, PH = 420
const L = 10, R = 290, T = 10, B = 410
const IW = R - L, IH = B - T
const CX = (L + R) / 2
const CY = (T + B) / 2

// ── Fractions Y (GK bas → ATT haut) ───────────────────────────────────────────
const LINE_Y = {
  4: [0.92, 0.67, 0.44, 0.20],
  5: [0.92, 0.73, 0.54, 0.35, 0.16],
  6: [0.92, 0.76, 0.60, 0.44, 0.28, 0.12],
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function safeColor(raw) {
  if (!raw) return null
  return raw.startsWith('#') ? raw : `#${raw}`
}

function isDark(hex) {
  if (!hex || hex.length < 7) return true
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b < 148
}

function formatName(name, sname) {
  const n = (name || sname || '?').trim()
  const parts = n.split(/\s+/)
  if (parts.length === 1) return parts[0]
  return parts[0][0].toUpperCase() + '. ' + parts.slice(1).join(' ')
}

// ── Catégorie poste ────────────────────────────────────────────────────────────
function posCat(pos) {
  const p = (pos ?? '').toUpperCase()
  if (['GK', 'G', 'GB'].includes(p))                                                           return 0
  if (['CB','LB','RB','LWB','RWB','D','SW','DC','DL','DR','DD','DG','DEF'].includes(p))        return 1
  if (['CM','CDM','CAM','DM','AM','LM','RM','M','MF','MIL','MDC','MOF','MG','MD','MC'].includes(p)) return 2
  if (['ST','CF','LW','RW','F','FW','ATT','FWD','SS','AC','AG','AD','BU'].includes(p))         return 3
  return 2
}

// ── Poste → libellé français ───────────────────────────────────────────────────
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

const CAT_COLOR = { 0: '#f59e0b', 1: '#3b82f6', 2: '#10b981', 3: '#ef4444' }
const GK_COLOR  = '#b45309'

// ── Positionnement joueurs ─────────────────────────────────────────────────────
function fallbackLines(starters) {
  const g = [0, 0, 0, 0]
  for (const p of starters) g[posCat(p.position)]++
  return g.filter(n => n > 0)
}

function getPositions(starters, formation) {
  const parts  = (formation ?? '').split('-').map(Number).filter(n => n > 0)
  const valid  = parts.length > 0 && parts.reduce((a, b) => a + b, 0) === starters.length - 1
  const lines  = valid ? [1, ...parts] : fallbackLines(starters)
  const yPcts  = LINE_Y[lines.length] ?? LINE_Y[4]

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

// ── Jersey SVG path (centré sur 0,0) ──────────────────────────────────────────
// Col V (−4,−13) → (0,−6) → (4,−13)
// Manchons : gauche jusqu'à x=−17, droit jusqu'à x=17
// Corps : x=−10 à x=10, y=−6 à y=13
const JERSEY_PATH =
  'M -4,-13 L -11,-10 L -17,-5 L -16,-2 L -10,-6 L -10,13 L 10,13 L 10,-6 L 16,-2 L 17,-5 L 11,-10 L 4,-13 L 0,-6 Z'

// ── Icône joueur (maillot) ────────────────────────────────────────────────────
function PlayerIcon({ x, y, player, color }) {
  if (!player) return null
  const c    = safeColor(color) ?? '#ef4444'
  const isGK = ['GK', 'G', 'GB'].includes((player.position ?? '').toUpperCase())
  const fc   = isGK ? GK_COLOR : c
  const textC = isDark(fc) ? '#fff' : '#111'
  const num  = player.number ?? ''
  const label = (() => {
    const nm = formatName(player.name, player.shortName)
    return nm.length > 12 ? nm.slice(0, 11) + '.' : nm
  })()

  return (
    <g transform={`translate(${x},${y})`}>
      {/* Ombre portée */}
      <path d={JERSEY_PATH} fill="rgba(0,0,0,0.35)" transform="translate(1.5,2)" />
      {/* Corps du maillot */}
      <path d={JERSEY_PATH} fill={fc} stroke="rgba(0,0,0,0.7)" strokeWidth="1" />
      {/* Col V */}
      <path d="M -4,-13 L 0,-6 L 4,-13" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.1" />
      {/* Liseré poitrine */}
      <line x1="-8" y1="-2" x2="8" y2="-2" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
      {/* Numéro — grand et lisible */}
      <text
        x="0" y="5.5" textAnchor="middle" dominantBaseline="middle"
        fill={textC} fontSize="14" fontWeight="700"
        fontFamily="'Chakra Petch',monospace,Arial"
        stroke={isDark(fc) ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)'}
        strokeWidth="1.5" paintOrder="stroke"
      >
        {num}
      </text>
      {/* Nom sous le maillot */}
      <text
        x="0" y="24" textAnchor="middle" dominantBaseline="middle"
        fill="rgba(255,255,255,0.9)" fontSize="6.2"
        fontFamily="'Chakra Petch',monospace,Arial"
        stroke="rgba(0,0,0,0.85)" strokeWidth="2" paintOrder="stroke"
      >
        {label}
      </text>
    </g>
  )
}

// ── Marquages terrain ─────────────────────────────────────────────────────────
function PitchMarkings() {
  const S   = 'rgba(255,255,255,0.55)'
  const PAH = 78, PAW = 176, GAH = 30, GAW = 92, GW = 52
  const pxL = CX - PAW / 2, pxR = CX + PAW / 2
  const gxL = CX - GAW / 2
  const glL = CX - GW / 2

  return (
    <g>
      <rect x={0} y={0} width={PW} height={PH} fill="#122012" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={L} y={T + i * (IH / 8)} width={IW} height={IH / 8}
          fill={i % 2 === 0 ? 'rgba(0,0,0,0.13)' : 'rgba(0,0,0,0)'} />
      ))}
      {/* Cadre */}
      <rect x={L} y={T} width={IW} height={IH} fill="none" stroke={S} strokeWidth="1.5" />
      {/* Ligne médiane */}
      <line x1={L} y1={CY} x2={R} y2={CY} stroke={S} strokeWidth="1.5" />
      {/* Rond central */}
      <circle cx={CX} cy={CY} r={38} fill="none" stroke={S} strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r={3} fill={S} />
      {/* Surface haut */}
      <rect x={pxL} y={T} width={PAW} height={PAH} fill="none" stroke={S} strokeWidth="1.3" />
      <rect x={gxL} y={T} width={GAW} height={GAH} fill="none" stroke={S} strokeWidth="1.1" />
      <rect x={glL} y={T - 8} width={GW} height={8} fill="rgba(255,255,255,0.08)" stroke={S} strokeWidth="1.2" />
      <circle cx={CX} cy={T + 52} r={2.5} fill={S} />
      <path d={`M ${pxL},${T + PAH} A 38,38 0 0 1 ${pxR},${T + PAH}`} fill="none" stroke={S} strokeWidth="1.1" />
      {/* Surface bas */}
      <rect x={pxL} y={B - PAH} width={PAW} height={PAH} fill="none" stroke={S} strokeWidth="1.3" />
      <rect x={gxL} y={B - GAH} width={GAW} height={GAH} fill="none" stroke={S} strokeWidth="1.1" />
      <rect x={glL} y={B} width={GW} height={8} fill="rgba(255,255,255,0.08)" stroke={S} strokeWidth="1.2" />
      <circle cx={CX} cy={B - 52} r={2.5} fill={S} />
      <path d={`M ${pxL},${B - PAH} A 38,38 0 0 0 ${pxR},${B - PAH}`} fill="none" stroke={S} strokeWidth="1.1" />
      {/* Arcs de coin */}
      {[
        [L + 8, T,     0],
        [R - 8, T,     1],
        [L + 8, B,     0],
        [R - 8, B,     1],
      ].map(([cx2, cy2, sw], i) => (
        <path key={i}
          d={`M ${cx2},${cy2} A 8,8 0 0,${sw} ${cx2 < CX ? L : R},${cy2 < CY ? T + 8 : B - 8}`}
          fill="none" stroke={S} strokeWidth="1" />
      ))}
    </g>
  )
}

// ── Ligne joueur (liste) ───────────────────────────────────────────────────────
function PlayerRow({ player, color, isSub }) {
  const c        = safeColor(color) ?? '#ef4444'
  const cat      = posCat(player.position)
  const catC     = CAT_COLOR[cat]
  const posLabel = POS_FR[(player.position ?? '').toUpperCase()] ?? player.position ?? ''
  const nm       = formatName(player.name, player.shortName)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '7px 12px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      {/* Numéro */}
      <span style={{
        width: 26, height: 26, borderRadius: 7, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, fontFamily: "'Chakra Petch',sans-serif",
        background: isSub ? 'rgba(255,255,255,0.06)' : `${c}22`,
        border:     `1px solid ${isSub ? 'rgba(255,255,255,0.12)' : c + '50'}`,
        color:      isSub ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.95)',
      }}>
        {player.number}
      </span>
      {/* Nom */}
      <span style={{
        flex: 1, fontSize: 13,
        fontWeight: isSub ? 400 : 600,
        color: isSub ? 'rgba(255,255,255,0.52)' : 'rgba(255,255,255,0.92)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {nm}
      </span>
      {/* Poste */}
      {posLabel && (
        <span style={{
          fontSize: 9.5, fontWeight: 700,
          fontFamily: "'Chakra Petch',sans-serif",
          letterSpacing: '0.06em',
          borderRadius: 5, padding: '2px 6px', flexShrink: 0,
          color:      isSub ? 'rgba(255,255,255,0.28)' : catC,
          background: isSub ? 'rgba(255,255,255,0.05)' : `${catC}18`,
          border:     `1px solid ${isSub ? 'rgba(255,255,255,0.1)' : catC + '44'}`,
        }}>
          {posLabel}
        </span>
      )}
    </div>
  )
}

function PlayerList({ starters, subs, color }) {
  return (
    <div>
      <div style={{
        padding: '6px 12px 2px', fontSize: 9,
        color: 'rgba(255,255,255,0.3)', letterSpacing: '1px',
        fontFamily: "'Chakra Petch',sans-serif",
      }}>
        TITULAIRES
      </div>
      {starters.map((p, i) => <PlayerRow key={i} player={p} color={color} isSub={false} />)}

      {subs?.length > 0 && (
        <>
          <div style={{
            padding: '8px 12px 2px', fontSize: 9,
            color: 'rgba(255,255,255,0.22)', letterSpacing: '1px',
            fontFamily: "'Chakra Petch',sans-serif",
            borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4,
          }}>
            ⇄ REMPLAÇANTS
          </div>
          {subs.map((p, i) => <PlayerRow key={i} player={p} color={color} isSub={true} />)}
        </>
      )}
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function LineupPitch({ home, away }) {
  const [activeTeam, setActiveTeam] = useState('home')

  const hColor = safeColor(home?.color) ?? '#ef4444'
  const aColor = safeColor(away?.color) ?? '#3b82f6'

  if (!home?.starters?.length && !away?.starters?.length) return null

  const team    = activeTeam === 'home' ? home : away
  const color   = activeTeam === 'home' ? hColor : aColor
  const positions = getPositions(team.starters ?? [], team.formation)

  return (
    <div style={{
      background: '#0d0d0d',
      borderRadius: '1rem', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.07)',
    }}>

      {/* ── Onglets équipes ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {[
          { key: 'home', t: home, c: hColor },
          { key: 'away', t: away, c: aColor },
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
                fontFamily: "'Chakra Petch',sans-serif",
                textTransform: 'uppercase', letterSpacing: '0.04em',
                color: act ? c : 'rgba(255,255,255,0.38)',
              }}>
                {t?.name ?? key}
              </span>
              {t?.formation && (
                <span style={{
                  fontSize: 10, fontFamily: "'Chakra Petch',sans-serif",
                  color:      act ? c : 'rgba(255,255,255,0.2)',
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

      {/* ── Terrain SVG ── */}
      <svg viewBox={`0 0 ${PW} ${PH}`} width="100%" style={{ display: 'block' }} aria-label="Composition">
        <PitchMarkings />
        {positions.map(({ x, y, player }, i) =>
          player ? <PlayerIcon key={i} x={x} y={y} player={player} color={team.color} /> : null
        )}
      </svg>

      {/* ── Liste joueurs ── */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <PlayerList starters={team.starters ?? []} subs={team.subs ?? []} color={color} />
      </div>
    </div>
  )
}
