import { useQuery } from '@tanstack/react-query'

// Wikimedia Commons Search API — public, no key, CORS ok
// Cherche des vraies photos de match pour chaque équipe
async function searchCommonsPhoto(queries) {
  // Mots à exclure du nom de fichier (drapeaux, logos, écussons...)
  const EXCLUDE = ['flag','logo','badge','crest','kit','jersey','shirt','drapeau','coat',
                   'emblem','stamp','icon','symbol','map','uniform','portrait','headshot',
                   'blason','ecusson','insignia','patch','pennant']
  // Au moins un mot "match/tournoi" doit être dans le nom de fichier
  const REQUIRE = ['match','vs','2024','2025','2026','world','cup','wc','fifa',
                   'euro','copa','action','goal','celebr','player','game','group',
                   'final','semi','quarter','nation','tour','camp','squad']

  for (const q of queries) {
    const params = new URLSearchParams({
      action:       'query',
      generator:    'search',
      gsrsearch:    q,
      gsrnamespace: '6',       // File namespace uniquement
      gsrlimit:     '15',
      prop:         'imageinfo',
      iiprop:       'url|mediatype|width|height|mime',
      iiurlwidth:   '1200',    // thumbnail 1200px
      format:       'json',
      origin:       '*',
    })

    try {
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`)
      if (!res.ok) continue
      const data = await res.json()
      if (!data.query?.pages) continue

      const pages = Object.values(data.query.pages)

      const photos = pages.filter(p => {
        const info = p.imageinfo?.[0]
        if (!info) return false
        if (info.mediatype !== 'BITMAP') return false
        if ((info.width ?? 0) < 700) return false
        // Photos de match = format paysage (plus large que haut)
        if ((info.height ?? 0) > (info.width ?? 1)) return false
        const title = (p.title ?? '').toLowerCase().replace(/_/g, ' ')
        if (!title.endsWith('.jpg') && !title.endsWith('.jpeg')) return false
        if (EXCLUDE.some(word => title.includes(word))) return false
        // Exiger qu'au moins un mot de contexte "match" soit dans le nom de fichier
        if (!REQUIRE.some(word => title.includes(word))) return false
        return true
      })

      if (!photos.length) continue

      // Trier par largeur décroissante → plus grande photo en premier
      photos.sort((a, b) => (b.imageinfo[0].width ?? 0) - (a.imageinfo[0].width ?? 0))

      const info = photos[0].imageinfo[0]
      const url = info.thumburl ?? info.url
      if (url) return url
    } catch {
      continue
    }
  }
  return null
}

// Requêtes par ordre de précision — du plus spécifique au plus générique
function getQueries(teamName) {
  return [
    // WC 2026 spécifique — le plus précis
    `${teamName} 2026 FIFA World Cup match players action`,
    // Match action récent
    `${teamName} national football team 2025 2026 match players`,
    // Tournoi / compétition internationale
    `${teamName} football match 2024 2025 players action celebration`,
    // Large fallback — toujours match-contextualisé
    `${teamName} football players match action goal squad`,
  ]
}

const CACHE_TTL     = 7 * 24 * 3600 * 1000
const CACHE_VERSION = 'v7-action'

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
    queryKey: ['teamPhoto-v7', teamName],
    queryFn: async () => {
      if (!teamName) return null

      const cached = getCached(teamName)
      if (cached) return cached

      const queries = getQueries(teamName)
      const url = await searchCommonsPhoto(queries)

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
