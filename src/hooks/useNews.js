import { useQuery } from '@tanstack/react-query'

// Mots-clés spécifiques au football (pas au sport en général)
const FOOTBALL_KEYWORDS = [
  'football', 'foot', 'ligue 1', 'ligue 2', 'premier league', 'bundesliga',
  'serie a', 'liga', 'champions league', 'europa league', 'conference league',
  'transfert', 'mercato', 'buteur', 'penalty', 'carton', 'gardien', 'attaquant',
  'milieu de terrain', 'défenseur', 'entraîneur', 'coach', 'fifa', 'uefa',
  'ballon d\'or', 'coupe du monde', 'euro 2024', 'euro 2026', 'world cup',
  'psg', 'real madrid', 'barcelona', 'manchester', 'liverpool', 'chelsea',
  'arsenal', 'juventus', 'milan', 'inter', 'bayern', 'dortmund', 'marseille',
  'lyon', 'monaco', 'mbappé', 'messi', 'ronaldo', 'neymar', 'haaland'
]

// Mots qui indiquent clairement un autre sport → rejeter l'article
const EXCLUDE_KEYWORDS = [
  'volleyball', 'volley', 'basketball', 'basket', 'tennis', 'rugby', 'handball',
  'natation', 'athlétisme', 'cyclisme', 'tour de france', 'formule 1', 'f1',
  'moto gp', 'boxe', 'judo', 'escrime', 'golf', 'ski', 'hockey', 'baseball'
]

// Indicateurs d'articles "profil joueur" / biographies evergreen → toujours filtrer
const EXCLUDE_PROFILE = [
  'biographie', 'biographic', 'tout savoir sur', 'qui est vraiment', 'portrait de',
  'fiche joueur', 'vie privée', 'sa vie privée', 'salaire de', 'salaire du',
  'fortune de', 'fortune du', 'palmarès complet', 'meilleur joueur de tous les temps',
  'le meilleur de tous les temps', 'goat', 'top 10 joueurs', 'top 5 joueurs',
  'les meilleurs joueurs', 'histoire de sa carrière', 'retour sur la carrière',
  'tout sur ', 'que sait-on de', 'ce qu\'il faut savoir sur',
]

// Mots vides français à ignorer pour la comparaison de similarité
const STOPWORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'en', 'au', 'aux',
  'est', 'son', 'sur', 'par', 'pour', 'dans', 'avec', 'qui', 'que', 'se', 'sa',
  'ce', 'il', 'elle', 'ils', 'pas', 'plus', 'mais', 'ou', 'si', 'car', 'donc',
  'après', 'avant', 'lors', 'tout', 'bien', 'comme', 'très', 'cette', 'its', 'the'
])

// Extraire les mots importants d'un titre (> 3 lettres, pas stopword)
function keywords(title = '') {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlever accents
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w))
  )
}

// Deux articles sont "similaires" s'ils partagent au moins 2 mots importants
function areSimilar(a, b) {
  const ka = keywords(a.title)
  const kb = keywords(b.title)
  let shared = 0
  for (const w of ka) {
    if (kb.has(w)) shared++
    if (shared >= 3) return true
  }
  return false
}

export function useNews() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['news'],
    queryFn: async () => {
      const res = await fetch('/news', { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`Erreur RSS : ${res.status}`)
      const json = await res.json()
      const articles = json.articles ?? []

      // Étape 1 : filtrer par mots-clés foot + exclure les autres sports + exclure bios/profils
      const footballOnly = articles.filter(a => {
        const text = `${a.title ?? ''} ${a.description ?? ''}`.toLowerCase()
        const isFootball = FOOTBALL_KEYWORDS.some(kw => text.includes(kw))
        const isOtherSport = EXCLUDE_KEYWORDS.some(kw => text.includes(kw))
        const isProfile = EXCLUDE_PROFILE.some(kw => text.includes(kw))
        // Rejeter les "articles" dont le titre est juste un nom de joueur/équipe (< 4 mots)
        const titleWords = (a.title ?? '').trim().split(/\s+/).filter(Boolean)
        const isTooShort = titleWords.length < 4
        return isFootball && !isOtherSport && !isProfile && !isTooShort
      })

      // Étape 2 : déduplication par similarité de mots-clés
      // On garde le premier article de chaque "groupe" (le plus récent après tri)
      // Ex: "RC Lens perd son coach" et "Départ de l'entraîneur de Lens" → même groupe (partagent "lens" + "entraineur")
      const sorted = [...footballOnly].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      const unique = []
      for (const article of sorted) {
        const isDuplicate = unique.some(kept => areSimilar(kept, article))
        if (!isDuplicate) unique.push(article)
      }

      return unique
        .map(a => ({
          url: a.url,
          title: a.title,
          description: a.description,
          image: a.image,
          publishedAt: a.publishedAt,
          source: a.source?.name
        }))
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
        .slice(0, 12)
    },
    staleTime: 1000 * 60 * 30, // 30min (RSS gratuit, pas de quota)
    retry: false,
    refetchOnWindowFocus: false
  })

  return {
    news: data ?? [],
    loading: isLoading,
    error: error?.message ?? null,
    refetch,
  }
}
