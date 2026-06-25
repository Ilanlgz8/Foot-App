import { useQuery } from '@tanstack/react-query'

// Map nom football-data.org → article Wikipedia de la star nationale
// Les pages joueurs Wikipedia ont des photos d'action en match
const WIKI = {
  // ── Europe ──
  'France':          'Kylian_Mbappé',
  'Germany':         'Florian_Wirtz',
  'Spain':           'Lamine_Yamal',
  'England':         'Jude_Bellingham',
  'Portugal':        'Cristiano_Ronaldo',
  'Netherlands':     'Virgil_van_Dijk',
  'Belgium':         'Romelu_Lukaku',
  'Croatia':         'Luka_Modrić',
  'Switzerland':     'Granit_Xhaka',
  'Poland':          'Robert_Lewandowski',
  'Denmark':         'Christian_Eriksen',
  'Sweden':          'Alexander_Isak',
  'Norway':          'Erling_Haaland',
  'Austria':         'Marcel_Sabitzer',
  'Hungary':         'Dominik_Szoboszlai',
  'Turkey':          'Hakan_Çalhanoğlu',
  'Ukraine':         'Mykhailo_Mudryk',
  'Serbia':          'Dušan_Vlahović',
  'Romania':         'Ianis_Hagi',
  'Scotland':        'Andy_Robertson',
  'Wales':           'Gareth_Bale',
  'Slovakia':        'Marek_Hamšík',
  'Slovenia':        'Jan_Oblak',
  'Albania':         'Armando_Broja',
  'Czech Republic':  'Tomáš_Souček',
  'Czechia':         'Tomáš_Souček',
  'Italy':           'Federico_Chiesa',
  'Greece':          'Kostas_Tsimikas',
  'Finland':         'Teemu_Pukki',
  'Israel':          'Eran_Zahavi',
  'Georgia':         'Khvicha_Kvaratskhelia',
  'Bosnia-H.':       'Edin_Džeko',

  // ── Amérique du Sud ──
  'Brazil':          'Vinícius_Júnior',
  'Argentina':       'Lionel_Messi',
  'Colombia':        'James_Rodríguez',
  'Uruguay':         'Federico_Valverde',
  'Ecuador':         'Enner_Valencia',
  'Chile':           'Alexis_Sánchez',
  'Paraguay':        'Miguel_Almirón',
  'Venezuela':       'Yeferson_Soteldo',
  'Peru':            'Paolo_Guerrero',
  'Bolivia':         'Marcelo_Martins',

  // ── Amérique du Nord / Centrale ──
  'Mexico':          'Hirving_Lozano',
  'United States':   'Christian_Pulisic',
  'Canada':          'Alphonso_Davies',
  'Costa Rica':      'Keylor_Navas',
  'Panama':          'Rolando_Blackburn',
  'Honduras':        'Alberth_Elis',
  'Jamaica':         'Michail_Antonio',
  'Haiti':           'Naïco_Évans',
  'Curaçao':         'Leandro_Bacuna',

  // ── Afrique ──
  'Morocco':         'Achraf_Hakimi',
  'Senegal':         'Sadio_Mané',
  'Ivory Coast':     'Sébastien_Haller',
  'Nigeria':         'Victor_Osimhen',
  'Ghana':           'Mohammed_Kudus',
  'Cameroon':        'Vincent_Aboubakar',
  'Egypt':           'Mohamed_Salah',
  'Algeria':         'Riyad_Mahrez',
  'Tunisia':         'Wahbi_Khazri',
  'South Africa':    'Percy_Tau',
  'Cape Verde':      'Gelson_Martins',
  'Congo DR':        'Yannick_Carrasco',
  'Mali':            'Yves_Bissouma',
  'Burkina Faso':    'Bertrand_Traoré',
  'Guinea':          'Naby_Keïta',
  'Zambia':          'Patson_Daka',
  'Zimbabwe':        'Knowledge_Musona',
  'Tanzania':        'Mbwana_Samatta',
  'Uganda':          'Emmanuel_Okwi',
  'Mozambique':      'Reinildo',

  // ── Asie ──
  'Japan':           'Takumi_Minamino',
  'South Korea':     'Heung-min_Son',
  'Korea Republic':  'Heung-min_Son',
  'Australia':       'Mat_Ryan',
  'Saudi Arabia':    'Salem_Al-Dawsari',
  'Iran':            'Mehdi_Taremi',
  'Qatar':           'Akram_Afif',
  'Iraq':            'Amjad_Attwan',
  'Jordan':          'Baha_Faisal',
  'Uzbekistan':      'Eldor_Shomurodov',
  'New Zealand':     'Chris_Wood_(footballer)',

  // ── Fallback générique ──
  '__default__':     'FIFA_World_Cup',
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
        const raw = localStorage.getItem(`wiki_photo_${teamName}`)
        return raw ? JSON.parse(raw).ts : 0
      } catch { return 0 }
    },
  })
}
