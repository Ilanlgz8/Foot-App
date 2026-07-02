/**
 * useFavoriteTeams.js
 *
 * Championnats suivis par l'utilisateur (pour filtrer les notifs push).
 * Stocké en localStorage — pas besoin de backend pour la préférence elle-même,
 * seule la LISTE est envoyée au serveur via /api/subscribe (champ `comps`).
 * Valeur stockée = slug ESPN (voir COMPETITION_ESPN_SLUG dans competitions.js),
 * directement comparable au `slug` que cron-goals.js utilise déjà en interne.
 */
import { useState, useCallback, useEffect } from 'react'

const LS_KEY = 'fav_comps'

export function getFavoriteTeams() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function setFavoriteComps(comps) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(comps)) } catch {}
}

export function useFavoriteTeams() {
  const [favorites, setFavorites] = useState(getFavoriteTeams)

  // Re-sync si modifié depuis un autre onglet
  useEffect(() => {
    const onStorage = (e) => { if (e.key === LS_KEY) setFavorites(getFavoriteTeams()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback((slug) => {
    setFavorites(prev => {
      const next = prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
      setFavoriteComps(next)
      return next
    })
  }, [])

  const isFavorite = useCallback((slug) => favorites.includes(slug), [favorites])

  return { favorites, toggle, isFavorite }
}
