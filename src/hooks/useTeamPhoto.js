import { useQuery } from '@tanstack/react-query'

// Map nom football-data.org → article Wikipedia (photos 2024-2026 uniquement)
// WC 2026 en cours (juin 2026) → articles frais avec photos d'action actuelles
// Format Wikipedia standard : "[Country]_at_the_2026_FIFA_World_Cup"
const WIKI = {
  // ── WC 2026 — articles en cours (photos fraîches du tournoi) ──
  'France':          'France_at_the_2026_FIFA_World_Cup',
  'Brazil':          'Brazil_at_the_2026_FIFA_World_Cup',
  'Argentina':       'Argentina_at_the_2026_FIFA_World_Cup',
  'Spain':           'Spain_at_the_2026_FIFA_World_Cup',
  'England':         'England_at_the_2026_FIFA_World_Cup',
  'Germany':         'Germany_at_the_2026_FIFA_World_Cup',
  'Portugal':        'Portugal_at_the_2026_FIFA_World_Cup',
  'Netherlands':     'Netherlands_at_the_2026_FIFA_World_Cup',
  'Morocco':         'Morocco_at_the_2026_FIFA_World_Cup',
  'Senegal':         'Senegal_at_the_2026_FIFA_World_Cup',
  'Ivory Coast':     'Ivory_Coast_at_the_2026_FIFA_World_Cup',
  'Nigeria':         'Nigeria_at_the_2026_FIFA_World_Cup',
  'Ghana':           'Ghana_at_the_2026_FIFA_World_Cup',
  'Cameroon':        'Cameroon_at_the_2026_FIFA_World_Cup',
  'Egypt':           'Egypt_at_the_2026_FIFA_World_Cup',
  'Algeria':         'Algeria_at_the_2026_FIFA_World_Cup',
  'Tunisia':         'Tunisia_at_the_2026_FIFA_World_Cup',
  'South Africa':    'South_Africa_at_the_2026_FIFA_World_Cup',
  'Mexico':          'Mexico_at_the_2026_FIFA_World_Cup',
  'United States':   'United_States_at_the_2026_FIFA_World_Cup',
  'Canada':          'Canada_at_the_2026_FIFA_World_Cup',
  'Japan':           'Japan_at_the_2026_FIFA_World_Cup',
  'South Korea':     'South_Korea_at_the_2026_FIFA_World_Cup',
  'Korea Republic':  'South_Korea_at_the_2026_FIFA_World_Cup',
  'Australia':       'Australia_at_the_2026_FIFA_World_Cup',
  'Saudi Arabia':    'Saudi_Arabia_at_the_2026_FIFA_World_Cup',
  'Iran':            'Iran_at_the_2026_FIFA_World_Cup',
  'Colombia':        'Colombia_at_the_2026_FIFA_World_Cup',
  'Uruguay':         'Uruguay_at_the_2026_FIFA_World_Cup',
  'Ecuador':         'Ecuador_at_the_2026_FIFA_World_Cup',
  'Croatia':         'Croatia_at_the_2026_FIFA_World_Cup',
  'Belgium':         'Belgium_at_the_2026_FIFA_World_Cup',
  'Switzerland':     'Switzerland_at_the_2026_FIFA_World_Cup',
  'Poland':          'Poland_at_the_2026_FIFA_World_Cup',
  'Serbia':          'Serbia_at_the_2026_FIFA_World_Cup',
  'Turkey':          'Turkey_at_the_2026_FIFA_World_Cup',
  'Ukraine':         'Ukraine_at_the_2026_FIFA_World_Cup',
  'Romania':         'Romania_at_the_2026_FIFA_World_Cup',
  'Austria':         'Austria_at_the_2026_FIFA_World_Cup',
  'Hungary':         'Hungary_at_the_2026_FIFA_World_Cup',
  'Slovakia':        'Slovakia_at_the_2026_FIFA_World_Cup',
  'Slovenia':        'Slovenia_at_the_2026_FIFA_World_Cup',
  'Albania':         'Albania_at_the_2026_FIFA_World_Cup',
  'Georgia':         'Georgia_at_the_2026_FIFA_World_Cup',
  'Costa Rica':      'Costa_Rica_at_the_2026_FIFA_World_Cup',
  'Panama':          'Panama_at_the_2026_FIFA_World_Cup',
  'Jamaica':         'Jamaica_at_the_2026_FIFA_World_Cup',
  'Honduras':        'Honduras_at_the_2026_FIFA_World_Cup',
  'Venezuela':       'Venezuela_at_the_2026_FIFA_World_Cup',
  'Paraguay':        'Paraguay_at_the_2026_FIFA_World_Cup',
  'Bolivia':         'Bolivia_at_the_2026_FIFA_World_Cup',
  'Chile':           'Chile_at_the_2026_FIFA_World_Cup',
  'New Zealand':     'New_Zealand_at_the_2026_FIFA_World_Cup',
  'Qatar':           'Qatar_at_the_2026_FIFA_World_Cup',
  'Iraq':            'Iraq_at_the_2026_FIFA_World_Cup',
  'Uzbekistan':      'Uzbekistan_at_the_2026_FIFA_World_Cup',

  // ── Non qualifiés WC2026 → tournois 2024 ──
  'Italy':           'UEFA_Euro_2024',
  'Denmark':         'UEFA_Euro_2024',
  'Scotland':        'UEFA_Euro_2024',
  'Wales':           'UEFA_Euro_2024',
  'Czech Republic':  'UEFA_Euro_2024',
  'Czechia':         'UEFA_Euro_2024',
  'Norway':          'UEFA_Euro_2024',
  'Sweden':          'UEFA_Euro_2024',
  'Finland':         'UEFA_Euro_2024',
  'Israel':          'UEFA_Euro_2024',
  'Bosnia-H.':       'UEFA_Euro_2024',
  'Cape Verde':      '2023_Africa_Cup_of_Nations',
  'Congo DR':        '2023_Africa_Cup_of_Nations',
  'Mali':            '2023_Africa_Cup_of_Nations',
  'Burkina Faso':    '2023_Africa_Cup_of_Nations',
  'Guinea':          '2023_Africa_Cup_of_Nations',
  'Peru':            'Copa_América_2024',
  'Haiti':           'Copa_América_2024',
  'Curaçao':         'Copa_América_2024',
  'Jordan':          '2023_AFC_Asian_Cup',
  'Saudi Arabia':    '2023_AFC_Asian_Cup',

  // ── Fallback universel ──
  '__default__':     '2026_FIFA_World_Cup',
}

const CACHE_VERSION = 'v4'  // v4 = photos WC2026

const CACHE_TTL = 7 * 24 * 3600 * 1000  // 7 jours

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
  // Fallback générique si l'équipe n'est pas dans la map
  const article = WIKI[teamName] ?? WIKI['__default__']

  return useQuery({
    queryKey: ['teamPhoto', teamName],
    queryFn: async () => {
      if (!article) return null
      // Cache localStorage (7 jours)
      const cached = getCached(teamName)
      if (cached) return cached

      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${article}`
      )
      if (!res.ok) return null
      const data = await res.json()
      // Préfère l'image originale, sinon le thumbnail
      const url = data.originalimage?.source ?? data.thumbnail?.source ?? null
      if (url) setCached(teamName, url)
      return url
    },
    enabled:   !!article,
    staleTime: CACHE_TTL,
    retry:     1,
    // Initialiser depuis le cache localStorage directement
    initialData:          () => getCached(teamName) ?? undefined,
    initialDataUpdatedAt: () => {
      try {
        const raw = localStorage.getItem(`wiki_photo_${CACHE_VERSION}_${teamName}`)
        return raw ? JSON.parse(raw).ts : 0
      } catch { return 0 }
    },
  })
}
