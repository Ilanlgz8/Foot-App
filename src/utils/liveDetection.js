// ── Détection d'état live ESPN/FIFA — logique PARTAGÉE ────────────────────
// ⚠️ AJOUT (retour utilisateur : "que l'app soit robuste, stable") : ce
// fichier extrait des fonctions PURES (aucun fetch, aucun Redis, aucune
// dépendance Node/Workers) qui étaient dupliquées telles quelles entre
// api/cron-goals.js et cf-worker/src/index.js depuis la migration Cloudflare
// (voir CLAUDE.md, section Stack). Deux copies identiques = risque réel de
// divergence silencieuse si l'une est corrigée sans l'autre (ex: un futur
// bug ESPN découvert et corrigé dans un seul des deux fichiers). Une seule
// source ici, importée par les deux — et, avantage direct, ces fonctions
// deviennent testables (voir liveDetection.test.js), ce qui n'était pas
// possible tant qu'elles vivaient à l'intérieur d'un handler Vercel ou d'un
// Worker sans export.
//
// Pas de duplication vers api/cron-goals.js ni cf-worker/src/index.js : les
// deux importent directement ce module (chemins relatifs différents, mais
// même fichier source — voir en tête de chacun des deux fichiers).

// ── Statuts ESPN ────────────────────────────────────────────────────────
export const LIVE_ESPN = new Set([
  'STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME', 'STATUS_OVERTIME', 'STATUS_SHOOTOUT',
])

// ⚠️ Un match à élimination directe décidé en prolongation ou aux tirs au
// but ne renvoie JAMAIS 'STATUS_FINAL' côté ESPN — il renvoie
// 'STATUS_FINAL_AET' ou 'STATUS_FINAL_PEN'. Sans ces 2 valeurs, un match
// dans ce cas ne serait jamais considéré "vraiment terminé".
export const FINAL_ESPN = new Set([
  'STATUS_FINAL', 'STATUS_FULL_TIME',
  'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
])

export const KNOWN_ESPN_STATUS = new Set([
  'STATUS_SCHEDULED', 'STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD',
  'STATUS_EXTRA_TIME', 'STATUS_OVERTIME', 'STATUS_SHOOTOUT',
  'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
  'STATUS_POSTPONED', 'STATUS_CANCELED',
])

// Normalise le statut brut ESPN (comp.status) vers une des valeurs connues
// ci-dessus. ESPN utilise parfois des noms non documentés (ex:
// STATUS_FIRST_HALF/STATUS_SECOND_HALF vus en direct sur un vrai match de
// Coupe du Monde, absents de la doc publique) — `type.state`
// ('pre'/'in'/'post') sert de filet générique pour ne jamais renvoyer un
// statut totalement inconnu au reste de la détection.
export function normalizeEspnStatus(st) {
  const name = st?.type?.name ?? ''
  if (KNOWN_ESPN_STATUS.has(name)) return name
  if (name === 'STATUS_FIRST_HALF' || name === 'STATUS_SECOND_HALF') return 'STATUS_IN_PROGRESS'
  if (st?.type?.completed === true) return 'STATUS_FINAL'
  if (st?.type?.state === 'in')   return 'STATUS_IN_PROGRESS'
  if (st?.type?.state === 'post') return 'STATUS_FINAL'
  return name || 'STATUS_SCHEDULED'
}

// ── FIFA live — matching flou par nom d'équipe ─────────────────────────────
export function normalizeFifa(name = '') {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export function fuzzyTeamFifa(a, b) {
  const na = normalizeFifa(a), nb = normalizeFifa(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.startsWith(nb.slice(0, 5)) || nb.startsWith(na.slice(0, 5))) return true
  const wa = na.match(/[a-z]{4,}/g) ?? []
  const wb = nb.match(/[a-z]{4,}/g) ?? []
  return wa.some(x => wb.some(y => x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))))
}

export function fifaTeamNamesAll(team) {
  return (team?.TeamName ?? []).map(t => t.Description).filter(Boolean)
}

// MatchStatus : 0=pas commencé 1=en cours 3=terminé
// Period      : 0=pré-match 1=1èreMT 2=2èmeMT 3=pause MT 4=Prol MT1 5=pause Prol 6=Prol MT2 7=TAB 8=FT
// Volontairement PAS de mapping vers STATUS_FINAL ici : FIFA peut retourner
// un faux statut "terminé" lors de transitions normales (VAR, mi-temps) —
// on ne s'en sert que pour accélérer KO/mi-temps, jamais la fin (sauf
// fifaConfirmsShootoutOver ci-dessous, cas étroit et sûr).
export function fifaEffectiveStatus(m) {
  if (m.MatchStatus !== 1 || m.Period === 0) return null
  if (m.Period === 3 || m.Period === 5) return 'STATUS_HALFTIME'
  return 'STATUS_IN_PROGRESS'
}

// Fenêtre sûre pour déclarer la fin des tirs au but via FIFA : n'est appelée
// QUE quand ESPN a déjà confirmé lui-même qu'on est en tab (STATUS_SHOOTOUT),
// donc après 120min+ confirmées par ESPN — aucune transition de jeu normal
// ne peut ressembler à "MatchStatus=3 Period=8" dans cette fenêtre précise.
export function fifaConfirmsShootoutOver(m) {
  return m.MatchStatus === 3 && m.Period === 8
}

// ── Extraction buteurs/cartons depuis comp.details (scoreboard ESPN) ──────
export function extractEspnScorers(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const txt = (d.type?.text ?? '').toLowerCase()
      const id  = String(d.type?.id ?? '')
      // "Penalty - Scored" (avec espace/tiret) — txt==='penaltykick' strict
      // ne matchait quasiment jamais, voir generateRecap ci-dessous.
      return txt.includes('goal') || (txt.includes('penalty') && !txt.includes('miss')) || id === '57' || id === '58' || id === '72'
    })
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      const txt = (d.type?.text ?? '').toLowerCase()
      return {
        name:        ath?.shortName ?? ath?.displayName ?? '?',
        minute:      d.clock?.displayValue ?? '',
        team:        d.team?.id === homeTeamId ? 'home' : 'away',
        ownGoal:     d.ownGoal ?? txt.includes('own') ?? false,
        penaltyKick: d.penaltyKick ?? txt.includes('penalty') ?? false,
      }
    })
}

export function extractEspnCards(comp, homeTeamId) {
  return (comp.details ?? [])
    .filter(d => {
      const id = String(d.type?.id ?? '')
      return id === '93' || id === '94'
    })
    .map(d => {
      const ath = d.athletesInvolved?.[0]
      return {
        name:   ath?.shortName ?? ath?.displayName ?? '?',
        minute: d.clock?.displayValue ?? '',
        team:   d.team?.id === homeTeamId ? 'home' : 'away',
        red:    d.redCard === true || String(d.type?.id) === '93',
      }
    })
}

// ── Formatage ───────────────────────────────────────────────────────────
export function minuteLabel(raw) {
  const base = String(raw ?? '').split(':')[0]
  return base ? `${base}'` : ''
}

export function dateStr(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export function parseMin(m) {
  return parseInt(String(m ?? '').replace(/[^\d]/g, ''), 10) || 0
}

// ── Résumé auto de match (recap) ────────────────────────────────────────
// Moteur de phrases déterministe (pas de LLM) : gratuit, ne peut jamais
// échouer/timeout, toujours cohérent avec les vraies données du match.
// Retourne null si les données sont trop incomplètes pour être fiables
// (aucun scénario inventé, aucune approximation présentée comme un fait).
export function generateRecap({ homeTeam, awayTeam, home, away, scorers, cards }) {
  if (home == null || away == null) return null

  const diff    = Math.abs(home - away)
  const total   = home + away
  const winner  = home > away ? 'home' : away > home ? 'away' : null
  const winnerName = winner === 'home' ? homeTeam : winner === 'away' ? awayTeam : null
  const loserName  = winner === 'home' ? awayTeam : winner === 'away' ? homeTeam : null

  let intro
  if (winner === null) {
    intro = total === 0
      ? `${homeTeam} et ${awayTeam} n'ont pas réussi à se départager (0-0).`
      : `${homeTeam} et ${awayTeam} se quittent sur un match nul (${home}-${away}).`
  } else if (diff >= 3) {
    intro = `${winnerName} s'impose largement face à ${loserName} (${home}-${away}).`
  } else if (diff === 2) {
    intro = `${winnerName} prend le dessus sur ${loserName} (${home}-${away}).`
  } else {
    intro = `${winnerName} s'impose de justesse face à ${loserName} (${home}-${away}).`
  }

  const sortedGoals = [...(scorers ?? [])].sort((a, b) => parseMin(a.minute) - parseMin(b.minute))

  const lastGoal = sortedGoals[sortedGoals.length - 1]
  if (winner && diff === 1 && lastGoal && parseMin(lastGoal.minute) >= 80 && lastGoal.team === winner) {
    intro += ` Le but décisif est tombé tardivement, à la ${lastGoal.minute}.`
  }

  if (winner && sortedGoals.length >= 2 && sortedGoals[0].team !== winner) {
    intro += ` ${winnerName} a renversé la situation après avoir été mené.`
  }

  if (total >= 5) {
    intro += ' Un match spectaculaire, riche en buts.'
  }

  let scorersLine = ''
  if (sortedGoals.length) {
    const label = g => `${g.name} (${g.minute}${g.ownGoal ? ', csc' : g.penaltyKick ? ', pen' : ''})`
    scorersLine = `Buteurs : ${sortedGoals.map(label).join(', ')}.`
  }

  const reds = (cards ?? []).filter(c => c.red)
  let cardsLine = ''
  if (reds.length === 1) {
    const teamName = reds[0].team === 'home' ? homeTeam : awayTeam
    cardsLine = `${teamName} a terminé la rencontre à 10 après le carton rouge de ${reds[0].name} (${reds[0].minute}).`
  } else if (reds.length > 1) {
    cardsLine = `La rencontre a été marquée par ${reds.length} exclusions.`
  }

  return [intro, scorersLine, cardsLine].filter(Boolean).join(' ')
}

// ⚠️ AJOUT (audit robustesse) : encore une fonction pure identique dupliquée
// entre api/cron-goals.js et cf-worker/src/index.js (constaté en auditant le
// fichier après un premier lot de bugs trouvés) — même risque de divergence
// silencieuse que celui qui avait justifié la création de ce module. `json`
// est un summary ESPN brut ; sert à décider si ça vaut le coup de le mettre
// en cache Redis (évite de sauvegarder un summary "vide" qui écraserait un
// summary utile déjà en cache).
// ⚠️ Pour la Coupe du Monde, ESPN met les compositions dans
// header.competitions[0].competitors[].roster, PAS dans json.rosters (déjà
// géré côté client dans useLineups/useEspnMatchStats) — sans le 3e check
// (hasHeaderRoster), un summary de Coupe du Monde avec compos déjà connues
// était jugé "pas utile" et jamais caché (constat concret : Maroc-Canada
// affichait "Compos non disponibles" alors que l'app avait déjà les 2
// compositions à un moment donné, jamais sauvegardées faute de ce check).
export function hasUsefulSummaryData(json) {
  const hasRosters  = Array.isArray(json?.rosters) && json.rosters.length > 0
  const hasBoxscore = Array.isArray(json?.boxscore?.teams) && json.boxscore.teams.length > 0
  const competitors = json?.header?.competitions?.[0]?.competitors ?? []
  const hasHeaderRoster = competitors.some(c => Array.isArray(c?.roster) && c.roster.length > 0)
  return hasRosters || hasBoxscore || hasHeaderRoster
}
