// Image à partager d'un match (22/11, maquette validée par l'utilisateur) — dessinée sur le téléphone
// (canvas 1080×1920, format story), aucun appel serveur sauf les blasons (proxy /espn?crest=, mis en
// cache CDN un an, pour que le canvas puisse être exporté : une image d'un autre site le bloquerait).
// Mise en page : couleurs des deux clubs coupées en diagonale, score géant, buteurs sous chaque
// équipe (icône, nom, minute), phrase de résumé (matchSummary.js), adresse de l'app en bas.

const W = 1080, H = 1920

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (!m) return { r: 40, g: 70, b: 160 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
const rgb = ({ r, g, b }, a = 1) => `rgba(${r},${g},${b},${a})`
const mix = (c, d, t) => ({ r: Math.round(c.r + (d.r - c.r) * t), g: Math.round(c.g + (d.g - c.g) * t), b: Math.round(c.b + (d.b - c.b) * t) })
const WHITE = { r: 255, g: 255, b: 255 }, NIGHT = { r: 8, g: 14, b: 34 }
const lum = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

// Couleur de fond lisible : trop claire (blanc, jaune) → assombrie ; trop sombre → éclaircie.
function usable(hex) {
  let c = hexToRgb(hex)
  if (lum(c) > 0.8) c = mix(c, NIGHT, 0.35)
  else if (lum(c) > 0.62) c = mix(c, NIGHT, 0.15)
  if (lum(c) < 0.08) c = mix(c, WHITE, 0.25)
  return c
}

function crestSrc(url) {
  if (!url) return null
  if (url.startsWith('/') || url.startsWith('data:')) return url
  return `/espn?crest=${encodeURIComponent(url)}`
}
function loadImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Texte avec espacement des lettres (ctx.letterSpacing n'existe pas partout, iOS compris).
function spaced(ctx, text, x, y, spacing, align = 'left') {
  const chars = [...String(text)]
  const widths = chars.map(c => ctx.measureText(c).width)
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (chars.length - 1)
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x
  const prev = ctx.textAlign
  ctx.textAlign = 'left'
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing })
  ctx.textAlign = prev
  return total
}

function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w } else line = t
  }
  if (line) lines.push(line)
  return lines
}

function fitText(ctx, text, maxW, font, startPx, minPx) {
  let px = startPx
  ctx.font = font(px)
  while (px > minPx && ctx.measureText(text).width > maxW) { px -= 2; ctx.font = font(px) }
  return px
}

function drawCrest(ctx, img, cx, cy, size, fallbackText, color) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 22
  if (img) {
    const r = Math.min(size / img.width, size / img.height)
    const w = img.width * r, h = img.height * r
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h)
  } else {
    ctx.fillStyle = rgb(color); ctx.beginPath(); ctx.arc(cx, cy, size / 2.3, 0, Math.PI * 2); ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = '#fff'; ctx.font = `900 ${size / 3}px Archivo, Inter, system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(fallbackText, cx, cy + 2)
  }
  ctx.restore()
}

function drawRedCard(ctx, x, y) {
  ctx.save(); ctx.fillStyle = '#ef4444'
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - 15, 22, 30, 4) : ctx.rect(x, y - 15, 22, 30); ctx.fill()
  ctx.restore()
}

/**
 * @param {object} d
 *  d.home / d.away : { name, crest, color }
 *  d.hs, d.as : scores ; d.status : 'TERMINÉ' ou "67'" ; d.isFinished
 *  d.meta1, d.meta2 : lignes en haut à droite (« Ligue 1 · J11 », « Ven. 20 nov. »)
 *  d.homeLines / d.awayLines : [{ kind: 'goal'|'red', name, minutes }]
 *  d.summary : phrase de résumé (ou null)
 * @returns {Promise<Blob>}
 */
export async function renderShareCard(d) {
  try {
    await Promise.all([
      '900 100px Archivo', '800 40px Inter', '700 30px Inter', '600 22px Inter', '900 40px Inter',
    ].map(f => document.fonts?.load?.(f).catch(() => {})))
  } catch { /* polices système en repli */ }
  const [hImg, aImg] = await Promise.all([loadImage(crestSrc(d.home.crest)), loadImage(crestSrc(d.away.crest))])

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  // 23/11 (demande utilisateur) : fond aux couleurs du CHAMPIONNAT (comme les cartes de l'app), plus
  // celles des équipes. d.palette = [couleur 1, couleur 2] (getCompetitionCampColors) ; repli : équipes.
  const p1 = usable(d.palette?.[0] ?? d.home.color)
  const p2 = usable(d.palette?.[1] ?? d.palette?.[0] ?? d.away.color)
  const hc = p1, ac = lum(p2) < 0.1 ? mix(p2, p1, 0.45) : p2
  const xAt = y => W * 0.58 - (W * 0.16) * (y / H)   // trait de séparation (diagonale)

  // ── Fond : les deux couleurs en diagonale ──
  ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
  const half = (pts, c, x0, x1) => {
    const g = ctx.createLinearGradient(x0, 0, x1, H)
    g.addColorStop(0, rgb(mix(c, WHITE, 0.22))); g.addColorStop(0.42, rgb(c)); g.addColorStop(0.8, rgb(mix(c, NIGHT, 0.82)))
    ctx.fillStyle = g; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill()
  }
  half([[0, 0], [W * 0.58, 0], [W * 0.42, H], [0, H]], hc, 0, W * 0.5)
  half([[W * 0.58, 0], [W, 0], [W, H], [W * 0.42, H]], ac, W, W * 0.5)

  // halos derrière les blasons
  for (const cx of [252, 828]) {
    const r = ctx.createRadialGradient(cx, 470, 10, cx, 470, 330)
    r.addColorStop(0, 'rgba(255,255,255,0.26)'); r.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = r; ctx.fillRect(cx - 340, 130, 680, 680)
  }

  // nom du championnat en filigrane géant (contour seul), dans l'espace libre sous les buteurs
  if (d.compLabel) {
    const label = String(d.compLabel).toUpperCase()
    ctx.save()
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    let px = 260
    ctx.font = `900 ${px}px Archivo, Inter, system-ui, sans-serif`
    while (px > 120 && ctx.measureText(label).width > 1000) { px -= 10; ctx.font = `900 ${px}px Archivo, Inter, system-ui, sans-serif` }
    ctx.translate(W / 2, 1470); ctx.transform(1, 0, -0.16, 1, 0, 0)
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.strokeText(label, 0, 0)
    ctx.restore()
  }

  // fines lignes de lumière parallèles au trait
  ctx.save(); ctx.lineWidth = 2
  for (const [off, a] of [[-46, 0.12], [-80, 0.06], [52, 0.1], [92, 0.05]]) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`
    ctx.beginPath(); ctx.moveTo(xAt(0) + off, 0); ctx.lineTo(xAt(H) + off, H); ctx.stroke()
  }
  ctx.restore()

  // assombrissement du bas (texte lisible)
  let g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, 'rgba(0,0,0,0.2)'); g.addColorStop(0.16, 'rgba(0,0,0,0)'); g.addColorStop(0.52, 'rgba(0,0,0,0)')
  g.addColorStop(0.8, 'rgba(3,5,12,0.9)'); g.addColorStop(1, '#03050c')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  // trait lumineux continu (comme sur la maquette d'origine)
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3
  ctx.shadowColor = 'rgba(255,255,255,0.7)'; ctx.shadowBlur = 22
  ctx.beginPath(); ctx.moveTo(xAt(0), 0); ctx.lineTo(xAt(1560), 1560); ctx.stroke(); ctx.restore()

  // grain léger
  const n = document.createElement('canvas'); n.width = n.height = 128
  const nx = n.getContext('2d'); const id = nx.createImageData(128, 128)
  for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 14 }
  nx.putImageData(id, 0, 0)
  ctx.fillStyle = ctx.createPattern(n, 'repeat'); ctx.fillRect(0, 0, W, H)

  ctx.textBaseline = 'alphabetic'
  // ── En-tête ──
  ctx.font = '900 44px Archivo, Inter, system-ui, sans-serif'
  ctx.fillStyle = '#ef4444'; ctx.textAlign = 'left'; ctx.fillText('Stat', 60, 112)
  const sw = ctx.measureText('Stat').width
  ctx.fillStyle = '#fff'; ctx.fillText('Footix', 60 + sw, 112)
  ctx.font = '800 22px Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'
  if (d.meta1) spaced(ctx, d.meta1.toUpperCase(), 1018, 84, 4.4, 'right')
  if (d.meta2) spaced(ctx, d.meta2.toUpperCase(), 1018, 120, 4.4, 'right')

  // ── Deux moitiés ──
  const cols = [
    { cx: 252, team: d.home, img: hImg, c: hc, score: d.hs, lines: d.homeLines ?? [], x0: 80 },
    { cx: 828, team: d.away, img: aImg, c: ac, score: d.as, lines: d.awayLines ?? [], x0: 620 },
  ]
  const winner = d.isFinished && d.hs !== d.as ? (d.hs > d.as ? 0 : 1) : -1
  cols.forEach((col, i) => {
    drawCrest(ctx, col.img, col.cx, 448, 176, (col.team.name ?? '?').slice(0, 3).toUpperCase(), col.c)
    ctx.fillStyle = '#fff'
    fitText(ctx, col.team.name.toUpperCase(), 400, px => `800 ${px}px Inter, system-ui, sans-serif`, 27, 18)
    spaced(ctx, col.team.name.toUpperCase(), col.cx, 592, 6, 'center')
    // score géant, penché
    ctx.save()
    ctx.font = '900 470px Archivo, Inter, system-ui, sans-serif'
    const sg = ctx.createLinearGradient(0, -345, 0, 5)
    sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, 'rgba(225,232,255,1)')
    ctx.fillStyle = winner === -1 || winner === i ? sg : 'rgba(255,255,255,0.5)'
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 26
    ctx.translate(col.cx, 985); ctx.transform(1, 0, -0.16, 1, 0, 0)
    ctx.textAlign = 'center'; ctx.fillText(String(col.score ?? '–'), 0, 0)
    ctx.restore()
    if (winner === i) {
      ctx.save(); ctx.fillStyle = '#ef4444'; ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 16
      ctx.beginPath(); ctx.arc(col.cx - 74, 1052, 7, 0, Math.PI * 2); ctx.fill(); ctx.restore()
      ctx.font = '800 21px Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'
      spaced(ctx, 'VICTOIRE', col.cx - 56, 1060, 4.6, 'left')
    }
    // buteurs / rouges : icône, nom, minute — max 5 lignes
    const lines = col.lines.slice(0, 5)
    const more = col.lines.length - lines.length
    lines.forEach((l, k) => {
      const y = 1180 + k * 66
      if (l.kind === 'red') drawRedCard(ctx, col.x0 + 2, y - 12)
      else { ctx.font = '28px system-ui, "Apple Color Emoji", sans-serif'; ctx.textAlign = 'left'; ctx.fillText('⚽', col.x0 - 4, y - 1) }
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
      ctx.font = '800 36px Inter, system-ui, sans-serif'
      const maxName = 290
      let name = l.name
      while (ctx.measureText(name).width > maxName && name.length > 3) name = name.slice(0, -2) + '.'
      ctx.fillText(name, col.x0 + 48, y + 2)
      const nw = ctx.measureText(name).width
      ctx.font = '700 28px Inter, system-ui, sans-serif'
      ctx.fillText(l.minutes, col.x0 + 48 + nw + 16, y + 1)
    })
    if (more > 0) { ctx.font = '700 26px Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(`+${more}`, col.x0 + 48, 1180 + 5 * 66) }
  })

  // ── Statut au centre (sans fond) ──
  ctx.save(); ctx.fillStyle = '#fff'; ctx.font = '900 32px Inter, system-ui, sans-serif'
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 3
  spaced(ctx, String(d.status ?? '').toUpperCase(), W / 2 + 12, 803, 6, 'center')
  ctx.restore()

  // ── Résumé ──
  if (d.summary) {
    ctx.font = '700 38px Inter, system-ui, sans-serif'
    const lines = wrapLines(ctx, d.summary, 920).slice(0, 3)
    const top = 1750 - lines.length * 50
    ctx.fillStyle = '#ef4444'; ctx.fillRect(60, top - 34, 6, lines.length * 50 + 14)
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
    lines.forEach((t, i) => ctx.fillText(t, 94, top + i * 50))
  }
  // ── Pied ──
  ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(60, 1790, 960, 2)
  ctx.font = '800 22px Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
  ctx.fillText('StatFootix', 60, 1846)
  const fw = ctx.measureText('StatFootix').width
  ctx.font = '600 22px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText(' · scores et notifs en direct', 60 + fw, 1846)
  ctx.textAlign = 'right'; ctx.fillText('statfootix.vercel.app', 1020, 1846)

  // JPEG : bien plus léger qu'un PNG (3,5 Mo mesuré en PNG à cause du grain), qualité identique à l'œil.
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('image'))), 'image/jpeg', 0.92))
}

// Partage via le menu natif (iPhone / Android) ; sinon téléchargement de l'image.
export async function shareImage(blob, fileName, title) {
  const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared' } catch (e) { if (e?.name === 'AbortError') return 'cancelled' }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
