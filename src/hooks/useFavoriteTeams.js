/**
 * useFavoriteTeams.js
 *
 * Équipes suivies par l'utilisateur (pour filtrer les notifs push).
 * Stocké en localStorage — pas besoin de backend pour la préférence elle-même,
 * seule la LISTE est envoyée au serveur via /api/subscribe (champ `teams`).
 */
import { useState, useCallback, useEffect } from 'react'

const LS_KEY = 'fav_teams'

export function getFavoriteTeams() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function setFavoriteTeams(teams) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(teams)) } catch {}
}

export function useFavoriteTeams() {
  const [favorites, setFavorites] = useState(getFavoriteTeams)

  // Re-sync si modifié depuis un autre onglet
  useEffect(() => {
    const onStorage = (e) => { if (e.key === LS_KEY) setFavorites(getFavoriteTeams()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback((teamKey) => {
    setFavorites(prev => {
      const next = prev.includes(teamKey) ? prev.filter(k => k !== teamKey) : [...prev, teamKey]
      setFavoriteTeams(next)
      return next
    })
  }, [])

  const isFavorite = useCallback((teamKey) => favorites.includes(teamKey), [favorites])

  return { favorites, toggle, isFavorite }
}
