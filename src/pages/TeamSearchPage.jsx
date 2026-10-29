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
import { useTeamSearchMatches, useTeamStandingsMulti, useTeamScorersMulti } from '../hooks/useTeamSearch'
import { useLineups, useFdLineups } from '../hooks/useMatchDetail'
import {
  normalizeTeamQuery,
  teamMatchesQuery,
  teamIdentityKey,
  teamDisplayName,
} from '../utils/teamSearch'
import { outcomeForSide, finalScore } from '../utils/matchUtils'
import { translateTeam } from '../data/teamNames'
import { COMPETITIONS, NO_SCORERS_COMPS } from '../data/competitions'
import { getTeamColor, hexToRgbTriplet } from '../data/teamPhotos'
import { FormDiamonds } from '../accueil/FormDiamonds'
import LineupPitch from '../components/LineupPitch'
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
  // Ordre chronologique (du plus ancien au plus récent, les matchs à venir
  // ferment la liste) — demande explicite utilisateur du 28/10 : l'ancien tri
  // "plus récent d'abord" plaçait les matchs à venir (date la plus grande) au
  // tout début, ce qui repoussait TOUS les matchs déjà joués en bas de liste.
  teamMatches.sort((a, b) => new Date(a.match.utcDate) - new Date(b.match.utcDate))
  return teamMatches
}

function computeStats(rows) {
  let played = 0, wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, cleanSheets = 0
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
    // Clean sheet = match terminé sans le moindre but encaissé (demande
    // explicite utilisateur, 28/10 : "mettre possiblement plus de stats,
    // genre par exemple combien de clean sheets").
    if (opp === 0) cleanSheets++
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
  // dans l'app. rows est maintenant trié du plus ancien au plus récent, donc
  // les 5 derniers matchs JOUÉS de la liste sont déjà dans le bon ordre.
  const form = rows
    .filter(r => r.match.status === 'FINISHED')
    .slice(-5)
    .map(r => outcomeForSide(r.match, r.isHome))
    .filter(Boolean)

  return {
    played, wins, draws, losses, gf, ga, diff: gf - ga, cleanSheets, form,
    home: { played: homePlayed, wins: homeWins, draws: homeDraws, losses: homeLosses },
    away: { played: awayPlayed, wins: awayWins, draws: awayDraws, losses: awayLosses },
  }
}

function RecordBar({ wins, draws, losses }) {
  const total = wins + draws + losses
  if (total === 0) return <div className="teamSearchPage__recordBar teamSearchPage__recordBar--empty" />
  return (
    <div className="teamSearchPage__recordBar">
      <span className="teamSearchPage__recordBarSeg teamSearchPage__recordBarSeg--w" style={{ width: `${(wins / total) * 100}%` }} />
      <span className="teamSearchPage__recordBarSeg teamSearchPage__recordBarSeg--d" style={{ width: `${(draws / total) * 100}%` }} />
      <span className="teamSearchPage__recordBarSeg teamSearchPage__recordBarSeg--l" style={{ width: `${(losses / total) * 100}%` }} />
    </div>
  )
}

// ⚠️ AJOUT (28/10, demande utilisateur : "la compo la utilisé [...] avec la
// disposition des joueurs etc") — réutilise EXACTEMENT les mêmes sources que
// ComposTab (MatchModal.jsx) pour un match "normal" : ESPN en priorité
// (useLineups, gère aussi les comps ESPN-only UEL/UECL via espnNativeSlug),
// puis football-data.org en repli (useFdLineups, /v4/matches/{id} — no-op
// silencieux si `match.id` n'est pas un vrai id FD.org numérique, ex. un
// match ESPN-sourcé). `LineupPitch` en mode `singleTeam` (voir son
// commentaire) affiche uniquement le côté de l'équipe recherchée, sans
// l'onglet home/away qui n'aurait pas de sens ici (pas de "match" affiché).
// Honnêteté : si aucune des 2 sources n'a la compo pour CE match précis
// (fréquent avant le coup d'envoi suivant, ou pour un vieux match jamais
// republié), rien n'est affiché plutôt qu'un terrain vide trompeur — même
// principe que partout ailleurs dans ce projet (readCacheStale/gaps connus).
function TeamLineupSection({ row, hColor, teamCrest }) {
  const { match, isHome } = row
  const isFinished = match.status === 'FINISHED'
  const { data: espnLineups, isLoading: espnLoading } = useLineups(match, isFinished)
  const { data: fdLineups,   isLoading: fdLoading   } = useFdLineups(match)

  const espnHasData = espnLineups?.home?.starters?.length
  const lineups = espnHasData ? espnLineups : (fdLineups?.home?.starters?.length ? fdLineups : null)
  const loading = espnLoading || (!espnHasData && fdLoading)
  const teamLineup = lineups ? (isHome ? lineups.home : lineups.away) : null

  if (!teamLineup?.starters?.length) {
    if (!loading) return null
    return (
      <section className="teamSearchPage__section">
        <h3 className="teamSearchPage__sectionTitle">Compo</h3>
        <span className="teamSearchPage__standingsHint">Chargement…</span>
      </section>
    )
  }

  return (
    <section className="teamSearchPage__section">
      <h3 className="teamSearchPage__sectionTitle">
        Compo
        <span className="teamSearchPage__sectionCount">dernier match</span>
      </h3>
      <LineupPitch home={{ ...teamLineup, crest: teamCrest }} hColor={hColor} singleTeam />
    </section>
  )
}

function TeamProfile({ rows, teamName, teamCrest, teamKey }) {
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
        // ⚠️ isCup (28/10, section Classement ci-dessous) : un match de coupe
        // nationale garde le CODE FD.org du championnat parent (voir
        // fetchEspnCupMatches, espnAdapter.js — ex. une coupe de PD a
        // `competition.code: 'PD'`), seul `competition.id` (synthétique,
        // négatif) le distingue vraiment de la vraie ligue — sans ce flag, un
        // classement serait demandé 2 fois pour le même code FD.org, une pour
        // la ligue et une pour sa coupe (qui n'a de toute façon aucun
        // classement, c'est un tableau à élimination directe).
        isCup: !!match.isCup,
      })
    }
    return [...byId.values()]
  }, [rows])

  // ⚠️ AJOUT (28/10, demande utilisateur : "le classement de l'equipe pour
  // chaque championat ou elle participe et en cours surtout") — seules les
  // compétitions à classement (pas les coupes à élimination directe, voir
  // isCup ci-dessus) sont envoyées au hook de classement.
  const standingsCompCodes = useMemo(
    () => [...new Set(comps.filter(c => !c.isCup && c.code).map(c => c.code))],
    [comps]
  )
  const standingsByComp = useTeamStandingsMulti(standingsCompCodes)
  // "en cours surtout" : la compétition du tout prochain match à venir de
  // l'équipe (rows est trié chronologiquement, voir buildTeamProfile — le
  // premier match pas encore joué dans cet ordre est le plus proche) est mise
  // en avant en tête de liste ; si plus aucun match à venir (fin de saison),
  // on garde l'ordre naturel des compétitions.
  const currentCompId = useMemo(
    () => rows.find(r => r.match.status !== 'FINISHED')?.match.competition?.id ?? null,
    [rows]
  )

  // ⚠️ AJOUT (28/10, demande utilisateur : "les meilleurs buteurs de
  // l'equipe") — NO_SCORERS_COMPS (UEL/UECL, voir competitions.js) renvoie
  // déjà [] proprement depuis fetchScorersData, filtré ici uniquement pour
  // ne PAS afficher de bloc vide "0 buteur" trompeur pour ces 2 compétitions
  // — honnêteté : pas de source fiable, on ne montre rien plutôt qu'un faux
  // "aucun buteur".
  const scorersCompCodes = useMemo(
    () => standingsCompCodes.filter(c => !NO_SCORERS_COMPS.has(c)),
    [standingsCompCodes]
  )
  const scorersByComp = useTeamScorersMulti(scorersCompCodes)

  const filteredRows = useMemo(() => {
    if (compFilter == null) return rows
    return rows.filter(r => (r.match.competition?.id ?? r.match.competition?.code) === compFilter)
  }, [rows, compFilter])

  const stats = useMemo(() => computeStats(filteredRows), [filteredRows])
  const color = getTeamColor(teamName)
  const rgb = hexToRgbTriplet(color)

  // ⚠️ AJOUT (28/10, demande utilisateur : "la compo la utilisé [...] avec la
  // disposition des joueurs") — la compo du DERNIER match joué, pas une
  // moyenne/compo la plus fréquente statistique : interroger la compo de
  // chacun des 15-40 matchs de la saison coûterait autant de requêtes FD.org
  // individuelles, un risque de rafale déjà documenté comme sensible dans ce
  // projet (suspensions de compte FD.org, voir CLAUDE.md) pour un gain
  // marginal — la dernière compo connue est déjà l'information la plus
  // directe et la plus utile ("la compo utilisée" au sens propre).
  const lastPlayedRow = useMemo(() => {
    const played = rows.filter(r => r.match.status === 'FINISHED')
    return played.length > 0 ? played[played.length - 1] : null
  }, [rows])

  return (
    <div className="teamSearchPage__profile" style={{ '--team-color': color, '--team-color-rgb': rgb }}>
      {/* ⚠️ REDESSINÉ (28/10, round 3 — retour utilisateur : "là où il y a la
          forme récente [...] faut un peu améliorer ça [...] faire une
          disposition vraiment carrée, vraiment propre. Bien lisible pour
          l'utilisateur") : l'ancienne ligne horizontale (blason à gauche,
          colonne texte à droite) devient une vraie carte carrée centrée —
          blason en tête, nom, puis le bilan V/N/D, puis un bloc "Forme
          récente" séparé et titré (au lieu d'un simple rang de losanges
          collé sous le nom) pour une lecture plus claire, bloc par bloc. */}
      <div className="teamSearchPage__hero">
        <div className="teamSearchPage__profileCrestWrap">
          {teamCrest ? (
            <img
              src={teamCrest}
              alt=""
              className="teamSearchPage__profileCrest"
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          ) : (
            <span className="teamSearchPage__profileCrestFallback">{teamName.charAt(0)}</span>
          )}
        </div>
        <h2 className="teamSearchPage__profileName">{teamName}</h2>
        <span className="teamSearchPage__heroRecord">
          {stats.wins}V {stats.draws}N {stats.losses}D
          <span className="teamSearchPage__heroRecordSep">·</span>
          {stats.played} match{stats.played > 1 ? 's' : ''}
        </span>
        {stats.form.length > 0 && (
          <div className="teamSearchPage__heroForm">
            <span className="teamSearchPage__heroFormLabel">Forme récente</span>
            <FormDiamonds form={stats.form} />
          </div>
        )}
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

      {/* ⚠️ AJOUT (28/10, demande utilisateur : "le classement de l'equipe
          pour chaque championat ou elle participe et en cours surtout") —
          une ligne de classement par compétition à classement (pas les
          coupes nationales, à élimination directe, voir isCup plus haut) ;
          la compétition du prochain match à venir ("en cours") passe en
          tête, les autres gardent l'ordre de `comps`. */}
      {standingsCompCodes.length > 0 && (
        <section className="teamSearchPage__section">
          <h3 className="teamSearchPage__sectionTitle">Classement</h3>
          <ul className="teamSearchPage__standingsList">
            {[...comps]
              .filter(c => !c.isCup && standingsCompCodes.includes(c.code))
              .sort((a, b) => (a.id === currentCompId ? -1 : b.id === currentCompId ? 1 : 0))
              .map(c => {
                const entry = standingsByComp[c.code] ?? { standings: [], loading: false }
                const row = entry.standings.find(r => teamIdentityKey(r.team) === teamKey) ?? null
                const emblem = compEmblem(c.code)
                return (
                  <li key={c.id} className="teamSearchPage__standingsRow">
                    <div className="teamSearchPage__standingsComp">
                      {emblem && <img src={emblem} alt="" />}
                      <span>{c.name}</span>
                      {c.id === currentCompId && (
                        <span className="teamSearchPage__standingsLiveTag">En cours</span>
                      )}
                    </div>
                    {entry.loading && !row ? (
                      <span className="teamSearchPage__standingsHint">Chargement…</span>
                    ) : row ? (
                      <div className="teamSearchPage__standingsStats">
                        <span className="teamSearchPage__standingsPos">{row.position}<small>e</small></span>
                        <span className="teamSearchPage__standingsPts">{row.points ?? '–'} pts</span>
                        <span className="teamSearchPage__standingsDetail">
                          {row.playedGames ?? '–'}J · {row.won ?? '–'}V {row.draw ?? '–'}N {row.lost ?? '–'}D
                        </span>
                        <span className="teamSearchPage__standingsDetail">
                          {row.goalsFor ?? '–'}–{row.goalsAgainst ?? '–'}
                        </span>
                      </div>
                    ) : (
                      <span className="teamSearchPage__standingsHint">Classement indisponible</span>
                    )}
                  </li>
                )
              })}
          </ul>
        </section>
      )}

      {/* ⚠️ REDESSINÉ (28/10, round 4 — retour utilisateur : "disposition
          générale" pointée comme le point à revoir). Les 3 anciennes sections
          (Bilan / Buts / Domicile-Extérieur), chacune sa propre carte avec
          son propre titre et sa propre marge, donnaient une suite de blocs
          détachés les uns des autres plutôt qu'une vraie lecture d'ensemble.
          Fusionnées en UN seul panneau "Statistiques", avec 3 rangées
          séparées par de fines lignes internes plutôt que par des cartes
          distinctes — un seul cadre, une seule respiration visuelle, la
          structure interne reste lisible via les séparateurs et les
          libellés, pas via un empilement de boîtes. */}
      <section className="teamSearchPage__statsPanel">
        <h3 className="teamSearchPage__sectionTitle">Statistiques</h3>

        <div className="teamSearchPage__statsPanelRow teamSearchPage__statsPanelRow--record">
          <div className="teamSearchPage__recordNums">
            <span className="teamSearchPage__recordNum teamSearchPage__recordNum--w">{stats.wins}<small>V</small></span>
            <span className="teamSearchPage__recordNum teamSearchPage__recordNum--d">{stats.draws}<small>N</small></span>
            <span className="teamSearchPage__recordNum teamSearchPage__recordNum--l">{stats.losses}<small>D</small></span>
          </div>
          <RecordBar wins={stats.wins} draws={stats.draws} losses={stats.losses} />
          <span className="teamSearchPage__recordCaption">
            {stats.played} match{stats.played > 1 ? 's' : ''} joué{stats.played > 1 ? 's' : ''}
          </span>
        </div>

        <div className="teamSearchPage__statsPanelDivider" />

        <div className="teamSearchPage__statsPanelRow teamSearchPage__statsPanelRow--goals">
          <div className="teamSearchPage__goalPill">
            <span className="teamSearchPage__goalPillValue">{stats.gf}</span>
            <span className="teamSearchPage__goalPillLabel">Marqués</span>
          </div>
          <div className="teamSearchPage__goalPill">
            <span className="teamSearchPage__goalPillValue">{stats.ga}</span>
            <span className="teamSearchPage__goalPillLabel">Concédés</span>
          </div>
          <div className="teamSearchPage__goalPill">
            <span className="teamSearchPage__goalPillValue">{stats.diff > 0 ? `+${stats.diff}` : stats.diff}</span>
            <span className="teamSearchPage__goalPillLabel">Différence</span>
          </div>
          <div className="teamSearchPage__goalPill teamSearchPage__goalPill--cs">
            <span className="teamSearchPage__goalPillValue">{stats.cleanSheets}</span>
            <span className="teamSearchPage__goalPillLabel">Clean sheets</span>
          </div>
        </div>

        <div className="teamSearchPage__statsPanelDivider" />

        <div className="teamSearchPage__statsPanelRow teamSearchPage__statsPanelRow--homeaway">
          <div className="teamSearchPage__homeAwayBlock">
            <span className="teamSearchPage__homeAwayLabel">Domicile</span>
            <span className="teamSearchPage__homeAwayRecord">
              {stats.home.wins}V {stats.home.draws}N {stats.home.losses}D
            </span>
            <RecordBar wins={stats.home.wins} draws={stats.home.draws} losses={stats.home.losses} />
          </div>
          <div className="teamSearchPage__homeAwayDivider" />
          <div className="teamSearchPage__homeAwayBlock">
            <span className="teamSearchPage__homeAwayLabel">Extérieur</span>
            <span className="teamSearchPage__homeAwayRecord">
              {stats.away.wins}V {stats.away.draws}N {stats.away.losses}D
            </span>
            <RecordBar wins={stats.away.wins} draws={stats.away.draws} losses={stats.away.losses} />
          </div>
        </div>
      </section>

      {/* ⚠️ AJOUT (28/10, demande utilisateur : "les meilleurs buteurs de
          l'equipe") — top 5 buteurs de l'équipe par compétition (football-
          data.org, voir NO_SCORERS_COMPS plus haut pour les 2 compétitions
          sans source fiable, UEL/UECL, volontairement absentes d'ici). */}
      {scorersCompCodes.length > 0 && (
        <section className="teamSearchPage__section">
          <h3 className="teamSearchPage__sectionTitle">Meilleurs buteurs</h3>
          {scorersCompCodes.map(code => {
            const comp = comps.find(c => c.code === code && !c.isCup)
            const entry = scorersByComp[code] ?? { scorers: [], loading: false }
            const teamScorers = entry.scorers
              .filter(s => teamIdentityKey(s.team) === teamKey)
              .sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0))
              .slice(0, 5)
            if (!entry.loading && teamScorers.length === 0) return null
            return (
              <div key={code} className="teamSearchPage__scorersBlock">
                <span className="teamSearchPage__scorersCompLabel">{comp?.name ?? code}</span>
                {entry.loading && teamScorers.length === 0 ? (
                  <span className="teamSearchPage__standingsHint">Chargement…</span>
                ) : (
                  <ul className="teamSearchPage__scorersList">
                    {teamScorers.map(s => (
                      <li key={s.player?.id ?? s.player?.name} className="teamSearchPage__scorersRow">
                        <span className="teamSearchPage__scorersName">{translateTeam(s.player?.name) || s.player?.name}</span>
                        <span className="teamSearchPage__scorersGoals">{s.goals} but{s.goals > 1 ? 's' : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* ⚠️ AJOUT (28/10, demande utilisateur : "la compo la utilisé [...]
          avec la disposition des joueurs") — voir TeamLineupSection plus bas
          dans ce fichier pour le détail des sources (ESPN puis FD.org, même
          mécanisme que ComposTab dans MatchModal.jsx). */}
      {lastPlayedRow && (
        <TeamLineupSection row={lastPlayedRow} hColor={color} teamCrest={teamCrest} />
      )}

      <section className="teamSearchPage__section">
        <h3 className="teamSearchPage__sectionTitle">
          Tous les matchs
          <span className="teamSearchPage__sectionCount">{filteredRows.length}</span>
        </h3>
        {/* ⚠️ REDESSINÉ (28/10, retour utilisateur : "pour la liste des matchs,
            vraiment faire un truc vraiment plus pro, plus design, comme un peu
            dans la page programme et résultats") — même grammaire visuelle que
            ResultCard.jsx (Résultats) / le bloc "matchs__*" de Match.jsx
            (Programme) : grille 3 colonnes équipe/centre/équipe, gros blasons
            ronds, score en gros chiffres (police d'affichage, vert si
            victoire), badge "Terminé". Pas identique : affiche les 2 VRAIS
            côtés domicile/extérieur (comme sur ces 2 pages) mais met en
            évidence le côté de l'équipe recherchée (anneau coloré + nom en
            couleur d'équipe) — information que ces 2 pages n'ont pas besoin de
            donner, propre à une fiche équipe. */}
        <ul className="teamSearchPage__matchList">
          {filteredRows.map(({ match, isHome }) => {
            const fs = finalScore(match.score)
            const played = match.status === 'FINISHED'
            const outcome = played ? outcomeForSide(match, isHome) : null
            const rowKind = played ? (outcome ? outcome.toLowerCase() : 'none') : 'upcoming'
            const hs = fs.home
            const as_ = fs.away
            const hWin = played && hs != null && as_ != null && hs > as_
            const aWin = played && hs != null && as_ != null && as_ > hs
            const draw = played && hs != null && as_ != null && hs === as_
            const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
            const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

            return (
              <li key={match.id} className={`teamSearchPage__matchRow teamSearchPage__matchRow--${rowKind}`}>
                <div className="teamSearchPage__matchHead">
                  <span className="teamSearchPage__matchDate">{formatMatchDate(match.utcDate)}</span>
                  <span className="teamSearchPage__matchComp">{match.competition?.name}</span>
                </div>
                <div className="teamSearchPage__matchBody">
                  <div className={`teamSearchPage__matchSide${isHome ? ' teamSearchPage__matchSide--self' : ''}`}>
                    <div className="teamSearchPage__matchCrestWrap">
                      {match.homeTeam?.crest
                        ? <img src={match.homeTeam.crest} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
                        : <span className="teamSearchPage__matchCrestFb">{homeName.charAt(0)}</span>}
                    </div>
                    <span className="teamSearchPage__matchSideName">{homeName}</span>
                  </div>

                  <div className="teamSearchPage__matchCenter">
                    {played ? (
                      <>
                        <span className="teamSearchPage__matchFtBadge">Terminé</span>
                        <div className="teamSearchPage__matchScoreRow">
                          <span className={`teamSearchPage__matchScoreNum${hWin ? ' teamSearchPage__matchScoreNum--win' : ''}${draw ? ' teamSearchPage__matchScoreNum--draw' : ''}`}>{hs ?? '–'}</span>
                          <span className="teamSearchPage__matchScoreDash">–</span>
                          <span className={`teamSearchPage__matchScoreNum${aWin ? ' teamSearchPage__matchScoreNum--win' : ''}${draw ? ' teamSearchPage__matchScoreNum--draw' : ''}`}>{as_ ?? '–'}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="teamSearchPage__matchKickoffLabel">À venir</span>
                        <span className="teamSearchPage__matchKickoff">{formatKickoffTime(match.utcDate)}</span>
                      </>
                    )}
                  </div>

                  <div className={`teamSearchPage__matchSide${!isHome ? ' teamSearchPage__matchSide--self' : ''}`}>
                    <div className="teamSearchPage__matchCrestWrap">
                      {match.awayTeam?.crest
                        ? <img src={match.awayTeam.crest} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
                        : <span className="teamSearchPage__matchCrestFb">{awayName.charAt(0)}</span>}
                    </div>
                    <span className="teamSearchPage__matchSideName">{awayName}</span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
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
          <TeamProfile rows={teamRows} teamName={selected.displayName} teamCrest={selected.crest} teamKey={selected.key} />
        ) : (
          <p className="teamSearchPage__hint">
            {isLoading ? 'Chargement des matchs…' : 'Aucun match trouvé pour cette équipe cette saison.'}
          </p>
        )
      )}
    </div>
  )
}
