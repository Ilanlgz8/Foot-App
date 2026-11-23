// Image à partager d'un match — dessinée sur le téléphone (canvas 1080×1920, format story), aucun
// appel serveur sauf les blasons (proxy /espn?crest=, mis en cache CDN un an, pour que le canvas
// puisse être exporté : une image d'un autre site le bloquerait).
// 23/11 (maquette choisie par l'utilisateur) : même habillage pour tous les matchs, aux couleurs de
// l'app — fond noir, lueurs rouges dans deux coins, logo du championnat en haut, « FIN DU MATCH »,
// blasons, noms, score géant avec tiret rouge, buteurs, logo StatFootix en bas. Seuls le championnat,
// les équipes, le score et les buteurs changent.
// Règles de rendu (constats sur iPhone) : aucun shadowBlur (tache noire), aucun ctx.filter (ignoré par
// Safari) ; tout est en aplats et dégradés.

import scoreFontUrl from '@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2?url'

const W = 1080, H = 1920
const RED = '#e50914'
const L = 270, R = 810            // centres des deux colonnes
// Police du score : Archivo Black (choisie par l'utilisateur, 23/11 ; même police que le score du Match
// du jour). Chargée À PART sous un nom dédié (FontFace, fichier du build) : constat utilisateur, avec la
// police de l'app (CSS @font-face découpé par plages de caractères) Safari dessinait parfois le score
// dans une police fine de repli au premier partage. Si le chargement échoue malgré tout : Archivo 900
// (épaisse) plutôt qu'une police fine.
let scoreFaceOk = false
const SCORE_FONT = px => (scoreFaceOk ? `400 ${px}px SFShareScore, "Archivo Black", Archivo, sans-serif` : `900 ${px}px "Archivo Black", Archivo, Inter, system-ui, sans-serif`)
const SCORE_PX = 320

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
function spaced(ctx, text, x, y, spacing, align = 'left', measureOnly = false) {
  const chars = [...String(text)]
  const widths = chars.map(c => ctx.measureText(c).width)
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (chars.length - 1)
  if (measureOnly) return total
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x
  const prev = ctx.textAlign
  ctx.textAlign = 'left'
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing })
  ctx.textAlign = prev
  return total
}

function fitText(ctx, text, maxW, font, startPx, minPx, spacing = 0) {
  let px = startPx
  ctx.font = font(px)
  while (px > minPx && spaced(ctx, text, 0, 0, spacing, 'left', true) > maxW) { px -= 2; ctx.font = font(px) }
  return px
}

// Partie VISIBLE d'une image (beaucoup de logos ont une marge transparente inégale) → centrage exact.
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

// Centre horizontal réel (pixels) d'un texte dessiné à x = 0 : un « 1 » n'est pas centré dans sa boîte.
function inkCenterX(font, txt) {
  try {
    const cw = 1100, ch = 640, ox = 200, base = 560
    const c = document.createElement('canvas'); c.width = cw; c.height = ch
    const x = c.getContext('2d', { willReadFrequently: true })
    x.font = font; x.textAlign = 'left'; x.fillStyle = '#fff'; x.fillText(txt, ox, base)
    const px = x.getImageData(0, 0, cw, ch).data
    let x0 = cw, x1 = -1
    for (let i = 0; i < cw; i++) for (let y = 0; y < ch; y += 2) if (px[(y * cw + i) * 4 + 3] > 64) { if (i < x0) x0 = i; x1 = i; break }
    if (x1 < 0) throw 0
    return (x0 + x1) / 2 - ox
  } catch {
    return 0
  }
}

// Drapeau (sélections nationales) : carré aux coins arrondis rempli par le drapeau, comme dans l'app
// ([data-crest="country"] d'index.css : rayon 22 %, image recadrée au centre ; les drapeaux ESPN ont une
// marge interne → agrandis ×1,6 comme dans l'app).
function drawFlag(ctx, img, cx, cy, size, src) {
  const x = cx - size / 2, y = cy - size / 2
  ctx.save()
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, size, size, size * 0.22) : ctx.rect(x, y, size, size); ctx.clip()
  const zoom = /teamlogos\/countries/.test(src ?? '') ? 1.6 : 1
  const r = Math.max(size / img.width, size / img.height) * zoom
  const w = img.width * r, h = img.height * r
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h)
  ctx.restore()
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + 1, y + 1, size - 2, size - 2, size * 0.22) : ctx.rect(x + 1, y + 1, size - 2, size - 2); ctx.stroke()
  ctx.restore()
}

function drawCrest(ctx, img, cx, cy, size, fallbackText, flagSrc = null) {
  if (img && flagSrc) { drawFlag(ctx, img, cx, cy, size * 0.82, flagSrc); return }
  ctx.save()
  if (img) {
    const box = inkBox(img)
    const r = Math.min(size / box.w, size / box.h)
    ctx.drawImage(img, box.x, box.y, box.w, box.h, cx - box.w * r / 2, cy - box.h * r / 2, box.w * r, box.h * r)
  } else {
    ctx.fillStyle = '#1c1d22'; ctx.beginPath(); ctx.arc(cx, cy, size / 2.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    fitText(ctx, fallbackText, size * 0.62, px => `900 ${px}px Inter, system-ui, sans-serif`, Math.round(size / 3.2), 24)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(fallbackText, cx, cy + 2)
  }
  ctx.restore()
}

// Ballon monochrome (pas d'emoji : rendu différent selon le téléphone)
function drawBall(ctx, cx, cy, r) {
  ctx.save()
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#0b0b0d'
  const pent = (x, y, s, rot) => {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) { const a = rot + i * 2 * Math.PI / 5; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * s, y + Math.sin(a) * s) }
    ctx.closePath(); ctx.fill()
  }
  pent(cx, cy, r * 0.36, -Math.PI / 2)
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / 5
    pent(cx + Math.cos(a) * r * 1.02, cy + Math.sin(a) * r * 1.02, r * 0.3, a + Math.PI / 5)
  }
  ctx.restore()
  ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

function drawRedCard(ctx, cx, cy) {
  ctx.save(); ctx.fillStyle = '#ef4444'
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - 10, cy - 14, 20, 28, 4) : ctx.rect(cx - 10, cy - 14, 20, 28); ctx.fill()
  ctx.restore()
}

// Trait fin qui s'efface aux deux bouts
function fadeLine(ctx, x0, y0, x1, y1, a = 0.45, w = 2) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.save(); ctx.strokeStyle = g; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore()
}
// Trait fin, effacé côté bord et plein côté titre (de part et d'autre d'un texte)
function sideLine(ctx, xFrom, xTo, y, a = 0.4) {
  const g = ctx.createLinearGradient(xFrom, y, xTo, y)
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,255,255,${a})`)
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(Math.min(xFrom, xTo), y - 1, Math.abs(xTo - xFrom), 2); ctx.restore()
}

/**
 * @param {object} d
 *  d.home / d.away : { name, crest } ; d.hs, d.as : scores ; d.isFinished ; d.status : libellé en direct ("67'")
 *  d.compLogo (+ d.compLogoOpaque) : logo du championnat ; d.isNational : sélections → drapeaux arrondis
 *  d.homeLines / d.awayLines : [{ kind: 'goal'|'red', name, minutes }]
 * @returns {Promise<Blob>}
 */
// Polices de l'image : chargées AVANT de dessiner (sinon le canvas prend la police de repli).
let fontsPromise = null
async function loadScoreFace() {
  if (typeof FontFace === 'undefined' || !document.fonts) return
  const face = new FontFace('SFShareScore', `url(${scoreFontUrl}) format("woff2")`, { weight: '400', style: 'normal' })
  await face.load()
  document.fonts.add(face)
  // Safari : une police tout juste ajoutée n'est pas toujours prise par le canvas au tout premier
  // dessin → dessin d'amorçage, puis on laisse passer deux images d'écran.
  const c = document.createElement('canvas'); c.width = c.height = 8
  const x = c.getContext('2d'); x.font = '400 8px SFShareScore'; x.fillText('0123456789', 0, 8)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  scoreFaceOk = document.fonts.check('400 40px SFShareScore', '0123456789')
}
export function preloadShareFonts() {
  if (!fontsPromise) {
    const load = async () => {
      await loadScoreFace().catch(() => {})
      await document.fonts?.load?.('800 40px Inter', 'FIN').catch(() => {})
    }
    // jamais bloquant plus de 5 s (réseau très lent : repli épais, voir SCORE_FONT)
    fontsPromise = Promise.race([load(), new Promise(r => setTimeout(r, 5000))])
      .then(() => { if (!scoreFaceOk) fontsPromise = null }) // raté : on réessaiera au prochain partage
  }
  return fontsPromise ?? Promise.resolve()
}

export async function renderShareCard(d) {
  await preloadShareFonts()
  const [hImg, aImg, compImg] = await Promise.all([loadImage(crestSrc(d.home.crest)), loadImage(crestSrc(d.away.crest)), loadImage(crestSrc(d.compLogo))])

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  // ── Fond : noir, lueurs rouges en haut à gauche et en bas à droite ──
  ctx.fillStyle = '#060607'; ctx.fillRect(0, 0, W, H)
  const glow = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(200,8,20,${a})`); g.addColorStop(0.45, `rgba(140,6,16,${a * 0.45})`); g.addColorStop(1, 'rgba(120,0,10,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }
  glow(-60, 120, 820, 0.9)
  glow(W + 80, H - 260, 900, 0.85)
  // grain léger (évite les bandes dans les dégradés)
  const n = document.createElement('canvas'); n.width = n.height = 128
  const nx = n.getContext('2d'); const id = nx.createImageData(128, 128)
  for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 10 }
  nx.putImageData(id, 0, 0)
  ctx.fillStyle = ctx.createPattern(n, 'repeat'); ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  // ── Logo du championnat ──
  if (compImg) {
    const box = d.compLogoOpaque ? { x: 0, y: 0, w: compImg.width, h: compImg.height } : inkBox(compImg)
    const max = 190, r = Math.min(max / box.w, max / box.h)
    const w = box.w * r, h = box.h * r, x = W / 2 - w / 2, y = 225 - h / 2
    ctx.save()
    if (d.compLogoOpaque) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 28) : ctx.rect(x, y, w, h); ctx.clip() }
    ctx.drawImage(compImg, box.x, box.y, box.w, box.h, x, y, w, h)
    ctx.restore()
  }

  // ── « FIN DU MATCH » entre deux traits ──
  const live = String(d.status ?? '').toUpperCase()
  const status = d.isFinished ? 'FIN DU MATCH' : (live ? `EN DIRECT · ${live}` : 'EN DIRECT')
  ctx.fillStyle = '#fff'; ctx.font = '800 36px Inter, system-ui, sans-serif'
  const sw = spaced(ctx, status, W / 2, 442, 14, 'center')
  sideLine(ctx, 70, W / 2 - sw / 2 - 40, 430)
  sideLine(ctx, W - 70, W / 2 + sw / 2 + 40, 430)

  // ── Blasons, séparés par un trait vertical ──
  drawCrest(ctx, hImg, L, 680, 250, (d.home.name ?? '?').slice(0, 3).toUpperCase(), d.isNational ? d.home.crest : null)
  drawCrest(ctx, aImg, R, 680, 250, (d.away.name ?? '?').slice(0, 3).toUpperCase(), d.isNational ? d.away.crest : null)
  fadeLine(ctx, W / 2, 560, W / 2, 820, 0.5)

  // ── Noms ──
  for (const [cx, name] of [[L, d.home.name], [R, d.away.name]]) {
    const t = String(name ?? '').toUpperCase()
    fitText(ctx, t, 400, px => `800 ${px}px Inter, system-ui, sans-serif`, 46, 26, 5)
    ctx.fillStyle = '#fff'; spaced(ctx, t, cx, 893, 5, 'center')
  }

  // ── Score : chiffres géants centrés sous chaque blason, tiret rouge au milieu ──
  ctx.font = SCORE_FONT(SCORE_PX); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
  for (const [cx, v] of [[L, d.hs], [R, d.as]]) {
    const txt = String(v ?? '–')
    ctx.fillText(txt, cx - inkCenterX(ctx.font, txt), 1215)
  }
  ctx.fillStyle = RED; ctx.fillRect(W / 2 - 46, 1078, 92, 30)

  // ── Buteurs / cartons rouges, séparés par un trait vertical ──
  const colLines = [d.homeLines ?? [], d.awayLines ?? []]
  const maxRows = Math.max(1, ...colLines.map(l => Math.min(l.length, 5)))
  colLines.forEach((all, i) => {
    const x0 = i ? 640 : 150
    all.slice(0, 5).forEach((l, k) => {
      const y = 1330 + k * 60
      if (l.kind === 'red') drawRedCard(ctx, x0, y - 12); else drawBall(ctx, x0, y - 12, 17)
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
      ctx.font = '600 34px Inter, system-ui, sans-serif'
      let name = l.name
      while (ctx.measureText(name).width > 230 && name.length > 3) name = name.slice(0, -2) + '.'
      ctx.fillText(name, x0 + 40, y)
      const nw = ctx.measureText(name).width
      ctx.font = '500 32px Inter, system-ui, sans-serif'
      ctx.fillText(l.minutes, x0 + 40 + nw + 14, y)
    })
    if (all.length > 5) { ctx.font = '600 28px Inter, system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(`+${all.length - 5}`, x0 + 40, 1330 + 5 * 60) }
  })
  if (colLines.some(l => l.length)) fadeLine(ctx, W / 2, 1270, W / 2, 1330 + maxRows * 60 + 10, 0.5)

  // ── Logo StatFootix entre deux traits (couleurs du logo de l'app : « Stat » rouge, « Footix » blanc) ──
  ctx.font = 'italic 900 76px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'
  let brandRed = '#fb3b4e'
  try { brandRed = getComputedStyle(document.documentElement).getPropertyValue('--sf-red').trim() || brandRed } catch { /* défaut */ }
  const sW = ctx.measureText('Stat').width, fW = ctx.measureText('Footix').width
  const bx = W / 2 - (sW + fW) / 2, by = 1742
  ctx.fillStyle = brandRed; ctx.fillText('Stat', bx, by)
  ctx.fillStyle = '#fff'; ctx.fillText('Footix', bx + sW, by)
  sideLine(ctx, 70, bx - 40, by - 27)
  sideLine(ctx, W - 70, bx + sW + fW + 40, by - 27)

  // JPEG : bien plus léger qu'un PNG, qualité identique à l'œil.
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('image'))), 'image/jpeg', 0.92))
}

// Partage via le menu natif (iPhone / Android) ; sinon téléchargement de l'image.
export async function shareImage(blob, fileName) {
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
