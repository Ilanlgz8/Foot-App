/**
 * PronosSimulateur — onglet "Simulateur" de Pronos.jsx.
 *
 * Confrontation hypothétique entre 2 équipes, MÊME si elles ne se jouent pas
 * cette saison (ex. Real Madrid vs Bayern Munich) — demande utilisateur
 * (28/08) : "personne ne fait ça", moteur déjà existant (calcProno.js),
 * juste appliqué à un choix libre plutôt qu'aux vrais matchs du calendrier.
 *
 * ⚠️ Portée volontairement limitée aux 6 grands championnats club (FL1, PL,
 * PD, BL1, SA, CL) — CE SONT LES SEULES compétitions de l'app avec un vrai
 * classement/liste d'équipes exploitable (useStandings) ET une vraie forme
 * récente comparable (useTeamForm). Les sélections nationales (WC/EC/NL/
 * CAN/COPA) et les compétitions 100% ESPN sans classement (UEL/UECL, voir
 * NO_STANDINGS_COMPS dans data/competitions.js) n'ont pas de liste
 * d'équipes exploitable ici — pas ajoutées plutôt que bricolées.
 *
 * ⚠️ Modèle utilisé, choix fait avec l'utilisateur (28/08) : PAS le modèle
 * "buts marqués/encaissés" (calcPronoAdvanced avec compMatches) — il compare
 * chaque équipe à la MOYENNE DE BUTS DE SON CHAMPIONNAT, ce qui n'a de sens
 * que si les 2 équipes sont dans LE MÊME championnat. Comparer 2 équipes de
 * championnats différents avec ce modèle demanderait d'inventer un facteur
 * de conversion entre championnats — aucune donnée fiable pour le justifier.
 * À la place : forme récente (V/N/D, pareil pour toutes les équipes, aucune
 * dépendance à un championnat) + confrontations directes toutes compétitions
 * confondues si elles existent (useCrossCompH2H, nouveau — voir son
 * commentaire). C'est exactement le chemin de repli déjà existant et testé
 * dans calcPronoAdvanced (`fallback()`, utilisé normalement en tout début de
 * saison) — réutilisé tel quel en passant compMatches=[] pour le forcer à
 * s'y engager systématiquement, aucune nouvelle logique de calcul écrite.
 */
import { useState, useMemo } from 'react'
import { useStandings } from '../hooks/useStandings'
import { useTeamFormMulti } from '../hooks/useTeamForm'
import { useCrossCompH2H } from '../hooks/useCrossCompH2H'
import { calcPronoAdvanced, pronoToOdds, pronoIntensity, pronoGlowShadow, pronoFavoriteKey } from '../utils/calcProno'
import { COMPETITIONS } from '../data/competitions'
import { translateTeam } from '../data/teamNames'

const SIM_COMP_IDS = ['FL1', 'PL', 'PD', 'BL1', 'SA', 'CL']
const SIM_COMPS = COMPETITIONS.filter(c => SIM_COMP_IDS.includes(c.id))

function TeamPicker({ side, label, compId, teamId, onCompChange, onTeamChange }) {
  const { standings, loading } = useStandings(compId, true)
  // Trié par position au classement (déjà l'ordre renvoyé par FD.org) — plus
  // parlant qu'un tri alphabétique pour repérer une équipe (les cadors en
  // haut de liste, pas noyés au milieu d'un ordre A-Z).
  return (
    <div className={`simulateur__side simulateur__side--${side}`}>
      <span className="simulateur__sideLabel">{label}</span>
      <select
        className="simulateur__select"
        value={compId ?? ''}
        onChange={e => onCompChange(e.target.value || null)}
      >
        <option value="">Championnat…</option>
        {SIM_COMPS.map(c => (
          <option key={c.id} value={c.id}>{c.shortName}</option>
        ))}
      </select>
      <select
        className="simulateur__select"
        value={teamId ?? ''}
        onChange={e => onTeamChange(e.target.value || null)}
        disabled={!compId || loading}
      >
        <option value="">{loading ? 'Chargement…' : 'Équipe…'}</option>
        {standings.map(row => (
          <option key={row.team.id} value={row.team.id}>
            {translateTeam(row.team.shortName || row.team.name)}
          </option>
        ))}
      </select>
    </div>
  )
}

// Classes CSS locales (simulateur__pill*), PAS poster__prono-pill (accueil.css,
// jamais importé dans Pronos.jsx) — même traitement visuel (pilule blanche,
// liseré bordeaux glow sur la favorite) redéfini en propre dans pronos.css
// pour rester auto-porté, comme le reste des styles pronos.
function PronoPill({ label, value, favorite }) {
  return (
    <div
      className="simulateur__pill"
      style={favorite ? { borderColor: `rgba(159,30,52,${pronoIntensity(value)})`, boxShadow: pronoGlowShadow(value) } : { borderColor: 'transparent' }}
    >
      <span className="simulateur__pillLabel">{label}</span>
      <span className="simulateur__pillVal">{pronoToOdds(value).toFixed(2)}</span>
    </div>
  )
}

export function PronosSimulateur() {
  const [homeComp, setHomeComp] = useState(null)
  const [homeTeamId, setHomeTeamId] = useState(null)
  const [awayComp, setAwayComp] = useState(null)
  const [awayTeamId, setAwayTeamId] = useState(null)
  // Ne se déclenche qu'au clic sur "Comparer" (voir useCrossCompH2H — un
  // appel FD.org par comparaison explicite, jamais à chaque changement de
  // sélection dans les menus).
  const [compared, setCompared] = useState(null)

  const { formMap } = useTeamFormMulti([homeComp, awayComp].filter(Boolean))

  // Toujours appelés (règle des Hooks) — useStandings gère déjà en interne
  // le cas `compId` absent (enabled: !!selectedComp), retourne [] sans fetch.
  const homeName = useStandingsTeamName(homeComp, homeTeamId)
  const awayName = useStandingsTeamName(awayComp, awayTeamId)

  const canCompare = homeTeamId != null && awayTeamId != null && homeTeamId !== awayTeamId
  const isComparing = compared?.homeId === homeTeamId && compared?.awayId === awayTeamId

  const { meetings, loading: h2hLoading } = useCrossCompH2H(
    isComparing ? homeTeamId : null,
    isComparing ? awayTeamId : null,
    isComparing
  )

  const prono = useMemo(() => {
    if (!isComparing) return null
    const homeForm = formMap?.[homeTeamId] ?? []
    const awayForm = formMap?.[awayTeamId] ?? []
    // compMatches=[] force le repli forme+H2H (voir commentaire en tête de
    // fichier) — jamais le modèle "buts marqués/encaissés" (a besoin d'un
    // seul championnat de référence commun aux 2 équipes).
    return calcPronoAdvanced(homeTeamId, awayTeamId, [], homeForm, awayForm, { fullH2H: meetings })
  }, [isComparing, formMap, homeTeamId, awayTeamId, meetings])

  const favorite = prono ? pronoFavoriteKey(prono) : null
  const sameTeamPicked = homeTeamId != null && homeTeamId === awayTeamId

  return (
    <div className="simulateur">
      <p className="simulateur__intro">
        Choisis 2 équipes, même de championnats différents, pour voir ce que
        donnerait un match entre elles aujourd'hui — basé sur leur forme
        récente et leurs confrontations passées si elles existent.
      </p>

      <div className="simulateur__picker">
        <TeamPicker
          side="home" label="Équipe 1"
          compId={homeComp} teamId={homeTeamId}
          onCompChange={c => { setHomeComp(c); setHomeTeamId(null); setCompared(null) }}
          onTeamChange={t => { setHomeTeamId(t); setCompared(null) }}
        />
        <span className="simulateur__vs">VS</span>
        <TeamPicker
          side="away" label="Équipe 2"
          compId={awayComp} teamId={awayTeamId}
          onCompChange={c => { setAwayComp(c); setAwayTeamId(null); setCompared(null) }}
          onTeamChange={t => { setAwayTeamId(t); setCompared(null) }}
        />
      </div>

      {sameTeamPicked && (
        <p className="simulateur__hint">Choisis 2 équipes différentes.</p>
      )}

      <button
        className="simulateur__compareBtn"
        disabled={!canCompare}
        onClick={() => setCompared({ homeId: homeTeamId, awayId: awayTeamId })}
      >
        Comparer
      </button>

      {isComparing && prono && (
        <div className="simulateur__result">
          <div className="simulateur__resultTitle">{homeName} — {awayName}</div>
          <div className="simulateur__pillRow">
            <PronoPill label="1" value={prono.home} favorite={favorite === 'home'} />
            <PronoPill label="N" value={prono.draw} favorite={favorite === 'draw'} />
            <PronoPill label="2" value={prono.away} favorite={favorite === 'away'} />
          </div>
          <p className="simulateur__h2hNote">
            {h2hLoading
              ? 'Recherche des confrontations passées…'
              : meetings.length > 0
                ? `Basé sur la forme récente des 2 équipes + ${meetings.length} confrontation${meetings.length > 1 ? 's' : ''} directe${meetings.length > 1 ? 's' : ''} trouvée${meetings.length > 1 ? 's' : ''} (toutes compétitions).`
                : 'Basé sur la forme récente des 2 équipes — aucune confrontation directe trouvée dans leur historique.'}
          </p>
        </div>
      )}
    </div>
  )
}

// Petit helper local : nom d'équipe déjà connu via TeamPicker (standings),
// pas besoin d'un 2e fetch — lit simplement le même hook avec le même
// paramètre (React Query déduplique par queryKey, coût réseau nul en plus).
function useStandingsTeamName(compId, teamId) {
  const { standings } = useStandings(compId, true)
  const row = standings.find(r => String(r.team.id) === String(teamId))
  return row ? translateTeam(row.team.shortName || row.team.name) : null
}
