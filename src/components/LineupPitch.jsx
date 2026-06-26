/**
 * LineupPitch — Version Finale Fixée (Mappage AML/AMR/ATG/ATD complet)
 */
import { useState } from 'react'

const PW = 300, PH = 400

// Dictionnaire étendu pour couvrir toutes les variantes d'API possibles
const POS_FR = {
  GK:'G', G:'G', GB:'G', GOAL:'G',
  CB:'DC', DC:'DC', LCB:'DC', RCB:'DC', 'CD-L':'DC', 'CD-R':'DC',
  LB:'DG', RB:'DD', DL:'DG', DR:'DD', DG:'DG', DD:'DD', LWB:'LG', RWB:'LD',
  CM:'MC', 'CM-L':'MC', 'CM-R':'MC', MC:'MC', CDM:'MDC', CAM:'MOC', DM:'MD', AM:'MOC', MDC:'MDC', MOC:'MOC', MOF:'MOC',
  LM:'MG', RM:'MD', MG:'MG', MD:'MD', M:'MC', MF:'MC', MIL:'MC',
  ST:'BU', BU:'BU', CF:'AC', AC:'AC', LW:'AG', RW:'AD', AML:'AG', AMR:'AD', 'AM-L':'AG', 'AM-R':'AD', LF:'AG', RF:'AD', AG:'AG', AD:'AD', F:'BU', FW:'BU', ATT:'BU', FWD:'ATD', SS:'ATT',
}

// Hauteur (Y) ultra-précise par poste avec marge de sécurité basse pour le Gardien
function getVerticalPct(pos) {
  const p = (pos ?? '').toUpperCase()
  if (['GK','G','GB','GOAL'].includes(p)) return 0.84
  if (['LB','LWB','DL','DG','RB','RWB','DR','DD'].includes(p)) return 0.70
  if (['CB','LCB','RCB','CD-L','CD-R','DC','D','SW','DEF'].includes(p)) return 0.72
  if (['CDM','MDC'].includes(p)) return 0.54
  if (['CM','CM-L','CM-R','MC','M','MF','MIL'].includes(p)) return 0.44
  if (['LM','MG','RM','MD','DM'].includes(p)) return 0.42
  if (['CAM','MOC','MOF','AM'].includes(p)) return 0.32
  if (['LW','RW','AML','AMR','AM-L','AM-R','LF','RF','AG','AD'].includes(p)) return 0.20 // Ligne des ailiers / milieux offensifs excentrés
  if (['ST','CF','BU','AC','F','FW','ATT','FWD','SS'].includes(p)) return 0.16 // Pointe pure
  return 0.50
}

// Attribution stricte du couloir de 1 (Gauche) à 5 (Droite) pour le tri
function getHorizontalZone(pos) {
  const p = (pos ?? '').toUpperCase()
  // 1. Extrême Gauche
  if (['LB','LWB','DL','DG','LW','AML','AM-L','AG','LM','MG','LF'].includes(p)) return 1 
  // 2. Axe Gauche
  if (['LCB','CD-L','CM-L'].includes(p)) return 2 
  // 3. Centre Pur
  if (['GK','G','GB','GOAL','CB','DC','CM','MC','CDM','MDC','CAM','MOC','ST','BU','CF','AC'].includes(p)) return 3 
  // 4. Axe Droit
  if (['RCB','CD-R','CM-R'].includes(p)) return 4 
  // 5. Extrême Droit
  if (['RB','RWB','DR','DD','RW','AMR','AM-R','AD','RM','MD','RF'].includes(p)) return 5 
  return 3
}

// Algorithme anti-chevauchement et répartition dynamique par ligne
function getPositions(starters) {
  const rows = {}
  
  const initialPositions = starters.map(player => {
    const pos = player.position ?? ''
    const y = getVerticalPct(pos)
    const zone = getHorizontalZone(pos)
    return { player, y, zone }
  })

  initialPositions.forEach(p => {
    const key = p.y.toFixed(2)
    if (!rows[key]) rows[key] = []
    rows[key].push(p)
  })

  const out = []

  Object.keys(rows).forEach(key => {
    const playersInRow = rows[key]
    playersInRow.sort((a, b) => a.zone - b.zone)
    const count = playersInRow.length
    
    playersInRow.forEach((p, index) => {
      let xPct = 0.50

      if (count === 1) {
        if (p.zone === 1) xPct = 0.15
        if (p.zone === 2) xPct = 0.35
        if (p.zone === 3) xPct = 0.50
        if (p.zone === 4) xPct = 0.65
        if (p.zone === 5) xPct = 0.85
      } else {
        // Aligne proprement les joueurs sur la largeur s'ils partagent la même ligne Y
        xPct = 0.15 + (index / (count - 1)) * 0.70
      }

      out.push({
        leftPct: xPct * 100,
        topPct: p.y * 100,
        player: p.player
      })
    })
  })

  return out
}

function alpha(hex, a) {
  if (!hex || !hex.startsWith('#')) return `rgba(239,68,68,${a})`
  const full = hex.length === 4 ? '#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3] : hex
  const r = parseInt(full.slice(1,3), 16), g = parseInt(full.slice(3,5), 16), b = parseInt(full.slice(5,7), 16)
  return `rgba(${r},${g},${b},${a})`
}

function formatName(name, sname) {
  const n = (name || sname || '?').trim()
  const parts = n.split(/\s+/)
  if (parts.length === 1) return parts[0]
  return parts[0][0].toUpperCase() + '. ' + parts.slice(1).join(' ')
}

function PlayerDot({ leftPct, topPct, player, teamColor }) {
  if (!player) return null
  const isGK = ['GK','G','GB','GOAL'].includes((player.position ?? '').toUpperCase())
  const color = isGK ? '#f59e0b' : teamColor
  const label = formatName(player.name, player.shortName)
  const num = player.number ?? ''

  return (
    <div style={{
      position: 'absolute',
      left: `${leftPct}%`,
      top: `${topPct}%`,
      transform: 'translate(-50%, -50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      zIndex: 2,
    }}>
      <div style={{ position: 'absolute', bottom: '-4px', width: '26px', height: '6px', background: 'rgba(0,0,0,0.4)', borderRadius: '50%', filter: 'blur(2px)', transform: 'scaleY(0.4)', pointerEvents: 'none' }} />
      <div style={{
        width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '14px', fontWeight: 800, fontFamily: "'Chakra Petch', monospace", color: '#ffffff',
        background: `radial-gradient(circle at top, ${color} 0%, ${alpha(color, 0.6)} 100%)`,
        border: '2px solid #ffffff', boxShadow: '0 6px 12px rgba(0,0,0,0.35)', transform: 'translateY(-2px)'
      }}>
        {num}
      </div>
      <div style={{
        marginTop: '3px', background: 'rgba(10, 16, 30, 0.92)', border: '1px solid rgba(255, 255, 255, 0.12)',
        borderTop: `2px solid ${color}`, padding: '2px 8px', borderRadius: '4px', boxShadow: '0 4px 8px rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)',
        maxWidth: '85px', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden'
      }}>
        <span style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: '10px', fontWeight: 700, color: '#ffffff', textAlign: 'center', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
          {label}
        </span>
      </div>
    </div>
  )
}

function Pitch({ positions, teamColor }) {
  return (
    <div style={{ width: '100%', aspectRatio: '3 / 4', background: '#061409', perspective: '700px', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: '-10% -6%', transform: 'rotateX(20deg)', transformOrigin: 'bottom center', background: 'radial-gradient(circle at 50% 35%, #194420 0%, #0b220f 65%, #051207 100%)' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.01) 0px, rgba(255,255,255,0.01) 35px, transparent 35px, transparent 70px)' }} />
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12, bottom: 12, border: '1px solid rgba(255,255,255,0.15)' }} />
        <div style={{ position: 'absolute', left: 12, right: 12, top: '50%', height: 1, background: 'rgba(255,255,255,0.15)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '26%', aspectRatio: '1', transform: 'translate(-50%, -50%)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '50%' }} />
        <div style={{ position: 'absolute', left: '50%', top: 12, width: '46%', height: '14%', transform: 'translateX(-50%)', border: '1px solid rgba(255,255,255,0.15)', borderTop: 'none' }} />
        <div style={{ position: 'absolute', left: '50%', bottom: 12, width: '46%', height: '14%', transform: 'translateX(-50%)', border: '1px solid rgba(255,255,255,0.15)', borderBottom: 'none' }} />
        {positions.map(({ leftPct, topPct, player }, i) => player ? <PlayerDot key={i} leftPct={leftPct} topPct={topPct} player={player} teamColor={teamColor} /> : null)}
      </div>
    </div>
  )
}

const CAT_COLOR = { G: '#f59e0b', DC: '#60a5fa', DG: '#60a5fa', DD: '#60a5fa', MC: '#34d399', MDC: '#34d399', MOC: '#34d399', MG: '#34d399', MD: '#34d399', BU: '#ef4444', AG: '#ef4444', AD: '#ef4444', AC: '#ef4444' }

function PlayerCell({ player, isSub }) {
  const posLabel = POS_FR[(player.position ?? '').toUpperCase()] ?? player.position ?? '—'
  const catC = CAT_COLOR[posLabel] ?? '#60a5fa'
  const nm = formatName(player.name, player.shortName)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderTop: '1px solid rgba(255,255,255,0.02)', background: 'rgba(10,14,24,0.3)' }}>
      <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "'Chakra Petch', monospace", color: isSub ? 'rgba(255,255,255,0.35)' : catC, background: isSub ? 'rgba(255,255,255,0.03)' : alpha(catC, 0.08), border: `1px solid ${isSub ? 'rgba(255,255,255,0.08)' : alpha(catC, 0.28)}`, borderRadius: 4, padding: '2px 5px', minWidth: 28, textAlign: 'center' }}>
        {posLabel}
      </span>
      <span style={{ flex: 1, fontSize: 11, fontWeight: isSub ? 400 : 500, color: isSub ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {nm}
      </span>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.25)', fontFamily: "'Chakra Petch', monospace" }}>
        {player.number ?? ''}
      </span>
    </div>
  )
}

function PlayerGrid({ starters, subs }) {
  const headerStyle = { padding: '8px 12px', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', fontFamily: "'Chakra Petch', monospace", fontWeight: 700, background: '#0d111b', borderBottom: '1px solid rgba(255,255,255,0.03)' }
  
  const getSortOrder = (p) => {
    const pFr = POS_FR[(p.position ?? '').toUpperCase()] ?? ''
    if (pFr === 'G') return 0
    if (['DG','DC','DD'].includes(pFr)) return 1
    if (['MDC','MC','MG','MD','MOC'].includes(pFr)) return 2
    return 3
  }

  return (
    <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={headerStyle}>Titulaires</div>
        {[...starters].sort((a,b) => getSortOrder(a) - getSortOrder(b)).map((p, i) => <PlayerCell key={i} player={p} isSub={false} />)}
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

export default function LineupPitch({ home, away }) {
  const [activeTeam, setActiveTeam] = useState('home')
  const hColor = '#ef4444'
  const aColor = '#f3f4f6'

  if (!home?.starters?.length && !away?.starters?.length) return null

  const team = activeTeam === 'home' ? home : away
  const teamColor = activeTeam === 'home' ? hColor : aColor
  const positions = getPositions(team.starters ?? [])

  return (
    <div style={{ background: '#07090e', borderRadius: '16px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 24px 48px rgba(0,0,0,0.6)', maxWidth: '480px', margin: '0 auto' }}>
      <div style={{ display: 'flex', background: '#0b0e14', padding: '6px', gap: '6px' }}>
        {[
          { key: 'home', t: home, c: hColor },
          { key: 'away', t: away, c: aColor },
        ].map(({ key, t, c }) => {
          const act = activeTeam === key
          return (
            <button key={key} onClick={() => setActiveTeam(key)} style={{ flex: 1, padding: '10px 8px', cursor: 'pointer', background: act ? 'rgba(255,255,255,0.04)' : 'transparent', borderRadius: '10px', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transition: 'all 0.2s ease', position: 'relative' }}>
              {t?.crest && <img src={t.crest} alt="" style={{ width: 26, height: 26, objectFit: 'contain', filter: act ? 'none' : 'grayscale(40%) opacity(0.5)' }} />}
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'Chakra Petch', monospace", textTransform: 'uppercase', letterSpacing: '0.04em', color: act ? '#ffffff' : 'rgba(255,255,255,0.35)' }}>{t?.name ?? key}</span>
              {t?.formation && <span style={{ fontSize: 9, fontFamily: "'Chakra Petch', monospace", color: act ? c : 'rgba(255,255,255,0.25)', background: act ? alpha(c, 0.12) : 'rgba(255,255,255,0.02)', border: `1px solid ${act ? alpha(c, 0.35) : 'rgba(255,255,255,0.05)'}`, borderRadius: 4, padding: '1px 5px' }}>{t.formation}</span>}
              {act && <div style={{ position: 'absolute', bottom: 0, left: '35%', right: '35%', height: '2px', background: c, borderRadius: '2px 2px 0 0', boxShadow: `0 -2px 8px ${c}` }} />}
            </button>
          )
        })}
      </div>
      <Pitch positions={positions} teamColor={teamColor} />
      <PlayerGrid starters={team.starters ?? []} subs={team.subs ?? []} />
    </div>
  )
}