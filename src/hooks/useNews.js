import { useQuery } from '@tanstack/react-query'

const API_KEY = import.meta.env.VITE_GNEWS_API_KEY

export function useNews() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['news'],
    queryFn: async () => {
      const res = await fetch(
        `https://gnews.io/api/v4/search?q=football OR ligue+1 OR mercato OR transfert&lang=fr&max=10&token=${API_KEY}`
      )

      if (!res.ok) throw new Error(`Erreur API: ${res.status}`)

      const json = await res.json()

      return (json.articles ?? []).map(a => ({
        title: a.title,
        description: a.description,
        url: a.url,
        image: a.image,
        publishedAt: a.publishedAt,
        source: a.source?.name
      }))
    },
    staleTime: 1000 * 60 * 30,
    retry: false
  })

  return {
    news: data ?? [],
    loading: isLoading,
    error: error?.message ?? null
  }
}