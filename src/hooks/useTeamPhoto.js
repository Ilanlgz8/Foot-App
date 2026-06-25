import { useQuery } from '@tanstack/react-query'

// Wikimedia Commons Search API — public, no key, CORS ok
// Cherche des vraies photos de match pour chaque équipe
async function searchCommonsPhoto(queries) {
  for (const q of queries) {
    const params = new URLSearchParams({
      action:       'query',
      generator:    'search',
      gsrsearch:    q,
      gsrnamespace: '6',       // File namespace uniquement
      gsrlimit:     '10',
      prop:         'imageinfo',
      iiprop:       'url|mediatype|width|height|mime',
      iiurlwidth:   '1200',    // thumbnail 1200px → bonne qualité sans télécharger l'original
      format:       'json',
      origin:       '*',
    })

    try {
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`)
      if (!res.ok) continue
      const data = await res.json()
      if (!data.query?.pages) continue

      const pages = Object.values(data.query.pages)

      // Filtres stricts : uniquement JPEG de match/action, largeur > 700px
      const EXCLUDE = ['flag','logo','badge','crest','kit','jersey','shirt','drapeau','coat','emblem','stamp','icon','symbol','map','uniform','portrait','headshot']
      const photos = pages.filter(p => {
        const info = p.imageinfo?.[0]
        if (!info) return false
        if (info.mediatype !== 'BITMAP') return false
        if ((info.width ?? 0) < 700) return false
        // Les photos de match sont presque toujours en format paysage
        if ((info.height ?? 0) > (info.width ?? 1)) return false
        const title = (p.title ?? '').toLowerCase()
        if (!title.endsWith('.jpg') && !title.endsWith('.jpeg')) return false
        if (EXCLUDE.some(word => title.includes(word))) return false
        return true
      })

      if (!photos.length) continue

      // Trier par largeur décroissante → photo la plus grande en premier
      photos.sort((a, b) => (b.imageinfo[0].width ?? 0) - (a.imageinfo[0].width ?? 0))

      const info = photos[0].imageinfo[0]
      // Préférer thumburl (redimensionné à 1200px) sinon url originale
      const url = info.thumburl ?? info.url
      if (url) return url
    } catch {
      continue
    }
  }
  return null
}

// Requêtes par ordre de précision — on exclut explicitement drapeaux/logos
function getQueries(teamName) {
  return [
    `${teamName} football 2026 FIFA World Cup players match -flag -logo -badge`,
    `${teamName} football 2026 match action players`,
    `${teamName} national football team 2024 match -flag -logo`,
    `${teamName} football players celebration match action`,
  ]
}

const CACHE_TTL     = 7 * 24 * 3600 * 1000
const CACHE_VERSION = 'v6-commons'

function getCached(key) {
  try {
    const raw = localStorage.getItem(`wiki_photo_${CACHE_VERSION}_${key}`)
    if (!raw) return null
    const { url, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return url
  } catch { return null }
}

function setCached(key, url) {
  try {
    localStorage.setItem(`wiki_photo_${CACHE_VERSION}_${key}`, JSON.stringify({ url, ts: Date.now() }))
  } catch {}
}

export function useTeamPhoto(teamName) {
  return useQuery({
    queryKey: ['teamPhoto-v6', teamName],
    queryFn: async () => {
      if (!teamName) return null

      // Cache localStorage 7 jours
      const cached = getCached(teamName)
      if (cached) return cached

      const queries = getQueries(teamName)
      const url = await searchCommonsPhoto(queries)

      // Toujours mettre en cache même si null (évite de re-fetcher inutilement)
      setCached(teamName, url ?? '')
      return url ?? null
    },
    enabled:   !!teamName,
    staleTime: CACHE_TTL,
    retry:     1,
    initialData:          () => {
      const c = getCached(teamName)
      return c === '' ? null : c ?? undefined
    },
    initialDataUpdatedAt: () => {
      try {
        const raw = localStorage.getItem(`wiki_photo_${CACHE_VERSION}_${teamName}`)
        return raw ? JSON.parse(raw).ts : 0
      } catch { return 0 }
    },
  })
}
