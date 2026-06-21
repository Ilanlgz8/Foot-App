// Agrège plusieurs flux RSS football français
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
  try {
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

    res.status(200).json({ articles })
  } catch (err) {
    console.error('[news]', err)
    res.status(500).json({ error: err.message })
  }
}
