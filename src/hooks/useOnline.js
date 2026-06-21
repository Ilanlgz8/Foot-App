import { useState, useEffect } from 'react'

/**
 * Retourne true si le navigateur est connecté, false sinon.
 * Se met à jour en temps réel via les events 'online' / 'offline'.
 */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online',  on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return online
}
