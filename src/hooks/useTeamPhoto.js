import { useQuery } from '@tanstack/react-query'

// Map nom football-data.org → article Wikipedia
const WIKI = {
  'France':          'France_national_football_team',
  'Brazil':          'Brazil_national_football_team',
  'Germany':         'Germany_national_football_team',
  'Argentina':       'Argentina_national_football_team',
  'Spain':           'Spain_national_football_team',
  'England':         'England_national_football_team',
  'Portugal':        'Portugal_national_football_team',
  'Netherlands':     'Netherlands_national_football_team',
  'Mexico':          'Mexico_national_football_team',
  'United States':   "United_States_men%27s_national_soccer_team",
  'Morocco':         'Morocco_national_football_team',
  'Japan':           'Japan_national_football_team',
  'South Korea':     'South_Korea_national_football_team',
  'Australia':       'Australia_national_soccer_team',
  'Belgium':         'Belgium_national_football_team',
  'Croatia':         'Croatia_national_football_team',
  'Uruguay':         'Uruguay_national_football_team',
  'Switzerland':     'Switzerland_national_football_team',
  'Poland':          'Poland_national_football_team',
  'Canada':          "Canada_men%27s_national_soccer_team",
  'Ecuador':         'Ecuador_national_football_team',
  'Senegal':         'Senegal_national_football_team',
  'Colombia':        'Colombia_national_football_team',
  'Chile':           'Chile_national_football_team',
  'Peru':            'Peru_national_football_team',
  'Venezuela':       'Venezuela_national_football_team',
  'Paraguay':        'Paraguay_national_football_team',
  'Bolivia':         'Bolivia_national_football_team',
  'Costa Rica':      'Costa_Rica_national_football_team',
  'Honduras':        'Honduras_national_football_team',
  'Panama':          'Panama_national_football_team',
  'Jamaica':         'Jamaica_national_football_team',
  'Tunisia':         'Tunisia_national_football_team',
  'Ivory Coast':     'Ivory_Coast_national_football_team',
  'Nigeria':         'Nigeria_national_football_team',
  'Ghana':           'Ghana_national_football_team',
  'Cameroon':        'Cameroon_national_football_team',
  'South Africa':    'South_Africa_national_football_team',
  'Egypt':           'Egypt_national_football_team',
  'Algeria':         'Algeria_national_football_team',
  'Saudi Arabia':    'Saudi_Arabia_national_football_team',
  'Iran':            'Iran_national_football_team',
  'Qatar':           'Qatar_national_football_team',
  'Turkey':          'Turkey_national_football_team',
  'Czech Republic':  'Czech_Republic_national_football_team',
  'Ukraine':         'Ukraine_national_football_team',
  'Serbia':          'Serbia_national_football_team',
  'Austria':         'Austria_national_football_team',
  'Hungary':         'Hungary_national_football_team',
  'Romania':         'Romania_national_football_team',
  'Scotland':        'Scotland_national_football_team',
  'Wales':           'Wales_national_football_team',
  'Denmark':         'Denmark_national_football_team',
  'Sweden':          'Sweden_national_football_team',
  'Norway':          'Norway_national_football_team',
  'Slovakia':        'Slovakia_national_football_team',
  'Slovenia':        'Slovenia_national_football_team',
  'Albania':         'Albania_national_football_team',
  'New Zealand':     'New_Zealand_national_football_team',
}

const CACHE_TTL = 7 * 24 * 3600 * 1000  // 7 jours

function getCached(key) {
  try {
    const raw = localStorage.getItem(`wiki_photo_${key}`)
    if (!raw) return null
    const { url, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return url
  } catch { return null }
}

function setCached(key, url) {
  try {
    localStorage.setItem(`wiki_photo_${key}`, JSON.stringify({ url, ts: Date.now() }))
  } catch {}
}

export function useTeamPhoto(teamName) {
  const article = WIKI[teamName]

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
        const raw = localStorage.getItem(`wiki_photo_${teamName}`)
        return raw ? JSON.parse(raw).ts : 0
      } catch { return 0 }
    },
  })
}
