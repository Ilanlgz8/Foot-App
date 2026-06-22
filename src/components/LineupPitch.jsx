/**
 * LineupPitch — visualisation de composition sur terrain de foot.
 * Deux onglets (une équipe par onglet), terrain SVG complet,
 * maillots numérotés positionnés selon la formation,
 * liste des joueurs triée par poste en dessous.
 */
import { useState } from 'react'

// ── Dimensions SVG ─────────────────────────────────────────────────────────────
const PW = 300    // viewBox width
const PH = 450    // viewBox height
const L  = 18, R  = 282  // pitch left/right
const T  = 14, B  = 436  // pitch top/bottom
const IW = R - L           // inner width  = 264
const IH = B - T           // inner height = 422
const CX = (L + R) / 2    // center X     = 150
const CY = (T + B) / 2    // center Y     = 225

// ── Helpers ────────────────────────────────────────────────────────────────────

// Luminance relative — pour choisir couleur texte sur maillot
function isDark(hex) {
  if (!hex || hex.length < 7) return true
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b < 148
}

// Y positions (fraction of IH, mesurées depuis le haut du terrain)
// GK en bas → forte valeur; attaquants en haut → faible valeur
const LINE_Y = {
  4: [0.85, 0.63, 0.38, 0.13],
  5: [0.85, 0.68, 0.50, 0.32, 0.12],
  6: [0.85, 0.71, 0.56, 0.41, 0.27, 0.10],
}

function getPlayerPositions(starters, formation) {
  const parts = (formation ?? '').split('-').map(Number).filter(n => n > 0)
  const lines = (parts.length > 0 && parts.reduce((a, b) => a + b, 0) === starters.length - 1)
    ? [1, ...parts]
    : fallbackLines(starters)

  const yPcts = LINE_Y[lines.length] ?? LINE_Y[4]
  const positions = []
  let idx = 0

  for (let li = 0; li < lines.length; li++) {
    const n = lines[li]
    const y = T + yPcts[li] * IH
    for (let j = 0; j < n; j++) {
      const x = L + (j + 0.5) * IW / n
      positions.push({ x, y, player: starters[idx] ?? null })
      idx++
    }
  }
  return positions
}

const POS_CAT = (pos) => {
  const p = (pos ?? '').toUpperCase()
  if (['GK', 'G'].includes(p))                                         return 0
  if (['CB','LB','RB','LWB','RWB','D','SW','DC','DL','DR'].includes(p)) return 1
  if (['CM','CDM','CAM','DM','AM','LM','RM','M','DMF','CMF','AMF','MF'].includes(p)) return 2
  if (['ST','CF','LW','RW','F','FW','ATT','SS','FWD'].includes(p))     return 3
  return 2
}

function fallbackLines(starters) {
  const cats = starters.map(p => POS_CAT(p.position))
  const groups = [0, 0, 0, 0]
  for (const c of cats) groups[c]++
  return groups.filter(n => n > 0)
}

// ── SVG : terrain ──────────────────────────────────────────────────────────────

function PitchMarkings() {
  const R2 = 38   // rayon cercle central
  const PAH = 80  // hauteur surface de réparation
  const PAW = 170 // largeur surface de réparation
  const GAH = 30  // hauteur surface de but
  const GAW = 90  // largeur surface de but
  const GOAL_W = 52 // largeur des buts

  const paxL = CX - PAW / 2
  const paxR = CX + PAW / 2
  const gaxL = CX - GAW / 2
  const gaxR = CX + GAW / 2
  const glL  = CX - GOAL_W / 2
  const glR  = CX + GOAL_W / 2

  // Bandes de gazon alternées
  const stripes = Array.from({ length: 7 }, (_, i) => ({
    y: T + i * (IH / 7),
    h: IH / 7,
    fill: i % 2 === 0 ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0)',
  }))

  return (
    <g>
      {/* Fond gazon */}
      <rect x={0} y={0} width={PW} height={PH} fill="#2e7d32" />
      {/* Bandes */}
      {stripes.map((s, i) => (
        <rect key={i} x={L} y={s.y} width={IW} height={s.h} fill={s.fill} />
      ))}
      {/* Bordure terrain */}
      <rect x={L} y={T} width={IW} height={IH}
            fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
      {/* Ligne médiane */}
      <line x1={L} y1={CY} x2={R} y2={CY}
            stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
      {/* Cercle central */}
      <circle cx={CX} cy={CY} r={R2}
              fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r={2.5} fill="rgba(255,255,255,0.9)" />
      {/* Surface de réparation haut */}
      <rect x={paxL} y={T} width={PAW} height={PAH}
            fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
      {/* Surface de but haut */}
      <rect x={gaxL} y={T} width={GAW} height={GAH}
            fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
      {/* Buts haut */}
      <rect x={glL} y={T - 7} width={GOAL_W} height={7}
            fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
      {/* Point de penalty haut */}
      <circle cx={CX} cy={T + 52} r={2} fill="rgba(255,255,255,0.9)" />
      {/* Surface de réparation bas */}
      <rect x={paxL} y={B - PAH} width={PAW} height={PAH}
            fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
      {/* Surface de but bas */}
      <rect x={gaxL} y={B - GAH} width={GAW} height={GAH}
            fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
      {/* Buts bas */}
      <rect x={glL} y={B} width={GOAL_W} height={7}
            fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
      {/* Point de penalty bas */}
      <circle cx={CX} cy={B - 52} r={2} fill="rgba(255,255,255,0.9)" />
      {/* Arcs de coin */}
      <path d={`M${L + 7},${T} A7,7 0 0,0 ${L},${T + 7}`}
            fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
      <path d={`M${R - 7},${T} A7,7 0 0,1 ${R},${T + 7}`}
            fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
      <path d={`M${L + 7},${B} A7,7 0 0,1 ${L},${B - 7}`}
            fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
      <path d={`M${R - 7},${B} A7,7 0 0,0 ${R},${B - 7}`}
            fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
    </g>
  )
}

// ── SVG : maillot + joueur ─────────────────────────────────────────────────────

function PlayerIcon({ x, y, player, color }) {
  if (!player) return null

  const s       = 12   // jersey half-size
  const textClr = isDark(color) ? '#ffffff' : '#1a1a1a'
  const num     = player.number || ''

  // Maillot : corps + manches
  const jersey = [
    `M ${x - 6},${y - s + 2}`,
    `L ${x - s - 1},${y - s + 6}`,
    `L ${x - 7.5},${y - s + 8}`,
    `L ${x - 7.5},${y + s - 1}`,
    `L ${x + 7.5},${y + s - 1}`,
    `L ${x + 7.5},${y - s + 8}`,
    `L ${x + s + 1},${y - s + 6}`,
    `L ${x + 6},${y - s + 2}`,
    `Q ${x + 2},${y - s - 1} ${x},${y - s}`,
    `Q ${x - 2},${y - s - 1} ${x - 6},${y - s + 2}`,
    'Z',
  ].join(' ')

  // Dernier nom
  const rawShort = player.shortName || player.name || ''
  const nameParts = rawShort.trim().split(' ')
  const lastName  = nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0]
  const label     = lastName.length > 9 ? lastName.slice(0, 8) + '.' : lastName

  return (
    <g>
      {/* Ombre douce */}
      <ellipse cx={x} cy={y + s + 6} rx={10} ry={3}
               fill="rgba(0,0,0,0.25)" />
      {/* Maillot */}
      <path d={jersey} fill={color}
            stroke="rgba(255,255,255,0.55)" strokeWidth="0.8" />
      {/* Numéro */}
      <text x={x} y={y + 3} textAnchor="middle" dominantBaseline="middle"
            fill={textClr} fontSize="9.5" fontWeight="bold"
            fontFamily="'Arial Narrow', Arial, sans-serif"
            stroke={isDark(color) ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.4)'}
            strokeWidth="1.5" paintOrder="stroke">
        {num}
      </text>
      {/* Nom */}
      <text x={x} y={y + s + 11} textAnchor="middle" dominantBaseline="middle"
            fill="white" fontSize="7.5" fontWeight="600"
            fontFamily="Arial, sans-serif"
            stroke="rgba(0,0,0,0.85)" strokeWidth="2.5" paintOrder="stroke">
        {label}
      </text>
    </g>
  )
}

// ── Liste joueurs ──────────────────────────────────────────────────────────────

const POS_GROUP_LABEL = {
  0: 'Gardien', 1: 'Défenseurs', 2: 'Milieux', 3: 'Attaquants',
}

const POS_SHORT = {
  GK: 'GB', G: 'GB',
  CB: 'DC', LB: 'DG', RB: 'DD', LWB: 'PG', RWB: 'PD', D: 'DEF', SW: 'DL',
  CM: 'MC', CDM: 'MDC', CAM: 'MAO', DM: 'MDC', AM: 'MAO',
  LM: 'MG', RM: 'MD', M: 'MIL',
  ST: 'BU', CF: 'AC', LW: 'AG', RW: 'AD', F: 'ATT', FW: 'ATT',
}

function PlayerList({ starters, subs, color }) {
  const groups = { 0: [], 1: [], 2: [], 3: [] }
  for (const p of starters) groups[POS_CAT(p.position)].push(p)

  const rowStyle = (isSub = false) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    opacity: isSub ? 0.7 : 1,
  })

  return (
    <div style={{ padding: '0 12px 16px' }}>
      {[0, 1, 2, 3].map(cat => {
        const players = groups[cat]
        if (!players.length) return null
        return (
          <div key={cat} style={{ marginBottom: '6px' }}>
            <div style={{
              fontSize: '10px',
              fontWeight: '700',
              color: 'rgba(255,255,255,0.45)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: '8px 0 4px',
            }}>
              {POS_GROUP_LABEL[cat]}
            </div>
            {players.map((p, i) => (
              <div key={i} style={rowStyle()}>
                <span style={{
                  minWidth: '22px', textAlign: 'right',
                  fontSize: '13px', fontWeight: '700',
                  color: color ?? 'rgba(255,255,255,0.9)',
                }}>
                  {p.number}
                </span>
                <span style={{ flex: 1, fontSize: '13px', color: 'rgba(255,255,255,0.95)' }}>
                  {p.name}
                </span>
                <span style={{
                  fontSize: '10px', fontWeight: '600',
                  color: 'rgba(255,255,255,0.4)',
                  minWidth: '28px', textAlign: 'right',
                }}>
                  {POS_SHORT[p.position] ?? p.position}
                </span>
              </div>
            ))}
          </div>
        )
      })}

      {subs.length > 0 && (
        <div>
          <div style={{
            fontSize: '10px', fontWeight: '700',
            color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
            letterSpacing: '0.08em', padding: '10px 0 4px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            marginTop: '6px',
          }}>
            Remplaçants
          </div>
          {subs.map((p, i) => (
            <div key={i} style={rowStyle(true)}>
              <span style={{
                minWidth: '22px', textAlign: 'right',
                fontSize: '13px', fontWeight: '700',
                color: 'rgba(255,255,255,0.45)',
              }}>
                {p.number}
              </span>
              <span style={{ flex: 1, fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>
                {p.name}
              </span>
              <span style={{
                fontSize: '10px', fontWeight: '600',
                color: 'rgba(255,255,255,0.3)',
                minWidth: '28px', textAlign: 'right',
              }}>
                {POS_SHORT[p.position] ?? p.position}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────

export default function LineupPitch({ home, away }) {
  const [activeTeam, setActiveTeam] = useState('home')
  const team = activeTeam === 'home' ? home : away

  const positions = getPlayerPositions(team.starters, team.formation)

  const tabStyle = (active, teamColor) => ({
    flex: 1,
    padding: '10px 8px',
    background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
    border: 'none',
    borderBottom: active
      ? `2px solid ${teamColor ?? 'rgba(255,255,255,0.7)'}`
      : '2px solid transparent',
    color: active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)',
    fontSize: '13px',
    fontWeight: active ? '700' : '400',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ background: 'var(--bg-card, #1a1a2e)', borderRadius: '12px', overflow: 'hidden' }}>
      {/* Onglets équipes */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <button
          style={tabStyle(activeTeam === 'home', home.color)}
          onClick={() => setActiveTeam('home')}
        >
          <span>{home.name}</span>
          {home.formation && (
            <span style={{ fontSize: '11px', opacity: 0.7 }}>{home.formation}</span>
          )}
        </button>
        <button
          style={tabStyle(activeTeam === 'away', away.color)}
          onClick={() => setActiveTeam('away')}
        >
          <span>{away.name}</span>
          {away.formation && (
            <span style={{ fontSize: '11px', opacity: 0.7 }}>{away.formation}</span>
          )}
        </button>
      </div>

      {/* Terrain SVG */}
      <div style={{ padding: '0', background: '#1c5c1c' }}>
        <svg
          viewBox={`0 0 ${PW} ${PH}`}
          width="100%"
          style={{ display: 'block', maxHeight: '55vw' }}
          aria-label={`Composition ${team.name}`}
        >
          <PitchMarkings />
          {positions.map(({ x, y, player }) => (
            player ? (
              <PlayerIcon
                key={player.name + player.number}
                x={x} y={y}
                player={player}
                color={team.color}
              />
            ) : null
          ))}
        </svg>
      </div>

      {/* Liste des joueurs */}
      <PlayerList
        starters={team.starters}
        subs={team.subs}
        color={team.color}
      />
    </div>
  )
}
