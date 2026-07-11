/**
 * MatchPage — page dédiée à un match à venir / terminé
 * Route : /match/:matchId
 */
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useState }                from 'react'
import { useQuery }                from '@tanstack/react-query'
import { translateTeam }           from '../data/teamNames'
import { COMPETITIONS }            from '../data/competitions'
import { useTeamForm }             from '../hooks/useTeamForm'
import { useSwipe }                from '../hooks/useSwipe'
import { getMatchGradient, getMatchThemeVars } from '../data/teamPhotos'
import { finalScore, matchOutcome, mergeScore, isNationalTeamComp } from '../utils/matchUtils'
import { FormDiamonds }            from '../accueil/FormDiamonds'
import {
  useEspnMatchStats,
  useFifaStats,
  useMatchDetail,
} from '../hooks/useMatchDetail'
import { useEspnMatchDetail } from '../hooks/useEspnMatchDetail'
import { useAflMatchStats } from '../hooks/useApiFootball'
import {
  PreMatchSection,
  ComposTab,
  ClassementTab,
  MatchTimeline,
  StatsSubTabs,
  getEspnData,
  TabDots,
  TeamFormTable,
  buildMatchEvents,
  useH2HRows,
  H2HTabContent,
} from '../components/MatchModal'
import './MatchPage.css'
import '../matchModal.css'
import '../live.css'
// Réutilisé pour les classes .lmp__heroScorers* (buteurs sous les noms
// d'équipe dans le hero) — même style qu'en direct, demande explicite de
// l'utilisateur ("exactement pareil"). Import de la CSS de la page live
// plutôt que dupliquer les règles, pour garantir un rendu identique sans
// risque de dérive entre les deux (même pattern déjà utilisé ailleurs dans
// l'app, ex: Resultat.jsx qui importe match.css).
import './LiveMatchPage.css'



// ── Fetch fallback si accès direct par URL ────────────────────────────────────
function useMatchData(matchId, initialMatch) {
  return useQuery({
    queryKey:  ['match', matchId],
    queryFn:   async () => {
      const res = await fetch(`/api/football?apiPath=/v4/matches/${matchId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled:   !initialMatch && !!matchId,
    staleTime: 5 * 60_000,
  })
}

// ── Formatage date / heure ────────────────────────────────────────────────────
function isSameDay(a, b) {
  return a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
}
function formatDate(utcDate) {
  if (!utcDate) return '–'
  const d = new Date(utcDate)
  const today    = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (isSameDay(d, today))    return "Aujourd'hui"
  if (isSameDay(d, tomorrow)) return 'Demain'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}
function formatTime(utcDate) {
  if (!utcDate) return '–'
  return new Date(utcDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── Hero gradient plein-écran ─────────────────────────────────────────────────
function MatchPageHero({ match, navigate, hForm, aForm }) {
  const comp       = COMPETITIONS.find(c => c.id === match.competition?.code)
  const homeName   = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName   = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const isFinished = match.status === 'FINISHED'
  const fs         = finalScore(match.score)
  const hs         = fs.home ?? match.score?.halfTime?.home
  const as_        = fs.away ?? match.score?.halfTime?.away
  // Tirs au but / prolongation — même logique que Resultat.jsx et
  // accueil/MatchCard.jsx (mutuellement exclusifs : un match aux tab a
  // duration='PENALTY_SHOOTOUT', pas 'EXTRA_TIME'). Manquait ici : cette page
  // affichait juste "Terminé" sans jamais préciser tab/prolongation.
  const wentToPens = match.score?.duration === 'PENALTY_SHOOTOUT'
  const wentToAet  = match.score?.duration === 'EXTRA_TIME'
  const emblem     = comp?.emblem ?? match.competition?.emblem
  const compName   = match.competition?.name ?? comp?.name ?? ''
  const gradient   = getMatchGradient(
    match.homeTeam?.name || homeName,
    match.awayTeam?.name || awayName
  )

  // Buteurs + cartons — même source/logique que MpMatchStats (cache
  // localStorage persistant si le match a été suivi en live, sinon fetch ESPN
  // à la demande). queryKey partagée avec MpMatchStats → pas de double fetch,
  // React Query dédup les deux appels automatiquement.
  const cachedEspn = isFinished ? getEspnData(match?.id) : null

  // Score tirs au but : fusion FD.org (match.score.penalties) + snapshot ESPN
  // persisté au moment du FT (cachedEspn.home/awayShootout), même garde
  // anti-régression (Math.max) que mergeScore() pour le score classique.
  // ⚠️ Bug constaté : FD.org peut brièvement re-servir une valeur de
  // score.penalties plus basse quelques minutes après la fin du match (même
  // catégorie d'instabilité déjà documentée pour score.fullTime, voir
  // finalScore() ci-dessus), le temps qu'ils recalculent/resynchronisent côté
  // serveur. Sans fusion, l'écran suivait cette régression telle quelle
  // (4-3 → 3-3 → 4-3). cachedEspn est écrit une seule fois par confirmFt()
  // avec la valeur ESPN déjà anti-régressée (voir useLiveMinute.js) et ne
  // change plus jamais après → sert de plancher fiable.
  const hPens = mergeScore(match.score?.penalties?.home ?? null, cachedEspn?.homeShootout ?? null)
  const aPens = mergeScore(match.score?.penalties?.away ?? null, cachedEspn?.awayShootout ?? null)
  const { espnData: fetchedEspn } = useEspnMatchDetail(
    isFinished && !cachedEspn ? match : null,
    match?.competition?.id,
    isFinished && !cachedEspn
  )
  const espnScorers = (cachedEspn ?? fetchedEspn)?.scorers ?? []
  const espnCards   = (cachedEspn ?? fetchedEspn)?.cards   ?? []
  // Buts + cartons fusionnés et triés par minute (même logique que le Fil du
  // match dans l'onglet Statistiques, sans les remplacements — le hero reste
  // compact). Uniquement ici (page Résultat) : demande explicite de
  // l'utilisateur, LiveMatchPage garde son affichage buts-seuls actuel.
  const { home: homeEvents, away: awayEvents } = buildMatchEvents({
    espnScorers, espnCards, homeId: match.homeTeam?.id,
  })

  // Blason (club, pas de cercle forcé) vs drapeau (pays, cercle) — voir index.css
  const isWC = isNationalTeamComp(match)

  return (
    <div className="mp__hero" style={{ background: gradient }}>
      <div className="mp__hero__overlay" />

      {/* Top bar : retour + badge compét */}
      <div className="mp__hero__top">
        <button className="mp__hero__back" onClick={() => navigate(-1)}>‹ Retour</button>
        <div className="mp__hero__comp">
          {emblem && <img src={emblem} alt="" className="mp__hero__compLogo" />}
          <span className="mp__hero__compName">{compName}</span>
        </div>
      </div>

      {/* Centre : crests + score/heure */}
      <div className="mp__hero__mid">
        <div className="mp__hero__team">
          {match.homeTeam?.crest
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.homeTeam.crest} alt="" className="mp__hero__crest" data-team={match.homeTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{homeName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{homeName}</span>
          <FormDiamonds form={hForm} />
        </div>

        <div className="mp__hero__center">
          {isFinished ? (
            <>
              <span className="mp__hero__label">Terminé</span>
              <span className="mp__hero__score">{hs} – {as_}</span>
              {wentToPens && hPens != null && aPens != null && (
                <div className="mp__hero__pensBlock">
                  <span className="mp__hero__pensLabel">T.A.B</span>
                  <span className="mp__hero__pensScore">({hPens}-{aPens})</span>
                </div>
              )}
              {wentToAet && (
                <span className="mp__hero__aet">Après prolong.</span>
              )}
            </>
          ) : (
            <>
              <span className="mp__hero__label">{formatDate(match.utcDate)}</span>
              <span className="mp__hero__time">{formatTime(match.utcDate)}</span>
            </>
          )}
        </div>

        <div className="mp__hero__team mp__hero__team--away">
          {match.awayTeam?.crest
            ? <div className="mp__hero__crestWrap" data-crest={isWC ? 'country' : 'club'}><img src={match.awayTeam.crest} alt="" className="mp__hero__crest" data-team={match.awayTeam?.name} /></div>
            : <div className="mp__hero__crestFb">{awayName?.[0] ?? ''}</div>}
          <span className="mp__hero__name">{awayName}</span>
          <FormDiamonds form={aForm} />
        </div>
      </div>

      {/* Buts + cartons — sous les noms d'équipe, triés par minute. Avant : ne
          montrait que les buts ici, et l'onglet Statistiques répétait les
          mêmes buts en y ajoutant les cartons dans le Fil du match → les buts
          apparaissaient deux fois sur la page (signalé par l'utilisateur).
          Le hero montre maintenant la même liste fusionnée (buts+cartons),
          au bon endroit selon la minute. */}
      {(homeEvents.length > 0 || awayEvents.length > 0) && (
        <div className="lmp__heroScorers">
          <div className="lmp__heroScorersHome">
            {homeEvents.map(e => (
              <span key={e.key} className="lmp__heroScorerItem">
                <span className="lmp__heroScorerIcon" aria-hidden="true">{e.icon}</span>
                {e.name}
                {e.minute && <span className="lmp__heroScorerMin"> {e.minute}</span>}
              </span>
            ))}
          </div>
          <div className="lmp__heroScorersDiv" />
          <div className="lmp__heroScorersAway">
            {awayEvents.map(e => (
              <span key={e.key} className="lmp__heroScorerItem">
                <span className="lmp__heroScorerIcon" aria-hidden="true">{e.icon}</span>
                {e.name}
                {e.minute && <span className="lmp__heroScorerMin"> {e.minute}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Table minimaliste stats (variante D) ──────────────────────────────────────
// Une ligne par stat : valeur dom. | libellé | valeur ext., la valeur la plus
// haute (au sens "higher"/"lower is better" déjà calculé par l'appelant via
// homeBetter/awayBetter) mise en avant. Remplace l'ancienne barre symétrique.
function MpStatRow({ label, homeVal, awayVal, homeBetter, awayBetter, homeColor, awayColor }) {
  return (
    <div className="mp__statRow">
      <span className={`mp__statVal${homeBetter ? ' mp__statVal--home' : ''}`} style={homeColor ? { color: homeColor } : undefined}>
        {homeVal ?? '–'}
      </span>
      <span className="mp__statLabel">{label}</span>
      <span className={`mp__statVal mp__statVal--r${awayBetter ? ' mp__statVal--away' : ''}`} style={awayColor ? { color: awayColor } : undefined}>
        {awayVal ?? '–'}
      </span>
    </div>
  )
}

// Skeleton shimmer (mêmes classes que MpStatRow) — remplace le spinner
// générique, même logique que les skeletons ajoutés dans MatchModal.jsx.
function MpStatsSkeleton() {
  return (
    <div className="mp__statsList">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="mp__statRow">
          <div className="sk" style={{ width: '1.6rem', height: '0.9rem', marginLeft: 'auto' }} />
          <div className="sk" style={{ width: '4.4rem', height: '0.6rem' }} />
          <div className="sk" style={{ width: '1.6rem', height: '0.9rem' }} />
        </div>
      ))}
    </div>
  )
}

// Skeleton pleine page (hero + onglets + stats) — remplace le spinner
// centré affiché avant que le match soit chargé (1er accès direct par URL,
// pas de state router). Reprend les mêmes classes que MatchPageHero pour
// un placement identique, donc pas de saut de layout à l'arrivée du match.
function MpPageSkeleton() {
  return (
    <div className="mp__page">
      <div className="mp__hero">
        <div className="mp__hero__top">
          <div className="sk" style={{ width: '3.2rem', height: '0.85rem' }} />
          <div className="sk" style={{ width: '5rem', height: '0.7rem' }} />
        </div>
        <div className="mp__hero__mid">
          <div className="mp__hero__team">
            <div className="sk" style={{ width: '3.4rem', height: '3.4rem', borderRadius: '50%' }} />
            <div className="sk" style={{ width: '3.4rem', height: '0.75rem' }} />
          </div>
          <div className="mp__hero__center">
            <div className="sk" style={{ width: '4rem', height: '0.6rem' }} />
            <div className="sk" style={{ width: '5rem', height: '2rem', marginTop: '0.3rem' }} />
          </div>
          <div className="mp__hero__team mp__hero__team--away">
            <div className="sk" style={{ width: '3.4rem', height: '3.4rem', borderRadius: '50%' }} />
            <div className="sk" style={{ width: '3.4rem', height: '0.75rem' }} />
          </div>
        </div>
      </div>
      <div className="mp__wrap">
        <div className="mp__tabs">
          {[0, 1, 2].map(i => (
            <div key={i} style={{ flex: 1, padding: '0.75rem 0', display: 'flex', justifyContent: 'center' }}>
              <div className="sk" style={{ width: '4rem', height: '0.8rem' }} />
            </div>
          ))}
        </div>
        <div className="mp__tabContent">
          <MpStatsSkeleton />
        </div>
      </div>
    </div>
  )
}

// ── Helpers stats match terminé (mêmes que MatchModal, dupliqués) ─────────────
const MATCH_STAT_KEYS = [
  { key: 'Ball possession',  label: 'Possession',     higher: true  },
  { key: 'Total shots',      label: 'Tirs',           higher: true  },
  { key: 'Shots on target',  label: 'Tirs cadrés',    higher: true  },
  { key: 'Corner kicks',     label: 'Corners',        higher: true  },
  { key: 'Fouls',            label: 'Fautes',         higher: false },
  { key: 'Offsides',         label: 'Hors-jeux',      higher: false },
  { key: 'Yellow Cards',     label: 'Cartons jaunes', higher: false },
]

function makeStatRow(label, hv, av, higher) {
  if (hv == null && av == null) return null
  const hvStr = hv != null ? String(hv) : '–'
  const avStr = av != null ? String(av) : '–'
  const hNum  = parseFloat(hvStr.replace('%', ''))
  const aNum  = parseFloat(avStr.replace('%', ''))
  const hBetter = !isNaN(hNum) && !isNaN(aNum) && (higher ? hNum > aNum : hNum < aNum)
  const aBetter = !isNaN(hNum) && !isNaN(aNum) && (higher ? aNum > hNum : aNum < hNum)
  return { label, hv: hvStr, av: avStr, hBetter, aBetter }
}

function fifaStatsToRows(data) {
  if (!data?.home && !data?.away) return []
  const h = data.home ?? {}
  const a = data.away ?? {}
  return [
    makeStatRow('Possession',   h.poss  != null ? `${h.poss}%` : null,  a.poss  != null ? `${a.poss}%` : null,  true),
    makeStatRow('Tirs',         h.shots,         a.shots,         true),
    makeStatRow('Tirs cadrés',  h.shotsOnTarget, a.shotsOnTarget, true),
    makeStatRow('Corners',      h.corners,       a.corners,       true),
    makeStatRow('Fautes',       h.fouls,         a.fouls,         false),
    makeStatRow('Hors-jeux',    h.offside,       a.offside,       false),
  ].filter(Boolean)
}

function aflStatsToRows(statsData) {
  if (!statsData) return []
  const allPeriod = statsData.statistics?.find(s => s.period === 'ALL')
  const items     = allPeriod?.groups?.flatMap(g => g.statisticsItems ?? []) ?? []
  return MATCH_STAT_KEYS.map(({ key, label, higher }) => {
    const item = items.find(i => i.name === key)
    if (!item) return null
    return makeStatRow(label, item.home ?? null, item.away ?? null, higher)
  }).filter(Boolean)
}

// ── Stats match terminé ───────────────────────────────────────────────────────
function MpMatchStats({ match }) {
  const isWC = isNationalTeamComp(match)
  const { data: fifaData,  isLoading: fifaLoading  } = useFifaStats(isWC ? match : null, isWC, false)
  const { data: espnStatsData, isLoading: espnLoading } = useEspnMatchStats(match)
  const { data: aflStats,  isLoading: aflLoading   } = useAflMatchStats(match)

  // ── Fil du match : remplacements uniquement ────────────────────────────────
  // Buts ET cartons sont désormais affichés dans le hero (MatchPageHero, qui
  // les fusionne triés par minute) — les remontrer ici faisait doublon
  // (constat utilisateur : d'abord pour les buts, puis pour les cartons
  // "vu qu'on les a déplacés dans le header"). FD.org (useMatchDetail) reste
  // l'unique source des remplacements (ESPN n'en expose aucune).
  const { detail, loading: detailLoading } = useMatchDetail(match?.id)

  const fdSubs      = detail?.substitutions ?? []
  const hasEvents   = fdSubs.length > 0
  const eventsLoading = detailLoading

  const fifaRows = fifaStatsToRows(fifaData)
  const espnRows = fifaStatsToRows(espnStatsData?.stats)
  const aflRows  = aflStatsToRows(aflStats)
  const rows     = fifaRows.length ? fifaRows : espnRows.length ? espnRows : aflRows

  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')
  const { home: hs, away: as_ } = finalScore(match.score)
  const totalGoals = (hs ?? 0) + (as_ ?? 0)

  const isLoading = !rows.length && ((isWC && fifaLoading) || espnLoading || aflLoading)

  return (
    <div className="mp__statsWrap">
      <div className="mp__statsHeader">
        <span className="mp__statsTeam">{homeName}{hs != null ? ` ${hs}` : ''}</span>
        <span className="mp__statsCenter">Match</span>
        <span className="mp__statsTeam mp__statsTeam--r">{as_ != null ? `${as_} ` : ''}{awayName}</span>
      </div>

      {/* Fil du match — remplacements seulement (buts + cartons déjà dans le
          hero, voir plus haut). S'il n'y a aucun remplacement à montrer ET
          aucun but marqué, on le précise ; s'il y a des buts/cartons mais pas
          de remplacement, on n'affiche rien ici (pas d'erreur : tout est déjà
          visible dans le hero). */}
      {hasEvents
        ? <MatchTimeline fdSubs={fdSubs} homeId={match.homeTeam?.id} />
        : (!eventsLoading && totalGoals === 0)
          ? <p className="pm__noData">Match sans but (0 – 0)</p>
          : null
      }

      {isLoading ? (
        <MpStatsSkeleton />
      ) : rows.length > 0 ? (
        <div className="mp__statsList">
          {rows.map(r => (
            <MpStatRow key={r.label} label={r.label}
              homeVal={r.hv} awayVal={r.av}
              homeBetter={r.hBetter} awayBetter={r.aBetter}
            />
          ))}
        </div>
      ) : (
        <p className="pm__noData">Statistiques non disponibles</p>
      )}
    </div>
  )
}

// ── Stats saison (matchs à venir) — barres depuis compMatches ────────────────
// split: 'all' | 'home' | 'away' — ne garde que les matchs joués à domicile
// ou à l'extérieur par teamId (retour utilisateur : comparatif dom/ext).
function calcTeamStats(teamId, compMatches, split = 'all') {
  const matches = (compMatches ?? []).filter(m => {
    if (m.status !== 'FINISHED') return false
    const isHome = m.homeTeam?.id === teamId
    const isAway = m.awayTeam?.id === teamId
    if (!isHome && !isAway) return false
    if (split === 'home') return isHome
    if (split === 'away') return isAway
    return true
  })
  if (!matches.length) return null
  let wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, cs = 0, btts = 0, over25 = 0
  const results = []
  matches.forEach(m => {
    const myHome = m.homeTeam?.id === teamId
    const fs = finalScore(m.score)
    const f = myHome ? fs.home : fs.away
    const a = myHome ? fs.away : fs.home
    if (f == null || a == null) return
    gf += f; ga += a
    if (a === 0) cs++
    if (f > 0 && a > 0) btts++
    if (f + a >= 3) over25++
    // Aux tirs au but, le score 120min (f/a) est TOUJOURS à égalité : le vrai
    // résultat vient de score.penalties (même convention que FormDiamonds).
    let outcome
    if (m.score?.duration === 'PENALTY_SHOOTOUT' &&
        m.score?.penalties?.home != null && m.score?.penalties?.away != null) {
      const myPens  = myHome ? m.score.penalties.home : m.score.penalties.away
      const oppPens = myHome ? m.score.penalties.away : m.score.penalties.home
      outcome = myPens > oppPens ? 'W' : 'L'
    } else {
      outcome = f > a ? 'W' : f === a ? 'D' : 'L'
    }
    if (outcome === 'W') { wins++; results.push('W') }
    else if (outcome === 'D') { draws++; results.push('D') }
    else { losses++; results.push('L') }
  })
  const played = wins + draws + losses
  if (!played) return null

  // Série en cours (même logique que SeasonStatsSection dans MatchModal.jsx)
  let streak = 0, streakType = null
  for (let i = results.length - 1; i >= 0; i--) {
    if (streakType === null) { streakType = results[i]; streak = 1 }
    else if (results[i] === streakType) streak++
    else break
  }

  return {
    played, wins, draws, losses,
    avgFor:     (gf / played).toFixed(1),
    avgAgainst: (ga / played).toFixed(1),
    winPct:     Math.round((wins  / played) * 100),
    bttsPct:    Math.round((btts  / played) * 100),
    over25Pct:  Math.round((over25/ played) * 100),
    cs,
    streak, streakType,
  }
}

function MpSeasonStats({ match, formMap, compMatches, hideForm = false }) {
  const homeId   = match.homeTeam?.id
  const awayId   = match.awayTeam?.id
  const homeName = translateTeam(match.homeTeam?.shortName || match.homeTeam?.name || '?')
  const awayName = translateTeam(match.awayTeam?.shortName || match.awayTeam?.name || '?')

  // Toggle Global/Domicile/Extérieur (retour utilisateur) — chaque équipe
  // est recalculée sur ses seuls matchs à domicile ou à l'extérieur.
  const [split, setSplit] = useState('all')

  const h = calcTeamStats(homeId, compMatches, split)
  const a = calcTeamStats(awayId, compMatches, split)
  // Section masquée seulement si AUCUNE donnée n'existe même en vue globale
  // (sinon un simple clic sur "Domicile"/"Extérieur" pourrait faire
  // disparaître toute la section pour une équipe encore sans match dans ce
  // contexte précis, alors que "Global" en a).
  if (split === 'all' && !h && !a) return null

  const streakColor = type => type === 'W' ? '#4ade80' : type === 'D' ? '#facc15' : '#f87171'
  const streakLabel = s => !s?.streak ? '–' : `${s.streak}${s.streakType === 'W' ? 'V' : s.streakType === 'D' ? 'N' : 'D'}`

  const rows = [
    { label: 'Matchs joués',            hv: h?.played,                 av: a?.played,                 noCompare: true },
    { label: 'Buts marqués / match',    hv: h?.avgFor,                 av: a?.avgFor,                 hRaw: parseFloat(h?.avgFor),  aRaw: parseFloat(a?.avgFor),  higher: true  },
    { label: 'Buts encaissés / match',  hv: h?.avgAgainst,             av: a?.avgAgainst,             hRaw: parseFloat(h?.avgAgainst),aRaw: parseFloat(a?.avgAgainst),higher: false },
    { label: '% Victoires',             hv: h ? `${h.winPct}%` : '–',  av: a ? `${a.winPct}%` : '–', hRaw: h?.winPct,              aRaw: a?.winPct,              higher: true  },
    { label: 'Clean sheets',            hv: h?.cs,                     av: a?.cs,                     hRaw: h?.cs,                  aRaw: a?.cs,                  higher: true  },
    { label: 'Les deux marquent %',     hv: h ? `${h.bttsPct}%` : '–', av: a ? `${a.bttsPct}%` : '–',hRaw: h?.bttsPct,             aRaw: a?.bttsPct,             higher: true  },
    { label: '+2.5 buts %',             hv: h ? `${h.over25Pct}%` : '–',av: a ? `${a.over25Pct}%` : '–',hRaw: h?.over25Pct,       aRaw: a?.over25Pct,           higher: true  },
    { label: 'Série en cours',          hv: streakLabel(h), av: streakLabel(a), noCompare: true, hColor: h ? streakColor(h.streakType) : null, aColor: a ? streakColor(a.streakType) : null },
  ]

  return (
    <div className="mp__statsWrap">
      <div className="mp__statsHeader">
        <span className="mp__statsTeam">{homeName}</span>
        <span className="mp__statsCenter">Saison</span>
        <span className="mp__statsTeam mp__statsTeam--r">{awayName}</span>
      </div>

      <div className="homeAwayToggle">
        <button className={`homeAwayToggle__btn${split === 'all' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('all')}>Global</button>
        <button className={`homeAwayToggle__btn${split === 'home' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('home')}>Domicile</button>
        <button className={`homeAwayToggle__btn${split === 'away' ? ' homeAwayToggle__btn--active' : ''}`} onClick={() => setSplit('away')}>Extérieur</button>
      </div>

      <div className="mp__statsList">
        {rows.map(({ label, hv, av, hRaw, aRaw, higher, noCompare, hColor, aColor }) => {
          const hBetter = !noCompare && hRaw != null && aRaw != null && (higher ? hRaw > aRaw : hRaw < aRaw)
          const aBetter = !noCompare && hRaw != null && aRaw != null && (higher ? aRaw > hRaw : aRaw < hRaw)
          return (
            <MpStatRow key={label} label={label}
              homeVal={hv ?? '–'} awayVal={av ?? '–'}
              homeBetter={hBetter} awayBetter={aBetter}
              homeColor={hColor} awayColor={aColor}
            />
          )
        })}
      </div>

      {/* Forme récente — dernier match joué de chaque équipe (score, W/D/L,
          date), même bloc que l'onglet "Avant-match". Masqué quand
          PreMatchSection est rendu juste après (matchs à venir) : il a déjà
          son propre bloc Forme récente, l'afficher ici aussi le dupliquait. */}
      {!hideForm && (
        <div className="pm__section modal__seasonForm">
          <h3 className="pm__sectionTitle">Forme récente</h3>
          <div className="pm__formGrid">
            <div className="pm__formCol">
              <p className="pm__formTeamName">{homeName}</p>
              <TeamFormTable teamId={homeId} compMatches={compMatches} />
            </div>
            <div className="pm__formDivider" />
            <div className="pm__formCol">
              <p className="pm__formTeamName">{awayName}</p>
              <TeamFormTable teamId={awayId} compMatches={compMatches} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function MatchPage() {
  const { matchId } = useParams()
  const navigate    = useNavigate()
  const location    = useLocation()

  const stateMatch = location.state?.match ?? null
  const { data: fetchedMatch, isLoading } = useMatchData(matchId, stateMatch)
  const match = stateMatch ?? fetchedMatch

  const isFinished = match?.status === 'FINISHED'
  const outcome = isFinished ? matchOutcome(match) : null
  const compId = match?.competition?.code ?? null

  // compMatches est nécessaire même pour un match terminé désormais : le
  // sous-onglet "Stats saison" en a besoin (avant, seuls les matchs à venir
  // le fetchaient, ce qui rendait "Stats saison" impossible pour un match FT).
  const { formMap, compMatches, isLoading: formLoading } = useTeamForm(compId)
  const hForm = formMap?.[match?.homeTeam?.id]
  const aForm = formMap?.[match?.awayTeam?.id]
  const homeShort = translateTeam(match?.homeTeam?.shortName || match?.homeTeam?.name || '?')
  const awayShort = translateTeam(match?.awayTeam?.shortName || match?.awayTeam?.name || '?')
  // Thème dynamique — mêmes couleurs anti-collision que le hero (getMatchGradient),
  // posées en CSS vars sur la page pour teinter les onglets.
  const themeVars = getMatchThemeVars(match?.homeTeam?.name || homeShort, match?.awayTeam?.name || awayShort)

  // Historique des confrontations — onglet dédié, masqué tant qu'aucune
  // confrontation connue n'est confirmée (demande explicite : pas de bouton
  // si y'en a pas). Calculé une seule fois ici, réutilisé pour piloter à la
  // fois la liste des onglets ET le contenu affiché.
  const { rows: h2hRows, isLoading: h2hLoading } = useH2HRows(match, compMatches)
  const showH2HTab = !h2hLoading && h2hRows.length > 0
  const TABS = ['statistiques', 'compos', 'classement', ...(showH2HTab ? ['historique'] : [])]

  const [activeTab, setActiveTab] = useState('statistiques')
  const [tabDir, setTabDir]       = useState(null)
  // Sous-onglet dans "Statistiques" pour un match terminé : Stats live (le
  // récap du match, par défaut) / Stats saison (nouveau).
  const [statsView, setStatsView] = useState('live')

  const goTab = (t, dir) => { setTabDir(dir); setActiveTab(t) }

  const swipe = useSwipe(
    () => {
      const i = TABS.indexOf(activeTab)
      if (i < TABS.length - 1) goTab(TABS[i + 1], 'left')
    },
    () => {
      const i = TABS.indexOf(activeTab)
      if (i > 0) goTab(TABS[i - 1], 'right')
      else navigate(-1)
    }
  )

  if (isLoading || !match) {
    return <MpPageSkeleton />
  }

  return (
    <div className="mp__page" style={themeVars}>

      {/* Hero plein-écran avec gradient */}
      <MatchPageHero match={match} navigate={navigate} hForm={hForm} aForm={aForm} />

      <div className="mp__wrap">
        <div className="mp__body" ref={swipe.ref}>

          {/* Onglets */}
          <div className="mp__tabs">
            {TABS.map(t => (
              <button
                key={t}
                className={`mp__tab${activeTab === t ? ' mp__tab--active' : ''}`}
                onClick={() => goTab(t, null)}
              >
                {t === 'statistiques' ? 'Statistiques'
               : t === 'compos'      ? 'Compos'
               : t === 'classement'  ? 'Classement'
               :                       'Historique'}
              </button>
            ))}
          </div>
          <TabDots count={TABS.length} active={TABS.indexOf(activeTab)} />

          {/* Contenu */}
          <div
            key={activeTab}
            className={`mp__tabContent${
              !swipe.isDragging && tabDir === 'left'  ? ' mp__tabContent--fromRight' :
              !swipe.isDragging && tabDir === 'right' ? ' mp__tabContent--fromLeft'  : ''
            }`}
            style={{
              transform:  swipe.isDragging ? `translateX(${swipe.dragOffset}px)` : undefined,
              transition: swipe.isDragging ? 'none' : undefined,
            }}
          >
            {activeTab === 'statistiques' && (
              isFinished
                ? <>
                    <StatsSubTabs view={statsView} onChange={setStatsView} />
                    {/* Pronostic des fans + courbe de bascule — sous les
                        onglets Stats Live/Stats Saison, au-dessus du
                        contenu des stats (remplace l'ancienne barre de
                        proba algorithmique, déjà visible sur l'Accueil
                        via MatchPoster). */}
                    
                    {statsView === 'live'
                      ? <MpMatchStats match={match} />
                      : <MpSeasonStats match={match} formMap={formMap} compMatches={compMatches} />
                    }
                  </>
                : formLoading
                  ? <MpStatsSkeleton />
                  : <>
                      {/* Pronostic des fans — tout en haut, avant Stats saison
                          (pas de tabs Stats Live/Stats Saison avant le
                          coup d'envoi, donc pas de raison de le descendre). */}
                     <MpSeasonStats
                        match={match}
                        formMap={formMap}
                        compMatches={compMatches}
                        hideForm
                      />
                      <PreMatchSection
                        match={match}
                        formMap={formMap}
                        compMatches={compMatches}
                        hideStats
                        hideProno
                      />
                    </>
            )}
            {/* compMatches transmis même pour un match terminé : nécessaire au
                fallback "compositions probables" de ComposTab (dernier XI
                connu), maintenant aussi actif après-coup si la vraie compo
                n'a jamais pu être récupérée. */}
            {activeTab === 'compos'     && <ComposTab match={match} compMatches={compMatches} />}
            {activeTab === 'classement' && <ClassementTab match={match} compId={compId} />}
            {activeTab === 'historique' && <H2HTabContent match={match} rows={h2hRows} isLoading={h2hLoading} />}
          </div>
        </div>
      </div>
    </div>
  )
}
