/**
 * LineupPitch — Version Mobile Sécurisée, Marquee Calibré et Postes Fixés
 */
import { useState } from 'react'

// ── Dimensions et marges de sécurité PWA (Anti-coupure Gardien) ──────────────
const PW = 300, PH = 400
const L = 16, R = 284
const T = 35, B = 365 
const IW = R - L, IH = B - T

const LINE_Y = {
  4: [0.92, 0.68, 0.44, 0.18],
  5: [0.92, 0.74, 0.55, 0.36, 0.16],
  6: [0.92, 0.78, 0.62, 0.46, 0.30, 0.14],
}

// ── Helpers de conversion de couleurs ────────────────────────────────────────
function alpha(hex, a) {
  if (!hex || !hex.startsWith('#')) return `rgba(239,68,68,${a})`
  const full = hex.length === 4 ? '#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3] : hex
  const r = parseInt(full.slice(1,3), 16), g = parseInt(full.slice(3,5), 16), b = parseInt(full.slice(5,7), 16)
  return isNaN(r) ? `rgba(239,68,68,${a})` : `rgba(${r},${g},${b},${a})`
}

// Format strict demandé : I. NomDeFamille
function formatName(name, sname) {
  const n = (name || sname || '?').trim()
  const parts = n.split(/\s+/)
  if (parts.length === 1) return parts[0]
  return parts[0][0].toUpperCase() + '. ' + parts.slice(1).join(' ')
}

// ── Dictionnaire chirurgical pour la traduction des libellés de l'API ───────
const POS_FR = {
  // Gardiens
  GK:'G', G:'G', GB:'G', GOAL:'G',
  // Défenseurs Centraux
  CB:'DC', DC:'DC', LCB:'DC', RCB:'DC', 'CD-L':'DC', 'CD-R':'DC',
  // Défenseurs Latéraux
  LB:'DG', RB:'DD', DL:'DG', DR:'DD', DG:'DG', DD:'DD', LWB:'LG', RWB:'LD',
  // Milieux Centraux / Défensifs / Offensifs
  CM:'MC', 'CM-L':'MC', 'CM-R':'MC', MC:'MC', CDM:'MDC', CAM:'MOC', DM:'MD', AM:'MOC', MDC:'MDC', MOC:'MOC', MOF:'MOC',
  // Milieux Latéraux
  LM:'MG', RM:'MD', MG:'MG', MD:'MD', M:'MC', MF:'MC', MIL:'MC',
  // Attaquants / Ailiers
  ST:'BU', BU:'BU', CF:'AC', AC:'AC', LW:'AG', RW:'AD', AML:'AG', AMR:'AD', AG:'AG', AD:'AD', F:'BU', FW:'BU', ATT:'BU', FWD:'ATD', SS:'ATT',
}

// Détermination stricte de la ligne (0 = Gardien, 1 = Défense, 2 = Milieu, 3 = Attaque)
function posCat(pos) {
  const p = (pos ?? '').toUpperCase()
  if (['GK','G','GB','GOAL'].includes(p)) return 0
  if (['CB','LCB','RCB','CD-L','CD-R','LB','RB','LWB','RWB','D','SW','DC','DL','DR','DD','DG','DEF'].includes(p)) return 1
  if (['CM','CM-L','CM-R','CDM','CAM','DM','AM','LM','RM','M','MF','MIL','MDC','MOF','MG','MD','MC'].includes(p)) return 2
  if (['ST','CF','LW','RW','AML','AMR','F','FW','ATT','FWD','SS','AC','AG','AD','BU'].includes(p)) return 3
  return 2
}

// Attribution précise du poids horizontal (De gauche à droite) pour éliminer les inversions
function getHorizontalWeight(pos) {
  const p = (pos ?? '').toUpperCase()
  // Latéraux Gauches / Ailiers Gauches / Milieux Gauches
  if (['LB','LWB','DL','DG','LW','AML','AG','LM','MG'].includes(p)) return 1 
  // Axiaux Gauches (Défenseur central gauche ou milieu central gauche)
  if (['LCB','CD-L','CM-L'].includes(p)) return 1.5
  // Plein Centre (Axe pur)
  if (['GK','G','GB','GOAL','CB','DC','CM','MC','CDM','MDC','CAM','MOC','ST','BU','CF','AC'].includes(p)) return 2 
  // Axiaux Droits (Défenseur central droit ou milieu central droit)
  if (['RCB','CD-R','CM-R'].includes(p)) return 2.5
  // Latéraux Droits / Ailiers Droits / Milieux Droits
  if (['RB','RWB','DR','DD','RW','AMR','AD','RM','MD'].includes(p)) return 3 
  return 2
}

const CAT_COLOR = { 0: '#f59e0b', 1: '#60a5fa', 2: '#34d399', 3: '#ef4444' }

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
  
  const playersByLine = Array.from({ length: lines.length }, () => [])
  const pool = [...starters]
  
  // Isoler le Gardien
  const gkIdx = pool.findIndex(p => posCat(p.position) === 0)
  if (gkIdx !== -1) {
    playersByLine[0].push(pool.splice(gkIdx, 1)[0])
  } else if (pool.length > 0) {
    playersByLine[0].push(pool.splice(0, 1)[0])
  }

  // Distribuer les joueurs ligne par ligne
  for (let li = 1; li < lines.length; li++) {
    const targetCount = lines[li]
    for (let c = 0; c < targetCount; c++) {
      if (pool.length > 0) {
        playersByLine[li].push(pool.splice(0, 1)[0])
      }
    }
    // FIX INVERSION : Tri horizontal mathématique strict de la gauche vers la droite
    playersByLine[li].sort((a, b) => getHorizontalWeight(a.position) - getHorizontalWeight(b.position))
  }

  const out = []
  for (let li = 0; li < lines.length; li++) {
    const rowPlayers = playersByLine[li]
    const n = rowPlayers.length
    const y = T + yPcts[li] * IH
    for (let j = 0; j < n; j++) {
      const x = L + (j + 0.5) * IW / n
      out.push({
        leftPct: (x / PW) * 100,
        topPct:  (y / PH) * 100,
        player:  rowPlayers[j] ?? null,
      })
    }
  }
  return out
}

// ── COMPOSANT DU JOUEUR (Marquee calibré au pixel près pour commencer au début) ──
function PlayerDot({ leftPct, topPct, player, teamColor }) {
  if (!player) return null
  const isGK = posCat(player.position) === 0
  const color = isGK ? '#f59e0b' : teamColor
  const label = formatName(player.name, player.shortName)
  const num = player.number ?? ''

  const isLongName = label.length > 10

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
      {/* Recalibrage parfait de la boucle infinie pour commencer à la première lettre */}
      <style>{`
        @keyframes marqueePerfect {
          0%, 25% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(-50%, 0, 0); }
        }
        .scroll-container {
          overflow: hidden;
          white-space: nowrap;
          width: 70px;
          display: flex;
          justify-content: flex-start;
        }
        .scroll-text {
          display: inline-block;
          font-family: 'Chakra Petch', sans-serif;
          font-size: 10px;
          font-weight: 700;
          color: #ffffff;
          padding-left: 2px;
        }
        .scrolling {
          animation: marqueePerfect 7s linear infinite;
        }
      `}</style>

      {/* Ombre */}
      <div style={{ position: 'absolute', bottom: '-4px', width: '26px', height: '6px', background: 'rgba(0,0,0,0.4)', borderRadius: '50%', filter: 'blur(2px)', transform: 'scaleY(0.4)', pointerEvents: 'none' }} />

      {/* Badge Numéro */}
      <div style={{
        width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '14px', fontWeight: 800, fontFamily: "'Chakra Petch', monospace", color: '#ffffff',
        background: `radial-gradient(circle at top, ${color} 0%, ${alpha(color, 0.6)} 100%)`,
        border: '2px solid #ffffff', boxShadow: '0 6px 12px rgba(0,0,0,0.35)', transform: 'translateY(-2px)'
      }}>
        {num}
      </div>

      {/* Capsule Nom */}
      <div style={{
        marginTop: '3px', background: 'rgba(10, 16, 30, 0.9)', border: '1px solid rgba(255, 255, 255, 0.12)',
        borderTop: `2px solid ${color}`, padding: '2px 4px', borderRadius: '4px', boxShadow: '0 4px 8px rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)'
      }}>
        <div className="scroll-container">
          <span className={`scroll-text ${isLongName ? 'scrolling' : ''}`}>
            {isLongName ? `${label} \u00a0\u00a0\u00a0\u00a0 ${label} \u00a0\u00a0\u00a0\u00a0` : label}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── COMPOSANT DU TERRAIN ─────────────────────────────────────────────────────
function Pitch({ formation, positions, teamColor }) {
  return (
    <div style={{
      width: '100%',
      aspectRatio: '3 / 4',
      background: '#061409',
      perspective: '700px',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute', inset: '-10% -6%', transform: 'rotateX(20deg)', transformOrigin: 'bottom center',
        background: 'radial-gradient(circle at 50% 35%, #194420 0%, #0b220f 65%, #051207 100%)',
      }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.01) 0px, rgba(255,255,255,0.01) 35px, transparent 35px, transparent 70px)' }} />
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12, bottom: 12, border: '1px solid rgba(255,255,255,0.15)' }} />
        <div style={{ position: 'absolute', left: 12, right: 12, top: '50%', height: 1, background: 'rgba(255,255,255,0.15)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: '26%', aspectRatio: '1', transform: 'translate(-50%, -50%)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '50%' }} />
        
        <div style={{ position: 'absolute', left: '50%', top: 12, width: '46%', height: '14%', transform: 'translateX(-50%)', border: '1px solid rgba(255,255,255,0.15)', borderTop: 'none' }} />
        <div style={{ position: 'absolute', left: '50%', bottom: 12, width: '46%', height: '14%', transform: 'translateX(-50%)', border: '1px solid rgba(255,255,255,0.15)', borderBottom: 'none' }} />

        {positions.map(({ leftPct, topPct, player }, i) =>
          player ? <PlayerDot key={i} leftPct={leftPct} topPct={topPct} player={player} teamColor={teamColor} /> : null
        )}
      </div>
    </div>
  )
}

// ── GRILLE DE LISTE DES JOUEURS TRADUITE ─────────────────────────────────────
function PlayerCell({ player, isSub }) {
  const cat = posCat(player.position)
  const catC = CAT_COLOR[cat]
  const posLabel = POS_FR[(player.position ?? '').toUpperCase()] ?? player.position ?? '—'
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
  return (
    <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={headerStyle}>Titulaires</div>
        {[...starters].sort((a,b) => posCat(a.position) - posCat(b.position)).map((p, i) => <PlayerCell key={i} player={p} isSub={false} />)}
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
  const positions = getPositions(team.starters ?? [], team.formation)

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
      <Pitch formation={team.formation} positions={positions} teamColor={teamColor} />
      <PlayerGrid starters={team.starters ?? []} subs={team.subs ?? []} />
    </div>
  )
}