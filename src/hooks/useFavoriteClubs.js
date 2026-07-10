/**
 * useFavoriteClubs.js
 *
 * Équipes favorites de l'utilisateur (pinning/mise en avant dans l'UI :
 * Classement, Accueil, Programme, Résultats). Distinct de useFavoriteTeams.js
 * (`fav_comps`) qui, malgré son nom, ne filtre que des COMPÉTITIONS pour les
 * notifs push — ce hook-ci stocke de vraies équipes (id + infos d'affichage),
 * jamais confondu avec l'autre pour éviter la même confusion sur le nom.
 * Purement client (localStorage) — pas de backend, cette préférence ne sert
 * qu'à l'affichage.
 */
import { useState, useCallback, useEffect } from 'react'

const LS_KEY  = 'fav_clubs'
const MAX_FAV = 10 // au-delà, la mise en avant perd son sens ("favori" = quelques équipes précises)

export function getFavoriteClubs() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function persist(clubs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(clubs)) } catch {}
}

export function useFavoriteClubs() {
  const [favorites, setFavorites] = useState(getFavoriteClubs)

  // Re-sync si modifié depuis un autre onglet
  useEffect(() => {
    const onStorage = (e) => { if (e.key === LS_KEY) setFavorites(getFavoriteClubs()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** team = { id, name, shortName, crest, compCode } */
  const toggle = useCallback((team) => {
    if (!team?.id) return
    setFavorites(prev => {
      const exists = prev.some(t => t.id === team.id)
      let next
      if (exists) {
        next = prev.filter(t => t.id !== team.id)
      } else {
        if (prev.length >= MAX_FAV) return prev // cap silencieux — pas d'erreur, juste ignoré
        next = [...prev, {
          id:        team.id,
          name:      team.name ?? team.shortName ?? '',
          shortName: team.shortName ?? team.name ?? '',
          crest:     team.crest ?? null,
          compCode:  team.compCode ?? null,
        }]
      }
      persist(next)
      return next
    })
  }, [])

  const isFavorite = useCallback((id) => favorites.some(t => t.id === id), [favorites])

  return { favorites, toggle, isFavorite, atLimit: favorites.length >= MAX_FAV }
}
