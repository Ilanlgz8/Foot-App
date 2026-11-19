// Appels ESPN moins chers en CPU (19/11, projet Vercel suspendu pour dépassement du CPU) :
// connexions HTTPS gardées ouvertes et réutilisées d'un appel à l'autre (l'instance Vercel « Fluid »
// est réutilisée) au lieu d'une poignée de main TLS complète par requête — le mode groupé du Worker
// faisait jusqu'à 40 appels ESPN par minute, le mode calendrier 16 par requête.
// Fichier préfixé « _ » : Vercel n'en fait pas une fonction.
import https from 'node:https'

const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 30_000, maxSockets: 48, maxFreeSockets: 16, timeout: 60_000 })

// GET texte. Résout toujours : { ok, status, text } (ok:false + error en cas d'échec réseau/délai).
export function espnGetText(url, timeoutMs = 8_000) {
  return new Promise(resolve => {
    let done = false
    const finish = v => { if (!done) { done = true; resolve(v) } }
    const req = https.get(url, { agent, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'Accept': 'application/json' } }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', e => finish({ ok: false, status: 0, text: '', error: e.message }))
    })
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')) })
    req.on('error', e => finish({ ok: false, status: 0, text: '', error: e.message === 'timeout' ? 'timeout' : e.message }))
  })
}

// GET JSON : { ok, status, json } — json null si invalide.
export async function espnGetJson(url, timeoutMs = 8_000) {
  const r = await espnGetText(url, timeoutMs)
  if (!r.ok) return { ok: false, status: r.status, json: null, error: r.error }
  try { return { ok: true, status: r.status, json: JSON.parse(r.text) } }
  catch { return { ok: false, status: r.status, json: null, error: 'JSON invalide' } }
}
