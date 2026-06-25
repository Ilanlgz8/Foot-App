import { useQuery } from '@tanstack/react-query'

// Map nom football-data.org → article Wikipedia
// On cible des articles de TOURNOIS / MATCHS qui ont des photos d'action
// multi-joueurs (célébrations, duels en match) — pas des portraits individuels.
const WIKI = {
  // ── Europe ──
  'France':          '2022_FIFA_World_Cup_Final',        // célébration finale WC22
  'Argentina':       '2022_FIFA_World_Cup',              // Messi + équipe trophée
  'Spain':           'UEFA_Euro_2024_Final',              // Espagne célébrant
  'England':         'UEFA_Euro_2024_Final',              // Angleterre en finale
  'Germany':         'UEFA_Euro_2024',                    // Allemagne tournoi domicile
  'Portugal':        'UEFA_Euro_2016',                    // Portugal champion
  'Netherlands':     'UEFA_Euro_2024',                    // Pays-Bas demi-finales
  'Belgium':         '2018_FIFA_World_Cup',               // Belgique 3e place WC18
  'Croatia':         '2022_FIFA_World_Cup_third_place_play-off', // Croatie 3e WC22
  'Italy':           'UEFA_Euro_2020',                    // Italie champion Euro
  'Switzerland':     'UEFA_Euro_2024',                    // Suisse quarts
  'Poland':          'UEFA_Euro_2024',
  'Denmark':         'UEFA_Euro_2020',
  'Sweden':          'UEFA_Euro_2020',
  'Norway':          'Erling_Haaland',                    // pas de tournoi récent, star
  'Austria':         'UEFA_Euro_2024',
  'Hungary':         'UEFA_Euro_2024',
  'Turkey':          'UEFA_Euro_2024',                    // Turquie quarts
  'Ukraine':         'UEFA_Euro_2020',
  'Serbia':          'UEFA_Euro_2024',
  'Romania':         'UEFA_Euro_2024',
  'Scotland':        'UEFA_Euro_2024',
  'Wales':           'UEFA_Euro_2020',
  'Slovakia':        'UEFA_Euro_2024',
  'Slovenia':        'UEFA_Euro_2024',
  'Albania':         'UEFA_Euro_2024',
  'Czech Republic':  'UEFA_Euro_2020',
  'Czechia':         'UEFA_Euro_2020',
  'Georgia':         'UEFA_Euro_2024',                    // première qualification historique
  'Bosnia-H.':       'Bosnia_and_Herzegovina_national_football_team',
  'Greece':          'UEFA_Euro_2004',                    // champion surprise
  'Finland':         'UEFA_Euro_2020',
  'Israel':          'Israel_national_football_team',

  // ── Amérique du Sud ──
  'Brazil':          'Brazil_at_the_2022_FIFA_World_Cup',
  'Colombia':        'Copa_América_2024',                 // Colombia en Copa
  'Uruguay':         'Copa_América_2024',
  'Ecuador':         '2022_FIFA_World_Cup',
  'Chile':           'Copa_América_2015',                 // Chile champion
  'Paraguay':        'Copa_América',
  'Venezuela':       'Copa_América_2024',
  'Peru':            'Copa_América_2019',
  'Bolivia':         'Copa_América',

  // ── Amérique du Nord / Centrale / Caraïbes ──
  'Mexico':          'Mexico_national_football_team',
  'United States':   'United_States_at_the_2022_FIFA_World_Cup',
  'Canada':          'Canada_at_the_2022_FIFA_World_Cup',
  'Costa Rica':      'Costa_Rica_at_the_2022_FIFA_World_Cup',
  'Panama':          'Panama_national_football_team',
  'Honduras':        'Honduras_national_football_team',
  'Jamaica':         'Jamaica_national_football_team',
  'Haiti':           'Haiti_national_football_team',
  'Curaçao':         'Curaçao_national_football_team',

  // ── Afrique ──
  'Morocco':         'Morocco_at_the_2022_FIFA_World_Cup', // célébrations épiques
  'Senegal':         '2021_Africa_Cup_of_Nations_Final',   // 1er trophée Sénégal
  'Ivory Coast':     '2023_Africa_Cup_of_Nations_Final',   // CAN 2023 vainqueur
  'Nigeria':         'Nigeria_at_the_FIFA_World_Cup',
  'Ghana':           'Ghana_at_the_FIFA_World_Cup',
  'Cameroon':        'Cameroon_at_the_FIFA_World_Cup',
  'Egypt':           'Africa_Cup_of_Nations',
  'Algeria':         '2019_Africa_Cup_of_Nations_Final',   // Algérie champion CAN 2019
  'Tunisia':         'Tunisia_at_the_FIFA_World_Cup',
  'South Africa':    '2010_FIFA_World_Cup',                 // Afrique du Sud hôte WC10
  'Cape Verde':      'Cape_Verde_national_football_team',
  'Congo DR':        'DR_Congo_national_football_team',
  'Mali':            'Mali_national_football_team',
  'Burkina Faso':    'Burkina_Faso_national_football_team',
  'Guinea':          'Guinea_national_football_team',
  'Zambia':          'Zambia_national_football_team',
  'Zimbabwe':        'Zimbabwe_national_football_team',
  'Tanzania':        'Tanzania_national_football_team',
  'Uganda':          'Uganda_national_football_team',
  'Mozambique':      'Mozambique_national_football_team',

  // ── Asie ──
  'Japan':           'Japan_at_the_2022_FIFA_World_Cup',   // victoire Allemagne
  'South Korea':     'South_Korea_at_the_2022_FIFA_World_Cup',
  'Korea Republic':  'South_Korea_at_the_2022_FIFA_World_Cup',
  'Australia':       'Australia_at_the_2022_FIFA_World_Cup',
  'Saudi Arabia':    'Saudi_Arabia_at_the_2022_FIFA_World_Cup', // victoire Argentine !
  'Iran':            'Iran_at_the_FIFA_World_Cup',
  'Qatar':           '2022_FIFA_World_Cup',
  'Iraq':            'Iraq_national_football_team',
  'Jordan':          'Jordan_national_football_team',
  'Uzbekistan':      'Uzbekistan_national_football_team',
  'New Zealand':     'New_Zealand_national_football_team',

  // ── Fallback universel ──
  '__default__':     '2022_FIFA_World_Cup',
}

const CACHE_TTL = 7 * 24 * 3600 * 1000  // 7 jours
const CACHE_VERSION = 'v3'               // incrémenter pour invalider l'ancien cache

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
