// Cotes d'avant-match ESPN (1X2) — extraction PARTAGÉE (19/11) entre l'app (useMatchDetail.js,
// useEspnPregameOdds) et le Worker Cloudflare (cf-worker/src/index.js), qui garde la cote
// d'avant-match de chaque match pour que toutes les apps repartent du même chiffre au coup d'envoi.
// Code déplacé tel quel depuis useMatchDetail.js — aucune logique changée.
export const ODDS_PROVIDER_PRIORITY = ['ESPN BET', 'DraftKings']
export const ODDS_PROVIDER_SKIP     = p => /live/i.test(p ?? '')

export function americanToDecimal(american) {
  const v = parseFloat(american)
  if (isNaN(v) || v === 0) return null
  return v > 0 ? 1 + v / 100 : 1 + 100 / Math.abs(v)
}

// ── Total buts (over/under) — AJOUT pour "Mes Paris" ────────────────────────
// Même entrée/bookmaker déjà retenu pour le 1N2 ci-dessus (une seule ligne
// cohérente par match, pas de mélange DraftKings/ESPN BET entre les 2
// marchés). Format confirmé sur données réelles (DraftKings, Málaga-
// Deportivo, 24/08) : entry.overUnder = ligne courante (ex. 2.5),
// entry.total.{over,under}.close.odds = cote américaine ("+125"/"-155").
// Format "ESPN BET" pour ce marché précis jamais vérifié sur données
// réelles — pas de 2e tentative à l'aveugle ici (contrairement à
// extractMoneylines, où les 2 formats ont chacun été confirmés en prod) :
// on préfère retourner null (marché "Total buts" simplement absent de la
// card) plutôt que de deviner un nom de champ et risquer d'afficher une
// fausse cote.
function extractTotal(oddsEntry) {
  const line = oddsEntry?.overUnder
  const overRaw  = oddsEntry?.total?.over?.close?.odds  ?? oddsEntry?.total?.over?.open?.odds
  const underRaw = oddsEntry?.total?.under?.close?.odds ?? oddsEntry?.total?.under?.open?.odds
  if (line == null || overRaw == null || underRaw == null) return null
  const over  = americanToDecimal(overRaw)
  const under = americanToDecimal(underRaw)
  if (!over || !under) return null
  return { line, over, under }
}

// Deux formats rencontrés selon le provider (voir commentaire au-dessus) —
// on essaie les deux, sans hypothèse sur lequel s'applique à quel provider
// (plus robuste si ESPN change un format un jour).
function extractMoneylines(oddsEntry) {
  // Format "DraftKings" : moneyline.{home,away,draw}.close.odds (string "+135")
  const ml = oddsEntry?.moneyline
  if (ml?.home?.close?.odds != null || ml?.home?.open?.odds != null) {
    return {
      home: ml.home?.close?.odds ?? ml.home?.open?.odds,
      away: ml.away?.close?.odds ?? ml.away?.open?.odds,
      draw: ml.draw?.close?.odds ?? ml.draw?.open?.odds ?? oddsEntry?.drawOdds?.moneyLine,
    }
  }
  // Format "ESPN BET" : {home,away}TeamOdds.moneyLine (nombre direct) + drawOdds.moneyLine
  if (oddsEntry?.homeTeamOdds?.moneyLine != null || oddsEntry?.awayTeamOdds?.moneyLine != null) {
    return {
      home: oddsEntry.homeTeamOdds?.moneyLine,
      away: oddsEntry.awayTeamOdds?.moneyLine,
      draw: oddsEntry.drawOdds?.moneyLine,
    }
  }
  return null
}


// Cote 1X2 d'avant-match d'UNE compétition d'événement ESPN (`event.competitions[0]`) :
// { decimal: {home,draw,away}, pct: {home,draw,away}, total } ou null.
export function extractPregameOddsFromComp(comp) {
  const oddsList = (comp?.odds ?? []).filter(o => !ODDS_PROVIDER_SKIP(o?.provider?.name))
  // Provider préféré d'abord (ESPN BET, puis DraftKings), sinon
  // n'importe quel provider restant (mieux qu'aucune cote, toujours
  // filtré par le garde-fou plus bas avant d'être affiché).
  const ordered = [
    ...ODDS_PROVIDER_PRIORITY.flatMap(name => oddsList.filter(o => o?.provider?.name === name)),
    ...oddsList.filter(o => !ODDS_PROVIDER_PRIORITY.includes(o?.provider?.name)),
  ]

  for (const entry of ordered) {
    const ml = extractMoneylines(entry)
    if (!ml) continue
    const homeOdds = americanToDecimal(ml.home)
    const awayOdds = americanToDecimal(ml.away)
    const drawOdds = americanToDecimal(ml.draw)
    if (!homeOdds || !awayOdds || !drawOdds) continue

    // Probabilité implicite (marge bookmaker déjà incluse dans une
    // vraie cote marché, contrairement à notre modèle) — sert à
    // déterminer le favori/l'intensité du liseré, pas la cote
    // AFFICHÉE (voir decimal).
    const pHome = 1 / homeOdds, pDraw = 1 / drawOdds, pAway = 1 / awayOdds
    const sum   = pHome + pDraw + pAway
    // Garde-fou anti-mauvais-marché (voir commentaire plus haut) —
    // une vraie cote 1X2 a une marge raisonnable (95%-130%) ; en
    // dehors, on passe au provider suivant plutôt que d'afficher
    // n'importe quoi.
    if (sum < 0.95 || sum > 1.3) continue

    return {
      decimal: { home: homeOdds, draw: drawOdds, away: awayOdds },
      pct:     { home: (pHome / sum) * 100, draw: (pDraw / sum) * 100, away: (pAway / sum) * 100 },
      total:   extractTotal(entry),
    }
  }
  return null
}
