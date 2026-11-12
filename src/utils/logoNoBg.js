// Logos des clubs de Ligue 3 (12/11, demande utilisateur : « enlève le fond blanc derrière les
// logos »). La FFF ne fournit que des JPEG sur fond blanc (cdn-transverse.azureedge.net), et ce
// CDN n'autorise pas la lecture depuis un autre site (pas de CORS) : impossible de les détourer
// dans le navigateur. Fait donc côté serveur (/espn?l3logo=BCxxxx), UNE fois par logo : la
// réponse est mise en cache CDN 1 an.
//
// Méthode : on part des bords de l'image et on efface le blanc qui TOUCHE le bord (remplissage
// par diffusion) — le blanc À L'INTÉRIEUR du blason (bandes, lettres) est gardé. Les pixels de
// transition gardent une transparence partielle pour éviter un liseré blanc. Puis on recadre
// au plus près du blason.
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

const HARD = 238 // au-dessus : blanc de fond (effacé)
const SOFT = 200 // entre SOFT et HARD : bord adouci (transparence partielle)

export function removeWhiteBackground(jpgBuffer) {
  const { width: w, height: h, data } = jpeg.decode(jpgBuffer, { useTArray: true, formatAsRGBA: true })
  const minC = i => Math.min(data[i], data[i + 1], data[i + 2])
  const isBg = p => minC(p * 4) >= SOFT

  // Diffusion depuis tous les pixels du bord
  const visited = new Uint8Array(w * h)
  const stack = []
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x) }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1) }
  while (stack.length) {
    const p = stack.pop()
    if (visited[p] || !isBg(p)) continue
    visited[p] = 1
    const x = p % w
    if (x > 0) stack.push(p - 1)
    if (x < w - 1) stack.push(p + 1)
    if (p >= w) stack.push(p - w)
    if (p < w * (h - 1)) stack.push(p + w)
  }

  for (let p = 0; p < w * h; p++) {
    if (!visited[p]) continue
    const i = p * 4
    const m = minC(i)
    data[i + 3] = m >= HARD ? 0 : Math.round(255 * (HARD - m) / (HARD - SOFT))
  }

  // Recadrage sur la zone non transparente
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1 }
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const png = new PNG({ width: cw, height: ch })
  for (let y = 0; y < ch; y++) {
    const src = ((y + y0) * w + x0) * 4
    png.data.set(data.subarray(src, src + cw * 4), y * cw * 4)
  }
  return PNG.sync.write(png)
}
