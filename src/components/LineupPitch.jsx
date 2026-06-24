/**
 * LineupPitch — composition futuriste
 *
 * • Les deux équipes affichées simultanément sur le même terrain (standard SofaScore/FotMob)
 * • Home en bas (attaque vers le haut), Away en haut (attaque vers le bas)
 * • Maillots plus grands, noms lisibles sans zoom sur mobile
 * • Tabs pour basculer la liste des joueurs (Home | Away)
 * • Thème app : dark, rouge, Chakra Petch
 */
import { useState } from 'react'

// ── Dimensions SVG ─────────────────────────────────────────────────────────────
const PW = 300
const PH = 460
const L  = 10, R = 290
const T  = 10, B = 450
const IW = R - L   // 280
const IH = B - T   // 440
const CX = (L + R) / 2  // 150
const CY = (T + B) / 2  // 230

// ── Fractions de ligne (Home : GK bas → ATT haut) ─────────────────────────────
const HOME_Y = {
  4: [0.91, 0.68, 0.46, 0.24],
  5: [0.91, 0.73, 0.56, 0.38, 0.21],
  6: [0.91, 0.76, 0.61, 0.46, 0.31, 0.16],
}
// Away : GK haut → ATT bas (miroir)
const AWAY_Y = {
  4: [0.09, 0.32, 0.54, 0.76],
  5: [0.09, 0.27, 0.44, 0.62, 0.79],
  6: [0.09, 0.24, 0.39, 0.54, 0.69, 0.84],
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function isDark(hex) {
  if (!hex || hex.length < 7) return true
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b < 148
}

function safeColor(raw) {
  if (!raw) return null
  return raw.startsWith('#') ? raw : `#${raw}`
}

const POS_CAT = (pos) => {
  const p = (pos ?? '').toUpperCase()
  if (['GK', 'G'].includes(p))                                                   return 0
  if (['CB','LB','RB','LWB','RWB','D','SW','DC','DL','DR'].includes(p))          return 1
  if (['CM','CDM','CAM','DM','AM','LM','RM','M','DMF','CMF','AMF','MF'].includes(p)) return 2
  if (['ST','CF','LW','RW','F','FW','ATT','SS','FWD'].includes(p))               return 3
  return 2
}

function fallbackLines(starters) {
  const cats = starters.map(p => POS_CAT(p.position))
  const g = [0, 0, 0, 0]
  for (const c of cats) g[c]++
  return g.filter(n => n > 0)
}

function getPositions(starters, formation, isAway) {
  const parts  = (formation ?? '').split('-').map(Number).filter(n => n > 0)
  const parsed = parts.length > 0 && parts.reduce((a, b) => a + b, 0) === starters.length - 1
    ? [1, ...parts]
    : null
  const lines  = parsed ?? fallbackLines(starters)
  const yTbl   = isAway ? AWAY_Y : HOME_Y
  const yPcts  = yTbl[lines.length] ?? yTbl[4]

  const out = []
  let idx = 0
  for (let li = 0; li < lines.length; li++) {
    const n = lines[li]
    const y = T + yPcts[li] * IH
    for (let j = 0; j < n; j++) {
      const x = L + (j + 0.5) * IW / n
      out.push({ x, y, player: starters[idx] ?? null })
      idx++
    }
  }
  return out
}

// ── Terrain SVG ────────────────────────────────────────────────────────────────
function PitchMarkings() {
  const R2  = 40, PAH = 84, PAW = 178, GAH = 32, GAW = 94, GOAL_W = 54
  const pxL = CX - PAW/2, pxR = CX + PAW/2
  const gxL = CX - GAW/2, gxR = CX + GAW/2
  const glL = CX - GOAL_W/2, glR = CX + GOAL_W/2
  const stripes = Array.from({ length: 8 }, (_, i) => ({
    y: T + i * (IH / 8), h: IH / 8,
    fill: i % 2 === 0 ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0)',
  }))
  const S = 'rgba(255,255,255,0.85)'
  return (
    <g>
      <rect x={0} y={0} width={PW} height={PH} fill="#1a4d1e" />
      {stripes.map((s, i) => <rect key={i} x={L} y={s.y} width={IW} height={s.h} fill={s.fill} />)}
      <rect x={L} y={T} width={IW} height={IH} fill="none" stroke={S} strokeWidth="1.5" />
      <line x1={L} y1={CY} x2={R} y2={CY} stroke={S} strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r={R2} fill="none" stroke={S} strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r={3} fill={S} />
      {/* Surfaces haut */}
      <rect x={pxL} y={T} width={PAW} height={PAH} fill="none" stroke={S} strokeWidth="1.5" />
      <rect x={gxL} y={T} width={GAW} height={GAH} fill="none" stroke={S} strokeWidth="1.5" />
      <rect x={glL} y={T-8} width={GOAL_W} height={8} fill="rgba(255,255,255,0.12)" stroke={S} strokeWidth="1.5" />
      <circle cx={CX} cy={T+56} r={2.5} fill={S} />
      {/* Surfaces bas */}
      <rect x={pxL} y={B-PAH} width={PAW} height={PAH} fill="none" stroke={S} strokeWidth="1.5" />
      <rect x={gxL} y={B-GAH} width={GAW} height={GAH} fill="none" stroke={S} strokeWidth="1.5" />
      <rect x={glL} y={B} width={GOAL_W} height={8} fill="rgba(255,255,255,0.12)" stroke={S} strokeWidth="1.5" />
      <circle cx={CX} cy={B-56} r={2.5} fill={S} />
      {/* Arcs de coin */}
      {[[L+8,T,'0,0,0'],[R-8,T,'0,0,1'],[L+8,B,'0,1,1'],[R-8,B,'0,1,0']].map(([cx,cy,a],i)=>(
        <path key={i} d={`M${cx},${cy} A8,8 0 0,${a} ${cx<CX?L:R},${cy<CY?T+8:B-8}`} fill="none" stroke={S} strokeWidth="1"/>
      ))}
    </g>
  )
}

// ── Icône joueur ───────────────────────────────────────────────────────────────
const S_J = 15  // jersey half-size (plus grand pour lisibilité mobile)

function PlayerIcon({ x, y, player, color, isAway }) {
  if (!player) return null
  const c      = safeColor(color) ?? (isAway ? '#3b82f6' : '#ef4444')
  const dark   = isDark(c)
  const textC  = dark ? '#ffffff' : '#111111'
  const num    = player.number ?? ''
  const rawName = player.shortName || player.name || ''
  const parts   = rawName.trim().split(/\s+/)
  const display = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
  const label   = display.length > 8 ? display.slice(0, 7) + '.' : display

  const jersey = [
    `M ${x-7},${y-S_J+2}`,
    `L ${x-S_J-1},${y-S_J+6}`,
    `L ${x-8},${y-S_J+9}`,
    `L ${x-8},${y+S_J-1}`,
    `L ${x+8},${y+S_J-1}`,
    `L ${x+8},${y-S_J+9}`,
    `L ${x+S_J+1},${y-S_J+6}`,
    `L ${x+7},${y-S_J+2}`,
    `Q ${x+2},${y-S_J-2} ${x},${y-S_J-1}`,
    `Q ${x-2},${y-S_J-2} ${x-7},${y-S_J+2}`,
    'Z',
  ].join(' ')

  return (
    <g>
      <ellipse cx={x} cy={y+S_J+7} rx={11} ry={3.5} fill="rgba(0,0,0,0.3)" />
      <path d={jersey} fill={c} stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
      <text x={x} y={y+2} textAnchor="middle" dominantBaseline="middle"
            fill={textC} fontSize="10.5" fontWeight="bold"
            fontFamily="'Chakra Petch',Arial,sans-serif"
            stroke={dark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.45)'}
            strokeWidth="1.5" paintOrder="stroke">
        {num}
      </text>
      <text x={x} y={y+S_J+13} textAnchor="middle" dominantBaseline="middle"
            fill="white" fontSize="8.5" fontWeight="700"
            fontFamily="'Chakra Petch',Arial,sans-serif"
            stroke="rgba(0,0,0,0.9)" strokeWidth="2.5" paintOrder="stroke">
        {label}
      </text>
    </g>
  )
}

// ── Liste joueurs ──────────────────────────────────────────────────────────────
const POS_GROUP_LABEL = { 0: 'Gardien', 1: 'Défenseurs', 2: 'Milieux', 3: 'Attaquants' }
const POS_SHORT = {
  GK:'GB', G:'GB',
  CB:'DC', LB:'DG', RB:'DD', LWB:'PG', RWB:'PD', D:'DEF', SW:'LIB',
  CM:'MC', CDM:'MDC', CAM:'MAO', DM:'MDC', AM:'MAO', LM:'MG', RM:'MD', M:'MIL',
  ST:'BU', CF:'AC', LW:'AG', RW:'AD', F:'ATT', FW:'ATT',
}
const CAT_COLOR = { 0: '#f59e0b', 1: '#3b82f6', 2: '#10b981', 3: '#ef4444' }

function PlayerRow({ player, color, isSub }) {
  const c = safeColor(color) ?? '#ef4444'
  const numBg     = isSub ? 'rgba(255,255,255,0.07)' : c + '28'
  const numBorder = isSub ? 'rgba(255,255,255,0.12)' : c + '60'
  const posLabel  = POS_SHORT[player.position] ?? player.position ?? ''
  const catColor  = CAT_COLOR[POS_CAT(player.position)] ?? 'rgba(255,255,255,0.3)'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 14px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      opacity: isSub ? 0.55 : 1,
    }}>
      {/* Numéro */}
      <span style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: numBg, border: `1px solid ${numBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, fontFamily: "'Chakra Petch',sans-serif",
        color: isSub ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.95)',
      }}>
        {player.number}
      </span>
      {/* Nom */}
      <span style={{
        flex: 1, fontSize: 13.5,
        fontWeight: isSub ? 400 : 600,
        color: isSub ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.93)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {player.name || player.shortName}
      </span>
      {/* Poste */}
      {posLabel && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          fontFamily: "'Chakra Petch',sans-serif",
          color: isSub ? 'rgba(255,255,255,0.25)' : catColor,
          background: isSub ? 'rgba(255,255,255,0.05)' : catColor + '18',
          border: `1px solid ${isSub ? 'rgba(255,255,255,0.08)' : catColor + '40'}`,
          borderRadius: 5, padding: '2px 7px', flexShrink: 0,
          letterSpacing: '0.05em',
        }}>
          {posLabel}
        </span>
      )}
    </div>
  )
}

function PlayerList({ starters, subs, color }) {
  const groups = { 0: [], 1: [], 2: [], 3: [] }
  for (const p of starters) groups[POS_CAT(p.position)].push(p)
  const c = safeColor(color) ?? '#ef4444'

  return (
    <div>
      {[0, 1, 2, 3].map(cat => {
        const players = groups[cat]
        if (!players.length) return null
        return (
          <div key={cat}>
            {/* Header section */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px 4px',
            }}>
              <div style={{ height: 1, background: `${c}55`, flex: 1 }} />
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
                fontFamily: "'Chakra Petch',sans-serif",
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.38)',
              }}>
                {POS_GROUP_LABEL[cat]}
              </span>
              <div style={{ height: 1, background: `${c}55`, flex: 1 }} />
            </div>
            {players.map((p, i) => <PlayerRow key={i} player={p} color={color} />)}
          </div>
        )
      })}

      {subs.length > 0 && (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 14px 4px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            marginTop: 4,
          }}>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', flex: 1 }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
              fontFamily: "'Chakra Petch',sans-serif",
              textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              ⇄ Remplaçants
            </span>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', flex: 1 }} />
          </div>
          {subs.map((p, i) => <PlayerRow key={i} player={p} color={color} isSub />)}
        </div>
      )}
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function LineupPitch({ home, away }) {
  const [listTeam, setListTeam] = useState('home')

  const homePos = getPositions(home.starters, home.formation, false)
  const awayPos = getPositions(away.starters, away.formation, true)
  const team    = listTeam === 'home' ? home : away

  const hColor = safeColor(home.color) ?? '#ef4444'
  const aColor = safeColor(away.color) ?? '#3b82f6'

  const tabBase = {
    flex: 1, padding: '11px 8px', border: 'none', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    transition: 'all 0.15s', background: 'transparent',
  }
  const tabActive = (color) => ({
    ...tabBase,
    background: `${color}18`,
    borderBottom: `2px solid ${color}`,
  })
  const tabInactive = {
    ...tabBase,
    borderBottom: '2px solid transparent',
  }

  return (
    <div style={{
      background: 'linear-gradient(180deg, #0d1117 0%, #0a0a0f 100%)',
      borderRadius: '1rem', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.07)',
    }}>

      {/* ── En-têtes équipes ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {/* Away (en haut du terrain) */}
        <div style={{
          flex: 1, padding: '12px 12px 10px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}>
          {away.crest && (
            <img src={away.crest} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />
          )}
          <span style={{
            fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)',
            fontFamily: "'Chakra Petch',sans-serif",
            textTransform: 'uppercase', letterSpacing: '0.03em',
            textAlign: 'center', lineHeight: 1.2,
          }}>
            {away.name}
          </span>
          {away.formation && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              fontFamily: "'Chakra Petch',sans-serif",
              color: aColor, background: `${aColor}22`,
              border: `1px solid ${aColor}44`,
              borderRadius: 5, padding: '2px 8px', letterSpacing: '0.06em',
            }}>
              {away.formation}
            </span>
          )}
          <div style={{
            width: '60%', height: 2, borderRadius: 1,
            background: `linear-gradient(90deg, transparent, ${aColor}, transparent)`,
            marginTop: 2,
          }} />
        </div>

        {/* Divider central avec VS */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 8px',
          color: 'rgba(255,255,255,0.2)', fontSize: 10,
          fontFamily: "'Chakra Petch',sans-serif", fontWeight: 700,
        }}>
          VS
        </div>

        {/* Home (en bas du terrain) */}
        <div style={{
          flex: 1, padding: '12px 12px 10px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          borderLeft: '1px solid rgba(255,255,255,0.06)',
        }}>
          {home.crest && (
            <img src={home.crest} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />
          )}
          <span style={{
            fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)',
            fontFamily: "'Chakra Petch',sans-serif",
            textTransform: 'uppercase', letterSpacing: '0.03em',
            textAlign: 'center', lineHeight: 1.2,
          }}>
            {home.name}
          </span>
          {home.formation && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              fontFamily: "'Chakra Petch',sans-serif",
              color: hColor, background: `${hColor}22`,
              border: `1px solid ${hColor}44`,
              borderRadius: 5, padding: '2px 8px', letterSpacing: '0.06em',
            }}>
              {home.formation}
            </span>
          )}
          <div style={{
            width: '60%', height: 2, borderRadius: 1,
            background: `linear-gradient(90deg, transparent, ${hColor}, transparent)`,
            marginTop: 2,
          }} />
        </div>
      </div>

      {/* ── Terrain SVG — les deux équipes ── */}
      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${PW} ${PH}`}
          width="100%"
          style={{ display: 'block' }}
          aria-label="Compositions"
        >
          <PitchMarkings />

          {/* Away en haut */}
          {awayPos.map(({ x, y, player }, i) =>
            player ? (
              <PlayerIcon key={`a${i}`} x={x} y={y} player={player} color={away.color} isAway />
            ) : null
          )}

          {/* Home en bas */}
          {homePos.map(({ x, y, player }, i) =>
            player ? (
              <PlayerIcon key={`h${i}`} x={x} y={y} player={player} color={home.color} isAway={false} />
            ) : null
          )}
        </svg>

        {/* Légendes latérales */}
        <div style={{
          position: 'absolute', top: 8, left: 6,
          fontSize: 9, fontWeight: 700, fontFamily: "'Chakra Petch',sans-serif",
          color: aColor, letterSpacing: '0.08em',
          writingMode: 'vertical-rl', transform: 'rotate(180deg)', opacity: 0.7,
        }}>
          ↑ {away.name?.split(' ')[0]}
        </div>
        <div style={{
          position: 'absolute', bottom: 8, right: 6,
          fontSize: 9, fontWeight: 700, fontFamily: "'Chakra Petch',sans-serif",
          color: hColor, letterSpacing: '0.08em',
          writingMode: 'vertical-rl', opacity: 0.7,
        }}>
          {home.name?.split(' ')[0]} ↑
        </div>
      </div>

      {/* ── Onglets liste joueurs ── */}
      <div style={{
        display: 'flex',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}>
        <button
          style={listTeam === 'away' ? tabActive(aColor) : tabInactive}
          onClick={() => setListTeam('away')}
        >
          <span style={{
            fontSize: 11, fontWeight: 700,
            fontFamily: "'Chakra Petch',sans-serif",
            textTransform: 'uppercase', letterSpacing: '0.04em',
            color: listTeam === 'away' ? aColor : 'rgba(255,255,255,0.4)',
          }}>
            {away.name}
          </span>
        </button>
        <button
          style={listTeam === 'home' ? tabActive(hColor) : tabInactive}
          onClick={() => setListTeam('home')}
        >
          <span style={{
            fontSize: 11, fontWeight: 700,
            fontFamily: "'Chakra Petch',sans-serif",
            textTransform: 'uppercase', letterSpacing: '0.04em',
            color: listTeam === 'home' ? hColor : 'rgba(255,255,255,0.4)',
          }}>
            {home.name}
          </span>
        </button>
      </div>

      {/* ── Liste joueurs ── */}
      <PlayerList
        starters={team.starters}
        subs={team.subs ?? []}
        color={team.color}
      />
    </div>
  )
}
