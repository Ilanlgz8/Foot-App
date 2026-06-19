// Agrège plusieurs flux RSS football français et les retourne en JSON
// Aucune clé API requise — flux publics

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

function parseRSS(xml, sourceName) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []
  return items.map(item => ({
    title:       extractTag(item, 'title'),
    url:         extractTag(item, 'link') || extractTag(item, 'guid'),
    description: extractTag(item, 'description').replace(/<[^>]+>/g, '').slice(0, 200),
    image:       extractImage(item),
    publishedAt: new Date(extractTag(item, 'pubDate')).toISOString(),
    source:      sourceName,
  })).filter(a => a.title && a.url)
}

module.exports = async (_req, res) => {
  try {
    const results = await Promise.allSettled(
      RSS_FEEDS.map(url => fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }))
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
    res.status(500).json({ error: err.message })
  }
}
