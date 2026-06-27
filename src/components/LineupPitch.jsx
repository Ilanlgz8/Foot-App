/**
 * LineupPitch — Version Anti-Crash Ultra Sécurisée
 */
import { useState } from 'react'

const PW = 300, PH = 400
const L = 10, R = 290, T = 10, B = 390
const IW = R - L, IH = B - T

// Sécurité sur la conversion de couleur pour éviter les plantages
function alpha(hex, a) {
  try {
    if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return `rgba(239,68,68,${a})`;
    const full = hex.length === 4 ? '#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3] : hex;
    const r = parseInt(full.slice(1,3), 16), g = parseInt(full.slice(3,5), 16), b = parseInt(full.slice(5,7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(239,68,68,${a})`;
    return `rgba(${r},${g},${b},${a})`;
  } catch (e) {
    return `rgba(239,68,68,${a})`;
  }
}

function formatName(name, sname) {
  const n = (name || sname || '?').trim()
  const parts = n.split(/\s+/)
  if (parts.length === 1) return parts[0]
  return parts[0][0].toUpperCase() + '. ' + parts.slice(1).join(' ')
}

const POS_FR = {
  GK:'G', G:'G', GB:'G', GOAL:'G',
  CB:'DC', DC:'DC', LCB:'DC', RCB:'DC', 'CD-L':'DC', 'CD-R':'DC',
  LB:'DG', RB:'DD', DL:'DG', DR:'DD', DG:'DG', DD:'DD', LWB:'LG', RWB:'LD',
  CM:'MC', 'CM-L':'MC', 'CM-R':'MC', MC:'MC', CDM:'MDC', CAM:'MOC', DM:'MDC', AM:'MOC', MDC:'MDC', MOC:'MOC', MOF:'MOC',
  LM:'MG', RM:'MD', MG:'MG', MD:'MD', M:'MC', MF:'MC', MIL:'MC',
  ST:'BU', BU:'BU', CF:'AC', AC:'AC', LW:'AG', RW:'AD', AML:'AG', AMR:'AD', 'AM-L':'AG', 'AM-R':'AD', LF:'AG', RF:'AD', AG:'AG', AD:'AD', F:'BU', FW:'BU', ATT:'BU', FWD:'BU', SS:'AC',
}

const CAT_COLOR = { 0: '#f59e0b', 1: '#60a5fa', 2: '#34d399', 3: '#ef4444' }

function posCat(pos) {
  const p = (pos ?? '').toUpperCase()
  if (['GK','G','GB','GOAL'].includes(p)) return 0
  if (['CB','LCB','RCB','CD-L','CD-R','LB','RB','LWB','RWB','D','SW','DC','DL','DR','DD','DG','DEF'].includes(p)) return 1
  if (['CM','CM-L','CM-R','CDM','CAM','DM','AM','LM','RM','M','MF','MIL','MDC','MOF','MG','MD','MC'].includes(p)) return 2
  if (['ST','CF','LW','RW','AML','AMR','AM-L','AM-R','LF','RF','F','FW','ATT','FWD','SS','AC','AG','AD','BU'].includes(p)) return 3
  return 2
}

function getPositions(starters) {
  if (!Array.isArray(starters)) return [];
  
  const counts = [0, 0, 0, 0]
  starters.forEach(p => counts[posCat(p?.position)]++)

  const currentIndices = [0, 0, 0, 0]

  return starters.map((player) => {
    if (!player) return { leftPct: 50, topPct: 50, player: null };
    
    const cat = posCat(player.position)
    const totalOnLine = counts[cat]
    const myIndex = currentIndices[cat]
    currentIndices[cat]++

    let yPct = 0.50
    if (cat === 0) yPct = 0.88
    if (cat === 1) yPct = 0.72
    if (cat === 2) {
      const p = (player.position ?? '').toUpperCase()
      yPct = ['CDM', 'MDC', 'DM'].includes(p) ? 0.56 : (['CAM', 'MOC', 'AM'].includes(p) ? 0.35 : 0.46)
    }
    if (cat === 3) yPct = 0.16

    let xPct = 0.50
    if (totalOnLine > 1) {
      const minX = cat === 1 ? 0.15 : 0.18
      const maxX = cat === 1 ? 0.85 : 0.82
      xPct = minX + (myIndex / (totalOnLine - 1)) * (maxX - minX)
    }

    return {
      leftPct: xPct * 100,
      topPct: yPct * 100,
      player
    }
  })
}

function PlayerDot({ leftPct, topPct, player, teamColor }) {
  if (!player) return null
  const isGK = posCat(player.position) === 0
  const color = isGK ? '#f59e0b' : (teamColor || '#ef4444')
  const nm = formatName(player.name, player.shortName)
  const posLabel = POS_FR[(player.position ?? '').toUpperCase()] ?? player.position ?? ''
  const num = player.number ?? ''

  return (
    <div style={{ position: 'absolute', left: `${leftPct}%`, top: `${topPct}%`, transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
      <div style={{ position: 'absolute', bottom: '-4px', width: '24px', height: '5px', background: 'rgba(0,0,0,0.5)', borderRadius: '50%', filter: 'blur(2px)', transform: 'scaleY(0.4)', pointerEvents: 'none' }} />
      <div style={{ width: '34px', height: '34px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, fontFamily: "'Chakra Petch', monospace", color: '#ffffff', background: `radial-gradient(circle at top, ${color} 0%, ${alpha(color, 0.6)} 100%)`, border: '2px solid #ffffff', boxShadow: '0 4px 10px rgba(0,0,0,0.4)', transform: 'translateY(-2px)' }}>
        {num}
      </div>
      <div style={{ marginTop: '2px', background: 'rgba(10, 16, 30, 0.95)', border: '1px solid rgba(255, 255, 255, 0.12)', borderTop: `2px solid ${color}`, padding: '2px 6px', borderRadius: '4px', boxShadow: '0 4px 8px rgba(0,0,0,0.4)', display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: "'Chakra Petch', monospace", fontSize: '8.5px', fontWeight: 600, color: 'rgba(255,255,255,0.45)' }}>{posLabel}</span>
        <span style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: '10px', fontWeight: 700, color: '#ffffff', maxWidth: '65px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm}</span>
      </div>
    </div>
  )
}

function Pitch({ formation, positions, teamColor }) {
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '3 / 4', background: 'linear-gradient(180deg, #0f2214 0%, #0d1e11 50%, #0b1a0e 100%)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.022) 0px, rgba(255,255,255,0.022) 46px, transparent 46px, transparent 92px)' }} />
      <div style={{ position: 'absolute', top: 8, left: 8, right: 8, bottom: 8, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 8, right: 8, top: '50%', height: 1, background: 'rgba(255,255,255,0.09)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: '25%', aspectRatio: '1', transform: 'translate(-50%, -50%)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 5, height: 5, background: 'rgba(255,255,255,0.2)', borderRadius: '50%', transform: 'translate(-50%, -50%)', pointerEvents:'none' }} />
      <div style={{ position: 'absolute', left: '50%', top: 8, width: '49%', height: '14%', transform: 'translateX(-50%)', border: '1px solid rgba(255,255,255,0.07)', borderTop: 'none', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: '50%', bottom: 8, width: '49%', height: '14%', transform: 'translateX(-50%)', border: '1px solid rgba(255,255,255,0.07)', borderBottom: 'none', pointerEvents: 'none' }} />
      {formation && <div style={{ position: 'absolute', top: 13, left: 14, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.15)', fontFamily: "'Chakra Petch', monospace", pointerEvents: 'none' }}>{formation}</div>}
      {positions.map(({ leftPct, topPct, player }, i) => player ? <PlayerDot key={i} leftPct={leftPct} topPct={topPct} player={player} teamColor={teamColor} /> : null)}
    </div>
  )
}

function PlayerCell({ player, isSub }) {
  if (!player) return null;
  const cat = posCat(player.position)
  const catC = CAT_COLOR[cat] ?? '#60a5fa'
  const posLabel = POS_FR[(player.position ?? '').toUpperCase()] ?? player.position ?? '—'
  const nm = formatName(player.name, player.shortName)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderTop: '1px solid rgba(255,255,255,0.035)', minWidth: 0 }}>
      <span style={{ fontSize: 8, fontWeight: 700, flexShrink: 0, fontFamily: "'Chakra Petch', monospace", letterSpacing: '0.03em', color: isSub ? 'rgba(255,255,255,0.38)' : catC, background: isSub ? 'rgba(255,255,255,0.05)' : alpha(catC, 0.1), border: `1px solid ${isSub ? 'rgba(255,255,255,0.1)' : alpha(catC, 0.28)}`, borderRadius: 3, padding: '2px 5px', minWidth: 28, textAlign: 'center' }}>{posLabel}</span>
      <span style={{ flex: 1, fontSize: 10.5, fontWeight: isSub ? 400 : 500, color: isSub ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{nm}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.2)', flexShrink: 0, fontFamily: "'Chakra Petch', monospace" }}>{player.number ?? ''}</span>
    </div>
  )
}

function PlayerGrid({ starters, subs }) {
  const headerStyle = { padding: '5px 10px 4px', fontSize: 8, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)', fontFamily: "'Chakra Petch', monospace" }
  const validStarters = Array.isArray(starters) ? starters : []
  const validSubs = Array.isArray(subs) ? subs : []

  const getSortOrder = (p) => {
    if (!p) return 4;
    const cat = posCat(p.position)
    return cat === 0 ? 0 : cat === 1 ? 1 : cat === 2 ? 2 : 3
  }

  return (
    <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={headerStyle}>Titulaires</div>
        {[...validStarters].sort((a,b) => getSortOrder(a) - getSortOrder(b)).map((p, i) => <PlayerCell key={i} player={p} isSub={false} />)}
      </div>
      {validSubs.length > 0 && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={headerStyle}>⇄ Remplaçants</div>
          {validSubs.map((p, i) => <PlayerCell key={i} player={p} isSub={true} />)}
        </div>
      )}
    </div>
  )
}

export default function LineupPitch({ home, away }) {
  const [activeTeam, setActiveTeam] = useState('home')
  const hColor = '#ef4444'
  const aColor = '#eadfdfe4'

  if (!home?.starters?.length && !away?.starters?.length) return null

  const team = activeTeam === 'home' ? home : away
  const teamColor = activeTeam === 'home' ? hColor : aColor
  const positions = getPositions(team?.starters ?? [])

  return (
    <div style={{ background: '#0a0c14', borderRadius: '1rem', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)', maxWidth: '480px', margin: '0 auto' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {[
          { key: 'home', t: home, c: hColor },
          { key: 'away', t: away, c: aColor },
        ].map(({ key, t, c }) => {
          const act = activeTeam === key
          return (
            <button key={key} onClick={() => setActiveTeam(key)} style={{ flex: 1, padding: '10px 8px', cursor: 'pointer', background: act ? alpha(c, 0.08) : 'transparent', border: 'none', borderBottom: `2px solid ${act ? c : 'transparent'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, transition: 'all .15s' }}>
              {t?.crest && <img src={t.crest} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />}
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "'Chakra Petch', monospace", textTransform: 'uppercase', letterSpacing: '0.05em', color: act ? c : 'rgba(255,255,255,0.35)' }}>{t?.name ?? key}</span>
              {t?.formation && <span style={{ fontSize: 9.5, fontFamily: "'Chakra Petch', monospace", color: act ? c : 'rgba(255,255,255,0.2)', background: act ? alpha(c, 0.1) : 'transparent', border: `1px solid ${act ? alpha(c, 0.3) : 'transparent'}`, borderRadius: 4, padding: '1px 6px' }}>{t.formation}</span>}
            </button>
          )
        })}
      </div>
      <Pitch formation={team?.formation} positions={positions} teamColor={teamColor} />
      <PlayerGrid starters={team?.starters ?? []} subs={team?.subs ?? []} />
    </div>
  )
}