/**
 * AiAssistant — page "Assistant IA" (switcher tout en haut de Pronos.jsx,
 * remplace l'ancien Simulateur).
 *
 * ⚠️ Historique (28/08) : le Simulateur (confrontation hypothétique 2
 * équipes, score exact simulé) donnait encore trop souvent des scores plats
 * (1-1) malgré 2 réécritures du modèle dans la même journée — constat
 * utilisateur persistant ("le simulateur aussi laisse tomber c pas assez
 * bien encore 1-1 a chaque fois"). Demande explicite : remplacer par une IA
 * qui répond aux questions des utilisateurs plutôt que de continuer à
 * bricoler un modèle statistique. Portée confirmée par l'utilisateur :
 * remplace complètement le Simulateur, foot uniquement (pas un chatbot
 * généraliste).
 *
 * Backend : api/apifootball.js, mode=ask (fichier déjà mort en pratique —
 * PERMANENTLY_DISABLED, voir son commentaire — slot Vercel réutilisé sans
 * toucher son comportement existant, 12/12 fonctions déjà atteint). Modèle
 * Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct), gratuit jusqu'à
 * 10 000 neurones/jour (~15-25 réponses) — pas de fallback payant, un
 * message d'erreur clair remplace la réponse une fois le quota du jour
 * atteint plutôt qu'un coût engagé sans validation explicite.
 *
 * ⚠️ Honnêteté (à afficher, pas juste en commentaire) : ce modèle n'a AUCUN
 * accès aux données live/temps réel de l'app (scores en cours, calendrier,
 * classements à jour...) — connaissance générale sur le foot uniquement.
 * Le system prompt côté serveur le lui interdit explicitement (ne jamais
 * inventer un score), et `AI_NOTE` ci-dessous le rappelle à l'utilisateur
 * directement dans l'UI pour éviter toute confusion avec les vraies données
 * live de l'app.
 */
import { useState, useRef, useEffect } from 'react'

const AI_NOTE = "Connaissances générales sur le foot (règles, historique, clubs, joueurs, tactique) — pas les scores ou données en direct de l'app, pour ça va sur Live/Résultats."

export function AiAssistant() {
  const [messages, setMessages] = useState([]) // [{role:'user'|'assistant', text, error}]
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const threadRef = useRef(null)

  // Auto-scroll vers le bas à chaque nouveau message — même principe qu'un
  // chat classique, l'utilisateur doit toujours voir la dernière réponse
  // sans avoir à scroller manuellement.
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages, loading])

  const send = async (e) => {
    e.preventDefault()
    const question = input.trim()
    if (!question || loading) return

    setMessages(prev => [...prev, { role: 'user', text: question }])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/apifootball', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'ask', question }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.answer) {
        setMessages(prev => [...prev, { role: 'assistant', text: json?.error ?? "L'assistant n'a pas pu répondre, réessaie.", error: true }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: json.answer }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Erreur réseau, réessaie.', error: true }])
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e) => {
    // Entrée envoie, Maj+Entrée fait un saut de ligne — convention standard
    // de chat, pas de bouton dédié nécessaire pour ça.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(e)
    }
  }

  return (
    <div className="aiAssistant">
      <p className="aiAssistant__intro">
        Pose une question sur le football — règles, historique, clubs, joueurs, tactique.
      </p>

      <div className="aiAssistant__thread" ref={threadRef}>
        {messages.length === 0 && (
          <p className="aiAssistant__emptyHint">Aucune question pour l'instant. Écris quelque chose en bas 👇</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`aiAssistant__bubbleRow aiAssistant__bubbleRow--${m.role}`}>
            <div className={`aiAssistant__bubble aiAssistant__bubble--${m.role}${m.error ? ' aiAssistant__bubble--error' : ''}`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="aiAssistant__bubbleRow aiAssistant__bubbleRow--assistant">
            <div className="aiAssistant__bubble aiAssistant__bubble--assistant aiAssistant__bubble--loading">
              L'assistant réfléchit…
            </div>
          </div>
        )}
      </div>

      <form className="aiAssistant__form" onSubmit={send}>
        <textarea
          className="aiAssistant__input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ta question sur le foot…"
          maxLength={300}
          rows={1}
          disabled={loading}
        />
        <button type="submit" className="aiAssistant__sendBtn" disabled={loading || !input.trim()} aria-label="Envoyer">
          ➤
        </button>
      </form>

      <p className="aiAssistant__note">{AI_NOTE}</p>
    </div>
  )
}
