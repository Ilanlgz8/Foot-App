// Agrège plusieurs flux RSS football français
//
// ⚠️ AJOUT (audit sécurité demandé par l'utilisateur) : ce endpoint refetchait
// les 4 flux RSS à CHAQUE appel, sans aucun cache ni limite de débit — un
// endpoint public appelable en boucle (curl/bot) pouvait donc générer un
// nombre illimité de fetchs sortants. Un cache Redis court (5min, l'actu
// football n'a pas besoin d'être seconde par seconde) résout les deux
// problèmes à la fois : coût réel réduit ET une éventuelle boucle d'appels
// retombe sur le cache au lieu de re-taper les flux à chaque fois.
import { Redis } from '@upstash/redis'

let kv = null
function getKv() {
  if (!kv && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  }
  return kv
}

const NEWS_CACHE_KEY = 'news:articles'
const NEWS_CACHE_TTL = 5 * 60 // 5min

const RSS_FEEDS = [
  'https://www.lequipe.fr/rss/actu_rss_Football.xml',
  'https://rmcsport.bfmtv.com/rss/football/',
  'https://www.footmercato.net/feed',
  'https://www.eurosport.fr/football/rss.xml',
]

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!match) return ''
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function extractImage(itemXml) {
  const enclosure = itemXml.match(/enclosure[^>]+url="([^"]+)"/i)
  if (enclosure) return enclosure[1]
  const media = itemXml.match(/media:(?:content|thumbnail)[^>]+url="([^"]+)"/i)
  if (media) return media[1]
  return null
}

// Valide qu'une URL est bien https:// (protection XSS javascript: dans les liens)
function safeUrl(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? url : null
  } catch { return null }
}

function parseRSS(xml, sourceName) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []
  return items.map(item => {
    const url = safeUrl(extractTag(item, 'link') || extractTag(item, 'guid'))
    const img = safeUrl(extractImage(item))
    return {
      title:       extractTag(item, 'title'),
      url,
      description: extractTag(item, 'description').replace(/<[^>]+>/g, '').slice(0, 200),
      image:       img,
      publishedAt: new Date(extractTag(item, 'pubDate')).toISOString(),
      source:      sourceName,
    }
  }).filter(a => a.title && a.url)
}

function fetchWithTimeout(url, options, ms = 6000) {
  const ctrl = new AbortController()
  const id   = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

export default async function handler(_req, res) {
  const redis = getKv()
  try {
    if (redis) {
      try {
        const cached = await redis.get(NEWS_CACHE_KEY)
        if (cached) {
          const articles = typeof cached === 'string' ? JSON.parse(cached) : cached
          return res.status(200).json({ articles })
        }
      } catch { /* KV indisponible → on retombe sur le fetch direct ci-dessous */ }
    }

    const results = await Promise.allSettled(
      RSS_FEEDS.map(url => fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }))
    )

    const articles = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status !== 'fulfilled' || !result.value.ok) continue
      const xml        = await result.value.text()
      const sourceName = RSS_FEEDS[i].includes('lequipe')     ? "L'Équipe"
                       : RSS_FEEDS[i].includes('rmc')         ? 'RMC Sport'
                       : RSS_FEEDS[i].includes('footmercato') ? 'Foot Mercato'
                       : 'Eurosport'
      articles.push(...parseRSS(xml, sourceName))
    }

    if (redis && articles.length > 0) {
      try { await redis.set(NEWS_CACHE_KEY, JSON.stringify(articles), { ex: NEWS_CACHE_TTL }) } catch {}
    }

    res.status(200).json({ articles })
  } catch (err) {
    console.error('[news]', err)
    res.status(500).json({ error: err.message })
  }
}
