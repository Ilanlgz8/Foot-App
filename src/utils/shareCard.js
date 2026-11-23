// Image à partager d'un match (22/11, maquette validée par l'utilisateur) — dessinée sur le téléphone
// (canvas 1080×1920, format story), aucun appel serveur sauf les blasons (proxy /espn?crest=, mis en
// cache CDN un an, pour que le canvas puisse être exporté : une image d'un autre site le bloquerait).
// Mise en page : fond aux couleurs du championnat, trait lumineux en diagonale entre les deux équipes, score géant
// centré sous chaque blason, buteurs sous chaque équipe (icône, nom, minute), phrase de résumé (matchSummary.js), adresse de l'app en bas.

const W = 1080, H = 1920
const SKEW = 0.16

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

// Centre horizontal réel (pixels) d'un score dessiné penché à x = 0.
function inkCenterX(font, txt) {
  try {
    const cw = 1100, ch = 640, ox = 200, base = 560
    const c = document.createElement('canvas'); c.width = cw; c.height = ch
    const x = c.getContext('2d', { willReadFrequently: true })
    x.font = font; x.textAlign = 'left'; x.fillStyle = '#fff'
    x.translate(ox, base); x.transform(1, 0, -SKEW, 1, 0, 0); x.fillText(txt, 0, 0)
    const px = x.getImageData(0, 0, cw, ch).data
    let x0 = cw, x1 = -1
    for (let i = 0; i < cw; i++) for (let y = 0; y < ch; y += 2) if (px[(y * cw + i) * 4 + 3] > 64) { if (i < x0) x0 = i; x1 = i; break }
    if (x1 < 0) throw 0
    return (x0 + x1) / 2 - ox
  } catch {
    return 0
  }
}

function inkBox(img) {
  const full = { x: 0, y: 0, w: img.width, h: img.height }
  try {
    const n = 96, k = n / Math.max(img.width, img.height)
    const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h)
    const px = x.getImageData(0, 0, w, h).data
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
      if (px[(y * w + i) * 4 + 3] > 24) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    if (x1 < 0) return full
    return { x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k }
  } catch { return full }
}

function drawCrest(ctx, img, cx, cy, size, fallbackText, color) {
  // Ombre douce sous le blason : dégradé radial (et pas shadowBlur, que Safari/iPhone rend en tache
  // noire nette — constat utilisateur 23/11 : l'image enregistrée n'était pas la même que l'aperçu).
  ctx.save()
  ctx.translate(cx, cy + size * 0.42); ctx.scale(1, 0.32)
  const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.6)
  sh.addColorStop(0, 'rgba(0,0,0,0.38)'); sh.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, size * 0.6, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  ctx.save()
  if (img) {
    // centré sur la partie VISIBLE du blason (beaucoup de logos ont une marge transparente inégale)
    const box = inkBox(img)
    const r = Math.min(size / box.w, size / box.h)
    ctx.drawImage(img, box.x, box.y, box.w, box.h, cx - box.w * r / 2, cy - box.h * r / 2, box.w * r, box.h * r)
  } else {
    ctx.fillStyle = rgb(color); ctx.beginPath(); ctx.arc(cx, cy, size / 2.3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    fitText(ctx, fallbackText, size * 0.62, px => `900 ${px}px Archivo, Inter, system-ui, sans-serif`, Math.round(size / 3), 24)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(fallbackText, cx, cy + 2)
  }
  ctx.restore()
}

function drawRedCard(ctx, x, y) {
  ctx.save(); ctx.fillStyle = '#ef4444'
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - 15, 22, 30, 4) : ctx.rect(x, y - 15, 22, 30); ctx.fill()
  ctx.restore()
}

// ── Lueurs douces, rendu identique sur tous les navigateurs ──
// Ni shadowBlur (tache noire nette sur iPhone, 23/11) ni ctx.filter (ignoré par Safari), ni traits
// superposés (laissaient des fines lignes autour, 23/11) : on dessine la forme en petit, on floute
// sa transparence à la main, puis on l'agrandit (lissage) dans la couleur voulue.
function blurAlpha(a, w, h, r, passes) {
  const tmp = new Float32Array(Math.max(w, h))
  const run = (get, set, len, count) => {
    for (let k = 0; k < count; k++) {
      let sum = 0
      for (let i = -r; i <= r; i++) sum += get(k, Math.min(len - 1, Math.max(0, i)))
      for (let i = 0; i < len; i++) {
        tmp[i] = sum / (2 * r + 1)
        sum += get(k, Math.min(len - 1, i + r + 1)) - get(k, Math.max(0, i - r))
      }
      for (let i = 0; i < len; i++) set(k, i, tmp[i])
    }
  }
  for (let p = 0; p < passes; p++) {
    run((y, x) => a[y * w + x], (y, x, v) => { a[y * w + x] = v }, w, h)
    run((x, y) => a[y * w + x], (x, y, v) => { a[y * w + x] = v }, h, w)
  }
}
function softLayer(draw, color, { scale = 1 / 4, radius = 4, passes = 3 } = {}) {
  const w = Math.ceil(W * scale), h = Math.ceil(H * scale)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d', { willReadFrequently: true })
  x.scale(scale, scale); x.fillStyle = '#fff'; x.strokeStyle = '#fff'
  draw(x)
  const img = x.getImageData(0, 0, w, h), px = img.data
  const a = new Float32Array(w * h)
  for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3]
  blurAlpha(a, w, h, radius, passes)
  for (let i = 0; i < a.length; i++) { px[i * 4] = color.r; px[i * 4 + 1] = color.g; px[i * 4 + 2] = color.b; px[i * 4 + 3] = a[i] }
  x.putImageData(img, 0, 0)
  return c
}
function paintLayer(ctx, layer, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(layer, 0, 0, W, H); ctx.restore()
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
  const [hImg, aImg, compImg] = await Promise.all([loadImage(crestSrc(d.home.crest)), loadImage(crestSrc(d.away.crest)), loadImage(crestSrc(d.compLogo))])

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  // 23/11 (demande utilisateur) : fond aux couleurs du CHAMPIONNAT (comme les cartes de l'app), plus
  // celles des équipes. d.palette = [couleur 1, couleur 2] (getCompetitionCampColors) ; repli : équipes.
  // Même couleur des deux côtés (23/11, demande utilisateur) : la couleur principale du championnat ;
  // c'est le trait lumineux qui sépare les deux équipes.
  const p1 = usable(d.palette?.[0] ?? d.home.color)
  const hc = p1, ac = p1
  const xAt = y => W * 0.58 - (W * 0.16) * (y / H)   // trait de séparation (diagonale)

  // ── Fond : les deux couleurs en diagonale ──
  ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
  // un seul dégradé pour toute l'image (plus de couture le long de la diagonale)
  { const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, rgb(mix(p1, WHITE, 0.2))); bg.addColorStop(0.4, rgb(p1)); bg.addColorStop(0.8, rgb(mix(p1, NIGHT, 0.82)))
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H) }

  // halos derrière les blasons
  for (const cx of [252, 828]) {
    const r = ctx.createRadialGradient(cx, 392, 10, cx, 392, 340)
    r.addColorStop(0, 'rgba(255,255,255,0.26)'); r.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = r; ctx.fillRect(cx - 350, 40, 700, 700)
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
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    ctx.fillText(label, 0, 0)
    ctx.restore()
  }

  // assombrissement du bas (texte lisible)
  let g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, 'rgba(0,0,0,0.2)'); g.addColorStop(0.16, 'rgba(0,0,0,0)'); g.addColorStop(0.52, 'rgba(0,0,0,0)')
  g.addColorStop(0.8, 'rgba(3,5,12,0.9)'); g.addColorStop(1, '#03050c')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

  // séparation = trait blanc en diagonale (23/11 : l'éclair a été essayé puis écarté par
  // l'utilisateur) ; lueur floutée (softLayer), aucun reflet ni ligne parasite ; il s'efface autour
  // du statut (lisible) et vers le bas (résumé).
  const fade = c => {
    const gr = c.createLinearGradient(0, 0, 0, 1640)
    const st = [[0, 0], [150, 0], [270, 1], [690, 1], [748, 0], [832, 0], [890, 1], [1380, 1], [1640, 0]] // ne traverse pas l'en-tête
    st.forEach(([y, a]) => gr.addColorStop(y / 1640, `rgba(255,255,255,${a})`))
    return gr
  }
  const beam = (c, w) => {
    c.strokeStyle = fade(c); c.lineWidth = w; c.lineCap = 'round'
    c.beginPath(); c.moveTo(xAt(-40), -40); c.lineTo(xAt(1640), 1640); c.stroke()
  }
  const tint = mix(p1, WHITE, 0.55)
  paintLayer(ctx, softLayer(c => beam(c, 60), tint, { scale: 1 / 8, radius: 6 }), 0.6)  // grande lueur
  paintLayer(ctx, softLayer(c => beam(c, 18), tint, { scale: 1 / 3, radius: 4 }), 0.85) // lueur proche
  ctx.save(); beam(ctx, 7); ctx.restore()                                                // trait net

  // grain léger
  const n = document.createElement('canvas'); n.width = n.height = 128
  const nx = n.getContext('2d'); const id = nx.createImageData(128, 128)
  for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 14 }
  nx.putImageData(id, 0, 0)
  ctx.fillStyle = ctx.createPattern(n, 'repeat'); ctx.fillRect(0, 0, W, H)

  ctx.textBaseline = 'alphabetic'
  // ── En-tête ──
  ctx.font = '900 44px Archivo, Inter, system-ui, sans-serif'
  // même rouge que le logo de l'app (variable --sf-red, #fb3b4e par défaut)
  let brandRed = '#fb3b4e'
  try { brandRed = getComputedStyle(document.documentElement).getPropertyValue('--sf-red').trim() || brandRed } catch { /* défaut */ }
  ctx.fillStyle = brandRed; ctx.textAlign = 'left'; ctx.fillText('Stat', 60, 112)
  const sw = ctx.measureText('Stat').width
  ctx.fillStyle = '#fff'; ctx.fillText('Footix', 60 + sw, 112)
  // en-tête à droite : réduit si le nom de la compétition est long (« Ligue 1 McDonald's · J11 »)
  { let px = 22; const longest = [d.meta1, d.meta2].filter(Boolean).map(t => t.toUpperCase()).sort((x, y) => y.length - x.length)[0] ?? ''
    const width = f => { ctx.font = `800 ${f}px Inter, system-ui, sans-serif`; return [...longest].reduce((sum, c) => sum + ctx.measureText(c).width, 0) + 4.4 * (longest.length - 1) }
    while (px > 16 && width(px) > 520) px -= 1
    ctx.font = `800 ${px}px Inter, system-ui, sans-serif` }
  ctx.fillStyle = '#fff'
  const m1w = d.meta1 ? spaced(ctx, d.meta1.toUpperCase(), 1018, 84, 4.4, 'right') : 0
  const m2w = d.meta2 ? spaced(ctx, d.meta2.toUpperCase(), 1018, 120, 4.4, 'right') : 0
  // logo du championnat à gauche du texte (23/11), comme dans l'app : coins arrondis s'il a un fond
  if (compImg) {
    const hgt = 66, w = Math.min(110, compImg.width * (hgt / compImg.height))
    const x = 1018 - Math.max(m1w, m2w) - 20 - w, y = 58
    ctx.save()
    if (d.compLogoOpaque) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, hgt, 12) : ctx.rect(x, y, w, hgt); ctx.clip() }
    ctx.drawImage(compImg, x, y, w, hgt)
    ctx.restore()
  }

  // ── Deux moitiés ──
  const cols = [
    { cx: 252, team: d.home, img: hImg, c: hc, score: d.hs, lines: d.homeLines ?? [], x0: 80 },
    { cx: 828, team: d.away, img: aImg, c: ac, score: d.as, lines: d.awayLines ?? [], x0: 620 },
  ]
  const winner = d.isFinished && d.hs !== d.as ? (d.hs > d.as ? 0 : 1) : -1
  cols.forEach((col, i) => {
    drawCrest(ctx, col.img, col.cx, 392, 236, (col.team.name ?? '?').slice(0, 3).toUpperCase(), mix(col.c, NIGHT, 0.6))
    ctx.fillStyle = '#fff'
    // 23/11 : blasons et noms plus grands (demande utilisateur)
    fitText(ctx, col.team.name.toUpperCase(), 380, px => `800 ${px}px Inter, system-ui, sans-serif`, 36, 22)
    spaced(ctx, col.team.name.toUpperCase(), col.cx, 576, 7, 'center')
    // score géant, penché
    ctx.save()
    ctx.font = '900 450px Archivo, Inter, system-ui, sans-serif'
    const sg = ctx.createLinearGradient(0, -390, 0, 5)
    sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, 'rgba(225,232,255,1)')
    ctx.fillStyle = sg // 23/11 : le score du perdant aussi en blanc (seul le gagnant garde le halo)
    ctx.textAlign = 'left'
    const txt = String(col.score ?? '–')
    // centrage au pixel près sur le blason et le nom (23/11) : centre du DESSIN du chiffre penché,
    // mesuré sur les pixels (pas sa boîte typographique, décalée pour un « 1 » par exemple).
    const ox = -inkCenterX(ctx.font, txt)
    const place = c => { c.translate(col.cx, 985); c.transform(1, 0, -SKEW, 1, 0, 0) }
    if (winner === -1 || winner === i) {
      // halo lumineux derrière le score (gagnant, ou les deux en cas de nul / en direct)
      paintLayer(ctx, softLayer(c => { place(c); c.font = ctx.font; c.textAlign = 'left'; c.fillText(txt, ox, 0) }, WHITE, { scale: 1 / 4, radius: 5 }), 0.42)
    }
    place(ctx)
    ctx.fillText(txt, ox, 0)
    ctx.restore()
    // buteurs / rouges : icône, nom, minute — max 5 lignes
    const lines = col.lines.slice(0, 5)
    const more = col.lines.length - lines.length
    lines.forEach((l, k) => {
      const y = 1192 + k * 66
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
  ctx.save(); ctx.font = '900 32px Inter, system-ui, sans-serif'
  const stTxt = String(d.status ?? '').toUpperCase()
  ctx.fillStyle = '#fff'
  spaced(ctx, stTxt, xAt(790), 803, 6, 'center')
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
    // fichier SEUL : avec un titre, Snapchat (et d'autres) prennent le texte au lieu de l'image → écran noir
    try { await navigator.share({ files: [file] }); return 'shared' } catch (e) { if (e?.name === 'AbortError') return 'cancelled' }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
