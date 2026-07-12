// ⚠️ PAGE TEMPORAIRE DE DIAGNOSTIC — à supprimer une fois le bug "timeline
// vide" résolu. Reproduit EXACTEMENT la même logique que useEspnMatchDetail
// (scoreboard puis summary), mais affiche chaque étape en clair au lieu de
// rester silencieuse en cas d'échec — permet de voir où ça casse sans
// bidouiller des URLs à la main dans Safari.
import { useState } from 'react'
import { COMP_ESPN, fuzzyTeam } from '../hooks/useLiveMinute'

function todayStr(offset = 0) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

export default function DebugEspn() {
  const [team1, setTeam1] = useState('Argentina')
  const [team2, setTeam2] = useState('Switzerland')
  const [dateOffset, setDateOffset] = useState(-1) // -1 = hier, 0 = aujourd'hui
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)

  const push = (line) => setLog(prev => [...prev, line])

  async function run() {
    setLog([])
    setRunning(true)
    const slug = COMP_ESPN[2000] // fifa.world
    const date = todayStr(dateOffset)
    push(`📅 Date interrogée : ${date} (slug=${slug})`)

    try {
      const url = `/espn?slug=${slug}&dates=${date}`
      push(`🌐 Fetch : ${url}`)
      const res = await fetch(url)
      push(`↩️ Statut HTTP : ${res.status} ${res.ok ? '✅' : '❌'}`)

      const json = await res.json()
      const events = json.events ?? []
      push(`📦 Nombre total de matchs renvoyés par ESPN ce jour-là : ${events.length}`)

      if (events.length === 0) {
        push(`⚠️ ESPN ne renvoie AUCUN match pour cette date. Essaie l'autre décalage (aujourd'hui/hier).`)
      }

      // Liste tous les matchs trouvés, pour voir les noms EXACTS qu'ESPN utilise
      push(`\n── Tous les matchs vus par ESPN ce jour-là ──`)
      events.forEach(evt => {
        const comp = evt.competitions?.[0]
        const home = (comp?.competitors ?? []).find(c => c.homeAway === 'home')
        const away = (comp?.competitors ?? []).find(c => c.homeAway === 'away')
        const hName = home?.team?.displayName ?? home?.team?.name ?? '?'
        const aName = away?.team?.displayName ?? away?.team?.name ?? '?'
        push(`  • ${hName}  vs  ${aName}   (id ESPN: ${evt.id})`)
      })

      // Test du matching flou avec les 2 équipes demandées
      push(`\n── Recherche de "${team1}" vs "${team2}" ──`)
      let found = null
      for (const evt of events) {
        const comp = evt.competitions?.[0]
        const home = (comp?.competitors ?? []).find(c => c.homeAway === 'home')
        const away = (comp?.competitors ?? []).find(c => c.homeAway === 'away')
        if (!home || !away) continue
        const hName = home.team?.displayName ?? home.team?.name ?? ''
        const aName = away.team?.displayName ?? away.team?.name ?? ''
        const match1 = fuzzyTeam(team1, hName) && fuzzyTeam(team2, aName)
        const match2 = fuzzyTeam(team2, hName) && fuzzyTeam(team1, aName)
        if (match1 || match2) {
          found = { eventId: evt.id, hName, aName }
          push(`  ✅ TROUVÉ : ${hName} vs ${aName} (id ${evt.id})`)
        }
      }
      if (!found) {
        push(`  ❌ AUCUN match ne correspond à "${team1}" vs "${team2}" avec le matching flou actuel.`)
        push(`  → Regarde la liste ci-dessus : est-ce que le match y figure sous un nom différent ?`)
        setRunning(false)
        return
      }

      // Passe 2 : summary
      push(`\n── Récupération du résumé complet (buts/cartons) ──`)
      const url2 = `/espn?slug=${slug}&eventId=${found.eventId}`
      push(`🌐 Fetch : ${url2}`)
      const res2 = await fetch(url2)
      push(`↩️ Statut HTTP : ${res2.status} ${res2.ok ? '✅' : '❌'}`)
      const summary = await res2.json()

      const plays = summary.plays ?? []
      const goalPlays = plays.filter(p => p.type?.id === '57' || p.scoringPlay === true)
      push(`⚽ Buts trouvés dans json.plays : ${goalPlays.length}`)

      const comp = summary.header?.competitions?.[0] ?? summary.competitions?.[0]
      const details = comp?.details ?? []
      const goalDetails = details.filter(d => d.type?.text === 'Goal' || d.type?.id === '57')
      const cardDetails = details.filter(d => String(d.type?.id ?? '') === '93' || String(d.type?.id ?? '') === '94')
      push(`⚽ Buts trouvés dans comp.details (fallback) : ${goalDetails.length}`)
      push(`🟨🟥 Cartons trouvés dans comp.details : ${cardDetails.length}`)

      if (goalPlays.length === 0 && goalDetails.length === 0) {
        push(`\n⚠️ ESPN a bien l'event, mais AUCUN but n'est présent dans les données — soit le résumé n'est pas encore publié côté ESPN, soit sa structure a changé.`)

        // ── Dump brut pour comprendre CE QUI existe réellement, sans supposer
        // la structure attendue par le code actuel (extractFromSummary). ──
        push(`\n\n══════ DUMP BRUT (pour diagnostic) ══════`)
        push(`\n📋 Clés de premier niveau du JSON summary :`)
        push(`  [${Object.keys(summary).join(', ')}]`)

        push(`\n📋 json.plays existe ? ${Array.isArray(summary.plays) ? `oui, ${summary.plays.length} entrées` : 'NON (absent ou pas un tableau)'}`)
        if (Array.isArray(summary.plays) && summary.plays.length > 0) {
          push(`  Exemple de la 1ère entrée de plays :`)
          push(`  ${JSON.stringify(summary.plays[0], null, 2).slice(0, 800)}`)
        }

        push(`\n📋 json.header existe ? ${summary.header ? 'oui' : 'NON'}`)
        push(`📋 json.header.competitions[0] existe ? ${comp ? 'oui' : 'NON'}`)
        if (comp) {
          push(`  Clés de comp : [${Object.keys(comp).join(', ')}]`)
          push(`  comp.details existe ? ${Array.isArray(comp.details) ? `oui, ${comp.details.length} entrées` : 'NON (absent ou pas un tableau)'}`)
          if (Array.isArray(comp.details) && comp.details.length > 0) {
            // Dump COMPLET, sans troncature, et pour TOUTES les entrées (pas
            // que la 1ère) — pour voir la forme des cartons en plus des buts.
            // Le JSON de chaque event peut être long (participants imbriqués
            // avec liens), donc on retire ces liens pour rester lisible.
            const clean = (obj) => JSON.parse(JSON.stringify(obj, (key, val) => key === 'links' ? undefined : val))
            comp.details.forEach((entry, i) => {
              push(`\n  ── Entrée #${i + 1}/${comp.details.length} ──`)
              push(`  ${JSON.stringify(clean(entry), null, 2)}`)
            })
          }
        }

        // Autres emplacements possibles où ESPN met parfois les événements
        // (varie selon les sports/compétitions) — juste pour vérifier leur présence.
        const altKeys = ['commentary', 'keyEvents', 'gamepackageJSON', 'boxscore', 'scoringSummary']
        push(`\n📋 Autres clés possibles présentes dans le JSON : ${altKeys.filter(k => k in summary).join(', ') || '(aucune)'}`)
        if (summary.boxscore) {
          push(`  Clés de summary.boxscore : [${Object.keys(summary.boxscore).join(', ')}]`)
        }

        // ── Recherche spécifique des cartons JAUNES (constat utilisateur :
        // buts + rouge OK, jaune absent) — comp.details semble ne garder que
        // les événements "majeurs". On regarde keyEvents et commentary. ──
        push(`\n\n══════ RECHERCHE CARTONS JAUNES ══════`)
        if (Array.isArray(summary.keyEvents)) {
          push(`\n📋 summary.keyEvents : ${summary.keyEvents.length} entrées`)
          if (summary.keyEvents.length > 0) {
            push(`  ${JSON.stringify(summary.keyEvents[0], null, 2)}`)
          }
        } else {
          push(`\n📋 summary.keyEvents : absent ou pas un tableau (valeur : ${JSON.stringify(summary.keyEvents)})`)
        }

        if (Array.isArray(summary.commentary)) {
          push(`\n📋 summary.commentary : ${summary.commentary.length} entrées`)
          const yellowMentions = summary.commentary.filter(c => {
            const txt = (c.text ?? c.commentary ?? JSON.stringify(c)).toLowerCase()
            return txt.includes('yellow') || txt.includes('booked') || txt.includes('caution')
          })
          push(`  Entrées mentionnant "yellow/booked/caution" : ${yellowMentions.length}`)
          if (yellowMentions.length > 0) {
            push(`  Exemple : ${JSON.stringify(yellowMentions[0], null, 2)}`)
          } else if (summary.commentary.length > 0) {
            push(`  Exemple d'une entrée commentary (pour voir sa forme) :`)
            push(`  ${JSON.stringify(summary.commentary[0], null, 2)}`)
          }
        } else {
          push(`\n📋 summary.commentary : absent ou pas un tableau`)
        }

        push(`\n✅ Les données existent bien chez ESPN pour ce match.`)
      }
    } catch (err) {
      push(`💥 Erreur : ${err.message}`)
    }
    setRunning(false)
  }

  return (
    <div style={{ padding: '16px', paddingTop: '80px', paddingBottom: '100px', fontFamily: 'monospace', fontSize: '13px', color: '#eee', background: '#0a0c14', minHeight: '100vh' }}>
      <h2 style={{ fontFamily: 'sans-serif', marginBottom: '12px' }}>🔧 Diagnostic ESPN (page temporaire)</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
        <input value={team1} onChange={e => setTeam1(e.target.value)} placeholder="Équipe 1"
          style={{ padding: '8px', borderRadius: '6px', border: '1px solid #333', background: '#141419', color: '#fff' }} />
        <input value={team2} onChange={e => setTeam2(e.target.value)} placeholder="Équipe 2"
          style={{ padding: '8px', borderRadius: '6px', border: '1px solid #333', background: '#141419', color: '#fff' }} />
        <select value={dateOffset} onChange={e => setDateOffset(Number(e.target.value))}
          style={{ padding: '8px', borderRadius: '6px', border: '1px solid #333', background: '#141419', color: '#fff' }}>
          <option value={0}>Aujourd'hui</option>
          <option value={-1}>Hier</option>
          <option value={-2}>Avant-hier</option>
        </select>
        <button onClick={run} disabled={running}
          style={{ padding: '10px', borderRadius: '6px', border: 'none', background: '#fb3b4e', color: '#fff', fontWeight: 'bold' }}>
          {running ? 'Recherche...' : 'Lancer le diagnostic'}
        </button>
      </div>

      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#000', padding: '12px', borderRadius: '8px', lineHeight: '1.6' }}>
        {log.join('\n') || 'Appuie sur "Lancer le diagnostic" ci-dessus.'}
      </pre>
    </div>
  )
}
