/**
 * TeamSearchPage — route /equipe, "fiche équipe" (demande utilisateur
 * 28/10) : chercher une équipe (ex. PSG) et voir le récap de tous ses
 * matchs depuis le début de la saison, toutes compétitions de club
 * couvertes par l'app confondues (voir useTeamSearch.js pour le détail des
 * compétitions), avec un filtre par compétition et des stats/forme récente.
 *
 * Recherche et agrégation PAR NOM (teamSearch.js) — aucun id n'est commun
 * entre les différentes sources (FD.org pour les 5 grands championnats + C1,
 * ESPN pour les 2 autres coupes européennes), donc impossible de relier les
 * matchs d'une même équipe entre compétitions autrement que par son nom.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTeamSearchMatches } from '../hooks/useTeamSearch'
import {
  normalizeTeamQuery,
  teamMatchesQuery,
  teamIdentityKey,
  teamDisplayName,
} from '../utils/teamSearch'
import { outcomeForSide, finalScore } from '../utils/matchUtils'
import { translateTeam } from '../data/teamNames'
import { COMPETITIONS } from '../data/competitions'
import { getTeamColor, hexToRgbTriplet } from '../data/teamPhotos'
import { FormDiamonds } from '../accueil/FormDiamonds'
import '../teamSearchPage.css'

function compEmblem(code) {
  return COMPETITIONS.find(c => c.id === code)?.emblem ?? null
}

function formatMatchDate(utcDate) {
  const d = new Date(utcDate)
  const now = new Date()
  const opts = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('fr-FR', opts)
}

function formatKickoffTime(utcDate) {
  return new Date(utcDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Construit, pour une équipe identifiée (key), la liste de ses matchs à
// partir de TOUTE la donnée déjà fetchée (pas seulement celle qui matchait la
// recherche) — une fois l'équipe trouvée, on veut son récap complet.
function buildTeamProfile(matches, key) {
  const teamMatches = []
  for (const m of matches) {
    const homeKey = teamIdentityKey(m.homeTeam)
    const awayKey = teamIdentityKey(m.awayTeam)
    if (homeKey === key) teamMatches.push({ match: m, isHome: true })
    else if (awayKey === key) teamMatches.push({ match: m, isHome: false })
  }
  teamMatches.sort((a, b) => new Date(b.match.utcDate) - new Date(a.match.utcDate))
  return teamMatches
}

function computeStats(rows) {
  let played = 0, wins = 0, draws = 0, losses = 0, gf = 0, ga = 0
  let homePlayed = 0, homeWins = 0, homeDraws = 0, homeLosses = 0
  let awayPlayed = 0, awayWins = 0, awayDraws = 0, awayLosses = 0

  for (const { match, isHome } of rows) {
    if (match.status !== 'FINISHED') continue
    const outcome = outcomeForSide(match, isHome)
    if (!outcome) continue
    const fs = finalScore(match.score)
    const own = isHome ? fs.home : fs.away
    const opp = isHome ? fs.away : fs.home
    if (own == null || opp == null) continue

    played++
    gf += own
    ga += opp
    if (outcome === 'W') wins++
    else if (outcome === 'D') draws++
    else losses++

    if (isHome) {
      homePlayed++
      if (outcome === 'W') homeWins++
      else if (outcome === 'D') homeDraws++
      else homeLosses++
    } else {
      awayPlayed++
      if (outcome === 'W') awayWins++
      else if (outcome === 'D') awayDraws++
      else awayLosses++
    }
  }

  // Forme récente : les 5 derniers matchs joués, du plus ancien (gauche) au
  // plus récent (droite) — même convention que FormDiamonds partout ailleurs
  // dans l'app (rows est déjà trié du plus récent au plus ancien, on inverse).
  const form = rows
    .filter(r => r.match.status === 'FINISHED')
    .slice(0, 5)
    .reverse()
    .map(r => outcomeForSide(r.match, r.isHome))
    .filter(Boolean)

  return {
    played, wins, draws, losses, gf, ga, diff: gf - ga, form,
    home: { played: homePlayed, wins: homeWins, draws: homeDraws, losses: homeLosses },
    away: { played: awayPlayed, wins: awayWins, draws: awayDraws, losses: awayLosses },
  }
}

function TeamProfile({ rows, teamName, teamCrest }) {
  const [compFilter, setCompFilter] = useState(null)

  const comps = useMemo(() => {
    const byId = new Map()
    for (const { match } of rows) {
      const id = match.competition?.id ?? match.competition?.code
      if (id == null || byId.has(id)) continue
      byId.set(id, {
        id,
        code: match.competition?.code,
        name: match.competition?.name ?? match.competition?.code ?? 'Compétition',
      })
    }
    return [...byId.values()]
  }, [rows])

  const filteredRows = useMemo(() => {
    if (compFilter == null) return rows
    return rows.filter(r => (r.match.competition?.id ?? r.match.competition?.code) === compFilter)
  }, [rows, compFilter])

  const stats = useMemo(() => computeStats(filteredRows), [filteredRows])
  const color = getTeamColor(teamName)
  const rgb = hexToRgbTriplet(color)

  return (
    <div className="teamSearchPage__profile" style={{ '--team-color': color, '--team-color-rgb': rgb }}>
      <div className="teamSearchPage__profileHead">
        {teamCrest && (
          <img
            src={teamCrest}
            alt=""
            className="teamSearchPage__profileCrest"
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <div>
          <h2 className="teamSearchPage__profileName">{teamName}</h2>
          {stats.form.length > 0 && <FormDiamonds form={stats.form} />}
        </div>
      </div>

      {comps.length > 1 && (
        <div className="teamSearchPage__compChips">
          <button
            type="button"
            className={`teamSearchPage__compChip${compFilter == null ? ' teamSearchPage__compChip--active' : ''}`}
            onClick={() => setCompFilter(null)}
          >
            Toutes
          </button>
          {comps.map(c => {
            const emblem = compEmblem(c.code)
            return (
              <button
                key={c.id}
                type="button"
                className={`teamSearchPage__compChip${compFilter === c.id ? ' teamSearchPage__compChip--active' : ''}`}
                onClick={() => setCompFilter(c.id)}
              >
                {emblem && <img src={emblem} alt="" />}
                <span>{c.name}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="teamSearchPage__statsGrid">
        <div className="teamSearchPage__statCard">
          <span className="teamSearchPage__statValue">{stats.played}</span>
          <span className="teamSearchPage__statLabel">Joués</span>
        </div>
        <div className="teamSearchPage__statCard teamSearchPage__statCard--win">
          <span className="teamSearchPage__statValue">{stats.wins}</span>
          <span className="teamSearchPage__statLabel">Victoires</span>
        </div>
        <div className="teamSearchPage__statCard teamSearchPage__statCard--draw">
          <span className="teamSearchPage__statValue">{stats.draws}</span>
          <span className="teamSearchPage__statLabel">Nuls</span>
        </div>
        <div className="teamSearchPage__statCard teamSearchPage__statCard--loss">
          <span className="teamSearchPage__statValue">{stats.losses}</span>
          <span className="teamSearchPage__statLabel">Défaites</span>
        </div>
        <div className="teamSearchPage__statCard">
          <span className="teamSearchPage__statValue">{stats.gf}</span>
          <span className="teamSearchPage__statLabel">Buts marqués</span>
        </div>
        <div className="teamSearchPage__statCard">
          <span className="teamSearchPage__statValue">{stats.ga}</span>
          <span className="teamSearchPage__statLabel">Buts concédés</span>
        </div>
        <div className="teamSearchPage__statCard">
          <span className="teamSearchPage__statValue">{stats.diff > 0 ? `+${stats.diff}` : stats.diff}</span>
          <span className="teamSearchPage__statLabel">Différence</span>
        </div>
      </div>

      <div className="teamSearchPage__homeAway">
        <div className="teamSearchPage__homeAwayBlock">
          <span className="teamSearchPage__homeAwayLabel">Domicile</span>
          <span className="teamSearchPage__homeAwayRecord">
            {stats.home.wins}V {stats.home.draws}N {stats.home.losses}D
          </span>
        </div>
        <div className="teamSearchPage__homeAwayBlock">
          <span className="teamSearchPage__homeAwayLabel">Extérieur</span>
          <span className="teamSearchPage__homeAwayRecord">
            {stats.away.wins}V {stats.away.draws}N {stats.away.losses}D
          </span>
        </div>
      </div>

      <ul className="teamSearchPage__matchList">
        {filteredRows.map(({ match, isHome }) => {
          const opponent = isHome ? match.awayTeam : match.homeTeam
          const opponentName = translateTeam(opponent?.shortName || opponent?.name || '?')
          const fs = finalScore(match.score)
          const played = match.status === 'FINISHED'
          const outcome = played ? outcomeForSide(match, isHome) : null
          const ownScore = isHome ? fs.home : fs.away
          const oppScore = isHome ? fs.away : fs.home

          return (
            <li key={match.id} className="teamSearchPage__matchRow">
              <span className="teamSearchPage__matchDate">{formatMatchDate(match.utcDate)}</span>
              <span className="teamSearchPage__matchComp">{match.competition?.name}</span>
              <span className="teamSearchPage__matchOpp">
                <span className="teamSearchPage__matchVs">{isHome ? 'vs' : '@'}</span>
                {opponent?.crest && (
                  <img src={opponent.crest} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
                )}
                {opponentName}
              </span>
              {played ? (
                <>
                  <span className="teamSearchPage__matchScore">
                    {ownScore ?? '–'} - {oppScore ?? '–'}
                  </span>
                  {outcome && (
                    <span className={`teamSearchPage__outcomeDot teamSearchPage__outcomeDot--${outcome.toLowerCase()}`} />
                  )}
                </>
              ) : (
                <span className="teamSearchPage__matchUpcoming">{formatKickoffTime(match.utcDate)}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function TeamSearchPage() {
  const navigate = useNavigate()
  const { matches, isLoading } = useTeamSearchMatches()
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)

  const normalizedQuery = normalizeTeamQuery(query)

  const candidates = useMemo(() => {
    if (normalizedQuery.length < 2) return []
    const byKey = new Map()
    for (const m of matches) {
      for (const team of [m.homeTeam, m.awayTeam]) {
        if (!team || !teamMatchesQuery(team, normalizedQuery)) continue
        const key = teamIdentityKey(team)
        if (!byKey.has(key)) {
          byKey.set(key, { key, displayName: teamDisplayName(team), crest: team.crest, count: 0 })
        }
        byKey.get(key).count++
      }
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count)
  }, [matches, normalizedQuery])

  const selected = selectedKey
    ? candidates.find(c => c.key === selectedKey) ?? { key: selectedKey, displayName: query, crest: null }
    : null

  const teamRows = useMemo(() => {
    if (!selectedKey) return []
    return buildTeamProfile(matches, selectedKey)
  }, [matches, selectedKey])

  const handlePick = (candidate) => {
    setSelectedKey(candidate.key)
    setQuery(candidate.displayName)
  }

  const handleQueryChange = (e) => {
    setQuery(e.target.value)
    setSelectedKey(null)
  }

  const showSuggestions = !selectedKey && normalizedQuery.length >= 2

  return (
    <div className="teamSearchPage">
      <div className="teamSearchPage__header">
        <button className="teamSearchPage__back" onClick={() => navigate(-1)} aria-label="Retour" type="button">‹</button>
        <h1 className="teamSearchPage__title">Fiche équipe</h1>
      </div>

      <div className="teamSearchPage__searchWrap">
        <input
          className="teamSearchPage__searchInput"
          type="text"
          value={query}
          onChange={handleQueryChange}
          placeholder="Cherche une équipe… (PSG, Real Madrid, Liverpool…)"
          autoFocus
        />

        {showSuggestions && (
          <div className="teamSearchPage__suggestions">
            {candidates.length === 0 ? (
              <p className="teamSearchPage__suggestEmpty">Aucune équipe trouvée.</p>
            ) : (
              candidates.slice(0, 8).map(c => (
                <button
                  key={c.key}
                  type="button"
                  className="teamSearchPage__suggestItem"
                  onClick={() => handlePick(c)}
                >
                  {c.crest && <img src={c.crest} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />}
                  <span>{c.displayName}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {!selectedKey && normalizedQuery.length < 2 && (
        <p className="teamSearchPage__hint">
          Tape le nom d'une équipe pour voir tous ses matchs de la saison, toutes compétitions confondues
          (championnat, coupe nationale, coupes européennes).
        </p>
      )}

      {isLoading && !selectedKey && (
        <p className="teamSearchPage__hint">Chargement des données…</p>
      )}

      {selected && (
        teamRows.length > 0 ? (
          <TeamProfile rows={teamRows} teamName={selected.displayName} teamCrest={selected.crest} />
        ) : (
          <p className="teamSearchPage__hint">
            {isLoading ? 'Chargement des matchs…' : 'Aucun match trouvé pour cette équipe cette saison.'}
          </p>
        )
      )}
    </div>
  )
}
